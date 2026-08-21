import type { Migration } from '../migrator.js';

/**
 * 品牌咨询工作台（/consult）—— 一个品牌一个项目，全部状态落库。
 *
 * 为什么阶段状态一定要存库、不留在前端或 LLM 上下文里：这个功能的形态是
 * 「一步一步聊 → 每步定稿进知识库 → 下一步只读知识库」。定稿丢一条不会报错 ——
 * 下一阶段的 prompt 少喂一条结论，模型会一本正经地重新发明一个，回复看起来
 * 完全正常，一路到报告都不会有任何一处出声。
 *
 * `consult_stages` 只存「用户在这个阶段干到哪了」，**阶段清单本身写在
 * services/consult/stages.ts**。渲染阶段栏时以代码里的清单为准去左连这张表；
 * 反过来（按表里有哪些行渲染）的话，以后新增一个阶段对老项目是不可见的，
 * 报告照样出得来，只是永远缺那一节。
 *
 * `consult_entries` 就是企业知识库：**一个阶段一条定稿**，改动是 UPDATE + version+1。
 * `stale` 记「上游变了、这条该重跑」—— 四问是相互咬合的，定位改了而价值主张/信任/
 * 关系还是照老定位推出来的，咬合断了没有任何一处会报错，拼出来的报告只是口径
 * 互相矛盾、读起来毫无异常。所以这一位必须显性存下来、并且在界面上显示出来。
 *
 * 注意 db/index.ts 没开 PRAGMA foreign_keys，所以这里的 REFERENCES 不会级联删除，
 * 删项目必须自己把两张子表清掉（见 services/consult/projectStore.ts:deleteProject）。
 */
export const migration_076: Migration = {
  id: '076_consult_projects',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS consult_projects (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        brand_name TEXT NOT NULL,
        -- 用户贴进来的原始资料（纯文字，可反复补充）。四看阶段的事实源。
        brief TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_consult_projects_user
         ON consult_projects(user_id, updated_at DESC)`
    );

    db.exec(`
      CREATE TABLE IF NOT EXISTS consult_stages (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES consult_projects(id),
        -- 对应 services/consult/stages.ts 里的 key，不是自增序号：
        -- 存序号的话调整阶段顺序会把老项目的进度整体错位一格。
        stage_key TEXT NOT NULL,
        -- pending 还没开始 / exploring 在聊 / decided 已定稿
        status TEXT NOT NULL DEFAULT 'pending',
        -- 出过几轮候选方向（切片 2 用；旧轮次保留，不静默覆盖）
        round INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(project_id, stage_key)
      );
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS consult_entries (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES consult_projects(id),
        stage_key TEXT NOT NULL,
        -- 一句话结论（进下游 prompt 的主体）
        conclusion TEXT NOT NULL DEFAULT '',
        -- 为什么是这个结论（人写的取舍理由，报告里要引用）
        rationale TEXT NOT NULL DEFAULT '',
        -- 依据：客户资料原话 / 联网来源 / 推测
        evidence TEXT NOT NULL DEFAULT '',
        -- high | mid | low —— 对应方法论的 🟢🟡🔴，low 不能直接写进正式方案
        confidence TEXT NOT NULL DEFAULT 'mid',
        -- L1 联网 / L2 客户资料 / L3 模型内置知识
        source_level TEXT NOT NULL DEFAULT 'L2',
        -- 1 = 上游结论已变，这条该重跑
        stale INTEGER NOT NULL DEFAULT 0,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(project_id, stage_key)
      );
    `);
  },
};
