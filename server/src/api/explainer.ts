import { Router } from 'express';
import { QuotaExceededError } from '../core/llm/gateway.js';
import { holdPoints, settlePoints, releasePoints, POINT_PRICE, PointsExhaustedError } from '../services/appKeyService.js';
import { strokesFor, MAX_STROKE_CHARS } from '../services/explainer/strokes.js';
import { writeScript, ExplainerError, DURATIONS, MAX_PROMPT_CHARS, MAX_SHOTS, STYLE_IDS, isStyle, type StyleId, type Script } from '../services/explainer/scriptService.js';
import { LAYOUTS, ROLES } from '../services/explainer/vocab.js';
import { writeScene } from '../services/explainer/sceneService.js';
import { exportBusy } from '../services/explainer/exportService.js';
import { startExport, getJob } from '../services/explainer/exportJobs.js';

// 代码动画视频（白板讲解 / 蓝图）。画面在前端按场景 JSON 画，服务端这里只给静态数据和（后面几片的）AI 剧本 / 导出。
export const explainerRouter = Router();

// GET /api/explainer/strokes?chars=手机怎么 → { strokes: { 手: [[[x,y],…],…] }, missing: [] }
// 公开：导出用的渲染页是无头浏览器打开的，不带登录；这里只有开源字库数据，不调 AI。
explainerRouter.get('/strokes', async (req, res) => {
  const chars = [...String(req.query.chars ?? '')];
  if (!chars.length) return res.status(400).json({ error: '缺 chars' });
  if (chars.length > MAX_STROKE_CHARS) return res.status(400).json({ error: `一次最多查 ${MAX_STROKE_CHARS} 个字，现在是 ${chars.length} 个` });
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.json(await strokesFor(chars));
});

// POST /api/explainer/script  { style, prompt, duration } → { script, notes }
// PROTECTED，扣 1 次日额度（应用 explainer）。不落库：剧本存在用户浏览器里。
explainerRouter.post('/script', async (req, res, next) => {
  const b = req.body || {};
  const style = isStyle(b.style) ? b.style : null;
  if (!style) return res.status(400).json({ error: `style 只能是 ${STYLE_IDS.join(' / ')}` });
  const prompt = String(b.prompt ?? '').trim();
  if (!prompt) return res.status(400).json({ error: '先写一下视频要讲什么' });
  if ([...prompt].length > MAX_PROMPT_CHARS) return res.status(400).json({ error: `内容最多 ${MAX_PROMPT_CHARS} 字，现在是 ${[...prompt].length} 字` });
  const duration = Number(b.duration);
  if (!(DURATIONS as readonly number[]).includes(duration)) return res.status(400).json({ error: `时长只能选 ${DURATIONS.join(' / ')} 秒` });
  await respond(res, next, () => writeScript({ style, prompt, duration, userId: req.user!.id }));
});

async function respond(res: any, next: any, run: () => Promise<unknown>) {
  try {
    res.json(await run());
  } catch (e: any) {
    if (e instanceof ExplainerError) return res.status(e.status).json({ error: e.message });
    if (e instanceof QuotaExceededError) {
      return res.status(429).json({ error: 'quota_exceeded', remaining: 0, daily_limit: e.dailyLimit, app: e.app, detail: e.message });
    }
    if (['DedicatedChannelError', 'NoThinkingUnsupportedError', 'PointsExhaustedError'].includes(e?.name)) return next(e);
    // 其余多半是上游原文（模型名不对 / 余额不足 / 超时）：透出去，兜成通用错误会指错方向。
    res.status(502).json({ error: `AI 服务调用失败：${e?.message || e}` });
  }
}

/**
 * 浏览器里改过的剧本：格式不对直接 400 并说清是哪一镜哪一项，不悄悄截断（他在页面上改的字被截了也不会知道）。
 * 上限比 AI 那一步宽（页面上允许改长一点，画面会缩字号并提示）。
 */
