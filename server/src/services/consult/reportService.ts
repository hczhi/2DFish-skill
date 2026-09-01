import { stages } from './stages.js';
import { parseEntryAiOpportunities, type ConsultEntry, type ConsultProject } from './projectStore.js';

// 把十四步的定稿合并成一份可交付的 markdown。
//
// 这里唯一会骗人的地方是**「看起来是一份完整方案」**：一份少了两章、或者某几章是在
// 上游被改之前定的文档，读起来和完整的一模一样（每章都有结论、有表格、有置信度），
// 顾问会直接发给客户。所以这个模块只做两件事 —— 按阶段清单（`stages()`）的顺序拼，以及把
// 「缺了哪一步 / 哪几章过期 / 哪几章没有正文」全部写在纸面上。

/** 章节顺序**只能**来自 `stages()`（缺省 + 后台覆盖），不是定稿时间。 */
const CONF_LABEL: Record<string, string> = {
  high: '🟢 高',
  mid: '🟡 中',
  low: '🔴 低',
};

/** 还没定稿的阶段 label。导出前的闸门 —— 见 buildReport 头上的注释。 */
export function missingStages(entries: ConsultEntry[]): string[] {
  const has = new Set(entries.map((e) => e.stage_key));
  return stages()
    .filter((s) => !has.has(s.key))
    .map((s) => s.label);
}

function stamp(d = new Date()): string {
  // 服务器时区无关：整份文档只有这一处时间，写成 UTC 的话用户对不上自己点导出的那一刻
  return d.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
}

/** 文件名里的 `/ \ : * ? " < > |` 会让部分浏览器/系统静默存成别的名字。 */
function safeName(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '').slice(0, 40) || '品牌';
}

export interface ReportOut {
  filename: string;
  markdown: string;
  /** 过期的章节（上游改过之后没重跑），前端必须显示 —— 见下面的注释 */
  stale: string[];
  /** 定稿时没存正文的章节（078 之前的老定稿） */
  noBody: string[];
  chapters: number;
  chars: number;
}

/**
 * 合并成一份方案。**调用方必须先用 `missingStages` 挡住不完整的项目**：
 * 少了一章的文档在屏幕上和完整的没有区别，而它是要发给客户的东西。
 *
 * `stale` / `noBody` 不是内部诊断信息，是**要写进文档正文的**：
 * - stale = 这一章是在上游结论被改之前定的，它和后面几章可能互相矛盾，而两章各自都通顺；
 * - noBody = 那一步只存了一句话结论（078 之前），少了那几张表的章节读起来仍然完整。
 * 两种都在文档开头列出来，并在对应章节里各自挂一句 —— 只回给接口的话，用户下载完就
 * 再也看不到了，而这份 md 会被直接转出去。
 */
export function buildReport(project: ConsultProject, entries: ConsultEntry[]): ReportOut {
  // 只取一次：目录和正文必须是同一份清单（各取一次的话中间被后台改过就会目录说 14 章、
  // 正文 13 章，而两处各自都完整）。
  const all = stages();
  const byKey = new Map(entries.map((e) => [e.stage_key, e]));
  const stale: string[] = [];
  const noBody: string[] = [];
  const opps: Array<{ label: string; items: string[] }> = [];

  const chapters: string[] = [];
  let group = '';
  let no = 0;
  for (const s of all) {
    const e = byKey.get(s.key);
    if (!e) continue; // 正常路径下不会发生（接口先挡了），少一章也不静默补一段占位文字
    no += 1;
    if (s.group !== group) {
      group = s.group;
      chapters.push(`\n---\n\n# ${group}\n`);
    }
    if (e.stale) stale.push(s.label);
    const body = e.body.trim();
    if (!body) noBody.push(s.label);
    opps.push({ label: s.label, items: parseEntryAiOpportunities(e.ai_opportunities) });

    const meta = [
      `第 ${e.version} 版`,
      `置信度 ${CONF_LABEL[e.confidence] || e.confidence}`,
      `证据级别 ${e.source_level}`,
      `定稿 ${e.updated_at.slice(0, 10)}`,
    ].join(' · ');
    const head = [
      `## ${no}. ${s.label}`,
      '',
      `> ${s.question}`,
      `> ${meta}`,
    ];
    if (e.stale) {
      head.push(
        `>`,
        `> ⚠ **这一章已过期**：它是在上游结论被改之前定的，可能和后面几章矛盾 —— 两章各自都读得通，所以只能靠这一句认出来。回工作台重跑这一步再导出。`
      );
    }
    chapters.push(head.join('\n'));
    chapters.push('');
    chapters.push(`**一句话结论**：${e.conclusion}`);
    chapters.push('');
    chapters.push(
      body ||
        `（这一步定稿时没有保存正文，只有上面那句结论 —— 本步该有的那几张表不在这份文档里。回工作台重跑这一步就能补上。）`
    );
    chapters.push('');
  }

  // AI 转型机会清单：方法论要求各步只标 1-2 条、最后汇成独立一章。
  // 一条都没标的步骤要**点名写出来**，不能只列有的那几条 —— 少了大半个模块的清单
  // 读起来照样是一份完整清单（同 stages.ts 里 ai_opportunities 那一列的注释）。
  const oppLines = opps.map(
    (o) => `| ${o.label} | ${o.items.length ? o.items.join('；') : '（这一步没标 AI 机会）'} |`
  );

  const warn: string[] = [];
  if (stale.length) {
    warn.push(
      `> ⚠ **${stale.length} 章已过期**（${stale.join('、')}）：这几章是在上游结论被改之前定的，可能和后面的章节互相矛盾。`
    );
  }
  if (noBody.length) {
    warn.push(
      `> ⚠ **${noBody.length} 章只有结论、没有正文**（${noBody.join('、')}）：这几步该有的表格不在这份文档里。`
    );
  }

  const md = [
    `# ${project.brand_name} · 品牌占位方案`,
    '',
    `> 导出时间：${stamp()} · 共 ${no} 章`,
    `> 每一章的正文就是工作台里那一步定稿时保存的内容，本文档只做合并，不重新生成、不改写。`,
    `> 客户原始资料不在这份文档里（它是内部输入，不是交付物）。`,
    ...(warn.length ? ['>', ...warn] : []),
    '',
    '## 目录',
    '',
    ...all.map((s, i) => `${i + 1}. ${s.label} —— ${s.question}`),
    '',
    ...chapters,
    '\n---\n',
    '',
    '| 步骤 | 机会 |',
    '| --- | --- |',
    ...oppLines,
    '',
  ].join('\n');

  return {
    filename: `${safeName(project.brand_name)}-品牌占位方案-${new Date().toISOString().slice(0, 10)}.md`,
    markdown: md,
    stale,
    noBody,
    chapters: no,
    chars: md.length,
  };
}
