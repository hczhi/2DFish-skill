import cron from 'node-cron';
import type { Database } from 'better-sqlite3';
import { getDatabase } from '../../db/index.js';

/**
 * 标讯时效闸门（7 天）。
 *
 * 语义是「过期后从可见范围里消失」，**不是删除**：行、正文、content_hash、
 * 用户反馈、AI 评分全部原样留在库里。可见性判定纯在读侧
 * （{@link visibleSql} / {@link isVisible}），所以窗口天数改大改小立刻生效，
 * 不依赖任何定时任务跑过一遍。
 *
 * 唯一的写侧动作是 {@link expireOverdueTenders}：入库满 7 天的行会被置成
 * `status='expired'`（自动作废）。它**不负责隐藏**（读侧闸门早就把它们挡住了），
 * 只负责把「这条已经出局」变成库里的事实，见那个函数的注释。
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
 *   - `created_at` 在 7 天内 —— 「入库超过 7 天的不再推送、不再展示」这条规则本身。
 *   - `publish_date` 在 7 天内（空值算可见，见下）—— 只看 created_at 的话，
 *     库里那些 publish_date=2024-12-05 的历史公告（gdgpo 真实存在）会以「新标讯」
 *     的身份在列表和飞书表里挂满 7 天，还要花 token 评分。
 * 漏掉哪一个都不报错，只是用户看到一批他不该看到的东西 —— 静默的。
 */
export const TENDER_VISIBLE_DAYS = 7;

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

/**
 * 入库满 {@link TENDER_VISIBLE_DAYS} 天的标讯自动作废（`status='expired'`）。
 *
 * 这件事**不是为了隐藏**：读侧闸门（`visibleSql`）早就把它们从用户列表、评分、
 * 推送、多维表格里挡住了，一天不跑这个函数也不会有过期标讯露出来。它解决的是
 * 「状态和事实不一致」带来的白花钱：草稿库列的是 `status='draft'` 的**全部**行、
 * 不过闸门，于是一个月前入库、永远不可能再可见的草稿照样摆在「待提取」里等人勾选，
 * 点下去就是一次实打实的 AI 提取 —— 提完置成 extracted，然后被闸门挡住，
 * 整条链路一句错都不报。
 *
 * 三条口径，改的时候别绕过去：
 *
 * 1. **只看 `created_at`**，不看 `publish_date`。规则就是「入库满 7 天作废」；
 *    发布日期过期那类行继续只由读侧挡（`status` 停在 scored），因为
 *    `publish_date` 是爬虫写的、可能是空串或格式怪的（`visibleSql` 对空值放行），
 *    拿它去改库里的状态就是让一列不可信的数据把标讯永久打成作废。
 * 2. **`'rejected'` 不碰。** 那是 AI 判「和关键词库无关」的作废，`reject_reason` 里
 *    存着理由，而草稿库「已作废」那个数字是发现闸门误杀的唯一线索 ——
 *    把过期的也倒进去，那个数字就再也说明不了任何事。同理过期的用**另一个**状态值：
 *    `restore` 只认 rejected，混在一起的话用户点「恢复」→ 回到 draft →
 *    下一次巡检又给作废掉，而 `ai_extracted` 已经被恢复动作清空（花过的 token
 *    白扔），两次点击都显示成功。
 * 3. **幂等**：已经是 `'expired'` 的不再写，返回值就是这次真正改掉的条数。
 *    条数要报出去（启动日志 / cron 日志）—— 一次巡检把 80 条草稿扫成作废是
 *    件大事，不说的话草稿库第二天少了 80 条，看起来像数据丢了。
 *
 * `status IN ('extracted','scored')` 这类白名单式的过滤天生就把新状态排除在外，
 * 所以除了后台那几个计数，没有别的地方需要为这个状态改代码。
 */
export function expireOverdueTenders(db: Database = getDatabase()): number {
  const reason = `入库超过 ${TENDER_VISIBLE_DAYS} 天，已过时效自动作废`;
  const r = db
    .prepare(
      `UPDATE tenders SET status = 'expired', reject_reason = ?
        WHERE created_at < date('now', '-${TENDER_VISIBLE_DAYS} day')
          AND status IN ('draft', 'extracted', 'scored')`
    )
    .run(reason);
  return r.changes;
}

/**
 * 每天 02:10 巡检一次（错开 logCleanupService 的 02:00，两个 cron 不必抢同一把写锁）。
 *
 * 频率无所谓精确：延迟一天作废的行在界面上已经是不可见的，这个 cron 只是把状态补上。
 * 但**必须有**这个 cron 而不能只在启动时跑一次 —— 这个服务正常能连着跑几个月
 * （单实例 + 飞书长连接），「启动时跑一次」实际等于「永不再跑」，
 * 于是草稿库会慢慢重新长出一批永远不可能可见的待提取行。
 */
export function startTenderExpiryScheduler(): void {
  cron.schedule('10 2 * * *', () => {
    const n = expireOverdueTenders();
    if (n > 0) console.log(`[tender] 自动作废 ${n} 条入库超过 ${TENDER_VISIBLE_DAYS} 天的标讯`);
  });
  console.log(`[mmPla] Tender expiry scheduler started (daily at 02:10, window: ${TENDER_VISIBLE_DAYS} days)`);
}

function withinWindow(date: string | null | undefined): boolean {
  if (!date) return true;
  const t = Date.parse(String(date).replace(' ', 'T'));
  if (isNaN(t)) return true; // 解析不了同理，宁可多推不可静默丢
  return Date.now() - t <= TENDER_VISIBLE_DAYS * 86400_000;
}
