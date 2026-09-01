import type { Migration } from '../migrator.js';

// 咨询十四步的「分析操法」和「本步必须产出的东西」的后台覆盖层（只这两样）。
//
// **只存被改过的那几步**，`stages.ts` 里那份继续是缺省值 —— 整份阶段清单不落库的理由
// 写在那个文件顶上（阶段是产品形态，落库就变成「老项目一份、新项目一份」，两边的报告
// 章节不一样却都不报错）。这里覆盖的是这两样的**文字内容**，不碰 key / lane / requires /
// contextBodies：那四样是行为，改了不报错，只是解锁条件提前了、prompt 里少带一份依据。
//
// 一行一条（`body` 存原文，读的时候按换行切）。不存 JSON 数组：后台那是个 textarea，
// 少一个逗号就是保存失败或者更糟——存进去一个解析不出来的串，而那一步的操法从此为空，
// 模型不照操法推了而正文照样每节都在（这一步最贵的静默失败就是这个）。
//
// 删掉一行 = 回落缺省。**不留空串**：空串会把操法整段抹掉，而界面上和「缺省」看起来
// 一模一样。所以写入层遇到空内容一律 DELETE（见 stageOverrides.ts）。
export const migration_088: Migration = {
  id: '088_consult_stage_prompts',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS consult_stage_prompts (
        stage_key  TEXT NOT NULL,
        field      TEXT NOT NULL CHECK (field IN ('method', 'deliverables')),
        body       TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        updated_by TEXT,
        PRIMARY KEY (stage_key, field)
      )
    `);
  },
};
