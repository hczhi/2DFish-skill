/**
 * 标讯智能推荐 SDK
 * ------------------------------------------------------------------
 * 供第三方纯前端项目嵌入。用法：
 *
 *   import { createTenderSDK } from '@qiaonan/tender-sdk'  // ESM
 *   // 或 <script src=".../tender-sdk.umd.js"></script> 后用 window.TenderSDK
 *
 *   const sdk = createTenderSDK({ pk: 'pk_live_xxx', baseUrl: 'https://your.host' })
 *   const { items } = await sdk.getRecommendations({ tier: 'priority' })
 *   // 或直接挂载现成 UI：
 *   sdk.mountWidget(document.getElementById('app'))
 *
 * SDK 内部自动用 pk 换取 15 分钟只读短 token，并在到期前静默续期。
 */

export interface TenderSDKOptions {
  /** 平台签发的 publishable key（pk_live_...） */
  pk: string;
  /** 平台后端地址，如 https://your.host（不含末尾 /api） */
  baseUrl: string;
  /** token 到期前多少毫秒提前续期，默认 60s */
  refreshSkewMs?: number;
}

export interface Recommendation {
  id: string;
  tender_id: string;
  title: string;
  purchaser_name: string;
  budget: string | null;
  budget_amount: number | null;
  region_name: string | null;
  publish_date: string | null;
  url: string | null;
  notice_type: string | null;
  project_type: string | null;
  project_summary: string | null;
  tier: 'priority' | 'consider' | 'watch' | string;
  total_score: number;
  ai_reason: string | null;
  ai_strategy: string | null;
  risk_notes: string | null;
  [key: string]: unknown;
}

export interface RecommendationList {
  items: Recommendation[];
  total: number;
  page: number;
  page_size: number;
}

export interface GetRecommendationsParams {
  tier?: 'all' | 'priority' | 'consider' | 'watch';
  page?: number;
  pageSize?: number;
}

class TenderSDK {
  private pk: string;
  private baseUrl: string;
  private refreshSkewMs: number;
  private token: string | null = null;
  private tokenExpiresAt = 0;
  private pending: Promise<string> | null = null;

  constructor(opts: TenderSDKOptions) {
    if (!opts.pk) throw new Error('[TenderSDK] pk is required');
    if (!opts.baseUrl) throw new Error('[TenderSDK] baseUrl is required');
    this.pk = opts.pk;
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.refreshSkewMs = opts.refreshSkewMs ?? 60_000;
  }

  /** 拿一个有效 token；过期或即将过期则自动换新。并发调用共享同一次换取。 */
  private async ensureToken(): Promise<string> {
    const now = Date.now();
    if (this.token && now < this.tokenExpiresAt - this.refreshSkewMs) {
      return this.token;
    }
    if (this.pending) return this.pending;

    this.pending = (async () => {
      const res = await fetch(`${this.baseUrl}/api/tender/sdk/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pk: this.pk }),
      });
      if (!res.ok) {
        const msg = await safeErr(res);
        throw new Error(`[TenderSDK] token exchange failed (${res.status}): ${msg}`);
      }
      const data = (await res.json()) as { token: string; expires_in: number };
      this.token = data.token;
      this.tokenExpiresAt = Date.now() + data.expires_in * 1000;
      return this.token;
    })();

    try {
      return await this.pending;
    } finally {
      this.pending = null;
    }
  }

  private async authedFetch(path: string, query?: Record<string, unknown>): Promise<any> {
    const token = await this.ensureToken();
    const url = new URL(`${this.baseUrl}${path}`);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
      }
    }
    let res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    // token 可能刚好被服务端判定失效，重试一次（强制换新）。
    if (res.status === 401) {
      this.token = null;
      const fresh = await this.ensureToken();
      res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${fresh}` } });
    }
    if (!res.ok) {
      const msg = await safeErr(res);
      throw new Error(`[TenderSDK] request failed (${res.status}): ${msg}`);
    }
    return res.json();
  }

  /** 获取推荐列表（只读）。 */
  getRecommendations(params: GetRecommendationsParams = {}): Promise<RecommendationList> {
    return this.authedFetch('/api/tender/recommendations', {
      tier: params.tier,
      page: params.page,
      page_size: params.pageSize,
    });
  }

  /** 获取单条标讯详情（只读）。 */
  getDetail(id: string): Promise<any> {
    return this.authedFetch(`/api/tender/detail/${encodeURIComponent(id)}`);
  }

  /** 浏览全部标讯（只读）。 */
  list(params: { search?: string; platform?: string; keyword?: string; page?: number; pageSize?: number } = {}): Promise<RecommendationList> {
    return this.authedFetch('/api/tender/list', {
      search: params.search,
      platform: params.platform,
      keyword: params.keyword,
      page: params.page,
      page_size: params.pageSize,
    });
  }

  /** 挂载一个现成的推荐列表 UI 到指定容器。 */
  async mountWidget(target: string | HTMLElement, opts: WidgetOptions = {}): Promise<void> {
    const { mountWidget } = await import('./widget.js');
    return mountWidget(this, target, opts);
  }
}

export interface WidgetOptions {
  tier?: 'all' | 'priority' | 'consider' | 'watch';
  pageSize?: number;
  title?: string;
}

async function safeErr(res: Response): Promise<string> {
  try {
    const d = await res.json();
    return (d && (d.error || d.message)) || res.statusText;
  } catch {
    return res.statusText;
  }
}

export function createTenderSDK(opts: TenderSDKOptions): TenderSDK {
  return new TenderSDK(opts);
}

export type { TenderSDK };
