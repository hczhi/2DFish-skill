import cron from 'node-cron';
import { getDatabase } from '../db/index.js';

const RETENTION_DAYS = 14;

export function cleanupOldLogs(): void {
  const db = getDatabase();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);
  const cutoffStr = cutoff.toISOString();

  const aiResult = db.prepare('DELETE FROM ai_logs WHERE created_at < ?').run(cutoffStr);
  const tokenResult = db.prepare('DELETE FROM token_access_logs WHERE created_at < ?').run(cutoffStr);
  const pvResult = db.prepare('DELETE FROM page_views WHERE created_at < ?').run(cutoffStr);
  const pvDailyResult = db.prepare("DELETE FROM page_views_daily WHERE date < date('now', '-' || ? || ' days')").run(RETENTION_DAYS);

  const total = aiResult.changes + tokenResult.changes + pvResult.changes + pvDailyResult.changes;
  if (total > 0) {
    console.log(`[cleanup] Deleted ${aiResult.changes} ai_logs, ${tokenResult.changes} token_access_logs, ${pvResult.changes} page_views, ${pvDailyResult.changes} page_views_daily (older than ${RETENTION_DAYS} days)`);
  }
}

export function startLogCleanupScheduler(): void {
  cron.schedule('0 2 * * *', () => {
    console.log('[cleanup] Running scheduled log cleanup...');
    cleanupOldLogs();
  });

  console.log('[mmPla] Log cleanup scheduler started (daily at 02:00, retention: 14 days)');
}
