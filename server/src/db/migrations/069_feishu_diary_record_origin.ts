import type { Migration } from '../migrator.js';

// 日志记录多两列：这一条是**谁写的字**，以及它总结的是哪一段时间。
//
// ── 为什么必须有 origin ──
// 066 给这张表定了一条很硬的规矩：**记录原文不改写**（content 是用户当时说的话，
// 不润色、不摘要），日志的价值全在「当时到底怎么说的」。
// 群聊总结（「总结一下今天的群聊」）产出的东西**违反这条规矩** ——
// 它是 LLM 写的散文，不是任何人说过的原话。
//
// 混在同一列里而不加标记的后果不是"数据不整齐"，而是这张表**整体失去可信度**：
// 半年后回头看，「客户要求 logo 改大」这一条到底是谁说的、是不是模型从
// 「logo 是不是有点小」里推出来的，没人分得清 —— 而这张表存在的唯一理由
// 就是"当时到底怎么说的"。所以 LLM 写的那些必须能一眼分出来，也必须能被筛掉。
//
// 只有两个值，不做成可扩展的枚举：
//   'manual'      —— 人说的，原话（066 以来所有的行都是这个，所以默认值是它）
//   'chat_digest' —— LLM 从群聊记录里总结出来的
// 多维表格那侧不新增列（老项目的表里没有这一列，写未知字段名会让整批同步失败，
// 连正常记录一起卡住），改为在正文前面加一行「【群聊摘要 08-10】」——
// 表格是给人看的镜像，一个人一眼能看见的标记比一个他要横向滚动才看到的列更有用。
//
// ── 为什么还要 digest_range ──
// 同一天的群聊可以被总结**多次**（上午总结过，下午又聊了两小时）。
// 不拦第二次（那会让"下午的事"永远进不来），但要能数出「这是今天的第几版」
// 并在回帖里说出来 —— 否则日志里出现三条内容七成重合的摘要，
// 而看的人会以为群里真的把同一件事讨论了三轮。
// 值就是 range 的机器名 + 具体日期（如 `today:2026-08-10`），空串 = 不是摘要。
export const migration_069: Migration = {
  id: '069_feishu_diary_record_origin',
  up(db) {
    const cols = db.prepare('PRAGMA table_info(feishu_diary_records)').all() as Array<{
      name: string;
    }>;
    if (!cols.some((c) => c.name === 'origin')) {
      db.exec(
        `ALTER TABLE feishu_diary_records ADD COLUMN origin TEXT NOT NULL DEFAULT 'manual'`
      );
    }
    if (!cols.some((c) => c.name === 'digest_range')) {
      db.exec(
        `ALTER TABLE feishu_diary_records ADD COLUMN digest_range TEXT NOT NULL DEFAULT ''`
      );
    }
    // 「这一段时间总结过几次」走这条。带 origin 是因为 digest_range 只在摘要行上
    // 非空，而正常记录占了绝大多数 —— 部分索引比全表索引小得多。
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_feishu_diary_records_digest
        ON feishu_diary_records (project_id, digest_range)
        WHERE digest_range != '';
    `);
  },
};
