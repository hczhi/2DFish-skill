import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../db/index.js';
import { getCrawler, getAllPlatforms } from '../services/tender/crawlerRegistry.js';
import { runRecommendationsForAllUsers } from '../services/tender/recommendService.js';
import { runAIExtractForTenders } from '../services/tender/aiExtractService.js';
import { tenderSdkGuard, registerSdkRoutes, registerSdkAdminRoutes } from './tenderSdk.js';

export const tenderRouter = Router();

// SDK 相关：token 换取路由（PUBLIC）、admin 管理路由，以及 scope 短 token 的
// 只读端点闸门 + CORS。guard 必须最先挂，才能在越权请求到达业务处理器前拦截。
tenderRouter.use(tenderSdkGuard);
registerSdkRoutes(tenderRouter);
registerSdkAdminRoutes(tenderRouter);

// ==================== User: Recommendations ====================

tenderRouter.get('/recommendations', (req, res) => {
  const userId = req.user!.id;
  const db = getDatabase();
  const tier = req.query.tier as string;
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const pageSize = Math.min(50, parseInt(req.query.page_size as string) || 20);
  const offset = (page - 1) * pageSize;

  let where = "r.user_id = ? AND r.created_at >= datetime('now', '-20 days')";
  const params: any[] = [userId];

  if (tier && tier !== 'all') {
    where += ' AND r.tier = ?';
    params.push(tier);
  } else {
    where += " AND r.tier != 'filter'";
  }

  const total = (db.prepare(`SELECT COUNT(*) as count FROM tender_recommendations r WHERE ${where}`).get(...params) as any).count;
  const items = db.prepare(`
    SELECT r.*, t.title, t.purchaser_name, t.budget, t.budget_amount, t.region_name, t.publish_date, t.url, t.notice_type, t.project_type, t.project_location, t.project_summary,
      f.feedback as user_feedback, f.reason as feedback_reason
    FROM tender_recommendations r
    JOIN tenders t ON r.tender_id = t.id
    LEFT JOIN tender_user_feedback f ON f.tender_id = r.tender_id AND f.user_id = r.user_id
    WHERE ${where}
    ORDER BY r.total_score DESC
    LIMIT ? OFFSET ?
  `).all(...params, pageSize, offset);

  res.json({ items, total, page, page_size: pageSize });
});

tenderRouter.patch('/recommendations/:id/read', (req, res) => {
  const userId = req.user!.id;
  const db = getDatabase();
  db.prepare('UPDATE tender_recommendations SET is_read = 1 WHERE id = ? AND user_id = ?').run(req.params.id, userId);
  res.json({ success: true });
});

// ==================== User: Feedback (Knowledge Base) ====================

tenderRouter.get('/feedback', (req, res) => {
  const userId = req.user!.id;
  const db = getDatabase();
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const pageSize = Math.min(50, parseInt(req.query.page_size as string) || 20);
  const offset = (page - 1) * pageSize;

  const total = (db.prepare('SELECT COUNT(*) as count FROM tender_user_feedback WHERE user_id = ?').get(userId) as any).count;
  const items = db.prepare(`
    SELECT f.*, t.title, t.purchaser_name, t.region_name, t.project_type
    FROM tender_user_feedback f
    JOIN tenders t ON f.tender_id = t.id
    WHERE f.user_id = ?
    ORDER BY f.created_at DESC
    LIMIT ? OFFSET ?
  `).all(userId, pageSize, offset);

  res.json({ items, total, page, page_size: pageSize });
});

