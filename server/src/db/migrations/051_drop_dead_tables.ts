import type { Migration } from '../migrator.js';

// 删掉从来没被用过的表。
//
// 这批表全部满足三个条件：库里 0 行、代码里除了 db/index.ts 的 CREATE TABLE
// 之外没有任何 SQL 引用它、且已有替代实现。留着的成本不是磁盘，是认知负担：
// 任何人（包括 AI）读 schema 时都会以为 content_projects 这一套是在用的，
// 于是在错误的地基上加功能，或者不敢动它。
//
//   content_* + scoring_rules —— 早期"内容项目管理 + 发布效果预测/复盘"的设计，
//     后来 xhs 模块用完全不同的表（xhs_notes/xhs_drafts/xhs_weights）重做了，
//     这套只留下了建表语句。
//   skills —— 已被 prompt_skills + prompt_skill_files + prompt_skill_bindings
//     那套「后台可管理的多文件 skill」取代。
//   files —— 工作区文件索引的雏形，实际实现直接读文件系统，从未写过这张表。
//   knowledge_fts —— fts5 全文索引，配套的写入逻辑始终没做，索引里一条都没有。
//     必须一并删掉它自动创建的 4 张影子表，只 DROP 主表在某些 SQLite 版本上
//     会留下孤儿的 _data/_idx，下次 CREATE VIRTUAL TABLE 直接报错。
//
// 建表语句同时从 db/index.ts 删掉了 —— 否则下次启动会照原样重建，
// 这条迁移就成了一次性的无用功。
export const migration_051: Migration = {
  id: '051_drop_dead_tables',
  up(db) {
    const DEAD_TABLES = [
      // 依赖顺序：先删有外键指向 content_projects / content_messages 的
      'content_feedback',
      'content_messages',
      'content_retros',
      'content_actuals',
      'content_predictions',
      'content_drafts',
      'content_projects',
      'content_inspirations',
      'scoring_rules',
      'skills',
      'files',
    ];

    // 保险：只删空表。万一某个部署里真有人往里写过数据，
    // 宁可留一张没人用的表，也不能把数据静默删掉。
    for (const t of DEAD_TABLES) {
      const exists = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get(t);
      if (!exists) continue;
      const { n } = db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get() as { n: number };
      if (n > 0) {
        console.warn(`[migration] 跳过 ${t}：表中有 ${n} 行数据，不删除`);
        continue;
      }
      db.exec(`DROP TABLE "${t}"`);
    }

    // fts5 虚拟表：DROP 主表会连带清掉影子表，但只有在主表元数据完好时才行。
    // 先试标准路径，失败了再手动清残留。
    const ftsExists = db
      .prepare("SELECT name FROM sqlite_master WHERE name = 'knowledge_fts'")
      .get();
    if (ftsExists) {
      try {
        db.exec('DROP TABLE knowledge_fts');
      } catch (e) {
        console.warn('[migration] knowledge_fts 常规删除失败，改为清理影子表:', (e as Error).message);
      }
      for (const shadow of ['knowledge_fts_data', 'knowledge_fts_idx', 'knowledge_fts_docsize', 'knowledge_fts_config']) {
        try {
          db.exec(`DROP TABLE IF EXISTS "${shadow}"`);
        } catch { /* 主表删成功时影子表已经不在了 */ }
      }
    }
  },
};
