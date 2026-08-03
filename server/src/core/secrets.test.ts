import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  encryptSecret,
  decryptSecret,
  tryDecryptSecret,
  isEncrypted,
  maskSecret,
  resolveSubmittedSecret,
  keyFingerprint,
  verifyEncryptionKey,
  resetKeyCache,
} from './secrets.js';

// 密钥是模块内缓存的，每个用例都要在改环境变量后清一次
beforeEach(() => {
  process.env.CONFIG_ENCRYPTION_KEY = 'test-encryption-key-aaaaaaaaaaaaaaaa';
  resetKeyCache();
});

afterEach(() => {
  delete process.env.CONFIG_ENCRYPTION_KEY;
  resetKeyCache();
  vi.restoreAllMocks();
});

describe('encrypt / decrypt', () => {
  it('往返还原原文', () => {
    const plain = 'sk-proj-abcdefghijklmnopqrstuvwxyz0123456789';
    const enc = encryptSecret(plain);
    expect(enc).not.toContain(plain);
    expect(decryptSecret(enc)).toBe(plain);
  });

  it('同一明文两次加密得到不同密文（IV 随机）', () => {
    // 固定 IV 会让相同的 key 产出相同密文，等于泄露"这两个用户配了同一个 key"
    const a = encryptSecret('same-secret-value');
    const b = encryptSecret('same-secret-value');
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe(decryptSecret(b));
  });

  it('空串不加密', () => {
    expect(encryptSecret('')).toBe('');
    expect(decryptSecret('')).toBe('');
    expect(decryptSecret(null)).toBe('');
    expect(decryptSecret(undefined)).toBe('');
  });

  it('加密是幂等的，不会把密文再套一层', () => {
    // 迁移重跑、或者保存流程里不小心加密两次都会走到这
    const once = encryptSecret('my-key');
    expect(encryptSecret(once)).toBe(once);
    expect(decryptSecret(once)).toBe('my-key');
  });

  it('没有前缀的旧明文原样返回', () => {
    // 加密改造上线前存进去的裸 key，以及有人直接用 sqlite3 命令行塞的值，都必须还能用
    expect(decryptSecret('sk-legacy-plaintext')).toBe('sk-legacy-plaintext');
    expect(isEncrypted('sk-legacy-plaintext')).toBe(false);
  });

  it('中文与多字节字符不被截断', () => {
    const plain = '飞书应用密钥-测试-🔑';
    expect(decryptSecret(encryptSecret(plain))).toBe(plain);
  });

  it('换了密钥后解密抛出可读原因，而不是静默返回空', () => {
    // 静默返回空串会被上层当成"未配置"，真实原因（密钥变了）就此消失
    const enc = encryptSecret('original-secret');
    process.env.CONFIG_ENCRYPTION_KEY = 'a-completely-different-key-bbbbbb';
    resetKeyCache();
    expect(() => decryptSecret(enc)).toThrow(/解密失败/);
  });

  it('密文被篡改时解密失败（GCM 完整性校验）', () => {
    const enc = encryptSecret('original-secret');
    const body = enc.slice('enc:v1:'.length);
    const raw = Buffer.from(body, 'base64');
    raw[raw.length - 1] ^= 0xff; // 改掉密文最后一个字节
    const tampered = 'enc:v1:' + raw.toString('base64');
    expect(() => decryptSecret(tampered)).toThrow(/解密失败/);
  });

  it('tryDecryptSecret 解不开时返回 null 而不抛', () => {
    const enc = encryptSecret('original-secret');
    process.env.CONFIG_ENCRYPTION_KEY = 'another-different-key-cccccccccc';
    resetKeyCache();
    expect(tryDecryptSecret(enc)).toBeNull();
  });
});

describe('maskSecret', () => {
  it('长 key 只留头尾', () => {
    const enc = encryptSecret('sk-proj-1234567890abcdef');
    expect(maskSecret(enc)).toBe('sk-proj...cdef');
  });

  it('短 key 全部遮住', () => {
    // 只留头尾对短 key 等于泄露大半
    expect(maskSecret(encryptSecret('short'))).toBe('****');
    expect(maskSecret(encryptSecret('12345678901'))).toBe('****');
  });

  it('空值返回空串', () => {
    expect(maskSecret('')).toBe('');
    expect(maskSecret(null)).toBe('');
  });

  it('解不开时给出明确提示而不是空串', () => {
    const enc = encryptSecret('original-secret');
    process.env.CONFIG_ENCRYPTION_KEY = 'yet-another-key-dddddddddddddddd';
    resetKeyCache();
    expect(maskSecret(enc)).toBe('(无法解密)');
  });

  it('对明文输入同样有效', () => {
    expect(maskSecret('sk-proj-1234567890abcdef')).toBe('sk-proj...cdef');
  });
});