tenderRouter.post('/feedback', (req, res) => {
  const userId = req.user!.id;
  const { tenderId, recommendationId, feedback, reason } = req.body;

  if (!tenderId || !feedback) return res.status(400).json({ error: 'tenderId and feedback are required' });
  if (!['suitable', 'not_suitable'].includes(feedback)) return res.status(400).json({ error: 'feedback must be suitable or not_suitable' });

  const db = getDatabase();
  const id = uuidv4();
  db.prepare(`
    INSERT OR REPLACE INTO tender_user_feedback (id, user_id, tender_id, recommendation_id, feedback, reason, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, userId, tenderId, recommendationId || '', feedback, reason || '', new Date().toISOString());

  res.json({ id, feedback, reason });
});

tenderRouter.delete('/feedback/:id', (req, res) => {
  const userId = req.user!.id;
  const db = getDatabase();
  db.prepare('DELETE FROM tender_user_feedback WHERE id = ? AND user_id = ?').run(req.params.id, userId);
  res.json({ success: true });
});

// ==================== User: Browse All Tenders ====================

tenderRouter.get('/list', (req, res) => {
  const db = getDatabase();
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const pageSize = Math.min(50, parseInt(req.query.page_size as string) || 20);
  const offset = (page - 1) * pageSize;
  const search = (req.query.search as string) || '';
  const platform = (req.query.platform as string) || '';
  const keyword = (req.query.keyword as string) || '';

  let where = "status != 'draft'";
  const params: any[] = [];

  if (search) {
    where += ' AND (title LIKE ? OR purchaser_name LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }
  if (platform) {
    where += ' AND platform = ?';
    params.push(platform);
  }
  if (keyword) {
    where += ' AND keyword = ?';
    params.push(keyword);
  }

  const total = (db.prepare(`SELECT COUNT(*) as count FROM tenders WHERE ${where}`).get(...params) as any).count;
  const items = db.prepare(`
    SELECT id, platform, title, publish_date, budget, budget_amount, purchaser_name, region_name, notice_type, url, keyword, created_at
    FROM tenders WHERE ${where}
    ORDER BY publish_date DESC
    LIMIT ? OFFSET ?
  `).all(...params, pageSize, offset);

  res.json({ items, total, page, page_size: pageSize });
});

tenderRouter.get('/detail/:id', (req, res) => {
  const db = getDatabase();
  const tender = db.prepare('SELECT * FROM tenders WHERE id = ?').get(req.params.id);
  if (!tender) return res.status(404).json({ error: 'Not found' });
  res.json(tender);
});

// ==================== User: Keywords ====================

tenderRouter.get('/keywords', (req, res) => {
  const userId = req.user!.id;
  const db = getDatabase();
  const keywords = db.prepare('SELECT * FROM tender_user_keywords WHERE user_id = ? ORDER BY created_at DESC').all(userId);
  res.json(keywords);
});

tenderRouter.post('/keywords', (req, res) => {
  const userId = req.user!.id;
  const { keyword, weight } = req.body;
  if (!keyword) return res.status(400).json({ error: 'keyword is required' });

  const db = getDatabase();
  const id = uuidv4();
  db.prepare('INSERT INTO tender_user_keywords (id, user_id, keyword, weight, created_at) VALUES (?, ?, ?, ?, ?)').run(id, userId, keyword, weight ?? 1.0, new Date().toISOString());
  res.json({ id, keyword, weight: weight ?? 1.0 });
});

tenderRouter.patch('/keywords/:id', (req, res) => {
  const userId = req.user!.id;
  const { keyword, weight, enabled } = req.body;
  const db = getDatabase();

  const existing = db.prepare('SELECT id FROM tender_user_keywords WHERE id = ? AND user_id = ?').get(req.params.id, userId);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  if (keyword !== undefined) db.prepare('UPDATE tender_user_keywords SET keyword = ? WHERE id = ?').run(keyword, req.params.id);
  if (weight !== undefined) db.prepare('UPDATE tender_user_keywords SET weight = ? WHERE id = ?').run(weight, req.params.id);
  if (enabled !== undefined) db.prepare('UPDATE tender_user_keywords SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, req.params.id);

  res.json({ success: true });
});

tenderRouter.delete('/keywords/:id', (req, res) => {
  const userId = req.user!.id;
  const db = getDatabase();
  db.prepare('DELETE FROM tender_user_keywords WHERE id = ? AND user_id = ?').run(req.params.id, userId);
  res.json({ success: true });
});

// ==================== User: Clients ====================

tenderRouter.get('/clients', (req, res) => {
  const userId = req.user!.id;
  const db = getDatabase();
  const clients = db.prepare('SELECT * FROM tender_user_clients WHERE user_id = ? ORDER BY relationship_score DESC').all(userId);
  res.json(clients);
});

tenderRouter.post('/clients', (req, res) => {
  const userId = req.user!.id;
  const { clientName, relationshipScore, paymentCredit, notes } = req.body;
  if (!clientName) return res.status(400).json({ error: 'clientName is required' });

  const db = getDatabase();
  const id = uuidv4();
  db.prepare('INSERT INTO tender_user_clients (id, user_id, client_name, relationship_score, payment_credit, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, userId, clientName, relationshipScore ?? 5, paymentCredit || 'normal', notes || '', new Date().toISOString());
  res.json({ id });
});

tenderRouter.patch('/clients/:id', (req, res) => {
  const userId = req.user!.id;
  const { clientName, relationshipScore, paymentCredit, notes } = req.body;
  const db = getDatabase();

  const existing = db.prepare('SELECT id FROM tender_user_clients WHERE id = ? AND user_id = ?').get(req.params.id, userId);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  if (clientName !== undefined) db.prepare('UPDATE tender_user_clients SET client_name = ? WHERE id = ?').run(clientName, req.params.id);
  if (relationshipScore !== undefined) db.prepare('UPDATE tender_user_clients SET relationship_score = ? WHERE id = ?').run(relationshipScore, req.params.id);
  if (paymentCredit !== undefined) db.prepare('UPDATE tender_user_clients SET payment_credit = ? WHERE id = ?').run(paymentCredit, req.params.id);
  if (notes !== undefined) db.prepare('UPDATE tender_user_clients SET notes = ? WHERE id = ?').run(notes, req.params.id);

  res.json({ success: true });
});

tenderRouter.delete('/clients/:id', (req, res) => {
  const userId = req.user!.id;
  const db = getDatabase();
  db.prepare('DELETE FROM tender_user_clients WHERE id = ? AND user_id = ?').run(req.params.id, userId);
  res.json({ success: true });
});

// ==================== User: Preferences ====================

tenderRouter.get('/preferences', (req, res) => {
  const userId = req.user!.id;
  const db = getDatabase();
  const pref = db.prepare('SELECT * FROM tender_user_preferences WHERE user_id = ?').get(userId);
  if (!pref) {
    return res.json({
      budgetMin: 0, budgetMax: 0, allowBelowMinForVip: false,
      preferredRegions: [], acceptableRegions: [], excludedRegions: [],
      qualifications: [], caseTags: [], excludedTypes: [],
    });
  }
  res.json({
    budgetMin: (pref as any).budget_min,
    budgetMax: (pref as any).budget_max,
    allowBelowMinForVip: !!(pref as any).allow_below_min_for_vip,
    preferredRegions: JSON.parse((pref as any).preferred_regions || '[]'),
    acceptableRegions: JSON.parse((pref as any).acceptable_regions || '[]'),
    excludedRegions: JSON.parse((pref as any).excluded_regions || '[]'),
    qualifications: JSON.parse((pref as any).qualifications || '[]'),
    caseTags: JSON.parse((pref as any).case_tags || '[]'),
    excludedTypes: JSON.parse((pref as any).excluded_types || '[]'),
  });
});

tenderRouter.put('/preferences', (req, res) => {
  const userId = req.user!.id;
  const { budgetMin, budgetMax, allowBelowMinForVip, preferredRegions, acceptableRegions, excludedRegions, qualifications, caseTags, excludedTypes } = req.body;
  const db = getDatabase();
  const now = new Date().toISOString();

  const existing = db.prepare('SELECT id FROM tender_user_preferences WHERE user_id = ?').get(userId);
  if (existing) {
    db.prepare(`UPDATE tender_user_preferences SET budget_min = ?, budget_max = ?, allow_below_min_for_vip = ?, preferred_regions = ?, acceptable_regions = ?, excluded_regions = ?, qualifications = ?, case_tags = ?, excluded_types = ?, updated_at = ? WHERE user_id = ?`)
      .run(budgetMin ?? 0, budgetMax ?? 0, allowBelowMinForVip ? 1 : 0, JSON.stringify(preferredRegions || []), JSON.stringify(acceptableRegions || []), JSON.stringify(excludedRegions || []), JSON.stringify(qualifications || []), JSON.stringify(caseTags || []), JSON.stringify(excludedTypes || []), now, userId);
  } else {
    db.prepare(`INSERT INTO tender_user_preferences (id, user_id, budget_min, budget_max, allow_below_min_for_vip, preferred_regions, acceptable_regions, excluded_regions, qualifications, case_tags, excluded_types, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(uuidv4(), userId, budgetMin ?? 0, budgetMax ?? 0, allowBelowMinForVip ? 1 : 0, JSON.stringify(preferredRegions || []), JSON.stringify(acceptableRegions || []), JSON.stringify(excludedRegions || []), JSON.stringify(qualifications || []), JSON.stringify(caseTags || []), JSON.stringify(excludedTypes || []), now, now);
  }

  res.json({ success: true });
});

// ==================== Keyword Pool (shared) ====================

tenderRouter.get('/keyword-pool', (req, res) => {
  const db = getDatabase();
  const keywords = db.prepare('SELECT * FROM tender_keyword_pool WHERE enabled = 1 ORDER BY sort_order, created_at').all();
  res.json(keywords);
});

// ==================== Admin: Keyword Pool Management ====================

tenderRouter.get('/admin/keyword-pool', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  const db = getDatabase();
  const keywords = db.prepare('SELECT * FROM tender_keyword_pool ORDER BY sort_order, created_at').all();
  res.json(keywords);
});

