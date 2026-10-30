import { Router } from 'express';
import { QuotaExceededError } from '../core/llm/gateway.js';
import { requireAdmin } from '../auth/guards.js';
import { planCards, BrollError, MAX_LINES, MAX_CHARS, type PlanLine } from '../services/broll/planService.js';
import { listTemplateStatus, setTemplateStatus, TEMPLATE_ID } from '../services/broll/templateStatus.js';
import { holdPoints, settlePoints, releasePoints, POINT_PRICE, PointsExhaustedError } from '../services/appKeyService.js';
import { exportCard, exportTimeline, BrollExportError, MAX_SECONDS, MAX_TIMELINE_SECONDS, MAX_PNG_TIMELINE_SECONDS } from '../services/broll/exportService.js';

// 口播动效卡。口播视频和字幕时间都留在前端，这里只收「编号 + 原文」。
export const brollRouter = Router();

// GET /api/broll/templates → { status: { number: 'live', … } }（没列出的 = 草稿）
brollRouter.get('/templates', (_req, res) => {
  res.json({ status: listTemplateStatus() });
});

// PUT /api/broll/templates/:id  { status: 'draft' | 'live' }（管理员）
brollRouter.put('/templates/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const status = req.body?.status;
  if (!TEMPLATE_ID.test(id)) return res.status(400).json({ error: `模版编号「${id}」不合法` });
  if (status !== 'draft' && status !== 'live') return res.status(400).json({ error: 'status 只能是 draft 或 live' });
  setTemplateStatus(id, status);
  res.json({ id, status });
});

// POST /api/broll/plan  { lines: [{ id, text }] } → { cards, rejected }
brollRouter.post('/plan', async (req, res, next) => {
  const raw = Array.isArray(req.body?.lines) ? req.body.lines : null;
  if (!raw?.length) return res.status(400).json({ error: '先导入字幕' });
  const lines: PlanLine[] = raw.map((l: any) => ({ id: Number(l?.id), text: String(l?.text ?? '').trim() }));
  if (lines.some((l) => !Number.isInteger(l.id) || !l.text)) return res.status(400).json({ error: '字幕格式不对：每句要有整数编号和文字' });
  if (new Set(lines.map((l) => l.id)).size !== lines.length) return res.status(400).json({ error: '字幕编号有重复' });
  if (lines.length > MAX_LINES) return res.status(400).json({ error: `字幕最多 ${MAX_LINES} 句，现在是 ${lines.length} 句` });
  const chars = lines.reduce((n, l) => n + l.text.length, 0);
  if (chars > MAX_CHARS) return res.status(400).json({ error: `字幕最多 ${MAX_CHARS} 字，现在是 ${chars} 字` });

  // 只把已上线的模版交给 AI —— 只在前端过滤的话，调试台里下线了的卡用户照样能一键配出来
  const live = Object.entries(listTemplateStatus()).filter(([, s]) => s === 'live').map(([id]) => id);

  try {
    res.json(await planCards({ lines, userId: req.user!.id, live }));
  } catch (e: any) {
    if (e instanceof BrollError) return res.status(e.status).json({ error: e.message });
    if (e instanceof QuotaExceededError) {
      return res.status(429).json({
        error: 'quota_exceeded', remaining: 0, daily_limit: e.dailyLimit, app: e.app, detail: e.message,
      });
    }
    if (['DedicatedChannelError', 'NoThinkingUnsupportedError', 'PointsExhaustedError'].includes(e?.name)) return next(e);
    // 其余多半是上游原文（模型名不对 / 余额不足 / 超时）：透出去，兜成通用错误会指错方向。
    res.status(502).json({ error: `AI 服务调用失败：${e?.message || e}` });
  }
});

/**
 * 售卖型 key 每次导出冻结 5 点（不看时长），导出成功才结算、失败解冻；账号用户不扣（和 ppt 一致）。
 * 冻结放在参数校验之后：参数错的请求不该先冻住再解。点数不足是 402，和别处的 PointsExhaustedError 同一句话。
 */
async function charged(req: any, res: any, operation: string, run: () => Promise<{ buffer: Buffer; notes: string[] }>) {
  let hold;
  try {
    hold = holdPoints(req.user?.id, POINT_PRICE.brollExport);
  } catch (e) {
    if (e instanceof PointsExhaustedError) return res.status(402).json({ error: e.message, code: 'points_exhausted' });
    throw e;
  }
  try {
    const r = await run();
    settlePoints(hold, operation);
    res.setHeader('Content-Type', 'video/quicktime');
    res.setHeader('X-Broll-Notes', encodeURIComponent(JSON.stringify(r.notes)));
    res.setHeader('Access-Control-Expose-Headers', 'X-Broll-Notes');
    res.send(r.buffer);
  } catch (e: any) {
    releasePoints(hold);
    if (e instanceof BrollExportError) return res.status(e.status).json({ error: e.message });
    res.status(500).json({ error: `导出失败：${e?.message || e}` });
  }
}