describe('resolveSubmittedSecret', () => {
  it('提交脱敏串时保留原密钥不变', () => {
    // 这是最关键的一条：后台表单把 GET 到的脱敏值原样 PUT 回来，
    // 不识别就会把真 key 覆盖成 'sk-proj...cdef'
    const stored = encryptSecret('sk-proj-1234567890abcdef');
    const submitted = maskSecret(stored);
    expect(resolveSubmittedSecret(submitted, stored)).toBe(stored);
    expect(decryptSecret(resolveSubmittedSecret(submitted, stored))).toBe('sk-proj-1234567890abcdef');
  });

  it('提交空串时保留原密钥不变', () => {
    const stored = encryptSecret('sk-proj-1234567890abcdef');
    expect(resolveSubmittedSecret('', stored)).toBe(stored);
    expect(resolveSubmittedSecret(undefined, stored)).toBe(stored);
  });

  it('提交新值时加密后替换', () => {
    const stored = encryptSecret('old-secret-value-here');
    const next = resolveSubmittedSecret('brand-new-secret-value', stored);
    expect(isEncrypted(next)).toBe(true);
    expect(decryptSecret(next)).toBe('brand-new-secret-value');
  });

  it('原本没配过时，提交新值即为首次设置', () => {
    const next = resolveSubmittedSecret('first-secret-value', '');
    expect(decryptSecret(next)).toBe('first-secret-value');
  });

  it('原本没配过且提交为空时结果仍为空', () => {
    expect(resolveSubmittedSecret('', null)).toBe('');
  });
});

describe('密钥来源', () => {
  it('未设 CONFIG_ENCRYPTION_KEY 时从 JWT_SECRET 派生', () => {
    delete process.env.CONFIG_ENCRYPTION_KEY;
    process.env.JWT_SECRET = 'jwt-secret-for-derivation-test';
    resetKeyCache();
    const enc = encryptSecret('derived-key-secret');
    expect(decryptSecret(enc)).toBe('derived-key-secret');
  });

  it('把派生密钥提升为显式 CONFIG_ENCRYPTION_KEY 是零停机操作', () => {
    // 想脱离 JWT_SECRET 的推荐路径就是：先把它当前的值抄进 CONFIG_ENCRYPTION_KEY，
    // 之后再各自轮换。这一步必须解得开旧密钥，否则等于强迫管理员重填一遍所有配置。
    delete process.env.CONFIG_ENCRYPTION_KEY;
    process.env.JWT_SECRET = 'shared-secret-string';
    resetKeyCache();
    const enc = encryptSecret('secret-before-promotion');
    const fromJwt = keyFingerprint();

    process.env.CONFIG_ENCRYPTION_KEY = 'shared-secret-string';
    resetKeyCache();

    expect(keyFingerprint()).toBe(fromJwt);
    expect(decryptSecret(enc)).toBe('secret-before-promotion');
  });

  it('派生出的密钥不是 JWT_SECRET 本身', () => {
    // 直接把签名密钥当加密密钥用，会让一处泄露波及另一处；HKDF 是为了隔开它们
    delete process.env.CONFIG_ENCRYPTION_KEY;
    process.env.JWT_SECRET = 'a'.repeat(32); // 恰好 32 字节，若不派生就会被原样当 key
    resetKeyCache();
    const rawAsKey = Buffer.from('a'.repeat(32)).toString('hex');
    expect(keyFingerprint()).not.toBe(rawAsKey.slice(0, 16));
  });

  it('指纹稳定且不含密钥原文', () => {
    const a = keyFingerprint();
    resetKeyCache();
    expect(keyFingerprint()).toBe(a);
    expect(a).not.toContain('test-encryption-key');
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('verifyEncryptionKey', () => {
  /** 只实现 verifyEncryptionKey 用到的两条 SQL，够用且不必起真库。 */
  function fakeDb(initial?: string) {
    const store = new Map<string, string>();
    if (initial !== undefined) store.set('_config_key_fingerprint', initial);
    return {
      store,
      prepare: (_sql: string) => ({
        get: (k: unknown) => (store.has(String(k)) ? { value: store.get(String(k)) } : undefined),
        run: (k: unknown, v: unknown) => store.set(String(k), String(v)),
      }),
    };
  }

  it('首次运行写入指纹', () => {
    const db = fakeDb();
    expect(verifyEncryptionKey(db as any)).toBe('initialized');
    expect(db.store.get('_config_key_fingerprint')).toBe(keyFingerprint());
  });

  it('指纹一致时返回 ok', () => {
    const db = fakeDb(keyFingerprint());
    expect(verifyEncryptionKey(db as any)).toBe('ok');
  });

  it('密钥被换掉时检出 mismatch 并报错', () => {
    // 这条断言就是那个 bug：轮换 JWT_SECRET 是合理运维动作，
    // 但会让库里所有密钥失效，且只表现为几处互不相干的调用失败
    const db = fakeDb(keyFingerprint());
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env.CONFIG_ENCRYPTION_KEY = 'rotated-to-a-new-key-eeeeeeeeeee';
    resetKeyCache();
    expect(verifyEncryptionKey(db as any)).toBe('mismatch');
    expect(spy).toHaveBeenCalled();
    expect(spy.mock.calls[0][0]).toMatch(/加密密钥已变更/);
  });
});
