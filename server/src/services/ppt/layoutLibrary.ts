// 版式案例库。22 条 L 案例的**唯一来源是仓库里的 markdown**
// （`src/services/ppt/library/`），不是数据库、也不是本机某个 skill 目录。
//
// 为什么是仓库文件：这套案例原本在作者机器的 `~/.workbuddy/skills/` 下，线上机器
// 没有那个目录 —— 而读不到案例的后果不是报错，是生成阶段拿不到任何排版参考，
// 照样出一份完整的 HTML，只是版式全靠模型自己编。本机好使、线上悄悄变差，
// 唯一的症状是「质量不行」，而没有任何一处会喊。所以：文件跟着代码走，
// 解析不出来就在启动/调用时**抛错**（见 loadLibrary 末尾的 0 条判断）。
//
// 拆成两份文本给两个不同的 prompt 用：
//   selectText  短（适用/结构一句话/图槽位/fullbleed/design 提示）→ 选版式那一次调用，
//               22 条一起进 prompt，不能被 CSS 淹掉。
//   buildText   长（详情 md 全文：CSS 骨架 + build-part HTML 结构模板 + 变体）→ 只在
//               生成某一页时带**那一条**进 prompt。
// 两份混成一份的后果是：选版式那次上下文被 22 份 CSS 挤爆，客户内容被挤到最后，
// 模型开始凭空挑版式 —— 而挑出来的那个名字看起来完全正常。

import fs from 'fs';
import path from 'path';

export interface PptLayout {
  /** 'L11' */
  id: string;
  num: number;
  /** 结构手法名，如 tri-narrative-photo */
  name: string;
  /** 中文括注，如「三栏并列叙事 · 全幅图叠字」 */
  title: string;
  applicable: string;
  structure: string;
  /** 图槽位说明原文（「3 个（pXX_col1/col2/col3…）」）—— 张数和构图要求都在里面，别拆 */
  imageSlots: string;
  designHint: string;
  variants: string;
  /** build-part 不包 `.slide-inner`。见库文件末尾的「全幅版式集合」 */
  fullbleed: boolean;
  /** section 需加 `has-card`（目前只有 L12）：色带要溢出卡片边缘 */
  hasCard: boolean;
  /** 有没有详情 md（12 条有，L1–L10 索引条目自足） */
  hasDetail: boolean;
  /** 原始参考截图（客户端静态资源，client/public/ppt-cases/） */
  refImage?: string;
  /**
   * 效果 demo：`/api/ppt/demo-deck.html?only=<id>`。**每条都有**，因为它不是外部素材，
   * 是同一份 template.html 跑出来的那一页（见 demoDeck.ts）。
   */
  demoUrl: string;
  /** 选版式那次调用带的短文本 */
  selectText: string;
  /** 生成那一页时带的长文本（详情 md 全文，没有详情时回落索引条目原文） */
  buildText: string;
}

export interface PptLibrary {
  layouts: PptLayout[];
  /** 全 deck 共享的 CSS 与骨架（:root 变量 + 通用组件） */
  template: string;
  /** 配色与排版 token 说明 */
  designTokens: string;
  /** 配图风格说明（生图提示词照它写） */
  illustrationStyle: string;
}

export function libraryRoot(): string {
  // 同 skillService / discover.ts 的既有做法：cwd 是 server 目录（dev 的 tsx 和
  // 线上的 `node dist/app.js` 都是），md 不经过 tsc 所以只能读 src 下那一份。
  return path.resolve(process.cwd(), 'src/services/ppt/library');
}

let cached: PptLibrary | null = null;

/** 读一次缓存住。改了 md 要重启服务（和 skills 目录一个脾气）。 */
export function library(): PptLibrary {
  if (!cached) cached = loadLibrary();
  return cached;
}

export function layouts(): PptLayout[] {
  return library().layouts;
}