tenderRouter.post('/admin/keyword-pool', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  const { keyword, category } = req.body;
  if (!keyword || !keyword.trim()) return res.status(400).json({ error: 'keyword is required' });

  const db = getDatabase();
  const existing = db.prepare('SELECT id FROM tender_keyword_pool WHERE keyword = ?').get(keyword.trim());
  if (existing) return res.status(400).json({ error: 'Keyword already exists' });

  const id = uuidv4();
  const maxOrder = (db.prepare('SELECT MAX(sort_order) as m FROM tender_keyword_pool').get() as any)?.m || 0;
  db.prepare('INSERT INTO tender_keyword_pool (id, keyword, category, enabled, sort_order, created_at) VALUES (?, ?, ?, 1, ?, ?)')
    .run(id, keyword.trim(), category || '', maxOrder + 1, new Date().toISOString());
  res.json({ id, keyword: keyword.trim(), category: category || '', enabled: 1 });
});

tenderRouter.patch('/admin/keyword-pool/:id', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  const { keyword, category, enabled, sort_order } = req.body;
  const db = getDatabase();

  const existing = db.prepare('SELECT id FROM tender_keyword_pool WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  if (keyword !== undefined) db.prepare('UPDATE tender_keyword_pool SET keyword = ? WHERE id = ?').run(keyword, req.params.id);
  if (category !== undefined) db.prepare('UPDATE tender_keyword_pool SET category = ? WHERE id = ?').run(category, req.params.id);
  if (enabled !== undefined) db.prepare('UPDATE tender_keyword_pool SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, req.params.id);
  if (sort_order !== undefined) db.prepare('UPDATE tender_keyword_pool SET sort_order = ? WHERE id = ?').run(sort_order, req.params.id);

  res.json({ success: true });
});

tenderRouter.delete('/admin/keyword-pool/:id', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  const db = getDatabase();
  db.prepare('DELETE FROM tender_keyword_pool WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ==================== Admin: Platforms ====================

tenderRouter.get('/admin/platforms', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  res.json(getAllPlatforms());
});

// ==================== Admin: Crawl Management ====================

// In-memory crawl task status
interface LogEntry {
  time: string;
  message: string;
  detail?: string; // collapsible detail (prompt/response)
}

interface CrawlTaskStatus {
  status: 'idle' | 'crawling' | 'extracting' | 'recommending' | 'completed' | 'failed';
  step: string;
  message: string;
  current: number;
  total: number;
  startedAt: string;
  completedAt?: string;
  error?: string;
  newAdded?: number;
  logs: LogEntry[];
}

let crawlTaskStatus: CrawlTaskStatus = {
  status: 'idle', step: '', message: '', current: 0, total: 0, startedAt: '', logs: [],
};

function crawlLog(msg: string, detail?: string) {
  const ts = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  crawlTaskStatus.logs.push({ time: ts, message: msg, detail });
  if (crawlTaskStatus.logs.length > 300) crawlTaskStatus.logs.shift();
  console.log(`[tender] ${msg}`);
}

let crawlAbortController: AbortController | null = null;

tenderRouter.get('/admin/crawl-status', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  res.json(crawlTaskStatus);
});

tenderRouter.post('/admin/crawl-abort', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  if (crawlTaskStatus.status === 'idle' || crawlTaskStatus.status === 'completed' || crawlTaskStatus.status === 'failed') {
    return res.status(400).json({ error: '没有正在运行的任务' });
  }
  if (crawlAbortController) {
    crawlAbortController.abort();
  }
  crawlTaskStatus.status = 'failed';
  crawlTaskStatus.error = '手动终止';
  crawlTaskStatus.completedAt = new Date().toISOString();
  crawlLog('任务已被手动终止');
  res.json({ success: true });
});