function readScript(b: any): Script | string {
  const s = b?.script;
  if (!s || typeof s !== 'object') return '缺剧本';
  if (!isStyle(s.style)) return `style 只能是 ${STYLE_IDS.join(' / ')}`;
  if (!(DURATIONS as readonly number[]).includes(Number(s.duration))) return `时长只能选 ${DURATIONS.join(' / ')} 秒`;
  if (!Array.isArray(s.shots) || !s.shots.length) return '剧本里没有镜头';
  if (s.shots.length > MAX_SHOTS) return `最多 ${MAX_SHOTS} 镜，现在是 ${s.shots.length} 镜`;
  const len = (v: unknown) => [...String(v ?? '')].length;
  for (const [i, sh] of s.shots.entries()) {
    const at = `第 ${i + 1} 镜`;
    if (len(sh?.heading) > 30) return `${at}标题超过 30 字`;
    if (len(sh?.visual) > 200) return `${at}画面描述超过 200 字`;
    if (len(sh?.note) > 40) return `${at}注释超过 40 字`;
    if (!Array.isArray(sh?.elements) || sh.elements.length > 6) return `${at}要画的元素最多 6 个`;
    if (sh.elements.some((e: unknown) => len(e) > 16)) return `${at}有元素名超过 16 字`;
  }
  return {
    title: String(s.title ?? '').trim().slice(0, 20), summary: String(s.summary ?? '').trim().slice(0, 120), style: s.style, duration: Number(s.duration),
    shots: s.shots.map((sh: any) => ({
      seconds: Number(sh.seconds) > 0 ? Math.min(30, Number(sh.seconds)) : 5,
      heading: String(sh.heading ?? '').trim(), visual: String(sh.visual ?? '').trim(), note: String(sh.note ?? '').trim(),
      elements: sh.elements.map((e: unknown) => String(e ?? '').trim()).filter(Boolean),
      // 叙事角色 / 版式：剧本页能改，认得的才带上（不认得的不报 400：老草稿里没有这两项）
      ...((ROLES as readonly string[]).includes(sh.role) ? { role: sh.role } : {}),
      ...((LAYOUTS as readonly string[]).includes(sh.layout) ? { layout: sh.layout } : {}),
    })),
    ...(s.treatment && typeof s.treatment === 'object' ? {
      treatment: {
        hook: String(s.treatment.hook ?? '').slice(0, 80), turn: String(s.treatment.turn ?? '').slice(0, 80), ending: String(s.treatment.ending ?? '').slice(0, 80),
        structure: (Array.isArray(s.treatment.structure) ? s.treatment.structure : []).slice(0, 8).map((x: unknown) => String(x ?? '').slice(0, 60)),
      },
    } : {}),
  };
}

// POST /api/explainer/scene  { script } → { scene, notes }
// PROTECTED，扣 1 次日额度。剧本 → 场景 JSON（每镜画哪些图标 / 文字 / 清单、谁指向谁）；坐标和时间由前端编译时算。
explainerRouter.post('/scene', async (req, res, next) => {
  const script = readScript(req.body);
  if (typeof script === 'string') return res.status(400).json({ error: script });
  await respond(res, next, () => writeScene({ script, userId: req.user!.id }));
});

/**
 * 浏览器传上来的场景（AI 生成后可能在页面上存过好几天）：格式不对 400 并说清哪一镜哪一项。
 * 这里只核「渲染页画得出来」需要的形状；图标名不在库里不拦（渲染页编译时画问号框，并在 notes 里报）。
 */
