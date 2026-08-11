/**
 * 标讯时效闸门（14 天）。
 *
 * 语义是「过期后从可见范围里消失」，**不是删除**：行、正文、content_hash、
 * 用户反馈、AI 评分全部原样留在库里。所以这是个纯读侧的过滤条件，
 * 没有任何定时任务、没有 UPDATE、没有 DELETE —— 改回 21/30 天只要改下面这个常量，
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
 * **两个日期都要过闸，缺一个都会漏。** 一条标讯要可见，必须同时满足：
 *   - `created_at` 在 14 天内 —— 「入库超过 14 天的不再推送、不再展示」这条规则本身。
 *   - `publish_date` 在 14 天内（空值算可见，见下）—— 只看 created_at 的话，
 *     库里那些 publish_date=2024-12-05 的历史公告（gdgpo 真实存在）会以「新标讯」
 *     的身份在列表和飞书表里挂满 14 天，还要花 token 评分。
 * 漏掉哪一个都不报错，只是用户看到一批他不该看到的东西 —— 静默的。
 */
export const TENDER_VISIBLE_DAYS = 14;

/**
 * 可见性 SQL 片段，直接拼进 WHERE，不带参数（天数是代码常量，不是用户输入）。
 *
 * 空 / NULL publish_date 一律**算可见**，和 isVisible() 保持同一个答案。
 * 这个分支不是假想的：四个爬虫都写 `publishDate: item.releaseTime || ''`，
 * 平台漏给发布时间就会存成空串。而 SQLite 里 `'' >= date(...)` 是 false，
 * 不显式兜一下的话空串会被判成「已过期」—— 一条刚抓回来的标讯直接
 * 不进列表、不评分、不推送，且没有任何地方会报出来。
 *
 * `created_at` 反过来**不兜空值**：它由代码写死 `new Date().toISOString()`，
 * 四个爬虫无一例外。兜了就等于留一个「这一列为空即绕过闸门」的后门，
 * 而将来真出现空值时表现是「过期标讯又回来了」，没人能从代码里看出为什么。
 * 存的是 ISO 串（含 T），前 10 位就是日期，字典序即时间序，
 * 直接和 `date('now', ...)` 比大小成立。
 *
 * @param alias 表别名，如 't'（不带点）。空串 = 不带别名。
 *              不做标识符校验，因为所有调用点都是本仓库里的字面量。
 */
export function visibleSql(alias = ''): string {
  const p = alias ? `${alias}.` : '';
  const cutoff = `date('now', '-${TENDER_VISIBLE_DAYS} day')`;
  return (
    `(${p}created_at >= ${cutoff}` +
    ` AND (${p}publish_date IS NULL OR ${p}publish_date = '' OR ${p}publish_date >= ${cutoff}))`
  );
}

/**
 * 反向条件，用于统计「已过期多少条」这类只读展示。
 *
 * 整体取反，不是把每个条件分别反过来：分别反的话「入库很久但发布日期是今天」
 * 这种行两边都不落，后台的「已过期 N 条」于是比实际少 ——
 * 读起来像统计口径的事，其实是漏了一批。两者相加必须等于全表。
 */
export function expiredSql(alias = ''): string {
  return `NOT ${visibleSql(alias)}`;
}

/**
 * 单行判断，给已经取出来的数据用（飞书推送那条链路是先查后过滤的）。
 *
 * publish_date 为空时**视为可见** —— 空值只说明平台没给发布时间，
 * 不代表它过期了；当成过期会让这条标讯永远不被推送且没人知道为什么。
 * createdAt 不传时同理放过：调用方没取这一列，不该由这里替它判死。
 */
export function isVisible(
  publishDate: string | null | undefined,
  createdAt?: string | null
): boolean {
  return withinWindow(publishDate) && withinWindow(createdAt);
}

function withinWindow(date: string | null | undefined): boolean {
  if (!date) return true;
  const t = Date.parse(String(date).replace(' ', 'T'));
  if (isNaN(t)) return true; // 解析不了同理，宁可多推不可静默丢
  return Date.now() - t <= TENDER_VISIBLE_DAYS * 86400_000;
}
