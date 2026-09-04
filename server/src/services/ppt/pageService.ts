// 生成**一页** HTML。输入是规划阶段那一行（标题 / 要点 / 挑中的版式），
// 输出是一个 `<section class="slide">`，套进 deckShell 就能在 iframe 里直接看。
//
// 一页一次调用（不是整份一次）：这一次要带那个版式的 buildText（CSS 骨架 + HTML 结构模板，
// 单条最长近 8000 字），22 条一起带的话客户内容会被挤到上下文末尾 —— 而挤掉之后模型照样
// 出一份完整的 HTML，只是内容开始跑偏，没有任何一处会喊。跨页的事（挑版式、去重、节奏）
// 已经在 planService 那一次调用里定完了。
//
// 这一步所有的失败都长得像成功，所以三件事必须都有：
//   ① 拿不到 `<section>` 一律抛错（回一段空 HTML 的话 iframe 里是一块白，读起来像这个
//      版式渲染塌了）；
//   ② 截断要喊（`</section>` 没写出来的页面在浏览器里照样渲染，只是下半页没了 ——
//      和「这一版设计得比较空」分不开）；
//   ③ **内部元素**用了 template 里没有的类名要喊（那一块回到默认流式布局，看起来是版式
//      本身不行）；根 `<section>` 上多写的那种不算，见 `checkPage` ①。

import { aiGateway } from '../../core/llm/gateway.js';
import { layoutById, library, type PptLayout } from './layoutLibrary.js';
import { designPromptBlock, DEFAULT_DESIGN, type DesignSpec } from './designSpec.js';
import { type PlannedImage } from './imageSpec.js';
import { assembleDeck, assemblePreview, templateClasses, stripPageNumber, type DeckMeta } from './deckShell.js';
import { injectEids } from './pageEdit.js';

/** 一页正文 2-4KB，剩下的是留给思维链的空间（硬规则 2）。`noThinking` 也一起发。 */
const MAX_PAGE_TOKENS = 6000;

/**
 * 生成 HTML 时图槽位一律先用这三张占位图（client/public/ppt-cases/），真图由
 * `imageService.ts` 按每个元素的 `data-img-prompt` 事后替换 —— 占位图明显是「还没配图」，
 * 而一个坏地址在屏幕上和「这一格本来是空的」长得一样。
 */
export const PLACEHOLDERS = ['/ppt-cases/ph-16x9.svg', '/ppt-cases/ph-1x1.svg', '/ppt-cases/ph-3x4.svg'];

export interface PageInput {
  page: number;
  total: number;
  section: string;
  title: string;
  points: string[];
  layoutId: string;
  images: number;
  /**
   * 规划里定下的「这几张图画什么」（顺序就是图位顺序）。**带进 prompt 是承重的**：
   * 备好的图是**按序号**贴进图位的（`applyPreparedImages`），模型自己另写一套图位说明
   * 的话，第 1 格的图会贴到一格讲别的事情的位置上 —— 图文不符，而页面渲染完全正常。
   * 老规划没有这个字段（那时只有张数），那就退回「先出 HTML 再照它写的说明配图」。
   */
  imageSpecs?: PlannedImage[];
  /**
   * 他自己写的那段额外要求（字体 / 排版 / 语气，092 `setup_notes`）。**放在 prompt 最后
   * 并写明它优先于上面的建议**——夹在中间的话模型基本照旧按版式建议排，而出来是一页
   * 完整正常的幻灯片，他只会觉得「这个要求好像没什么用」，再写一遍、再花一次额度。
   * 但输出格式那几条硬规则（一个 section / 不写页码 / 不自己写 style）不受它影响：
   * 让它盖掉的话「字体大一点」会换来一段 `<style>`，那玩意儿改的是整份 deck 的每一页。
   */
  notes?: string;
  /**
   * 整份统一的那段要求（093 `ppt_decks.notes`）。**和页级那段一起发，不是二选一**：
   * 页级有就顶掉整份那段的话，他在某一页补一句「这里的表格用等宽字体」，整份定的
   * 「语气克制」就在这一页悄悄失效了 —— 只有那一页语气不一样，没有一处会说。
   */
  deckNotes?: string;
  brandCn?: string;
  brandEn?: string;
  topic?: string;
  /**
   * 这份稿子的设计规范（096）。**不传就是默认那套**：模型于是照案例库和通用令牌那份排 ——
   * 颜色确实还是对的（靠 `:root` 覆盖），但紧凑/舒展那一档它不知道，排出来的容量是标准档的，
   * 紧凑档下面空一块、舒展档被 `overflow:hidden` 切掉一行，两种都不报错。
   */
  design?: DesignSpec;
  /**
   * 这一页的蒙版透明度（097）。**要跟着进这份预览** —— 不带的话刚生成完那一眼是没有
   * 蒙版的那一版，而刷新之后（listPages 那条路）是压暗的，他会以为「蒙版时好时不好」。
   */
  veil?: number;
}

