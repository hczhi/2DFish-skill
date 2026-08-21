// 对外中转接口的 key（migration 082）。
//
// 一把 key = (某个用户, 某条专属接入点)。它替下游承担两件事：
// 「这次调用记在谁头上」（ai_logs 的 user_id → 用量、限流都按人算）
// 和「用哪条接入点转发」（绑 provider_id，不按档位解析）。
//
// 明文 key 只在 createRelayKey 的返回值里出现一次，库里只有 sha256。
// 丢了只能重新生成 —— 「再看一次」的能力换来的是密文可解，不值。
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../db/index.js';

export interface RelayKeyRow {
  id: string;
  user_id: string;
  provider_id: string;
  key_hash: string;
  key_prefix: string;
  label: string;
  enabled: number;
  revoked_at: string | null;
  revoke_reason: string;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

/** 对外展示用（不含 key_hash）。列表页拿这个。 */
export type RelayKeyPublic = Omit<RelayKeyRow, 'key_hash'>;

/**
 * key 前缀用 `sk-`：绝大多数 OpenAI 兼容客户端把它当普通字符串，
 * 但有些桌面客户端会在本地校验一下形状，不带前缀时**根本不发请求**就报
 * 「无效 API Key」—— 那个报错读起来像我们的接口坏了。跟着惯例最省事。
 */
const KEY_PREFIX = 'sk-mmpla-';

function hashKey(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function toPublic(row: RelayKeyRow): RelayKeyPublic {
  const { key_hash: _hash, ...rest } = row;
  return rest;
}

/**
 * 生成一把新 key。返回的 `key` 是**唯一一次**能看到明文的地方。
 *
 * 不检查「这条接入点已经有 key 了」：同一条接入点给多个下游各发一把是正常需求
 * （能单独吊销）。要防的是「一把 key 被多方共用」，那是靠能分开生成来解决的。
 */
export function createRelayKey(
  userId: string,
  providerId: string,
  label = ''
): { key: string; row: RelayKeyPublic } {
  const db = getDatabase();
  const raw = KEY_PREFIX + crypto.randomBytes(24).toString('hex');
  const now = new Date().toISOString();
  const row: RelayKeyRow = {
    id: uuidv4(),
    user_id: userId,
    provider_id: providerId,
    key_hash: hashKey(raw),
    // 首尾各留一段：中间省略号的位置固定，管理员对着复制出去的那把能认出是哪一把。
    key_prefix: `${raw.slice(0, KEY_PREFIX.length + 4)}…${raw.slice(-4)}`,
    label: label.trim().slice(0, 100),
    enabled: 1,
    revoked_at: null,
    revoke_reason: '',
    last_used_at: null,
    created_at: now,
    updated_at: now,
  };

  db.prepare(
    `INSERT INTO llm_relay_keys
       (id, user_id, provider_id, key_hash, key_prefix, label, enabled, revoked_at, revoke_reason, last_used_at, created_at, updated_at)
     VALUES (@id, @user_id, @provider_id, @key_hash, @key_prefix, @label, @enabled, @revoked_at, @revoke_reason, @last_used_at, @created_at, @updated_at)`
  ).run(row);

  return { key: raw, row: toPublic(row) };
}

export function listRelayKeys(userId: string): RelayKeyPublic[] {
  const db = getDatabase();
  const rows = db
    .prepare('SELECT * FROM llm_relay_keys WHERE user_id = ? ORDER BY created_at DESC')
    .all(userId) as RelayKeyRow[];
  return rows.map(toPublic);
}

export function getRelayKeyById(id: string): RelayKeyPublic | undefined {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM llm_relay_keys WHERE id = ?').get(id) as RelayKeyRow | undefined;
  return row && toPublic(row);
}

/**
 * 按明文 key 查（调用侧用）。已吊销/停用的行**照样返回** —— 由调用方决定回哪句话。
 * 在这里直接返回 undefined 的话，「key 抄错了」和「接口已关闭」会变成同一句
 * 「无效的 API Key」，下游会一直去核对那把没错的 key。
 */
export function findRelayKeyByRaw(raw: string): RelayKeyPublic | undefined {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM llm_relay_keys WHERE key_hash = ?').get(hashKey(raw)) as
    | RelayKeyRow
    | undefined;
  return row && toPublic(row);
}

export function touchRelayKey(id: string): void {
  getDatabase().prepare('UPDATE llm_relay_keys SET last_used_at = ? WHERE id = ?').run(new Date().toISOString(), id);
}

/** 手动吊销。已经吊销过的不覆盖原因（第一次的原因才是真的那个）。 */
export function revokeRelayKey(id: string, reason: string): void {
  const now = new Date().toISOString();
  getDatabase()
    .prepare(
      `UPDATE llm_relay_keys SET enabled = 0, revoked_at = COALESCE(revoked_at, ?),
         revoke_reason = CASE WHEN revoke_reason = '' THEN ? ELSE revoke_reason END, updated_at = ?
       WHERE id = ?`
    )
    .run(now, reason.slice(0, 200), now, id);
}

/**
 * 接入点被删除时把绑在它上面的 key 全部标废。
 *
 * 不能只靠调用时「查不到那条 provider 就拒」：provider 的 id 是外部可指定的
 * （种子那条就叫 default-llm），删掉再建一条同 id 的之后，那把早该失效的 key
 * 会连着新接入点继续工作 —— 下游一切正常，管理员以为自己已经断掉了。
 * 返回标废的条数，好让后台把「顺带吊销了 N 把对外 key」说出来。
 */
export function revokeRelayKeysByProvider(providerId: string, reason: string): number {
  const now = new Date().toISOString();
  const info = getDatabase()
    .prepare(
      `UPDATE llm_relay_keys SET enabled = 0, revoked_at = COALESCE(revoked_at, ?),
         revoke_reason = CASE WHEN revoke_reason = '' THEN ? ELSE revoke_reason END, updated_at = ?
       WHERE provider_id = ? AND revoked_at IS NULL`
    )
    .run(now, reason.slice(0, 200), now, providerId);
  return info.changes;
}
