import type { Migration } from '../migrator.js';

// AI 通信日志记全文：给 ai_logs 加 request_body / response_body 两列。
//  - request_body：完整的请求 messages（JSON 字符串），含系统拼装进去的 skill / 禁用库等全部上下文。
//  - response_body：模型返回的完整正文（流式则为累计拼接后的全文）。
// 老行有值的字段保持不变，两列对历史行为 NULL——列表/详情按空处理即可。
// 体量可能较大，随现有 logCleanupService 的按天清理一起淘汰，不额外做保留策略。
export const migration_042: Migration = {
  id: '042_ai_logs_full_bodies',
  up(db) {
    const cols = db.prepare(`PRAGMA table_info(ai_logs)`).all() as Array<{ name: string }>;
    const has = (c: string) => cols.some((x) => x.name === c);
    if (!has('request_body')) db.exec(`ALTER TABLE ai_logs ADD COLUMN request_body TEXT`);
    if (!has('response_body')) db.exec(`ALTER TABLE ai_logs ADD COLUMN response_body TEXT`);
  },
};
