import { getDatabase } from '../../db/index.js';
import { visibleSql } from './retention.js';

// 「现在该让用户看到哪些标讯」的唯一定义处。三个消费者：
//   1. 手动推送的预览数（pushService.loadPushSummary）
//   2. 卡片里的条目（pushService.loadPushItems）
//   3. 多维表格清空重灌的内容（feishuBitable.rebuildBitableTables）
//
// 三者必须同源，否则失败全是「看起来成功」的：卡片标题写 28 条、按钮点进表里
// 只有 12 行；或者预览说 0 条不给推，而表里明明有一堆。这类不一致没有任何
// 报错，只有把三个数字并排看才能发现 —— 所以条件写在这里，不在三处各写一遍。
//
// 注意这里**不看** bitable_synced_at / tender_bitable_sync：那两个状态位是
// 「增量同步推到哪了」，和「现在该看到什么」无关。重灌是全量覆盖，看状态位
// 会让重灌之后的表只剩没同步过的那几行。

/** 达标推荐的取数条件（推荐表 + 卡片共用）。 */
const RECOMMEND_FROM = `
  FROM tender_recommendations r
  JOIN tenders t ON t.id = r.tender_id
  WHERE r.user_id = ?
    AND r.tier != 'filter'
    AND r.total_score >= ?
    AND ${visibleSql('t')}
`;

export interface RecommendCandidate {
  tenderId: string;
  title: string;
  purchaserName: string | null;
  totalScore: number;
  tier: string;
  budgetAmount: number | null;
  budgetText: string | null;
  regionName: string | null;
  url: string | null;
  publishDate: string | null;
}

/** 达标推荐，分数从高到低。 */
export function loadRecommendCandidates(
  userId: string,
  minScore: number,
  limit = 1000
): RecommendCandidate[] {
  const rows = getDatabase()
    .prepare(
      `SELECT r.tender_id, r.total_score, r.tier,
              t.title, t.purchaser_name, t.budget_amount, t.budget,
              t.region_name, t.url, t.publish_date
       ${RECOMMEND_FROM}
       ORDER BY r.total_score DESC
       LIMIT ?`
    )
    .all(userId, minScore, limit) as any[];

  return rows.map((r) => ({
    tenderId: r.tender_id,
    title: r.title,
    purchaserName: r.purchaser_name,
    totalScore: r.total_score,
    tier: r.tier,
    budgetAmount: r.budget_amount,
    budgetText: r.budget,
    regionName: r.region_name,
    url: r.url,
    publishDate: r.publish_date,
  }));
}

/**
 * 达标推荐的条数。
 *
 * 带 limit 是故意的：预览数必须是**实际会推的条数**，不是「符合条件的总数」。
 * 被 limit 截断了却显示总数，用户会以为漏推了一批。
 */
export function countRecommendCandidates(userId: string, minScore: number, limit = 1000): number {
  return (getDatabase()
    .prepare(`SELECT COUNT(*) AS c FROM (SELECT r.id ${RECOMMEND_FROM} LIMIT ?)`)
    .get(userId, minScore, limit) as any).c;
}

export interface AllTenderCandidate {
  tenderId: string;
  title: string;
  purchaserName: string | null;
  platform: string | null;
  budgetAmount: number | null;
  budgetText: string | null;
  regionName: string | null;
  noticeType: string | null;
  keyword: string | null;
  publishDate: string | null;
  deadline: string | null;
  status: string | null;
  url: string | null;
}

function platformClause(platforms: string[]): string {
  return platforms.length > 0 ? ` AND t.platform IN (${platforms.map(() => '?').join(',')})` : '';
}

/** 「全部标讯」表的内容：当前可见 + 按用户勾选的平台过滤。 */
export function loadAllTenderCandidates(
  platforms: string[],
  limit = 2000
): AllTenderCandidate[] {
  const rows = getDatabase()
    .prepare(
      `SELECT t.id, t.title, t.purchaser_name, t.platform, t.budget_amount, t.budget,
              t.region_name, t.notice_type, t.keyword, t.publish_date, t.deadline,
              t.status, t.url
       FROM tenders t
       WHERE ${visibleSql('t')}${platformClause(platforms)}
       ORDER BY t.publish_date DESC
       LIMIT ?`
    )
    .all(...platforms, limit) as any[];

  return rows.map((r) => ({
    tenderId: r.id,
    title: r.title,
    purchaserName: r.purchaser_name,
    platform: r.platform,
    budgetAmount: r.budget_amount,
    budgetText: r.budget,
    regionName: r.region_name,
    noticeType: r.notice_type,
    keyword: r.keyword,
    publishDate: r.publish_date,
    deadline: r.deadline,
    status: r.status,
    url: r.url,
  }));
}

/** 同上的条数，同样带 limit。 */
export function countAllTenderCandidates(platforms: string[], limit = 2000): number {
  return (getDatabase()
    .prepare(
      `SELECT COUNT(*) AS c FROM (
         SELECT t.id FROM tenders t
         WHERE ${visibleSql('t')}${platformClause(platforms)}
         LIMIT ?)`
    )
    .get(...platforms, limit) as any).c;
}

/** `tender_user_preferences.platforms` 是 JSON 文本列，坏值一律当「不限」。 */
export function parsePlatforms(raw: string | null | undefined): string[] {
  try {
    const v = JSON.parse(raw || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
