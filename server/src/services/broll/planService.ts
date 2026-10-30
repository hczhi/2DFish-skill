import { SAMPLING } from '../../core/llm/gateway.js';
import { jsonGateway, jsonFailMessage } from '../../core/llm/parseJson.js';
import { TEMPLATE_SPECS, CATEGORIES, specById, MANUAL_ONLY, type TemplateSpec, type FieldSpec } from './templateSpecs.js';

// 口播动效卡 · AI 配卡：前端把解析好的字幕（编号 + 原文）发过来，模型从**已上线**的模版里挑卡、填字段。
// **时间不进 prompt、也不从模型拿** —— 模型只回字幕编号（跨几句的卡回起止两句），入点出点由前端按字幕时间算；
// 章节编号也由代码按出现顺序编（硬规则 3）。上屏的字由 checkCards 按 templateSpecs 的规则逐张核对，
// 核不过的整张拦下并说原因：模型编一个原话里没有的数字 / 清单条目，卡片照样很好看，没人看得出来。

export const MAX_LINES = 800;
export const MAX_CHARS = 30_000;
const MAX_TOKENS = 8000;
/** 一张卡最多跨几句字幕 */
const MAX_SPAN = 8;

export class BrollError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export interface PlanLine { id: number; text: string }
export interface PlannedCard {
  template: string;
  line: number;
  endLine: number;
  data: Record<string, any>;
  /** 这些字段是 AI 概括的（不是原话），编辑面板要标出来 */
  summarized: string[];
}
export interface RejectedCard { line: number | null; template: string; text: string; why: string }

// 前缀不是原话里的字（「涨了 300%」上屏写「+300%」），所以只放这几个符号，别的一律拦
const PREFIXES = new Set(['', '+', '-', '¥', '$', '约', '超', '近']);

const half = (s: string) =>
  s.replace(/[０-９．]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/％/g, '%').replace(/(\d),(?=\d{3})/g, '$1');
