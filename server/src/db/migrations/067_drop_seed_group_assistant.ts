import type { Migration } from '../migrator.js';

/**
 * 删掉 064 播下的内置技能 `group-assistant`（aily 智能体版的群助理）。
 *
 * ── 为什么删 ──
 * 它和本仓库的**原生**项目群助理（migration 066 + services/feishuAssistant/diary/）
 * 是同一个产品的两套实现：那边脚本只打印「Agent 接下来该建表了」，真正调飞书接口
 * 的是 aily 那侧的智能体，状态在它自己的 config.json 里；这边接口我们自己调、
 * 数据在我们库里。066 的注释当时说「两套先并存，谁被 @ 到谁执行」——
 * 而并存的实际后果是**同一个群里两个东西都在记**：aily 版把记录写进它建的那张表，
 * 原生版写进 feishu_diary_records，两边的项目名一样、内容不一样，
 * 而没有任何一侧知道对方存在。复盘时读的是哪一份取决于用户 @ 的是谁。
 * 原生版确认够用了，所以这套不再保留。
 *
 * ── 只删这一行，不动别的技能 ──
 * 条件卡死 `id = 'seed-group-assistant'` **且** `source = 'seed'`：
 * 管理员自己新建/导入的技能哪怕重名也不能碰（那是他写了几天的东西）。
 *
 * ── 为什么要手动删子表 ──
 * 那几张表的外键写了 ON DELETE CASCADE，但本项目**没有开 `PRAGMA foreign_keys`**
 * （见 db/index.ts，只设了 journal_mode）。指望级联的话，删完剩下一堆挂在
 * 不存在的 skill_id 上的文件行和版本行 —— 不报错，只是永远查不到、也永远删不掉。
 *
 * 技能包的可读源（skills/agent/group-assistant/）和那份控制台档案
 * （docs/AILY_GROUP_ASSISTANT_PROFILE.md）在同一次改动里从仓库删掉了，
 * 所以这个迁移不会再被 064 重新播回来 —— 064 本身也一并删了。
 */
const SKILL_ID = 'seed-group-assistant';

export const migration_067: Migration = {
  id: '067_drop_seed_group_assistant',
  up(db) {
    const row = db
      .prepare(`SELECT id FROM agent_skills WHERE id = ? AND source = 'seed'`)
      .get(SKILL_ID) as { id: string } | undefined;
    if (!row) return;

    // 顺序：子表在前。反过来在开了外键的库上会被约束挡住。
    db.prepare('DELETE FROM agent_skill_deployments WHERE skill_id = ?').run(SKILL_ID);
    db.prepare('DELETE FROM agent_skill_versions WHERE skill_id = ?').run(SKILL_ID);
    db.prepare('DELETE FROM agent_skill_files WHERE skill_id = ?').run(SKILL_ID);
    db.prepare('DELETE FROM agent_skills WHERE id = ?').run(SKILL_ID);

    // 说出来。已经上传到某个企业 aily 后台的那份技能包**不会**因为这次删除而下线
    // （我们没有下线接口，见 063 的注释），要在 aily 后台里自己删。
    // 不打这行日志的话，管理员会以为这次升级顺手把那边也关了。
    console.log(
      '[migrate] 已删除内置技能 group-assistant（aily 版群助理）。' +
        '注意：已上传到 aily 后台的技能包仍在运行，需要到 aily 后台自行删除。'
    );
  },
};
