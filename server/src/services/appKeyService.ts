// 售卖型应用 key（migration 112）：一把 key = 一个应用里的一个用户，余额按点数记。
//
// 余额的每一次变动都走 `applyDelta`（同一个事务里改 balance + 写一行流水），别在别处直接
// UPDATE balance —— 那样后台显示的余额和流水对不上，而两边各自看起来都正常。
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../db/index.js';
import { encryptSecret, tryDecryptSecret } from '../core/secrets.js';

/**
 * 可售卖的应用。键和 gateway 的 `source` 一致（后面按调用扣点时直接用 source 对上）。
 * 每个应用的 key 前缀不同：把咨询的 key 输进 ppt 页面时能明确说「这是品牌咨询的 key」，
 * 而不是一句「无效」—— 后者他只会反复核对那把没抄错的 key。
 */
export const KEY_APPS = {
  ppt: { prefix: 'PPT', label: 'HTML 展示稿' },
  consult: { prefix: 'CST', label: '品牌咨询' },
} as const;
export type KeyApp = keyof typeof KEY_APPS;

export function isKeyApp(app: unknown): app is KeyApp {
  return typeof app === 'string' && Object.prototype.hasOwnProperty.call(KEY_APPS, app);
}

export interface AppKeyRow {
  id: string;
  app: KeyApp;
  key_hash: string;
  key_enc: string;
  key_prefix: string;
  label: string;
  batch_id: string | null;
  balance: number;
  /** 进行中的调用冻结的点数（113）。可用 = balance − frozen。 */
  frozen: number;
  user_id: string | null;
  enabled: number;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
}
export type AppKeyPublic = Omit<AppKeyRow, 'key_hash' | 'key_enc'>;

export interface LedgerRow {
  id: string;
  key_id: string;
  kind: 'grant' | 'adjust' | 'charge' | 'topup';
  delta: number;
  balance_after: number;
  operation: string;
  ai_log_id: string | null;
  note: string;
  created_at: string;
}

export class AppKeyError extends Error {
  status = 400;
}

// 去掉 0/O/1/I/L：买家多半是从手机上的淘宝订单里照着敲的，这几个字符抄错一个就是「无效」。
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

function randomBody(): string {
  const bytes = crypto.randomBytes(16);
  let s = '';
  for (let i = 0; i < 16; i++) {
    s += ALPHABET[bytes[i] % ALPHABET.length];
    if (i % 4 === 3 && i < 15) s += '-';
  }
  return s;
}

/** 输入归一：去空白、转大写。复制时带进来的空格/换行、手敲的小写都不该变成「无效」。 */
export function normalizeRawKey(raw: string): string {
  return raw.replace(/\s+/g, '').toUpperCase();
}

function hashKey(raw: string): string {
  return crypto.createHash('sha256').update(normalizeRawKey(raw)).digest('hex');
}

function toPublic(row: AppKeyRow): AppKeyPublic {
  const { key_hash: _h, key_enc: _e, ...rest } = row;
  return rest;
}

export function createAppKeys(
  app: KeyApp,
  count: number,
  balance: number,
  label = ''
): { batchId: string; keys: Array<{ id: string; key: string }> } {
  if (!Number.isInteger(count) || count < 1 || count > 500) throw new AppKeyError('数量必须是 1 到 500 之间的整数');
  if (!Number.isInteger(balance) || balance < 0) throw new AppKeyError('初始点数必须是不小于 0 的整数');

  const db = getDatabase();
  const batchId = uuidv4();
  const now = new Date().toISOString();
  const cleanLabel = label.trim().slice(0, 100);
  const insertKey = db.prepare(
    `INSERT INTO app_keys (id, app, key_hash, key_enc, key_prefix, label, batch_id, balance, user_id, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, 1, ?, ?)`
  );
  const out: Array<{ id: string; key: string }> = [];

  db.transaction(() => {
    for (let i = 0; i < count; i++) {
      const raw = `${KEY_APPS[app].prefix}-${randomBody()}`;
      const id = uuidv4();
      insertKey.run(id, app, hashKey(raw), encryptSecret(raw), `${raw.slice(0, 8)}…${raw.slice(-4)}`, cleanLabel, batchId, now, now);
      // 初始点数也记一行流水：流水从第一行起就能加总成余额，对账不用特判「开卡时给的」。
      if (balance > 0) applyDelta(id, balance, 'grant', { note: '开卡' });
      out.push({ id, key: raw });
    }
  })();

  return { batchId, keys: out };
}

