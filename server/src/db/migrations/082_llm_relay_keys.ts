import type { Migration } from '../migrator.js';

/**
 * 对外中转接口的 key：管理员在某个用户的「专属 AI」面板上给某条接入点生成一把，
 * 下游拿它按 OpenAI 协议调我们的域名，我们用那条接入点的 key 转发。
 *
 * 几个存法都是「不这么存就会静默出错」：
 *
 * - **绑 provider_id，不绑档位。** 按档位解析（resolveLLMProvider）在同一档有第二条
 *   接入点时会挑「最近更新的那条」—— 管理员停用第一条之后，下游照样通，只是换了一个
 *   模型和一把 key，回复读起来完全正常。绑死这一行才能做到「接入点关了就访问不了」。
 * - **key 只存 sha256，明文只在生成那一次返回。** 库被看到 ≠ 别人能拿去调。
 *   要留一段给人认（key_prefix）—— 后台列表里三把 key 长得一样的话，
 *   管理员吊销的时候会挑错那一把，而两把都显示「已吊销/仍有效」，看不出挑错了。
 * - **revoked_at 是一列，不是 DELETE。** 接入点被删时要把绑在它上面的 key 标废
 *   （见 aiProviderService.deleteProvider）：接入点 id 是可以被重建成同一个的
 *   （种子那条就叫 default-llm），只靠「查不到那行就拒」的话，重建之后那把早该失效的
 *   key 会自己活过来，而调用方那边一切正常。留一行也让后台能显示「随接入点删除而失效」，
 *   否则下游收到 403 而管理员在界面上找不到那把 key，只能怀疑是接口坏了。
 * - **revoke_reason 存的是给管理员看的原因**（手动吊销 / 接入点被删）。对外一律只回
 *   「接口已关闭，请联系管理员」—— 但后台必须能分清是哪一种，否则没法回答下游的追问。
 */
export const migration_082: Migration = {
  id: '082_llm_relay_keys',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS llm_relay_keys (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        key_hash TEXT NOT NULL,
        key_prefix TEXT NOT NULL,
        label TEXT NOT NULL DEFAULT '',
        enabled INTEGER NOT NULL DEFAULT 1,
        revoked_at TEXT,
        revoke_reason TEXT NOT NULL DEFAULT '',
        last_used_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_llm_relay_keys_hash ON llm_relay_keys (key_hash);
      CREATE INDEX IF NOT EXISTS idx_llm_relay_keys_user ON llm_relay_keys (user_id);
      CREATE INDEX IF NOT EXISTS idx_llm_relay_keys_provider ON llm_relay_keys (provider_id);
    `);
  },
};
