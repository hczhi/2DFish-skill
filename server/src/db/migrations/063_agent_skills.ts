import type { Migration } from '../migrator.js';

/**
 * 飞书 Skill（aily 智能体技能）管理。
 *
 * 和已有的 prompt_skills 是两回事，所以另开一套表，不复用：
 * prompt_skills 存的是一段会被我们自己拼进 prompt 的文本（见 docs/SKILL_SYSTEM.md），
 * 而这里存的是一个**要交给飞书 aily 运行时执行的目录树** —— 有 SKILL.md 的
 * frontmatter、有可执行的 .py、有版本、有「发布到哪个企业」的状态。
 * 硬塞进同一张表的结果是两种语义互相打架，编辑器也没法共用。
 *
 * 为什么没有「一键发布」：飞书**没有**写入类的技能 API。
 * aily v1 的技能接口只有 list / get / start（探过 app-skill/create|patch|publish、
 * app/create|publish、agent-agent_skill/*、agent-skill/create 等一圈，全部 41404）。
 * 所以「发布」在这里的定义是：冻结一个版本 → 校验 → 注入该企业的变量 →
 * 导出目录树 → **人工**在智能体后台上传 → 回来把这次部署标成已上线。
 * 这个流程必须在 UI 上写明，否则用户点了「发布」会以为技能已经生效了。
 */
export const migration_063: Migration = {
  id: '063_agent_skills',
  up(db) {
    // 一个「账号」= 一个飞书企业里的一个智能体。
    //
    // 之所以所有唯一约束都带 bot_id：多个企业是**不同租户**，
    // oc_/ou_ 这些 id 跨企业不可比，同名技能在两个企业里也是两份独立的东西。
    // 少了这一维，A 企业的部署记录会盖掉 B 企业的，看起来就像「B 也已上线」。
    db.exec(`
      CREATE TABLE IF NOT EXISTS agent_bots (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        -- aily 智能体 id（agent_xxx）。允许为空：技能可以先写好再绑定智能体。
        agent_id TEXT NOT NULL DEFAULT '',
        -- 备注：这个企业是谁、给谁用的
        note TEXT NOT NULL DEFAULT '',
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    // 技能本体。name 就是 aily 里的目录名，必须和 SKILL.md 的 name:
    // 以及正文里 cd ~/.aily/workspace/skills/<name> 三处一致（导出时会校验）。
    //
    // 技能不挂在 bot 上：同一个技能会发布到多个企业，
    // 挂上去就变成「每个企业各存一份、改一处要改 N 处」。
    // 「哪个企业上线了哪个版本」交给 agent_skill_deployments。
    db.exec(`
      CREATE TABLE IF NOT EXISTS agent_skills (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        label TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        -- 从哪来：manual（后台手写）/ import（导入目录）/ seed（迁移内置）
        source TEXT NOT NULL DEFAULT 'manual',
        source_path TEXT NOT NULL DEFAULT '',
        -- 血缘：从哪个技能复制来的，用于以后做 A→B 的差异合并
        origin_skill_id TEXT,
        origin_version INTEGER,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    // 文件树。path 是相对技能根目录的路径，自由形式
    // （scripts/x.py、references/y.md、group_suite.py 都合法）——
    // director-diary 那种技能里还有嵌套子技能目录，写死两三层会导不进来。
    db.exec(`
      CREATE TABLE IF NOT EXISTS agent_skill_files (
        id TEXT PRIMARY KEY,
        skill_id TEXT NOT NULL,
        path TEXT NOT NULL,
        body TEXT NOT NULL,
        -- 1 = 这个文件在导出时要带可执行位（.py 脚本）
        executable INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (skill_id, path),
        FOREIGN KEY (skill_id) REFERENCES agent_skills(id) ON DELETE CASCADE
      );
    `);

    // 版本 = 整棵树的**全量快照**，不是增量。
    // 增量的话，回滚要顺着链子重放，中间少一环就静默算出一棵错的树，
    // 而导出的 zip 看不出哪里不对 —— 上传上去才发现技能行为变了。
    db.exec(`
      CREATE TABLE IF NOT EXISTS agent_skill_versions (
        id TEXT PRIMARY KEY,
        skill_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        -- 全量快照：{ files: [{path, body, executable}], meta: {...} }
        manifest_json TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        created_by TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        UNIQUE (skill_id, version),
        FOREIGN KEY (skill_id) REFERENCES agent_skills(id) ON DELETE CASCADE
      );
    `);

    // 部署记录：某个版本在某个企业里的状态。
    //
    // status 的取值刻意区分 exported 和 live：
    //   exported = 我们导出了 zip，但没人能确认用户真的上传了
    //   live     = 用户回来点了「已上线」
    // 合成一个状态就等于替用户宣布上线，而实际那个 zip 可能还在下载文件夹里。
    // stale = 技能之后又改过，这个企业跑的还是老版本。
    db.exec(`
      CREATE TABLE IF NOT EXISTS agent_skill_deployments (
        id TEXT PRIMARY KEY,
        skill_id TEXT NOT NULL,
        bot_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'exported',
        note TEXT NOT NULL DEFAULT '',
        exported_at TEXT,
        confirmed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (skill_id, bot_id, version),
        FOREIGN KEY (skill_id) REFERENCES agent_skills(id) ON DELETE CASCADE,
        FOREIGN KEY (bot_id) REFERENCES agent_bots(id) ON DELETE CASCADE
      );
    `);

    // 导出时要注入的变量（每个企业一套）。
    //
    // 存在的理由是安全而不是方便：技能里写的是 {{XXX}} 占位符，
    // 真值只在导出那一刻替进去。直接把密钥写进文件 body 的话，
    // 把技能复制给 B 企业就等于把 A 企业的密钥一起给了过去。
    // 所以 value 按 secret 标记加密存储，且导出前会扫描明文密钥残留。
    db.exec(`
      CREATE TABLE IF NOT EXISTS agent_bot_variables (
        id TEXT PRIMARY KEY,
        bot_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL DEFAULT '',
        is_secret INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (bot_id, key),
        FOREIGN KEY (bot_id) REFERENCES agent_bots(id) ON DELETE CASCADE
      );
    `);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_agent_skill_files_skill ON agent_skill_files(skill_id);
      CREATE INDEX IF NOT EXISTS idx_agent_skill_versions_skill ON agent_skill_versions(skill_id, version DESC);
      CREATE INDEX IF NOT EXISTS idx_agent_skill_deployments_bot ON agent_skill_deployments(bot_id, status);
    `);
  },
};
