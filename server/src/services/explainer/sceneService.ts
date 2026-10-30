import { createRequire } from 'module';
import { jsonGateway, jsonFailMessage } from '../../core/llm/parseJson.js';
import { ExplainerError, STYLE_NAMES, type Script } from './scriptService.js';
import { LAYOUTS, BEATS, LAYOUT_NAMES, ROLE_NAMES } from './vocab.js';

// 代码动画视频的第二步：确认过的剧本 → 场景 JSON（前端 components/explainer/scene.ts 的 Scene）。
// **AI 只决定每镜画哪几样东西（图标 / 文字 / 清单）、谁指向谁**；标题、注释、秒数从剧本原样抄过去 ——
// 让 AI 重写的话他刚在剧本里改过的字会被悄悄改回去。图标名只认 iconCatalog.json 里的，编的名字换成文字并说出来。

const require = createRequire(import.meta.url);
const CATALOG: { id: string; tags: string[] }[] = require('./iconCatalog.json');
const MAX_TOKENS = 6000;
const MAX_ITEMS = 6, LABEL_MAX = 10, LIST_MAX = 4, LIST_ITEM_MAX = 14, TEXT_MAX = 16;

export type Item =
  | { id: string; type: 'icon'; icon: string; label?: string; accent?: boolean }
  | { id: string; type: 'text'; text: string; accent?: boolean }
  | { id: string; type: 'list'; items: string[] }
  | ({ id: string; type: 'diagram'; label?: string; accent?: boolean } & Diagram);
/** 参数化图示，形状和前端 components/explainer/diagrams.ts 的 Diagram 一致 */
export type Diagram =
  | { kind: 'dots'; count: number; groups?: number[]; highlight?: number }
  | { kind: 'tenframe'; filled: number; highlight?: number }
  | { kind: 'equation'; text: string }
  | { kind: 'shape'; shape: 'circle' | 'box' | 'triangle'; text?: string }
  | { kind: 'numberline'; from: number; to: number; marks?: number[]; jumps?: { from: number; to: number }[] };
export interface Arrow { from: string; to: string; label?: string; dashed?: boolean }
export { LAYOUTS, BEATS };
export interface Beat { do: (typeof BEATS)[number]; target: string }
/** 和前端 scene.ts 的 Shot 一致（layout / beats 的含义见那边的注释） */
export interface SceneShot { seconds: number; heading?: string; items: Item[]; arrows?: Arrow[]; note?: string; layout?: (typeof LAYOUTS)[number]; beats?: Beat[] }
export interface Scene { version: 1; title: string; duration: number; shots: SceneShot[] }

/** 图标名 → 清单里的 id：认 id（不分大小写）和中文关键词 */
export function resolveIcon(name: string): string | null {
  const k = name.trim(), lower = k.toLowerCase();
  return (CATALOG.find((c) => c.id.toLowerCase() === lower) || CATALOG.find((c) => c.tags.includes(k)))?.id ?? null;
}

