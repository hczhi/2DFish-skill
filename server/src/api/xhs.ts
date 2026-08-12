import { Router, type Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../db/index.js';
import { scoreNote, getWeights, setWeight, DIM_KEYS, ScoringParseError, type XhsNoteInput, type XhsGenre } from '../services/xhs/scoringService.js';
import { aiGateway, aiGatewayStream, SAMPLING } from '../core/llm/gateway.js';
import { parseFirstJson, jsonGateway as jsonGatewayWithRetry } from '../core/llm/parseJson.js';
import { getSkillForSlot } from '../services/skillRegistryService.js';
import * as uws from '../services/userWritingSkillService.js';
import * as struct from '../services/xhsStructureService.js';
import { SKILL_TEMPLATES, getSkillTemplate } from '../services/xhs/skillTemplates.js';
import { webSearch, isSearchEnabled } from '../services/webSearchService.js';
import { requireAdmin } from '../auth/guards.js';
import { initSSE } from '../core/http.js';

/**
 * 统一错误处理：把 QuotaExceededError 映射成 429，其余记日志后 500。
 * 流式路由在 headers 已发出后只能 end()，用 streamed=true 走这条分支。
 */
function handleXhsError(res: Response, e: any, op: string, streamed = false): void {
  if (e?.name === 'QuotaExceededError') {
    if (!res.headersSent) res.status(429).json({ error: e.message, dailyLimit: e.dailyLimit });
    else res.end();
    return;
  }
  console.error(`[xhs] ${op} failed:`, e);
  if (!res.headersSent) res.status(500).json({ error: e.message || `${op} failed` });
  else res.end();
}

/**
 * 统一 SSE 流转发：把 gateway 的流逐 delta 写成 `data:{delta}` 事件，末尾 [DONE]，
 * 并把最终文本交给 onDone（用于成本记账、拿全文等）。三个流式路由共用，避免样板重复。
 */
// 导出仅为可测：截断事件是「看起来完全成功」的那一类，手测测不出来。
export async function streamToSSE(
  res: Response,
  stream: AsyncIterable<any>,
  onComplete: (promptTokens: number, completionTokens: number, durationMs: number, outputText?: string) => void
): Promise<string> {
  initSSE(res);
  let output = '';
  let chunks = 0;
  let finish = '';
  const start = Date.now();
  try {
    for await (const chunk of stream) {
      chunks++;
      const delta = chunk.choices[0]?.delta?.content || '';
      if (chunk.choices[0]?.finish_reason) finish = String(chunk.choices[0].finish_reason);
      if (delta) {
        output += delta;
        res.write(`data: ${JSON.stringify({ delta })}\n\n`);
      }
    }
  } catch (e: any) {
    // 上游流中途报错（模型不支持某参数、鉴权、限流…）。以前这里被静默吞掉，
    // 前端收不到任何信号就一直转圈。现在记日志 + 给前端发一个 error 事件让它停。
    console.error(`[xhs] stream error after ${chunks} chunks, ${output.length} chars:`, e?.message || e);
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ error: e?.message || '生成中断' })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    }
    onComplete(0, Math.ceil(output.length / 4), Date.now() - start, output);
    return output;
  }
  // 一个 delta 都没收到：上游多半空返回（如 DashScope 对某参数不兼容）。也要告诉前端，别干等。
  if (!output) {
    console.error(`[xhs] stream produced no content. chunks=${chunks} duration=${Date.now() - start}ms`);
    res.write(`data: ${JSON.stringify({ error: 'AI 返回为空，请重试或检查模型配置' })}\n\n`);
  }
  // 撞上模型输出上限 = 结尾是**断在半句话上**的。这不是错误（前面的内容都是好的），
  // 但也绝不能不说：一篇结尾被截掉的稿子和写完的稿子长得一样，用户会直接采纳/发布。
  // 前端读 `truncated` 自己决定怎么提示（成文那边流着看得见，改写那边会挡在采纳前面）。
  if (finish === 'length') {
    console.warn(`[xhs] stream truncated by max_tokens. chars=${output.length}`);
    res.write(`data: ${JSON.stringify({ truncated: true })}\n\n`);
  }
  res.write('data: [DONE]\n\n');
  res.end();
  // prompt tokens 无法从流里精确拿到，用输出长度粗估补偿（gateway 已扣一次调用额度）
  onComplete(0, Math.ceil(output.length / 4), Date.now() - start, output);
  return output;
}

export const xhsRouter = Router();

// ==================== 草稿 CRUD ====================

// GET /api/xhs/notes  列出我的草稿
xhsRouter.get('/notes', (req, res) => {
  const db = getDatabase();
  const notes = db.prepare(
    `SELECT id, title, body, niche, last_score, published, real_likes, real_collects, real_views, created_at, updated_at
     FROM xhs_notes WHERE user_id = ? ORDER BY updated_at DESC`
  ).all(req.user!.id);
  res.json(notes);
});

// GET /api/xhs/notes/:id  取单篇
xhsRouter.get('/notes/:id', (req, res) => {
  const db = getDatabase();
  const note = db.prepare('SELECT * FROM xhs_notes WHERE id = ? AND user_id = ?').get(req.params.id, req.user!.id);
  if (!note) return res.status(404).json({ error: 'Note not found' });
  res.json(note);
});

// POST /api/xhs/notes  新建草稿
xhsRouter.post('/notes', (req, res) => {
  const { title, body, niche } = req.body || {};
  if (!String(title || '').trim() && !String(body || '').trim()) {
    return res.status(400).json({ error: '标题和正文不能都为空' });
  }
  const db = getDatabase();
  const id = uuidv4();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO xhs_notes (id, user_id, title, body, niche, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, req.user!.id, String(title || ''), String(body || ''), String(niche || ''), now, now);
  res.json({ id, created_at: now });
});

// PUT /api/xhs/notes/:id  保存草稿（含最近一次评分快照）
xhsRouter.put('/notes/:id', (req, res) => {
  const { title, body, niche, last_score, last_dimensions } = req.body || {};
  const db = getDatabase();
  const existing = db.prepare('SELECT id FROM xhs_notes WHERE id = ? AND user_id = ?').get(req.params.id, req.user!.id);
  if (!existing) return res.status(404).json({ error: 'Note not found' });

  db.prepare(
    `UPDATE xhs_notes SET title = ?, body = ?, niche = ?, last_score = ?, last_dimensions = ?, updated_at = ?
     WHERE id = ? AND user_id = ?`
  ).run(
    String(title || ''), String(body || ''), String(niche || ''),
    last_score ?? null,
    JSON.stringify(last_dimensions || {}),
    new Date().toISOString(),
    req.params.id, req.user!.id
  );
  res.json({ success: true });
});

// PATCH /api/xhs/notes/:id/real-data  发布后回填真实数据（回归校准的燃料）
xhsRouter.patch('/notes/:id/real-data', (req, res) => {
  const { real_likes, real_collects, real_views } = req.body || {};
  const db = getDatabase();
  const existing = db.prepare('SELECT id FROM xhs_notes WHERE id = ? AND user_id = ?').get(req.params.id, req.user!.id);
  if (!existing) return res.status(404).json({ error: 'Note not found' });

  // 真实指标必须是非负整数（或留空）。校准的皮尔逊相关全靠这些数，
  // 写进垃圾会让 Number(x) 变 NaN 静默污染统计，所以这里严格清洗。
  const toMetric = (v: any): number | null => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return NaN; // 标记非法
    return Math.round(n);
  };
  const likes = toMetric(real_likes), collects = toMetric(real_collects), views = toMetric(real_views);
  if (Number.isNaN(likes) || Number.isNaN(collects) || Number.isNaN(views)) {
    return res.status(400).json({ error: '点赞/收藏/浏览必须是非负数字' });
  }

  db.prepare(
    `UPDATE xhs_notes SET published = 1, real_likes = ?, real_collects = ?, real_views = ?, updated_at = ?
     WHERE id = ? AND user_id = ?`
  ).run(
    likes, collects, views,
    new Date().toISOString(), req.params.id, req.user!.id
  );
  res.json({ success: true });
});