export function listAppKeys(app: KeyApp): AppKeyPublic[] {
  const rows = getDatabase()
    .prepare('SELECT * FROM app_keys WHERE app = ? ORDER BY created_at DESC, rowid DESC')
    .all(app) as AppKeyRow[];
  return rows.map(toPublic);
}

export function getAppKey(id: string): AppKeyRow | undefined {
  return getDatabase().prepare('SELECT * FROM app_keys WHERE id = ?').get(id) as AppKeyRow | undefined;
}

/**
 * 按明文找 key。停用的**照样返回**（调用方自己判 enabled）：当成不存在的话，
 * 「key 抄错了」和「key 被停用了」会合成同一句「无效」。
 */
export function findAppKeyByRaw(raw: string): AppKeyRow | undefined {
  return getDatabase().prepare('SELECT * FROM app_keys WHERE key_hash = ?').get(hashKey(raw)) as AppKeyRow | undefined;
}

export function revealAppKey(id: string): string {
  const row = getAppKey(id);
  if (!row) throw new AppKeyError('key 不存在');
  const plain = tryDecryptSecret(row.key_enc);
  // 解不开要说成因：说成「key 不存在」的话管理员会以为这张卡被删了。
  if (!plain) throw new AppKeyError('明文解密失败：CONFIG_ENCRYPTION_KEY（或 JWT_SECRET）和生成时不一致');
  return plain;
}

export function updateAppKey(id: string, patch: { enabled?: boolean; label?: string }): AppKeyPublic {
  const row = getAppKey(id);
  if (!row) throw new AppKeyError('key 不存在');
  const enabled = patch.enabled !== undefined ? (patch.enabled ? 1 : 0) : row.enabled;
  const label = patch.label !== undefined ? patch.label.trim().slice(0, 100) : row.label;
  getDatabase()
    .prepare('UPDATE app_keys SET enabled = ?, label = ?, updated_at = ? WHERE id = ?')
    .run(enabled, label, new Date().toISOString(), id);
  return toPublic(getAppKey(id)!);
}

/**
 * 余额唯一的变动入口。扣到负数直接拒（不截到 0）：截掉的话流水上 delta 和
 * balance_after 对不上，而那一行读起来就是一笔正常的扣减。
 */
export function applyDelta(
  keyId: string,
  delta: number,
  kind: LedgerRow['kind'],
  extra: { operation?: string; aiLogId?: string | null; note?: string } = {}
): LedgerRow {
  if (!Number.isInteger(delta) || delta === 0) throw new AppKeyError('变动点数必须是非 0 整数');
  const db = getDatabase();
  return db.transaction(() => {
    const row = db.prepare('SELECT balance, frozen FROM app_keys WHERE id = ?').get(keyId) as
      | { balance: number; frozen: number }
      | undefined;
    if (!row) throw new AppKeyError('key 不存在');
    const after = row.balance + delta;
    if (after < 0) throw new AppKeyError(`余额不足：当前 ${row.balance} 点，这次要扣 ${-delta} 点`);
    // 不许扣到冻结额以下：后台调减撞上进行中的调用时，那次调用结算会失败 ——
    // 而它已经花了平台的钱、结果也已经出来了。
    if (after < row.frozen) {
      throw new AppKeyError(`有 ${row.frozen} 点正被进行中的调用冻结，最多只能扣到 ${row.frozen} 点，稍后再试`);
    }
    const now = new Date().toISOString();
    db.prepare('UPDATE app_keys SET balance = ?, updated_at = ? WHERE id = ?').run(after, now, keyId);
    const entry: LedgerRow = {
      id: uuidv4(),
      key_id: keyId,
      kind,
      delta,
      balance_after: after,
      operation: extra.operation ?? '',
      ai_log_id: extra.aiLogId ?? null,
      note: (extra.note ?? '').slice(0, 200),
      created_at: now,
    };
    db.prepare(
      `INSERT INTO app_key_ledger (id, key_id, kind, delta, balance_after, operation, ai_log_id, note, created_at)
       VALUES (@id, @key_id, @kind, @delta, @balance_after, @operation, @ai_log_id, @note, @created_at)`
    ).run(entry);
    return entry;
  })();
}

