import { describe, it, expect } from 'vitest';
import { initDatabase, getDatabase } from '../index.js';
import { migration_103 } from './103_ppt_disable_toc_layouts.js';
import { disabledLayoutIds } from '../../services/ppt/layoutState.js';

initDatabase();

// 这条迁移写错了两种都无声：① 键名/JSON 形状不对 = 三条议程版式照旧被挑中，下一份稿子里
// 多一页目录，而那一页每一格都正常；② 直接覆盖那份清单 = 管理员之前手动停掉的版式全部
// 悄悄复活，而案例库页面上那几个开关还是关着的（界面和实际彻底反了）。
describe('103 议程版式默认停用', () => {
  it('并进已有的停用清单，`disabledLayoutIds` 读得到那三条', () => {
    const db = getDatabase();
    db.prepare(
      "INSERT OR REPLACE INTO system_config (key, value, updated_at) VALUES ('ppt_disabled_layouts', ?, datetime('now'))"
    ).run(JSON.stringify(['L7']));

    migration_103.up(db);

    const off = disabledLayoutIds();
    for (const id of ['L33', 'L48', 'L65']) expect(off.has(id)).toBe(true);
    // 管理员自己停的那条必须还在。
    expect(off.has('L7')).toBe(true);
  });
});
