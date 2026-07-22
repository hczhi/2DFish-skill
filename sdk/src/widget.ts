import type { TenderSDK, WidgetOptions, Recommendation } from './index.js';

const STYLE_ID = 'tender-sdk-widget-style';

const CSS = `
.tsdk-root{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;color:#1e293b;}
.tsdk-title{font-size:16px;font-weight:600;margin:0 0 12px;}
.tsdk-list{display:flex;flex-direction:column;gap:10px;}
.tsdk-card{border:1px solid #e2e8f0;border-radius:8px;padding:14px 16px;background:#fff;}
.tsdk-card-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;}
.tsdk-card-title{font-size:14px;font-weight:600;line-height:1.4;flex:1;}
.tsdk-card-title a{color:#1e293b;text-decoration:none;}
.tsdk-card-title a:hover{color:#2563eb;}
.tsdk-tier{flex-shrink:0;font-size:11px;padding:2px 8px;border-radius:10px;white-space:nowrap;}
.tsdk-tier.priority{background:#fef2f2;color:#dc2626;}
.tsdk-tier.consider{background:#fffbeb;color:#d97706;}
.tsdk-tier.watch{background:#f0f9ff;color:#0284c7;}
.tsdk-meta{margin-top:6px;font-size:12px;color:#64748b;display:flex;flex-wrap:wrap;gap:12px;}
.tsdk-reason{margin-top:8px;font-size:12px;color:#475569;line-height:1.5;}
.tsdk-empty,.tsdk-loading,.tsdk-error{padding:24px;text-align:center;color:#94a3b8;font-size:13px;}
.tsdk-error{color:#dc2626;}
`;

const TIER_LABEL: Record<string, string> = {
  priority: '优先',
  consider: '考虑',
  watch: '关注',
};

function injectStyle(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = CSS;
  document.head.appendChild(el);
}

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtBudget(rec: Recommendation): string {
  if (rec.budget_amount) return `预算 ${(rec.budget_amount / 10000).toFixed(1)} 万`;
  if (rec.budget) return `预算 ${esc(rec.budget)}`;
  return '';
}

function cardHtml(rec: Recommendation): string {
  const tier = String(rec.tier || '');
  const titleInner = rec.url
    ? `<a href="${esc(rec.url)}" target="_blank" rel="noopener">${esc(rec.title)}</a>`
    : esc(rec.title);
  const meta = [
    rec.purchaser_name ? esc(rec.purchaser_name) : '',
    rec.region_name ? esc(rec.region_name) : '',
    fmtBudget(rec),
    rec.publish_date ? esc(rec.publish_date) : '',
  ].filter(Boolean).map((m) => `<span>${m}</span>`).join('');

  return `
    <div class="tsdk-card">
      <div class="tsdk-card-head">
        <div class="tsdk-card-title">${titleInner}</div>
        ${tier ? `<span class="tsdk-tier ${esc(tier)}">${esc(TIER_LABEL[tier] || tier)} · ${Math.round(rec.total_score)}</span>` : ''}
      </div>
      <div class="tsdk-meta">${meta}</div>
      ${rec.ai_reason ? `<div class="tsdk-reason">${esc(rec.ai_reason)}</div>` : ''}
    </div>`;
}

export async function mountWidget(sdk: TenderSDK, target: string | HTMLElement, opts: WidgetOptions = {}): Promise<void> {
  injectStyle();
  const container = typeof target === 'string' ? document.querySelector(target) : target;
  if (!container) throw new Error(`[TenderSDK] widget target not found: ${String(target)}`);

  const root = document.createElement('div');
  root.className = 'tsdk-root';
  root.innerHTML = `<div class="tsdk-loading">加载中…</div>`;
  container.innerHTML = '';
  container.appendChild(root);

  try {
    const { items } = await sdk.getRecommendations({
      tier: opts.tier || 'all',
      pageSize: opts.pageSize || 20,
    });

    const titleHtml = opts.title ? `<div class="tsdk-title">${esc(opts.title)}</div>` : '';
    if (!items.length) {
      root.innerHTML = `${titleHtml}<div class="tsdk-empty">暂无推荐标讯。</div>`;
      return;
    }
    root.innerHTML = `${titleHtml}<div class="tsdk-list">${items.map(cardHtml).join('')}</div>`;
  } catch (e: any) {
    root.innerHTML = `<div class="tsdk-error">加载失败：${esc(e?.message || e)}</div>`;
  }
}
