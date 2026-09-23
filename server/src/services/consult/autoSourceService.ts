import { jsonGateway } from '../../core/llm/parseJson.js';
import { SAMPLING } from '../../core/llm/gateway.js';
import { stageByKey } from './stages.js';
import { isSearchEnabled, webSearch } from '../webSearchService.js';
import { adoptSources, countSources, MAX_SOURCES_PER_PROJECT } from './sourceStore.js';
import type { ConsultProject } from './projectStore.js';

// **每一次分析之前**都跑的自动联网：1 次 AI 调用出检索词 → 并行搜 → 落库成
// `auto = 1` 的资料（migration 110），这一步的 prompt 于是能读到外部事实。
// 一键四看传四个 key（一次出四组词），单步分析（出草稿 / 出待定方向 / 出候选方向）传一个。
//
// **它没有开关**：界面上原来那颗「联网查资料」按钮已经去掉了 —— 有开关的时候默认那条路
// 是不联网的，而不联网那一版的表格、结论、置信度和联网那一版在屏幕上一模一样，
// 于是绝大多数报告其实是按模型内置知识编的。手动搜那条路留着，它的作用变成「补一条机器
// 没搜到的、并且是我核过的（L1）」。
//
// 这一段的每一种失败都会「静默成功」，所以全部收进 `AutoSearchOutcome.note` 交给界面显示：
// 没配 Tavily key / 出词那次调用挂了 / 搜了但一条都没回 / 只搜到一半 —— 四种在屏幕上
// 的表现完全一样（分析照样跑完、正文照样通顺），差别只在那几节数字是查来的还是编的。
// 报告里唯一的痕迹是证据级别（L1? vs L2），而那一栏在定稿之后才出现一次。
//
// 代价要在界面上说：每次分析因此多花 1 次 AI 额度（出词那一次）。不说的话他按 10 次/天
// 算着用，实际一半就没了，而报错是一句突然冒出来的 429。

/** 每一步搜几个词、每个词收几条。搜太多的话一键四看那四步加起来能一口吃掉 40 条的上限。 */
const QUERIES_PER_STAGE = 2;
const RESULTS_PER_QUERY = 3;
/** 一次自动联网最多落库多少条（上限之内还要给他手动采纳留位置）。 */
const MAX_AUTO_PER_RUN = 16;
/**
 * 出词那次调用的超时和额度。它只要吐一个 200 token 的 JSON，所以给得比出草稿短得多
 * —— 长了的话「一键」那颗按钮要转两分钟才开始真正的分析，而界面上看不出它在等什么。
 */
const QUERY_TIMEOUT_MS = 60_000;
const MAX_TOKENS_QUERY = 2000;

export interface AutoSearchOutcome {
  /**
   * 'off' 没配 key ｜ 'ok' 搜到并落库了 ｜ 'empty' 搜了但没有可用结果 ｜
   * 'failed' 出词或检索整段失败。**四种都要在界面上说出来**（见文件头）。
   */
  status: 'off' | 'ok' | 'empty' | 'failed';
  /** 落库条数（去重后）。 */
  added: number;
  /** 实际用过的检索词，原样回给界面 —— 搜偏了他只能从这里看出来（比如搜到了同名的另一家）。 */
  queries: string[];
  /**
   * 这次真正打了几次模型（出词那一次：0 或 1）。
   *
   * 平台配额在 gateway 里按次自己扣，这个数是给**第三方 SDK 那本账**用的
   * （`chargeExtraSdkAiCalls`）：那边的中间件按「一个请求 1 次」扣，而分析这条路现在
   * 打两次。不补的话第三方那一档相当于打了五折，而后台显示的用量是个完全正常的数字。
   */
  aiCalls: number;
  /** 给用户看的一句话，含真实成因。 */
  note: string;
}

interface QuerySet {
  [stageKey: string]: string[];
}

/**
 * 让 AI 按这几步各自要查什么出检索词。**一次调用出所有组**（不是每步一次）：
 * 每步各来一次的话额度翻倍，而四组词本来就该互相错开（同一批词搜四遍只会拿回同一批网页）。
 */