export function layoutById(id: string): PptLayout | undefined {
  const key = id.trim().toUpperCase();
  return layouts().find((l) => l.id === key);
}

/** 测试里改了文件之后用。 */
export function resetLibraryCache(): void {
  cached = null;
}

export function loadLibrary(): PptLibrary {
  const root = libraryRoot();
  const indexPath = path.join(root, 'layout-library.md');
  if (!fs.existsSync(indexPath)) {
    throw new Error(
      `版式案例库读不到：${indexPath} 不存在。这份 md 是案例库的唯一来源，缺了它 /ppt 生成出来的版式全是模型自己编的（不会报错，只是质量掉）。`
    );
  }
  const index = fs.readFileSync(indexPath, 'utf-8');

  const fullbleedSet = parseMarkedSet(index, '全幅版式集合');
  const hasCardSet = parseMarkedSet(index, '出血版式');

  const layouts = splitEntries(index).map((entry) =>
    buildLayout(entry, root, fullbleedSet, hasCardSet)
  );

  if (!layouts.length) {
    // 解析出 0 条和「案例库为空」在接口上长得一样（返回 200 + 空列表），
    // 而下游会照空列表继续生成。所以这里必须炸。
    throw new Error(`版式案例库解析出 0 条案例（${indexPath}）—— 检查条目标题是不是还写成「## L<编号> · <名>」。`);
  }

  return {
    layouts,
    template: readOptional(path.join(root, 'template.html')),
    designTokens: readOptional(path.join(root, 'design-tokens.md')),
    illustrationStyle: readOptional(path.join(root, 'illustration-style.md')),
  };
}

function readOptional(p: string): string {
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : '';
}

interface RawEntry {
  id: string;
  num: number;
  name: string;
  title: string;
  body: string;
  raw: string;
}

/** 按 `## L<n> · <名>（<中文标题>）` 切条目。名字可能被反引号包着（L17 起）。 */
function splitEntries(md: string): RawEntry[] {
  const lines = md.split('\n');
  const heading = /^##\s+L(\d+)\s*[·•]\s*`?([A-Za-z0-9-]+)`?\s*(?:[（(]([^）)]*)[）)])?/;
  const out: RawEntry[] = [];
  let cur: RawEntry | null = null;
  const push = () => {
    if (cur) {
      cur.body = cur.body.trimEnd();
      cur.raw = cur.raw.trimEnd();
      out.push(cur);
    }
  };
  for (const line of lines) {
    const m = heading.exec(line);
    if (m) {
      push();
      cur = {
        id: `L${m[1]}`,
        num: Number(m[1]),
        name: m[2],
        title: (m[3] || '').trim(),
        body: '',
        raw: `${line}\n`,
      };
      continue;
    }
    if (!cur) continue;
    // 分隔线和末尾的「★ …」总结段不属于任何一条
    if (/^---\s*$/.test(line) || /^>\s*\*\*★/.test(line)) {
      push();
      cur = null;
      continue;
    }
    cur.body += `${line}\n`;
    cur.raw += `${line}\n`;
  }
  push();
  return out;
}

/** 取 `- **标签**：内容` 的内容。 */
function field(body: string, label: string): string {
  const re = new RegExp(`^-\\s*\\*\\*${label}\\*\\*\\s*[：:]\\s*(.*)$`, 'm');
  const m = re.exec(body);
  return m ? m[1].trim() : '';
}

/** 末尾那几句 `> **★ 全幅版式集合（L2 / L3 / …）**` 里的编号集合。 */
function parseMarkedSet(md: string, label: string): Set<number> {
  const re = new RegExp(`★\\s*${label}[（(]([^）)]*)[）)]`);
  const m = re.exec(md);
  const set = new Set<number>();
  if (!m) return set;
  for (const part of m[1].split(/[\/、,，\s]+/)) {
    const n = /^L?(\d+)$/.exec(part.trim());
    if (n) set.add(Number(n[1]));
  }
  return set;
}