const CN_D: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const CN_U: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };
/** 「三百」「一千二百八十」「两万」「三点五」「十二」→ 数字；不是合法中文数字返回 null */
export function cnToNumber(raw: string): number | null {
  const [intPart, decPart] = raw.split('点');
  const parseSection = (s: string) => {
    let total = 0, digit = -1
    for (const ch of s) {
      if (ch in CN_D) digit = CN_D[ch]
      else if (ch in CN_U) { total += (digit < 0 ? 1 : digit) * CN_U[ch]; digit = -1 }
      else return NaN
    }
    return total + (digit > 0 ? digit : 0)
  };
  let n = 0, rest = intPart;
  for (const [u, mul] of [['亿', 1e8], ['万', 1e4]] as const) {
    const k = rest.indexOf(u);
    if (k >= 0) { n += (k === 0 ? 1 : parseSection(rest.slice(0, k))) * mul; rest = rest.slice(k + 1) }
  }
  if (rest) n += parseSection(rest);
  if (!Number.isFinite(n) || !intPart) return null;
  if (decPart !== undefined) {
    if (!decPart || [...decPart].some((c) => !(c in CN_D))) return null;
    return Number(`${n}.${[...decPart].map((c) => CN_D[c]).join('')}`);
  }
  return n;
}
const CN_NUM = /[零〇一二两三四五六七八九十百千万亿]+(?:点[零〇一二三四五六七八九]+)?/g;
// 句子里的数按整个数比，不按子串：「300」是「3000」的子串，按子串核的话模型少写一个 0 照样放行。
// 中文数字也换算进来（「涨了三百」可以配 300）；「百分之四十」「四成」算 40（占比）
const numbersIn = (s: string) => {
  const t = half(s);
  const out = t.match(/\d+(?:\.\d+)?/g) || ([] as string[]);
  for (const m of t.match(CN_NUM) || []) {
    const v = cnToNumber(m);
    if (v !== null) out.push(String(v));
  }
  for (const m of t.matchAll(/([零一二两三四五六七八九十])成/g)) { const v = cnToNumber(m[1]); if (v !== null) out.push(String(v * 10)) }
  return out;
};
// 核对文字用：去掉空白和标点
const norm = (s: string) =>
  half(s)
    .replace(/[\s，。、！？；：“”‘’（）《》「」…—,.!?;:'"()\-]/g, '')
    .toLowerCase();

const CN_DIGITS: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
/** 「第三招」「第 2 步」「第十个」里的序号；没有返回 null */
export function ordinalIn(text: string): number | null {
  const m = half(text).match(/第\s*(\d{1,2}|[一二两三四五六七八九十]{1,2})\s*[招步个点条章部分类种]/);
  if (!m) return null;
  if (/^\d+$/.test(m[1])) return Number(m[1]);
  const [a, b] = [...m[1]];
  if (!b) return CN_DIGITS[a] ?? null;
  // 十一..十九 / 二十
  return a === '十' ? 10 + (CN_DIGITS[b] ?? 0) : b === '十' ? (CN_DIGITS[a] ?? 0) * 10 : null;
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
const LABEL_RE = /^[A-Z0-9][A-Z0-9 &'-]{0,27}$/;

// own = 本段原文（找数用），ownN / near = 去标点后的本段 / 本段加前后各一句（核文字用）
interface Window { own: string; ownN: string; near: string }

/** 核一个字段。带 error = 整张卡拦下的原因。 */
function checkField(f: FieldSpec, raw: unknown, w: Window): { value: any; error?: string; summarized?: boolean } {
  if (f.rule === 'pairs') {
    const items = (Array.isArray(raw) ? raw : []).map(str).filter(Boolean);
    if (items.length < (f.minItems ?? 1)) return { value: items, error: `${f.key} 只有 ${items.length} 项，至少要 ${f.minItems} 项` };
    if (items.length > (f.maxItems ?? 99)) return { value: items, error: `${f.key} 有 ${items.length} 项，最多 ${f.maxItems} 项` };
    const have = numbersIn(w.own);
    for (const it of items) {
      const m = half(it).match(/^(.*?)\s*([\d.]+)$/);
      if (!m) return { value: items, error: `「${it}」不是「名字 数值」的格式` };
      if (!w.near.includes(norm(m[1]))) return { value: items, error: `「${m[1]}」不是原话里的字` };
      if (!have.includes(m[2])) return { value: items, error: `原话里没有「${m[2]}」这个数` };
    }
    // 统一成「名字 数值」（中间一个空格），前端按最后一个空格拆
    return { value: items.map((it) => half(it).replace(/^(.*?)\s*([\d.]+)$/, '$1 $2')) };
  }
  if (f.rule === 'list') {
    const items = (Array.isArray(raw) ? raw : []).map(str).filter(Boolean);
    if ((f.minItems ?? 1) === 0 && !items.length) return { value: [] };
    if (items.length < (f.minItems ?? 1)) return { value: items, error: `${f.key} 只有 ${items.length} 条，至少要 ${f.minItems} 条` };
    if (items.length > (f.maxItems ?? 99)) return { value: items, error: `${f.key} 有 ${items.length} 条，最多 ${f.maxItems} 条` };
    const bad = items.find((it) => !w.near.includes(norm(f.stripPrefix ? it.replace(f.stripPrefix, '') : it)));
    if (bad) return { value: items, error: `「${bad}」不是原话里的字` };
    return { value: f.asItems ? items.map((name) => ({ img: '', name })) : items };
  }
  // 选项字段模型常常写成数组（["follow"]），收成逗号串再核；不收的话报「没填」，指错方向
  const v = f.rule === 'label' ? str(raw).toUpperCase() : f.rule === 'enum' && Array.isArray(raw) ? raw.map(str).join(',') : str(raw);
  if (!v) return f.optional || f.rule === 'prefix' ? { value: '' } : { value: '', error: `没填 ${f.key}` };
  switch (f.rule) {
    case 'number':
    case 'percent': {
      if (!/^\d+(\.\d+)?$/.test(half(v))) return { value: v, error: `「${v}」不是一个数字` };
      if (!numbersIn(w.own).includes(half(v))) return { value: v, error: `原话里没有「${v}」这个数` };
      if (f.rule === 'percent' && Number(half(v)) > 100) return { value: v, error: `占比 ${v} 超过 100` };
      return { value: v };
    }
    case 'unit':
      return w.ownN.includes(norm(v)) || (half(v) === '%' && (w.ownN.includes('百分之') || /[一二两三四五六七八九十]成/.test(w.ownN)))
        ? { value: half(v) }
        : { value: v, error: `原话里没有单位「${v}」` };
    case 'prefix':
      return PREFIXES.has(v) ? { value: v } : { value: v, error: `前缀「${v}」不在允许的符号里` };
    case 'verbatim':
      return w.near.includes(norm(v)) ? { value: v } : { value: v, error: `「${v}」不是原话里的字` };
    case 'summary':
      return [...v].length > (f.maxLen ?? 20)
        ? { value: v, error: `${f.key}「${v}」超过 ${f.maxLen} 字` }
        : { value: v, summarized: true };
    case 'label':
      // 小标签是装饰，格式不对不值得拦整张卡 —— 清空并在 notes 里说一句
      return LABEL_RE.test(v) ? { value: v, summarized: true } : { value: '', error: undefined };
    case 'enum':
      return f.options?.includes(v) ? { value: v } : { value: v, error: `${f.key} 只能是 ${f.options?.join(' / ')}` };
  }
}

export function checkCards(
  raw: unknown,
  lines: PlanLine[],
  allowed: string[],
): { cards: PlannedCard[]; rejected: RejectedCard[]; notes: string[] } {
  const byId = new Map(lines.map((l, i) => [l.id, i]));
  const cards: PlannedCard[] = [];
  const rejected: RejectedCard[] = [];
  const notes: string[] = [];
  const used = new Set<number>();

  for (const c of Array.isArray(raw) ? (raw as any[]) : []) {
    const tplId = str(c?.template);
    const spec = specById(tplId);
    const startId = Number(c?.line);
    const start = byId.get(startId);
    const shown = spec ? spec.fields.map((f) => (Array.isArray(c?.[f.key]) ? c[f.key].join('/') : str(c?.[f.key]))).filter(Boolean).join(' · ') : JSON.stringify(c).slice(0, 80);
    const reject = (why: string) => rejected.push({ line: start === undefined ? null : startId, template: spec?.name || tplId, text: shown, why });

    if (!spec || !allowed.includes(tplId)) { reject(`模版「${tplId}」不存在或没上线`); continue; }
    if (start === undefined) { reject(`字幕编号「${str(c?.line)}」不存在`); continue; }
    // 只有跨句的模版认 endLine；单句的一律按本句算，模型给了也不认
    const endId = spec.multiLine && c?.endLine != null ? Number(c.endLine) : startId;
    const end = byId.get(endId);
    if (end === undefined || end < start) { reject(`结束句编号「${str(c?.endLine)}」不对`); continue; }
    if (end - start + 1 > MAX_SPAN) { reject(`跨了 ${end - start + 1} 句字幕，最多 ${MAX_SPAN} 句`); continue; }
    const span = Array.from({ length: end - start + 1 }, (_, k) => start + k);
    if (span.some((i) => used.has(i))) { reject('和前面一张卡用的字幕重叠了'); continue; }

    // 数字 / 单位必须在本段（否则卡片出现的时间对不上那个数）；文字允许摘自前后各一句（一句话常被字幕切成两行）
    const own = lines.slice(start, end + 1).map((l) => l.text).join('')
    const w: Window = {
      own,
      ownN: norm(own),
      near: norm(lines.slice(Math.max(0, start - 1), end + 2).map((l) => l.text).join('')),
    };
    const data: Record<string, any> = {};
    const summarized: string[] = [];
    let error = '';
    for (const f of spec.fields) {
      const r = checkField(f, c?.[f.key], w);
      if (r.error) { error = r.error; break; }
      if (f.rule === 'label' && str(c?.[f.key]) && !r.value) notes.push(`${spec.name}（第 ${startId} 句）：英文小标签「${str(c[f.key])}」格式不对，已清空`);
      data[f.key] = r.value;
      if (r.summarized && r.value) summarized.push(f.key);
    }
    if (error) { reject(error); continue; }
    if (tplId === 'pictogram' && (Number(data.total) > 100 || Number(data.value) > Number(data.total))) {
      reject(`象形图总数 ${data.total}、点亮 ${data.value} 画不出来（总数要 ≤ 100，点亮不能比总数多）`);
      continue;
    }
    // 选中项对不上任何候选的话卡片照样画、只是没有一个被选中 —— 读起来像「还没选」，要拦下
    if (tplId === 'choose') {
      const hit = (data.options as string[]).find((o) => norm(o) === norm(data.pick));
      if (!hit) { reject(`选中的「${data.pick}」不是候选里的任何一个`); continue; }
      // 前端按一字不差认选中项：大小写 / 标点不同的话卡片上一个都没选中，所以换成候选的原文
      data.pick = hit;
    }
    if (tplId === 'chapter' && data.highlight && !data.title.includes(data.highlight)) {
      notes.push(`章节标题「${data.title}」：高亮词「${data.highlight}」不在标题里，已去掉高亮`);
      data.highlight = '';
    }

    // 图片 AI 填不了：放上去的图片组每一格都是「待上传」，要说出来，不然像是 AI 配好了一张能直接用的卡
    if (spec.fields.some((f) => f.asItems)) notes.push(`${spec.name}（第 ${startId} 句）：AI 只填了名字，图片要你自己上传`);
    span.forEach((i) => used.add(i));
    cards.push({ template: tplId, line: startId, endLine: endId, data, summarized });
  }

  // 章节编号由代码编，不让模型编：原话里说了「第三招」就用 3（按出现顺序数的话，第二招被配成别的卡时
  // 「第三招」上会显示 02 —— 读起来完全正常）。整条里只要有一张是原话说了序号的，没说序号的那几张就**不编号**
  // （「最后的绝招」编成 06 是在替他说话）；整条都没说序号时才按出现顺序 01、02 编。
  cards.sort((a, b) => byId.get(a.line)! - byId.get(b.line)!);
  // 章节标题、标题降格成标签各自一套编号
  for (const tpl of ['chapter', 'titledemote']) {
    const chapters = cards.filter((c) => c.template === tpl);
    const said = chapters.map((c) => ordinalIn(lines[byId.get(c.line)!].text));
    const anySaid = said.some((x) => x !== null);
    chapters.forEach((c, k) => {
      c.data.index = anySaid ? (said[k] !== null ? String(said[k]).padStart(2, '0') : '') : String(k + 1).padStart(2, '0');
    });
  }
  return { cards, rejected, notes };
}

const RULE_TEXT: Record<FieldSpec['rule'], string> = {
  number: '原话数字',
  pairs: '原话「名字 数值」数组',
  percent: '原话百分数',
  unit: '原话单位',
  prefix: '符号',
  verbatim: '原话',
  summary: '可概括',
  label: '英文',
  enum: '选项',
  list: '原话数组',
};

// 卡片张数目标由代码按句数算（平均每 3–5 句一张）。不给的话模型极度保守：35 句的稿子只交 2 张
export const targetCount = (n: number) => ({ min: Math.max(1, Math.round(n / 5)), max: Math.max(2, Math.round(n / 3)) })

// ── 两步配卡 ──
// 第一步只给「目录」（类别 → 卡名 + 什么时候用），模型只回「哪几句配哪种卡」；第二步只加载选中的那几种卡的字段规则，
// 拆成最多 3 组并行填。理由：一次塞 40 多种卡的完整规则，提示词很长、模型在一堆规则里挑卡也挑不准；
// 目录很短、输出也短（不填字段），第二步每组只填几张、并行跑。
// **第一步定下的 template / line / endLine 以它为准**，第二步只认字段（它擅自改了卡型也不认）；
// 第二步漏掉的卡要报出来（mergeFills），不能悄悄少几张。
const FILL_GROUPS = 3
const FILL_PER_GROUP = 6

function buildCatalog(specs: TemplateSpec[], lineCount: number) {
  const { min, max } = targetCount(lineCount)
  const groups = CATEGORIES.map((c) => ({ c, items: specs.filter((s) => s.category === c) })).filter((g) => g.items.length)
  const catalog = groups
    .map((g) => `【${g.c}】\n${g.items.map((s) => `- ${s.id}（${s.name}）${s.multiLine ? '【可跨几句】' : ''}：${s.when}`).join('\n')}`)
    .join('\n\n');
  return `你是短视频剪辑师。这一步只做一件事：在口播字幕里挑出值得配动效卡的地方，并从目录里选卡型。**不用写卡片内容。**

卡片目录（按类别）：
${catalog}

规则：
- line：这张卡对应的字幕编号（方括号里的）；标【可跨几句】的卡可以另给 endLine（最后一句的编号），最多跨 ${MAX_SPAN} 句。
- 张数：这份字幕共 ${lineCount} 句，配 ${min}–${max} 张（平均每 3–5 句一张）。每张都要有明确理由，但不要只挑一两张就停。
- **逐个展开的并列要点（「第一招……第二招……」），每个要点单独一张卡，并且用同一种卡**，不要把整段塞进一张清单。
- 两张卡用的字幕不能重叠。选卡型时看「什么时候用」，原话里没有对应的内容（比如没有数字就别选数据类）就不要选。

只输出 JSON：{"cards":[{"template":"卡型 id","line":编号,"endLine":编号或省略,"reason":"一句话理由"}]}`;
}

function buildFill(specs: TemplateSpec[]) {
  const blocks = specs.map((s) => {
    const fields = s.fields.map((f) => `    - ${f.key}（${RULE_TEXT[f.rule]}${f.optional ? '，可留空' : ''}）：${f.desc}`).join('\n');
    return `- ${s.id}（${s.name}）字段：\n${fields}`;
  });
  return `你是短视频剪辑师。下面每张卡的卡型和对应字幕已经定好了，你只负责按卡型的字段规则把内容填出来。

用到的卡型：
${blocks.join('\n')}

规则：
- 标「原话」的字段**必须是字幕里连续的一段**，原样照抄，不许改写、不许概括、不许补没说的内容；标「原话数字」的只抄数字（中文数字换成阿拉伯数字）。
- 标「可概括」的可以自己写，但不超过字数上限。不要给时间、不要给章节编号。
- 每张卡都要回，用 k 对上编号；实在填不出来就只回 {"k":编号,"skip":"原因"}。

只输出 JSON：{"fills":[{"k":编号, …各字段…}]}`;
}

export interface Candidate { k: number; template: string; line: number; endLine: number }

/** 第一步的结果：只留卡型已上线、编号存在的；其余不要（第二步的 checkCards 会再严格核一遍并报原因） */
export function pickCandidates(raw: unknown, lines: PlanLine[], allowed: string[]): { candidates: Candidate[]; rejected: RejectedCard[] } {
  const ids = new Set(lines.map((l) => l.id));
  const idx = new Map(lines.map((l, i) => [l.id, i]));
  const candidates: Candidate[] = [];
  const rejected: RejectedCard[] = [];
  const used = new Set<number>();
  for (const c of Array.isArray(raw) ? (raw as any[]) : []) {
    const template = str(c?.template);
    const line = Number(c?.line);
    if (!allowed.includes(template) || !specById(template)) {
      rejected.push({ line: ids.has(line) ? line : null, template, text: str(c?.reason), why: `目录里没有「${template}」这种卡（或没上线）` });
      continue;
    }
    if (!ids.has(line)) { rejected.push({ line: null, template: specById(template)!.name, text: str(c?.reason), why: `字幕编号「${str(c?.line)}」不存在` }); continue; }
    const end = c?.endLine != null && specById(template)!.multiLine ? Number(c.endLine) : line;
    const endLine = ids.has(end) && idx.get(end)! >= idx.get(line)! ? end : line;
    // 跨句太多 / 和前面一张重叠的，第一步就拦下（不然第二步白填一遍，最后还是被拦）
    const span = idx.get(endLine)! - idx.get(line)! + 1;
    const name = specById(template)!.name;
    if (span > MAX_SPAN) { rejected.push({ line, template: name, text: str(c?.reason), why: `跨了 ${span} 句字幕，最多 ${MAX_SPAN} 句` }); continue; }
    const range = Array.from({ length: span }, (_, k) => idx.get(line)! + k);
    if (range.some((i) => used.has(i))) { rejected.push({ line, template: name, text: str(c?.reason), why: '和前面一张卡用的字幕重叠了' }); continue; }
    range.forEach((i) => used.add(i));
    candidates.push({ k: candidates.length + 1, template, line, endLine });
  }
  return { candidates, rejected };
}

/**
 * 把第二步填的字段并回第一步定的卡上。卡型 / 编号只认第一步的；第二步没回、回了 skip、整组失败的卡都进 rejected 并写原因 ——
 * 悄悄少几张的话他只会以为 AI 就配了这么多。
 */
export function mergeFills(
  candidates: Candidate[],
  fills: { k: number; skip?: string; [key: string]: any }[],
  failed: Map<number, string>,
  lines: PlanLine[],
): { raw: any[]; rejected: RejectedCard[] } {
  const byK = new Map(fills.map((f) => [Number(f?.k), f]));
  const raw: any[] = [];
  const rejected: RejectedCard[] = [];
  const textOf = (id: number) => lines.find((l) => l.id === id)?.text || '';
  for (const c of candidates) {
    const name = specById(c.template)?.name || c.template;
    const why = failed.get(c.k);
    if (why) { rejected.push({ line: c.line, template: name, text: textOf(c.line), why: `第二步填写失败：${why}` }); continue; }
    const f = byK.get(c.k);
    if (!f) { rejected.push({ line: c.line, template: name, text: textOf(c.line), why: '第一步挑了这张卡，但第二步没填出来' }); continue; }
    if (f.skip) { rejected.push({ line: c.line, template: name, text: textOf(c.line), why: `AI 说填不出来：${str(f.skip)}` }); continue; }
    const { k: _k, template: _t, line: _l, endLine: _e, skip: _s, ...fields } = f;
    raw.push({ ...fields, template: c.template, line: c.line, endLine: c.endLine });
  }
  return { raw, rejected };
}

function jsonFail(what: string, r: { raw: string; finish?: string; reasoningTokens?: number; noThinkingRequested?: boolean }, unmetered = false) {
  return jsonFailMessage(what, { raw: r.raw, finish: r.finish, reasoningTokens: r.reasoningTokens, budget: MAX_TOKENS, noThinkingRequested: r.noThinkingRequested, unmetered });
}

export async function planCards(input: { lines: PlanLine[]; userId: string; live: string[] }) {
  const specs = TEMPLATE_SPECS.filter((s) => input.live.includes(s.id));
  if (!specs.length) throw new BrollError('没有可以让 AI 配的已上线卡片：管理员在动效卡调试台上线后才能用', 400);
  // 已上线、但这里没有 AI 说明的模版：说出来，不悄悄不用
  const notes = input.live.filter((id) => !specById(id) && !MANUAL_ONLY.has(id)).map((id) => `「${id}」已上线，但还不支持 AI 配，只能手动加`);
  const byId = new Map(input.lines.map((l, i) => [l.id, i]));

  const base = {
    userId: input.userId,
    source: 'broll',
    tier: 'strong' as const,
    noThinking: true,
    timeoutMs: 120_000,
    // 同一个 body 超时第二次还在同一处超时；上游忙另算（retryOnBusy）。
    maxRetries: 0,
    retryOnBusy: true,
  };
  const ask = (system: string, user: string, ctx: { operation: string; requestSummary: string; unmetered?: boolean }) =>
    jsonGateway<any>(
      () => ({ ...SAMPLING.analytic, max_tokens: MAX_TOKENS, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
      { ...base, ...ctx },
    );

  // 第一步：目录挑卡（这一次扣额度）
  const t0 = Date.now();
  const body = input.lines.map((l) => `[${l.id}] ${l.text}`).join('\n');
  const r1 = await ask(buildCatalog(specs, input.lines.length), `字幕（方括号里是编号）：\n${body}`, {
    operation: 'broll:plan:pick',
    requestSummary: `挑卡 · ${input.lines.length} 句 · ${input.lines[0]?.text.slice(0, 30) || ''}`,
  });
  if (!r1.parsed) throw new BrollError(jsonFail('挑卡方案', r1), 502);
  const pickMs = Date.now() - t0;
  const picked = pickCandidates(r1.parsed.cards, input.lines, specs.map((s) => s.id));
  const { candidates } = picked;
  if (!candidates.length) {
    return { cards: [], rejected: picked.rejected, notes, timing: { pickMs, fillMs: 0, groups: 0 } };
  }

  // 第二步：只带选中的卡型规则，按出现顺序切成最多 3 组并行填。**不再扣日额度**（unmetered）——
  // 他点一次「AI 配卡」，扣一次；拆成几次请求是我们的实现细节。每次请求照样记 ai_logs。
  const t1 = Date.now();
  const per = Math.max(FILL_PER_GROUP, Math.ceil(candidates.length / FILL_GROUPS));
  const groups: Candidate[][] = [];
  for (let i = 0; i < candidates.length; i += per) groups.push(candidates.slice(i, i + per));
  const context = (c: Candidate) => {
    const a = Math.max(0, byId.get(c.line)! - 1), b = Math.min(input.lines.length - 1, byId.get(c.endLine)! + 1);
    return input.lines.slice(a, b + 1).map((l) => `[${l.id}] ${l.text}`).join('\n');
  };
  const failed = new Map<number, string>();
  const results = await Promise.all(groups.map(async (g, gi) => {
    const groupSpecs = specs.filter((s) => g.some((c) => c.template === s.id));
    const user = g.map((c) => `#${c.k} 卡型 ${c.template}（${specById(c.template)!.name}），对应字幕 ${c.line}${c.endLine !== c.line ? `–${c.endLine}` : ''}：\n${context(c)}`).join('\n\n');
    try {
      const r = await ask(buildFill(groupSpecs), user, {
        operation: 'broll:plan:fill',
        requestSummary: `填写第 ${gi + 1}/${groups.length} 组 · ${g.length} 张`,
        unmetered: true,
      });
      if (!r.parsed) { g.forEach((c) => failed.set(c.k, jsonFail('这一组卡片', r, true))); return [] }
      return Array.isArray(r.parsed.fills) ? r.parsed.fills : [];
    } catch (e: any) {
      // 一组失败不拖垮其他组，但这一组的每张卡都要报原因（上游原文）
      g.forEach((c) => failed.set(c.k, e?.message || String(e)));
      return [];
    }
  }));
  const fillMs = Date.now() - t1;
  const merged = mergeFills(candidates, results.flat(), failed, input.lines);
  const checked = checkCards(merged.raw, input.lines, specs.map((s) => s.id));
  if (failed.size) notes.push(`有 ${new Set(failed.values()).size > 1 ? '几' : '一'}组卡片第二步填写失败，那几张没放上，原因见「拦下」`);
  return {
    cards: checked.cards,
    rejected: [...picked.rejected, ...merged.rejected, ...checked.rejected],
    notes: [...notes, ...checked.notes],
    timing: { pickMs, fillMs, groups: groups.length },
  };
}
