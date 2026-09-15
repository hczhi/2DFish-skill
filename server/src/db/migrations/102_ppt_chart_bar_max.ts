import type { Migration } from '../migrator.js';
import { normalizeChartData } from '../../services/ppt/chartData.js';

/**
 * 把已经生成过的那几页条形图的条长按印出来的数字重算一遍（`--bar-max` / `--bar-v`）。
 *
 * **光改生成那一步不够**：案例原来教模型把上限写成「最大的那个值」，于是最长的那一条永远
 * 顶满轨道 —— 数据是百分比时，40% 那一行画出来就是满格，看起来是 100%，而右边印着的还是
 * 「40%」。这些页是花过真钱的，不补的话唯一的出路是每一页重新生成一次，而那一页在界面上
 * 读起来完全正常（一张干净完整的图表），他只会以为条长本来就这样。
 *
 * `normalizeChartData` 是纯函数（只改 style 里那两个数，不动文字、不动结构、不联网），
 * 算出来的上限对同一份 html 是同一个值，所以这条迁移跑几遍结果一样。
 */
export const migration_102: Migration = {
  id: '102_ppt_chart_bar_max',
  up(db) {
    const rows = db
      // 横条（L47）和竖柱（L52）都过一遍：只捞 l47 的话，这条迁移之前生成的竖柱页
      // 永远停在模型自己写的那个上限上，而它和被修好的横条页一样读起来完全正常。
      .prepare(
        `SELECT id, html FROM ppt_deck_pages WHERE html LIKE '%l47-rows%' OR html LIKE '%l52-cols%'`
      )
      .all() as Array<{ id: string; html: string }>;
    const upd = db.prepare(`UPDATE ppt_deck_pages SET html = ? WHERE id = ?`);
    for (const r of rows) {
      const next = normalizeChartData(r.html).html;
      if (next !== r.html) upd.run(next, r.id);
    }
  },
};
