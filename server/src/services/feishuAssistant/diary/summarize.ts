import { aiGateway, SAMPLING } from '../../../core/llm/gateway.js';
import { withSummarySlot } from '../concurrency.js';
import { fmtForHuman } from '../actions/time.js';
import type { DiaryRecordRow } from './store.js';

// 复盘：把一段时间的项目日志交给 LLM 归纳。
//
// ── 两条边界 ──
// 1. **LLM 只输出 JSON，markdown 由代码渲染。** 让模型直接产出成品文案的话，
//    小节标题、要不要加表情、有没有漏掉「记录数」全凭它当次心情，
//    而这段文字要发到群里、还要存进复盘表。结构固定在代码里，模型只填内容。
// 2. **原始记录一个字都不改。** 这里产出的是**摘要**，是派生物；
//    记录本身（store 里那份、多维表格里那份）永远是用户当时说的原话。
//
// 用 fast 档：这是走量的成文任务（几十条记录 → 几百字），
// 不像意图解析那样必须吐严格 JSON 就崩不得 —— 但我们仍然要 json_object，
// 所以下面有一整套「解析不出来就退化成清单」的兜底。
//
// 额度：一次复盘 = 1 次 LLM 调用（意图解析那次另算，所以实际是 2 次）。
// 这件事要在文档里说出来，否则 feishu 应用额度配成 10 的用户会觉得算错了。

/** 单次复盘最多喂多少条记录。 */
const MAX_RECORDS = 300;

/** 喂给模型的单条记录最长多少字。超长的截断，避免一条几千字的记录挤掉其余全部。 */
const MAX_RECORD_CHARS = 500;

/** 群里回帖的长度上限。超过就截断并指向复盘表 —— 群里刷屏没人会读。 */
export const MAX_REPLY_CHARS = 1500;

export interface SummaryResult {
  /** 渲染好的 markdown 全文。存库、进复盘表用这一份（不截断）。 */
  markdown: string;
  /** 实际喂给模型的记录条数（可能小于范围内的总数，见 MAX_RECORDS）。 */
  usedCount: number;
  /** 因为超过 MAX_RECORDS 被丢掉的条数。必须说出来。 */
  droppedCount: number;
}

interface RawSummary {
  progress?: unknown;
  issues?: unknown;
  next?: unknown;
  overview?: unknown;
}

const SYSTEM_PROMPT = `你是项目管理助理。用户会给你一个项目在某段时间内的**工作日志**（按时间顺序，每条是当事人当时随手记下的原话）。
请你归纳成一份复盘，输出 JSON。

只输出一个 JSON 对象，不要解释文字、不要 markdown 代码块：

{
  "overview": "一到两句话概述这段时间的整体情况",
  "progress": ["关键进展，每条一句话", "..."],
  "issues": ["需要注意的问题、风险、卡点", "..."],
  "next": ["从日志里能看出的待办或下一步", "..."]
}

要求：
1. **只根据日志里真实写了的内容归纳，不许推测、不许补充日志里没有的事。**
   日志很少、信息不足时就少写几条，或者让对应数组为空 —— 编出来的"进展"会被当成真的。
2. 每条尽量点出**具体的事**（谁、什么、什么结论），不要写「推进了相关工作」这种空话。
3. 同一件事在多条日志里被反复提到时合并成一条，并体现出它的变化过程。
4. issues 只写日志里**确实表达了担心或受阻**的地方，没有就给空数组，不要为了凑格式而编。
5. next 同理：日志里没提到下一步就给空数组。
6. 用中文，语气平实。`;

/**
 * 生成复盘。
 *
 * 调用方保证 records 非空（空范围不该花 AI 额度，也不该说「没进展」——
 * 那是「这段时间没人记录」，是两件不同的事）。
 */
export async function summarizeRecords(opts: {
  userId: string;
  projectName: string;
  rangeLabel: string;
  records: DiaryRecordRow[];
}): Promise<SummaryResult> {
  const all = opts.records;
  // 超量时保留**最近**的那些：复盘最需要的是靠后发生的事。
  const used = all.length > MAX_RECORDS ? all.slice(-MAX_RECORDS) : all;
  const droppedCount = all.length - used.length;

  const lines = used
    .map((r) => {
      const who = r.author_name ? `${r.author_name}：` : '';
      const body =
        r.content.length > MAX_RECORD_CHARS
          ? `${r.content.slice(0, MAX_RECORD_CHARS)}…（本条过长已截断）`
          : r.content;
      return `[${fmtForHuman(r.created_ms)}] ${who}${body}`;
    })
    .join('\n');

  // 走并发闸。**这次调用比意图解析重得多**（几百条日志进去、上千 token 出来），
  // 而它以前完全在闸外面：早上大家集体复盘时，限流全撞在这儿，
  // 而闸的负载快照显示一切正常。和意图解析共用同一个池子，见 concurrency.ts。
  const { response } = await withSummarySlot(() =>
    aiGateway(
      {
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: `项目：${opts.projectName}\n时间范围：${opts.rangeLabel}\n共 ${used.length} 条日志：\n\n${lines}`,
          },
        ],
        response_format: { type: 'json_object' },
        max_tokens: 1500,
        ...SAMPLING.analytic,
      },
      {
        userId: opts.userId,
        // source 必须是 'feishu'（AI_APPS 白名单里的那个）：它同时是按应用配
        // token / 配额的 scope key，写个新值会让这个功能永远匹配不到配置。
        // 有测试扫这件事。
        source: 'feishu',
        operation: 'diary_review',
        requestSummary: `${opts.projectName} ${opts.rangeLabel}`,
        tier: 'fast',
      }
    )
  );

  const raw = response.choices?.[0]?.message?.content?.trim() ?? '';
  const parsed = parseJson(raw);

  // 解析不出来时**不抛错**：记录是真的、范围是真的，只有归纳这一步歪了。
  // 退化成「按时间列出原始记录」仍然是有用的输出，而且诚实地说明了发生了什么。
  if (!parsed) {
    return {
      markdown: renderFallback(opts.projectName, opts.rangeLabel, used, droppedCount),
      usedCount: used.length,
      droppedCount,
    };
  }

  return {
    markdown: render(opts.projectName, opts.rangeLabel, parsed, used.length, droppedCount),
    usedCount: used.length,
    droppedCount,
  };
}