// DELETE /api/xhs/notes/:id
xhsRouter.delete('/notes/:id', (req, res) => {
  const db = getDatabase();
  db.prepare('DELETE FROM xhs_notes WHERE id = ? AND user_id = ?').run(req.params.id, req.user!.id);
  res.json({ success: true });
});

// POST /api/xhs/feedback  记录用户对建议/评分的反应（"越用越懂你"的燃料）
xhsRouter.post('/feedback', (req, res) => {
  const { note_id, type, dimension, payload } = req.body || {};
  if (!type) return res.status(400).json({ error: 'type is required' });
  const db = getDatabase();
  db.prepare(
    `INSERT INTO xhs_feedback (id, user_id, note_id, type, dimension, payload, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    uuidv4(), req.user!.id, String(note_id || ''), String(type),
    String(dimension || ''), JSON.stringify(payload || {}), new Date().toISOString()
  );
  res.json({ success: true });
});

// ==================== 权重（DB 可配置）====================

// GET /api/xhs/weights  读当前权重
xhsRouter.get('/weights', (_req, res) => {
  res.json(getWeights());
});

// PUT /api/xhs/weights  批量更新权重 { titleHook: 1.5, ... }（全局调优参数，仅管理员）
const MAX_WEIGHT = 10; // 上限：防止单维度权重巨大到把其他维度实质清零
xhsRouter.put('/weights', requireAdmin, (req, res) => {
  const body = req.body || {};
  for (const key of DIM_KEYS) {
    if (body[key] !== undefined) {
      const w = Number(body[key]);
      if (Number.isFinite(w) && w >= 0 && w <= MAX_WEIGHT) setWeight(key, w);
    }
  }
  res.json(getWeights());
});

// ==================== 校准分析 ====================
// GET /api/xhs/calibration
// 返回已回填真实数据的笔记 + 每个维度与真实点赞的相关性（"档次1"分析），
// 用来判断哪个维度真正驱动点赞、当前权重该往哪调。
xhsRouter.get('/calibration', (req, res) => {
  const db = getDatabase();
  const rows = db.prepare(
    `SELECT id, title, last_score, last_dimensions, real_likes, real_collects, real_views, updated_at
     FROM xhs_notes
     WHERE user_id = ? AND published = 1 AND real_likes IS NOT NULL AND last_score IS NOT NULL
     ORDER BY real_likes DESC`
  ).all(req.user!.id) as any[];

  const DIMS = DIM_KEYS;

  // 解析每篇的维度分
  const samples = rows.map((r) => {
    let dims: Record<string, number> = {};
    try {
      const parsed = JSON.parse(r.last_dimensions || '{}');
      for (const k of DIMS) dims[k] = Number(parsed[k]?.score) || 0;
    } catch { /* ignore */ }
    return {
      id: r.id, title: r.title, predictedScore: r.last_score,
      realLikes: r.real_likes, realCollects: r.real_collects, realViews: r.real_views,
      dims,
    };
  });

  // 皮尔逊相关系数：每个维度分 vs 真实点赞
  const likes = samples.map((s) => s.realLikes);
  const correlations: Record<string, number | null> = {};
  for (const k of DIMS) {
    const xs = samples.map((s) => s.dims[k]);
    correlations[k] = samples.length >= 3 ? pearson(xs, likes) : null;
  }

  // 总分 vs 真实点赞的相关性（评分器整体准不准的核心指标）
  const totalCorrelation = samples.length >= 3
    ? pearson(samples.map((s) => s.predictedScore), likes)
    : null;

  res.json({
    sampleCount: samples.length,
    minSamplesForStats: 3,
    totalCorrelation,
    dimensionCorrelations: correlations,
    samples,
  });
});

function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 2) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx, b = ys[i] - my;
    num += a * b; dx += a * a; dy += b * b;
  }
  if (dx === 0 || dy === 0) return null; // 无方差，无法算相关
  return Math.round((num / Math.sqrt(dx * dy)) * 100) / 100;
}

// ==================== 评分 ====================
// POST /api/xhs/score  { title, body, niche?, root? }
xhsRouter.post('/score', async (req, res) => {
  const { title, body, niche, root, genre } = req.body || {};
  if (!String(title || '').trim() && !String(body || '').trim()) {
    return res.status(400).json({ error: 'title or body is required' });
  }

  const note: XhsNoteInput = {
    title: String(title || ''),
    body: String(body || ''),
    niche: niche ? String(niche) : undefined,
    root: root ? String(root) : undefined, // 传了核心判断就多做跑题检测
    genre: genre ? (String(genre) as XhsGenre) : undefined, // 文体：按对应校正评分，防误伤金句/抒情体
  };

  try {
    const result = await scoreNote(note, req.user!.id);
    res.json(result);
  } catch (e: any) {
    // 解析失败明确报 502（不再假装 50 分），与本模块其他 AI 路由契约一致
    if (e instanceof ScoringParseError) {
      return res.status(502).json({ error: e.message, raw: e.raw });
    }
    handleXhsError(res, e, 'score');
  }
});

// ==================== ① 逼问素材 ====================
// POST /api/xhs/interview  { topic, niche? }
// 用户给主题，AI 反问 3-5 个只有本人知道答案的问题，逼出真实素材（去 AI 味最高杠杆的一步）。
xhsRouter.post('/interview', async (req, res) => {
  const { topic, niche } = req.body || {};
  if (!topic || !String(topic).trim()) return res.status(400).json({ error: 'topic is required' });
  try {
    const { response } = await aiGateway(
      { messages: [{ role: 'user', content: uws.buildInterviewPrompt(String(topic), niche ? String(niche) : undefined) }], temperature: 0.7, max_tokens: 1200 },
      { userId: req.user!.id, source: 'xhs', operation: 'interview' }
    );
    const parsed = parseFirstJson(response.choices[0]?.message?.content || '');
    if (!parsed || !Array.isArray(parsed.questions)) {
      return res.status(502).json({ error: 'AI 返回格式异常', raw: response.choices[0]?.message?.content });
    }
    res.json({ questions: parsed.questions });
  } catch (e: any) {
    handleXhsError(res, e, 'interview');
  }
});

// ==================== 炼句台（独立小工具）====================
// POST /api/xhs/punchline  { theme, niche?, angle? }
// 给一个母题，高温批量发散 + 自筛，返回 5 条最意外的金句/双关，供用户挑用。
// 这是 punchline 文体的核心引擎，也可随时对任意主题单独用来找灵感。
xhsRouter.post('/punchline', async (req, res) => {
  const { theme, niche, angle } = req.body || {};
  if (!theme || !String(theme).trim()) return res.status(400).json({ error: 'theme is required' });
  try {
    const { response } = await aiGateway(
      {
        messages: [{
          role: 'user',
          content: uws.buildPunchlinePrompt({
            theme: String(theme),
            niche: niche ? String(niche) : undefined,
            angle: angle ? String(angle) : undefined,
          }),
        }],
        ...SAMPLING.brainstorm,   // 炼句：最高意外度，靠数量博灵感
        max_tokens: 1200,
      },
      { userId: req.user!.id, source: 'xhs', operation: 'punchline' }
    );
    const parsed = parseFirstJson(response.choices[0]?.message?.content || '');
    if (!parsed || !Array.isArray(parsed.lines)) {
      return res.status(502).json({ error: 'AI 返回格式异常', raw: response.choices[0]?.message?.content });
    }
    // 只留有 text 的，规整字段
    const lines = parsed.lines
      .filter((l: any) => l && l.text)
      .map((l: any) => ({ text: String(l.text), twist: String(l.twist || '') }));
    res.json({ lines });
  } catch (e: any) {
    handleXhsError(res, e, 'punchline');
  }
});

// ==================== ② 立根（核心判断）====================
// POST /api/xhs/root  { topic, materials?, niche? }
// 基于主题+真实素材，AI 给 2-3 个非共识核心判断候选，供用户选一个作为全文生成引擎。
xhsRouter.post('/root', async (req, res) => {
  const { topic, materials, niche } = req.body || {};
  if (!topic || !String(topic).trim()) return res.status(400).json({ error: 'topic is required' });
  try {
    const { response } = await aiGateway(
      { messages: [{ role: 'user', content: uws.buildRootPrompt(String(topic), String(materials || ''), niche ? String(niche) : undefined) }], ...SAMPLING.creative, max_tokens: 1500 },
      { userId: req.user!.id, source: 'xhs', operation: 'root' }
    );
    const parsed = parseFirstJson(response.choices[0]?.message?.content || '');
    if (!parsed || !Array.isArray(parsed.roots)) {
      return res.status(502).json({ error: 'AI 返回格式异常', raw: response.choices[0]?.message?.content });
    }
    res.json({ roots: parsed.roots });
  } catch (e: any) {
    handleXhsError(res, e, 'root');
  }
});

// ==================== 结构化写作流程（新）====================
// 主旨：人负责洞察/提问/判断，AI 负责结构化/验证/润色。
// 底层 skill 走 xhs-structure slot（思维方法），用户风格 skill 由 skillId 传入（文字风格）。

/** 取当前用户某个风格 skill 的组装文本；无则 undefined。 */
function resolveStyleSkill(skillId: string | undefined, userId: string): string | undefined {
  if (!skillId) return undefined;
  const skill = uws.getSkill(String(skillId), userId);
  if (!skill) return undefined;
  return uws.assembleSkillBody(String(skillId), userId).assembled || undefined;
}

/** 取当前用户禁用库里的 term 列表（进 prompt 用）。 */
function resolveBlocklistTerms(userId: string): string[] {
  return struct.listBlocklist(userId).map((b) => b.term).filter(Boolean);
}

// POST /api/xhs/structure  五栏 brief → 定主题 + 搭结构（或返回选项式提问）
xhsRouter.post('/structure', async (req, res) => {
  const b = req.body || {};
  const brief: struct.WriterBrief = {
    topic: b.topic ? String(b.topic) : undefined,
    judgment: b.judgment ? String(b.judgment) : undefined,
    materials: b.materials ? String(b.materials) : undefined,
    audience: b.audience ? String(b.audience) : undefined,
    goal: b.goal ? String(b.goal) : undefined,
  };
  if (!brief.topic && !brief.judgment && !brief.materials) {
    return res.status(400).json({ error: '至少填写主题、核心判断或素材之一' });
  }
  try {
    const baseSkill = getSkillForSlot('xhs-structure');
    const { parsed, raw, finish } = await jsonGatewayWithRetry(
      () => ({ messages: [{ role: 'user', content: struct.buildStructurePrompt(brief, baseSkill) }], ...SAMPLING.analytic, response_format: { type: 'json_object' }, max_tokens: 3000 }),
      { userId: req.user!.id, source: 'xhs', operation: 'structure', tier: 'strong' }
    );
    if (!parsed) {
      if (!raw.trim()) return res.status(502).json({ error: 'AI 返回为空，请重试或换用更强的平台模型', finish_reason: finish });
      return res.status(502).json({ error: 'AI 返回格式异常，请重试或换用更强的平台模型', raw });
    }
    if (parsed.needsInput) {
      return res.json({ needsInput: true, questions: Array.isArray(parsed.questions) ? parsed.questions : [] });
    }
    res.json({ needsInput: false, nodes: Array.isArray(parsed.nodes) ? parsed.nodes : [] });
  } catch (e: any) {
    handleXhsError(res, e, 'structure');
  }
});

// POST /api/xhs/structure/node-chat  选中节点 + 消息 → 该节点的局部 patch
xhsRouter.post('/structure/node-chat', async (req, res) => {
  const b = req.body || {};
  const node = b.node;
  const nodes = Array.isArray(b.nodes) ? b.nodes : [];
  const message = String(b.message || '').trim();
  if (!node || !node.id) return res.status(400).json({ error: 'node is required' });
  if (!message) return res.status(400).json({ error: 'message is required' });
  try {
    const baseSkill = getSkillForSlot('xhs-structure');
    const { parsed, raw } = await jsonGatewayWithRetry(
      () => ({ messages: [{ role: 'user', content: struct.buildNodeChatPrompt(node, nodes, message, baseSkill) }], ...SAMPLING.analytic, response_format: { type: 'json_object' }, max_tokens: 2000 }),
      { userId: req.user!.id, source: 'xhs', operation: 'structure-node-chat', tier: 'strong' }
    );
    if (!parsed) return res.status(502).json({ error: 'AI 返回格式异常，请重试', raw });
    res.json({
      reply: parsed.reply || '',
      updateNode: parsed.updateNode || null,
      addNodes: Array.isArray(parsed.addNodes) ? parsed.addNodes : [],
    });
  } catch (e: any) {
    handleXhsError(res, e, 'structure-node-chat');
  }
});

// POST /api/xhs/structure/validate  结构自检 → 问题清单（不打分）
xhsRouter.post('/structure/validate', async (req, res) => {
  const nodes = Array.isArray(req.body?.nodes) ? req.body.nodes : [];
  if (!nodes.length) return res.status(400).json({ error: 'nodes is required' });
  try {
    const baseSkill = getSkillForSlot('xhs-structure');
    const { parsed, raw } = await jsonGatewayWithRetry(
      () => ({ messages: [{ role: 'user', content: struct.buildValidatePrompt(nodes, baseSkill) }], ...SAMPLING.analytic, response_format: { type: 'json_object' }, max_tokens: 1500 }),
      { userId: req.user!.id, source: 'xhs', operation: 'structure-validate', tier: 'strong' }
    );
    if (!parsed) return res.status(502).json({ error: 'AI 返回格式异常，请重试', raw });
    res.json({ ok: !!parsed.ok, issues: Array.isArray(parsed.issues) ? parsed.issues : [] });
  } catch (e: any) {
    handleXhsError(res, e, 'structure-validate');
  }
});

// POST /api/xhs/brainstorm  ① 头脑风暴：选题 → 一批角度各异的观点初稿
xhsRouter.post('/brainstorm', async (req, res) => {
  const b = req.body || {};
  const brief: struct.WriterBrief = {
    topic: b.topic ? String(b.topic) : undefined,
    judgment: b.judgment ? String(b.judgment) : undefined,
    materials: b.materials ? String(b.materials) : undefined,
    audience: b.audience ? String(b.audience) : undefined,
    goal: b.goal ? String(b.goal) : undefined,
  };
  if (!brief.topic && !brief.judgment) {
    return res.status(400).json({ error: '先填一下主题方向或核心观点' });
  }
  try {
    const baseSkill = getSkillForSlot('xhs-structure');
    const { parsed, raw } = await jsonGatewayWithRetry(
      // 要发散但仍需合法 JSON：中高温、不带 penalty（DashScope 流式/JSON 下 penalty 不稳）
      () => ({ messages: [{ role: 'user', content: struct.buildBrainstormPrompt(brief, baseSkill) }], temperature: 0.95, response_format: { type: 'json_object' }, max_tokens: 2000 }),
      { userId: req.user!.id, source: 'xhs', operation: 'brainstorm', tier: 'strong' }
    );
    if (!parsed) return res.status(502).json({ error: 'AI 返回格式异常，请重试', raw });
    res.json({ ideas: Array.isArray(parsed.ideas) ? parsed.ideas : [] });
  } catch (e: any) {
    handleXhsError(res, e, 'brainstorm');
  }
});

// POST /api/xhs/research  ① 用户洞察：选题 → 受众/痛点/盲区/渴望/问题（均为 AI 假设，需作者核实）
xhsRouter.post('/research', async (req, res) => {
  const b = req.body || {};
  const brief: struct.WriterBrief = {
    topic: b.topic ? String(b.topic) : undefined,
    judgment: b.judgment ? String(b.judgment) : undefined,
    materials: b.materials ? String(b.materials) : undefined,
    audience: b.audience ? String(b.audience) : undefined,
    goal: b.goal ? String(b.goal) : undefined,
  };
  if (!brief.topic && !brief.audience && !brief.judgment) {
    return res.status(400).json({ error: '先填一下主题方向、受众或核心观点' });
  }
  try {
    const baseSkill = getSkillForSlot('xhs-structure');
    const { parsed, raw } = await jsonGatewayWithRetry(
      () => ({ messages: [{ role: 'user', content: struct.buildResearchPrompt(brief, baseSkill) }], ...SAMPLING.analytic, response_format: { type: 'json_object' }, max_tokens: 3000 }),
      { userId: req.user!.id, source: 'xhs', operation: 'research', tier: 'strong' }
    );
    if (!parsed) return res.status(502).json({ error: 'AI 返回格式异常，请重试', raw });
    res.json({
      personas: Array.isArray(parsed.personas) ? parsed.personas : [],
      painPoints: Array.isArray(parsed.painPoints) ? parsed.painPoints : [],
      blindSpots: Array.isArray(parsed.blindSpots) ? parsed.blindSpots : [],
      desires: Array.isArray(parsed.desires) ? parsed.desires : [],
      problems: Array.isArray(parsed.problems) ? parsed.problems : [],
    });
  } catch (e: any) {
    handleXhsError(res, e, 'research');
  }
});

// POST /api/xhs/diagnose  ③ 通读诊断：成稿 → 六维度只读建议（不改稿）
xhsRouter.post('/diagnose', async (req, res) => {
  const text = String(req.body?.body || '').trim();
  if (!text) return res.status(400).json({ error: 'body is required' });
  try {
    const baseSkill = getSkillForSlot('xhs-structure');
    const { parsed, raw } = await jsonGatewayWithRetry(
      () => ({ messages: [{ role: 'user', content: struct.buildDiagnosePrompt(text, baseSkill) }], ...SAMPLING.analytic, response_format: { type: 'json_object' }, max_tokens: 2500 }),
      { userId: req.user!.id, source: 'xhs', operation: 'diagnose', tier: 'strong' }
    );
    if (!parsed) return res.status(502).json({ error: 'AI 返回格式异常，请重试', raw });
    res.json({ diagnostics: Array.isArray(parsed.diagnostics) ? parsed.diagnostics : [] });
  } catch (e: any) {
    handleXhsError(res, e, 'diagnose');
  }
});

// POST /api/xhs/write  按确认后的结构树成文（流式）
xhsRouter.post('/write', async (req, res) => {
  const b = req.body || {};
  const nodes = Array.isArray(b.nodes) ? b.nodes : [];
  if (!nodes.length) return res.status(400).json({ error: 'nodes is required' });
  const systemPrompt = struct.buildWriteFromStructurePrompt(nodes, {
    baseSkill: getSkillForSlot('xhs-structure'),
    styleSkill: resolveStyleSkill(b.skillId, req.user!.id),
    persona: b.persona ? String(b.persona) : undefined,
    niche: b.niche ? String(b.niche) : undefined,
    blocklist: resolveBlocklistTerms(req.user!.id),
  });
  try {
    const { stream, onComplete } = await aiGatewayStream(
      {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: '请严格按上面确认的结构树，写出完整的小红书笔记（标题单独一行放最前面）。' },
        ],
        // 用中高温保创造性，但 **不带 presence/frequency_penalty**：DashScope compatible-mode
        // 对 penalty 支持不稳，流式下会空返回/挂起（前端一直转圈）。能跑通的 chat/consultant 流式也都没带 penalty。
        temperature: 0.9,
        max_tokens: 4000,
        stream_options: { include_usage: true },
      },
      { userId: req.user!.id, source: 'xhs', operation: 'write', tier: 'fast' }
    );
    await streamToSSE(res, stream, onComplete);
  } catch (e: any) {
    handleXhsError(res, e, 'write', true);
  }
});

// POST /api/xhs/rewrite  整篇正文 + 诉求（+ 风格 skill）→ 重写后的整篇正文（流式）
//
// 流式而不是像 revise 那样返回 JSON：全文动辄两三千字，非流式就是干等一分钟的白屏。
// 代价是拿不到结构化的「我改了什么」，所以那句说明由前端自己写死。
xhsRouter.post('/rewrite', async (req, res) => {
  const b = req.body || {};
  const fullBody = String(b.body || '').trim();
  const message = String(b.message || '').trim();
  if (!fullBody) return res.status(400).json({ error: 'body is required' });
  if (!message) return res.status(400).json({ error: 'message is required' });
  const systemPrompt = struct.buildRewritePrompt(fullBody, message, {
    styleSkill: resolveStyleSkill(b.skillId, req.user!.id),
    persona: b.persona ? String(b.persona) : undefined,
    niche: b.niche ? String(b.niche) : undefined,
    blocklist: resolveBlocklistTerms(req.user!.id),
  });
  try {
    const { stream, onComplete } = await aiGatewayStream(
      {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: '请按上面的要求重写这篇正文，直接输出正文全文。' },
        ],
        // 温度比成文低一档：这是重写，不是重新创作，跑太开就变成另一篇文章了。
        temperature: 0.8,
        // 输出长度的**下限就是原文长度**（重写不该缩水）。给小了就是结尾被截，
        // 而截断的稿子和写完的稿子长得一样 —— 所以这里给足，并且 streamToSSE
        // 还会在真撞上限时补一个 truncated 事件。
        max_tokens: 10000,
        stream_options: { include_usage: true },
      },
      { userId: req.user!.id, source: 'xhs', operation: 'rewrite', tier: 'fast' }
    );
    await streamToSSE(res, stream, onComplete);
  } catch (e: any) {
    handleXhsError(res, e, 'rewrite', true);
  }
});

// POST /api/xhs/revise  选中正文片段 + 消息 → 该片段的修改建议
xhsRouter.post('/revise', async (req, res) => {
  const b = req.body || {};
  const fullBody = String(b.body || '');
  const selection = String(b.selection || '').trim();
  const message = String(b.message || '').trim();
  if (!selection) return res.status(400).json({ error: 'selection is required' });
  if (!message) return res.status(400).json({ error: 'message is required' });
  try {
    const { parsed, raw } = await jsonGatewayWithRetry(
      () => ({
        messages: [{
          role: 'user',
          content: struct.buildRevisePrompt(fullBody, selection, message, {
            styleSkill: resolveStyleSkill(b.skillId, req.user!.id),
            persona: b.persona ? String(b.persona) : undefined,
            niche: b.niche ? String(b.niche) : undefined,
            blocklist: resolveBlocklistTerms(req.user!.id),
          }),
        }],
        // revise 返回 JSON：用中温但不带 penalty（DashScope 兼容层对 penalty 支持不稳，
        // 且要 json_object 强约束），避免空返回。
        temperature: 0.7,
        response_format: { type: 'json_object' },
        // revise 的契约是把改写后的**整段原样吐回来**（revised 字段），
        // 所以输出长度下限就是选中片段的长度 —— 1500 时选一大段正文必然
        // 撞到 finish_reason=length，JSON 被截在半句话上没有收尾的 `"}`，
        // parseFirstJson 配平不上返回 null，用户看到「AI 返回格式异常，请重试」，
        // 而重试用的是同一个 body，截断是确定性的，第二次一样断（白烧一倍 token）。
        max_tokens: 10000,
      }),
      { userId: req.user!.id, source: 'xhs', operation: 'revise', tier: 'strong' }
    );
    if (!parsed || typeof parsed.revised !== 'string') {
      return res.status(502).json({ error: 'AI 返回格式异常，请重试', raw });
    }
    res.json({ reply: parsed.reply || '', revised: parsed.revised });
  } catch (e: any) {
    handleXhsError(res, e, 'revise');
  }
});

