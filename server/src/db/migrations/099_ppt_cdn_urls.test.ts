import { describe, it, expect } from 'vitest';
import { initDatabase, getDatabase } from '../index.js';
import { migration_099 } from './099_ppt_cdn_urls.js';

initDatabase();

// 这条迁移改错了每一种都无声：什么都没替（旧稿子照旧回源，图正常显示，看不出来）、
// 或者顺手把 ai_logs / cos_ppt_base 也替了（那两处是「当时真的返回了什么」和源站记录，
// 改了之后再也查不出某张图是切换前生成的）。
describe('099 PPT 图片 URL 换 CDN', () => {
  it('只改 ppt_assets/ppt_deck_pages，ai_logs 和 cos_ppt_base 保持源站', () => {
    const db = getDatabase();
    const now = new Date().toISOString();
    const origin = 'https://ai-1303208826.cos.ap-guangzhou.myqcloud.com';
    const key = 'ai-images/2026/09/10/mig099.png';
    const set = db.prepare('INSERT OR REPLACE INTO system_config (key, value, updated_at) VALUES (?, ?, ?)');
    for (const [k, v] of [
      ['cos_ppt_bucket', 'ai-1303208826'],
      ['cos_ppt_region', 'ap-guangzhou'],
      ['cos_ppt_base', origin],
      ['cos_ppt_cdn_base', 'https://ai-cdn01.xiaozancloud.com'],
    ]) set.run(k, v, now);

    db.prepare('INSERT INTO ppt_assets (id, user_id, url, created_at) VALUES (?, ?, ?, ?)').run('mig099-a', 'u1', `${origin}/${key}`, now);
    db.prepare('INSERT INTO ppt_decks (id, user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('mig099-deck', 'u1', 'mig099', now, now);
    db.prepare('INSERT INTO ppt_deck_pages (id, deck_id, page, html, images_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('mig099-p', 'mig099-deck', 1, `<img src="${origin}/${key}">`, `[{"url":"${origin}/${key}"}]`, now, now);
    db.prepare('INSERT INTO ai_logs (user_id, source, operation, model, response_body, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run('u1', 'ppt', 'gen-image', 'seedream', `{"url":"${origin}/${key}"}`, now);

    migration_099.up(db);

    const cdnUrl = `https://ai-cdn01.xiaozancloud.com/${key}`;
    expect(db.prepare('SELECT url FROM ppt_assets WHERE id = ?').get('mig099-a')).toEqual({ url: cdnUrl });
    const page = db.prepare('SELECT html, images_json FROM ppt_deck_pages WHERE id = ?').get('mig099-p') as { html: string; images_json: string };
    expect(page.html).toBe(`<img src="${cdnUrl}">`);
    expect(page.images_json).toContain(cdnUrl);
    expect(db.prepare('SELECT response_body AS b FROM ai_logs WHERE operation = ? ORDER BY id DESC').get('gen-image')).toEqual({ b: `{"url":"${origin}/${key}"}` });
    expect(db.prepare("SELECT value AS v FROM system_config WHERE key = 'cos_ppt_base'").get()).toEqual({ v: origin });
  });
});