// POST /api/broll/export  { aspect, theme, format?: 'png'|'hevc', card: { template, data, duration, x, y, s } } → 透明 .mov
// 不调 AI；key 用户扣 5 点（见 charged）。提示（服务器上缺字体之类）放在 X-Broll-Notes 头里（JSON，encodeURIComponent 过）。
brollRouter.post('/export', async (req, res) => {
  const b = req.body || {};
  const card = b.card || {};
  const aspect = b.aspect === '9:16' ? '9:16' : b.aspect === '16:9' ? '16:9' : null;
  if (!aspect) return res.status(400).json({ error: 'aspect 只能是 16:9 或 9:16' });
  if (typeof b.theme !== 'string' || !b.theme) return res.status(400).json({ error: '缺 theme' });
  if (!TEMPLATE_ID.test(String(card.template || ''))) return res.status(400).json({ error: '缺卡片类型' });
  const duration = Number(card.duration);
  if (!Number.isFinite(duration) || duration <= 0) return res.status(400).json({ error: '卡片时长不对' });
  if (duration > MAX_SECONDS) return res.status(400).json({ error: `单张卡最长导出 ${MAX_SECONDS} 秒，这张是 ${duration.toFixed(1)} 秒` });
  const num = (v: unknown, d: number) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const format = b.format === 'hevc' ? 'hevc' : b.format === 'png' || b.format == null ? 'png' : null;
  if (!format) return res.status(400).json({ error: `不支持的导出格式「${b.format}」，只有 png / hevc` });
  await charged(req, res, 'broll:export', () => exportCard({
    aspect, theme: b.theme, format,
    card: { template: card.template, data: card.data || {}, duration, x: num(card.x, 0.05), y: num(card.y, 0.18), s: num(card.s, 1) },
  }));
});

// POST /api/broll/export-all  { aspect, theme, format, total, cards: [{ template, data, start, end, x, y, s, track }] }
// → 和口播等长的整条透明叠加层，从 0 秒对齐放到口播上面一轨即可。
brollRouter.post('/export-all', async (req, res) => {
  const b = req.body || {};
  const aspect = b.aspect === '9:16' ? '9:16' : b.aspect === '16:9' ? '16:9' : null;
  if (!aspect) return res.status(400).json({ error: 'aspect 只能是 16:9 或 9:16' });
  if (typeof b.theme !== 'string' || !b.theme) return res.status(400).json({ error: '缺 theme' });
  const format = b.format === 'hevc' ? 'hevc' : b.format === 'png' || b.format == null ? 'png' : null;
  if (!format) return res.status(400).json({ error: `不支持的导出格式「${b.format}」，只有 png / hevc` });
  const total = Number(b.total);
  if (!Number.isFinite(total) || total <= 0) return res.status(400).json({ error: '总时长不对' });
  if (total > MAX_TIMELINE_SECONDS) return res.status(400).json({ error: `整条最长导出 ${MAX_TIMELINE_SECONDS / 60} 分钟，这条是 ${(total / 60).toFixed(1)} 分钟` });
  if (format === 'png' && total > MAX_PNG_TIMELINE_SECONDS) {
    return res.status(400).json({ error: `整条 ${Math.round(total)} 秒导成 PNG 透明 MOV 文件太大、剪映预览会卡 —— 超过 ${MAX_PNG_TIMELINE_SECONDS / 60} 分钟请选 HEVC 透明，或者一张张导单张卡` });
  }
  const raw = Array.isArray(b.cards) ? b.cards : [];
  if (!raw.length) return res.status(400).json({ error: '时间轴上还没有卡' });
  const num = (v: unknown, d: number) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const cards = raw.map((c: any, i: number) => ({
    id: i + 1, template: String(c?.template || ''), data: c?.data || {}, track: num(c?.track, 0),
    start: num(c?.start, 0), end: num(c?.end, 0), duration: num(c?.end, 0) - num(c?.start, 0),
    x: num(c?.x, 0.05), y: num(c?.y, 0.18), s: num(c?.s, 1),
  }));
  const bad = cards.find((c: any) => !TEMPLATE_ID.test(c.template) || !(c.end > c.start));
  if (bad) return res.status(400).json({ error: `第 ${bad.id} 张卡的类型或时间不对` });
  const navRaw = Array.isArray(b.nav?.chapters) ? b.nav.chapters : [];
  const nav = navRaw.length
    ? { chapters: navRaw.slice(0, 20).map((c: any) => ({ index: String(c?.index ?? '').slice(0, 4), label: String(c?.label ?? '').slice(0, 20), start: num(c?.start, 0) })) }
    : null;
  await charged(req, res, 'broll:export-all', () => exportTimeline({ aspect, theme: b.theme, format, total, cards, nav }));
});
