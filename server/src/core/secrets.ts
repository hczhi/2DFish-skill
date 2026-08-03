/**
 * 数据库里第三方密钥的加密存储。
 *
 * 涉及三处明文：system_config 的 platform_api_key / web_search_api_key /
 * cos_secret_key、ai_providers.api_key、tender_user_preferences.feishu_app_secret。
 * 这些都是能直接花钱或读写外部数据的凭证，而 SQLite 文件会被随手 scp 出来做备份、
 * 也可能因为一个 SQL 注入或路径穿越被读走 —— 明文存着等于泄一次就全丢。
 *
 * 加密能挡住什么、挡不住什么，说清楚：
 *   ✅ 只拿到 .db 文件（备份泄露、误传仓库、SELECT 出整表）→ 拿不到密钥。
 *   ❌ 同时拿到进程环境变量（拿到 shell、读到 .env）→ 照样能解。
 * 这是「静态加密」的固有边界，不是本模块的缺陷；想再往上一层得上 KMS。
 *
 * 密钥来源：CONFIG_ENCRYPTION_KEY 环境变量；没设则从 JWT_SECRET 派生
 * （HKDF，所以派生出来的不是 JWT_SECRET 本身，签名密钥泄露不等于加密密钥泄露）。
 * 派生是为了让老部署升级时零配置就能跑起来，代价是换 JWT_SECRET 会连带
 * 解不开旧密钥 —— verifyEncryptionKey() 会在启动时检出并明确报错，
 * 而不是让管理员对着一堆「API 调用失败」瞎猜。
 *
 * 想让加密密钥独立于 JWT_SECRET（推荐）：把 JWT_SECRET 当前的值原样抄进
 * CONFIG_ENCRYPTION_KEY，之后两者就可以各自轮换。两条来源对同一个字符串
 * 派生出同一把密钥，所以这一步不需要重填任何配置。
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, createHash } from 'node:crypto';

/** 加密值的前缀。带版本号，将来换算法可以共存解码。 */
const PREFIX = 'enc:v1:';
const ALGO = 'aes-256-gcm';
const IV_LEN = 12; // GCM 标准 96 bit
const TAG_LEN = 16;

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;

  const explicit = process.env.CONFIG_ENCRYPTION_KEY;
  const source = explicit || process.env.JWT_SECRET;
  if (!source) {
    // 和 JWT_SECRET 缺失时的行为保持一致：开发环境给个固定值让流程能跑通，
    // 生产环境由 app.ts 的启动检查拦下来。
    return (cachedKey = deriveKey('mmPla-dev-secret-change-in-production'));
  }
  return (cachedKey = deriveKey(source));
}

function deriveKey(source: string): Buffer {
  // info 里写死用途，和 requester.ts 里用 JWT_SECRET 做 HMAC 指纹的用法隔开
  return Buffer.from(hkdfSync('sha256', source, 'mmPla-config-salt', 'config-secret-encryption', 32));
}

/** 测试里改了环境变量后需要重取密钥。 */
export function resetKeyCache(): void {
  cachedKey = null;
}

