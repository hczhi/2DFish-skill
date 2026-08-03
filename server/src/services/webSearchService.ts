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
  opts: { maxResults?: number } = {}
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
      search_depth: 'basic',
      max_results: maxResults,
      include_answer: false,
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
  }));
}