// ==================== 禁用库（账号级全局资产）====================

// GET /api/xhs/blocklist  列出我的禁用表达
xhsRouter.get('/blocklist', (req, res) => {
  res.json(struct.listBlocklist(req.user!.id));
});

// POST /api/xhs/blocklist  新增禁用表达
xhsRouter.post('/blocklist', (req, res) => {
  const { term, kind, note } = req.body || {};
  if (!term || !String(term).trim()) return res.status(400).json({ error: 'term is required' });
  const k = kind === 'phrase' ? 'phrase' : 'word';
  res.json(struct.addBlockItem(req.user!.id, String(term).trim(), k, String(note || '')));
});

// PUT /api/xhs/blocklist/:id  修改
xhsRouter.put('/blocklist/:id', (req, res) => {
  const { term, kind, note } = req.body || {};
  struct.updateBlockItem(req.user!.id, req.params.id, {
    term: term !== undefined ? String(term) : undefined,
    kind: kind === 'word' || kind === 'phrase' ? kind : undefined,
    note: note !== undefined ? String(note) : undefined,
  });
  res.json({ ok: true });
});

// DELETE /api/xhs/blocklist/:id  删除
xhsRouter.delete('/blocklist/:id', (req, res) => {
  struct.deleteBlockItem(req.user!.id, req.params.id);
  res.json({ ok: true });
});

