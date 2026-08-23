import type { Database } from 'better-sqlite3';
import { getDatabase } from '../../db/index.js';
import { visibleSql } from './retention.js';

// ============================================================================
// 推荐列表的取数。抽出来只为一件事：它必须和时效闸门（retention.ts）保持一致，
// 而这条路径是唯一「过不了闸门也照样显示」过的消费者。
//
// 原来路由里筛的是 `r.created_at >= datetime('now','-20 days')` —— 那是**评分时间**，
// 不是标讯的时效。一条入库很久的标讯只要最近 20 天内被评过分就一直挂在列表里，
// 而排序是 total_score DESC，所以旧的高分条目永远钉在最前面。用户侧列表 /list、
// 飞书卡片、多维表格重灌全都走 visibleSql / candidates.ts，只有这里没过 ——
// 于是同一个人在网页（含 SDK 挂在外站的「投标资讯」）上看到的和在飞书里看到的
// 不是一批东西，两边都不报错。
//
// 20 天那个条件是**删掉**而不是和闸门叠着：闸门比它严，留着等于在同一个查询里
// 写两个窗口，改天数的人只会改到其中一个。
// ============================================================================

export interface RecommendationQuery {
  userId: string;
  /** 'all' / 空 = 除 filter（规则初筛）以外的全部 */
  tier?: string;
  pageSize: number;
  offset: number;
}

export function listRecommendations(
  q: RecommendationQuery,
  db: Database = getDatabase()
): { items: any[]; total: number } {
  let where = `r.user_id = ? AND ${visibleSql('t')}`;
  const params: any[] = [q.userId];

  if (q.tier && q.tier !== 'all') {
    where += ' AND r.tier = ?';
    params.push(q.tier);
  } else {
    where += " AND r.tier != 'filter'";
  }

  // 两条查询共用 `where` 和同一个 JOIN。曾经明细带 `JOIN tenders`、总数不带，
  // 于是条件一多就对不上：界面写「共 40 条」而翻出来是空白页，一句错都不报。
  const total = (
    db
      .prepare(
        `SELECT COUNT(*) as count FROM tender_recommendations r
         JOIN tenders t ON r.tender_id = t.id
         WHERE ${where}`
      )
      .get(...params) as any
  ).count;

  const items = db
    .prepare(
      `SELECT r.*, t.title, t.purchaser_name, t.budget, t.budget_amount, t.region_name, t.publish_date,
              t.url, t.notice_type, t.project_type, t.project_location, t.project_summary,
              f.feedback as user_feedback, f.reason as feedback_reason
       FROM tender_recommendations r
       JOIN tenders t ON r.tender_id = t.id
       LEFT JOIN tender_user_feedback f ON f.tender_id = r.tender_id AND f.user_id = r.user_id
       WHERE ${where}
       ORDER BY r.total_score DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, q.pageSize, q.offset);

  return { items, total };
}

/**
 * 「档位变了、该重评」的那批 tender_id。也要过闸门：已过时效的标讯压根不显示，
 * 却照样会被选进重评名单 —— 而调用方是「先删旧记录再评」，闸门在
 * runRecommendationsForAllUsers 里挡住它、一条都评不出来，于是那几行被静默删掉，
 * 接口回 `rescored: 0`，用户接着点，每点一次再删一批。两次点击都显示成功。
 */
export function staleRecommendations(
  userId: string,
  profileAt: string | null,
  db: Database = getDatabase()
): string[] {
  return db
    .prepare(
      `SELECT r.tender_id FROM tender_recommendations r
       JOIN tenders t ON r.tender_id = t.id
       WHERE r.user_id = ?
         AND ${visibleSql('t')}
         AND r.tier != 'filter'
         AND r.scored_profile_at IS NOT ?
       ORDER BY r.created_at DESC`
    )
    .all(userId, profileAt)
    .map((r: any) => r.tender_id as string);
}
