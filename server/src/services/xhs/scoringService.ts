import { aiGateway } from '../../core/llm/gateway.js';
import { getDatabase } from '../../db/index.js';

// ==================== Types ====================

export interface XhsDimensionScore {
  /** 0-10 */
  score: number;
  /** 一句话诊断：这个维度为什么是这个分 */
  reason: string;
  /** 具体怎么改（低于 8 分必须给） */
  suggestion: string;
}

export type XhsDimensionKey =
  | 'titleHook'
  | 'opening'
  | 'resonance'
  | 'emotion'
  | 'value'
  | 'interaction';

export interface XhsScoringResult {
  /** 0-100，由代码用权重算出，不由 LLM 决定 */
  totalScore: number;
  /** 是否有明显 AI 味 */
  aiSmell: boolean;
  dimensions: Record<XhsDimensionKey, XhsDimensionScore>;
  /** 如果只改一处，最该改哪里 */
  topSuggestion: string;
  /** 2-3 句整体诊断 */
  overall: string;
}

export interface XhsNoteInput {
  title: string;
  body: string;
  /** 可选：赛道/人群，注入后评分更贴合 */
  niche?: string;
}

// ==================== 权重（用真实数据回归校准的唯一位置）====================
// LLM 只输出 0-10 的维度分；总分永远在代码里用这组权重算。
// 权重存在 DB 表 xhs_weights，可在校准页调整、无需改代码/重启。
// 下面的常量只作为 DB 缺失时的兜底默认。

const DEFAULT_WEIGHTS: Record<XhsDimensionKey, number> = {
  titleHook: 1.4, // 点不点开——决定曝光转化，最重要
  opening: 1.2, // 前两行留不留人（小红书折叠很狠）
  resonance: 1.3, // 戳不戳中"这说的就是我"
  emotion: 1.1, // 小红书吃情绪 > 吃干货
  value: 0.9, // 值不值得收藏
  interaction: 0.8, // 结尾能不能勾出评论
};

/** 从 DB 读权重，缺失的维度用默认兜底 */
export function getWeights(): Record<XhsDimensionKey, number> {
  const weights = { ...DEFAULT_WEIGHTS };
  try {
    const db = getDatabase();
    const rows = db.prepare('SELECT dimension, weight FROM xhs_weights').all() as Array<{
      dimension: string;
      weight: number;
    }>;
    for (const r of rows) {
      if (r.dimension in weights) weights[r.dimension as XhsDimensionKey] = r.weight;
    }
  } catch {
    /* 表还没建 / 出错 → 用默认 */
  }
  return weights;
}

/** 更新单个维度权重（校准页用） */
export function setWeight(dimension: XhsDimensionKey, weight: number): void {
  const db = getDatabase();
  db.prepare(
    `INSERT INTO xhs_weights (dimension, weight, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(dimension) DO UPDATE SET weight = excluded.weight, updated_at = excluded.updated_at`
  ).run(dimension, weight, new Date().toISOString());
}

// ==================== A 部分：完整 Prompt ====================

const SCORING_PROMPT = `你是一个操盘过上百个爆款笔记的资深小红书运营。你评判一篇笔记「能不能爆」的眼光极毒，从不说客套话。你的任务是找出这篇笔记为什么"火不了"，而不是夸它。

默认假设：每篇笔记都是平庸的，除非它证明自己能抓住人。

## 评分维度（每项 0-10，附四档锚点）

### 1. 标题钩子 titleHook —— 决定用户点不点开
- 0-3：平铺直叙，像日记标题。"记录一下今天""我的日常分享"
- 4-6：有一个吸引点但不强。"分享几个好用的 App"
- 7-8：有明确钩子——制造好奇 / 具体利益 / 数字 / 反差。"月薪5千我是怎么存下10万的"
- 9-10：强钩子叠加（好奇+利益+情绪+身份）。"被裁员后我靠这个副业月入过万，普通人真的能复制"

### 2. 开头留人 opening —— 前两行决定留不留（小红书正文默认折叠，前两行是生死线）
- 0-3：开场是废话/客套/背景铺垫。"在当今这个时代……""大家好，我是……"
- 4-6：进入主题但不够抓人，需要读者有耐心。
- 7-8：第一句就抛出冲突/结果/悬念，让人想往下看。"我删掉了 90% 的 App，效率反而翻倍了。"
- 9-10：第一句直接命中痛点或制造强烈好奇，几乎不可能划走。

### 3. 痛点/身份共鸣 resonance —— 让人觉得"这说的就是我"
- 0-3：泛泛而谈，没有具体人群。"生活要积极向上"
- 4-6：有模糊人群但共鸣弱。"上班族要注意休息"
- 7-8：精准戳一类人的具体处境。"打工人下班只想瘫着，根本没力气做饭"
- 9-10：精准人群 + 说出他们没说出口的心声，强身份认同。"985毕业却在做客服，我不是不努力，是真的累了"

### 4. 情绪浓度 emotion —— 小红书吃情绪，冷静客观的内容很难爆
- 0-3：全程中立客观，像说明书/百科。
- 4-6：有一点情绪但很淡，理性主导。
- 7-8：有明确的情绪基调（爽/委屈/愤怒/治愈/羡慕），能被感染。
- 9-10：情绪强烈且真诚，读完会想转发或评论表达认同。

### 5. 价值密度 value —— 值不值得收藏（收藏是小红书强推荐信号）
- 0-3：读完什么也没得到，纯情绪或纯流水账。
- 4-6：有一点信息，但零散、不成体系、记不住。
- 7-8：有清晰可执行的干货/清单/步骤，读者会想收藏。
- 9-10：信息密度高且结构清晰，是那种"先收藏再说"的内容。

### 6. 互动引导 interaction —— 结尾能不能勾出评论
- 0-3：戛然而止，或以总结句结束，没有任何互动钩子。
- 4-6：有很弱的引导。"大家觉得呢"
- 7-8：有明确的提问/征集/争议点，能诱发评论。"你们下班后还有力气做饭吗？"
- 9-10：抛出强互动钩子（站队/求助/晒同款/接龙），评论区会自然热起来。

## 打分纪律（严格执行）
- 默认 5 分。靠证据往上加，有问题往下扣。
- 一篇"读起来通顺但没有记忆点"的笔记是 5-6 分，绝不是 8 分。
- 每个低于 8 分的维度，suggestion 必须是【具体的修改动作】，不能是空话。
  反例（禁止）："标题不够吸引，建议优化。"
  正例（要这样）："标题可改成『月薪5千存下10万』，加具体数字制造反差，比原标题更抓人。"
- AI 味检测：如果读起来像 AI 写的（空洞形容词堆砌、"值得注意的是"这类过渡词、工整的三段式、每段都总结），
  emotion 和 resonance 不得高于 5 分，并把 aiSmell 设为 true。

## 输出格式
只返回合法 JSON，不要 markdown 代码块，不要任何解释文字。结构如下：
{
  "dimensions": {
    "titleHook":   {"score": <0-10>, "reason": "<一句话诊断>", "suggestion": "<具体怎么改>"},
    "opening":     {"score": <0-10>, "reason": "...", "suggestion": "..."},
    "resonance":   {"score": <0-10>, "reason": "...", "suggestion": "..."},
    "emotion":     {"score": <0-10>, "reason": "...", "suggestion": "..."},
    "value":       {"score": <0-10>, "reason": "...", "suggestion": "..."},
    "interaction": {"score": <0-10>, "reason": "...", "suggestion": "..."}
  },
  "aiSmell": <true/false>,
  "topSuggestion": "<如果只改一处，最该改哪里，一句话>",
  "overall": "<2-3句整体诊断，说清这篇现在的水平和最大短板>"
}`;

