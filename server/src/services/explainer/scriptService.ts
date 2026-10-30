import { createRequire } from 'module';
import { jsonGateway, jsonFailMessage } from '../../core/llm/parseJson.js';
import { LAYOUTS, LAYOUT_NAMES, ROLES, ROLE_NAMES, type Layout, type Role } from './vocab.js';

const require = createRequire(import.meta.url);
const ICON_WORDS: string = (require('./iconCatalog.json') as { tags: string[] }[]).map((c) => c.tags[0]).join('、');

// 代码动画视频的第一步：用户的一段内容 → 剧本。三步，像一个导演：
//   ① 创意方案（钩子、结构、反转、结尾）——先想清楚这条片子怎么讲，再分镜；
//   ② 分镜：每镜写标题、画面、要画的元素、注释、秒数，并标出叙事角色和版式（版式在这里定，用户能在剧本页改）；
//   ③ 代码检查（版式是否单调、开头是不是钩子、有没有反转、每镜时长…），不过就带着具体问题让 AI 改一轮，改完还剩的写进 notes。
// **不出坐标、不出时间戳** —— 每镜的起止由前端按 seconds 的比例和总时长算（和编译画面同一个公式）。
// 计费：日额度只在第 ① 步扣（他点一次扣一次）；售卖型 key 按网关规则每次调用 1 点，调了几次在 calls 里回给页面说清楚。

export class ExplainerError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export const STYLE_IDS = ['whiteboard', 'blueprint', 'sketch'] as const;
export type StyleId = (typeof STYLE_IDS)[number];
export const STYLE_NAMES: Record<StyleId, string> = { whiteboard: '白板讲解', blueprint: '蓝图 / 工程制图', sketch: '白纸手绘' };
/** 接口收到的 style 一律过这个：各处自己写 `=== 'whiteboard' || === 'blueprint'` 的话，加了新风格有一处没改，那一步就是一句 400 */
export const isStyle = (v: unknown): v is StyleId => (STYLE_IDS as readonly unknown[]).includes(v);
export const DURATIONS = [15, 20, 30, 45, 60, 90, 120, 180] as const;
export const MAX_PROMPT_CHARS = 4000;
/** 剧本最多几镜（3 分钟 ≈ 30 镜）。API 校验、场景校验、前端加镜按钮都按这个 */
export const MAX_SHOTS = 30;
const MAX_TOKENS = 12000;

export interface Treatment { hook: string; structure: string[]; turn: string; ending: string }
export interface ScriptShot { seconds: number; heading: string; visual: string; elements: string[]; note: string; role?: Role; layout?: Layout }
export interface Script { title: string; summary: string; style: StyleId; duration: number; shots: ScriptShot[]; treatment?: Treatment }

// 字数上限：屏幕上的字要在一镜里写完、看清。超了就截断并写进 notes（不悄悄截）
const LIMIT = { title: 14, heading: 16, element: 8, note: 24, visual: 80 };
const MAX_ELEMENTS = 4;

/** 镜头数由代码按时长定（平均约 6 秒一镜），写进 prompt；不给的话模型要么 2 镜写完 60 秒，要么 15 镜每镜 1 秒 */
export function targetShots(duration: number) {
  return Math.max(2, Math.min(MAX_SHOTS - 2, Math.round(duration / 6)));
}