export function listLedger(keyId: string, limit = 200): LedgerRow[] {
  return getDatabase()
    .prepare('SELECT * FROM app_key_ledger WHERE key_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?')
    .all(keyId, limit) as LedgerRow[];
}

export class AppKeyAuthError extends Error {}

/**
 * 请求里带的 key → 这张卡（和它的影子用户）。两种失败各说各的成因：合成一句「无效」的话，
 * 被停用的会一直重新粘贴、抄错的会去找卖家。
 */
export function authenticateAppKey(raw: string): AppKeyRow & { user_id: string } {
  const row = findAppKeyByRaw(raw);
  if (!row) throw new AppKeyAuthError('没有这个 key，请核对是否抄错（字母不区分大小写）');
  if (!row.enabled) throw new AppKeyAuthError('这个 key 已停用，请联系卖家');
  const userId = ensureKeyUser(row);
  touchKey(row);
  return { ...row, user_id: userId };
}

/**
 * 每张卡一个隐藏的影子用户（`key:<id>`），业务代码里所有按 user_id 的归属判定照旧成立，
 * 两张卡天然互相看不见。password_hash 写 '!'：bcrypt 永远比对不上，这个用户名登不进来。
 */
export const KEY_USER_PREFIX = 'key:';

function ensureKeyUser(row: AppKeyRow): string {
  if (row.user_id) return row.user_id;
  const db = getDatabase();
  const userId = uuidv4();
  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare(
      `INSERT INTO user (id, username, password_hash, role, created_at, updated_at) VALUES (?, ?, '!', 'user', ?, ?)`
    ).run(userId, KEY_USER_PREFIX + row.id, now, now);
    db.prepare('UPDATE app_keys SET user_id = ? WHERE id = ?').run(userId, row.id);
  })();
  return userId;
}

function touchKey(row: AppKeyRow): void {
  const now = Date.now();
  if (row.last_used_at && now - Date.parse(row.last_used_at) < 60_000) return;
  getDatabase().prepare('UPDATE app_keys SET last_used_at = ? WHERE id = ?').run(new Date(now).toISOString(), row.id);
}

// ── 按次扣点（113）：调用前冻结、成功后结算、失败解冻 ──────────────────────────

/** 单价。文本每次 AI 调用 1 点、生图每张 5 点 —— 不看 token，买家算得清。 */
export const POINT_PRICE = { text: 1, image: 5 } as const;

export class PointsExhaustedError extends Error {
  status = 402;
  constructor(available: number, price: number) {
    // 不复用 QuotaExceededError：那个会触发前台的「今日额度 N 次/天」弹窗，
    // 而 key 用户根本没有日额度这回事，他会去找一个不存在的「明天再来」。
    super(`点数不足：这把 key 还剩 ${available} 点，这次要 ${price} 点。请联系卖家充值后再试（这次没有扣点）。`);
    this.name = 'PointsExhaustedError';
  }
}

export interface PointHold {
  keyId: string;
  price: number;
}

/** 这个 user 是不是某把应用 key 的影子用户。是的话它不走 ai_quota 日额度，走点数。 */
export function keyIdOfUser(userId: string | undefined): string | null {
  if (!userId) return null;
  const row = getDatabase().prepare('SELECT id FROM app_keys WHERE user_id = ?').get(userId) as { id: string } | undefined;
  return row?.id ?? null;
}

/**
 * 冻结一次调用的价。不是 key 用户回 null（调用方照旧走日额度）。
 * 条件写在 UPDATE 里（balance − frozen ≥ price）：先读再写的话两个并发请求会各自看见「够」。
 */
