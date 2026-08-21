import type { Migration } from '../migrator.js';

/**
 * 定稿的正文（markdown）。`conclusion` 从此只是「一句话总结」，方案里真正要用的
 * 企业现状卡 / 痛点优先级矩阵 / 数据置信度表这些表格全在 `body` 里。
 *
 * 分两列而不是把表格塞进 conclusion：conclusion 会跟着每一条定稿进下游每一次调用的
 * prompt，十二个阶段的正文全带上的话前面几步就把上下文占满了 —— 表现不是报错，
 * 是模型开始忽略客户资料（在最后面），照着自己的常识写后面的章节。
 * 所以下游只带直接依赖的 body，其余只带 conclusion（见 draftService.knowledgeBlock）。
 *
 * 老行的 body 是空串：界面上「正文为空」要显示成「这条是旧版定稿，重跑一次才有正文」，
 * 而不是渲染出一片空白 —— 空白和「模型这次没写表格」长得一样。
 */
export const migration_078: Migration = {
  id: '078_consult_entry_body',
  up(db) {
    const cols = db.prepare('PRAGMA table_info(consult_entries)').all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === 'body')) {
      db.exec(`ALTER TABLE consult_entries ADD COLUMN body TEXT NOT NULL DEFAULT ''`);
    }
  },
};
