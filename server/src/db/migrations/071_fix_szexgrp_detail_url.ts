import type { Migration } from '../migrator.js';
import { __testables as szexgrp } from '../../services/tender/szexgrpCrawlerService.js';

// 修历史数据：szexgrp（深圳阳光采购）的详情链接只存了 `?contentId=`，
// 少了 `bidSectionNumber` —— 那个页面的 JS 缺它就在 loading 之后直接 return，
// 用户点开是一个永远转圈的空页（不报错、不 404），后台却显示「✅ 已处理」。
// 拼法见 szexgrpCrawlerService.detailPageUrl。
//
// 参数都在 raw_data.listItem 里（整行原样存的），所以能原地重算，不用重爬。
// tenders 是 append-only 表，不洗的话这批行的链接永远是坏的；而多维表格
// 「清空重灌」是从 tenders 读的，洗完下次手动推送就自动带上正确链接。
export const migration_071: Migration = {
  id: '071_fix_szexgrp_detail_url',
  up(db) {
    const rows = db
      .prepare("SELECT id, notice_id, url, raw_data FROM tenders WHERE platform = 'szexgrp'")
      .all() as Array<{ id: string; notice_id: string; url: string | null; raw_data: string | null }>;

    const update = db.prepare('UPDATE tenders SET url = ? WHERE id = ?');
    for (const r of rows) {
      let listItem: any = null;
      try {
        listItem = JSON.parse(r.raw_data || '{}')?.listItem || null;
      } catch {
        // raw_data 坏了就跳过：notice_id 单独只能拼出 details.htm，那是降级页，
        // 不该拿它盖掉可能已经正确的 jyxxDetails 链接。
      }
      if (!listItem?.contentId) continue;
      const fixed = szexgrp.detailPageUrl(listItem);
      if (fixed && fixed !== r.url) update.run(fixed, r.id);
    }
  },
};