export interface PageResult {
  page: number;
  layoutId: string;
  /** 那一个 `<section>`（存盘/拼整份用的就是它） */
  html: string;
  /** 套好外壳、可以直接 iframe 的单页 deck */
  previewHtml: string;
  problems: string[];
  usage?: { input_tokens: number; output_tokens: number; total_tokens: number };
}

export class PageError extends Error {}

export async function generatePage(input: PageInput, userId: string): Promise<PageResult> {
  const layout = layoutById(input.layoutId);
  if (!layout) {
    throw new PageError(`没有版式 ${input.layoutId} —— 规划里那一页的版式不在案例库的 22 条里，不能生成。`);
  }
  if (!input.title.trim()) throw new PageError('这一页没有标题，没有可以排的内容。');

  const { response, usage, noThinking } = await aiGateway(
    {
      messages: [{ role: 'user', content: buildPrompt(input, layout) }],
      temperature: 0.6,
      max_tokens: MAX_PAGE_TOKENS,
    },
    // 不指定 tier（走 default）：平台渠道可能压根没有 strong 那一档。
    { userId, source: 'ppt', operation: 'build-page', noThinking: true }
  );

  const raw = response.choices[0]?.message?.content || '';
  const finish = response.choices[0]?.finish_reason;
  const reasoningTokens: number | undefined = (response.usage as any)?.completion_tokens_details
    ?.reasoning_tokens;

  const { html, problems } = extractSection(raw, {
    finish,
    reasoningTokens,
    noThinkingRequested: noThinking,
  });

  // 每一段文字打上 `data-eid`（就地编辑靠它定位，见 pageEdit）。**在这里做、跟着 html 一起
  // 存**：编辑时再算一遍的话，前端手上那份预览里的 t3 和库里的 t3 可能是两个不同的元素，
  // 于是他改的是这一块、变的是隔壁那一块 —— 两块都是正常的文字，一处都不报错。
  // 统一页眉由**代码**贴（`applyHeader`）：模块名是提纲里那一条，交给模型写的话它会顺手
  // 改写成「案例」「第二章」，于是每一页左上角那行字都不太一样（硬规则 3）。
  const head = applyHeader(injectEids(stripPageNumber(html)), input, layout);
  const fixed = head.html;
  problems.push(...head.problems, ...checkPage(fixed, layout, input));

  return {
    page: input.page,
    layoutId: layout.id,
    html: fixed,
    // 制作过程中的单页预览不要页脚（它压在画面底部，挡住的是这一页自己的内容）。
    previewHtml: assemblePreview(
      fixed,
      {
        brandCn: input.brandCn || '示例企业',
        brandEn: input.brandEn || 'SAMPLE',
        topic: input.topic || input.section || input.title,
        // 规范要跟着进这份预览（096）：不带的话刚生成完那一眼看到的是默认配色，
        // 而库里那份和刷新之后都是对的 —— 他会以为「配色只对一半」。
        design: input.design,
      },
      input.veil || 0
    ),
    problems,
    usage,
  };
}

export interface DeckPageInput {
  page: number;
  html: string;
  /** 这一页的蒙版透明度（097）。缺省 0。**按 page 取，不按数组下标** —— 见下面那条 ②。 */
  veil?: number;
}

/**
 * 把已生成的那几页拼成整份 deck（不调 AI，纯合并）。
 *
 * 两条都是「翻起来完全正常」的失败：
 * ① **缺页一律拒绝并点名缺哪几页** —— 缺页的 deck 和完整的一模一样，只是内容跳了一段，
 *    而页脚那个「/ 12」是按规划总页数写的（页码由代码给），所以连页码都看不出缺口。
 * ② **顺序只按 `page` 排**，不按前端传来的数组顺序 —— 批量生成是并发/重试混着来的，
 *    传进来的顺序可能是完成顺序，照它拼出来的 deck 每一页都对、章节全乱了。
 */