export function isEncrypted(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

/** 加密。空串原样返回——「没配」和「配了空」在业务上是一回事，不必加密。 */
export function encryptSecret(plain: string): string {
  if (!plain) return '';
  if (isEncrypted(plain)) return plain; // 幂等：重复加密不会套娃
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64');
}

/**
 * 解密。没有前缀的值当明文原样返回 —— 迁移漏掉的、或者直接用 sqlite3 命令行
 * 塞进去的裸 key 都还能用，不会因为加密改造把线上打挂。
 *
 * 解不开时抛错而不是返回空串：空串会被上层当成「没配置密钥」，
 * 于是管理员看到的是"功能未启用"，真正的原因（密钥变了）被吞掉。
 */
export function decryptSecret(stored: string | null | undefined): string {
  if (!stored) return '';
  if (!isEncrypted(stored)) return stored;
  const raw = Buffer.from(stored.slice(PREFIX.length), 'base64');
  const iv = raw.subarray(0, IV_LEN);
  const tag = raw.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = raw.subarray(IV_LEN + TAG_LEN);
  try {
    const decipher = createDecipheriv(ALGO, getKey(), iv);
    decipher.setAuthTag(tag);
    return decipher.update(ct, undefined, 'utf8') + decipher.final('utf8');
  } catch {
    throw new Error(
      '密钥解密失败：CONFIG_ENCRYPTION_KEY（或用于派生的 JWT_SECRET）与加密时不一致。' +
        '请恢复原值，或在后台重新填写各项密钥。'
    );
  }
}

/** 解不开也要能显示的场合用这个（列表页、脱敏回显），不要让一条坏数据把整页打成 500。 */
export function tryDecryptSecret(stored: string | null | undefined): string | null {
  try {
    return decryptSecret(stored);
  } catch {
    return null;
  }
}

/**
 * 脱敏回显：只留头尾。太短的一律 '****' —— 留头尾对短 key 等于泄露大半。
 * 传入的可以是加密值也可以是明文，这里统一先解密。
 */
export function maskSecret(stored: string | null | undefined): string {
  const plain = tryDecryptSecret(stored);
  if (plain === null) return '(无法解密)';
  if (!plain) return '';
  return plain.length > 11 ? `${plain.slice(0, 7)}...${plain.slice(-4)}` : '****';
}

/**
 * 处理「前端脱敏回显后原样提交回来」的保存请求，返回应当落库的密文。
 *
 * 后台表单是把 GET 回来的值直接 v-model 到 input 上、保存时整个 PUT 回来的。
 * 管理员只改了别的字段时，提交上来的密钥字段就是那串脱敏文本 ——
 * 不识别它就会把 'sk-abcd...wxyz' 当成新密钥存进去，把真 key 覆盖掉。
 *
 * 两种情况都视为「不修改」：提交空串，或提交的值和当前脱敏结果一致。
 */
export function resolveSubmittedSecret(submitted: string | null | undefined, stored: string | null | undefined): string {
  const current = stored || '';
  if (!submitted) return current;
  if (submitted === maskSecret(current)) return current;
  return encryptSecret(submitted);
}

/** 当前密钥的指纹。只用来比对「密钥有没有换」，不可逆推。 */
export function keyFingerprint(): string {
  return createHash('sha256').update(getKey()).digest('hex').slice(0, 16);
}

const FINGERPRINT_KEY = '_config_key_fingerprint';

/**
 * 启动时校验加密密钥是否还是当初加密时那把，并在首次运行时记下指纹。
 *
 * 存在的理由：默认密钥是从 JWT_SECRET 派生的，而轮换 JWT_SECRET 是个
 * 完全合理的运维动作（它自己的语义只是"让旧 token 失效"）。轮换之后
 * 库里所有密钥都解不开了，但表现出来只是"AI 调用失败 / 上传失败 / 同步失败"
 * 三个互不相干的故障 —— 排查方向根本不会指向 JWT_SECRET。
 * 这里把它变成启动时一条说清楚原因的日志。
 *
 * 只警告不退出：真发生了轮换，管理员重填一遍密钥就能恢复，
 * 而站点的其他功能（内容、游戏、看板）不该被一起拖下线。
 */
// db 由调用方传入而不是在这里 import getDatabase()：db/index → migrations →
// 050_encrypt_secrets → 本模块已经是一条依赖链，反向 import 会成环。
// prepare 用 any 是为了同时接住 better-sqlite3 的 Database 和测试里的假库
// （Statement 的泛型签名没法用结构化类型精确表达）。
export interface MinimalDb {
  prepare(sql: string): any;
}

export function verifyEncryptionKey(db: MinimalDb): 'ok' | 'initialized' | 'mismatch' {
  const current = keyFingerprint();
  const row = db.prepare('SELECT value FROM system_config WHERE key = ?').get(FINGERPRINT_KEY) as
    | { value: string }
    | undefined;

  if (!row) {
    db.prepare('INSERT OR REPLACE INTO system_config (key, value, updated_at) VALUES (?, ?, ?)').run(
      FINGERPRINT_KEY,
      current,
      new Date().toISOString()
    );
    return 'initialized';
  }

  if (row.value === current) return 'ok';

  console.error(
    '[mmPla] ⚠️  配置加密密钥已变更（CONFIG_ENCRYPTION_KEY，或用于派生它的 JWT_SECRET）。\n' +
      '        库中已加密的第三方密钥（平台 API key / 搜索 key / COS / 飞书 App Secret）将无法解密。\n' +
      '        请恢复原来的值，或设置固定的 CONFIG_ENCRYPTION_KEY 后在后台重新填写各项密钥。'
  );
  return 'mismatch';
}
