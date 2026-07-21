import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../db/index.js';
import { scoreNote, getWeights, setWeight, type XhsNoteInput, type XhsDimensionKey } from '../services/xhs/scoringService.js';
import { aiGateway, aiGatewayStream } from '../core/llm/gateway.js';
import { getSkillForSlot } from '../services/skillRegistryService.js';
import * as uws from '../services/userWritingSkillService.js';

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

  db.prepare(
    `UPDATE xhs_notes SET published = 1, real_likes = ?, real_collects = ?, real_views = ?, updated_at = ?
     WHERE id = ? AND user_id = ?`
  ).run(
    real_likes ?? null, real_collects ?? null, real_views ?? null,
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

// PUT /api/xhs/weights  批量更新权重 { titleHook: 1.5, ... }
xhsRouter.put('/weights', (req, res) => {
  const body = req.body || {};
  const VALID: XhsDimensionKey[] = ['titleHook', 'opening', 'resonance', 'emotion', 'value', 'interaction'];
  for (const key of VALID) {
    if (body[key] !== undefined) {
      const w = Number(body[key]);
      if (!Number.isNaN(w) && w >= 0) setWeight(key, w);
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

  const DIMS = ['titleHook', 'opening', 'resonance', 'emotion', 'value', 'interaction'];

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
// POST /api/xhs/score  { title, body, niche? }
xhsRouter.post('/score', async (req, res) => {
  const { title, body, niche } = req.body || {};
  if (!title && !body) {
    return res.status(400).json({ error: 'title or body is required' });
  }

  const note: XhsNoteInput = {
    title: String(title || ''),
    body: String(body || ''),
    niche: niche ? String(niche) : undefined,
  };

  try {
    const result = await scoreNote(note, req.user!.id);
    res.json(result);
  } catch (e: any) {
    if (e?.name === 'QuotaExceededError') {
      return res.status(429).json({ error: e.message, dailyLimit: e.dailyLimit });
    }
    console.error('[xhs] score failed:', e);
    res.status(500).json({ error: e.message || 'Scoring failed' });
  }
});

// ==================== AI 陪写（选中问 AI，流式）====================
// POST /api/xhs/ask  { question, selection?, title, body, niche? }
// AI 拿到「选中的段落 + 全文上下文 + 用户问题」，用爆款视角回答。
xhsRouter.post('/ask', async (req, res) => {
  const { question, selection, title, body, niche } = req.body || {};
  if (!question) return res.status(400).json({ error: 'question is required' });

  // 后台可在「Skill 管理」里给 xhs-ask 这个 slot 绑定写作风格 skill；
  // 绑定了就把 skill 正文注入 system prompt，没绑定则退回原有硬编码行为。
  const styleSkill = getSkillForSlot('xhs-ask');

  const systemPrompt = `你是一个资深小红书运营，正在帮用户打磨一篇笔记。
回答要围绕"怎么让这篇更容易爆"来给建议，不要给通用的写作套话。
建议要具体、可直接抄用（给出改写后的示例文字），语气像一个懂行的朋友在支招。
${niche ? `\n用户赛道/人群：${niche}` : ''}${styleSkill ? `\n\n## 写作风格规范（改写示例时严格遵守）\n${styleSkill}` : ''}`;

  const contextText = `## 当前笔记全文
标题：${title || '(未填)'}
正文：
${body || '(未填)'}
${selection ? `\n## 用户正在纠结的这一段（选中内容）\n${selection}` : ''}

## 用户的问题
${question}`;

  try {
    const { stream, onComplete } = await aiGatewayStream(
      {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: contextText },
        ],
        temperature: 0.7,
      },
      { userId: req.user!.id, source: 'xhs', operation: 'ask' }
    );

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    let output = '';
    const start = Date.now();
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content || '';
      if (delta) {
        output += delta;
        res.write(`data: ${JSON.stringify({ delta })}\n\n`);
      }
    }
    res.write('data: [DONE]\n\n');
    res.end();

    // token 计费按输出长度粗估（gateway 已在 checkAndDeduct 扣了一次调用额度）
    onComplete(0, Math.ceil(output.length / 4), Date.now() - start);
  } catch (e: any) {
    if (e?.name === 'QuotaExceededError') {
      return res.status(429).json({ error: e.message, dailyLimit: e.dailyLimit });
    }
    console.error('[xhs] ask failed:', e);
    if (!res.headersSent) res.status(500).json({ error: e.message || 'Ask failed' });
    else res.end();
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
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return res.status(502).json({ error: 'AI 返回格式异常', raw: text });
    let parsed: any;
    try { parsed = JSON.parse(m[0]); } catch { return res.status(502).json({ error: 'AI 返回无法解析', raw: text }); }
    res.json({
      suggestedName: parsed.suggestedName || '我的写作风格',
      description: parsed.description || '',
      mainBody: parsed.mainBody || '',
    });
  } catch (e: any) {
    if (e?.name === 'QuotaExceededError') return res.status(429).json({ error: e.message, dailyLimit: e.dailyLimit });
    console.error('[xhs] skill-scaffold failed:', e);
    res.status(500).json({ error: e.message || 'Scaffold failed' });
  }
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
  const file = uws.updateFile(req.params.fileId, req.user!.id, { filename: req.body?.filename, body: req.body?.body });
  if (!file) return res.status(404).json({ error: 'not found' });
  res.json({ file });
});

// 删除引用文件
xhsRouter.delete('/skills/files/:fileId', (req, res) => {
  const r = uws.deleteFile(req.params.fileId, req.user!.id);
  if (!r.ok) return res.status(r.reason === 'not found' ? 404 : 400).json({ error: r.reason });
  res.json({ ok: true });
});

// 预览组装后的完整 skill
xhsRouter.get('/skills/:id/preview', (req, res) => {
  if (!uws.getSkill(req.params.id, req.user!.id)) return res.status(404).json({ error: 'not found' });
  res.json({ assembled: uws.assembleSkillBody(req.params.id, req.user!.id).assembled });
});

// 用 skill 生成整篇（流式）
// POST /api/xhs/skills/:id/generate  { topic }
xhsRouter.post('/skills/:id/generate', async (req, res) => {
  const { topic } = req.body || {};
  if (!topic || !String(topic).trim()) return res.status(400).json({ error: 'topic is required' });
  const skill = uws.getSkill(req.params.id, req.user!.id);
  if (!skill) return res.status(404).json({ error: 'not found' });

  const { assembled } = uws.assembleSkillBody(req.params.id, req.user!.id);
  const systemPrompt = uws.buildGeneratePrompt(assembled);

  try {
    const { stream, onComplete } = await aiGatewayStream(
      {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `请按上面的写作风格，就以下主题写一篇完整的小红书笔记：\n${topic}` },
        ],
        temperature: 0.8,
      },
      { userId: req.user!.id, source: 'xhs', operation: 'skill-generate' }
    );
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    let output = '';
    const start = Date.now();
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content || '';
      if (delta) {
        output += delta;
        res.write(`data: ${JSON.stringify({ delta })}\n\n`);
      }
    }
    res.write('data: [DONE]\n\n');
    res.end();
    onComplete(0, Math.ceil(output.length / 4), Date.now() - start);
  } catch (e: any) {
    if (e?.name === 'QuotaExceededError') return res.status(429).json({ error: e.message, dailyLimit: e.dailyLimit });
    console.error('[xhs] skill-generate failed:', e);
    if (!res.headersSent) res.status(500).json({ error: e.message || 'Generate failed' });
    else res.end();
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
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return res.status(502).json({ error: 'AI 返回格式异常', raw: text });
    let parsed: any;
    try { parsed = JSON.parse(m[0]); } catch { return res.status(502).json({ error: 'AI 返回无法解析', raw: text }); }
    res.json({ changes: parsed.changes || [], newMainBody: parsed.newMainBody || mainBody });
  } catch (e: any) {
    if (e?.name === 'QuotaExceededError') return res.status(429).json({ error: e.message, dailyLimit: e.dailyLimit });
    console.error('[xhs] skill-refine failed:', e);
    res.status(500).json({ error: e.message || 'Refine failed' });
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