export function buildDeck(pages: DeckPageInput[], total: number, meta: DeckMeta): string {
  if (!Number.isInteger(total) || total < 1) {
    throw new PageError(`总页数不对（${total}），拼不出 deck。`);
  }
  const have = new Map<number, DeckPageInput>();
  for (const p of pages) {
    if (p.html?.includes('<section')) have.set(p.page, p);
  }
  const missing: number[] = [];
  for (let i = 1; i <= total; i++) if (!have.has(i)) missing.push(i);
  if (missing.length) {
    throw new PageError(
      `还差第 ${missing.join(' / ')} 页没生成（共 ${total} 页），拼不出整份 —— ` +
        `缺页的 deck 翻起来和完整的一模一样，只是内容跳了一段，所以这里不给拼。`
    );
  }
  const ordered = Array.from({ length: total }, (_, i) => have.get(i + 1)!);
  return assembleDeck(
    ordered.map((p) => p.html),
    meta,
    // 蒙版也按排好的顺序给（②：传进来的顺序可能是完成顺序）—— 照数组下标取的话，
    // 压暗的是别的那一页，而每一页单看都是正常的幻灯片。
    { veils: ordered.map((p) => p.veil || 0) }
  );
}

interface FailInfo {
  finish?: string;
  reasoningTokens?: number;
  noThinkingRequested?: boolean;
}

/**
 * 从返回文本里抠出那一个 `<section>`。
 *
 * 这里**不**用 `jsonFailMessage`（这条路径不吐 JSON，那句话会写成「模型没有按 JSON 格式
 * 返回」，把人往格式上指），但三种成因照它的口径分开说：空返回 / 截断 / 压根没写 section。
 */
function extractSection(raw: string, info: FailInfo): { html: string; problems: string[] } {
  const problems: string[] = [];
  const src = raw.replace(/```(?:html)?/gi, '');
  const start = src.indexOf('<section');
  const cot = info.reasoningTokens ? `，其中思维链占 ${info.reasoningTokens} token` : '';

  if (start === -1) {
    const why = !raw.trim()
      ? `模型没有返回内容（finish_reason=${info.finish || '未知'}${cot}）`
      : info.finish === 'length'
        ? `模型返回被截断，连 <section> 那一行都没写出来（finish_reason=length${cot}）`
        : '模型没有返回 <section>（它可能改成了整份 html 或者一段说明文字）';
    const how =
      info.noThinkingRequested && (info.reasoningTokens ?? 0) > 0
        ? `这次已经把「不使用深度思考」发给上游了，但它照样想了 ${info.reasoningTokens} token —— 这个开关对这条接入点无效，后台再勾一遍没有用，只能换一个不带思维链的模型`
        : (info.reasoningTokens ?? 0) >= MAX_PAGE_TOKENS * 0.9
          ? `这次 ${MAX_PAGE_TOKENS} token 基本全花在思维链上了，正文没开始写。再点一次通常就好；老是这样就去「专属 AI / 系统配置」换一个不带思维链的模型`
          : '再生成一次，或者换一个版式';
    throw new PageError(`${why}，这一页没生成。${how}（这次的 AI 额度已经扣了）`);
  }

  const closeAt = src.lastIndexOf('</section>');
  if (closeAt === -1) {
    // 没闭合的 section 在浏览器里照样渲染（HTML 容错），只是下半页没了 —— 和
    // 「这一版设计得比较空」在屏幕上分不开，所以必须在这里喊出来。
    problems.push(
      `这一页被截断了（finish_reason=${info.finish || '未知'}${cot}）：\`</section>\` 没写出来，下半页缺内容。` +
        `换一个内容少一点的版式，或者把这一页的要点拆成两页。`
    );
    return { html: `${src.slice(start).trimEnd()}\n</section>`, problems };
  }

  const html = src.slice(start, closeAt + '</section>'.length).trim();
  const count = (html.match(/<section[\s>]/g) || []).length;
  if (count > 1) {
    // 多出来的那几页会跟着进 deck，页码和规划从此错位。只留第一个并说出来。
    const firstEnd = html.indexOf('</section>') + '</section>'.length;
    problems.push(`模型一次返回了 ${count} 个 <section>，只取了第一个（这一步一次只排一页）。`);
    return { html: html.slice(0, firstEnd), problems };
  }
  return { html, problems };
}

