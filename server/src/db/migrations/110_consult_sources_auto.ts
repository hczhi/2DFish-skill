import type { Migration } from '../migrator.js';

/**
 * `consult_sources.auto`：这条联网资料是**机器自己搜来的**，还是用户逐条勾选采纳的。
 *
 * 四看一键分析会先自动联网（`autoSourceService`），搜到的直接落这张表 —— 不加这一列的话
 * 它和用户亲手核过的那几条在库里、在 prompt 里、在报告的出处标注里完全一样，
 * 于是一条 SEO 垃圾页和他核过的年报在方法论 §8 的分级里同为「L1 最高一级证据」，
 * 而正文读起来只会更自信（「据公开数据…」）。事后也分不出来：那一版到底是照着谁写的，
 * 库里没有任何痕迹。
 *
 * 三条边界：
 * ① 缺省 0（老数据全是手动采纳的）—— 反过来的话升级之后全站的既有资料一夜之间变成
 *    「未人工核对」，而他明明逐条勾过；
 * ② 自动那些进 prompt 时**单独一段**并要求引用时标「未人工核对」（`sourcesBlock`）：
 *    混在同一段里的话模型分不出来，写出来的正文和真查证过的一模一样；
 * ③ 证据级别跟着分岔（`sourceLevelFor` 的 `L1?`）—— 一律算 L1 的话，界面上这一步挂着
 *    「L1 联网检索」，而没有任何一个人看过那几条。
 */
export const migration_110: Migration = {
  id: '110_consult_sources_auto',
  up(db) {
    const cols = db.prepare('PRAGMA table_info(consult_sources)').all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === 'auto')) {
      db.exec('ALTER TABLE consult_sources ADD COLUMN auto INTEGER NOT NULL DEFAULT 0');
    }
  },
};
