import type { Migration } from '../migrator.js';

/**
 * `ai_logs.reasoning_tokens` / `finish_reason`：把「这次到底还想了多少」和「是不是被
 * `max_tokens` 截断的」记进日志。
 *
 * 加它的理由是一次线上事故：后台那条接入点明明写着「不深度思考」，而生成一页要 117 秒、
 * 输出 token 顶到 6000（= `MAX_PAGE_TOKENS`）。gateway 其实**已经**核出来了
 * （`reasoning_tokens > 0` 时 `console.warn` 一句），但那句话只在服务器 stdout 里 ——
 * 线上看不到，后台「AI 通信日志」那一屏里「关掉了」和「没关掉」长得一模一样：
 * 都是一行正常的记录，只有耗时不一样，而耗时慢有十种解释。
 *
 * 两条边界：
 * ① **上游没报明细时存 NULL，不存 0。** 存 0 的话界面上写着「思 0」= 「已经关掉了」，
 *    而真相是「这条网关压根不报，关没关不知道」—— 他会照着这个结论去查别处（改 prompt、
 *    查网络），而唯一有用的动作（换模型 / 点那条接入点的「测试」）永远不会被想到。
 * ② `finish_reason` 照原样存（不折成布尔）：`length` 是「被 max_tokens 切了」，
 *    而这一列为空是「上游没给」—— 折成 `truncated: 0` 之后两者都读成「没截断」，
 *    于是「抄到一半就断了」在日志里一个字都没有。
 */
export const migration_107: Migration = {
  id: '107_ai_logs_reasoning',
  up(db) {
    const cols = db.prepare(`PRAGMA table_info(ai_logs)`).all() as Array<{ name: string }>;
    const has = (name: string) => cols.some((c) => c.name === name);
    // 两列都允许 NULL 且没有 DEFAULT：老日志和「上游没报」都是 NULL（见边界 ①）。
    if (!has('reasoning_tokens')) db.exec(`ALTER TABLE ai_logs ADD COLUMN reasoning_tokens INTEGER`);
    if (!has('finish_reason')) db.exec(`ALTER TABLE ai_logs ADD COLUMN finish_reason TEXT`);
  },
};
