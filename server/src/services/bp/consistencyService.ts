import { jsonGateway, jsonFailMessage } from '../../core/llm/parseJson.js';
import { SAMPLING } from '../../core/llm/gateway.js';
import { BpError } from './factCardService.js';
import { splitPages, locateAt, norm } from './quotes.js';
import { bpMethod, CONSISTENCY_SLOT, CONSISTENCY_METHOD } from './prompts.js';

// 5.11 BP 内部一致性交叉表。这一章最危险的失败是**一条编出来的「口径冲突」**：报告上写着
// 「第 3 页说 200 万、第 9 页说累计」，读起来铁证如山，创业者照着去改一个根本不存在的矛盾，
// 投资人拿着去质问对方。所以三件事在代码里定（`buildConsistency`）：
//   ① 每条引文都要在 BP 里找得到，页码由代码算；找不到的那条引文丢掉；
//   ② 冲突 / 一致要**两处不同的**原文都核得上，少一处的整条丢掉 —— 不降成「单点无对照」：
//      降级之后那一行读起来是「BP 只提过一次」，又是一句假话；
//   ③ 统计数由代码数，丢掉了几条要说出来。

const MAX_TOKENS = 16_000;
const AI_TIMEOUT_MS = 240_000;

export type ConsistencyStatus = 'conflict' | 'consistent' | 'single';
export type Severity = '致命' | '重要' | '可选';

export interface ConsistencyItem {
  metric: string;
  status: ConsistencyStatus;
  /** 只有 conflict 才有。 */
  severity: Severity | null;
  /** doc：null = BP 本身；否则「附件K《名》」。BP 和附件说法不一样，正是这张表最有用的那种冲突。 */
  values: { quote: string; page: number | null; doc: string | null }[];
  impact: string;
}

export interface Consistency {
  items: ConsistencyItem[];
  counts: Record<ConsistencyStatus, number>;
  /** 模型报了、但原文核不上被丢掉的条目（指标名）。 */
  dropped: string[];
  promptSource: 'skill' | 'default';
}

const STATUSES = new Set<ConsistencyStatus>(['conflict', 'consistent', 'single']);
const SEVERITIES = new Set<Severity>(['致命', '重要', '可选']);

/** 纯函数：模型原始输出 → 核验过的交叉表。测试直接调它。 */
export function buildConsistency(parsed: any, text: string): Omit<Consistency, 'promptSource'> {
  const pages = splitPages(text);
  const items: ConsistencyItem[] = [];
  const dropped: string[] = [];

  for (const r of Array.isArray(parsed?.items) ? parsed.items : []) {
    const metric = String(r?.metric || '').trim();
    if (!metric) continue;
    const status: ConsistencyStatus = STATUSES.has(r?.status) ? r.status : 'single';

    const seen = new Set<string>();
    const values: ConsistencyItem['values'] = [];
    for (const v of Array.isArray(r?.values) ? r.values : []) {
      const quote = String(v?.quote || '').trim().replace(/^[「“"]|[」”"]$/g, '');
      const at = locateAt(quote, pages);
      const key = norm(quote);
      if (at === undefined || seen.has(key)) continue;
      seen.add(key);
      values.push({ quote, page: at.page, doc: at.doc });
    }

    const need = status === 'single' ? 1 : 2;
    if (values.length < need) {
      dropped.push(metric);
      continue;
    }
    const severity: Severity | null =
      status === 'conflict' ? (SEVERITIES.has(r?.severity) ? r.severity : '重要') : null;
    items.push({ metric, status, severity, values, impact: String(r?.impact || '').trim() });
  }

  // 冲突排前面、致命排最前：投资人先看到的那几条，报告里也要先出现。
  const rank = (i: ConsistencyItem) =>
    i.status === 'conflict' ? ['致命', '重要', '可选'].indexOf(i.severity!) : i.status === 'single' ? 3 : 4;
  items.sort((a, b) => rank(a) - rank(b));

  const counts = { conflict: 0, consistent: 0, single: 0 };
  for (const i of items) counts[i.status]++;
  return { items, counts, dropped };
}

function buildMessages(method: string, text: string) {
  // 输出格式由代码定，不进后台那份可编辑的文字（见 prompts.ts）。
  const system = `${method}

---
## 输出（系统规定，必须遵守）
- 每条 values 里的 quote 必须**逐字照抄** BP 原文中一段连续文字（10-60 字，不改写、不拼接、不加省略号、不写页码）。页码由系统按引文位置自己算。
- 口径冲突 / 多页一致：values 至少两条，且是不同位置的两段原文。单点无对照：values 一条。
- status 只能是 conflict / consistent / single；severity 只对 conflict 填，只能是 致命 / 重要 / 可选。
- 原文里有附件时，BP 和附件对同一指标说法不一样（如 BP 写年收入 2000 万、附件里的财务表是 800 万）也是口径冲突，而且往往是最重要的那种。
- 没发现任何可比对的指标就给空数组，不要凑。

只输出 JSON：
{"items":[{"metric":"","status":"","severity":"","values":[{"quote":""}],"impact":""}]}`;
  return [
    { role: 'system', content: system },
    { role: 'user', content: `以下是 BP 全文（「--- 第 N 页 ---」是分页标记）。如果后面有「===== 附件K《…》 =====」，那是用户和 BP 一起提供的补充材料（「--- 附件K 第 N 页 ---」是附件的分页），不是 BP 本身；标「图片识别」的附件是模型从图片转写的文字。引用原文时附件里的句子同样要逐字照抄：\n\n${text}` },
  ];
}

export async function runConsistency(input: { text: string; filename: string; userId: string }): Promise<Consistency> {
  const method = bpMethod(CONSISTENCY_SLOT, CONSISTENCY_METHOD);
  const { parsed, raw, finish, reasoningTokens, noThinkingRequested } = await jsonGateway<any>(
    () => ({
      messages: buildMessages(method.text, input.text),
      ...SAMPLING.analytic,
      max_tokens: MAX_TOKENS,
      response_format: { type: 'json_object' },
    }),
    {
      userId: input.userId,
      source: 'bp',
      operation: 'consistency',
      tier: 'strong',
      timeoutMs: AI_TIMEOUT_MS,
      maxRetries: 0,
      retryOnBusy: true,
      noThinking: true,
      requestSummary: `${input.filename} · 一致性审计`,
    },
    { attempts: 1 }
  );
  if (!parsed) {
    throw new BpError(
      jsonFailMessage('一致性审计', { raw, finish, reasoningTokens, budget: MAX_TOKENS, noThinkingRequested }),
      502
    );
  }
  return { ...buildConsistency(parsed, input.text), promptSource: method.origin };
}