// POST /api/xhs/blocklist/scan  扫描正文里的禁用词命中位置（word 类精确匹配，供前端高亮）
xhsRouter.post('/blocklist/scan', (req, res) => {
  const body = String(req.body?.body || '');
  const items = struct.listBlocklist(req.user!.id).map((b) => ({ term: b.term, kind: b.kind }));
  res.json({ hits: struct.scanBlocklist(body, items) });
});

// ==================== 草稿（新流程持久化）====================

// GET /api/xhs/drafts  列出我的草稿（不含大字段）
xhsRouter.get('/drafts', (req, res) => {
  res.json(struct.listDrafts(req.user!.id));
});

// GET /api/xhs/drafts/:id  取单篇（含 brief/结构/正文）
xhsRouter.get('/drafts/:id', (req, res) => {
  const d = struct.getDraft(req.user!.id, req.params.id);
  if (!d) return res.status(404).json({ error: 'draft not found' });
  res.json(d);
});

// POST /api/xhs/drafts  新建草稿
xhsRouter.post('/drafts', (req, res) => {
  const b = req.body || {};
  res.json(struct.createDraft(req.user!.id, {
    title: b.title ? String(b.title) : undefined,
    brief: b.brief,
    nodes: Array.isArray(b.nodes) ? b.nodes : undefined,
    body: b.body ? String(b.body) : undefined,
    stage: b.stage ? String(b.stage) : undefined,
  }));
});