tenderRouter.post('/admin/crawl', async (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  const { keywords, daysLimit, platform } = req.body;
  if (!keywords || !Array.isArray(keywords) || keywords.length === 0) {
    return res.status(400).json({ error: 'keywords array is required' });
  }

  const platformId = platform || 'gdgpo';
  const crawler = getCrawler(platformId);
  if (!crawler) {
    return res.status(400).json({ error: `Unknown platform: ${platformId}` });
  }

  if (crawlTaskStatus.status === 'crawling' || crawlTaskStatus.status === 'extracting' || crawlTaskStatus.status === 'recommending') {
    return res.status(409).json({ error: '已有爬取任务在运行中' });
  }

  crawlAbortController = new AbortController();
  crawlTaskStatus = {
    status: 'crawling',
    step: 'starting',
    message: `正在启动爬取 (${crawler.name})...`,
    current: 0,
    total: keywords.length,
    startedAt: new Date().toISOString(),
    logs: [],
  };

  crawlLog(`开始爬取，平台: ${crawler.name}，关键词: ${keywords.join(', ')}，时间范围: ${daysLimit || 14}天`);

  res.json({ status: 'started', message: 'Crawl started in background' });

  const abortSignal = crawlAbortController.signal;

  try {
    if (abortSignal.aborted) throw new Error('任务已终止');
    const { logId, items } = await crawler.crawl(keywords, daysLimit || 14, (progress) => {
      crawlTaskStatus.step = progress.step;
      crawlTaskStatus.message = progress.message;
      crawlTaskStatus.current = progress.current;
      crawlTaskStatus.total = progress.total;
      crawlLog(progress.message);
    });

    crawlLog(`爬取完成: 共获取 ${items.length} 条数据`);
    if (abortSignal.aborted) throw new Error('任务已终止');

    const db = getDatabase();
    // Only set status='draft' for tenders that don't already have a status (newly inserted)
    const result = db.prepare("UPDATE tenders SET status = 'draft' WHERE status IS NULL OR status = ''").run();
    const newCount = result.changes;

    crawlLog(`数据库新增: ${newCount} 条（去重后）`);
    crawlTaskStatus.newAdded = newCount;

    crawlTaskStatus.status = 'completed';
    crawlTaskStatus.message = `完成：新增 ${crawlTaskStatus.newAdded || 0} 条标讯（草稿状态，请手动执行提取和评分）`;
    crawlTaskStatus.completedAt = new Date().toISOString();
    crawlLog(`爬取完成：新增 ${crawlTaskStatus.newAdded || 0} 条标讯，已存入草稿库`);
  } catch (e: any) {
    crawlLog(`错误: ${e.message}`);
    crawlTaskStatus.status = 'failed';
    crawlTaskStatus.error = e.message;
    crawlTaskStatus.message = `失败：${e.message}`;
    crawlTaskStatus.completedAt = new Date().toISOString();
  }
});

