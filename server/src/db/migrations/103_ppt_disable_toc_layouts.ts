import type { Migration } from '../migrator.js';

/**
 * 三条纯议程版式（L33 左行表右竖图 / L48 错位白卡 / L65 大编号两列）默认停用 ——
 * 稿子里不再排 agenda 页（他要的，同一批把页脚那个「目录 ▾」下拉也去掉了）。
 *
 * **光把 `归属` 从「目录」改成「章节」不够。** 改完这三条就成了章节扉页的候选，而它们的内容
 * 骨架就是「一列章节条目」—— 模型挑中之后出来的还是一页目录，只不过标签写着「章节」：
 * 每一格都渲染正常、编号合法、`kindWarnings` 一句话都不说。所以要在**停用清单**里也钉一下。
 *
 * 停用而不是把这三条从案例库里删掉：`layoutLibrary.test.ts` 断言编号正好是 L1…L65 连号，
 * 删中间三条得把后面全部重编号（每一份已经生成过的页里存的 `layoutId` 会指向另一条版式，
 * 而那一页照旧渲染正常）。停用是可逆的 —— 案例库页面上那个开关能开回来。
 *
 * 合并进已有的那份清单、不覆盖：直接写死三条的话，管理员之前手动停掉的版式会全部悄悄复活，
 * 而案例库页面上那几个开关看起来还是关着的。
 */
const OFF = ['L33', 'L48', 'L65'];
const KEY = 'ppt_disabled_layouts';

export const migration_103: Migration = {
  id: '103_ppt_disable_toc_layouts',
  up(db) {
    const row = db.prepare('SELECT value FROM system_config WHERE key = ?').get(KEY) as
      | { value: string }
      | undefined;
    let cur: string[] = [];
    if (row?.value?.trim()) {
      try {
        const arr = JSON.parse(row.value);
        if (Array.isArray(arr)) cur = arr.filter((x): x is string => typeof x === 'string');
      } catch {
        // 存的不是 JSON 数组（只有手改过库才会这样）：当成空清单往下走，
        // 这条迁移写回去的是一份合法的 —— 抛在这里的话服务起不来。
        cur = [];
      }
    }
    const next = Array.from(new Set([...cur, ...OFF]));
    db.prepare(
      `INSERT INTO system_config (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    ).run(KEY, JSON.stringify(next));
  },
};
