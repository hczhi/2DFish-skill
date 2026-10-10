import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { SAMPLING } from '../../core/llm/gateway.js';
import { jsonGateway, jsonFailMessage } from '../../core/llm/parseJson.js';
import { cameraTemplate } from './cameraTemplates.js';
import { styleById, resolvePacks, type LoadedPack } from './options.js';

// 视频提示词优化：用户贴一段自己写的提示词 + 选时长（+ 可选风格/题材/镜头），
// 一次调用出「诊断 + 镜头拆分 + 新提示词」。方法论在 skills/video-prompt/（base 整份 + 按题材追加），
// 不落库、不留历史。时间段由模型排、由代码核对；可复制的整段提示词由代码拼。

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = resolve(__dirname, '../../../../skills/video-prompt');

export const MIN_SECONDS = 4;
export const MAX_SECONDS = 10;
export const MAX_PROMPT_CHARS = 4000;
export const MAX_CAMERAS = 3;
const MAX_SHOTS = 8;
// 正文大约 3000–5000 字；留宽是给关不掉思维链的接入点（思维链和正文分同一份额度，硬规则 2）。
const MAX_TOKENS = 12000;

export class VpromptError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = 'VpromptError';
  }
}

const skillCache = new Map<string, string>();

/** 读不到就抛：没了方法论模型照样回一份读起来很正常的「优化稿」，只是什么规则都没用上。 */
export function loadSkill(name = 'base'): string {
  let text = skillCache.get(name);
  if (!text) {
    text = readFileSync(resolve(SKILL_DIR, `${name}.md`), 'utf-8');
    skillCache.set(name, text);
  }
  return text;
}

export interface OptimizeInput {
  prompt: string;
  seconds: number;
  userId: string;
  style?: string;
  genre?: string;
  /** 用户指定必须用到的运镜模板编号（51 式里的 01–51） */
  cameras?: string[];
}

interface RawShot {
  start: number;
  end: number;
  name?: string;
  shotSize?: string;
  focal?: string;
  camera?: string;
  templateId?: string | null;
  content?: string;
  transition?: string;
}

interface RawFinal {
  title?: string;
  overview?: string;
  lock?: string;
  cameraByShot?: string[];
  scene?: string[];
  blockingByShot?: string[];
  actionByShot?: string[];
  chain?: string[];
  objects?: string[];
  sound?: string[];
}

interface RawResult {
  genre?: string;
  style?: string;
  must?: Array<{ quote?: string; problem?: string; fix?: string }>;
  suggest?: Array<{ quote?: string; problem?: string; fix?: string }>;
  shots?: RawShot[];
  final?: RawFinal;
}

const fmt = (n: number) => String(Math.round(n * 10) / 10);

/**
 * 核对模型排的时间段。返回问题描述（给重排那一轮当反馈、也给最终报错），没问题回 null。
 * 不在这里「修」：悄悄把 0–3 / 2–6 拉齐的话，那一段的画面内容是按错的秒数写的。
 */
export function checkShots(shots: RawShot[] | undefined, seconds: number, cameras: string[]): string | null {
  if (!Array.isArray(shots) || shots.length === 0) return '没有给出任何镜头时间段';
  if (shots.length > MAX_SHOTS) return `镜头切成了 ${shots.length} 段，${seconds} 秒最多 ${MAX_SHOTS} 段`;
  const eq = (a: number, b: number) => Math.abs(a - b) < 0.05;
  let cursor = 0;
  for (let i = 0; i < shots.length; i++) {
    const { start, end } = shots[i];
    const label = `第 ${i + 1} 段`;
    if (typeof start !== 'number' || typeof end !== 'number' || !isFinite(start) || !isFinite(end)) {
      return `${label}的起止秒数不是数字`;
    }
    if (!eq(start, cursor)) {
      return i === 0
        ? `第 1 段从 ${fmt(start)} 秒开始，应该从 0 秒开始`
        : `${label}从 ${fmt(start)} 秒开始，但上一段结束在 ${fmt(cursor)} 秒（必须首尾相接）`;
    }
    if (end - start < 1 - 0.05) return `${label}（${fmt(start)}–${fmt(end)}s）不到 1 秒`;
    cursor = end;
  }
  if (!eq(cursor, seconds)) return `最后一段结束在 ${fmt(cursor)} 秒，总时长是 ${seconds} 秒`;
  const used = new Set(shots.map((s) => normalizeTemplateId(s.templateId)).filter(Boolean));
  const missing = cameras.filter((id) => !used.has(id));
  if (missing.length) {
    return `用户指定的镜头 ${missing.map((id) => `${id} ${cameraTemplate(id)?.name}`).join('、')} 没有用在任何一段上`;
  }
  return null;
}