// PUT /api/xhs/drafts/:id  保存草稿
xhsRouter.put('/drafts/:id', (req, res) => {
  const b = req.body || {};
  const updated = struct.updateDraft(req.user!.id, req.params.id, {
    title: b.title !== undefined ? String(b.title) : undefined,
    brief: b.brief,
    nodes: Array.isArray(b.nodes) ? b.nodes : undefined,
    body: b.body !== undefined ? String(b.body) : undefined,
    stage: b.stage ? String(b.stage) : undefined,
  });
  if (!updated) return res.status(404).json({ error: 'draft not found' });
  res.json(updated);
});

// DELETE /api/xhs/drafts/:id  删除草稿
xhsRouter.delete('/drafts/:id', (req, res) => {
  struct.deleteDraft(req.user!.id, req.params.id);
  res.json({ ok: true });
});

// ==================== ②.5 联网补料 ====================
// GET /api/xhs/enrich/available  联网搜索是否已配置（前端据此显示/隐藏入口）
xhsRouter.get('/enrich/available', (_req, res) => {
  res.json({ available: isSearchEnabled() });
});

// POST /api/xhs/enrich  { topic, materials?, root?, niche? }
// 逼问素材后，AI 生成搜索词 → 真实联网搜 → 汇总成带来源的"外部补充点"，供用户手动勾选采纳。
// 人始终把关、来源可见：只把外部信息当"佐证候选"，不当作者亲历，也不自动塞进素材。
xhsRouter.post('/enrich', async (req, res) => {
  const { topic, materials, root, niche } = req.body || {};
  if (!topic || !String(topic).trim()) return res.status(400).json({ error: 'topic is required' });
  if (!isSearchEnabled()) {
    return res.status(400).json({ error: '联网搜索未配置，请管理员在系统配置里填写 web_search_api_key', notConfigured: true });
  }
  try {
    // 第一步：让 AI 把主题/素材/根转成 2-3 条搜索 query
    const { response: qResp } = await aiGateway(
      {
        messages: [{
          role: 'user',
          content: uws.buildSearchQueryPrompt(
            String(topic), String(materials || ''),
            root ? String(root) : undefined, niche ? String(niche) : undefined
          ),
        }],
        temperature: 0.5, max_tokens: 400,
      },
      { userId: req.user!.id, source: 'xhs', operation: 'enrich:queries' }
    );
    const qParsed = parseFirstJson(qResp.choices[0]?.message?.content || '');
    const queries: string[] = Array.isArray(qParsed?.queries)
      ? qParsed.queries.map((q: any) => String(q)).filter(Boolean).slice(0, 3)
      : [];
    if (queries.length === 0) return res.status(502).json({ error: 'AI 未能生成搜索词' });

    // 第二步：真实联网搜索（并发），汇总去重成一个带序号的来源列表。
    // 记下每条 query 是成功还是报错——全都报错时要明确告诉用户"搜索坏了"，
    // 而不是笼统的"没查到"（否则无法区分 Tavily 故障/key 失效 vs 真的无结果）。
    const perQuery = await Promise.all(
      queries.map((q) =>
        webSearch(q, { maxResults: 4 }).then(
          (r) => ({ ok: true as const, results: r }),
          (err) => {
            console.error('[xhs] enrich search error:', q, err?.message || err);
            return { ok: false as const, results: [] as Awaited<ReturnType<typeof webSearch>> };
          }
        )
      )
    );
    const allFailed = perQuery.every((p) => !p.ok);
    if (allFailed) {
      return res.status(502).json({ error: '联网搜索暂时不可用（请检查搜索服务 key 或稍后重试）', searchFailed: true });
    }
    const seen = new Set<string>();
    const sources: Array<{ title: string; url: string; content: string }> = [];
    for (const p of perQuery) {
      for (const r of p.results) {
        if (!r.url || seen.has(r.url)) continue;
        seen.add(r.url);
        sources.push({ title: r.title, url: r.url, content: r.content });
      }
    }
    if (sources.length === 0) {
      return res.json({ queries, sources: [], facts: [] });
    }

    // 第三步：让 AI 从搜索结果里挑出有用补充点（每条标来源序号）
    const searchBlock = sources
      .map((s, i) => `[${i + 1}] ${s.title}\n来源：${s.url}\n摘要：${s.content}`)
      .join('\n\n');
    const { response: sResp } = await aiGateway(
      {
        messages: [{
          role: 'user',
          content: uws.buildEnrichSummaryPrompt(String(topic), root ? String(root) : undefined, searchBlock),
        }],
        temperature: 0.3, max_tokens: 1200,
      },
      { userId: req.user!.id, source: 'xhs', operation: 'enrich:summary' }
    );
    const sParsed = parseFirstJson(sResp.choices[0]?.message?.content || '');
    const facts = Array.isArray(sParsed?.facts)
      ? sParsed.facts
          .filter((f: any) => f && f.point)
          .map((f: any) => {
            const idx = Number(f.sourceIndex);
            const src = idx >= 1 && idx <= sources.length ? sources[idx - 1] : null;
            return {
              point: String(f.point),
              caution: f.caution ? String(f.caution) : '',
              source: src ? { title: src.title, url: src.url } : null,
            };
          })
      : [];

    res.json({ queries, sources, facts });
  } catch (e: any) {
    handleXhsError(res, e, 'enrich');
  }
});

