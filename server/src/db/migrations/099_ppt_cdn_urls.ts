import type { Migration } from '../migrator.js';

/**
 * 把历史 PPT 图片的源站 URL 改写成 CDN 域名（`cos_ppt_cdn_base`）。
 *
 * 新图从 `resolveCosTarget('ppt')` 起就走 CDN 了，而库里存的是**完整 URL**：不改写的话旧稿子
 * 永远回源。那个状态本身不报错、图也照样显示，所以唯一的现象是「老域名哪天停了，翻旧稿全是裂图」
 * —— 而停老域名的人以为已经全站切到 CDN 了。
 *
 * 只改写四处存展示 URL 的地方（`ppt_assets.url`、`ppt_deck_pages` 的
 * `html`/`images_json`/`pending_images_json`）。**`ai_logs` 不动**：那是「当时真的返回了什么」的
 * 账，改了它之后就再也查不出某张图是切换前还是切换后生成的。`system_config.cos_ppt_base` 也不动
 * —— 它现在的作用就是记源站、核对桶名/地域（见 `api/upload.ts` 的 `checkPptDomain`）。
 *
 * 同一个 object key 在两个域名下都取得到（CDN 绑的就是这个桶），所以这是纯域名替换，不动 key。
 * 桶没配就跳过；CDN 域名和源站相同也跳过（否则是一遍无意义的全表重写）。默认域名这里写死一个字面量
 * 而不是 import `PPT_CDN_BASE_DEFAULT`：迁移只跑一次，跟的是**当时**那个默认值，跟着常量漂移
 * 反而会让这条历史记录说谎（而且 `api/upload.ts` 会把 multer/COS 拖进迁移的加载路径）。
 */
export const migration_099: Migration = {
  id: '099_ppt_cdn_urls',
  up(db) {
    const rows = db
      .prepare("SELECT key, value FROM system_config WHERE key IN ('cos_ppt_bucket','cos_ppt_region','cos_ppt_base','cos_ppt_cdn_base')")
      .all() as Array<{ key: string; value: string }>;
    const cfg: Record<string, string> = {};
    for (const r of rows) cfg[r.key] = (r.value || '').trim();

    if (!cfg.cos_ppt_bucket || !cfg.cos_ppt_region) return;

    const strip = (s: string) => s.replace(/\/+$/, '');
    const cdn = strip(cfg.cos_ppt_cdn_base || 'https://ai-cdn01.xiaozancloud.com');
    // 源站两种写法都替：桶的默认 cos 域名，以及后台那一格里填的（多数情况是同一个）。
    const origins = [`https://${cfg.cos_ppt_bucket}.cos.${cfg.cos_ppt_region}.myqcloud.com`, cfg.cos_ppt_base ? strip(cfg.cos_ppt_base) : '']
      .filter((o) => o && o !== cdn)
      .filter((o, i, all) => all.indexOf(o) === i);
    if (!origins.length) return;

    const targets: Array<[string, string]> = [
      ['ppt_assets', 'url'],
      ['ppt_deck_pages', 'html'],
      ['ppt_deck_pages', 'images_json'],
      ['ppt_deck_pages', 'pending_images_json'],
    ];

    let changed = 0;
    for (const origin of origins) {
      // `ppt_assets` 上有 UNIQUE(user_id, url)：同一个 key 的源站行和 CDN 行同时存在时，
      // 直接 UPDATE 会撞唯一约束抛错，而迁移抛错 = **服务起不来**。先删掉源站那条（CDN 那条
      // 留着，两条指的是同一张图）。写成 UPDATE OR IGNORE 的话那几行会静默留在老域名上。
      db.prepare(
        `DELETE FROM ppt_assets WHERE url LIKE ?
           AND EXISTS (SELECT 1 FROM ppt_assets b WHERE b.user_id = ppt_assets.user_id AND b.url = replace(ppt_assets.url, ?, ?))`
      ).run(`%${origin}%`, origin, cdn);

      for (const [table, col] of targets) {
        const exists = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(table);
        if (!exists) continue;
        const info = db.prepare(`UPDATE ${table} SET ${col} = replace(${col}, ?, ?) WHERE ${col} LIKE ?`).run(origin, cdn, `%${origin}%`);
        changed += info.changes;
      }
    }
    if (changed) console.log(`[migrate] 099: rewrote PPT image URLs to ${cdn} in ${changed} row(s)`);
  },
};