function normalizeTemplateId(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  const n = parseInt(String(v), 10);
  if (!Number.isFinite(n)) return null;
  return String(n).padStart(2, '0');
}

/**
 * 整段提示词里「哪段时间做什么」的时间标注由代码按 shots 加，所以逐段那两栏的条数必须和 shots 对上：
 * 少一条的话后面每一段的动作都会挂到错的秒数上，而读起来完全正常。
 */
export function checkFinal(final: RawFinal | undefined, shotCount: number): string | null {
  if (!final || typeof final !== 'object') return '没有给出 final（整段提示词）';
  for (const k of ['cameraByShot', 'blockingByShot', 'actionByShot'] as const) {
    const list = final[k];
    const n = Array.isArray(list) ? list.length : 0;
    if (n !== shotCount) return `final.${k} 有 ${n} 条，但 shots 有 ${shotCount} 段（必须一一对应）`;
  }
  return null;
}

export function buildUserMessage(input: OptimizeInput, packs: LoadedPack[]): string {
  const { prompt, seconds } = input;
  const style = styleById(input.style || 'auto');
  const cameras = input.cameras || [];

  const styleLine =
    style && style.id !== 'auto'
      ? `风格：用户指定「${style.label}」，以此为准（${style.render}）。原文里与之冲突的写法，在诊断里指出并改掉。`
      : '风格：用户未指定。原文写了就沿用，没写就从内容判断。';
  const genreLine = packs.length
    ? `题材：按${packs.map((p) => `「${p.label}」`).join('、')}处理，遵守 system 里对应的附加规范。`
    : '题材：按日常 / 通用规则处理。';
  const cameraLine = cameras.length
    ? `用户指定必须用到的镜头（每一式至少用在一个时间段上，并在那一段的 templateId 填它的编号；按画面内容放到最合适的那一段）：\n${cameras
        .map((id) => {
          const t = cameraTemplate(id)!;
          return `- ${t.id} ${t.name}（${t.mood}）：${t.shot}，${t.angle}，${t.move}。${t.desc}`;
        })
        .join('\n')}`
    : '镜头：用户未指定。从 51 式运镜库里按意图挑选；某一段用了库里的某一式，就在 templateId 填编号，没用就填 null。';

  return `总时长：${seconds} 秒。
${styleLine}
${genreLine}
${cameraLine}

用户原始提示词：
"""
${prompt}
"""

只输出一个 JSON 对象，不要任何其他文字。结构：
{
  "genre": "你按什么题材理解这段内容（一句话）",
  "style": "最终采用的风格名称，12 字以内（用户指定了就照抄）",
  "must": [{"quote": "原文那一句", "problem": "问题是什么", "fix": "怎么改"}],
  "suggest": [{"quote": "…", "problem": "…", "fix": "…"}],
  "shots": [
    {
      "start": 0, "end": 2.5,
      "name": "段落名（4–6 字）",
      "shotSize": "景别", "focal": "焦段，如 35mm",
      "camera": "机位与运镜（一句话概括）",
      "templateId": "用到的 51 式编号，如 \\"12\\"；没用填 null",
      "content": "画面内容（一句话概括）",
      "transition": "进入这一段的切换方式，只写名称（硬切 / 一镜到底 / 遮挡转场 / 动作匹配 / 视线匹配 / 甩镜转场 之一）；第一段填 开场"
    }
  ],
  "final": {
    "title": "这支片子的标题（10 字以内，如：巷角背对 · 红石收束）",
    "overview": "画面总述：这支片子拍什么、整体镜头语言与节奏、和前后画面的承接（3–4 句）",
    "lock": "人物与风格锁定：固定人物特征词（服饰 / 发型 / 体态）+ 风格画质句 + 全局光影色调",
    "cameraByShot": ["与 shots 一一对应、条数相同：这一段的完整运镜句（机位 + 方向 + 参照物与效果 + 速度 + 起止构图）。不要写时间"],
    "scene": ["场景与道具，每条一个要点：第一条写空间布局（主要固定物在画面里的左右前后位置），其余写光源方向与冷暖、材质、道具外观"],
    "blockingByShot": ["与 shots 一一对应、条数相同：这一段的空间关系 —— 每个人物站在场景哪里（相对固定物 / 他人的方位与距离）、身体和脸各朝向哪里、在画面哪一侧哪一层约占多大、视线落在哪；最后一句写这一段观众的视觉焦点在哪、靠什么（景深 / 光 / 构图）引过去。不要写时间"],
    "actionByShot": ["与 shots 一一对应、条数相同：这一段的动作与神情（逐帧分解 + 五官具象 + 服饰发丝受力）。不要写时间"],
    "chain": ["环境连锁反应，每条以「物：」或「人：」开头：画面里的物件和旁人怎样被主体的动作影响；没有就给空数组"],
    "objects": ["运动物体，每条一个对象，格式「对象：状态A → 状态B → 状态C」，按时间顺序覆盖全部时间段；镜头本身也算一条"],
    "sound": ["声音，按时间顺序用 → 串起变化：环境音 / 对白 / 音效 / 有无音乐"]
  }
}
时间段规则：start/end 是秒数（可到 0.5 秒），第一段从 0 开始，每段的 start 等于上一段的 end，最后一段的 end 必须等于 ${seconds}；每段不短于 1 秒，最多 ${MAX_SHOTS} 段。
final.cameraByShot、final.blockingByShot 和 final.actionByShot 的条数必须和 shots 一样多、顺序一致；时间标注由系统按 shots 自动加上，你不要在里面写秒数。
must / suggest 没有就给空数组。各字段的值直接写内容，不要再带「镜头·运镜：」这类栏目名。`;
}

