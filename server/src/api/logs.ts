import { Router, Request, Response } from 'express';
import { getDatabase } from '../db/index.js';

export const logsRouter = Router();

logsRouter.get('/', (req: Request, res: Response) => {
  const { source, limit = '50', offset = '0', date_from, date_to, provider_owner, model, user_id } = req.query;

  const db = getDatabase();
  // 列表故意不取 request_body/response_body（可能几十KB），避免一次拉一屏就把响应撑爆；全文走 /logs/:id。
  const LIST_COLS =
    'id, source, operation, model, input_tokens, output_tokens, total_tokens, duration_ms, request_summary, user_id, provider_id, provider_owner, created_at';
  let sql = `SELECT ${LIST_COLS} FROM ai_logs WHERE 1=1`;
  const params: unknown[] = [];

  const isAdmin = req.user!.role === 'admin';

  // Non-admin users can only see their own logs
  if (!isAdmin) {
    sql += ' AND user_id = ?';
    params.push(req.user!.id);
  } else if (user_id) {
    // 按用户筛选只对管理员开放——非管理员那条分支已经把 user_id 钉死成自己了，
    // 若在这里也接受 user_id 参数，等于给了越权读别人日志的入口。
    sql += ' AND user_id = ?';
    params.push(user_id);
  }

  if (source) {
    sql += ' AND source = ?';
    params.push(source);
  }
  if (model) {
    sql += ' AND model = ?';
    params.push(model);
  }
  if (provider_owner === 'platform') {
    // 老日志（052 迁移之前）没有这一列，语义上都是平台调用，要一起算进来。
    sql += " AND (provider_owner = 'platform' OR provider_owner IS NULL)";
  } else if (provider_owner === 'dedicated') {
    sql += " AND provider_owner = 'dedicated'";
  }
  if (date_from) {
    sql += ' AND created_at >= ?';
    params.push(date_from);
  }
  if (date_to) {
    sql += ' AND created_at <= ?';
    params.push(date_to);
  }

  const countSql = sql.replace(`SELECT ${LIST_COLS}`, 'SELECT COUNT(*) as count');
  const total = db.prepare(countSql).get(...params) as { count: number };

  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(Number(limit), Number(offset));

  const logs = db.prepare(sql).all(...params);

  res.json({ logs, total: total.count });
});

logsRouter.get('/stats', (req: Request, res: Response) => {
  const { days = '7' } = req.query;
  const db = getDatabase();

  const since = new Date();
  since.setDate(since.getDate() - Number(days));
  const sinceStr = since.toISOString();

  const userFilter = req.user!.role !== 'admin' ? ' AND user_id = ?' : '';
  const userParam = req.user!.role !== 'admin' ? [req.user!.id] : [];

  const bySource = db.prepare(`
    SELECT source, COUNT(*) as count, SUM(total_tokens) as tokens
    FROM ai_logs WHERE created_at >= ?${userFilter}
    GROUP BY source
  `).all(sinceStr, ...userParam);

  const byDay = db.prepare(`
    SELECT DATE(created_at) as day, COUNT(*) as count, SUM(total_tokens) as tokens
    FROM ai_logs WHERE created_at >= ?${userFilter}
    GROUP BY DATE(created_at)
    ORDER BY day
  `).all(sinceStr, ...userParam);

  const total = db.prepare(`
    SELECT COUNT(*) as count, SUM(total_tokens) as tokens, SUM(input_tokens) as input_tokens, SUM(output_tokens) as output_tokens
    FROM ai_logs WHERE created_at >= ?${userFilter}
  `).get(sinceStr, ...userParam);

  res.json({ bySource, byDay, total, days: Number(days) });
});

/**
 * 筛选项的可选值，从实际日志里取（而不是前端写死一份枚举）。
 * 写死的枚举会漏掉新模块——admin/AILogs.vue 里那份 sources 常量就已经漏了 tender。
 * 同样必须放在 /:id 之前。
 */
logsRouter.get('/filters', (req: Request, res: Response) => {
  const db = getDatabase();
  const isAdmin = req.user!.role === 'admin';
  const where = isAdmin ? '' : ' WHERE user_id = ?';
  const p = isAdmin ? [] : [req.user!.id];

  const col = (name: string) =>
    (db.prepare(`SELECT DISTINCT ${name} as v FROM ai_logs${where} ORDER BY v`).all(...p) as { v: string | null }[])
      .map((r) => r.v)
      .filter((v): v is string => !!v);

  res.json({
    sources: col('source'),
    models: col('model'),
    // 用户下拉只给管理员：普通用户只能看自己的日志，列出全站用户名毫无意义且泄露信息。
    users: isAdmin
      ? db.prepare(`
          SELECT u.id, u.username FROM user u
          WHERE EXISTS (SELECT 1 FROM ai_logs l WHERE l.user_id = u.id)
          ORDER BY u.username
        `).all()
      : [],
  });
});

// 单条完整详情：含完整请求 messages 与模型完整返回。非管理员只能看自己的。
// 注意：必须放在 /stats 之后，否则 /:id 会先匹配走 stats。
logsRouter.get('/:id', (req: Request, res: Response) => {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM ai_logs WHERE id = ?').get(req.params.id) as
    | { user_id: string | null }
    | undefined;
  if (!row) return res.status(404).json({ error: 'not found' });
  if (req.user!.role !== 'admin' && row.user_id !== req.user!.id) {
    return res.status(403).json({ error: 'forbidden' });
  }
  res.json({ log: row });
});
