// AI 编辑：他选中这一页里的一块，说一句「这三条改成两列」，模型**只改结构和 inline style**，
// 文案一个字都碰不到。
//
// 「文案一个字都碰不到」不是靠 prompt 说出来的，是靠打码做到的（`maskRegion`）：文字、图片、
// 带中文的属性发出去之前全换成 `@@T1@@` 这种记号，模型手里那段结构里**一个中文都没有**。
// 靠 prompt 拦的话模型会顺手润色一两句、把「及」改成「和」—— 出来是一页读起来完全正常的
// 幻灯片，而他写的那句话变了，界面上没有一处会说。打完码之后「输出里出现中文」就等于
// 「它在自己编文案」，一条正则拦住（`CJK_RE`）。
//
// 回来那一段的校验全在 `validateEditedRegion`：每一条拦的都是「页面照样渲染、读起来正常」
// 的失败 —— 少一个记号 = 那句文案凭空消失；类名编一个 = 那一块回到默认流式布局；
// 颜色写死 = 换肤那天它不跟着变；`data-eid` 少一个 = 那一块从此双击改不动。

import { jsonGateway, jsonFailMessage } from '../../core/llm/parseJson.js';
import { templateClasses, templateVars } from './deckShell.js';
import {
  findRegionByPath, maskRegion, unmaskRegion, eidsIn, domTree, CJK_RE, PageEditError,
} from './pageEdit.js';
import { checkRegionGuards, classesIn } from './regionGuards.js';

/** 一块结构 1-2KB，剩下的是留给思维链的空间（硬规则 2）。`noThinking` 也一起发。 */
const MAX_EDIT_TOKENS = 6000;

/** 他那句要求的上限。太长的那种其实是「重写这一页」，该走重新生成（那一步才有版式和要点）。 */
export const MAX_INSTRUCTION = 400;

export interface AiEditInput {
  /** 库里那一整页（`<section>`），改完的整页原样返回 */
  html: string;
  /** 从 `<section>` 数下来的孩子下标路径（前端 `pathOf` 给的；空数组 = 整页） */
  path: number[];
  /** 前端认为这一块里有哪几段文字 —— 用来核「他框住的和这边算出来的是同一块」 */
  eids: string[];
  instruction: string;
}