export interface Shot {
  start: number;
  end: number;
  name: string;
  shotSize: string;
  focal: string;
  camera: string;
  template: { id: string; name: string; category: string } | null;
  content: string;
  transition: string;
}

export interface TimedLine {
  start: number;
  end: number;
  name: string;
  text: string;
}

const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
// 模型常把栏目名也写进值里（「镜头·运镜：…」），拼出来每条都重复一遍。
const FIELD_LABEL = /^(镜头[·・]?运镜|场景[·・]?道具|场景与道具|空间[·・]?站位|动作[·・]?神情|动作与神情|运动物体|环境连锁反应|声音|画面总述|人物与风格锁定)\s*[：:]\s*/;
// 叮嘱过不要写秒数，它还是常在开头带一个「0–1.3s：」—— 和代码加的那个叠成两遍。
const LEAD_TIME = /^[（(]?\s*\d+(\.\d+)?\s*[–\-~至]\s*\d+(\.\d+)?\s*s?\s*[）)]?\s*[：:｜|]?\s*/;
const field = (v: unknown) => s(v).replace(FIELD_LABEL, '');
const timed = (v: unknown) => field(v).replace(LEAD_TIME, '');
const list = (v: unknown) => (Array.isArray(v) ? v.map(field).filter(Boolean) : []);

/** 可整段复制给视频模型的文本：按维度分栏，时间标注全部来自核过的 shots。 */
export function renderFinalText(f: ReturnType<typeof assemble>['final'], seconds: number): string {
  const bullets = (xs: string[]) => xs.map((x) => `• ${x}`).join('\n');
  const parts = [
    `${f.title}（0–${seconds}s · 共 ${seconds} 秒）`,
    f.overview && `画面总述：${f.overview}`,
    f.lock && `人物与风格锁定：${f.lock}`,
    `【镜头·运镜】\n${f.camera.map((c) => `• ${fmt(c.start)}s ${c.name}：${c.text}`).join('\n')}`,
    f.scene.length && `【场景·道具】\n${bullets(f.scene)}`,
    `【空间·站位】\n${f.blocking.map((b) => `• ${fmt(b.start)}–${fmt(b.end)}s ${b.name}：${b.text}`).join('\n')}`,
    `【动作·神情】\n${f.action.map((a) => `（${fmt(a.start)}–${fmt(a.end)}s）${a.name}：${a.text}`).join('')}`,
    f.chain.length && `【环境连锁反应】\n${bullets(f.chain)}`,
    f.objects.length && `【运动物体】\n${bullets(f.objects)}`,
    f.sound.length && `【声音】\n${bullets(f.sound)}`,
  ];
  return parts.filter(Boolean).join('\n\n');
}