/**
 * 统一页眉：`<div class="slide-header"><div class="kicker">模块名</div></div>`，**由代码贴**。
 *
 * 四条是承重的：
 *
 * ① **模块名取提纲里那一条，不用模型写的那句。** 交给模型的话它会顺手改写（「第二部分 ·
 *    标杆案例」→「案例」/「第二章」），于是每页左上角那行字都不太一样 —— 每一页单看都正常，
 *    只有连着翻才看出来，而没有一处会报错（硬规则 3）。
 * ② **先把模型写的那个页眉整块摘掉**，再贴我们这一份。不摘的话页面左上角**同一个位置**叠着
 *    两行字（`.slide-header` 是 absolute 定位的），读起来像字重叠了、像渲染错了。
 * ③ **摘的时候要数 `<div>` 配对**，不能用非贪婪正则匹配到第一个 `</div>`：里面还嵌着
 *    `.kicker` 那一层，切早了会剩一个孤零零的 `</div>` —— 浏览器把它丢掉，于是后面那一块
 *    内容跑到了外层容器里，那一页的排版整段塌掉，而 HTML 照样渲染、一处都不报错。
 * ④ **只有封面那两条不贴**（`layout.noHeader`，库文件末尾那句「不贴统一页眉的版式」）。
 *    **不能拿 `fullbleed` 当这个用**：全幅的 L11/L18/L19/L21/L22 在 demo 里每一页都有页眉，
 *    按全幅跳过的话这 5 条的模块名会静默消失（模型写的那份在上面第 ② 条被摘掉、代码又不贴），
 *    而画面完全正常、`problems` 里一个字都没有。
 * ⑤ **模型在正文里又写一遍模块名的那行 `.kicker` 要一起摘掉**（`stripEchoedKicker`）：它不在
 *    `.slide-header` 里，第 ② 条摘不到 —— 于是左上角一行（代码贴的，17px 加宽字距）、正文里
 *    再一行（模型自己 inline 写的，字号色号都不一样），同一句话在一页上出现两次而**两处都
 *    渲染正常**。只报不摘不行：这条问题**每一页都会犯**，报出来是十几条一样的提示，
 *    而他要做的是逐页就地编辑删掉 —— 报了等于没报。
 *    `noHeader` 的那两条**留第一处**（那一页的模块名本来就该露出来，全摘掉的话章节页会变成
 *    只剩一个标题的空页），去重和重复检查都**在 `noHeader` 的提前返回之前**跑：
 *    放在后面的话 L2/L13 这两条一个字都不查，而它们恰好是最容易重复的那两页（页眉 + 大标题）。
 */
export function applyHeader(
  html: string,
  input: { section?: string; page?: number },
  layout: PptLayout
): { html: string; problems: string[] } {
  const problems: string[] = [];
  let stripped = stripHeaders(html);
  const section = (input.section || '').trim();
  if (section) {
    // ⑤ 正文里那行重复的模块名。`noHeader` 的两条留第一处。
    const echo = stripEchoedKicker(stripped, section, !!layout.noHeader);
    stripped = echo.html;
    if (echo.removed) {
      problems.push(
        `正文里有 ${echo.removed} 处又写了一遍「${section}」（模型自己加的那行小标签），已经摘掉 —— ` +
          '左上角那行模块名是代码统一贴的，位置和字体每页一样，正文里再写一遍会在同一页上显示两遍。'
      );
    }
  }
  if (layout.noHeader) {
    problems.push(...dupSectionProblem(stripped, section, true));
    return { html: stripped, problems };
  }
  if (!section) {
    // 别的页左上角都有一行模块名，这一页没有 —— 翻起来只是「这页看着有点空」。
    problems.push(
      `这一页在提纲里没写所属模块，左上角的页眉是空的（别的页都有一行模块名）—— ` +
        '在「提纲与设置」里给这一页归到某个模块下面，再重新生成这一页就有了。'
    );
    return { html: stripped, problems };
  }
  const open = /<section[^>]*>/.exec(stripped);
  if (!open) {
    // 走不到这里（`extractSection` 已经保证有 `<section>`），但静默返回的话这一页会是
    // 整份里唯一没有页眉的一页。
    problems.push('这一页找不到 `<section>` 开标签，统一页眉没贴上（左上角那行模块名会缺）。');
    return { html: stripped, problems };
  }
  const at = open.index + open[0].length;
  const header = `\n  <div class="slide-header"><div class="kicker">${esc(section)}</div></div>`;
  const out = stripped.slice(0, at) + header + stripped.slice(at);
  problems.push(...dupSectionProblem(out, section, false));
  return { html: out, problems };
}

/**
 * 上面第 ⑤ 条摘不掉的那些重复（模块名写在 L16 的顶栏、L18 的 pill、或者干脆写进了标题里）——
 * **只报不改**：那几处不是一个独立的小标签，剪掉会把那一块的结构也带走。
 */
function dupSectionProblem(html: string, section: string, noHeader: boolean): string[] {
  if (!section) return [];
  const dup = html.split(esc(section)).length - 1;
  if (dup < 2) return [];
  return [
    noHeader
      ? `「${section}」在这一页上出现了 ${dup} 次（这一页不贴统一页眉，所以这几处都是模型自己写的）—— ` +
        '同一句话在一页里显示两遍，读起来像设计的一部分。要去掉就用就地编辑删掉多的那一处。'
      : `「${section}」在这一页上出现了 ${dup} 次：左上角的统一页眉是代码贴的，正文里那 ${dup - 1} 处是模型自己写的 —— ` +
        '同一句话在一页里显示两遍，读起来像设计的一部分。要去掉就用就地编辑删掉正文里那一处。',
  ];
}

