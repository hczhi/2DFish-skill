import cron from 'node-cron';
import { getDatabase } from '../db/index.js';
import { cleanupAnonymousQuota } from '../auth/requester.js';
import { cleanupOldCommands, cleanupOldEvents } from './feishuAssistant/commandLog.js';

const RETENTION_DAYS = 14;

/**
 * 飞书去重表的保留期。
 *
 * 比日志短得多，因为它服务的窗口是明确的：飞书最多重推到 **6 小时**后，
 * 过了那个点这行数据就再也不会被查了。7 天已经远超需要。
 */
const FEISHU_EVENT_RETENTION_DAYS = 7;

export function cleanupOldLogs(): void {
  const db = getDatabase();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);
  const cutoffStr = cutoff.toISOString();

  const aiResult = db.prepare('DELETE FROM ai_logs WHERE created_at < ?').run(cutoffStr);
  const tokenResult = db.prepare('DELETE FROM token_access_logs WHERE created_at < ?').run(cutoffStr);
  const pvResult = db.prepare('DELETE FROM page_views WHERE created_at < ?').run(cutoffStr);
  const pvDailyResult = db.prepare("DELETE FROM page_views_daily WHERE date < date('now', '-' || ? || ' days')").run(RETENTION_DAYS);

  // 匿名访客的配额行会随访客数无限增长，一并清掉过期的（只删非今天的，
  // 否则删完立刻重建等于绕过当日限额）。
  const anonCleaned = cleanupAnonymousQuota();

  // 飞书助理的两张表也在这里清。
  //
  // 它们以前不在：去重表只在**进程启动时**清一次，而这个服务是长期跑的
  // （单实例、长连接，正常情况下几个月不重启）—— 于是"启动时清理"实际等于
  // "永不清理"。指令日志则完全没有保留期，而它每条 @ 消息一行、还存原文，
  // 是本模块长得最快的表。放到这个每天 02:00 的 cron 里，两者都不再需要单独操心。
  const feishuCmds = cleanupOldCommands(RETENTION_DAYS);
  const feishuEvents = cleanupOldEvents(FEISHU_EVENT_RETENTION_DAYS);

  const total = aiResult.changes + tokenResult.changes + pvResult.changes + pvDailyResult.changes + anonCleaned + feishuCmds + feishuEvents;
  if (total > 0) {
    console.log(`[cleanup] Deleted ${aiResult.changes} ai_logs, ${tokenResult.changes} token_access_logs, ${pvResult.changes} page_views, ${pvDailyResult.changes} page_views_daily, ${anonCleaned} anon quota rows (older than ${RETENTION_DAYS} days), ${feishuCmds} feishu_commands (${RETENTION_DAYS}d), ${feishuEvents} feishu_events (${FEISHU_EVENT_RETENTION_DAYS}d)`);
  }
}

export function startLogCleanupScheduler(): void {
  cron.schedule('0 2 * * *', () => {
    console.log('[cleanup] Running scheduled log cleanup...');
    cleanupOldLogs();
  });

  console.log('[mmPla] Log cleanup scheduler started (daily at 02:00, retention: 14 days)');
}