export function assemble(raw: RawResult, input: OptimizeInput, packs: LoadedPack[]) {
  const notes: string[] = [];
  const shots: Shot[] = (raw.shots || []).map((r, i) => {
    const tid = normalizeTemplateId(r.templateId);
    const t = tid ? cameraTemplate(tid) : undefined;
    // 编号不存在时不标，而且要说：标一个查无此式的编号，用户回头去库里找会找不到。
    if (tid && !t) notes.push(`第 ${i + 1} 段模型标了一个不存在的运镜编号 ${tid}，已不标注。`);
    return {
      start: r.start,
      end: r.end,
      name: s(r.name) || `镜头 ${i + 1}`,
      shotSize: s(r.shotSize),
      focal: s(r.focal),
      camera: s(r.camera),
      template: t ? { id: t.id, name: t.name, category: t.category } : null,
      content: s(r.content),
      transition: s(r.transition),
    };
  });

  const f = raw.final || {};
  const byShot = (xs: string[] | undefined): TimedLine[] =>
    shots.map((sh, i) => ({ start: sh.start, end: sh.end, name: sh.name, text: timed(xs?.[i]) }));
  const final = {
    title: s(f.title) || '优化后的提示词',
    overview: field(f.overview),
    lock: field(f.lock),
    camera: byShot(f.cameraByShot),
    scene: list(f.scene),
    blocking: byShot(f.blockingByShot),
    action: byShot(f.actionByShot),
    chain: list(f.chain),
    objects: list(f.objects),
    sound: list(f.sound),
  };

  const style = styleById(input.style || 'auto');
  const pickIssues = (list: RawResult['must']) =>
    (Array.isArray(list) ? list : [])
      .map((x) => ({ quote: s(x?.quote), problem: s(x?.problem), fix: s(x?.fix) }))
      .filter((x) => x.problem || x.fix);

  return {
    seconds: input.seconds,
    approach: {
      style: style && style.id !== 'auto' ? { label: style.label, by: 'user' as const } : { label: s(raw.style), by: 'ai' as const },
      genre: s(raw.genre),
      packs: packs.map((p) => ({ label: p.label, reason: p.reason })),
    },
    must: pickIssues(raw.must),
    suggest: pickIssues(raw.suggest),
    shots,
    final,
    notes,
  };
}

export async function optimizePrompt(input: OptimizeInput) {
  const cameras = input.cameras || [];
  const packs = resolvePacks(input.genre || 'auto', input.prompt);
  const system = [loadSkill('base'), ...packs.map((p) => loadSkill(p.pack))].join('\n\n---\n\n');
  const userMessage = buildUserMessage(input, packs);
  const ctx = {
    userId: input.userId,
    source: 'vprompt',
    tier: 'strong' as const,
    requestSummary: `${input.seconds}s · ${input.prompt.slice(0, 60)}`,
    noThinking: true,
    unmetered: true,
    timeoutMs: 180_000,
    // 同一个 body 超时第二次还在同一处超时；上游忙另算（retryOnBusy）。
    maxRetries: 0,
    retryOnBusy: true,
  };

  const call = (messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>, operation: string) =>
    jsonGateway<RawResult>(
      () => ({ ...SAMPLING.rewrite, max_tokens: MAX_TOKENS, response_format: { type: 'json_object' }, messages }),
      { ...ctx, operation }
    );
  const fail = (r: Awaited<ReturnType<typeof call>>) =>
    new VpromptError(
      jsonFailMessage('优化结果', {
        raw: r.raw,
        finish: r.finish,
        reasoningTokens: r.reasoningTokens,
        budget: MAX_TOKENS,
        noThinkingRequested: r.noThinkingRequested,
        unmetered: true,
      }),
      502
    );

  const base = [
    { role: 'system' as const, content: system },
    { role: 'user' as const, content: userMessage },
  ];
  let r = await call(base, 'vprompt:optimize');
  if (!r.parsed) throw fail(r);
  const check = (x: RawResult) =>
    checkShots(x.shots, input.seconds, cameras) ?? checkFinal(x.final, x.shots?.length ?? 0);
  let problem = check(r.parsed);
  if (problem) {
    // 时间段排错了重排一次（免费，不扣额度）；再错就报出具体哪一段错，不回一份秒数对不上的稿子。
    console.warn(`[vprompt] 结构不合规，重排一次：${problem}`);
    r = await call(
      [
        ...base,
        { role: 'assistant', content: r.raw },
        { role: 'user', content: `输出不合规：${problem}。请修正后，完整重新输出整个 JSON。` },
      ],
      'vprompt:optimize-retry'
    );
    if (!r.parsed) throw fail(r);
    problem = check(r.parsed);
    if (problem) throw new VpromptError(`模型排的镜头时间段连续两次对不上（${problem}），请再点一次。`, 502);
  }
  const out = assemble(r.parsed, input, packs);
  return { ...out, fullText: renderFinalText(out.final, input.seconds) };
}