function parseJson(raw: string): RawSummary | null {
  if (!raw) return null;
  const tryParse = (s: string): RawSummary | null => {
    try {
      const v = JSON.parse(s);
      return v && typeof v === 'object' && !Array.isArray(v) ? (v as RawSummary) : null;
    } catch {
      return null;
    }
  };
  // 同 intent.ts：有些模型无视 json_object 还是套 ```json 围栏。
  return tryParse(raw) ?? tryParse(raw.match(/\{[\s\S]*\}/)?.[0] ?? '');
}

/** 取字符串数组。模型可能给单个字符串，也可能给对象数组 —— 都兜掉。 */
function lines(v: unknown): string[] {
  const arr = Array.isArray(v) ? v : typeof v === 'string' ? [v] : [];
  return arr
    .map((x) => {
      if (typeof x === 'string') return x.trim();
      // 偶尔会给 {title, detail} 这种。拼起来比丢掉好。
      if (x && typeof x === 'object') {
        return Object.values(x as Record<string, unknown>)
          .filter((s): s is string => typeof s === 'string')
          .join(' — ')
          .trim();
      }
      return '';
    })
    .filter(Boolean);
}

function render(
  projectName: string,
  rangeLabel: string,
  s: RawSummary,
  usedCount: number,
  droppedCount: number
): string {
  const parts = [`📋 **${projectName}** · ${rangeLabel}`, `共 ${usedCount} 条记录`];
  if (droppedCount > 0) {
    // 截断必须说出来，而且要说清截掉的是哪一头。
    parts.push(`⚠️ 记录太多，本次只归纳了最近 ${usedCount} 条，更早的 ${droppedCount} 条未纳入。`);
  }

  const overview = typeof s.overview === 'string' ? s.overview.trim() : '';
  if (overview) parts.push(`\n${overview}`);

  const sections: Array<[string, string[]]> = [
    ['关键进展', lines(s.progress)],
    ['需要注意', lines(s.issues)],
    ['下一步', lines(s.next)],
  ];
  for (const [title, items] of sections) {
    // 空小节整个不渲染。留一个「需要注意：（无）」会让人以为模型判断过了没问题，
    // 而实际上更常见的原因是日志里压根没提。
    if (!items.length) continue;
    parts.push(`\n**${title}**`);
    parts.push(items.map((x) => `- ${x}`).join('\n'));
  }

  // 三个小节全空：说明日志里确实没有可归纳的东西。这句话必须写出来，
  // 否则回帖只有标题和条数，看起来像是功能坏了。
  if (sections.every(([, items]) => !items.length) && !overview) {
    parts.push('\n这段时间的记录里没有能归纳出的明确进展。原始记录可以在日志表里逐条看。');
  }

  return parts.join('\n');
}

/** 归纳失败时的退路：原样列出记录。诚实说明「这是原始记录，不是总结」。 */
function renderFallback(
  projectName: string,
  rangeLabel: string,
  records: DiaryRecordRow[],
  droppedCount: number
): string {
  const parts = [
    `📋 **${projectName}** · ${rangeLabel}`,
    `共 ${records.length} 条记录`,
    '\n⚠️ 这次归纳没成功（模型没返回可用结果），下面是**原始记录**，不是总结：',
  ];
  if (droppedCount > 0) parts.push(`（更早的 ${droppedCount} 条未列出）`);
  parts.push(
    records
      .map((r) => `- [${fmtForHuman(r.created_ms)}] ${r.author_name ? `${r.author_name}：` : ''}${r.content}`)
      .join('\n')
  );
  return parts.join('\n');
}

/**
 * 群里回帖用的版本。太长就截断并指向复盘表。
 *
 * 截断这件事必须说出来 —— 一段在句子中间断掉的总结，读起来像模型崩了。
 */
export function forReply(markdown: string, reviewUrl: string): string {
  if (markdown.length <= MAX_REPLY_CHARS) {
    return reviewUrl ? `${markdown}\n\n[完整复盘记录](${reviewUrl})` : markdown;
  }
  const cut = markdown.slice(0, MAX_REPLY_CHARS);
  const tail = reviewUrl
    ? `\n\n…（内容较长，群里只显示前一部分）[看完整复盘](${reviewUrl})`
    : '\n\n…（内容较长，群里只显示前一部分，完整版已存进项目的「复盘」表）';
  return cut + tail;
}