// 两种风格各自的叙事手法（摘自 OpenTake 的风格说明，改成这里画得出来的版本）
const CRAFT: Record<StyleId, string[]> = {
  whiteboard: [
    '开场从一个观众手里就有的东西、或一个具体的问题切入（「你的手机怎么知道你在哪？」），不要从定义讲起。',
    '把最让人意外的那个数字或事实放在中间，前面铺垫、后面解释。',
    '结尾回到开场的那个东西，给出一句话的答案（前后呼应）。',
    '一句话一个画面：每一镜只讲一件事。',
  ],
  blueprint: [
    '整条片子像一张图纸被一步步画出来：先给出对象（FIG. 1），再拆结构、看关键部位，最后给结论。',
    '每一镜是一张 FIG，FIG 的推进就是章节：外观 → 内部 → 关键部位 → 结论。',
    '中间要有一个「为什么这样设计」的转折：常见做法的问题 → 这个设计怎么解决。',
    '结尾像图纸盖章批准一样给出明确结论。',
  ],
  sketch: [
    '每一镜是一张独立的手绘解释图：只讲一个判断、一个状态或一个动作，画面要留大片空白。',
    '把抽象的意思换成一个具体的小物件或小动作（卡住、漏掉、分拣、搭桥、压一下），不要画成流程图或课件。',
    '图上的字是手写批注：少、短（2–8 个字），说「问题在哪 / 往哪走 / 补一句」，不要解释每个元素。',
    '开头抛一个具体的问题或反常识，结尾一张图给出一句话结论。',
  ],
};

const LOOK: Record<StyleId, string> = {
  whiteboard: '画面是一块白板：马克笔一笔一笔写出标题、画出简笔图标和箭头，镜头在白板上从一块区域移到下一块。',
  blueprint: '画面是一张蓝图（工程制图）：白色线条在蓝晒纸上按制图顺序画出图形，每一镜是一个 FIG，镜与镜之间硬切。',
  sketch: '画面是一张张纯白纸上的手绘草图：细黑线画出简笔物件，红 / 橙 / 蓝三色手写短批注带小箭头指向它们；每一镜是一张独立的图，画完停住再切到下一张。',
};
const look = (style: StyleId) => LOOK[style];

// ——— ① 创意方案 ———
function treatmentPrompt(style: StyleId, duration: number) {
  return [
    `你是讲解短视频的导演。先不分镜，只想清楚一条 ${duration} 秒「${STYLE_NAMES[style]}」风格的讲解视频怎么讲。`,
    look(style),
    '没有旁白、没有配音：观众只能看屏幕上的字和图。',
    '',
    '这种风格好用的讲法：',
    ...CRAFT[style].map((c) => `- ${c}`),
    '',
    '要求：只用用户给的事实，不编数字、不编引文；全部用中文。',
    '只返回一个 JSON 对象：',
    '{"title":"标题（不超过 14 字）","hook":"开场怎么一下抓住人（一句话）","structure":["铺垫：…","展开：…","反转：…","收束：…"],"turn":"中间的意外点 / 转折（一句话，内容里实在没有就写空字符串）","ending":"结尾怎么收（一句话，最好回扣开场）"}',
  ].join('\n');
}

