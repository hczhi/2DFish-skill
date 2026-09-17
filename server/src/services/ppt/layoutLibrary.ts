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

/**
 * 页型（库文件里每条的 `归属`）：这一条能当**什么页**用。
 *
 * 这份词表是**代码这一份说了算**：md 里写了个词表外的字（「过渡」「尾页」）一律抛错 ——
 * 静默忽略的话那一条就从某个分组里消失了，而规划清单看着还是 22 条、规划出来的每一页
 * 都合法，只是封面页再也挑不到它。
 *
 * **「目录」这一档已经去掉了**（他要的：稿子里不再有 agenda 页）。它不能只是「不用」——
 * 留在这份词表里的话，规划 prompt 里照旧有一行「目录页可用的版式」，模型于是照旧会排一页
 * 目录出来，而那一页每一格都正常、一处都不报错。原来挂着它的四条版式（L17/L33/L48/L65）
 * 改成「章节」，其中三条纯议程版（L33/L48/L65）由 migration 103 默认停用 —— 只改 `归属`
 * 不停用的话，它们会被当章节扉页挑中，出来还是一页目录。
 */
export const PAGE_ROLES = ['封面', '章节', '内容', '结尾'] as const;
export type PageRole = (typeof PAGE_ROLES)[number];

/** 内容的骨架形状（每条的 `形状`，单选）。规划那一步按内容结构对形状挑版式。 */
export const LAYOUT_SHAPES = ['聚焦', '分屏', '并列', '对比', '数据', '时序'] as const;
export type LayoutShape = (typeof LAYOUT_SHAPES)[number];