export function holdPoints(userId: string | undefined, price: number): PointHold | null {
  const keyId = keyIdOfUser(userId);
  if (!keyId) return null;
  const db = getDatabase();
  const r = db
    .prepare('UPDATE app_keys SET frozen = frozen + ? WHERE id = ? AND balance - frozen >= ?')
    .run(price, keyId, price);
  if (r.changes === 0) {
    const row = db.prepare('SELECT balance, frozen FROM app_keys WHERE id = ?').get(keyId) as { balance: number; frozen: number };
    throw new PointsExhaustedError(row.balance - row.frozen, price);
  }
  return { keyId, price };
}

/** 调用成功：解冻并记一笔 charge（同一个事务，流水照旧能加总成余额）。 */
export function settlePoints(hold: PointHold | null, operation: string, aiLogId?: string | null): void {
  if (!hold) return;
  const db = getDatabase();
  db.transaction(() => {
    db.prepare('UPDATE app_keys SET frozen = MAX(frozen - ?, 0) WHERE id = ?').run(hold.price, hold.keyId);
    applyDelta(hold.keyId, -hold.price, 'charge', { operation, aiLogId });
  })();
}

/** 调用失败：只解冻，不留流水（没花钱就不该出现在他的账单上）。 */
export function releasePoints(hold: PointHold | null): void {
  if (!hold) return;
  getDatabase().prepare('UPDATE app_keys SET frozen = MAX(frozen - ?, 0) WHERE id = ?').run(hold.price, hold.keyId);
}

// ── 充值码（115）：给已有的 key 加点，稿子不用搬 ──────────────────────────────

export type RechargeStatus = 'unused' | 'issued' | 'used';

export interface RechargeCodeRow {
  id: string;
  app: KeyApp;
  code_hash: string;
  code_enc: string;
  code_prefix: string;
  points: number;
  label: string;
  batch_id: string;
  status: RechargeStatus;
  issued_at: string | null;
  used_at: string | null;
  used_key_id: string | null;
  created_at: string;
}
export type RechargeCodePublic = Omit<RechargeCodeRow, 'code_hash' | 'code_enc'> & { used_key_prefix: string | null };

/**
 * 码的形状是 `PPTCZ-XXXX-…`：和 key 的 `PPT-XXXX-…` 一眼能分开，两个输入框贴反了时能说出
 * 「这是 key / 这是充值码」，而不是一句「无效」。
 */
export const RECHARGE_CODE_RE = /^\s*(PPT|CST)CZ-/i;

export function createRechargeCodes(
  app: KeyApp,
  count: number,
  points: number,
  label = ''
): { batchId: string; codes: Array<{ id: string; code: string }> } {
  if (!Number.isInteger(count) || count < 1 || count > 500) throw new AppKeyError('数量必须是 1 到 500 之间的整数');
  if (!Number.isInteger(points) || points < 1) throw new AppKeyError('面值必须是正整数点数');
  const db = getDatabase();
  const batchId = uuidv4();
  const now = new Date().toISOString();
  const cleanLabel = label.trim().slice(0, 100);
  const insert = db.prepare(
    `INSERT INTO recharge_codes (id, app, code_hash, code_enc, code_prefix, points, label, batch_id, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'unused', ?)`
  );
  const out: Array<{ id: string; code: string }> = [];
  db.transaction(() => {
    for (let i = 0; i < count; i++) {
      const raw = `${KEY_APPS[app].prefix}CZ-${randomBody()}`;
      const id = uuidv4();
      insert.run(id, app, hashKey(raw), encryptSecret(raw), `${raw.slice(0, 10)}…${raw.slice(-4)}`, points, cleanLabel, batchId, now);
      out.push({ id, code: raw });
    }
  })();
  return { batchId, codes: out };
}

export function listRechargeCodes(app: KeyApp): RechargeCodePublic[] {
  const rows = getDatabase()
    .prepare(
      `SELECT c.*, k.key_prefix AS used_key_prefix FROM recharge_codes c
       LEFT JOIN app_keys k ON k.id = c.used_key_id
       WHERE c.app = ? ORDER BY c.created_at DESC, c.rowid DESC`
    )
    .all(app) as Array<RechargeCodeRow & { used_key_prefix: string | null }>;
  return rows.map(({ code_hash: _h, code_enc: _e, ...rest }) => rest);
}