/**
 * 摘掉正文里那行「又写了一遍模块名」的 `.kicker`（`applyHeader` 第 ⑤ 条）。
 *
 * 三条边界：
 * - **只认 `.kicker`、且里面不能再嵌标签。** 认得宽一点（比如凡是文字等于模块名的元素都摘）
 *   会把 L13 的大标题、L18 的 pill 那种承重的块整个剪掉 —— 那一页少半屏内容而 HTML 照样渲染。
 * - **比的是「去掉序号前缀 + 去掉空白」之后的文字**：提纲里写「一、开篇」而页面上写「开篇」
 *   是同一件事，逐字比的话摘不掉（现象就是左上角两行字，一行带序号一行不带）。
 * - `keepFirst` 时留第一处：见第 ⑤ 条。
 */
function stripEchoedKicker(html: string, section: string, keepFirst: boolean): { html: string; removed: number } {
  const key = normSection(section);
  if (!key) return { html, removed: 0 };
  const re = /<div[^>]*class="[^"]*(?<![\w-])kicker(?![\w-])[^"]*"[^>]*>([^<]*)<\/div>/gi;
  let removed = 0;
  let seen = 0;
  const out = html.replace(re, (whole, text: string) => {
    if (normSection(text) !== key) return whole;
    seen += 1;
    if (keepFirst && seen === 1) return whole;
    removed += 1;
    return '';
  });
  if (!removed) return { html, removed: 0 };
  // 摘完留下的空行会让下一块前面多一个空白节点（`display:flex` 的容器里那是一格 gap）。
  return { html: out.replace(/[ \t]*\n(?:[ \t]*\n)+/g, '\n'), removed };
}

/**
 * 「一、开篇」和「开篇」算同一个模块名。序号前缀只在**开头**剥一次。
 *
 * **剥完什么都不剩的要退回原文**（模块名本身就叫「第二部分」「第三章」的时候）：不退的话
 * 这个模块的 key 是空字符串 —— `''` 谁都不等于，于是这一整份稿子的去重一处都不生效，
 * 而现象只是「怎么还是两行字」，和没改之前一模一样。
 */
function normSection(s: string): string {
  const flat = s.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').trim();
  const cut = flat.replace(/^第?[一二三四五六七八九十百千0-9]+\s*[、.．·:：]?\s*(?:部分|章|节|篇)?\s*[、.．·:：]?\s*/, '');
  return (cut || flat).replace(/\s+/g, '').toLowerCase();
}

/** 摘掉所有 `.slide-header` 块（数 `<div>` 配对，见 `applyHeader` 的第 ③ 条）。 */
function stripHeaders(html: string): string {
  const re = /<div[^>]*class="[^"]*(?<![\w-])slide-header(?![\w-])[^"]*"[^>]*>/;
  let out = html;
  for (let guard = 0; guard < 8; guard++) {
    const m = re.exec(out);
    if (!m) break;
    const from = m.index;
    let i = from + m[0].length;
    let depth = 1;
    const tag = /<\/?div\b/g;
    tag.lastIndex = i;
    let t: RegExpExecArray | null;
    while ((t = tag.exec(out))) {
      depth += t[0][1] === '/' ? -1 : 1;
      if (depth === 0) {
        i = t.index + out.slice(t.index).indexOf('>') + 1;
        break;
      }
    }
    if (depth !== 0) {
      // 配不上对（模型少写了一个 `</div>`）：整段留着不动 —— 从这里剪到结尾的话
      // 这一页的下半部分会凭空消失，而剩下的那半页照样渲染。
      break;
    }
    out = out.slice(0, from) + out.slice(i).replace(/^\s*\n/, '');
  }
  return out;
}

/** 进 html 的文字一律转义（同 pageEdit 里那份）：他的模块名里打了一个 `<`，从那里到块尾
 *  的内容会被浏览器当成标签吃掉 —— 页面照样渲染，只是那一块少了半句话。 */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 每一条都是「页面照样渲染出来了，只是不对」——手测时看不出来的那些。 */