async function buildQueries(
  userId: string,
  project: ConsultProject,
  stageKeys: string[]
): Promise<{ queries: QuerySet; err?: string }> {
  const asks = stageKeys
    .map((k) => {
      const s = stageByKey(k);
      return `- ${k}（${s?.label || k}）：${s?.question || ''}`;
    })
    .join('\n');

  const system = `你在给一家企业的品牌诊断准备**联网检索词**。只出检索词，不做分析。

规则：
1. 每一步 ${QUERIES_PER_STAGE} 条词，一条一行式的短语（6-20 个字），像人在搜索框里敲的那样，不是一句问句。
2. 词里**必须带上能锁定对象的专有名词**（公司名 / 品牌名 / 具体行业名 / 具体竞品名）。
   只写「市场规模 增速」这类通用词的话，搜回来的是随便哪个行业的稿子，而它会被当成这家公司的行业数据用。
3. 公司名很可能撞上同名的别家，所以带上一个能区分的限定词（所在城市、主营、母公司、行业）。
4. 需要时效的（市场规模、份额、融资、政策）在词尾加年份；不需要的不要硬加。
5. 客户资料里没提到的竞品名/数字**不要自己编**进检索词 —— 编出来的词会真的搜到东西，
   而那东西和这家公司无关，正文却会照它写。

只输出 JSON：{"queries": {"<步骤 key>": ["词1", "词2"]}}`;

  const user = `【客户资料】
${project.brief.slice(0, 6000)}

【品牌名】${project.brand_name}

【要查的步骤，各自的问题】
${asks}`;

  const { parsed, raw, finish } = await jsonGateway<{ queries?: QuerySet }>(
    () => ({
      messages: [
        { role: 'system' as const, content: system },
        { role: 'user' as const, content: user },
      ],
      ...SAMPLING.analytic,
      max_tokens: MAX_TOKENS_QUERY,
      response_format: { type: 'json_object' },
    }),
    {
      userId,
      source: 'consult',
      operation: 'auto-search:queries',
      tier: 'strong',
      requestSummary: `${project.brand_name} · 分析前自动联网出检索词`,
      timeoutMs: QUERY_TIMEOUT_MS,
      // 见硬规则 2：这一步要的只是一小段 JSON，耗时和截断全来自思维链。
      noThinking: true,
    }
  );

  if (!parsed?.queries) {
    return {
      queries: {},
      err: finish === 'length' ? '出检索词那次被截断了（思维链吃掉了额度）' : `出检索词那次没返回可用 JSON（${raw.slice(0, 80) || '空返回'}）`,
    };
  }

  const out: QuerySet = {};
  for (const k of stageKeys) {
    const list = Array.isArray(parsed.queries[k]) ? parsed.queries[k] : [];
    const clean = list
      .map((q) => String(q ?? '').trim().slice(0, 120))
      .filter(Boolean)
      .slice(0, QUERIES_PER_STAGE);
    if (clean.length) out[k] = clean;
  }
  return { queries: out };
}

/**
 * 自动联网一次。**绝不抛错** —— 它是每次分析的前置步骤，抛出去会把分析整个挡掉，
 * 而联网失败本身不该阻止分析（没有外部资料照旧能按 L2/L3 写，只是要说出来）。
 */
