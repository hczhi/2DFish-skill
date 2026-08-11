import { getDatabase } from '../../db/index.js';
import { getBitableUrl, rebuildBitableTables, type RebuildResult } from './feishuBitable.js';
import {
  loadRecommendCandidates, countRecommendCandidates, countAllTenderCandidates, parsePlatforms,
} from './candidates.js';
import {
  pushToChats, parseChatIds,
  type FeishuTenderItem, type PushResult, type ChatPushResult,
} from './feishuNotify.js';

// 手动推送：后台「飞书推送」页点一下，先把多维表格清空重灌，再把该用户当前
// 达标的推荐推到群里。
//
// 和评分流程里那次推送的区别是**推什么**：那边推的是「本轮新评出来的」，
// 这边推的是「现在库里所有达标且未过期的」。后者才对得上按钮旁边显示的条数 ——
// 用户看到「28 条」就该收到 28 条的卡片，点开按钮的表里也该是这 28 条。
//
// 三处取数（预览数 / 卡片条目 / 表格内容）全部走 candidates.ts，不在这里另写 SQL。
// 理由见那个文件的头注释：不一致没有任何报错。

interface PushPrefRow {
  feishu_app_id: string | null;
  feishu_app_secret: string | null;
  feishu_chat_id: string | null;
  feishu_min_score: number | null;
  platforms: string | null;
}

// 不读 feishu_enabled：那一列原来管评分流程里的自动推送，自动推送去掉之后
// 没有任何代码读它了（列还在，migration 035 建的）。这里读进来只会让人以为
// 手动推送该看它 —— 而看了它就等于「关掉开关后按钮点了没反应」。
function loadPref(userId: string): PushPrefRow | undefined {
  return getDatabase()
    .prepare(
      `SELECT feishu_app_id, feishu_app_secret, feishu_chat_id,
              feishu_min_score, platforms
       FROM tender_user_preferences WHERE user_id = ?`
    )
    .get(userId) as PushPrefRow | undefined;
}

/**
 * 当前会被推送的推荐（分数从高到低）。
 *
 * 不看 bitable_synced_at —— 那是多维表格的同步状态，和「群里该看到什么」无关。
 * 拿它当条件的话，同步过一次之后手动推送就永远是空的，而按钮旁边还写着 28 条。
 */
export function loadPushItems(userId: string, limit = 1000): FeishuTenderItem[] {
  const pref = loadPref(userId);
  if (!pref) return [];
  return loadRecommendCandidates(userId, pref.feishu_min_score ?? 55, limit).map((c) => ({
    title: c.title,
    purchaserName: c.purchaserName,
    totalScore: c.totalScore,
    tier: c.tier,
    budgetAmount: c.budgetAmount,
    regionName: c.regionName,
    url: c.url,
  }));
}

export interface PushSummary {
  /** 会被推送的达标推荐条数。 */
  recommendCount: number;
  /** 库里当前可见的标讯总数（按该用户勾选的平台过滤），即「全部标讯」表的应有条数。 */
  totalCount: number;
  minScore: number;
  /** 会收到卡片的所有群。前端要把它们列出来 —— 只显示条数的话，多勾/少勾一个群没人看得出。 */
  chatIds: string[];
  bitableUrl: string;
  /** 缺什么导致点了推不出去。为空表示可以推。 */
  blockedBy: string;
}

/** 按钮旁边显示的那几个数，以及「现在能不能推」。 */
export function loadPushSummary(userId: string, limit = 1000): PushSummary {
  const pref = loadPref(userId);
  const minScore = pref?.feishu_min_score ?? 55;
  const chatIds = parseChatIds(pref?.feishu_chat_id);

  const recommendCount = pref ? countRecommendCandidates(userId, minScore, limit) : 0;
  const totalCount = countAllTenderCandidates(parsePlatforms(pref?.platforms));

  let blockedBy = '';
  if (!pref?.feishu_app_id || !pref?.feishu_app_secret) blockedBy = '未配置 App ID / App Secret';
  else if (chatIds.length === 0) blockedBy = '未配置推送群';
  else if (recommendCount === 0) blockedBy = `没有达到 ${minScore} 分的推荐可推`;

  return {
    recommendCount,
    totalCount,
    minScore,
    chatIds,
    bitableUrl: getBitableUrl(userId),
    blockedBy,
  };
}

export interface ManualPushResult extends PushResult {
  /** 卡片里的条数（= 卡片标题里那个数）。0 表示一个群都没推成。 */
  pushed: number;
  /** 重灌结果。未启用多维表格时是 undefined。 */
  rebuild?: RebuildResult;
  /** 逐群的成败。多群时**必须**报出来，见 chats 字段下面那段注释。 */
  chats: ChatPushResult[];
}

/**
 * 手动推一次：先把多维表格清空重灌，再往配置的每个群发卡片。
 *
 * **重灌必须在推送之前**，和评分流程里那句「先把数据写进去，用户点开才不是空的」
 * 同一个理由，但这里更严格：重灌中途失败时表是**空的**，这时候还把卡片发出去，
 * 用户点按钮看到空表，会以为数据丢了。所以重灌报错就中止推送 —— 卡片没发出去
 * 是看得见的（群里没消息），发了却指向空表是看不见的。
 *
 * **`ok` 的含义是「至少推成了一个群」，`chats` 才是真相。** 部分成功在多群下是
 * 常态（某个群没把机器人拉进去 → 230013），所以不能合成一个成败：
 * 合成成功会把那个群的失败吃掉（那群人从此收不到推送，后台一直显示 ✅），
 * 合成失败会让管理员重推（另外几个群于是收到两条一样的卡片）。
 * 调用方必须把 chats 逐条显示出来。
 *
 * 这是发卡片的**唯一**入口：评分流程里那次自动推送已经去掉了（见
 * `recommendService.ts` 里那段注释）。
 */
export async function runManualPush(userId: string, nowMs: number): Promise<ManualPushResult> {
  const pref = loadPref(userId);
  if (!pref?.feishu_app_id || !pref?.feishu_app_secret) {
    return { ok: false, error: '未配置 App ID / App Secret', pushed: 0, chats: [] };
  }
  const chatIds = parseChatIds(pref.feishu_chat_id);
  if (chatIds.length === 0) return { ok: false, error: '未配置推送群', pushed: 0, chats: [] };

  const items = loadPushItems(userId);
  if (items.length === 0) {
    const minScore = pref.feishu_min_score ?? 55;
    return { ok: false, error: `没有达到 ${minScore} 分的推荐可推`, pushed: 0, chats: [] };
  }

  // 清空重灌。失败（含「清空了但没灌完」）一律中止，见函数注释。
  let rebuild: RebuildResult | undefined;
  try {
    const r = await rebuildBitableTables(userId, nowMs);
    if (!r.skipped) rebuild = r;
    if (r.error) return { ok: false, error: r.error, pushed: 0, rebuild, chats: [] };
  } catch (e: any) {
    return { ok: false, error: `多维表格重灌失败，未推送卡片（${e.message}）`, pushed: 0, chats: [] };
  }

  const chats = await pushToChats(
    { appId: pref.feishu_app_id, appSecret: pref.feishu_app_secret },
    chatIds,
    items,
    nowMs,
    getBitableUrl(userId) || undefined
  );

  const okCount = chats.filter((c) => c.ok).length;
  // 全失败时 error 带上第一条原因，否则前端只有一句「推送失败」可显示。
  return {
    ok: okCount > 0,
    error: okCount > 0 ? undefined : chats.find((c) => c.error)?.error || '推送失败',
    pushed: okCount > 0 ? items.length : 0,
    rebuild,
    chats,
  };
}
