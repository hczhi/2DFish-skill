import { aiGateway, SAMPLING } from '../../../core/llm/gateway.js';
import { withSummarySlot } from '../concurrency.js';
import { fmtForHuman } from '../actions/time.js';
import type { ChatMessage, SkipCounts } from './chatHistory.js';

// 群聊摘要：把一段群聊记录交给 LLM，抽成几条能进日志的信息。
//
// ── 和 summarize.ts（复盘）的区别，以及为什么不合并 ──
// 复盘读的是**已经落库的日志**（人手挑过的、原话），产出是给人读的一篇总结，
// 存进「复盘」表，不进日志。
// 这里读的是**没人挑过的群聊**，产出要**进日志表**（req 7 明确要求）。
// 两件事的失败形态完全不同：
//   - 复盘写歪了，用户重说一句就能再来一份，旧的那份在复盘表里碍不着谁；
//   - 摘要写歪了，那句模型编的话就**永久躺在日志里，和用户的原话并排**，
//     而日志表存在的唯一理由是「当时到底怎么说的」。
// 所以这里的 prompt 比复盘严得多，而且产出的每一条都要求带上说话的人 ——
// 「有人提到预算要追加」和「李四说预算要追加」在项目里是两回事。
// 落库时 origin='chat_digest'（migration 069），正文前面还要顶一行显式标记。
//
// ── 只抽「值得进日志的」，抽不到就说没有 ──
// 群聊里绝大部分内容不该进日志（约午饭、闲聊、「收到」）。模型的默认倾向是
// "给点什么出来"，所以 prompt 里反复要求宁可返回空数组。
// 空数组不是失败：一句「今天群里没有需要记的事」是个诚实且有用的答复，
// 而编三条「继续推进相关工作」会把日志表变成噪音，还骗过了以后翻表的人。

/** 一次摘要最多喂多少条消息。超出取**最近**的 —— 一天的对话里结论在后面。 */
const MAX_MESSAGES = 200;

/** 一条摘要最长多少字。进日志的东西要能一眼读完。 */
const MAX_ITEM_CHARS = 200;

/** 最多抽几条。再多就不是摘要了，而是把群聊抄进日志。 */
const MAX_ITEMS = 8;

export interface DigestItem {
  /** 一条能进日志的信息，已经带上说话的人。 */
  text: string;
}

export interface DigestResult {
  items: DigestItem[];
  /** 实际喂给模型的条数。 */
  usedCount: number;
  /** 因为超过 MAX_MESSAGES 被丢掉的条数。必须说出来。 */
  droppedCount: number;
}

const SYSTEM_PROMPT = `你是项目群的记录员。用户会给你一段**项目群的聊天记录**，请从里面挑出**值得写进项目日志**的信息。

只输出一个 JSON 对象，不要解释文字、不要 markdown 代码块：

{
  "items": ["李四说客户要求把 logo 改大，下周一之前给新版", "..."]
}

什么算"值得写进项目日志"：
- 决定、结论（定了什么方案、选了哪个版本）
- 客户/上级提出的要求和修改意见
- 进度事实（某件事做完了、某个东西到货了、某人什么时候进场）
- 问题、风险、卡点（缺人、缺料、时间来不及、等对方回复）
- 钱和数量（花了多少、追加多少预算、买了几台）
- 时间安排（哪天开会、哪天交片、谁哪天到）

什么**不要**写：
- 闲聊、约饭、玩笑、表情、「收到」「好的」「辛苦了」
- 纯粹的提问而没有答复（「logo 谁在做？」——除非有人答了）
- 客套和情绪表达

硬性要求：
1. **每一条都必须写清是谁说的**（用记录里给出的名字），因为这些内容会和当事人自己写的日志并排存在同一张表里。
2. **只写记录里真实说过的事，一个字都不许推测、不许补充、不许合并成"相关工作"这类空话。**
   你写下的每一条都会永久留在项目日志里，被以后的人当成事实来读。
3. 拿不准一条到底值不值得记，就**不记**。
4. 没有任何值得记的内容时返回 \`{"items": []}\` —— 这是完全正常的结果，
   群里一整天只聊闲天是常事。**不要为了凑数编内容。**
5. 同一件事在多条消息里被反复讨论时合并成一条，并写出最后的结论。
6. 每条控制在一句话到两句话，用中文，语气平实。
7. 最多 ${MAX_ITEMS} 条。真的很多时只留最重要的。`;