export function revealRechargeCode(id: string): string {
  const row = getDatabase().prepare('SELECT code_enc FROM recharge_codes WHERE id = ?').get(id) as { code_enc: string } | undefined;
  if (!row) throw new AppKeyError('充值码不存在');
  const plain = tryDecryptSecret(row.code_enc);
  if (!plain) throw new AppKeyError('明文解密失败：CONFIG_ENCRYPTION_KEY（或 JWT_SECRET）和生成时不一致');
  return plain;
}

/**
 * 标记发放 / 撤回发放。只动 unused ⇄ issued 两态，已使用的码一律不动（条件写在 UPDATE 里）——
 * 把一张用过的码改回「未使用」的话后台会显示它还能卖，再卖一次就是买家付钱充不上。
 * 回实际改了几张：勾了 10 张其中 3 张已用，界面要能说出来，而不是一句「已标记」。
 */
export function setRechargeIssued(ids: string[], issued: boolean): number {
  if (!ids.length) return 0;
  const db = getDatabase();
  const now = new Date().toISOString();
  const stmt = issued
    ? db.prepare(`UPDATE recharge_codes SET status = 'issued', issued_at = ? WHERE id = ? AND status = 'unused'`)
    : db.prepare(`UPDATE recharge_codes SET status = 'unused', issued_at = NULL WHERE id = ? AND status = 'issued'`);
  let n = 0;
  db.transaction(() => {
    for (const id of ids) n += (issued ? stmt.run(now, id) : stmt.run(id)).changes;
  })();
  return n;
}

/**
 * 买家把码充进当前这把 key。每种失败各说各的成因（合成「无效」的话：贴成 key 的会一直重贴、
 * 充错应用的会去找卖家要一张一样的、双击第二下的会以为第一下没成）。
 */
export function redeemRechargeCode(keyId: string, raw: string): { points: number; balance: number } {
  const key = getAppKey(keyId);
  if (!key) throw new AppKeyError('key 不存在');
  if (!RECHARGE_CODE_RE.test(raw)) {
    if (/^\s*(PPT|CST)-/i.test(raw)) throw new AppKeyError('这是一把 key，不是充值码。充值码以 PPTCZ- / CSTCZ- 开头');
    throw new AppKeyError('这不是充值码的格式（应以 PPTCZ- / CSTCZ- 开头），请核对是否抄错');
  }
  const db = getDatabase();
  return db.transaction(() => {
    const code = db.prepare('SELECT * FROM recharge_codes WHERE code_hash = ?').get(hashKey(raw)) as RechargeCodeRow | undefined;
    if (!code) throw new AppKeyError('没有这个充值码，请核对是否抄错（字母不区分大小写）');
    if (code.app !== key.app) {
      throw new AppKeyError(`这是「${KEY_APPS[code.app].label}」的充值码，只能充给${KEY_APPS[code.app].label}的 key（这次没有扣掉它）`);
    }
    const now = new Date().toISOString();
    const r = db
      .prepare(`UPDATE recharge_codes SET status = 'used', used_at = ?, used_key_id = ? WHERE id = ? AND status != 'used'`)
      .run(now, keyId, code.id);
    if (r.changes === 0) {
      const used = db.prepare('SELECT used_at, used_key_id FROM recharge_codes WHERE id = ?').get(code.id) as { used_at: string; used_key_id: string };
      // 按北京时间说：买家拿这个时间去对自己的操作记录，UTC 会差出 8 小时。
      const when = new Date(used.used_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }).slice(0, -3);
      if (used.used_key_id === keyId) throw new AppKeyError(`这张码已经在 ${when} 充进你这把 key 了，不会重复加点`);
      throw new AppKeyError(`这张码已经在 ${when} 被用过（充进了另一把 key），请联系卖家`);
    }
    const entry = applyDelta(keyId, code.points, 'topup', { operation: code.id, note: `充值码 ${code.code_prefix}` });
    return { points: code.points, balance: entry.balance_after - getAppKey(keyId)!.frozen };
  })();
}
