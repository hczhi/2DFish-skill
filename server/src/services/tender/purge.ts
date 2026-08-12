import type { Database } from 'better-sqlite3';

// 标讯数据的清空。线上积了大量过期/脏数据，逐条删不现实。
//
// 「一条标讯」不是一行，是四张表：tenders 本体 + tender_recommendations（打分）
// + tender_user_feedback（用户标的适合/不适合）+ tender_bitable_sync（增量推送
// 到哪了）。**四张表必须一起删**，只删 tenders 的话残留行全是孤儿，而三处
// 「总数」查询都不带 JOIN、「明细」查询带 INNER JOIN：
//   - GET /recommendations：total 数孤儿、items JOIN 掉孤儿 → 「共 40 条」但只
//     渲染 12 行，翻页翻出空白页；
//   - GET /feedback：同上；
//   - recommendService 的 feedbackCount 决定预筛阈值（<5 放宽），孤儿反馈让它
//     以为用户标过很多条，于是用严格阈值，而喂给模型的历史反馈段是空的
//     （那个查询 JOIN tenders）。
// 三处全是「数字对不上但不报错」，没有任何一处会抛异常。
//
// 故意**不删**的：tender_crawl_logs（爬取历史，删了就不知道这批数据哪来的）、
// tender_keyword_pool / tender_user_keywords / tender_user_preferences /
// tender_user_clients（都是配置，清数据不该清配置 —— 清了之后下一轮爬取
// 关键词是空的，日志会写「Done: 0 new」，读起来像平台没数据）。
//
// 多维表格里的行也不删：那张表是 append-only 的镜像，Web 侧删不掉已推送的行
// （见 CLAUDE.md「DB first, bitable second」）。清库之后表里仍是旧内容，得靠
// 「手动推送」的清空重灌盖掉 —— 而候选为 0 时手动推送**不发也不重灌**，
// 所以全清之后表会一直停在旧数据上。调用方必须把这句说出来。

export interface PurgeResult {
  platform: string;              // '' = 全部平台
  tenders: number;
  recommendations: number;
  feedback: number;
  bitableSync: number;
}

/**
 * 删掉指定平台（platform 为空 = 全部）的标讯及其派生数据。
 *
 * 三个必须一起成立的点，错任何一个都是「回复说删了 N 条」而实际不是：
 * 1. **子表先删、本体后删。** 反了的话子表的 `IN (SELECT id FROM tenders …)`
 *    一条都匹配不到（本体已经没了），孤儿全部留下。
 * 2. **子表的条件必须带同一个 platform 过滤。** 少写这半句就是
 *    `DELETE FROM tender_recommendations`（全表）—— 按平台删 gdgpo 会把别的
 *    平台的打分一起抹掉，而返回值只报 gdgpo 的条数，看起来完全正常。
 * 3. **整体一个事务。** 中途抛错留下「本体没了、打分还在」的半清状态，
 *    比什么都没删更难查。
 */
export function purgeTenders(db: Database, platform = ''): PurgeResult {
  const p = platform.trim();
  const scope = p ? 'WHERE platform = ?' : '';
  const args = p ? [p] : [];
  // 子查询和本体用同一个 scope，platform 参数出现两次的地方各绑一次。
  const childScope = `tender_id IN (SELECT id FROM tenders ${scope})`;

  const run = db.transaction((): PurgeResult => {
    const recommendations = db.prepare(`DELETE FROM tender_recommendations WHERE ${childScope}`).run(...args).changes;
    const feedback = db.prepare(`DELETE FROM tender_user_feedback WHERE ${childScope}`).run(...args).changes;
    const bitableSync = db.prepare(`DELETE FROM tender_bitable_sync WHERE ${childScope}`).run(...args).changes;
    const tenders = db.prepare(`DELETE FROM tenders ${scope}`).run(...args).changes;
    return { platform: p, tenders, recommendations, feedback, bitableSync };
  });

  return run();
}

export interface PlatformCount {
  platform: string;
  tenders: number;
  recommendations: number;
}

/**
 * 每个平台的**真实**行数，给清空前的确认框用。
 *
 * 不能拿后台列表的 total 当这个数：那张列表过了 14 天时效闸门、还叠着
 * 搜索/关键词筛选，确认框写「确认清空 12 条」而实际删掉 3000 条 —— 用户
 * 是照着那个数字点确认的。这里不带任何过滤，也包括 draft 状态的行。
 */
export function tenderCountsByPlatform(db: Database): PlatformCount[] {
  return db.prepare(`
    SELECT t.platform AS platform,
           COUNT(*) AS tenders,
           (SELECT COUNT(*) FROM tender_recommendations r
             JOIN tenders t2 ON t2.id = r.tender_id
            WHERE t2.platform = t.platform) AS recommendations
    FROM tenders t
    GROUP BY t.platform
    ORDER BY tenders DESC
  `).all() as PlatformCount[];
}