/**
 * 抽摘要。
 *
 * 调用方保证 messages 非空（一条消息都没有的时候不该花 AI 额度 ——
 * 那是"没人说话"，和"聊了但没正事"是两件不同的事，回帖话术也不同）。
 */
export async function digestChat(opts: {
  userId: string;
  projectName: string;
  rangeLabel: string;
  messages: ChatMessage[];
  /** 只用来放进 prompt 的上下文说明（读了多少、丢了多少）。 */
  skipped?: SkipCounts;
}): Promise<DigestResult> {
  const all = opts.messages;
  const used = all.length > MAX_MESSAGES ? all.slice(-MAX_MESSAGES) : all;
  const droppedCount = all.length - used.length;

  const lines = used
    .map((m) => `[${fmtForHuman(m.ms)}] ${m.senderName || '某人'}：${m.text}`)
    .join('\n');

  // 和复盘共用同一个并发池：两者都是「读一大堆东西出一段话」的重调用，
  // 池子分开等于没有上限（见 concurrency.ts）。
  const { response } = await withSummarySlot(() =>
    aiGateway(
      {
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content:
              `项目：${opts.projectName}\n时间范围：${opts.rangeLabel}\n` +
              `以下是这段时间的群聊记录，共 ${used.length} 条：\n\n${lines}`,
          },
        ],
        response_format: { type: 'json_object' },
        max_tokens: 1200,
        ...SAMPLING.analytic,
      },
      {
        // source 必须是 'feishu'（AI_APPS 白名单里那个，同时是按应用配额的 scope key）。
        userId: opts.userId,
        source: 'feishu',
        operation: 'diary_chat_digest',
        requestSummary: `${opts.projectName} 群聊摘要 ${opts.rangeLabel}`,
        tier: 'fast',
      }
    )
  );

  const raw = response.choices?.[0]?.message?.content?.trim() ?? '';
  return { items: parseItems(raw), usedCount: used.length, droppedCount };
}

/**
 * 解析模型的输出。
 *
 * 解析不出来时返回**空数组**，而不是像复盘那样退化成「原样列出记录」——
 * 这两个功能的产出去处不一样：复盘的退路是发一段文字到群里（诚实标注
 * 「这是原始记录，不是总结」就没问题），而这里的产出要**写进日志表**。
 * 把 200 条群聊原样倒进日志表是不可接受的降级，那比什么都不记糟得多。
 * 调用方看到空数组时回一句「这次没抽出可记的内容」，用户重说一遍即可。
 */
function parseItems(raw: string): DigestItem[] {
  if (!raw) return [];
  const obj = tryParse(raw) ?? tryParse(raw.match(/\{[\s\S]*\}/)?.[0] ?? '');
  if (!obj) return [];
  const arr = Array.isArray(obj.items) ? obj.items : [];
  const out: DigestItem[] = [];
  for (const x of arr) {
    const text = typeof x === 'string' ? x.trim() : itemFromObject(x);
    if (!text) continue;
    out.push({
      text: text.length > MAX_ITEM_CHARS ? `${text.slice(0, MAX_ITEM_CHARS)}…` : text,
    });
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

function tryParse(s: string): { items?: unknown } | null {
  if (!s) return null;
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as { items?: unknown }) : null;
  } catch {
    return null;
  }
}

/** 模型偶尔给 `{who, what}` 这种。拼起来比丢掉好。 */
function itemFromObject(x: unknown): string {
  if (!x || typeof x !== 'object') return '';
  return Object.values(x as Record<string, unknown>)
    .filter((v): v is string => typeof v === 'string')
    .join('：')
    .trim();
}
