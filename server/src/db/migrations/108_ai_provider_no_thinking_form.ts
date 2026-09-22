import type { Migration } from '../migrator.js';

/**
 * `ai_providers.no_thinking_form`：这条接入点上**哪一种发法**真的能关掉思维链
 * （NULL = 还没试过，用默认那种；`'none-works'` = 全试过都关不掉）。
 *
 * 加它的理由：各家网关认的键不是同一个，而**发出去不等于生效** —— 宽松的网关对不认识的键
 * 既不报错也不照办，严格的回 400。实测同一家中转的两台机器行为都不一样（一台四个键一起收，
 * 一台拒掉其中一个），而症状永远是同一句：后台勾着「不使用深度思考」、连通 ✓、业务 200，
 * 只是每次调用慢十倍、输出顶满 `max_tokens` 偶发截断。靠管理员去猜是哪个键 = 猜不到。
 *
 * 所以运行时自己试：一种发法没关掉（`reasoning_tokens > 0` 或键全被拒）就把下一种记在这里，
 * 下一次调用直接用记住的那种。三条边界：
 * ① 存**发法的 id**（代码里那张表的键），不是自由文本的 body —— 自由文本拼错完全静默
 *    （保存成功、界面和生效了一模一样，见 `extra_json` 那条教训）；
 * ② `upsertProvider` 的 INSERT OR REPLACE 必须带上这一列并保留旧值：不带的话管理员
 *    改一次标签就把学到的发法清成 NULL，于是又从第一种开始试（现象是「怎么又慢了一次」）；
 * ③ `'none-works'` 要是个真实的值而不是「NULL 表示都不行」：NULL 和「还没试过」撞在一起时，
 *    每一次调用都会把整张表重试一遍，而每次重试都是一次真慢的调用。
 */
export const migration_108: Migration = {
  id: '108_ai_provider_no_thinking_form',
  up(db) {
    const cols = db.prepare(`PRAGMA table_info(ai_providers)`).all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === 'no_thinking_form')) {
      db.exec(`ALTER TABLE ai_providers ADD COLUMN no_thinking_form TEXT`);
    }
  },
};
