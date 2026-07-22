import crypto from 'crypto';

// 飞书群自定义机器人推送。
// 文档：https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot
//
// 支持可选的「签名校验」：机器人若开启了加签，需用 secret 计算签名。
// 签名算法：以 `${timestamp}\n${secret}` 为 HMAC-SHA256 的 key，对空字符串做摘要，Base64 编码。

export interface FeishuTenderItem {
  title: string;
  purchaserName?: string | null;
  totalScore: number;
  tier: string;
  budgetAmount?: number | null;
  regionName?: string | null;
  url?: string | null;
}

const TIER_LABEL: Record<string, string> = {
  priority: '🔴 优先',
  consider: '🟡 考虑',
  watch: '🔵 关注',
};

const MAX_ITEMS = 10; // 单条消息最多列出的推荐条数

function genSign(secret: string, timestampSec: number): string {
  const stringToSign = `${timestampSec}\n${secret}`;
  const hmac = crypto.createHmac('sha256', stringToSign).update('').digest();
  return hmac.toString('base64');
}

function fmtBudget(amount?: number | null): string {
  if (!amount) return '';
  return `预算 ${(amount / 10000).toFixed(1)} 万`;
}

function buildCard(items: FeishuTenderItem[], totalCount: number) {
  const shown = items.slice(0, MAX_ITEMS);

  const elements: any[] = [];
  for (const it of shown) {
    const metaParts = [
      TIER_LABEL[it.tier] || it.tier,
      `${Math.round(it.totalScore)}分`,
      it.purchaserName || '',
      it.regionName || '',
      fmtBudget(it.budgetAmount),
    ].filter(Boolean);

    // 标题行（可点链接）+ 元信息行
    const titleLine = it.url
      ? `**[${escapeMd(it.title)}](${it.url})**`
      : `**${escapeMd(it.title)}**`;

    elements.push({
      tag: 'div',
      text: { tag: 'lark_md', content: `${titleLine}\n${metaParts.join(' · ')}` },
    });
    elements.push({ tag: 'hr' });
  }

  if (totalCount > shown.length) {
    elements.push({
      tag: 'div',
      text: { tag: 'lark_md', content: `… 共 ${totalCount} 条，更多请登录平台查看` },
    });
  }

  return {
    msg_type: 'interactive',
    card: {
      config: { wide_screen_mode: true },
      header: {
        template: 'blue',
        title: { tag: 'plain_text', content: `🎯 为你发现 ${totalCount} 条高分标讯` },
      },
      elements,
    },
  };
}

function escapeMd(s: string): string {
  // 飞书 lark_md 里对 [ ] ( ) 等做转义，避免标题里的括号破坏 markdown 链接
  return String(s).replace(/([\[\]()])/g, '\\$1');
}

/**
 * 推送一批推荐到飞书群 webhook。失败抛异常，由调用方 try/catch 处理，绝不影响评分主流程。
 * @returns 飞书返回的 code（0 为成功）
 */
export async function pushTenderRecommendations(
  webhook: string,
  secret: string | undefined,
  items: FeishuTenderItem[],
  nowMs: number
): Promise<{ ok: boolean; code?: number; msg?: string }> {
  if (!webhook || items.length === 0) return { ok: false, msg: 'no webhook or empty items' };

  const payload: any = buildCard(items, items.length);

  if (secret) {
    const ts = Math.floor(nowMs / 1000);
    payload.timestamp = String(ts);
    payload.sign = genSign(secret, ts);
  }

  const res = await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = (await res.json().catch(() => ({}))) as { code?: number; msg?: string; StatusCode?: number };
  // 飞书成功返回 { code: 0, msg: "success" } 或旧格式 { StatusCode: 0 }
  const code = data.code ?? data.StatusCode;
  const ok = res.ok && (code === 0 || code === undefined);
  return { ok, code, msg: data.msg };
}