tenderRouter.get('/admin/crawl-logs', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  const db = getDatabase();
  const logs = db.prepare('SELECT * FROM tender_crawl_logs ORDER BY started_at DESC LIMIT 50').all();
  res.json(logs);
});

tenderRouter.get('/admin/tenders', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  const db = getDatabase();
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const pageSize = Math.min(100, parseInt(req.query.page_size as string) || 30);
  const offset = (page - 1) * pageSize;
  const platform = (req.query.platform as string) || '';
  const search = (req.query.search as string) || '';
  const keyword = (req.query.keyword as string) || '';

  let where = "status IN ('extracted', 'scored')";
  const params: any[] = [];
  if (platform) { where += ' AND platform = ?'; params.push(platform); }
  if (search) { where += ' AND (title LIKE ? OR purchaser_name LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
  if (keyword) { where += ' AND keyword = ?'; params.push(keyword); }

  const total = (db.prepare(`SELECT COUNT(*) as count FROM tenders WHERE ${where}`).get(...params) as any).count;
  const items = db.prepare(`SELECT id, platform, notice_id, title, publish_date, budget, budget_amount, purchaser_name, region_name, notice_type, url, keyword, status, created_at FROM tenders WHERE ${where} ORDER BY publish_date DESC LIMIT ? OFFSET ?`).all(...params, pageSize, offset);

  res.json({ items, total, page, page_size: pageSize });
});