export interface AiEditResult {
  html: string;
  /** 改动摘要（模型自己那句 + 代码数出来的那几个数） */
  summary: string;
  region: string;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export async function aiEditRegion(input: AiEditInput, userId: string): Promise<AiEditResult> {
  const instruction = (input.instruction || '').trim();
  if (!instruction) throw new PageEditError('没说要怎么改 —— 写一句（比如「这三条排成两列」）再点。');
  if (instruction.length > MAX_INSTRUCTION) {
    throw new PageEditError(
      `这句要求有 ${instruction.length} 字，上限 ${MAX_INSTRUCTION} 字。这么长的通常是「重写这一页」——` +
        '那个走「重新生成」（那一步才带着版式和要点，AI 编辑只改选中那一块的结构）。'
    );
  }
  const region = findRegionByPath(input.html, input.path);

  // 他框住的那一块和这边按路径算出来的必须是同一块。**不核的话**浏览器修正过结构
  // （`<p>` 里的 `<div>` 会被挪出去）时两边会差一层 —— 于是他框住的是这一块、AI 改的是
  // 隔壁那一块，而返回的摘要和画面都读得通。
  const want = [...input.eids].sort().join(',');
  const got = [...eidsIn(region.html)].sort().join(',');
  if (want !== got) {
    throw new PageEditError(
      '你选中的那一块和库里那一页对不上（这一页在这期间重新生成过，或者在别处改过）。这次没改也没花额度，刷新一下重新选。'
    );
  }

  const { masked, tokens } = maskRegion(region.html);
  if (CJK_RE.test(masked)) {
    // 打码之后还剩中文 = 有一处文案在代码取不出来的地方（某个属性里）。发出去的话
    // 「不许写中文」这条校验就废了（分不出哪句是原文、哪句是模型编的），而它编的那句
    // 读起来完全正常。
    throw new PageEditError(
      '这一块里有一处中文取不出来（写在某个属性里），AI 编辑没法保证不改它，所以这次没发出去。选小一点的那一块，或者走「重新生成」。'
    );
  }

  const allowedClasses = new Set<string>([...templateClasses(), ...classesIn(input.html)]);
  const r = await jsonGateway<{ html?: string; summary?: string }>(
    () => ({
      messages: [{ role: 'user', content: buildPrompt(masked, region.name, instruction) }],
      temperature: 0.3,
      max_tokens: MAX_EDIT_TOKENS,
    }),
    // 不指定 tier、也不发 response_format（和这个模块其余几处一致）：平台渠道可能压根没有
    // strong 那一档，指定它只是让人以为「换成强模型了」。格式靠 prompt + jsonGateway。
    { userId, source: 'ppt', operation: 'ai-edit-region', noThinking: true }
  );
  if (!r.parsed?.html) {
    throw new PageEditError(
      jsonFailMessage('这一块的改动', {
        raw: r.raw,
        finish: r.finish,
        reasoningTokens: r.reasoningTokens,
        budget: MAX_EDIT_TOKENS,
        noThinkingRequested: r.noThinkingRequested,
      })
    );
  }

  const edited = String(r.parsed.html).trim();
  validateEditedRegion(edited, {
    tokens,
    regionName: region.name,
    original: region.html,
    allowedClasses,
    knownVars: templateVars(),
  });

  const restored = unmaskRegion(edited, tokens);
  const html = input.html.slice(0, region.from) + restored + input.html.slice(region.to);
  const said = String(r.parsed.summary || '').trim().replace(/\s+/g, ' ').slice(0, 120);
  // 摘要里那几个数是**代码数出来的**，不是模型说的：模型说「保持了原有文案」这句话是免费的，
  // 而他要确认的恰好是这件事（硬规则 3）。
  return {
    html,
    region: region.name,
    summary:
      `${said || '改了这一块的结构'}（原文 ${tokens.size} 处一字未动，` +
      `${eidsIn(restored).length} 段文字仍可双击编辑）`,
    usage: r.usage,
  };
}

export interface ValidateCtx {
  tokens: Map<string, string>;
  regionName: string;
  original: string;
  allowedClasses: Set<string>;
  knownVars: Set<string>;
}

/**
 * 回来那一段的七条校验。**每一条都是「不拦就悄悄改错东西」**，所以一律抛错、一个字都不写库：
 * 这一步已经花过一次额度，但把一段错的存进去要花的是「他后面照着这一页做完整份」的时间。
 */
export function validateEditedRegion(html: string, ctx: ValidateCtx): void {
  if (!html) throw new PageEditError('模型没回内容，这一块没改。再试一次。');

  // ① 必须还是一整块、外层标签不变。多包一层的话 splice 回去就是「这一块被包进了一个
  //    没有样式的 div」—— 定位类挂在原来那一层上，画面看起来只是「这块位置不对」。
  const roots = domTree(html);
  if (roots.length !== 1 || roots[0].start !== 0 || roots[0].end !== html.length) {
    throw new PageEditError(
      `模型回的不是一整块（数出来 ${roots.length} 个顶层标签，或者有标签没闭合）—— 直接贴回去会把这一页的结构切断。这次没改，再试一次或换一句更具体的要求。`
    );
  }
  if (roots[0].name !== ctx.regionName) {
    throw new PageEditError(
      `模型把最外层从 <${ctx.regionName}> 换成了 <${roots[0].name}>：定位和尺寸挂在原来那一层上，换掉之后这一块会跑到别的位置。这次没改。`
    );
  }

  // ② 记号。少一个 = 那句文案凭空消失（页面照样渲染，只是短了一截）；
  //    多一个 = 同一句话出现两遍；编一个 = 还原不回来，画面上留着 `@@T9@@` 这种字样。
  const seen = new Map<string, number>();
  for (const m of html.matchAll(/@@[A-Z]+\d+@@/g)) seen.set(m[0], (seen.get(m[0]) || 0) + 1);
  const lost = [...ctx.tokens.keys()].filter((k) => !seen.has(k));
  const dup = [...seen].filter(([k, n]) => n > 1 && ctx.tokens.has(k)).map(([k]) => k);
  const made = [...seen.keys()].filter((k) => !ctx.tokens.has(k));
  if (lost.length || dup.length || made.length) {
    const why = [
      lost.length ? `丢了 ${lost.length} 处原文（${lost.slice(0, 3).join(' ')}）` : '',
      dup.length ? `${dup.length} 处原文出现了两遍（${dup.slice(0, 3).join(' ')}）` : '',
      made.length ? `编了 ${made.length} 个不存在的记号（${made.slice(0, 3).join(' ')}）` : '',
    ].filter(Boolean).join('；');
    throw new PageEditError(
      `模型改动了文案本身（${why}）—— 这一块没改。文案要改请双击那句字直接改；这句要求换成只讲排版（比如「这三条排成两列」）再试。`
    );
  }

  // ②b `data-eid`。掉一个的话那段文字还在、样子也对，只是**从此双击改不动**（也不能再用
  //     浮动条改样式），而屏幕上一点异样都没有 —— 他只会以为「这一块本来就不能改」。
  const eidWas = eidsIn(ctx.original).sort().join(',');
  const eidNow = eidsIn(html).sort().join(',');
  if (eidWas !== eidNow) {
    throw new PageEditError(
      '模型动了编辑标记（data-eid）：那几段文字会从此双击改不动，而画面上一点异样都没有。这一块没改，再试一次。'
    );
  }

  // ③ 中文。打完码之后原文一个字都不在里面，所以出现中文 = 它在自己写文案。
  const cjk = html.match(CJK_RE);
  if (cjk) {
    const at = html.indexOf(cjk[0]);
    throw new PageEditError(
      `模型自己写了文案（「${html.slice(at, at + 12)}…」），这一块没改 —— 它写出来的那句话读起来完全正常，所以这里一律拒。`
    );
  }

  // ④⑤⑥ 脚本 / 样式表 / 事件属性 / position:fixed / 编出来的类名 / 写死的颜色 / 不存在的变量名
  //      —— 和自由改造那条路**共用一份**（`regionGuards.ts`，那里写着为什么）。
  checkRegionGuards(html, ctx);
}

function buildPrompt(masked: string, regionName: string, instruction: string): string {
  return `你在调整一页幻灯片里的**一小块** HTML。这一页是 1920×1080 的固定坐标系。

【这一块现在是这样】
${masked}

【他要你做的】
${instruction}

【硬规则，违反任何一条这次改动都会被整段丢掉】
1. \`@@T1@@\` \`@@IMG1@@\` \`@@A1@@\` 这种记号是被挡住的文案和图片。**每一个都必须恰好出现一次**，
   不能删、不能重复、不能改写、不能翻译。你可以挪动它们的位置。
2. **不许写任何中文。** 文案不是你的活（他要改文案会自己去改那句字）。
3. 类名只能用这一块里已经出现过的那些。要新样式就写 inline style（\`style="…"\`）。
4. 颜色只能用 \`var(--c-…)\` 这种变量（用这一块里已经出现过的那几个），**不许写 #hex / rgb()**
   —— 阴影和蒙版那种半透明黑白除外（\`rgba(0,0,0,.08)\` 可以）。
5. 不许写 \`<script>\` / \`<style>\` / \`onclick\` 这类事件属性，不许用 \`position:fixed\`。
6. \`data-eid="…"\` 属性原样留在它现在所在的那个元素上：一个都不能删、不能改、不能新增。
7. 只回这一块，最外层还是 \`<${regionName}>\`，不要多包一层、不要回整页。

【只回这个 JSON，不要别的字】
{"html":"改完的这一块（一整段 HTML，写成一行，不要换行）","summary":"一句话说你改了什么"}`;
}
