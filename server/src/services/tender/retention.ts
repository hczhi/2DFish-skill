/**
 * 标讯时效闸门（21 天）。
 *
 * 语义是「过期后从可见范围里消失」，**不是删除**：行、正文、content_hash、
 * 用户反馈、AI 评分全部原样留在库里。所以这是个纯读侧的过滤条件，
 * 没有任何定时任务、没有 UPDATE、没有 DELETE —— 改回 30 天只要改下面这个常量，
 * 已经「消失」的标讯会立刻重新出现。
 *
 * 为什么不删行（这几点是这个设计的全部理由，别绕过去）：
 *   1. 四个爬虫的去重集合就是 tenders 表本身
 *      （`SELECT content_hash FROM tenders WHERE platform = ?`）。删行 = 清空去重记忆，
 *      重抓会拿到**新 uuid**，而 tender_bitable_sync 主键是 (user_id, tender_id) ——
 *      于是同一条标讯在用户的多维表格里出现第二次。
 *   2. recommendService 打分时 `JOIN tenders` 读用户历史反馈（判断偏好用的）。
 *      标讯没了，INNER JOIN 把反馈一起丢掉，用户会体验成「标过不适合还一直推」。
 *   3. tender_recommendations 里的 ai_reason 是花过 token 的。
 *
 * 按 publish_date 而不是 created_at 筛：用户说的「21 天」是公告的时效，
 * 而库里存在 publish_date=2024-12-05 的历史公告（gdgpo），
 * 按入库时间算的话它们会以「新标讯」的身份在列表里挂 21 天。
 */
export const TENDER_VISIBLE_DAYS = 21;

/**
 * 可见性 SQL 片段，直接拼进 WHERE，不带参数（天数是代码常量，不是用户输入）。
 *
 * 空 / NULL publish_date 一律**算可见**，和 isVisible() 保持同一个答案。
 * 这个分支不是假想的：四个爬虫都写 `publishDate: item.releaseTime || ''`，
 * 平台漏给发布时间就会存成空串。而 SQLite 里 `'' >= date(...)` 是 false，
 * 不显式兜一下的话空串会被判成「已过期」—— 一条刚抓回来的标讯直接
 * 不进列表、不评分、不推送，且没有任何地方会报出来。
 *
 * @param col 列名（含表别名，如 't.publish_date'）。调用方给什么就用什么 ——
 *            这里不做标识符校验，因为所有调用点都是本仓库里的字面量。
 */
export function visibleSql(col = 'publish_date'): string {
  return `(${col} IS NULL OR ${col} = '' OR ${col} >= date('now', '-${TENDER_VISIBLE_DAYS} day'))`;
}

/**
 * 反向条件，用于统计「已过期多少条」这类只读展示。
 * 与 visibleSql 严格互补：空值不算过期，两者相加等于全表。
 */
export function expiredSql(col = 'publish_date'): string {
  return `(${col} IS NOT NULL AND ${col} != '' AND ${col} < date('now', '-${TENDER_VISIBLE_DAYS} day'))`;
}

/**
 * 单行判断，给已经取出来的数据用（飞书推送那条链路是先查后过滤的）。
 * publish_date 为空时**视为可见** —— 空值只说明平台没给发布时间，
 * 不代表它过期了；当成过期会让这条标讯永远不被推送且没人知道为什么。
 */
export function isVisible(publishDate: string | null | undefined): boolean {
  if (!publishDate) return true;
  const t = Date.parse(String(publishDate).replace(' ', 'T'));
  if (isNaN(t)) return true; // 解析不了同理，宁可多推不可静默丢
  return Date.now() - t <= TENDER_VISIBLE_DAYS * 86400_000;
}
