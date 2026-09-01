import { getDatabase } from '../../db/index.js';

// 十四步的「分析操法」（method）和「本步必须产出的东西」（deliverables）的后台覆盖层（088）。
//
// 只这两样能改，因为它们是**纯文字**：一条进 prompt、同时原样显示给用户（`GET /stages`），
// 改了立刻是「下一次生成按新口径推」。key / lane / requires / contextBodies 不开放 ——
// 那几样是行为，改了不报错，只是解锁条件变了、prompt 里少带一份正文。
//
// 这一层唯一的静默失败是**「界面上显示改过了，发给模型的还是缺省那份」**：那种情况下
// 正文照样每节都在、表格也满，顾问对着后台那份新操法数不出任何缺失。所以合并只在
// `stages.ts` 的 `stages()` / `stageByKey()` 里做一次，所有读操法/清单的地方都必须
// 走它们 —— `STAGE_DEFAULTS` 改名就是为了让漏改的调用点编译不过。

export type StageField = 'method' | 'deliverables';

export interface StageOverrideRow {
  stage_key: string;
  field: StageField;
  body: string;
  updated_at: string;
  updated_by: string | null;
}

/**
 * 一行一条。**空行和首尾空白全部丢掉**，一条都不剩时返回空数组（调用方按「删掉覆盖」处理）。
 *
 * 不接受空内容存进库：空的 method 在 prompt 里就是「这一步没有规定的操法」，模型于是
 * 自己想一套顺序把表格填满 —— 而那种正文和照方法论推出来的在屏幕上一模一样。
 */
export function parseLines(body: string): string[] {
  return body
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/** 库里现有的覆盖。库还没起来/表还没建（迁移没注册）时返回空 —— 全站按缺省跑。 */
export function loadStageOverrides(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  try {
    const rows = getDatabase()
      .prepare('SELECT stage_key, field, body FROM consult_stage_prompts')
      .all() as Array<{ stage_key: string; field: StageField; body: string }>;
    for (const r of rows) {
      const lines = parseLines(r.body);
      if (lines.length) out.set(`${r.stage_key}.${r.field}`, lines);
    }
  } catch {
    /* 库没起来时按缺省跑（同 consultFrameAncestors）—— 缺省是代码里那份，不会是空的 */
  }
  return out;
}

/** 后台列表用：哪几步被改过、什么时候、谁改的。 */
export function listStageOverrides(): StageOverrideRow[] {
  return getDatabase()
    .prepare(
      'SELECT stage_key, field, body, updated_at, updated_by FROM consult_stage_prompts ORDER BY stage_key, field'
    )
    .all() as StageOverrideRow[];
}

/**
 * 写一条覆盖。**内容空 = 删掉这条，回落代码里的缺省**（不存空串：空串在界面上和
 * 「没改过」看起来一样，而它会把这一步的操法整段抹掉）。
 *
 * 返回这次是「改成了自定义」还是「回落到缺省」—— 后台那句话要说清是哪一种，
 * 不说的话点了保存之后两种结果长得一模一样。
 *
 * 「恢复缺省」走的就是这条空内容的路（**删掉那一行**），后台没有第二个端点。不做成
 * 「把当前缺省内容写回库里」：写回一份拷贝的话，以后代码里的缺省改了（方法论本来就会
 * 继续改），这几步永远停在拷贝那一版，而后台显示的是「未修改」—— 没有一处会报错。
 */
export function setStageOverride(
  stageKey: string,
  field: StageField,
  body: string,
  updatedBy: string
): { mode: 'custom' | 'default'; lines: string[] } {
  const db = getDatabase();
  const lines = parseLines(body);
  if (!lines.length) {
    db.prepare('DELETE FROM consult_stage_prompts WHERE stage_key = ? AND field = ?').run(stageKey, field);
    return { mode: 'default', lines: [] };
  }
  db.prepare(
    `INSERT INTO consult_stage_prompts (stage_key, field, body, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(stage_key, field) DO UPDATE SET body = excluded.body,
       updated_at = excluded.updated_at, updated_by = excluded.updated_by`
  ).run(stageKey, field, lines.join('\n'), new Date().toISOString(), updatedBy);
  return { mode: 'custom', lines };
}