// ——— ② 分镜 ———
function shotsPrompt(style: StyleId, duration: number, t: Treatment) {
  const n = targetShots(duration);
  return [
    `你是讲解短视频的导演。按下面定好的创意方案，把用户给的内容分镜成一条 ${duration} 秒的「${STYLE_NAMES[style]}」风格讲解视频。`,
    look(style),
    '没有旁白、没有配音：观众只能看屏幕上的字和图，所以每一镜的标题和元素名要把意思讲清楚。',
    '',
    '创意方案：',
    `- 开场钩子：${t.hook}`,
    `- 结构：${t.structure.join(' → ')}`,
    `- 转折：${t.turn || '（无）'}`,
    `- 结尾：${t.ending}`,
    '',
    '要求：',
    `- 分 ${n} 镜左右（${Math.max(2, n - 1)}–${n + 2} 镜），顺序照创意方案的结构走。`,
    `- role 是这一镜的叙事角色：${ROLES.map((r) => `${r}（${ROLE_NAMES[r]}）`).join('、')}。第 1 镜是 hook，最后一镜是 close；有转折的话放一镜 turn。`,
    `- layout 是这一镜的版式：${LAYOUTS.map((l) => `${l}（${LAYOUT_NAMES[l]}）`).join('、')}。`,
    '    hero 介绍一个主角；reveal 揭示一个数字 / 结论 / 答案；compare 对比两样东西（以前/现在、错/对）；flow 步骤、因果链；hub 一个概念的几个方面；timeline 年代、阶段；grid 几样并列的东西（别的都不合适才用）。',
    '    相邻两镜版式尽量不同，不要连着三镜同一个版式。',
    `- heading 是屏幕上写出来的标题，不超过 ${LIMIT.heading} 个字。`,
    `- elements 是这一镜要画出来的东西，1–${MAX_ELEMENTS} 个，每个是一个具体名词或很短的词组（不超过 ${LIMIT.element} 个字）。按版式的顺序写：hero / reveal / hub 的第一个是主角，compare 前一半在左、后一半在右。`,
    '- visual 用一两句话写这一镜画面怎么呈现、画完之后强调谁（圈出来、划线、打勾、打叉、镜头推近），给人看的，不写坐标和时间。',
    '- **画面只能画这些东西**，elements 和 visual 只能写它们，写了画不出来的东西观众只会看到一行字：',
    `  · 简笔图标：${ICON_WORDS}`,
    '  · 图示：圆点组（几个点、可以分成几堆）、十格框（2 行 5 格，填几格）、算式（如 8 + 2 = 10）、圆形 / 方框 / 三角形（里面可以写字）、数轴（标点、跳跃弧线）',
    '  · 文字、清单、元素之间的箭头（实线或虚线）',
    '  画面是静态排开、一笔一笔画出来的：不要写「移动」「变形」「飞过去」这类动作，用前后两镜或箭头来表达变化。',
    `- note 是可选的一句注释（公式、结论、提示），不超过 ${LIMIT.note} 个字；没有就写空字符串。`,
    '- seconds 是这一镜大致占几秒（整数，3–12），内容多的镜多给一点；加起来大约等于总时长即可，代码会按比例换算。',
    '- 只用用户给的事实，不编数字、不编引文。全部用中文（品牌名、专有名词、公式保留原文）。',
    '',
    '只返回一个 JSON 对象，不要任何解释：',
    '{"summary":"一句话说这条视频讲什么","shots":[{"role":"hook","layout":"hero","seconds":5,"heading":"…","visual":"…","elements":["…"],"note":""}]}',
  ].join('\n');
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
function cut(s: string, max: number, what: string, notes: string[]) {
  const chars = [...s];
  if (chars.length <= max) return s;
  notes.push(`${what}超过 ${max} 字，截成了「${chars.slice(0, max).join('')}」`);
  return chars.slice(0, max).join('');
}

export function normalizeTreatment(raw: any): Treatment {
  const structure = (Array.isArray(raw?.structure) ? raw.structure : []).map(str).filter(Boolean).slice(0, 8);
  return { hook: str(raw?.hook).slice(0, 80), structure, turn: str(raw?.turn).slice(0, 80), ending: str(raw?.ending).slice(0, 80) };
}

/** 模型回的 JSON → 规整的剧本。缺字段 / 超长 / 镜头太多 / 角色版式不认识都写进 notes，不悄悄丢。 */
export function normalizeScript(raw: any, style: StyleId, duration: number, title?: string): { script: Script; notes: string[] } {
  const notes: string[] = [];
  const shotsRaw = Array.isArray(raw?.shots) ? raw.shots : [];
  if (!shotsRaw.length) throw new ExplainerError('AI 回的剧本里没有分镜（shots 是空的），再生成一次试试', 502);
  const maxShots = Math.min(MAX_SHOTS, targetShots(duration) + 2);
  if (shotsRaw.length > maxShots) notes.push(`AI 分了 ${shotsRaw.length} 镜，${duration} 秒放不下，只保留前 ${maxShots} 镜`);
  const shots: ScriptShot[] = shotsRaw.slice(0, maxShots).map((s: any, i: number) => {
    const at = `第 ${i + 1} 镜`;
    const elsRaw = (Array.isArray(s?.elements) ? s.elements : []).map(str).filter(Boolean);
    if (elsRaw.length > MAX_ELEMENTS) notes.push(`${at}有 ${elsRaw.length} 个元素，只保留前 ${MAX_ELEMENTS} 个`);
    const heading = str(s?.heading);
    const sec = Number(s?.seconds);
    const role = str(s?.role).toLowerCase(), layout = str(s?.layout).toLowerCase();
    if (role && !(ROLES as readonly string[]).includes(role)) notes.push(`${at}的叙事角色「${role}」不认识，没标`);
    if (layout && !(LAYOUTS as readonly string[]).includes(layout)) notes.push(`${at}的版式「${layout}」不认识，按平均分格`);
    return {
      seconds: Number.isFinite(sec) && sec > 0 ? Math.min(30, Math.round(sec)) : 5,
      heading: cut(heading, LIMIT.heading, `${at}标题`, notes),
      visual: cut(str(s?.visual), LIMIT.visual, `${at}画面描述`, notes),
      elements: elsRaw.slice(0, MAX_ELEMENTS).map((e: string, k: number) => cut(e, LIMIT.element, `${at}第 ${k + 1} 个元素`, notes)),
      note: cut(str(s?.note), LIMIT.note, `${at}注释`, notes),
      ...((ROLES as readonly string[]).includes(role) ? { role: role as Role } : {}),
      ...((LAYOUTS as readonly string[]).includes(layout) ? { layout: layout as Layout } : {}),
    };
  });
  const t = cut(str(title ?? raw?.title) || shots[0].heading || '未命名', LIMIT.title, '标题', notes);
  return { script: { title: t, summary: str(raw?.summary), style, duration, shots }, notes };
}

/**
 * ③ 代码检查：剧本「读起来能用」但讲得呆板的几种情况。只查代码算得准的，不让模型自评。
 * 每镜实际秒数按和前端 shotWindows 一样的比例算（结尾全貌那一段先扣掉）。
 */
export function lintScript(s: Script): string[] {
  const out: string[] = [];
  const n = s.shots.length;
  if (!n) return out;
  if (s.shots[0].role && s.shots[0].role !== 'hook') out.push(`第 1 镜是「${ROLE_NAMES[s.shots[0].role]}」，开场要是钩子（抛一个问题、反常识的事实、或观众熟悉的东西）`);
  const last = s.shots[n - 1].role;
  if (n > 2 && last && last !== 'close' && last !== 'payoff') out.push(`最后一镜是「${ROLE_NAMES[last]}」，要收束（给出答案 / 回扣开场）`);
  if (s.duration >= 30 && n >= 4 && !s.shots.some((x) => x.role === 'turn')) out.push('整条没有转折（turn）：中间放一镜意外的事实、常见误解或「但是」，后面再解释');
  let run = 1;
  for (let i = 1; i <= n; i++) {
    const same = i < n && (s.shots[i].layout || 'grid') === (s.shots[i - 1].layout || 'grid');
    if (same) { run++; continue; }
    if (run >= 3) out.push(`第 ${i - run + 1}–${i} 镜连着 ${run} 镜都是「${LAYOUT_NAMES[s.shots[i - 1].layout || 'grid']}」，换掉其中一两镜的版式`);
    run = 1;
  }
  const grid = s.shots.filter((x) => !x.layout || x.layout === 'grid').length;
  if (n >= 4 && grid / n > 0.5) out.push(`${grid} / ${n} 镜都是平均分格，画面会像 PPT；多用主角放大、对比、流程、揭示`);
  const overview = n > 1 ? Math.min(2.2, s.duration * 0.12) : 0;
  const sum = s.shots.reduce((a, x) => a + (x.seconds > 0 ? x.seconds : 1), 0) || 1;
  s.shots.forEach((x, i) => {
    const sec = ((s.duration - overview) * (x.seconds > 0 ? x.seconds : 1)) / sum;
    if (!x.heading) out.push(`第 ${i + 1} 镜没有标题`);
    if (!x.elements.length) out.push(`第 ${i + 1} 镜没写要画的元素，画面会只有一行标题`);
    if (sec < 2.5) out.push(`第 ${i + 1} 镜只有 ${sec.toFixed(1)} 秒，写不完也看不清，并到相邻一镜或多给点时间`);
    if (sec > 14) out.push(`第 ${i + 1} 镜有 ${sec.toFixed(0)} 秒，一个画面停太久，拆成两镜`);
  });
  return out;
}

const ctx = (userId: string, operation: string, summary: string, unmetered: boolean) => ({
  userId, source: 'explainer', operation, tier: 'strong' as const, noThinking: true,
  timeoutMs: 180_000, maxRetries: 0, retryOnBusy: true, requestSummary: summary, unmetered,
});
const fail = (what: string, r: { raw: string; finish?: string; reasoningTokens?: number; noThinkingRequested?: boolean }, unmetered: boolean) =>
  new ExplainerError(jsonFailMessage(what, { raw: r.raw, finish: r.finish, reasoningTokens: r.reasoningTokens, budget: MAX_TOKENS, noThinkingRequested: r.noThinkingRequested, unmetered }), 502);

export async function writeScript(input: { style: StyleId; prompt: string; duration: number; userId: string }) {
  const { style, duration, prompt, userId } = input;
  const tag = `${STYLE_NAMES[style]} · ${duration} 秒 · ${prompt.slice(0, 30)}`;
  let calls = 0;
  // ① 创意方案（这一次扣日额度）
  calls++;
  const r1 = await jsonGateway<any>(
    () => ({ temperature: 0.8, max_tokens: 3000, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: treatmentPrompt(style, duration) }, { role: 'user', content: prompt }] }),
    ctx(userId, 'explainer:script:treatment', `创意 · ${tag}`, false),
  );
  if (!r1.parsed) throw fail('创意方案', r1, false);
  const treatment = normalizeTreatment(r1.parsed);
  const title = str(r1.parsed.title);
  // ② 分镜
  const system = shotsPrompt(style, duration, treatment);
  calls++;
  const r2 = await jsonGateway<any>(
    () => ({ temperature: 0.6, max_tokens: MAX_TOKENS, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }] }),
    ctx(userId, 'explainer:script:shots', `分镜 · ${tag}`, true),
  );
  if (!r2.parsed) throw fail('分镜', r2, true);
  let { script, notes } = normalizeScript(r2.parsed, style, duration, title);
  // ③ 代码检查，不过就带着问题改一轮
  const issues = lintScript(script);
  let revised = false;
  if (issues.length) {
    calls++;
    const r3 = await jsonGateway<any>(
      () => ({
        temperature: 0.4, max_tokens: MAX_TOKENS, response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt },
          { role: 'assistant', content: JSON.stringify({ summary: script.summary, shots: script.shots }) },
          { role: 'user', content: `检查发现这些问题，逐条改掉，没问题的镜头保持原样，返回完整的 JSON：\n${issues.map((x, i) => `${i + 1}. ${x}`).join('\n')}` },
        ],
      }),
      ctx(userId, 'explainer:script:revise', `修改 · ${tag}`, true),
    );
    if (r3.parsed) {
      const again = normalizeScript(r3.parsed, style, duration, title);
      script = again.script; notes = again.notes; revised = true;
    } else {
      // 修改那一轮没回来：用第一版，并说清楚（不当成改过了）
      notes.push(`剧本检查发现 ${issues.length} 个问题，让 AI 修改时没拿到结果，下面是没改过的第一版`);
    }
  }
  script.treatment = treatment;
  const remain = lintScript(script);
  for (const x of remain) notes.push(`剧本检查：${x}`);
  return { script, notes, calls, review: { found: issues.length, revised, remaining: remain.length } };
}