function systemPrompt(script: Script) {
  const catalog = CATALOG.map((c) => `${c.id}（${c.tags.join('、')}）`).join('；');
  return [
    `你在把一份「${STYLE_NAMES[script.style]}」风格讲解视频的剧本，逐镜翻译成画面元素。画面由程序按网格自动排版、一笔一笔画出来，你不用管位置和时间。`,
    '',
    '每一镜给出：',
    `- items：这一镜要画的东西，1–${MAX_ITEMS} 个，按从左到右的顺序。每个是下面三种之一：`,
    `  · {"id":"a","type":"icon","icon":"图标名","label":"图标下面的字（不超过 ${LABEL_MAX} 字，可省略）","accent":false}`,
    `  · {"id":"b","type":"text","text":"一句大字（不超过 ${TEXT_MAX} 字）","accent":false}`,
    `  · {"id":"c","type":"list","items":["清单第一条（不超过 ${LIST_ITEM_MAX} 字）","…"]}（最多 ${LIST_MAX} 条）`,
    `  · 图示 {"id":"d","type":"diagram","kind":"…","label":"图示下面的字（可省略）","accent":false}，kind 和参数：`,
    `      dots 圆点组："count":5（1–20），"groups":[2,3]（可省略：分成几堆，加起来等于 count，堆之间画虚线），"highlight":2（可省略：前几个用强调色）`,
    `      tenframe 十格框（2 行 5 格）："filled":10（填了几格，0–10），"highlight":2（可省略：最后填的几格用强调色）`,
    `      equation 算式（大字）："text":"8 + 2 = 10"（不超过 16 个字符，只用数字、+ - × ÷ = ? 和括号）`,
    `      shape 形状："shape":"circle" | "box" | "triangle"，"text":"形状里写的字（不超过 8 字，可省略）"`,
    `      numberline 数轴："from":0,"to":15（整数，跨度不超过 20），"marks":[8,13]（可省略：标出的点），"jumps":[{"from":8,"to":10}]（可省略：跳跃弧线，最多 4 个）`,
    '- arrows：可选，元素之间的指向关系 {"from":"a","to":"b","label":"箭头上的字（可省略，不超过 6 字）","dashed":false}，from/to 必须是本镜 items 里的 id。',
    '- layout：这一镜怎么摆（按内容选，相邻两镜尽量不同）：',
    '    hero 第一个元素放大当主角，其余小的排在右边（介绍一个东西、引出主角）',
    '    reveal 第一个元素特大居中，其余排在下面（揭示一个数字、结论、答案）',
    '    compare 左右两栏、中间虚线，前一半元素在左、后一半在右（对比：以前/现在、错/对、A/B）',
    '    flow 一排从左到右自动连箭头（步骤、流程、因果链）',
    '    hub 第一个在中间，其余围成一圈连线（一个概念的几个方面、组成部分）',
    '    timeline 一条横线，元素按顺序上下交替挂在线上（年代、阶段、先后）',
    '    grid 平均分格（并列的几样东西，别的都不合适时才用）',
    '- beats：可选，元素都画完之后的讲解动作，按顺序做，每镜 0–3 个，写成 [{"do":"circle","target":"a"}]（do 是下面的动作名，target 是本镜 items 里的 id）：',
    '    circle 圈出来 / underline 划下划线 / cross 打叉（错的、被否定的）/ check 打勾（对的、答案）/ box 框住 / zoom 镜头推近（这一镜最关键的那个，整条视频用 2–3 次就够）',
    '  讲解动作是让画面「活起来」的关键：每一镜最重要的那个元素，大多应该被圈出来、划线、打勾或推近。',
    '',
    '规则：',
    '- 照着剧本里这一镜的「要画的元素」和「画面怎么呈现」来选，不要加剧本里没有的东西，不要编数字。',
    '- 能画成图的尽量画成图：数量用圆点组 / 十格框，计算过程用算式，顺序和距离用数轴，概念框用形状，具体的东西用图标。',
    '- icon 只能从下面的图标库里选（写括号前面的英文 id）。图标库和图示都画不了的，才用 text 或 list，不要编图标名。',
    '- 图示里的数量和算式必须和剧本一致，不要自己编新数字。',
    '- 每镜最多一个 accent: true（这一镜最要强调的那个）。',
    '- 不要重复这一镜的标题和注释（程序会自己写上去）。',
    '',
    `图标库：${catalog}`,
    '',
    '只返回一个 JSON 对象：{"shots":[{"layout":"hero","items":[…],"arrows":[…],"beats":[{"do":"circle","target":"a"}]}]}，shots 的数量和顺序必须和剧本的镜头一一对应。',
  ].join('\n');
}

