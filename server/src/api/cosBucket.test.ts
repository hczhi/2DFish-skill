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
  it('三项配齐、密钥留空时写 PPT 桶、复用默认桶的凭据，URL 走 CDN 默认域名', () => {
    setConfig({
      cos_ppt_bucket: 'ai-1303208826',
      cos_ppt_region: 'ap-guangzhou',
      cos_ppt_base: 'https://ai-1303208826.cos.ap-guangzhou.myqcloud.com/',
    });

    const t = resolveCosTarget('ppt');
    // Bucket 或 publicBase 漏了一处就是「图进了这个桶、URL 指着那个桶」，接口全程 200。
    // publicBase 回落到源站域名同样是静默的：图照样显示，只是没走 CDN，逐张看 URL 才发现。
    expect(t).toEqual({
      SecretId: 'AKID-old',
      SecretKey: 'sk-old',
      Bucket: 'ai-1303208826',
      Region: 'ap-guangzhou',
      publicBase: 'https://ai-cdn01.xiaozancloud.com',
    });
    // 别的模块不传 profile，照旧走默认桶（也就不走这个 CDN）。
    expect(resolveCosTarget()?.publicBase).not.toContain('ai-cdn01');
  });

  it('填了 CDN 域名就用填的那个（去掉尾斜杠）', () => {
    setConfig({
      cos_ppt_bucket: 'ai-1303208826',
      cos_ppt_region: 'ap-guangzhou',
      cos_ppt_base: 'https://ai-1303208826.cos.ap-guangzhou.myqcloud.com',
      cos_ppt_cdn_base: 'https://cdn.example.com/',
    });
    expect(resolveCosTarget('ppt')?.publicBase).toBe('https://cdn.example.com');
  });

  it('三项只填两项时抛错，不静默回落到默认桶', () => {
    setConfig({ cos_ppt_bucket: 'ai-1303208826', cos_ppt_region: 'ap-guangzhou' });
    expect(() => resolveCosTarget('ppt')).toThrow(/配置不全.*cos_ppt_base/);
  });

  it('源站域名和桶对不上时抛错（否则图写进桶里而页面是裂图）', () => {
    setConfig({
      cos_ppt_bucket: 'ai-1303208826',
      cos_ppt_region: 'ap-guangzhou',
      cos_ppt_base: 'https://other-1303208826.cos.ap-shanghai.myqcloud.com',
    });
    expect(() => resolveCosTarget('ppt')).toThrow(/对不上/);
  });
});
