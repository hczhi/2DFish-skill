import type { Migration } from '../migrator.js';

/**
 * 每条定稿上的「AI 赋能机会」（JSON 数组，1-2 条）。
 *
 * 单独一列而不是让它留在 body 的某一节里：方法论规定各模块**只标 1-2 个**，
 * 最后由合成阶段汇成报告独立的一章「AI 转型机会清单」。埋在 markdown 正文里的话，
 * 那一章只能靠把十二份正文整段塞回 prompt 去重新找 —— 而 knowledgeBlock 刻意不这么干
 * （上下文被表格占满之后模型开始照常识写）。结果是那一章漏掉大半个模块，
 * 而它读起来是一份完整的清单，没有任何一处报错。
 *
 * 老行是 '[]'：界面上要显示成「这条定稿没标 AI 机会（重跑一次会有）」，
 * 不能显示成一个空区块 —— 空区块和「这一步确实没有 AI 机会」长得一样。
 */
export const migration_081: Migration = {
  id: '081_consult_ai_opportunities',
  up(db) {
    const cols = db.prepare('PRAGMA table_info(consult_entries)').all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === 'ai_opportunities')) {
      db.exec(`ALTER TABLE consult_entries ADD COLUMN ai_opportunities TEXT NOT NULL DEFAULT '[]'`);
    }
  },
};
