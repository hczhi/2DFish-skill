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
  /**
   * 1 = 机器自己搜来的（四看一键分析那次），0 = 用户逐条勾选采纳的。见 migration 110。
   * **它不是元数据，是证据等级的一部分** —— 两者混同的话一条 SEO 垃圾页和他核过的年报
   * 在分级里同为 L1，而正文只会写得更自信。
   */
  auto: number;
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
  items: AdoptInput[],
  /**
   * true = 这几条是机器搜来的（四看一键分析），没人看过。**默认 false** ——
   * 自动那条路忘了传的话，它们会当成「他逐条核过的 L1」进 prompt 和报告出处，
   * 而界面上和真采纳的一模一样（见 migration 110）。
   */
  auto = false
): { added: number; skipped: number } {
  const db = getDatabase();
  const now = new Date().toISOString();
  const ins = db.prepare(
    `INSERT OR IGNORE INTO consult_sources
       (id, project_id, stage_key, title, url, domain, published, snippet, query, auto, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        auto ? 1 : 0,
        now
      );
      added += info.changes;
      // 他手动勾的这条，自动那次已经搜到过了（唯一索引把 INSERT 挡掉）——
      // 那就把它**升级成人工核对过的**：不升的话他明明亲手核了一遍，那条资料在
      // prompt 里照旧挂着「未人工核对」，模型会继续给区间、继续加免责的话，
      // 而他在界面上只看到「这条已经在列表里了」。
      if (!auto && info.changes === 0) {
        const up = db
          .prepare('UPDATE consult_sources SET auto = 0 WHERE project_id = ? AND url = ? AND auto = 1')
          .run(projectId, url);
        added += up.changes;
      }
    }
  });
  tx();
  return { added, skipped: items.length - added };
}

/**
 * 「这条我点开看过了」：把自动搜来的那一行升级成人工核对过的（`auto = 0`）。
 *
 * 必须有这个动作，否则自动抓的资料只有两条出路 —— 删掉，或者永远挂着「未人工核对」
 * 让模型一直给区间、一直加免责的话。他核过一条就该按一条，而升级之后这一步的证据
 * 级别才从 `L1?` 回到 L1。
 *
 * 只动 `auto = 1` 的行（回 false 而不是「成功」）：本来就是他采纳的那些不该被这个动作碰，
 * 「点了没反应」也比「什么都没发生却说已确认」好定位。
 */
export function verifySource(projectId: string, id: string): boolean {
  const db = getDatabase();
  return (
    db
      .prepare('UPDATE consult_sources SET auto = 0 WHERE id = ? AND project_id = ? AND auto = 1')
      .run(id, projectId).changes > 0
  );
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
  const fmt = (s: ConsultSource, i: number) =>
    `${i + 1}. ${s.title || '(无标题)'} —— 来源：${s.domain}${s.published ? ` · ${s.published}` : ' · 未标日期'}\n` +
    `   ${s.snippet.replace(/\s*\n\s*/g, ' ')}\n   ${s.url}`;

  // 人工采纳的和机器自己搜的**分两段**，各带各的引用要求。混在一段里的话模型分不出来
  // （它只看得到这段文字），于是一条没人看过的搜索结果被写成「据公开数据」，
  // 而那句话和真查证过的一模一样 —— 这是这个字段存在的全部理由（见 migration 110）。
  const picked = sources.filter((s) => !s.auto);
  const auto = sources.filter((s) => s.auto);
  const parts: string[] = [];
  if (picked.length) {
    parts.push(`【联网资料 · 用户逐条勾选采纳的（L1，最高一级证据）】
引用它们时标注「（联网·域名·年份）」，未标日期的写「未标日期」——
不写年份的话，三年前的旧数字读起来和今年的一模一样。

${picked.map(fmt).join('\n')}`);
  }
  if (auto.length) {
    parts.push(`【联网资料 · 这次自动检索抓回来的（L1?，**没有人核对过**）】
这几条是系统按关键词自动搜的，用户还没有逐条看过：可能搜到的是同名的另一家公司、
一篇几年前的旧稿、或者一页营销软文。所以用它们的时候三条硬要求：
① 引用必须写成「（联网·域名·年份·未人工核对）」—— 少了后半句，读者会把它当成核实过的事实；
② 关键数字（市场规模、份额、融资额、价格）**同时给出区间和这条出处**，只有一条来源支持时
   明说「仅一处来源，未交叉验证」；
③ 和【客户资料】冲突时**以客户资料为准**，并把冲突写进「需要核实」那一类里 ——
   悄悄采信搜来的那条的话，整节结论都建立在一篇没人看过的网页上。

${auto.map(fmt).join('\n')}`);
  }
  return parts.join('\n\n');
}

/**
 * 这一步的结论算第几级证据。**按实际喂进去的东西算，不看模型怎么说。**
 *
 * 以前这个字段在路由里硬写成 'L1'，于是一条完全靠常识编出来的结论在界面上
 * 挂着「L1 联网检索」—— 用户会拿它去做决策，而它从来没被任何来源支撑过。
 */
export function sourceLevelFor(opts: { hasPicked: boolean; hasAuto?: boolean; hasBrief: boolean }): string {
  if (opts.hasPicked) return 'L1';
  // 只有自动搜来的那几条时是 `L1?`：查过网了（比只靠常识强），但**没有人核对过**。
  // 一律算 L1 的话，界面上这一步挂着「L1 联网检索」而它可能全靠一页软文；
  // 一律算 L2 的话，那几条资料等于白搜（他会以为自动联网没生效，回去手动再搜一遍）。
  if (opts.hasAuto) return 'L1?';
  if (opts.hasBrief) return 'L2';
  return 'L3';
}

/** 人工采纳的 / 自动抓的各几条。级别和界面分组都按这两个数分岔（见 `sourceLevelFor`）。 */
export function countSourcesByKind(projectId: string): { picked: number; auto: number } {
  const db = getDatabase();
  const row = db
    .prepare(
      `SELECT SUM(CASE WHEN auto = 1 THEN 0 ELSE 1 END) AS picked,
              SUM(CASE WHEN auto = 1 THEN 1 ELSE 0 END) AS auto
         FROM consult_sources WHERE project_id = ?`
    )
    .get(projectId) as { picked: number | null; auto: number | null };
  return { picked: row.picked || 0, auto: row.auto || 0 };
}