// ==================== ③′ 大纲共创（出大纲 / 讨论调整大纲）====================
// POST /api/xhs/cowrite  { mode, ... }
// mode='outline'          → 出分段大纲（返回 sections）
// mode='discuss-outline'  → 用户对大纲提意见，AI 直接返回调整后的【整份新大纲】（返回 sections + note）
// 定稿后走 /skills/:id/generate 或 /cowrite-generate 一键成文，再在编辑器里改全文。
xhsRouter.post('/cowrite', async (req, res) => {
  const b = req.body || {};
  const cmd = String(b.mode || '');
  const platformStyle = getSkillForSlot('xhs-ask') || undefined;

  try {
    if (cmd === 'outline') {
      if (!b.topic || !String(b.topic).trim()) return res.status(400).json({ error: 'topic is required' });
      const { response } = await aiGateway(
        {
          messages: [{
            role: 'user',
            content: uws.buildOutlinePrompt({
              topic: String(b.topic),
              materials: b.materials ? String(b.materials) : undefined,
              root: b.root ? String(b.root) : undefined,
              persona: b.persona ? String(b.persona) : undefined,
              enrichment: b.enrichment ? String(b.enrichment) : undefined,
              niche: b.niche ? String(b.niche) : undefined,
              genre: b.genre ? (String(b.genre) as uws.WritingGenre) : undefined,
              platformStyle,
            }),
          }],
          temperature: 0.7, max_tokens: 1200,
        },
        { userId: req.user!.id, source: 'xhs', operation: 'cowrite:outline' }
      );
      const parsed = parseFirstJson(response.choices[0]?.message?.content || '');
      if (!parsed || !Array.isArray(parsed.sections)) {
        return res.status(502).json({ error: 'AI 返回格式异常', raw: response.choices[0]?.message?.content });
      }
      return res.json({ sections: parsed.sections });
    }

    if (cmd === 'discuss-outline') {
      const outline = Array.isArray(b.outline) ? b.outline : [];
      if (outline.length === 0 || !b.feedback || !String(b.feedback).trim()) {
        return res.status(400).json({ error: 'outline / feedback required' });
      }
      const { response } = await aiGateway(
        {
          messages: [{
            role: 'user',
            content: uws.buildDiscussOutlinePrompt({
              topic: String(b.topic || ''),
              root: b.root ? String(b.root) : undefined,
              materials: b.materials ? String(b.materials) : undefined,
              enrichment: b.enrichment ? String(b.enrichment) : undefined,
              niche: b.niche ? String(b.niche) : undefined,
              currentOutline: outline,
              feedback: String(b.feedback),
              platformStyle,
            }),
          }],
          temperature: 0.6, max_tokens: 1500,
        },
        { userId: req.user!.id, source: 'xhs', operation: 'cowrite:discuss-outline' }
      );
      const parsed = parseFirstJson(response.choices[0]?.message?.content || '');
      if (!parsed || !Array.isArray(parsed.sections)) {
        return res.status(502).json({ error: 'AI 返回格式异常', raw: response.choices[0]?.message?.content });
      }
      return res.json({ sections: parsed.sections, note: String(parsed.note || '') });
    }

    return res.status(400).json({ error: 'unknown cowrite mode' });
  } catch (e: any) {
    handleXhsError(res, e, 'cowrite');
  }
});

// POST /api/xhs/cowrite-generate  { topic, outline, materials?, root?, persona?, enrichment?, niche? }
// 用定稿大纲一次性生成整篇（流式）。不需要写作 skill——大纲本身就是结构，平台底座打底即可。
xhsRouter.post('/cowrite-generate', async (req, res) => {
  const b = req.body || {};
  const outline = Array.isArray(b.outline) ? b.outline : [];
  if (!b.topic || !String(b.topic).trim()) return res.status(400).json({ error: 'topic is required' });
  if (outline.length === 0) return res.status(400).json({ error: 'outline is required' });

  const platformStyle = getSkillForSlot('xhs-ask') || undefined;
  const systemPrompt = uws.buildGenerateFromOutlinePrompt({
    topic: String(b.topic),
    outline,
    materials: b.materials ? String(b.materials) : undefined,
    root: b.root ? String(b.root) : undefined,
    persona: b.persona ? String(b.persona) : undefined,
    enrichment: b.enrichment ? String(b.enrichment) : undefined,
    niche: b.niche ? String(b.niche) : undefined,
    genre: b.genre ? (String(b.genre) as uws.WritingGenre) : undefined,
    platformStyle,
  });

  try {
    const { stream, onComplete } = await aiGatewayStream(
      {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `请严格按上面的大纲和素材，写出完整的小红书笔记（标题单独一行放最前面）。` },
        ],
        ...SAMPLING.creative,   // 生成正文：高温+惩罚重复
        max_tokens: 4000,
      },
      { userId: req.user!.id, source: 'xhs', operation: 'cowrite-generate' }
    );
    await streamToSSE(res, stream, onComplete);
  } catch (e: any) {
    handleXhsError(res, e, 'cowrite-generate', true);
  }
});

// ==================== ④ 去味自检闭环 ====================
// POST /api/xhs/detect-rewrite  { title, body, mode? }
// mode='patch'(默认)：打分 + 逐句定点替换，改词/单句，动不了结构。
// mode='rewrite'：整篇重构——逐句替换救不了"三拍循环/金句密度/段落均匀"这类结构级指纹，
//                 让模型拿检测规则整篇换骨架，返回可整篇替换的新正文。
xhsRouter.post('/detect-rewrite', async (req, res) => {
  const { title, body, mode, persona, niche, genre } = req.body || {};
  if (!body || !String(body).trim()) return res.status(400).json({ error: 'body is required' });
  // slot: ai-detection（后台可绑定升级版检测 skill）
  const detectionSkill = getSkillForSlot('ai-detection') || '';
  // 固定人设/赛道/文体随全流程带下来：去味/重写要保持同一个真人的口吻，且不能拿 story 规则误伤金句/抒情体
  const voiceCtx = {
    persona: persona ? String(persona) : undefined,
    niche: niche ? String(niche) : undefined,
    genre: genre ? (String(genre) as uws.WritingGenre) : undefined,
  };

  // ===== 整篇重构模式 =====
  if (String(mode) === 'rewrite') {
    try {
      const { response } = await aiGateway(
        {
          messages: [{ role: 'user', content: uws.buildDeflavorRewritePrompt(detectionSkill, String(title || ''), String(body), voiceCtx) }],
          ...SAMPLING.rewrite,   // 去味重写：中高温+惩罚重复，让改写更松弛、不滑回套话
          max_tokens: 4000,      // 整篇重写要留足空间
        },
        { userId: req.user!.id, source: 'xhs', operation: 'detect-rewrite:rewrite' }
      );
      const parsed = parseFirstJson(response.choices[0]?.message?.content || '');
      if (!parsed || !parsed.body) return res.status(502).json({ error: 'AI 返回格式异常', raw: response.choices[0]?.message?.content });
      return res.json({
        mode: 'rewrite',
        rewrittenTitle: parsed.title ?? String(title || ''),
        rewrittenBody: String(parsed.body),   // 整篇替换（前端一键采纳）
        notes: Array.isArray(parsed.notes) ? parsed.notes : [],
      });
    } catch (e: any) {
      return handleXhsError(res, e, 'detect-rewrite:rewrite');
    }
  }

  // ===== 逐句定点替换模式（默认）=====
  try {
    const { response } = await aiGateway(
      { messages: [{ role: 'user', content: uws.buildDetectRewritePrompt(detectionSkill, String(title || ''), String(body), voiceCtx) }], temperature: 0.4, max_tokens: 2500 },
      { userId: req.user!.id, source: 'xhs', operation: 'detect-rewrite' }
    );
    const parsed = parseFirstJson(response.choices[0]?.message?.content || '');
    if (!parsed) return res.status(502).json({ error: 'AI 返回格式异常', raw: response.choices[0]?.message?.content });

    // 服务端做定点替换：只替换 original 在正文里逐字命中的（AI 有时会改写 original，命不中就跳过，不误伤）
    const rewrites = Array.isArray(parsed.rewrites) ? parsed.rewrites : [];
    let rewritten = String(body);
    const applied: any[] = [];
    for (const r of rewrites) {
      const orig = String(r?.original || '');
      const sug = String(r?.suggestion || '');
      if (orig && sug && rewritten.includes(orig)) {
        rewritten = rewritten.replace(orig, sug);
        applied.push({ original: orig, suggestion: sug, fingerprint: r?.fingerprint || '', reason: r?.reason || '' });
      }
    }
    res.json({
      mode: 'patch',
      total_score: parsed.total_score ?? null,
      grade: parsed.grade ?? null,
      dimensions: parsed.dimensions ?? {},
      fingerprints: parsed.fingerprints ?? [],
      overall_assessment: parsed.overall_assessment ?? '',
      rewrite_priority: parsed.rewrite_priority ?? [],
      appliedRewrites: applied, // 实际替换成功的
      skippedRewrites: rewrites.length - applied.length, // original 没命中原文而跳过的条数
      rewrittenBody: rewritten, // 去味后的正文（前端可一键采纳）
    });
  } catch (e: any) {
    handleXhsError(res, e, 'detect-rewrite');
  }
});