function buildLayout(
  entry: RawEntry,
  root: string,
  fullbleedSet: Set<number>,
  hasCardSet: Set<number>
): PptLayout {
  const { body } = entry;
  const applicable = field(body, '适用');
  const structure = field(body, '结构');
  const imageSlots = field(body, '图槽位');
  const designHint = field(body, 'design 提示');
  const variants = field(body, '变体');
  const source = field(body, '来源');

  // fullbleed 有两个来源：条目自己的「是否全幅」和文末那句集合。
  // 条目里明写的优先（L12 写着「否」但要 has-card），没写的按集合判 ——
  // L2/L3 那几条老条目压根没有这一行，只靠字段的话它们会被当成普通页，
  // 被包进 `.slide-inner`，出来的是一张四边留白的「全幅」图，不报错。
  const declared = field(body, '是否全幅');
  const fullbleed = declared ? declared.startsWith('是') : fullbleedSet.has(entry.num);

  const detailPath = findDetail(root, entry.id);
  const detail = detailPath ? fs.readFileSync(detailPath, 'utf-8') : '';

  return {
    id: entry.id,
    num: entry.num,
    name: entry.name,
    title: entry.title,
    applicable,
    structure,
    imageSlots,
    designHint,
    variants,
    fullbleed,
    hasCard: hasCardSet.has(entry.num),
    hasDetail: !!detail,
    refImage: assetUrl(source, /cases\/img\/(L\d+-ref\.\w+)/),
    // demo 一律指向拼出来的那份 deck，不指静态文件。库文件的「来源」里那几个
    // `cases/L11-demo.html` 是当初随案例一起抄来的独立 html，它们各自复制了一份版式
    // CSS —— 改了 template 之后那几页照旧好看，而生成出来的页面已经变了。
    demoUrl: `/api/ppt/demo-deck.html?only=${entry.id}`,
    selectText: selectText(entry, { applicable, structure, imageSlots, designHint, fullbleed }),
    buildText: detail || entry.raw,
  };
}

/**
 * 详情 md 按 `L<编号>-` 前缀找，**不按版式名**：L12 的文件名还是
 * `L12-bio-portrait-card.md`，而条目名早就按结构改成了 circle-float-card
 * （案例只关注结构，名字跟着结构走）。按名字找的话那一条会被判成「无详情」，
 * 生成时拿不到 CSS 骨架，出来的页面结构自由发挥，而列表上看不出区别。
 */
function findDetail(root: string, id: string): string | null {
  const dir = path.join(root, 'cases');
  if (!fs.existsSync(dir)) return null;
  const hit = fs.readdirSync(dir).find((f) => f.startsWith(`${id}-`) && f.endsWith('.md'));
  return hit ? path.join(dir, hit) : null;
}

/** 把库文件里写的 `cases/img/L11-ref.jpg` 换成前端能取到的静态地址。 */
function assetUrl(source: string, re: RegExp): string | undefined {
  const m = re.exec(source);
  return m ? `/ppt-cases/${m[1]}` : undefined;
}

function selectText(
  entry: RawEntry,
  f: { applicable: string; structure: string; imageSlots: string; designHint: string; fullbleed: boolean }
): string {
  const lines = [`${entry.id} ${entry.name}${entry.title ? `（${entry.title}）` : ''}`];
  if (f.applicable) lines.push(`适用：${f.applicable}`);
  // 结构留一句话就够（选型阶段只需要知道它长什么样），完整结构在 buildText 里。
  if (f.structure) lines.push(`结构：${oneLine(f.structure, 160)}`);
  if (f.imageSlots) lines.push(`图槽位：${f.imageSlots}`);
  lines.push(`fullbleed：${f.fullbleed ? '是' : '否'}`);
  if (f.designHint) lines.push(`提示：${oneLine(f.designHint, 160)}`);
  return lines.join('\n');
}

function oneLine(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}