export async function autoSearchForStages(
  userId: string,
  project: ConsultProject,
  stageKeys: string[]
): Promise<AutoSearchOutcome> {
  if (!isSearchEnabled()) {
    return {
      status: 'off',
      added: 0,
      queries: [],
      aiCalls: 0,
      note:
        '这次**没有联网**：管理员还没在「系统配置 > 联网搜索」里填 Tavily key。' +
        '这次分析只用客户资料（L2）和模型内置知识给区间（L3）写 —— 需要外部事实（市场规模、竞品动作）请自己贴进客户资料。',
    };
  }

  // 上限之内还剩多少位置。满了不搜：搜了也存不进去，而「搜过了」和「存进去了」
  // 在界面上是同一句话。
  const room = Math.min(MAX_SOURCES_PER_PROJECT - countSources(project.id), MAX_AUTO_PER_RUN);
  if (room <= 0) {
    return {
      status: 'empty',
      added: 0,
      queries: [],
      aiCalls: 0,
      note: `这次**没有联网**：这个项目的联网资料已经有 ${countSources(project.id)} 条（上限 ${MAX_SOURCES_PER_PROJECT}）。先在右栏「联网查资料」里删掉用不上的那些，再重新分析。`,
    };
  }

  let queries: QuerySet;
  try {
    const built = await buildQueries(userId, project, stageKeys);
    if (built.err) {
      return {
        status: 'failed',
        added: 0,
        queries: [],
        aiCalls: 1,
        // 成因原文带出去：这一步失败和「搜不到东西」解法完全不同（前者重试/换模型，
        // 后者要他自己贴资料），合成一句「联网失败」的话他会一直重试。
        note: `这次**没有联网**（${built.err}）。分析照旧在跑，但那几节数字只能按客户资料和模型内置知识写（L2/L3）。要外部事实的话重跑一次，或者自己在「联网查资料」里搜了采纳。`,
      };
    }
    queries = built.queries;
  } catch (err) {
    return {
      status: 'failed',
      added: 0,
      queries: [],
      aiCalls: 1,
      note: `这次**没有联网**（出检索词那次调用失败：${(err as Error).message}）。分析照旧在跑，正文按 L2/L3 写。`,
    };
  }

  const flat = Object.entries(queries).flatMap(([k, qs]) => qs.map((q) => ({ stageKey: k, q })));
  if (!flat.length) {
    return {
      status: 'empty',
      added: 0,
      queries: [],
      aiCalls: 1,
      note: '这次**没有联网**：AI 一条检索词都没给出来（通常是客户资料太短，锁不定要查谁）。把客户资料补厚一点再试，或者自己在「联网查资料」里搜。',
    };
  }

  // 四组并行搜。**逐条 allSettled** —— 一条搜挂了不该把其余几条一起丢掉
  // （丢掉之后「这个词没结果」和「这次没搜」在界面上是同一句）。
  const hits = await Promise.allSettled(
    flat.map((f) => webSearch(f.q, { maxResults: RESULTS_PER_QUERY }))
  );

  const failedQueries: string[] = [];
  let added = 0;
  let left = room;
  const usedQueries: string[] = [];
  for (let i = 0; i < flat.length; i++) {
    const h = hits[i];
    const { stageKey, q } = flat[i];
    if (h.status === 'rejected') {
      failedQueries.push(q);
      continue;
    }
    usedQueries.push(q);
    if (left <= 0) continue;
    const items = h.value
      .filter((r) => r.url && r.content)
      .slice(0, left)
      .map((r) => ({ title: r.title, url: r.url, snippet: r.content, published: r.published }));
    if (!items.length) continue;
    // auto = true：没有这个参数它们会当成「他逐条核过的 L1」进 prompt（migration 110）
    const r = adoptSources(project.id, stageKey, q, items, true);
    added += r.added;
    left -= r.added;
  }

  if (!added) {
    const why = failedQueries.length
      ? `${failedQueries.length}/${flat.length} 个词检索失败（key 过期 / 配额用完 / 网络）`
      : '搜到的结果一条都用不了（没有正文摘要）';
    return {
      status: failedQueries.length ? 'failed' : 'empty',
      added: 0,
      queries: usedQueries,
      aiCalls: 1,
      note: `这次**联网没拿到资料**：${why}。搜的词是：${flat.map((f) => f.q).join('、')}。分析照旧在跑，正文按 L2/L3 写。`,
    };
  }

  const tail = failedQueries.length
    ? ` 另有 ${failedQueries.length} 个词检索失败（${failedQueries.join('、')}），那部分事实这次没查到。`
    : '';
  return {
    status: 'ok',
    added,
    queries: usedQueries,
    aiCalls: 1,
    // 「未人工核对」必须写在这句里：他看到「自动查到 12 条」会当成已经核实过的证据，
    // 而这几条谁都没看过（prompt 里也按这一档要求模型标注）。
    note:
      `自动联网查到 **${added}** 条资料，已经喂给这次分析（搜的词：${usedQueries.join('、')}）。` +
      `这些是机器搜的、**没有人核对过**，所以证据级别记 L1?、正文引用时会标「未人工核对」——` +
      `关键数字请自己点开出处看一眼；用不上的可以在「联网查资料」里删掉。${tail}`,
  };
}

/**
 * 联网结论落进对话/定稿记录的那一句。**只在这里拼一份** ——
 * 各处自己拼的话改了一处另一处照旧，而那句话是「这一版到底查没查过网」事后唯一的痕迹。
 */
export function searchNoteText(note: string): string {
  return `🌐 这一版的联网情况：${note}`;
}