// ==================== ④′ 打磨（定点狙击最平庸的几句）====================
// POST /api/xhs/polish  { title, body, persona?, niche?, genre? }
// 揪出全文最平庸的 3 句、各给更有质感的替换，服务端逐字定点替换。治"平庸"而非"AI 指纹"。
xhsRouter.post('/polish', async (req, res) => {
  const { title, body, persona, niche, genre } = req.body || {};
  if (!body || !String(body).trim()) return res.status(400).json({ error: 'body is required' });
  const voiceCtx = {
    persona: persona ? String(persona) : undefined,
    niche: niche ? String(niche) : undefined,
    genre: genre ? (String(genre) as uws.WritingGenre) : undefined,
  };
  try {
    const { response } = await aiGateway(
      {
        messages: [{ role: 'user', content: uws.buildPolishPrompt(String(title || ''), String(body), voiceCtx) }],
        ...SAMPLING.rewrite,   // 打磨：提意外度但守原意
        max_tokens: 2000,
      },
      { userId: req.user!.id, source: 'xhs', operation: 'polish' }
    );
    const parsed = parseFirstJson(response.choices[0]?.message?.content || '');
    if (!parsed) return res.status(502).json({ error: 'AI 返回格式异常', raw: response.choices[0]?.message?.content });

    // 逐字定点替换：只替换 original 在正文里精确命中的，命不中就跳过（不误伤）
    const polishes = Array.isArray(parsed.polishes) ? parsed.polishes : [];
    let polished = String(body);
    const applied: any[] = [];
    for (const p of polishes) {
      const orig = String(p?.original || '');
      const sug = String(p?.suggestion || '');
      if (orig && sug && polished.includes(orig)) {
        polished = polished.replace(orig, sug);
        applied.push({ original: orig, suggestion: sug, why: String(p?.why || '') });
      }
    }
    res.json({
      appliedPolishes: applied,
      skippedPolishes: polishes.length - applied.length,
      polishedBody: polished, // 打磨后的正文（前端可一键采纳）
    });
  } catch (e: any) {
    handleXhsError(res, e, 'polish');
  }
});

// ==================== ⑤ AI 陪写（选中问 AI / 改写 / 接续，流式）====================
// POST /api/xhs/ask  { mode?, question?, selection?, title, body, niche? }
// mode: 'ask'(默认，问 AI) | 'rewrite'(给选中句 3 种改法) | 'continue'(顺着往下写)
//      | 'deflavor'(给选中句去味) | 'demonstrate'(把"讲道理"改成"用场景演示")
// 参考 novel 的命令分发：一个端点、按 mode 挂不同 system prompt，都走流式。
xhsRouter.post('/ask', async (req, res) => {
  const { mode, question, selection, title, body, niche, persona } = req.body || {};
  const cmd = String(mode || 'ask');
  // ask 模式必须有问题；改写/去味/演示化模式必须有选中内容
  if (cmd === 'ask' && !question) return res.status(400).json({ error: 'question is required' });
  if ((cmd === 'rewrite' || cmd === 'deflavor' || cmd === 'demonstrate') && !selection) {
    return res.status(400).json({ error: 'selection is required for this mode' });
  }

  // 后台可在「Skill 管理」里给 xhs-ask 这个 slot 绑定写作风格 skill；
  // 绑定了就把 skill 正文注入 system prompt，没绑定则退回内置行为。
  const styleSkill = getSkillForSlot('xhs-ask');
  const styleBlock = styleSkill ? `\n\n## 写作风格规范（改写/续写时严格遵守）\n${styleSkill}` : '';
  const nicheLine = niche ? `\n用户赛道/人群：${niche}` : '';
  // 固定人设：改写/续写/去味都用同一个真人的口吻和立场（越用越像同一个人）
  const personaLine = persona ? `\n作者人设（全程保持这个人的口吻和立场）：${persona}` : '';

  // 按 mode 分发 system prompt + 用户上下文
  let systemPrompt: string;
  let contextText: string;
  const noteCtx = `## 当前笔记全文\n标题：${title || '(未填)'}\n正文：\n${body || '(未填)'}`;

  if (cmd === 'rewrite') {
    systemPrompt = `你是一个资深小红书创作者，正在帮朋友打磨一句话。针对用户选中的这句，给出 3 种不同调性的改法（比如更有情绪的、更具体的、更口语的），每种一句话，直接可用。不要解释、不要客套。${nicheLine}${personaLine}${styleBlock}`;
    contextText = `${noteCtx}\n\n## 要改写的这句（选中内容）\n${selection}\n\n请给 3 种改法，用 1. 2. 3. 列出。`;
  } else if (cmd === 'continue') {
    systemPrompt = `你是一个资深小红书创作者。顺着用户已有的文字、用同样的语气往下写一小段（2-4 句），自然承接，不要重复已有内容、不要另起炉灶、不要总结。${nicheLine}${personaLine}${styleBlock}`;
    contextText = `${noteCtx}\n\n${selection ? `## 从这里接着写\n${selection}` : '## 顺着正文结尾接着写'}`;
  } else if (cmd === 'deflavor') {
    systemPrompt = `你是一个 AI 去味专家。用户选中的这句有 AI 味，请改写成更像真人随口说的样子：去掉"不是X是Y"式对仗、去掉抛光金句感、允许口语和不完美。只输出改写后的句子，不要解释。${nicheLine}${personaLine}${styleBlock}`;
    contextText = `${noteCtx}\n\n## 要去味的这句（选中内容）\n${selection}`;
  } else if (cmd === 'demonstrate') {
    // 把"讲道理/下结论"改成"用具体场景演示"——把写作手艺"演示 vs 举例"工具化。
    systemPrompt = `你是一个擅长"用故事演示观点"的资深写作者。用户选中的这段是在"讲道理/下结论"（先有论点再解释），读起来空、像 AI。请把它改写成"用一个具体场景演示"的版本：
- 不要先抛结论再解释，而是让论点从一个具体的画面/动作/对话里自己长出来。
- 用具体的人、时间、动作、冲突，而不是抽象概括。
- 如果原文没有具体细节可用，就搭一个合理的、可替换的场景骨架，并提示用户"把这里换成你自己的真实经历"。
- 只输出改写后的段落，可附一句极简提示（如"↑把场景换成你的真实经历更佳"）。${nicheLine}${personaLine}${styleBlock}`;
    contextText = `${noteCtx}\n\n## 要改成"用场景演示"的这段（选中内容）\n${selection}`;
  } else {
    systemPrompt = `你是一个资深小红书运营，正在帮用户打磨一篇笔记。
回答要围绕"怎么让这篇更容易爆"来给建议，不要给通用的写作套话。
建议要具体、可直接抄用（给出改写后的示例文字），语气像一个懂行的朋友在支招。${nicheLine}${personaLine}${styleBlock}`;
    contextText = `${noteCtx}\n${selection ? `\n## 用户正在纠结的这一段（选中内容）\n${selection}` : ''}\n\n## 用户的问题\n${question}`;
  }

  try {
    const { stream, onComplete } = await aiGatewayStream(
      {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: contextText },
        ],
        temperature: 0.7,
      },
      { userId: req.user!.id, source: 'xhs', operation: `ask:${cmd}` }
    );
    await streamToSSE(res, stream, onComplete);
  } catch (e: any) {
    handleXhsError(res, e, 'ask', true);
  }
});

// ==================== 用户私有写作 Skill（调试台 + 写作台用）====================

// 列出我的写作 skill
xhsRouter.get('/skills', (req, res) => {
  res.json({ skills: uws.listSkills(req.user!.id) });
});

// 新建
xhsRouter.post('/skills', (req, res) => {
  const { name, description } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'name is required' });
  res.status(201).json({ skill: uws.createSkill(req.user!.id, { name: String(name).trim(), description }) });
});