export interface PptLayout {
  /** 'L11' */
  id: string;
  num: number;
  /** 结构手法名，如 tri-narrative-photo */
  name: string;
  /** 中文括注，如「三栏并列叙事 · 全幅图叠字」 */
  title: string;
  applicable: string;
  /**
   * 这一条能当什么页用（库文件里那行 `归属`，可多选）。规划那一步拿它做两件事：
   * 按页型给模型分组列清单、核对模型给每页标的 `kind` 和它挑的版式对不对得上。
   *
   * 少写一个词不报错，表现是「这一条从此不出现在某个分组里」——清单看着还是 22 条，
   * 只是封面页再也挑不到它，而规划出来的每一页都合法。
   */
  roles: PageRole[];
  /** 内容的骨架形状（`形状`，单选）：并列 / 对比 / 数据 / 时序 / 分屏 / 聚焦。 */
  shape: LayoutShape;
  structure: string;
  /** 图槽位说明原文（「3 个（pXX_col1/col2/col3…）」）—— 张数和构图要求都在里面，别拆 */
  imageSlots: string;
  designHint: string;
  variants: string;
  /**
   * build-part 不包 `.slide-inner`。见库文件末尾的「全幅版式集合」。
   *
   * **「背景图铺满整页」不算全幅**：L2/L3 的图是绝对定位铺满的，文字照旧在 `.slide-inner`
   * 里（demo 片段里有没有 `.slide-inner` 是唯一判据，`demoDeck.test.ts` 拿它对账）。
   * 把那种也标成 true 的话，那几条生成出来的文字贴着画面边缘、疏密档也不动一个像素，
   * 而它仍是一页完整的幻灯片，一处都不报错。
   */
  fullbleed: boolean;
  /** section 需加 `has-card`（目前只有 L12）：色带要溢出卡片边缘 */
  hasCard: boolean;
  /**
   * 这一条**不贴**左上角那行统一页眉（只有 L2 / L13 这两条封面）。
   *
   * 和 `fullbleed` 是两回事：全幅的 L11/L18/L19/L21/L22 在 demo 里每一页都有页眉。
   * 拿 `fullbleed` 当这个用的话，那 6 条的模块名会静默消失（模型写的被 `applyHeader`
   * 摘掉、代码又不贴），而画面完全正常。
   */
  noHeader: boolean;
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
let cachedStamp = '';
let stampCheckedAt = 0;
let version = 0;

/**
 * library 目录里每个文件的 mtime + 大小拼成的指纹。
 *
 * **改了 md 不用重启服务** —— 原来是「读一次缓存住」，于是改完一条案例的结构模板之后
 * 点「重新生成这一页」拿到的是**一模一样的旧版**：那是一次真实调用（花了钱），页面
 * 渲染正常、接口 200、problems 里还是原来那几条，而没有任何一处说「你改的那份 md
 * 这个进程压根没读过」。上一次 L11 的顶 header 白带就是这么白花了一次调用。
 * 线上部署本来就会重启，所以这个指纹只在开发时起作用，代价是每次最多一次目录 stat。
 */
function stamp(): string {
  // 一秒内不重复扫：`library()` 在一次请求里会被调很多次（templateClasses → checkPage）。
  const now = Date.now();
  if (cachedStamp && now - stampCheckedAt < 1000) return cachedStamp;
  stampCheckedAt = now;
  const root = libraryRoot();
  const parts: string[] = [];
  try {
    for (const rel of fs.readdirSync(root, { recursive: true }) as string[]) {
      const st = fs.statSync(path.join(root, String(rel)));
      if (st.isFile()) parts.push(`${rel}:${st.mtimeMs}:${st.size}`);
    }
  } catch {
    // 目录读不到时不要在这里静默返回空串（那会让下面每次都重读一遍库、每次都抛
    // loadLibrary 那句错），交给 loadLibrary 去抛那句说得清的错。
    return cachedStamp || 'unreadable';
  }
  return parts.sort().join('|');
}

/** 读一次缓存住，但 library 目录里的文件一改就重读（见 `stamp`）。 */
export function library(): PptLibrary {
  const s = stamp();
  if (!cached || s !== cachedStamp) {
    cached = loadLibrary();
    cachedStamp = s;
    version += 1;
  }
  return cached;
}

/**
 * 每重读一次 +1。派生缓存（画风 / template 的色值 / demo 片段）照它判要不要重算 ——
 * 少了这一步的话库重读了而它们还是旧的，现象是「md 改了一半生效」：生成用的是新骨架，
 * demo 卡片和画风提示词还是旧的，两边都不报错。
 */
export function libraryVersion(): number {
  library();
  return version;
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
  cachedStamp = '';
  stampCheckedAt = 0;
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
  const noHeaderSet = parseMarkedSet(index, '不贴统一页眉的版式');
  if (!noHeaderSet.size) {
    // 空集合的表现是「每一页都贴页眉」—— 封面上多出一行模块名，那一页照样是一页完整的
    // 幻灯片，没有一处会说。所以这一句改名/删掉必须炸在这里。
    throw new Error(
      `版式案例库里找不到「★ 不贴统一页眉的版式（L… / L…）」那一行（${indexPath}）—— ` +
        '缺了它每一页都会贴左上角那行模块名，封面上会凭空多一行字而不报错。'
    );
  }

  const layouts = splitEntries(index).map((entry) =>
    buildLayout(entry, root, fullbleedSet, hasCardSet, noHeaderSet)
  );

  if (!layouts.length) {
    // 解析出 0 条和「案例库为空」在接口上长得一样（返回 200 + 空列表），
    // 而下游会照空列表继续生成。所以这里必须炸。
    throw new Error(`版式案例库解析出 0 条案例（${indexPath}）—— 检查条目标题是不是还写成「## L<编号> · <名>」。`);
  }

  // 某个页型一条版式都没有的话，规划 prompt 里那一行会是空的 —— 模型于是给那种页
  // 随便挑一条，而它给的编号在库里，`layoutId` 校验一路放行，界面上是一份挑得「都对」
  // 的规划。所以哪个页型空了必须在这里炸。
  for (const role of PAGE_ROLES) {
    if (!layouts.some((l) => l.roles.includes(role))) {
      throw new Error(
        `版式案例库里没有一条的「归属」写了「${role}」（${indexPath}）—— ` +
          `规划时那一类页会从 22 条里随便挑一条，而挑出来的编号是合法的，一处都不报错。`
      );
    }
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

/**
 * 那行 `归属` → 页型集合。**认不出来的词一律抛错**（不是跳过）：
 * 静默跳过的话那一条就从某个分组里消失了，而规划照样出一份挑得「都对」的清单。
 */
function parseRoles(entry: RawEntry, raw: string): PageRole[] {
  const out: PageRole[] = [];
  for (const part of raw.split(/[\/、,，\s·]+/)) {
    const word = part.trim();
    if (!word) continue;
    const hit = PAGE_ROLES.find((r) => r === word);
    if (!hit) {
      throw new Error(
        `${entry.id} 的「归属」里有认不出来的页型「${word}」（只能是 ${PAGE_ROLES.join(' / ')}）—— ` +
          '跳过它的话这一条会从某个页型的清单里消失，而规划出来的每一页都合法、一处都不报错。'
      );
    }
    if (!out.includes(hit)) out.push(hit);
  }
  if (!out.length) {
    throw new Error(
      `${entry.id} 缺「- **归属**：…」这一行（只能是 ${PAGE_ROLES.join(' / ')}，可多选）—— ` +
        '缺了它这一条哪个页型都挑不到，等于案例库少一条，而列表上它还在。'
    );
  }
  return out;
}

/** 那行 `形状` → 单个骨架形状。同上，认不出来就抛。 */
function parseShape(entry: RawEntry, raw: string): LayoutShape {
  const word = raw.trim();
  const hit = LAYOUT_SHAPES.find((s) => s === word);
  if (!hit) {
    throw new Error(
      `${entry.id} 的「形状」是「${word || '(缺这一行)'}」，只能是 ${LAYOUT_SHAPES.join(' / ')} 里的一个 —— ` +
        '缺了它规划时「四块并列的内容」和「两块对立的内容」在模型眼里没有区别，挑出来的版式装不下这一页而不报错。'
    );
  }
  return hit;
}

function buildLayout(
  entry: RawEntry,
  root: string,
  fullbleedSet: Set<number>,
  hasCardSet: Set<number>,
  noHeaderSet: Set<number>
): PptLayout {
  const { body } = entry;
  const applicable = field(body, '适用');
  const roles = parseRoles(entry, field(body, '归属'));
  const shape = parseShape(entry, field(body, '形状'));
  const structure = field(body, '结构');
  const imageSlots = field(body, '图槽位');
  const designHint = field(body, 'design 提示');
  const variants = field(body, '变体');
  const source = field(body, '来源');

  // fullbleed 有两个来源：条目自己的「是否全幅」和文末那句集合。条目里明写的优先
  // （L12 写着「否」但要 has-card），没写的按集合判 —— 只靠集合的话新加的条目漏进集合
  // 就会被包进 `.slide-inner`，出来的是一张四边留白的「全幅」图，不报错。
  //
  // 先剥掉 markdown 的 `**`：写成 `**是**（…）` 时 `startsWith('是')` 是 false，
  // 于是那一条**静默变成普通页**（库文件上明明白白写着「是」）。剥完还不是「是」/「否」
  // 开头的一律抛错 —— 「视情况」这种写法会被当成「否」，同样一个字都不报。
  const declared = field(body, '是否全幅').replace(/^[*_\s]+/, '');
  if (declared && !/^[是否]/.test(declared)) {
    throw new Error(
      `${entry.id} 的「是否全幅」写的是「${declared}」，必须以「是」或「否」开头 —— ` +
        '认不出来时会当成「否」，那一条于是被包进 `.slide-inner`，出来是一张四边留白的「全幅」图，一处都不报错。'
    );
  }
  const fullbleed = declared ? declared.startsWith('是') : fullbleedSet.has(entry.num);

  const detailPath = findDetail(root, entry.id);
  const detail = detailPath ? fs.readFileSync(detailPath, 'utf-8') : '';

  return {
    id: entry.id,
    num: entry.num,
    name: entry.name,
    title: entry.title,
    applicable,
    roles,
    shape,
    structure,
    imageSlots,
    designHint,
    variants,
    fullbleed,
    hasCard: hasCardSet.has(entry.num),
    noHeader: noHeaderSet.has(entry.num),
    hasDetail: !!detail,
    refImage: assetUrl(source, /cases\/img\/(L\d+-ref\.\w+)/),
    // demo 一律指向拼出来的那份 deck，不指静态文件。库文件的「来源」里那几个
    // `cases/L11-demo.html` 是当初随案例一起抄来的独立 html，它们各自复制了一份版式
    // CSS —— 改了 template 之后那几页照旧好看，而生成出来的页面已经变了。
    demoUrl: `/api/ppt/demo-deck.html?only=${entry.id}`,
    selectText: selectText(entry, { applicable, roles, shape, structure, imageSlots, designHint, fullbleed }),
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
  f: {
    applicable: string;
    roles: PageRole[];
    shape: LayoutShape;
    structure: string;
    imageSlots: string;
    designHint: string;
    fullbleed: boolean;
  }
): string {
  const lines = [`${entry.id} ${entry.name}${entry.title ? `（${entry.title}）` : ''}`];
  // 归属/形状放在最前面：选版式那一次是按「这是什么页 + 内容是什么形状」挑的，
  // 埋在「适用」后面的话模型只按那一串场景词匹配，于是章节扉页拿到四栏矩阵。
  lines.push(`归属：${f.roles.join(' / ')} · 形状：${f.shape}`);
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
