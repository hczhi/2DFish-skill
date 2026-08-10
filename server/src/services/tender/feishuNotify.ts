import { getTenantToken, callOpenApi } from './feishuOpen.js';

// 标讯推送：把达到阈值的推荐汇总成一张卡片，用**自建应用**发到指定群。
//
// ── 为什么不用 @larksuiteoapi/node-sdk ──
// 项目里确实有这个依赖（飞书助理模块在用），但那边用它是为了长连接和事件回调，
// 这里只是发一条消息。而 SDK 的 Client 自己管理 tenant_access_token，
// 引进来就等于同一个应用有两份 token 缓存 —— 后台改了 App Secret 时
// invalidateTokenCache 清不掉 SDK 那份，推送会继续用旧凭据直到两小时后过期。
// 所以走 feishuOpen.ts 的同一条凭据链。接口和参数与 SDK 的
// client.im.message.create 完全一致，只是少了一层封装。
// 文档：https://open.feishu.cn/document/server-docs/im-v1/message/create
//
// ── 从 webhook 换成应用推送带来的两个变化 ──
// 1. 不再有 HMAC 加签（那是自定义机器人的鉴权方式），改用应用凭据；
//    也就不再需要 feishu_webhook / feishu_secret 两列（列还在，代码不读了）。
// 2. 应用**必须先被拉进群**，否则报 230013。这个错和「群 ID 填错」长得很像，
//    所以 feishuOpen.ts 的 hintFor 专门给了提示 —— 不给的话管理员只看到一串数字。

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

// 卡片里最多列出的条数。一次评分可能产出几十条达标推荐，全塞进卡片
// 在手机上要滚很久，真正要看全量的入口是底部的多维表格链接。
// 被截掉的条数必须在卡片里写出来（见下方「还有 N 条」），否则用户会以为只有 5 条。
const MAX_ITEMS = 5;

function fmtBudget(amount?: number | null): string {
  if (!amount) return '';
  return `预算 ${(amount / 10000).toFixed(1)} 万`;
}

function escapeMd(s: string): string {
  // 飞书 lark_md 里对 [ ] ( ) 等做转义，避免标题里的括号破坏 markdown 链接
  return String(s).replace(/([\[\]()])/g, '\\$1');
}

export function buildCard(items: FeishuTenderItem[], bitableUrl?: string) {
  // 按分数从高到低。评分是按标讯入库顺序产出的，不排序的话卡片里
  // 92 分的可能排在 61 分后面，而卡片只留 5 条 —— 高分的会被截掉。
  const sorted = [...items].sort((a, b) => b.totalScore - a.totalScore);
  const shown = sorted.slice(0, MAX_ITEMS);
  const totalCount = items.length;

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

  // 截断必须说出来。卡片只显示 5 条，不写这一句的话
  // 「本轮 28 条达标」在用户眼里就是「只有 5 条」。
  if (totalCount > shown.length) {
    elements.push({
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `还有 **${totalCount - shown.length}** 条达标标讯未在卡片中展示（按分数排序，仅列前 ${MAX_ITEMS} 条）`,
      },
    });
  }

  // 多维表格入口。用带 url 的纯跳转按钮（不是回调型 action）——
  // 回调型按钮需要应用配置事件订阅地址，标讯模块没有公网回调，点了不会有反应。
  // 飞书客户端里点它是内嵌打开云文档，不跳浏览器。
  //
  // 没有表格地址时给一句说明，而不是什么都不显示：卡片被截断了却没有「看全部」的入口，
  // 用户只会以为剩下的丢了。
  if (bitableUrl) {
    elements.push({
      tag: 'action',
      actions: [
        {
          tag: 'button',
          text: { tag: 'plain_text', content: '📊 在多维表格中查看全部投标信息' },
          type: 'primary',
          url: bitableUrl,
        },
      ],
    });
  } else if (totalCount > shown.length) {
    elements.push({
      tag: 'note',
      elements: [{ tag: 'plain_text', content: '完整列表请登录平台查看（该账号尚未创建多维表格）' }],
    });
  }

  return {
    config: { wide_screen_mode: true },
    header: {
      template: 'blue',
      title: { tag: 'plain_text', content: `🎯 为你发现 ${totalCount} 条高分标讯` },
    },
    elements,
  };
}

export interface PushResult {
  ok: boolean;
  messageId?: string;
  error?: string;
}

/**
 * 用自建应用把一批推荐推到指定群。
 *
 * 失败不抛异常，返回 { ok: false, error }：调用方（评分主流程）拿到失败也只是记一行日志，
 * 不重推、不影响评分 —— 明确的产品决定。所以这里没有重试和退避。
 *
 * @param cred  应用凭据。appSecret 传库里的密文原样即可，解密在 feishuOpen 内部。
 * @param chatId 群 ID（oc_ 开头）。飞书客户端里群设置页可直接复制。
 */
export async function pushTenderRecommendations(
  cred: { appId: string; appSecret: string },
  chatId: string,
  items: FeishuTenderItem[],
  nowMs: number,
  bitableUrl?: string
): Promise<PushResult> {
  if (!cred.appId || !cred.appSecret) return { ok: false, error: '未配置 App ID / App Secret' };
  if (!chatId) return { ok: false, error: '未配置推送群 ID' };
  if (items.length === 0) return { ok: false, error: '没有要推送的内容' };

  try {
    const token = await getTenantToken(cred.appId, cred.appSecret, nowMs);
    // interactive 消息的 content 是**卡片 JSON 的字符串**，不是对象。
    // 传对象飞书报 230001「参数错误」，不会告诉你错在哪个字段。
    const data = await callOpenApi(token, '/im/v1/messages?receive_id_type=chat_id', 'POST', {
      receive_id: chatId,
      msg_type: 'interactive',
      content: JSON.stringify(buildCard(items, bitableUrl)),
    });
    return { ok: true, messageId: data?.message_id };
  } catch (e: any) {
    return { ok: false, error: e.message || '推送失败' };
  }
}
