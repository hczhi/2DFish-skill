import type { Migration } from '../migrator.js';

// 清掉「AI 评分其实没成功、但被兜底成 50 分落了行」的推荐记录。
//
// recommendService 原来在拿不到 JSON / 上游报错 / 额度打满时 return 一份
// score=50、qualificationScore=50 的假结果，reason 写成「解析失败」/
// 「每日AI额度已用完」/「评分服务暂时不可用: …」。这些行有三重后果，
// 而且全都不报错：
//   1. 卡片上是一个正常的「68 分 · 可考虑」（业务分 = 关键词分×0.4 + 50×0.6），
//      只有推荐理由那一栏写着两个字，分析/投标思路是空的；
//   2. loadUnscoredForUser 用 `NOT EXISTS(tender_recommendations)` 判「评过了」，
//      所以这条标讯**永远不会再被评**，那份假分数就是最终结果；
//   3. 它照样参与增量同步，进多维表格、进飞书卡片。
// 删掉这些行 = 它们重新变成「未评分」，下一次点「开始评分」会真评一遍
// （现在 max_tokens 给到 4000，够思维链跑）。
//
// 只删这三类兜底行，**不动** 'filter'（规则初筛，本来就不该调 LLM）和正常评出来的行。
// 判据是 ai_reason 的那几句固定文案 —— 它们都由代码写死，不是模型生成的。
// 删行不删标讯：tenders 表照旧，用户反馈按 tender_id 存也不受影响。
export const migration_083: Migration = {
  id: '083_drop_failed_recommendations',
  up(db) {
    const r = db
      .prepare(
        `DELETE FROM tender_recommendations
          WHERE ai_reason = '解析失败'
             OR ai_reason = '每日AI额度已用完'
             OR ai_reason LIKE '评分服务暂时不可用%'`
      )
      .run();
    if (r.changes > 0) {
      // 报出条数：一趟删掉一批推荐，用户那边的推荐列表会少一截，
      // 不说的话看起来像数据丢了（其实是那些行本来就是假分数，会被重评）。
      console.log(`[migrate] 083: 清掉 ${r.changes} 条评分失败兜底出来的推荐记录（下次评分会重试）`);
    }
  },
};
