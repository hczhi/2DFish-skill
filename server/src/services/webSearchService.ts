import { getDatabase } from '../db/index.js';
import { tryDecryptSecret } from '../core/secrets.js';

// 联网搜索服务（Tavily）——为"陪写联网补料"提供带来源的外部素材。
// key 存在 system_config.web_search_api_key（管理员在系统配置里填），没填则视为未启用。
// 只做"取回带来源的干净摘要"，不做判断——判断/采纳交给用户，来源可见，契合"区分证据/网传"的纪律。

export interface WebSearchResult {
  title: string;
  url: string;
  /** Tavily 已抽好的与 query 相关的摘要片段 */
  content: string;
  /** 相关度 0-1（Tavily 提供），用于排序/过滤 */
  score: number;
  /**
   * 发布日期（Tavily 只在部分结果上给，常常是空串）。
   * 空的时候调用方必须显示「未标日期」而不是省略这一栏 ——
   * 三年前的旧数字和今年的读起来一模一样。
   */
  published: string;
  /** 整页正文（只有 `rawContent: true` 时才有，否则空串）。 */
  raw: string;
}

/** 读取搜索 key，没配置返回 null（调用方据此降级）。 */
export function getSearchApiKey(): string | null {
  try {
    const db = getDatabase();
    const row = db
      .prepare("SELECT value FROM system_config WHERE key = 'web_search_api_key'")
      .get() as { value: string } | undefined;
    // 库里是密文（migrations/050）。解不开按「未配置」处理——
    // 本函数的契约就是 null 表示不可用，调用方据此降级，不该在这里抛。
    return tryDecryptSecret(row?.value)?.trim() || null;
  } catch {
    return null;
  }
}

/** 联网搜索能力是否可用（未配置 key 时前端隐藏/提示）。 */
export function isSearchEnabled(): boolean {
  return !!getSearchApiKey();
}

/**
 * 执行一次 Tavily 搜索，返回带来源的结果列表。
 * @throws 未配置 key 时抛错；网络/接口错误也抛出，交给调用方处理。
 */
export async function webSearch(
  query: string,
  opts: {
    maxResults?: number;
    /** 'advanced' 摘要更贴题、慢一些、按 Tavily 计费算两次。缺省 basic（小红书 / 咨询沿用）。 */
    depth?: 'basic' | 'advanced';
    /** 要不要整页正文（`raw`）。只有 BP 报告要 —— 摘要片段里经常没有那个数字。 */
    rawContent?: boolean;
    /** 只要最近这段时间的结果（新闻 / 融资类检索用）。 */
    timeRange?: 'month' | 'year';
  } = {}
): Promise<WebSearchResult[]> {
  const apiKey = getSearchApiKey();
  if (!apiKey) throw new Error('WEB_SEARCH_NOT_CONFIGURED');

  const maxResults = Math.min(Math.max(opts.maxResults ?? 5, 1), 10);

  const resp = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: opts.depth ?? 'basic',
      max_results: maxResults,
      include_answer: false,
      ...(opts.rawContent ? { include_raw_content: true } : {}),
      ...(opts.timeRange ? { time_range: opts.timeRange } : {}),
    }),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Tavily search failed (${resp.status}): ${text.slice(0, 200)}`);
  }

  const data = (await resp.json()) as { results?: any[] };
  const results = Array.isArray(data.results) ? data.results : [];
  return results.map((r) => ({
    title: String(r.title || ''),
    url: String(r.url || ''),
    content: String(r.content || ''),
    score: typeof r.score === 'number' ? r.score : 0,
    published: String(r.published_date || ''),
    raw: typeof r.raw_content === 'string' ? r.raw_content : '',
  }));
}

/**
 * 抓指定网页的正文（Tavily Extract）。BP 报告「补充资料」里用户贴的链接走这里。
 * 抓不到就抛错带原文 —— 不能回一段空正文：空的那条资料进了 prompt 是「这条来源什么都没说」，
 * 用户却以为 AI 读过了他贴的那篇。
 */
export async function extractUrl(url: string): Promise<{ url: string; title: string; content: string }> {
  const apiKey = getSearchApiKey();
  if (!apiKey) throw new Error('WEB_SEARCH_NOT_CONFIGURED');
  const resp = await fetch('https://api.tavily.com/extract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: apiKey, urls: [url] }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Tavily extract failed (${resp.status}): ${text.slice(0, 200)}`);
  }
  const data = (await resp.json()) as { results?: any[]; failed_results?: any[] };
  const r = data.results?.[0];
  if (!r?.raw_content) {
    const why = data.failed_results?.[0]?.error;
    throw new Error(`这个链接没抓到正文${why ? `（${why}）` : '（可能要登录、或是纯图片 / 视频页）'}`);
  }
  const content = String(r.raw_content);
  const title = (content.match(/^#\s+(.+)$/m)?.[1] || '').trim();
  return { url: String(r.url || url), title, content };
}