/** 一组镜头的提示：整条的标题列表给上下文，只要这一组（from..to）的画面 */
function userPrompt(script: Script, from: number, to: number) {
  const outline = script.shots.map((s, i) => `${i + 1}. ${s.heading}`).join('\n');
  const detail = script.shots.slice(from, to).map((s, k) => {
    const i = from + k;
    return `第 ${i + 1} 镜${s.role ? `（${ROLE_NAMES[s.role]}）` : ''}\n  版式：${s.layout ? `${s.layout}（${LAYOUT_NAMES[s.layout]}，剧本已定，照这个版式排 items 的顺序）` : '剧本没定，你来选'}\n  标题：${s.heading}\n  画面怎么呈现：${s.visual || '（没写）'}\n  要画的元素：${s.elements.join('、') || '（没写）'}\n  注释：${s.note || '（无）'}`;
  });
  return [`视频标题：${script.title}`, `一句话：${script.summary}`, '', `整条的镜头（只给你看上下文）：\n${outline}`, '', `这次只要第 ${from + 1}–${to} 镜的画面，shots 里按顺序正好 ${to - from} 个：`, ...detail].join('\n');
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
function cut(s: string, max: number, what: string, notes: string[]) {
  const c = [...s];
  if (c.length <= max) return s;
  notes.push(`${what}超过 ${max} 字，截成了「${c.slice(0, max).join('')}」`);
  return c.slice(0, max).join('');
}

const int = (v: unknown) => (Number.isInteger(Number(v)) && v !== '' && v !== null ? Number(v) : null);

/**
 * 算式按代码算一遍：「a 运算 b … = c」两边都算得出来却不相等就报出来（不改它，画面上照写）。
 * 模型写 8 + 2 = 11 的话读起来完全正常、画面也画得出来，没人会逐个去核。
 */
export function checkEquation(text: string): string | null {
  const parts = text.replace(/×/g, '*').replace(/÷/g, '/').replace(/[−–]/g, '-').split('=');
  if (parts.length < 2) return null;
  const vals = parts.map((p) => (/^[\d\s.+\-*/()]+$/.test(p.trim()) && /\d/.test(p) ? Number(Function(`"use strict";return (${p})`)()) : null));
  const known = vals.filter((v): v is number => v !== null && Number.isFinite(v));
  if (known.length < 2) return null;
  return known.every((v) => Math.abs(v - known[0]) < 1e-9) ? null : `算式「${text}」两边算出来不相等，可能写错了`;
}

/** 图示参数核一遍：超范围的改成文字（返回 null）并说明；能修的（分组对不上、高亮超了）修掉并说明 */
function readDiagram(it: any, at: string, notes: string[]): Diagram | null {
  const kind = str(it?.kind);
  if (kind === 'dots') {
    const count = int(it.count);
    if (count === null || count < 1 || count > 20) { notes.push(`${at}圆点组的数量「${it.count}」不在 1–20 之间，改成了文字`); return null; }
    const d: Diagram = { kind, count };
    const groups = Array.isArray(it.groups) ? it.groups.map(int) : null;
    if (groups?.length) {
      if (groups.every((g: number | null) => g !== null && g > 0) && groups.reduce((a: number, b: number) => a + b, 0) === count) d.groups = groups as number[];
      else notes.push(`${at}圆点分组 [${it.groups}] 加起来不等于 ${count}，没有分组`);
    }
    const hl = int(it.highlight);
    if (hl !== null && hl > 0) d.highlight = Math.min(hl, count);
    return d;
  }
  if (kind === 'tenframe') {
    const filled = int(it.filled);
    if (filled === null || filled < 0 || filled > 10) { notes.push(`${at}十格框填了「${it.filled}」格，不在 0–10 之间，改成了文字`); return null; }
    const hl = int(it.highlight);
    return { kind, filled, ...(hl !== null && hl > 0 ? { highlight: Math.min(hl, filled) } : {}) };
  }
  if (kind === 'equation') {
    const text = str(it.text);
    if (!text || [...text].length > 16) { notes.push(`${at}算式「${text}」是空的或超过 16 个字符，改成了文字`); return null; }
    const wrong = checkEquation(text);
    if (wrong) notes.push(`${at}${wrong}`);
    return { kind, text };
  }
  if (kind === 'shape') {
    const shape = ['circle', 'box', 'triangle'].includes(it.shape) ? it.shape : 'box';
    if (shape !== it.shape) notes.push(`${at}形状「${it.shape}」不认识，画成了方框`);
    const text = cut(str(it.text), 8, `${at}形状里的字`, notes);
    return { kind, shape, ...(text ? { text } : {}) };
  }
  if (kind === 'numberline') {
    const from = int(it.from), to = int(it.to);
    if (from === null || to === null || to <= from || to - from > 20) { notes.push(`${at}数轴范围「${it.from}–${it.to}」不对（要是整数、跨度 1–20），改成了文字`); return null; }
    const inRange = (v: number | null): v is number => v !== null && v >= from && v <= to;
    const marks = (Array.isArray(it.marks) ? it.marks.map(int) : []).filter(inRange);
    const jumps = (Array.isArray(it.jumps) ? it.jumps : []).map((j: any) => ({ from: int(j?.from), to: int(j?.to) })).filter((j: any) => inRange(j.from) && inRange(j.to) && j.from !== j.to).slice(0, 4);
    return { kind, from, to, ...(marks.length ? { marks } : {}), ...(jumps.length ? { jumps } : {}) };
  }
  notes.push(`${at}有一个图示类型「${kind}」不认识，改成了文字`);
  return null;
}

/** 模型回的每镜元素 → 规整的场景。编的图标名、指错的箭头、超长的字、少回的镜头一律进 notes，不悄悄丢。 */
export function buildScene(raw: any, script: Script): { scene: Scene; notes: string[] } {
  const notes: string[] = [];
  const got = Array.isArray(raw?.shots) ? raw.shots : [];
  if (got.length !== script.shots.length) notes.push(`AI 回了 ${got.length} 镜的画面，剧本是 ${script.shots.length} 镜${got.length < script.shots.length ? '：缺的那几镜直接把「要画的元素」写成文字' : '：多出来的丢掉了'}`);
  const shots: SceneShot[] = script.shots.map((s, i) => {
    const at = `第 ${i + 1} 镜`;
    const r = got[i];
    const items: Item[] = [];
    const ids = new Set<string>();
    const rawItems = Array.isArray(r?.items) ? r.items : [];
    if (rawItems.length > MAX_ITEMS) notes.push(`${at} AI 给了 ${rawItems.length} 个元素，只保留前 ${MAX_ITEMS} 个`);
    let accents = 0;
    for (const [k, it] of rawItems.slice(0, MAX_ITEMS).entries()) {
      let id = str(it?.id) || `i${k}`;
      if (ids.has(id)) id = `${id}_${k}`;
      ids.add(id);
      const accent = it?.accent === true && accents++ === 0;
      if (it?.type === 'icon') {
        const name = str(it.icon), label = cut(str(it.label), LABEL_MAX, `${at}「${str(it.label)}」`, notes);
        const icon = resolveIcon(name);
        if (icon) items.push({ id, type: 'icon', icon, ...(label ? { label } : {}), accent });
        else {
          notes.push(`${at}的图标「${name}」图标库里没有，改成了文字「${label || name}」`);
          items.push({ id, type: 'text', text: cut(label || name, TEXT_MAX, `${at}文字`, notes), accent });
        }
      } else if (it?.type === 'diagram') {
        const label = cut(str(it.label), LABEL_MAX, `${at}「${str(it.label)}」`, notes);
        const d = readDiagram(it, at, notes);
        if (d) items.push({ id, type: 'diagram', ...d, ...(label ? { label } : {}), accent });
        else items.push({ id, type: 'text', text: cut(label || str(it.text) || str(it.kind) || '图示', TEXT_MAX, `${at}文字`, notes), accent });
      } else if (it?.type === 'list') {
        const list = (Array.isArray(it.items) ? it.items : []).map(str).filter(Boolean);
        if (list.length > LIST_MAX) notes.push(`${at}清单有 ${list.length} 条，只保留前 ${LIST_MAX} 条`);
        if (list.length) items.push({ id, type: 'list', items: list.slice(0, LIST_MAX).map((x: string, j: number) => cut(x, LIST_ITEM_MAX, `${at}清单第 ${j + 1} 条`, notes)) });
      } else {
        const text = str(it?.text);
        if (text) items.push({ id, type: 'text', text: cut(text, TEXT_MAX, `${at}文字`, notes), accent });
      }
    }
    // AI 这一镜没回 / 回空了：剧本里写的元素照样上屏（写成文字），不让这一镜只剩一个标题
    if (!items.length && s.elements.length) {
      if (r) notes.push(`${at} AI 没给出画面元素，把剧本里的「${s.elements.join('、')}」直接写成了文字`);
      s.elements.slice(0, MAX_ITEMS).forEach((e, k) => { const icon = resolveIcon(e); items.push(icon ? { id: `e${k}`, type: 'icon', icon, label: e } : { id: `e${k}`, type: 'text', text: e }); });
    }
    // 一个图形都没画出来（全是文字 / 清单）：画面照样「有东西」，不说的话他以为引擎就是这样画的
    if (s.elements.length && items.length && !items.some((x) => x.type === 'icon' || x.type === 'diagram')) {
      notes.push(`${at}没有画出任何图形：「${s.elements.join('、')}」在图标库和图示里都没有合适的，只写成了文字`);
    }
    const arrows: Arrow[] = [];
    // 版式剧本里定了就用剧本的（他可能在剧本页改过），没定才用 AI 这次挑的
    const layoutRaw = str(r?.layout);
    const aiLayout = (LAYOUTS as readonly string[]).includes(layoutRaw) ? (layoutRaw as SceneShot['layout']) : undefined;
    if (!s.layout && layoutRaw && !aiLayout) notes.push(`${at}的版式「${layoutRaw}」不认识，按平均分格摆`);
    const layout = s.layout ?? aiLayout;
    const beats: Beat[] = [];
    for (const b of (Array.isArray(r?.beats) ? r.beats : []).slice(0, 4)) {
      // 字段名认几个常见写法：模型没照示例写 do 的时候（实测写成别的键），整条视频的讲解动作全丢、画面又变回静止的
      const kind = str(b?.do ?? b?.type ?? b?.action ?? b?.kind).toLowerCase(), target = str(b?.target ?? b?.id ?? b?.item);
      if (!(BEATS as readonly string[]).includes(kind)) {
        notes.push(kind ? `${at}的讲解动作「${kind}」不认识，没做` : `${at}有一个讲解动作没写是哪种动作（AI 回的是 ${JSON.stringify(b).slice(0, 60)}），没做`);
        continue;
      }
      if (!ids.has(target)) { notes.push(`${at}的讲解动作「${kind}」对着一个不存在的元素（${target || '?'}），没做`); continue; }
      beats.push({ do: kind as Beat['do'], target });
    }
    for (const a of Array.isArray(r?.arrows) ? r.arrows : []) {
      const from = str(a?.from), to = str(a?.to);
      if (!ids.has(from) || !ids.has(to) || from === to) { notes.push(`${at}有一个箭头指向不存在的元素（${from || '?'} → ${to || '?'}），去掉了`); continue }
      const label = cut(str(a?.label), 6, `${at}箭头上的字`, notes);
      arrows.push({ from, to, ...(label ? { label } : {}), ...(a?.dashed === true ? { dashed: true } : {}) });
    }
    return { seconds: s.seconds, ...(s.heading ? { heading: s.heading } : {}), items, ...(arrows.length ? { arrows } : {}), ...(s.note ? { note: s.note } : {}), ...(layout ? { layout } : {}), ...(beats.length ? { beats } : {}) };
  });
  return { scene: { version: 1, title: script.title, duration: script.duration, shots }, notes };
}

/** 一次最多让 AI 写几镜的画面：3 分钟 ≈ 30 镜，一次写完的话 JSON 很长、容易被 max_tokens 截断（截断 = 整次作废） */
const GROUP = 8;

export async function writeScene(input: { script: Script; userId: string }) {
  const { script } = input;
  const n = script.shots.length;
  const groups: [number, number][] = [];
  for (let i = 0; i < n; i += GROUP) groups.push([i, Math.min(n, i + GROUP)]);
  // 分组并行；只有第一组扣日额度（他点一次扣一次），售卖型 key 按网关规则每组 1 点（calls 回给页面说清楚）
  const results = await Promise.all(groups.map(([from, to], g) => jsonGateway<any>(
    () => ({
      temperature: 0.3,
      max_tokens: MAX_TOKENS,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: systemPrompt(script) }, { role: 'user', content: userPrompt(script, from, to) }],
    }),
    {
      userId: input.userId,
      source: 'explainer',
      operation: 'explainer:scene',
      tier: 'strong',
      noThinking: true,
      timeoutMs: 180_000,
      maxRetries: 0,
      retryOnBusy: true,
      unmetered: g > 0,
      requestSummary: `画面 · ${STYLE_NAMES[script.style]} · 第 ${from + 1}–${to} 镜 / ${n} · ${script.title}`,
    },
  ).catch((e: any) => ({ parsed: null, raw: '', error: e as Error } as any))));
  const failed = results.map((r, g) => (r.parsed ? -1 : g)).filter((g) => g >= 0);
  if (failed.length === groups.length) {
    const r = results[0];
    if (r.error) throw r.error;
    throw new ExplainerError(jsonFailMessage('画面', { raw: r.raw, finish: r.finish, reasoningTokens: r.reasoningTokens, budget: MAX_TOKENS, noThinkingRequested: r.noThinkingRequested }), 502);
  }
  // 拼回整条：失败那一组的位置留空，buildScene 会用剧本里写的元素顶上
  const merged: any[] = [];
  const pre: string[] = [];
  groups.forEach(([from, to], g) => {
    const got = Array.isArray(results[g].parsed?.shots) ? results[g].parsed.shots : null;
    if (!got) {
      const why = results[g].error ? (results[g].error as Error).message : jsonFailMessage('这几镜的画面', { raw: results[g].raw, finish: results[g].finish, reasoningTokens: results[g].reasoningTokens, budget: MAX_TOKENS, noThinkingRequested: results[g].noThinkingRequested, unmetered: g > 0 });
      pre.push(`第 ${from + 1}–${to} 镜的画面 AI 没生成出来（${why.slice(0, 120)}），这几镜直接把「要画的元素」写成了文字，可以再点一次重新生成`);
    } else if (got.length !== to - from) pre.push(`第 ${from + 1}–${to} 镜 AI 回了 ${got.length} 镜的画面（应该是 ${to - from} 镜）${got.length < to - from ? '，缺的用剧本里的元素顶上' : '，多的丢掉了'}`);
    for (let i = from; i < to; i++) merged[i] = got ? got[i - from] : undefined;
  });
  const built = buildScene({ shots: merged }, script);
  // buildScene 自己也会比对镜头数；拼过之后数量总是对的，组级别的说明在上面
  return { scene: built.scene, notes: [...pre, ...built.notes], calls: groups.length };
}