function readScene(b: any): { scene: any; style: StyleId } | string {
  const style = isStyle(b?.style) ? b.style : null;
  if (!style) return `style 只能是 ${STYLE_IDS.join(' / ')}`;
  const sc = b?.scene;
  if (!sc || sc.version !== 1 || !Array.isArray(sc.shots)) return '场景数据不对（缺 version / shots），重新生成一次画面';
  if (!(DURATIONS as readonly number[]).includes(Number(sc.duration))) return `时长只能是 ${DURATIONS.join(' / ')} 秒`;
  if (!sc.shots.length || sc.shots.length > MAX_SHOTS) return `镜头数要在 1–${MAX_SHOTS} 之间，现在是 ${sc.shots.length}`;
  const len = (v: unknown) => [...String(v ?? '')].length;
  for (const [i, sh] of sc.shots.entries()) {
    const at = `第 ${i + 1} 镜`;
    if (!Array.isArray(sh?.items) || sh.items.length > 6) return `${at}的元素要是 0–6 个`;
    if (len(sh.heading) > 30 || len(sh.note) > 40) return `${at}的标题或注释太长`;
    for (const it of sh.items) {
      if (!['icon', 'text', 'list', 'diagram'].includes(it?.type) || typeof it?.id !== 'string') return `${at}有一个元素格式不对`;
      if (it.type === 'diagram') {
        const n = (v: unknown, lo: number, hi: number) => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
        const ok = it.kind === 'dots' ? n(it.count, 1, 20)
          : it.kind === 'tenframe' ? n(it.filled, 0, 10)
          : it.kind === 'equation' ? typeof it.text === 'string' && len(it.text) <= 16
          : it.kind === 'shape' ? ['circle', 'box', 'triangle'].includes(it.shape)
          : it.kind === 'numberline' ? Number.isInteger(it.from) && Number.isInteger(it.to) && it.to > it.from && it.to - it.from <= 20
          : false;
        if (!ok) return `${at}有一个图示（${it.kind}）参数不对，重新生成一次画面`;
      }
      if (it.type === 'list' && (!Array.isArray(it.items) || it.items.length > 6)) return `${at}的清单格式不对`;
      if (len(it.text) > 40 || len(it.label) > 20) return `${at}有元素的字太长`;
    }
    if (sh.arrows != null && (!Array.isArray(sh.arrows) || sh.arrows.length > 10)) return `${at}的箭头格式不对`;
    if (sh.layout != null && !(LAYOUTS as readonly string[]).includes(sh.layout)) return `${at}的版式「${sh.layout}」不认识`;
    if (sh.beats != null && (!Array.isArray(sh.beats) || sh.beats.length > 4)) return `${at}的讲解动作格式不对`;
  }
  return { scene: sc, style };
}

// POST /api/explainer/export  { scene, style } → 202 { id }（后台任务，进度 / 下载见下面两条）
// PROTECTED，不调 AI；售卖型 key（EXP-…）每次导出扣 5 点：参数校验之后冻结、成功才结算、任何失败解冻（有测试），账号用户不扣。
explainerRouter.post('/export', async (req, res) => {
  const spec = readScene(req.body);
  if (typeof spec === 'string') return res.status(400).json({ error: spec });
  if (exportBusy()) return res.status(429).json({ error: '已经有一个视频在导出（这一步很吃 CPU，一次只导一个）—— 等它完成再点' });
  let hold: ReturnType<typeof holdPoints>;
  try {
    hold = holdPoints(req.user?.id, POINT_PRICE.explainerExport);
  } catch (e) {
    if (e instanceof PointsExhaustedError) return res.status(402).json({ error: e.message, code: 'points_exhausted' });
    throw e;
  }
  const job = startExport(spec, req.user!.id, (ok) => (ok ? settlePoints(hold, 'explainer:export') : releasePoints(hold)));
  res.status(202).json({ id: job.id, total: job.total });
});

// GET /api/explainer/export/:id → { state: 'running'|'done'|'failed', done, total, notes, error? }
// 只有发起人看得到；服务重启后任务就没了（如实回 404，不回「还在导」）。
explainerRouter.get('/export/:id', (req, res) => {
  const j = getJob(req.params.id, req.user!.id);
  if (!j) return res.status(404).json({ error: '找不到这个导出任务（服务器重启过，或者已经过了 30 分钟）—— 重新导出一次' });
  res.json({ state: j.state, done: j.done, total: j.total, notes: j.notes, ...(j.error ? { error: j.error } : {}) });
});

// GET /api/explainer/export/:id/file → video/mp4（导完 30 分钟内可以重复下载）
explainerRouter.get('/export/:id/file', (req, res) => {
  const j = getJob(req.params.id, req.user!.id);
  if (!j) return res.status(404).json({ error: '找不到这个导出任务（服务器重启过，或者已经过了 30 分钟）—— 重新导出一次' });
  if (j.state !== 'done') return res.status(409).json({ error: j.state === 'failed' ? `导出失败：${j.error}` : '还在导出' });
  res.setHeader('Content-Type', 'video/mp4');
  res.sendFile(j.file, (err) => { if (err && !res.headersSent) res.status(500).json({ error: `读不到导出的文件：${err.message}` }); });
});
