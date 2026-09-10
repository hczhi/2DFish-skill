import { describe, it, expect, beforeEach } from 'vitest';
import { initDatabase, getDatabase } from '../db/index.js';
import { resolveCosTarget } from './upload.js';

initDatabase();

// PPT 专用桶配错时**每一种都伪装成成功**：图照样生成、接口 200、库里有 URL，
// 页面上要么是一张正常显示的图（其实写进了老桶），要么是一张裂图（域名和桶对不上）。
// 手测看不出来，所以这三条必须有测试。

function setConfig(pairs: Record<string, string>) {
  const db = getDatabase();
  for (const [key, value] of Object.entries(pairs)) {
    db.prepare('INSERT OR REPLACE INTO system_config (key, value, updated_at) VALUES (?, ?, ?)').run(key, value, new Date().toISOString());
  }
}

beforeEach(() => {
  getDatabase().prepare("DELETE FROM system_config WHERE key LIKE 'cos_%'").run();
  // 默认桶（旧桶）：四项齐。密钥这里存明文，tryDecryptSecret 对没有 enc: 前缀的值原样返回。
  setConfig({
    cos_secret_id: 'AKID-old',
    cos_secret_key: 'sk-old',
    cos_bucket: 'qiaonan-1318719556',
    cos_region: 'ap-guangzhou',
  });
});

describe('PPT 专用桶', () => {
  it('三项配齐、密钥留空时写 PPT 桶并复用默认桶的凭据', () => {
    setConfig({
      cos_ppt_bucket: 'ai-1303208826',
      cos_ppt_region: 'ap-guangzhou',
      cos_ppt_base: 'https://ai-1303208826.cos.ap-guangzhou.myqcloud.com/',
    });

    const t = resolveCosTarget('ppt');
    // Bucket 或 publicBase 漏了一处就是「图进了这个桶、URL 指着那个桶」，接口全程 200。
    expect(t).toEqual({
      SecretId: 'AKID-old',
      SecretKey: 'sk-old',
      Bucket: 'ai-1303208826',
      Region: 'ap-guangzhou',
      publicBase: 'https://ai-1303208826.cos.ap-guangzhou.myqcloud.com',
    });
    // 别的模块不传 profile，照旧走默认桶。
    expect(resolveCosTarget()?.Bucket).toBe('qiaonan-1318719556');
  });

  it('三项只填两项时抛错，不静默回落到默认桶', () => {
    setConfig({ cos_ppt_bucket: 'ai-1303208826', cos_ppt_region: 'ap-guangzhou' });
    expect(() => resolveCosTarget('ppt')).toThrow(/配置不全.*cos_ppt_base/);
  });

  it('公网域名和桶对不上时抛错（否则图写进桶里而页面是裂图）', () => {
    setConfig({
      cos_ppt_bucket: 'ai-1303208826',
      cos_ppt_region: 'ap-guangzhou',
      cos_ppt_base: 'https://other-1303208826.cos.ap-shanghai.myqcloud.com',
    });
    expect(() => resolveCosTarget('ppt')).toThrow(/对不上/);
  });
});