function checkPage(html: string, layout: PptLayout, input: PageInput): string[] {
  const problems: string[] = [];

  // ① 类名。不在 template 里的类不报错，那一块只是回到默认流式布局。
  //    **根 `<section>` 自己那一行不算**：那一层的尺寸和定位全由 `.slide` 给，模型顺手
  //    多写的 `l13-cover` / `fullbleed` 这类语义标签一个字都不影响画面 —— 报出来的话
  //    界面上是一条「用了没定义的类名」而那一页完全正常，用户只能盯着它猜自己错在哪。
  //    内部元素上的照旧要报：那才是真的掉回默认流式布局。
  const known = templateClasses();
  const unknown = new Set<string>();
  const inner = html.replace(/^[\s\S]*?<section[^>]*>/, '');
  for (const m of inner.matchAll(/class="([^"]*)"/g)) {
    for (const tok of m[1].trim().split(/\s+/)) {
      if (tok && !known.has(tok)) unknown.add(tok);
    }
  }
  if (unknown.size) {
    // 措辞里不出现 template.html / 类名这些词：他能做的只有「重新生成一次」。
    problems.push(
      `这一页有 ${unknown.size} 块内容没套上模板的样式（${[...unknown].join(' / ')}），` +
        '那几块会变成没排版的文字或错位的方块 —— 重新生成一次通常就好了。'
    );
  }

  // ①b 自己用文字写的页码。`stripPageNumber` 只摘得掉那几个类名和占位符 ——
  //     模型把 `01 / 17` 直接写进某个 pill / 角标里时，代码分不出它是页码还是内容，
  //     而页面上那个数字看起来完全像设计的一部分（这一页在 deck 里换个位置就对不上了）。
  const pageNumLike = html.match(/>\s*0\d\s*\/\s*\d{1,3}\s*</);
  if (pageNumLike) {
    problems.push(
      `这一页里有一处看起来是页码的文字（${pageNumLike[0].replace(/[><]/g, '').trim()}）。页面上不显示页码 —— 它不会跟着这一页在 deck 里的位置变，请删掉或改成别的文案。`
    );
  }

  // ② 自带 CSS / JS。`<style>` 会盖掉共享骨架（改的是整份 deck，不只这一页），
  //    `<script>` 会在预览和最终 deck 里真的执行。两样都要喊，不能只当它没写。
  if (/<style[\s>]/i.test(html)) {
    problems.push('这一页自己写了 <style>：它会盖掉共享骨架、影响整份 deck 的其他页。要微调请用 inline style。');
  }
  if (/<script[\s>]/i.test(html)) problems.push('这一页里有 <script>，它会在 deck 里真的执行 —— 请删掉。');

  // ③ fullbleed。包错了不报错，只是全幅版式变成一张四边留白的图（或者普通页贴边）。
  const hasInner = html.includes('slide-inner');
  if (layout.fullbleed && hasInner) {
    problems.push(`${layout.id} 是全幅版式，但这一页把内容包进了 .slide-inner —— 出来会是一张四边留白的「全幅」图。`);
  }
  // 出血版式（L12）也不包 `.slide-inner`：浮卡 + 色带要脱离标准 padding（案例里就是这么写的）。
  // 不放过它的话，每一页 L12 都会带着一条他照案例改不掉的警告 —— 而真正要靠这条抓的
  // 「普通页贴到画面边缘」会混在这种常态噪音里被一起忽略。
  if (!layout.fullbleed && !layout.hasCard && !hasInner) {
    problems.push(`${layout.id} 不是全幅版式，但这一页没有 .slide-inner —— 内容会贴到画面边缘。`);
  }
  if (layout.hasCard && !/class="[^"]*\bhas-card\b/.test(html)) {
    problems.push(`${layout.id} 的 section 需要 has-card 类（色带要溢出卡片边缘），这一页没加。`);
  }

  // ④ 图。图槽位空着的版式出来是一块灰，读起来像「这一页本来就没图」。
  const imgs = (html.match(/<img[\s>]/g) || []).length + (html.match(/background-image:/g) || []).length;
  if (input.images > 0 && imgs === 0) {
    problems.push(`规划里这一页要 ${input.images} 张图，但生成出来一张都没有（${layout.id} 的图槽位是「${layout.imageSlots || '见案例'}」）。`);
  }
  // 模型自己编的图片地址在预览里是破图，而破图和「这一格本来是空的」长得一样。
  // 真图是生图那一步替换进来的（`/uploads/…` 或 COS 绝对地址），这一步只能是占位图。
  for (const m of html.matchAll(/(?:src|url\()\s*["']?(\/[^"')\s]+)/g)) {
    const url = m[1];
    if (!PLACEHOLDERS.includes(url) && !url.startsWith('/uploads/')) {
      problems.push(`图片地址 ${url} 不是占位图也不是已上传的文件，预览里会是一张破图。这一步只能用 ${PLACEHOLDERS.join(' / ')}，真图走「生成这一页的图」。`);
    }
  }
  // 图槽位少了 data-img-prompt 就永远配不上图（生图那一步认的就是它），而这一页
  // 在预览里完全正常 —— 占位图看起来就像「设计上留白」。
  const slots = (html.match(/data-img-prompt="/g) || []).length;
  if (imgs > 0 && slots < imgs) {
    problems.push(`这一页有 ${imgs} 个图元素，但只有 ${slots} 个带 data-img-prompt —— 缺的那几格生图那一步会跳过，永远停在占位图上。`);
  }
  // 图位条数没照规格来：备好的图是**按序号**贴的，条数一变就有图没地方贴、或者有格子空着，
  // 而这一页看起来完全正常（占位图读起来就是「设计上留白」）。
  const specs = input.imageSpecs?.length || 0;
  if (specs && slots !== specs) {
    problems.push(
      `规划里这一页有 ${specs} 个图位，生成出来是 ${slots} 个 —— 备好的图按序号贴，` +
        `${slots < specs ? '多出来的那几张没地方贴' : '多出来的那几格贴不到图（会停在占位图上）'}。` +
        // 现在版式的图位数只是参考、块数按真实内容排（buildPrompt 第 8 条），所以这条经常
        // 不是「模型排错了」而是「这一页真实内容就不是 N 块」。只说「重新生成」的话他会
        // 一直重生成同一页拿同一个数字，而每次都花一次钱 —— 必须指到重排图位那一步。
        `如果这一页的内容本来就是 ${slots} 块，就在「生成前改一下」里点「按这个版式和这一页的内容重排图位」把规划改成 ${slots} 个；` +
        '真是模型排错了才重新生成这一页。'
    );
  }
  return problems;
}

/**
 * 规格那一段的硬要求，接在图槽位那条规则后面。
 *
 * 「条数和顺序照规格」是承重的：备好的图**按序号**贴进图位（`applyPreparedImages`），
 * 模型多写一个图位、或者把三格的顺序换一下，贴出来就是「第 1 张图配在讲另一件事的那一格」
 * —— 图文不符，而页面渲染、类名校验、张数统计全部正常。
 */
function imageSpecBlock(input: PageInput): string {
  if (!input.imageSpecs?.length) return '';
  return (
    `\n   - **图位的条数和顺序照下面「图位」那一段来**（正好 ${input.imageSpecs.length} 个，多写少写都不行）：` +
    `第 n 个图元素就是那一段的第 n 条，\`data-img-prompt\` 照抄它那句话，占位图按它给的比例挑。` +
    `这几张图可能已经提前生成好了，是**按序号**贴进图位的 —— 顺序换了就会贴到讲别的事情的那一格。`
  );
}

/**
 * 他手写的那段要求，**接在整份 prompt 最后**（上面那些是建议，这一段压它们）。
 *
 * 顺序是承重的：夹在版式骨架前面的话，后面近 8000 字的骨架说明会把它盖过去 —— 模型照旧
 * 按版式建议排，出来是一页完整正常的幻灯片，而他写的「语气克制、别用感叹号」一处都没生效，
 * 也没有一处会说（他只会再写一遍、再花一次额度）。
 *
 * 同时要挡住「顺着他的要求破坏输出格式」那一路：他写「字体大一点」时模型很容易回一段
 * `<style>`，而那玩意儿改的是整份 deck 的每一页（`checkPage` 会喊，但那时这次调用已经花了）。
 */
function notesBlock(input: PageInput): string {
  const notes = input.notes?.trim();
  const deckNotes = input.deckNotes?.trim();
  if (!notes && !deckNotes) return '';
  // 两段分开写、各带标签：合成一段的话「整份统一」和「这一页额外」在模型眼里没有轻重，
  // 两条冲突时（整份说「不要图标」、这一页说「用图标分栏」）它挑哪条全凭运气，
  // 而出来是一页完整正常的幻灯片。
  const lines = [
    deckNotes ? `整份统一：${deckNotes}` : '',
    notes ? `这一页额外（和上一条冲突时按这一条）：${notes}` : '',
  ].filter(Boolean);
  return `
## 额外要求（他自己写的，**优先于上面所有建议**）
${lines.join('\n')}

上面「输出格式（硬规则）」那 7 条不受这一段影响：还是只输出一个 \`<section>\`、不写页码、
不写 \`<style>\` / \`<script>\`、颜色只用 \`var(--…)\`。要改字号/间距/字重就写 inline \`style="…"\`。
`;
}

function buildPrompt(input: PageInput, layout: PptLayout): string {
  const lib = library();
  return `你是演示稿的前端实现。把下面这一页的内容，用指定的版式排成**一个** \`<section>\`。

## 输出格式（硬规则）
1. 只输出一个 \`<section class="slide" …>…</section>\`，前后不要任何解释、不要 markdown 围栏。
2. **不要**输出 \`<html>\` / \`<head>\` / \`<style>\` / \`<script>\` —— 骨架 CSS 已经在 deck 外壳里了，这一页只能**用已有的类名**。要微调用 inline \`style="…"\`。
3. 颜色只能用 \`var(--c-*)\` / \`var(--bg-*)\` 这些变量，不要写死色值 —— 同一个版式要能在橙/蓝/双色系的 deck 里都成立。
4. **不要写页码**：不要当前页码、不要总页数、不要 \`01 / 17\` 这种角标，也不要 \`page-badge\` / \`wm\` / \`hc-no\` / \`bio-page-num\`（这几个类已经删了，写了只会在正文里多出一行数字）。放映器页脚会显示进度。
   **左上角那行模块名（\`.slide-header\`）也不要写** —— 整份统一由代码贴（版式案例里那一行是给你看整体效果的）。你写了会被摘掉，而**正文里再出现一次模块名**就会和它重复显示。${input.section && !layout.noHeader
      ? `\n   所属模块「${input.section}」这几个字**在这一页的正文里一次都不要出现**：不要写成 \`.kicker\` 小标签、不要写进标题、不要放在顶栏或 pill 里。这一页的标题要写这一页自己的信息，不是它属于哪个模块。`
      : ''}
5. ${layout.fullbleed
      ? `${layout.id} 是**全幅**版式：内容**不要**包进 \`.slide-inner\`（包进去会变成一张四边留白的「全幅」图）。`
      : layout.hasCard
        // L12 是第三种：不是全幅，但浮卡和出血色带要脱离标准 padding —— 包进 `.slide-inner`
        // 之后色带被padding 挡住，出来是一张「卡片四周留白」的正常页，没有一处会说。
        ? `${layout.id} 是**出血**版式：内容**不要**包进 \`.slide-inner\`（浮卡和色带要脱离标准页边距），照案例那样直接用它自己的外层容器。`
        : `${layout.id} 不是全幅版式：正文必须包在 \`<div class="slide-inner">…</div>\` 里（不包的话内容会贴到画面边缘）。`}${layout.hasCard ? `\n   另外 section 上要加 \`has-card\` 类（色带要溢出卡片边缘）。` : ''}
6. 图槽位：一律先用占位图 ${PLACEHOLDERS.join(' / ')}（按构图比例挑），并给每个图元素加两个属性：
   - \`data-img-prompt="这一格要什么图（中文一句话）"\` —— 真图是下一步按这句话生成后替换进来的，**漏了这个属性那一格就永远配不上图**；
   - \`data-img-mode="concept|case|data"\` —— concept 是概念/框架/阶段/趋势，case 是案例/产品/业务场景，data 是数据/图表。填错的话这一格会用错一路画风模板（出来的图是漂亮的概念插画，而这一页要的是信息图）。${imageSpecBlock(input)}
7. 文案照给定的内容写，不要编数字、不要编客户名。要点可以润色成更适合上屏的短句。
8. **下面那个版式是排版参考，不是模子。** 它的结构、类名、间距节奏照它来，但**重复单元的数量按这一页的真实内容定**：案例里画 3 栏而这一页有 4 块内容，就照同一个单元的结构、同一批类名排 4 栏（**不要**自己发明类名、不要把第 4 块塞进第 3 栏、更不要把它丢掉）；只有 2 块就排 2 栏，不要为了填满案例的格子编内容。单元数量变了就用 inline \`style\` 顺手调宽度/间距（例如 4 栏时把每栏的 flex/width 收窄一点），别让它挤出画面。
   图位那一段（第 6 条）**不受这一条影响**：图位的条数和顺序仍然照给定的规格来（备好的图是按序号贴的）—— 内容块比图位多的时候，多出来那几块就不配图。

## 这一页的内容
所属模块：${input.section || '（无）'}
标题：${input.title}
要点：
${input.points.length ? input.points.map((p) => `- ${p}`).join('\n') : '（没有给要点，按标题自己组织，宁可少写也不要编事实）'}
${input.imageSpecs?.length
      ? `图位（**必须按这个顺序、就这 ${input.imageSpecs.length} 个**）：\n${input.imageSpecs
          .map(
            (s, i) =>
              `${i + 1}. ${s.ratio} / ${s.mode} / data-img-prompt 就写「${s.subject}」`
          )
          .join('\n')}`
      : `建议配图张数：${input.images}`}

## 版式（**排版参考**：结构和类名照它，单元数量按上面第 8 条按内容定）
${layout.buildText}

## 配色与排版 token
${lib.designTokens}
${designPromptBlock(input.design || DEFAULT_DESIGN)}
${notesBlock(input)}`;
}