tenderRouter.patch('/admin/tenders/:id', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  const db = getDatabase();
  const existing = db.prepare('SELECT id FROM tenders WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const allowed = ['title', 'purchaser_name', 'budget_amount', 'region_name', 'notice_type', 'publish_date', 'url', 'content_text', 'contact_name', 'contact_phone'];
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      db.prepare(`UPDATE tenders SET ${key} = ? WHERE id = ?`).run(req.body[key], req.params.id);
    }
  }
  res.json({ success: true });
});

tenderRouter.delete('/admin/tenders/:id', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  const db = getDatabase();
  db.prepare('DELETE FROM tender_recommendations WHERE tender_id = ?').run(req.params.id);
  db.prepare('DELETE FROM tenders WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ==================== Admin: Separate Extract Endpoint ====================

tenderRouter.post('/admin/extract', async (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  const { tenderIds, force } = req.body;

  if (!tenderIds || !Array.isArray(tenderIds) || tenderIds.length === 0) {
    return res.status(400).json({ error: 'tenderIds array is required' });
  }

  if (crawlTaskStatus.status === 'crawling' || crawlTaskStatus.status === 'extracting' || crawlTaskStatus.status === 'recommending') {
    return res.status(409).json({ error: '已有任务在运行中' });
  }

  res.json({ status: 'started', message: 'Extract started in background' });

  const adminUserId = req.user!.id;
  const db = getDatabase();

  crawlTaskStatus = {
    status: 'extracting',
    step: 'ai-extract',
    message: `AI 结构化提取中 (${tenderIds.length} 条)...`,
    current: 0,
    total: tenderIds.length,
    startedAt: new Date().toISOString(),
    logs: [],
  };

  try {
    // If force, clear ai_extracted field so it gets re-processed
    if (force) {
      const placeholders = tenderIds.map(() => '?').join(',');
      db.prepare(`UPDATE tenders SET ai_extracted = NULL WHERE id IN (${placeholders})`).run(...tenderIds);
      crawlLog(`强制模式：已清除 ${tenderIds.length} 条标讯的提取数据`);
    }

    const extracted = await runAIExtractForTenders(tenderIds, adminUserId, crawlLog);
    crawlLog(`AI 提取完成: ${extracted} 条已处理`);

    // Update status to 'extracted' for successfully extracted tenders
    const placeholders = tenderIds.map(() => '?').join(',');
    db.prepare(`UPDATE tenders SET status = 'extracted' WHERE id IN (${placeholders}) AND ai_extracted IS NOT NULL AND ai_extracted != ''`).run(...tenderIds);

    crawlTaskStatus.status = 'completed';
    crawlTaskStatus.message = `AI 提取完成：${extracted} 条已处理`;
    crawlTaskStatus.completedAt = new Date().toISOString();
    crawlLog(`全部完成：${extracted} 条标讯已提取`);
  } catch (e: any) {
    crawlLog(`错误: ${e.message}`);
    crawlTaskStatus.status = 'failed';
    crawlTaskStatus.error = e.message;
    crawlTaskStatus.message = `失败：${e.message}`;
    crawlTaskStatus.completedAt = new Date().toISOString();
  }
});

// ==================== Admin: Separate Recommend Endpoint ====================

tenderRouter.post('/admin/recommend', async (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  const { tenderIds, userId, force } = req.body;

  if (crawlTaskStatus.status === 'crawling' || crawlTaskStatus.status === 'extracting' || crawlTaskStatus.status === 'recommending') {
    return res.status(409).json({ error: '已有任务在运行中' });
  }

  res.json({ status: 'started', message: 'Recommendation started in background' });

  const db = getDatabase();

  crawlTaskStatus = {
    status: 'recommending',
    step: 'recommend',
    message: `为用户计算推荐评分中...`,
    current: 0,
    total: tenderIds?.length || 0,
    startedAt: new Date().toISOString(),
    logs: [],
  };

  try {
    // If force, delete existing recommendations for those tenders
    if (force && tenderIds && tenderIds.length > 0) {
      const placeholders = tenderIds.map(() => '?').join(',');
      if (userId) {
        db.prepare(`DELETE FROM tender_recommendations WHERE tender_id IN (${placeholders}) AND user_id = ?`).run(...tenderIds, userId);
        crawlLog(`强制模式：已删除 ${tenderIds.length} 条标讯对指定用户的推荐记录`);
      } else {
        db.prepare(`DELETE FROM tender_recommendations WHERE tender_id IN (${placeholders})`).run(...tenderIds);
        crawlLog(`强制模式：已删除 ${tenderIds.length} 条标讯的全部推荐记录`);
      }
    }

    let scored = 0;
    const result = await runRecommendationsForAllUsers(tenderIds, (msg, detail) => {
      crawlLog(msg, detail);
      if (msg.includes('→')) scored++;
      crawlTaskStatus.current = scored;
    }, userId);
    crawlLog(`推荐计算完成: ${result.processed} 条评分，涉及 ${result.users} 个用户`);

    // Update status to 'scored' for processed tenders
    if (tenderIds && tenderIds.length > 0) {
      const placeholders = tenderIds.map(() => '?').join(',');
      db.prepare(`UPDATE tenders SET status = 'scored' WHERE id IN (${placeholders})`).run(...tenderIds);
    }

    crawlTaskStatus.status = 'completed';
    crawlTaskStatus.message = `推荐计算完成：${result.processed} 条评分`;
    crawlTaskStatus.completedAt = new Date().toISOString();
    crawlLog(`全部完成：${result.processed} 条评分`);
  } catch (e: any) {
    crawlLog(`错误: ${e.message}`);
    crawlTaskStatus.status = 'failed';
    crawlTaskStatus.error = e.message;
    crawlTaskStatus.message = `失败：${e.message}`;
    crawlTaskStatus.completedAt = new Date().toISOString();
  }
});

// ==================== Admin: Drafts List ====================

tenderRouter.get('/admin/drafts', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  const db = getDatabase();
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const pageSize = Math.min(100, parseInt(req.query.page_size as string) || 20);
  const offset = (page - 1) * pageSize;
  const status = (req.query.status as string) || '';
  const draftPlatform = (req.query.platform as string) || '';
  const draftKeyword = (req.query.keyword as string) || '';

  let where = "status = 'draft'";
  const params: any[] = [];

  if (draftPlatform) {
    where += ' AND platform = ?';
    params.push(draftPlatform);
  }
  if (draftKeyword) {
    where += ' AND keyword = ?';
    params.push(draftKeyword);
  }

  const total = (db.prepare(`SELECT COUNT(*) as count FROM tenders WHERE ${where}`).get(...params) as any).count;
  const items = db.prepare(`
    SELECT id, platform, title, publish_date, budget_amount, purchaser_name, region_name, notice_type, url, keyword, status, content_text, contact_name, contact_phone, created_at
    FROM tenders WHERE ${where}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, pageSize, offset);

  res.json({ items, total, page, page_size: pageSize });
});

// ==================== Admin: Users List (for scoring selector) ====================

tenderRouter.get('/admin/users', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  const db = getDatabase();
  const users = db.prepare('SELECT id, username FROM user ORDER BY username').all();
  res.json(users);
});

tenderRouter.get('/keywords-used', (req, res) => {
  const db = getDatabase();
  const rows = db.prepare("SELECT DISTINCT keyword FROM tenders WHERE keyword IS NOT NULL AND keyword != '' ORDER BY keyword").all() as any[];
  res.json(rows.map(r => r.keyword));
});

tenderRouter.get('/admin/stats', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  const db = getDatabase();

  const totalTenders = (db.prepare('SELECT COUNT(*) as count FROM tenders').get() as any).count;
  const todayTenders = (db.prepare("SELECT COUNT(*) as count FROM tenders WHERE created_at >= date('now')").get() as any).count;
  const totalRecommendations = (db.prepare('SELECT COUNT(*) as count FROM tender_recommendations').get() as any).count;
  const platforms = db.prepare('SELECT platform, COUNT(*) as count FROM tenders GROUP BY platform').all();

  res.json({ totalTenders, todayTenders, totalRecommendations, platforms });
});
