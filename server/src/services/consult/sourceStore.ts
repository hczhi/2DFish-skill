import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../../db/index.js';

// 联网检索采纳的资料（L1）。搜是 webSearchService 的事，这里只管
// 「用户勾了哪几条」+「它们怎么进 prompt」+「这一步的结论算第几级证据」。
//
// 方法论 §8 的数据源分级：L1 联网检索 / L2 客户资料 / L3 模型内置知识（只给区间）/
// L4 缺失。**级别在代码里算，不问模型** —— 同「计算格式不交给 LLM」那条规矩：
// 模型说自己是 L1 的时候，那句话和真的查到过一模一样。

export interface ConsultSource {
  id: string;
  project_id: string;
  stage_key: string;
  title: string;
  url: string;
  domain: string;
  published: string;
  snippet: string;
  query: string;
  created_at: string;
}

/**
 * 一个项目最多采纳多少条。**只拒不删** —— 采纳的资料每次调用都整段进 prompt，
 * 悄悄丢掉最后几条的话，用户会以为 AI 读过那几条（他明明勾了），
 * 而实际上那几条从来没进去过。
 */
export const MAX_SOURCES_PER_PROJECT = 40;
/** 单条摘要上限。Tavily 的摘要本来就短，超长的基本是整页正文被塞进来了。 */
export const MAX_SNIPPET_CHARS = 1500;

export function listSources(projectId: string): ConsultSource[] {
  const db = getDatabase();
  return db
    .prepare('SELECT * FROM consult_sources WHERE project_id = ? ORDER BY created_at')
    .all(projectId) as ConsultSource[];
}

/** 从 url 里取域名当标注用（取不到就原样留着 —— 标注里宁可难看，也不要没有出处）。 */
export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url.slice(0, 40);
  }
}

export interface AdoptInput {
  title: string;
  url: string;
  snippet: string;
  published?: string;
}

/**
 * 采纳几条搜索结果。
 *
 * 重复的 url 靠唯一索引挡掉，但**挡掉了几条要报出去**：同一条来源进两遍 prompt
 * 会被模型当成两处独立印证（「多个来源都提到…」），而用户看到的只是列表没变长。
 */
export function adoptSources(
  projectId: string,
  stageKey: string,
  query: string,
  items: AdoptInput[]
): { added: number; skipped: number } {
  const db = getDatabase();
  const now = new Date().toISOString();
  const ins = db.prepare(
    `INSERT OR IGNORE INTO consult_sources
       (id, project_id, stage_key, title, url, domain, published, snippet, query, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  let added = 0;
  const tx = db.transaction(() => {
    for (const it of items) {
      const url = String(it.url || '').trim();
      if (!url) continue;
      const info = ins.run(
        uuidv4(),
        projectId,
        stageKey,
        String(it.title || '').trim().slice(0, 300),
        url,
        domainOf(url),
        String(it.published || '').trim().slice(0, 40),
        String(it.snippet || '').trim().slice(0, MAX_SNIPPET_CHARS),
        query.slice(0, 200),
        now
      );
      added += info.changes;
    }
  });
  tx();
  return { added, skipped: items.length - added };
}

export function deleteSource(projectId: string, id: string): boolean {
  const db = getDatabase();
  return (
    db.prepare('DELETE FROM consult_sources WHERE id = ? AND project_id = ?').run(id, projectId)
      .changes > 0
  );
}

export function countSources(projectId: string): number {
  const db = getDatabase();
  return (
    db.prepare('SELECT COUNT(*) AS n FROM consult_sources WHERE project_id = ?').get(projectId) as {
      n: number;
    }
  ).n;
}

/**
 * 联网资料进 prompt 的那一段，附带分级规则。
 *
 * **没有联网资料时也要输出一段话**（而不是省掉这个块）：省掉的话模型手里只有
 * 客户资料，它会照常识把推测写成事实，读起来和查到的一模一样 ——
 * 分级的全部意义就是不许悄悄降级，所以「这次没有联网资料」必须明说。
 */
export function sourcesBlock(sources: ConsultSource[]): string {
  if (!sources.length) {
    return `（这个项目还没有采纳任何联网资料。所以除了【客户资料】里能对上的事实（L2），
其余一律按 L3「模型内置知识·仅区间」写：给区间不给精确值，并标注「（模型内置知识·仅区间）」。
不许把推测写成查到的事实，也不许凭空出现「据公开数据」「行业报告显示」这类说法 —— 这次没有联网。）`;
  }
  const lines = sources.map(
    (s, i) =>
      `${i + 1}. ${s.title || '(无标题)'} —— 来源：${s.domain}${s.published ? ` · ${s.published}` : ' · 未标日期'}\n` +
      `   ${s.snippet.replace(/\s*\n\s*/g, ' ')}\n   ${s.url}`
  );
  return `以下是用户逐条勾选采纳的联网检索资料（L1，最高一级证据）。引用它们时标注
「（联网·${sources[0].domain} 这类域名·年份）」，未标日期的写「未标日期」——
不写年份的话，三年前的旧数字读起来和今年的一模一样。

${lines.join('\n')}`;
}

/**
 * 这一步的结论算第几级证据。**按实际喂进去的东西算，不看模型怎么说。**
 *
 * 以前这个字段在路由里硬写成 'L1'，于是一条完全靠常识编出来的结论在界面上
 * 挂着「L1 联网检索」—— 用户会拿它去做决策，而它从来没被任何来源支撑过。
 */
export function sourceLevelFor(opts: { hasSources: boolean; hasBrief: boolean }): string {
  if (opts.hasSources) return 'L1';
  if (opts.hasBrief) return 'L2';
  return 'L3';
}
