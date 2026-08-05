import type { Migration } from '../migrator.js';

// 指令失败时多存一份**结构化**的原因（JSON），而不是只有一段 error 文本。
//
// 起因：缺权限（飞书 code 99991672）是这个模块最高频的失败，而它恰好是唯一
// 「用户点两下就能自己解决」的一类。要在日志里给出可点的补权限按钮，
// 前端就得知道缺的是哪几个 scope、申请链接是什么 —— 让前端去正则解析
// error 文本能跑，但每次飞书改一版文案就会静默失效。
//
// 存 JSON 而不是拆成 error_kind / error_scopes / error_apply_url 三列：
// 这份数据只被前端整体读取、从不参与 WHERE 或 ORDER BY，
// 而 FeishuErrorDetail 的字段还会随着新动作增加（见 feishuError.ts）。
export const migration_055: Migration = {
  id: '055_feishu_command_error_detail',
  up(db) {
    const cols = db.prepare('PRAGMA table_info(feishu_commands)').all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === 'error_detail')) {
      db.exec('ALTER TABLE feishu_commands ADD COLUMN error_detail TEXT');
    }
  },
};
