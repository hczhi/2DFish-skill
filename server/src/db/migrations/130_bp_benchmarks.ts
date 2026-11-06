import type { Migration } from '../migrator.js';

/**
 * `bp_benchmarks`：融资方案章用的「平台参考口径」的**后台覆盖层**（行业 × 当前轮次）。
 * 缺省值在代码里（bp/benchmarks.ts:DEFAULT_BENCHMARKS），这张表只存管理员改过的那几格 ——
 * 存全量的话以后调整缺省值，没改过的格子也不会跟着变，而后台显示的「默认」已经不是代码里的默认了。
 * data_json 由服务端校验后才落库（benchmarks.validateBenchmark）：写错一个字段名的后果不是报错，
 * 是那一行门槛在报告里静默消失。
 */
export const migration_130: Migration = {
  id: '130_bp_benchmarks',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS bp_benchmarks (
        sector TEXT NOT NULL,
        stage TEXT NOT NULL,
        data_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        updated_by TEXT,
        PRIMARY KEY (sector, stage)
      );
    `);
  },
};