const DIM_KEYS: XhsDimensionKey[] = [
  'titleHook',
  'opening',
  'resonance',
  'emotion',
  'value',
  'interaction',
];

// ==================== 代码加权（照抄 UI-review 的做法）====================

function calcTotalScore(dims: Record<XhsDimensionKey, XhsDimensionScore>): number {
  const weights = getWeights();
  let weightedSum = 0;
  let totalWeight = 0;
  for (const key of DIM_KEYS) {
    const w = weights[key];
    weightedSum += dims[key].score * w; // score 是 0-10
    totalWeight += w;
  }
  // 归一化到 0-100
  const score = (weightedSum / totalWeight) * 10;
  return Math.round(score);
}

// ==================== 主入口 ====================

export async function scoreNote(note: XhsNoteInput, userId: string): Promise<XhsScoringResult> {
  const nicheLine = note.niche ? `\n## 赛道/目标人群\n${note.niche}\n` : '';

  const contextPrompt = `${SCORING_PROMPT}
${nicheLine}
## 待评估笔记
标题：${note.title || '(未填写标题)'}

正文：
${note.body || '(未填写正文)'}

现在按上面的维度和纪律给这篇笔记打分。`;

  const { response } = await aiGateway(
    {
      messages: [{ role: 'user', content: contextPrompt }],
      temperature: 0.2,
      max_tokens: 1500,
    },
    { userId, source: 'xhs', operation: 'score-note' }
  );

  const content = response.choices[0]?.message?.content || '';
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return getDefaultResult();
  }

  let parsed: any;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return getDefaultResult();
  }

  const dims = {} as Record<XhsDimensionKey, XhsDimensionScore>;
  for (const key of DIM_KEYS) {
    const raw = parsed.dimensions?.[key] || {};
    dims[key] = {
      score: clamp(Math.round(Number(raw.score) || 0), 0, 10),
      reason: String(raw.reason || ''),
      suggestion: String(raw.suggestion || ''),
    };
  }

  const aiSmell = !!parsed.aiSmell;

  // 强制执行纪律：有 AI 味则 emotion / resonance 封顶 5 分（防 LLM 不听话）
  if (aiSmell) {
    dims.emotion.score = Math.min(dims.emotion.score, 5);
    dims.resonance.score = Math.min(dims.resonance.score, 5);
  }

  return {
    totalScore: calcTotalScore(dims),
    aiSmell,
    dimensions: dims,
    topSuggestion: String(parsed.topSuggestion || ''),
    overall: String(parsed.overall || ''),
  };
}

// ==================== helpers ====================

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function getDefaultResult(): XhsScoringResult {
  const emptyDim: XhsDimensionScore = { score: 5, reason: '评分暂不可用', suggestion: '' };
  const dims = {} as Record<XhsDimensionKey, XhsDimensionScore>;
  for (const key of DIM_KEYS) dims[key] = { ...emptyDim };
  return {
    totalScore: 50,
    aiSmell: false,
    dimensions: dims,
    topSuggestion: '',
    overall: 'AI 评分暂时不可用，请稍后重试。',
  };
}