// AI 帮我搭第一版 skill（只返回预览草稿，不落库；由前端确认后再走 POST /skills + 写主文件）
// POST /api/xhs/skills/scaffold  { description, samples?: string[] }
xhsRouter.post('/skills/scaffold', async (req, res) => {
  const { description, samples } = req.body || {};
  const sampleList: string[] = Array.isArray(samples)
    ? samples.map((s: any) => String(s || '').trim()).filter(Boolean).slice(0, 3)
    : [];
  if (!description && sampleList.length === 0) {
    return res.status(400).json({ error: '请至少填写描述或提供一篇范文' });
  }
  const prompt = uws.buildScaffoldPrompt(String(description || ''), sampleList);
  try {
    const { response } = await aiGateway(
      { messages: [{ role: 'user', content: prompt }], temperature: 0.6, max_tokens: 3000 },
      { userId: req.user!.id, source: 'xhs', operation: 'skill-scaffold' }
    );
    const text = response.choices[0]?.message?.content || '';
    const parsed = parseFirstJson(text);
    if (!parsed) return res.status(502).json({ error: 'AI 返回格式异常', raw: text });
    res.json({
      suggestedName: parsed.suggestedName || '我的写作风格',
      description: parsed.description || '',
      mainBody: parsed.mainBody || '',
    });
  } catch (e: any) {
    handleXhsError(res, e, 'skill-scaffold');
  }
});

// 内置模板：列出 + 一键导入。
// **必须注册在 `/skills/:id` 之前** —— Express 按注册顺序匹配，放在后面的话
// `GET /skills/templates` 会被 `:id` 接走，回一句 404 not found，
// 读起来像「这个模板不存在」而不是「路由写错了」。
xhsRouter.get('/skills/templates', (_req, res) => {
  res.json({
    templates: SKILL_TEMPLATES.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      origin: t.origin,
      chars: t.mainBody.length,
    })),
  });
});

// POST /api/xhs/skills/import-template  { templateId }
// 每次导入都新建一份（不查重）：模板是给人改的，导第二份通常就是想拿一份干净的重来。
xhsRouter.post('/skills/import-template', (req, res) => {
  const tpl = getSkillTemplate(String(req.body?.templateId || ''));
  if (!tpl) return res.status(404).json({ error: '模板不存在' });
  const skill = uws.createSkill(req.user!.id, { name: tpl.name, description: tpl.description });
  // 主文件写失败就把空壳删掉：留着一个空 skill 在列表里，用户选它去写作台生成，
  // 出来的东西和没挂 skill 一模一样，没有任何一处会报错。
  if (!uws.setMainBody(skill.id, req.user!.id, tpl.mainBody)) {
    uws.deleteSkill(skill.id, req.user!.id);
    return res.status(500).json({ error: '模板正文写入失败，请重试' });
  }
  res.status(201).json({ skill });
});

// 详情
xhsRouter.get('/skills/:id', (req, res) => {
  const skill = uws.getSkill(req.params.id, req.user!.id);
  if (!skill) return res.status(404).json({ error: 'not found' });
  res.json({ skill });
});

// 改元信息
xhsRouter.put('/skills/:id', (req, res) => {
  const skill = uws.updateSkill(req.params.id, req.user!.id, { name: req.body?.name, description: req.body?.description });
  if (!skill) return res.status(404).json({ error: 'not found' });
  res.json({ skill });
});

// 删除
xhsRouter.delete('/skills/:id', (req, res) => {
  if (!uws.deleteSkill(req.params.id, req.user!.id)) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});

// 文件列表
xhsRouter.get('/skills/:id/files', (req, res) => {
  if (!uws.getSkill(req.params.id, req.user!.id)) return res.status(404).json({ error: 'not found' });
  res.json({ files: uws.listFiles(req.params.id, req.user!.id) });
});

// 新增引用文件
xhsRouter.post('/skills/:id/files', (req, res) => {
  const { filename, body } = req.body || {};
  if (!filename || !/^[\w.\-]+$/.test(filename)) {
    return res.status(400).json({ error: 'filename 必填，且只能含字母数字下划线点连字符' });
  }
  const file = uws.addFile(req.params.id, req.user!.id, { filename, body });
  if (!file) return res.status(404).json({ error: 'not found' });
  res.status(201).json({ file });
});

// 更新文件
xhsRouter.put('/skills/files/:fileId', (req, res) => {
  const { filename, body } = req.body || {};
  // 改文件名时同样校验（与新增引用文件的规则一致，避免非法名绕过创建校验）
  if (filename !== undefined && !/^[\w.\-]+$/.test(String(filename))) {
    return res.status(400).json({ error: 'filename 只能含字母数字下划线点连字符' });
  }
  const file = uws.updateFile(req.params.fileId, req.user!.id, { filename, body });
  if (!file) return res.status(404).json({ error: 'not found' });
  res.json({ file });
});

// 删除引用文件
xhsRouter.delete('/skills/files/:fileId', (req, res) => {
  const r = uws.deleteFile(req.params.fileId, req.user!.id);
  if (!r.ok) return res.status(r.reason === 'not found' ? 404 : 400).json({ error: r.reason });
  res.json({ ok: true });
});

// 用 skill 生成整篇（流式）
// POST /api/xhs/skills/:id/generate  { topic }
xhsRouter.post('/skills/:id/generate', async (req, res) => {
  const { topic, materials, root, persona, niche, genre } = req.body || {};
  if (!topic || !String(topic).trim()) return res.status(400).json({ error: 'topic is required' });
  const skill = uws.getSkill(req.params.id, req.user!.id);
  if (!skill) return res.status(404).json({ error: 'not found' });

  const { assembled } = uws.assembleSkillBody(req.params.id, req.user!.id);
  // 平台底座（人类化通则）与 /ask 共用 xhs-ask slot：底座打底、用户 skill 覆个性，两层叠加不冲突。
  const platformStyle = getSkillForSlot('xhs-ask') || undefined;
  // 注入真实素材 / 核心判断 / 固定人设 / 赛道 / 文体——都可选，有则显著降 AI 味、更贴合人群与文体
  const systemPrompt = uws.buildGeneratePrompt(assembled, {
    platformStyle,
    materials: materials ? String(materials) : undefined,
    root: root ? String(root) : undefined,
    persona: persona ? String(persona) : undefined,
    niche: niche ? String(niche) : undefined,
    genre: genre ? (String(genre) as uws.WritingGenre) : undefined,
  });

  try {
    const { stream, onComplete } = await aiGatewayStream(
      {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `请按上面的写作风格，就以下主题写一篇完整的小红书笔记：\n${topic}` },
        ],
        ...SAMPLING.creative,   // 生成正文：高温+惩罚重复，敢挑不那么顺的词，降 AI 味
      },
      { userId: req.user!.id, source: 'xhs', operation: 'skill-generate' }
    );
    await streamToSSE(res, stream, onComplete);
  } catch (e: any) {
    handleXhsError(res, e, 'skill-generate', true);
  }
});

// 调试闭环：根据产出 + 用户意见，让 AI 提炼通用规则、给出 skill 改进建议（不自动写回）
// POST /api/xhs/skills/:id/refine  { output, feedback }
xhsRouter.post('/skills/:id/refine', async (req, res) => {
  const { output, feedback } = req.body || {};
  if (!output || !feedback) return res.status(400).json({ error: 'output and feedback are required' });
  const skill = uws.getSkill(req.params.id, req.user!.id);
  if (!skill) return res.status(404).json({ error: 'not found' });

  const { mainBody } = uws.assembleSkillBody(req.params.id, req.user!.id);
  const prompt = uws.buildRefinePrompt(mainBody, String(output), String(feedback));

  try {
    const { response } = await aiGateway(
      { messages: [{ role: 'user', content: prompt }], temperature: 0.4, max_tokens: 3000 },
      { userId: req.user!.id, source: 'xhs', operation: 'skill-refine' }
    );
    const text = response.choices[0]?.message?.content || '';
    const parsed = parseFirstJson(text);
    if (!parsed) return res.status(502).json({ error: 'AI 返回格式异常', raw: text });
    res.json({ changes: parsed.changes || [], newMainBody: parsed.newMainBody || mainBody });
  } catch (e: any) {
    handleXhsError(res, e, 'skill-refine');
  }
});

// 采纳 refine 结果：把新主文件写回
// PUT /api/xhs/skills/:id/main  { body }
xhsRouter.put('/skills/:id/main', (req, res) => {
  const { body } = req.body || {};
  if (typeof body !== 'string') return res.status(400).json({ error: 'body is required' });
  if (!uws.setMainBody(req.params.id, req.user!.id, body)) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});
