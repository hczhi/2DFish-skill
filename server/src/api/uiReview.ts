import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../db/index.js';
import { executeReview, getProgressEvents } from '../services/uiReview/orchestrator.js';
import { crawlPage } from '../services/uiReview/crawlerService.js';
import { runSingleRule, type RuleConfig } from '../services/uiReview/ruleEngine.js';
import { streamPreviewHtml, generateSkillMarkdown, type ReviewData, type UserPreferences } from '../services/uiReview/generationService.js';

export const uiReviewRouter = Router();

// ==================== Admin: Rules CRUD ====================

uiReviewRouter.get('/admin/rules', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  const db = getDatabase();
  const rules = db.prepare('SELECT * FROM ui_review_rules ORDER BY sort_order ASC, created_at DESC').all();
  res.json(rules);
});

uiReviewRouter.post('/admin/rules', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  const { name, dimension, description, detection_type, detection_config, weight, severity, industry_weights, sort_order } = req.body;
  if (!name || !dimension) return res.status(400).json({ error: 'name and dimension are required' });

  const db = getDatabase();
  const now = new Date().toISOString();
  const id = uuidv4();

  db.prepare(`
    INSERT INTO ui_review_rules (id, name, dimension, description, detection_type, detection_config, weight, severity, industry_weights, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, name, dimension,
    description || '',
    detection_type || 'dom',
    JSON.stringify(detection_config || {}),
    weight ?? 1.0,
    severity || 'warning',
    JSON.stringify(industry_weights || {}),
    sort_order ?? 0,
    now, now
  );

  res.json({ id, name, dimension, created_at: now });
});

uiReviewRouter.put('/admin/rules/:id', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  const { id } = req.params;
  const { name, dimension, description, detection_type, detection_config, weight, severity, industry_weights, sort_order } = req.body;

  const db = getDatabase();
  const existing = db.prepare('SELECT id FROM ui_review_rules WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Rule not found' });

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE ui_review_rules SET
      name = ?, dimension = ?, description = ?, detection_type = ?,
      detection_config = ?, weight = ?, severity = ?, industry_weights = ?,
      sort_order = ?, updated_at = ?
    WHERE id = ?
  `).run(
    name, dimension,
    description || '',
    detection_type || 'dom',
    JSON.stringify(detection_config || {}),
    weight ?? 1.0,
    severity || 'warning',
    JSON.stringify(industry_weights || {}),
    sort_order ?? 0,
    now, id
  );

  res.json({ success: true });
});

uiReviewRouter.delete('/admin/rules/:id', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  const db = getDatabase();
  db.prepare('DELETE FROM ui_review_rules WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

uiReviewRouter.patch('/admin/rules/:id/toggle', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  const db = getDatabase();
  const rule = db.prepare('SELECT enabled FROM ui_review_rules WHERE id = ?').get(req.params.id) as any;
  if (!rule) return res.status(404).json({ error: 'Rule not found' });

  const newEnabled = rule.enabled ? 0 : 1;
  db.prepare('UPDATE ui_review_rules SET enabled = ?, updated_at = ? WHERE id = ?')
    .run(newEnabled, new Date().toISOString(), req.params.id);
  res.json({ enabled: newEnabled });
});

// Admin: Rule Debug
uiReviewRouter.post('/admin/rules/:id/debug', async (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'url is required' });

  const db = getDatabase();
  const rule = db.prepare('SELECT * FROM ui_review_rules WHERE id = ?').get(req.params.id) as any;
  if (!rule) return res.status(404).json({ error: 'Rule not found' });

  try {
    const crawlData = await crawlPage(url);
    const ruleConfig: RuleConfig = {
      ...rule,
      detection_config: JSON.parse(rule.detection_config || '{}'),
      industry_weights: JSON.parse(rule.industry_weights || '{}'),
    };
    const result = runSingleRule(crawlData, ruleConfig);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== Admin: Style Skills CRUD ====================

uiReviewRouter.get('/admin/skills', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  const db = getDatabase();
  const skills = db.prepare('SELECT * FROM ui_style_skills ORDER BY created_at DESC').all();
  res.json(skills);
});

uiReviewRouter.post('/admin/skills', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  const { name, description, design_features, thumbnail_url, industry_type, skill_template } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  const db = getDatabase();
  const now = new Date().toISOString();
  const id = uuidv4();

  db.prepare(`
    INSERT INTO ui_style_skills (id, name, description, design_features, thumbnail_url, industry_type, skill_template, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, name,
    description || '',
    JSON.stringify(design_features || {}),
    thumbnail_url || '',
    industry_type || '',
    skill_template || '',
    now, now
  );

  res.json({ id, name, created_at: now });
});

uiReviewRouter.put('/admin/skills/:id', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  const { id } = req.params;
  const { name, description, design_features, thumbnail_url, industry_type, skill_template } = req.body;

  const db = getDatabase();
  const existing = db.prepare('SELECT id FROM ui_style_skills WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Skill not found' });

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE ui_style_skills SET
      name = ?, description = ?, design_features = ?, thumbnail_url = ?,
      industry_type = ?, skill_template = ?, updated_at = ?
    WHERE id = ?
  `).run(
    name,
    description || '',
    JSON.stringify(design_features || {}),
    thumbnail_url || '',
    industry_type || '',
    skill_template || '',
    now, id
  );

  res.json({ success: true });
});

uiReviewRouter.delete('/admin/skills/:id', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  const db = getDatabase();
  db.prepare('DELETE FROM ui_style_skills WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Admin: Skill Debug
uiReviewRouter.post('/admin/skills/:id/debug', async (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'url is required' });

  const db = getDatabase();
  const skill = db.prepare('SELECT * FROM ui_style_skills WHERE id = ?').get(req.params.id) as any;
  if (!skill) return res.status(404).json({ error: 'Skill not found' });

  try {
    const crawlData = await crawlPage(url);
    let designFeatures;
    try { designFeatures = JSON.parse(skill.design_features || '{}'); } catch { designFeatures = {}; }

    const { generateSkillMarkdown } = await import('../services/uiReview/generationService.js');

    const reviewData: ReviewData = {
      url,
      industryType: skill.industry_type || 'corporate',
      totalScore: 0,
      dimensionScores: {},
      ruleResults: [],
      llmAnalysis: '',
      crawlData,
      techStack: crawlData.techStack,
    };

    const referenceAnalysis = {
      palette: designFeatures.palette || [],
      spacingStyle: designFeatures.spacing_style || 'moderate',
      layoutCharacteristics: designFeatures.layout || 'standard',
      fontStyle: designFeatures.font_style || 'sans-serif',
      overallVibe: designFeatures.vibe || 'modern',
    };

    const skillMarkdown = await generateSkillMarkdown(reviewData, referenceAnalysis, req.user!.id);
    res.json({ skill_markdown: skillMarkdown, preview_html: '' });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== Admin: Review Records ====================

uiReviewRouter.get('/admin/reviews', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  const db = getDatabase();
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const pageSize = Math.min(50, parseInt(req.query.page_size as string) || 20);
  const offset = (page - 1) * pageSize;

  const total = (db.prepare('SELECT COUNT(*) as count FROM ui_reviews').get() as any).count;
  const items = db.prepare(
    'SELECT id, user_id, url, status, industry_type, total_score, screenshot_url, created_at, completed_at FROM ui_reviews ORDER BY created_at DESC LIMIT ? OFFSET ?'
  ).all(pageSize, offset);

  res.json({ items, total, page, page_size: pageSize });
});

uiReviewRouter.get('/admin/reviews/:id', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  const db = getDatabase();
  const review = db.prepare('SELECT * FROM ui_reviews WHERE id = ?').get(req.params.id);
  if (!review) return res.status(404).json({ error: 'Review not found' });
  res.json(review);
});

uiReviewRouter.delete('/admin/reviews/:id', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  const db = getDatabase();
  db.prepare('DELETE FROM ui_reviews WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ==================== User: Review Operations ====================

uiReviewRouter.post('/start', async (req, res) => {
  const userId = req.user!.id;
  const { url, referenceImageUrl, mode } = req.body;
  if (!url) return res.status(400).json({ error: 'url is required' });

  const reviewMode = mode === 'pro' ? 'pro' : 'standard';

  const db = getDatabase();
  const now = new Date().toISOString();
  const id = uuidv4();

  db.prepare(`
    INSERT INTO ui_reviews (id, user_id, url, reference_image_url, mode, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'pending', ?)
  `).run(id, userId, url, referenceImageUrl || '', reviewMode, now);

  res.json({ id, status: 'pending', mode: reviewMode });

  // Kick off async review pipeline (fire-and-forget)
  executeReview(id, userId).catch(err => {
    console.error(`[ui-review] Pipeline error for ${id}:`, err);
  });
});

// SSE progress stream
uiReviewRouter.get('/:id/stream', (req, res) => {
  const userId = req.user!.id;
  const { id } = req.params;

  const db = getDatabase();
  const review = db.prepare('SELECT user_id, status FROM ui_reviews WHERE id = ?').get(id) as any;
  if (!review || review.user_id !== userId) return res.status(404).json({ error: 'Not found' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const interval = setInterval(() => {
    const current = db.prepare('SELECT status FROM ui_reviews WHERE id = ?').get(id) as any;
    if (!current) { clearInterval(interval); res.end(); return; }

    const events = getProgressEvents(id);
    if (events.length) {
      const latest = events[events.length - 1];
      res.write(`event: progress\ndata: ${latest}\n\n`);
    }
    res.write(`event: status\ndata: ${JSON.stringify({ status: current.status })}\n\n`);

    if (current.status === 'completed' || current.status === 'failed') {
      res.write(`event: done\ndata: {}\n\n`);
      clearInterval(interval);
      res.end();
    }
  }, 1500);

  req.on('close', () => clearInterval(interval));
});

// Generate preview HTML (streaming)
uiReviewRouter.post('/:id/preview', async (req, res) => {
  // Disable compression for SSE
  (req as any).headers['x-no-compression'] = 'true';
  (res as any).flush = (res as any).flush || (() => {});

  const userId = req.user!.id;
  const { id } = req.params;
  const { preferences } = req.body || {};

  const db = getDatabase();
  const review = db.prepare('SELECT * FROM ui_reviews WHERE id = ? AND user_id = ?').get(id, userId) as any;
  if (!review) return res.status(404).json({ error: 'Not found' });
  if (review.status !== 'completed') return res.status(400).json({ error: 'Review not completed yet' });

  let crawlDataParsed;
  try { crawlDataParsed = JSON.parse(review.crawl_data || '{}'); } catch { crawlDataParsed = {}; }
  let ruleResults;
  try { ruleResults = JSON.parse(review.rule_results || '[]'); } catch { ruleResults = []; }
  let dimensionScores;
  try { dimensionScores = JSON.parse(review.dimension_scores || '{}'); } catch { dimensionScores = {}; }
  let referenceAnalysis;
  try { referenceAnalysis = review.reference_analysis ? JSON.parse(review.reference_analysis) : undefined; } catch { referenceAnalysis = undefined; }

  const reviewData: ReviewData = {
    url: review.url,
    industryType: review.industry_type || 'corporate',
    totalScore: review.total_score,
    dimensionScores,
    ruleResults,
    llmAnalysis: review.llm_analysis || '',
    crawlData: {
      ...crawlDataParsed,
      screenshot: Buffer.alloc(0),
      html: '',
      elementData: [],
    },
    techStack: crawlDataParsed.techStack || [],
  };

  const skillMarkdown = review.skill_markdown || '';
  const previewHtml = await streamPreviewHtml(reviewData, referenceAnalysis, skillMarkdown, userId, res, preferences);
  if (previewHtml) {
    db.prepare('UPDATE ui_reviews SET preview_html = ? WHERE id = ?').run(previewHtml, id);
  }
});

// Regenerate skill markdown with user preferences
uiReviewRouter.post('/:id/regenerate-skill', async (req, res) => {
  const userId = req.user!.id;
  const { id } = req.params;
  const { preferences } = req.body || {};

  const db = getDatabase();
  const review = db.prepare('SELECT * FROM ui_reviews WHERE id = ? AND user_id = ?').get(id, userId) as any;
  if (!review) return res.status(404).json({ error: 'Not found' });
  if (review.status !== 'completed') return res.status(400).json({ error: 'Review not completed yet' });

  let crawlDataParsed;
  try { crawlDataParsed = JSON.parse(review.crawl_data || '{}'); } catch { crawlDataParsed = {}; }
  let ruleResults;
  try { ruleResults = JSON.parse(review.rule_results || '[]'); } catch { ruleResults = []; }
  let dimensionScores;
  try { dimensionScores = JSON.parse(review.dimension_scores || '{}'); } catch { dimensionScores = {}; }
  let referenceAnalysis;
  try { referenceAnalysis = review.reference_analysis ? JSON.parse(review.reference_analysis) : undefined; } catch { referenceAnalysis = undefined; }

  const reviewData: ReviewData = {
    url: review.url,
    industryType: review.industry_type || 'corporate',
    totalScore: review.total_score,
    dimensionScores,
    ruleResults,
    llmAnalysis: review.llm_analysis || '',
    crawlData: {
      ...crawlDataParsed,
      screenshot: Buffer.alloc(0),
      html: '',
      elementData: [],
    },
    techStack: crawlDataParsed.techStack || [],
  };

  try {
    const skillMarkdown = await generateSkillMarkdown(reviewData, referenceAnalysis, userId, preferences);
    db.prepare('UPDATE ui_reviews SET skill_markdown = ? WHERE id = ?').run(skillMarkdown, id);
    res.json({ skill_markdown: skillMarkdown });
  } catch (e: any) {
    console.error('[ui-review] Skill regeneration failed:', e);
    res.status(500).json({ error: e.message || 'Skill regeneration failed' });
  }
});

uiReviewRouter.get('/history', (req, res) => {
  const userId = req.user!.id;
  const db = getDatabase();
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const pageSize = Math.min(50, parseInt(req.query.page_size as string) || 20);
  const offset = (page - 1) * pageSize;

  const total = (db.prepare('SELECT COUNT(*) as count FROM ui_reviews WHERE user_id = ?').get(userId) as any).count;
  const items = db.prepare(
    'SELECT id, url, status, industry_type, total_score, screenshot_url, created_at, completed_at FROM ui_reviews WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
  ).all(userId, pageSize, offset);

  res.json({ items, total, page, page_size: pageSize });
});

uiReviewRouter.get('/:id/skill', (req, res) => {
  const userId = req.user!.id;
  const db = getDatabase();
  const review = db.prepare('SELECT skill_markdown FROM ui_reviews WHERE id = ? AND user_id = ?').get(req.params.id, userId) as any;
  if (!review) return res.status(404).json({ error: 'Review not found' });
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.send(review.skill_markdown || '');
});

uiReviewRouter.get('/:id', (req, res) => {
  const userId = req.user!.id;
  const db = getDatabase();
  const review = db.prepare('SELECT * FROM ui_reviews WHERE id = ? AND user_id = ?').get(req.params.id, userId);
  if (!review) return res.status(404).json({ error: 'Review not found' });
  res.json(review);
});

// ==================== Auto Seed ====================

export function seedUiReviewDefaults(): void {
  const db = getDatabase();

  // Seed rules if empty
  const ruleCount = (db.prepare('SELECT COUNT(*) as count FROM ui_review_rules').get() as any).count;
  if (ruleCount === 0) {
    const now = new Date().toISOString();
    const rules = [
      { name: '大标题排版', dimension: 'typography', description: '检测大标题字距是否收紧 (tracking-tighter)，避免松散的 AI 默认排版', detection_type: 'css', severity: 'warning', weight: 2.0, config: { checker: 'typography_tracking' } },
      { name: '反居中偏见', dimension: 'layout', description: '检测是否过度依赖居中排版，鼓励使用不对称的 40/60 布局', detection_type: 'dom', severity: 'info', weight: 1.5, config: { checker: 'anti_center_bias' } },
      { name: '圆角秩序', dimension: 'spacing', description: '检测全站组件的圆角值是否高度一致（如统一 12px 或直角）', detection_type: 'css', severity: 'warning', weight: 1.5, config: { checker: 'border_radius_consistency' } },
      { name: '紫色渐变禁令', dimension: 'color', description: '检测是否滥用了廉价的 AI 默认紫色/蓝色发光渐变 (The Lila Rule)', detection_type: 'css', severity: 'error', weight: 2.0, config: { checker: 'lila_rule' } },
      { name: '阴影质感', dimension: 'color', description: '检测是否存在劣质的纯黑阴影 (rgba(0,0,0,x))，要求使用环境色弥散阴影', detection_type: 'css', severity: 'warning', weight: 1.5, config: { checker: 'shadow_quality' } },
      { name: '触觉反馈', dimension: 'interaction', description: '检测按钮是否有原生的物理按压感 (:active 状态下的位移或缩放)', detection_type: 'css', severity: 'warning', weight: 1.5, config: { checker: 'tactile_feedback' } },
      { name: '颜色对比度', dimension: 'contrast', description: '检测文字与背景的对比度是否符合 WCAG AA 标准 (4.5:1)', detection_type: 'css', severity: 'error', weight: 2.0, config: { checker: 'contrast_ratio', threshold: 4.5 } },
      { name: '颜色收敛度', dimension: 'color', description: '检测页面使用的颜色数量是否收敛', detection_type: 'css', severity: 'info', weight: 1.0, config: { checker: 'color_convergence', maxColors: 8 } },
      { name: '字体数量', dimension: 'typography', description: '检测字体家族数量是否过多', detection_type: 'css', severity: 'warning', weight: 1.0, config: { checker: 'font_count', maxFonts: 3 } },
      { name: '响应式标签', dimension: 'layout', description: '检测是否存在响应式 viewport meta 标签', detection_type: 'dom', severity: 'critical', weight: 2.0, config: { checker: 'responsive_meta' } },
      { name: '图片替代文本', dimension: 'interaction', description: '检测图片是否缺少 alt 文本', detection_type: 'dom', severity: 'warning', weight: 1.0, config: { checker: 'image_alt' } },
      { name: '标题结构', dimension: 'layout', description: '检测标题结构是否语义化 (H1 存在且唯一)', detection_type: 'dom', severity: 'warning', weight: 1.0, config: { checker: 'heading_structure' } },
    ];

    const stmt = db.prepare(`
      INSERT INTO ui_review_rules (id, name, dimension, description, detection_type, detection_config, weight, severity, industry_weights, enabled, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}', 1, ?, ?, ?)
    `);
    rules.forEach((r, i) => {
      stmt.run(uuidv4(), r.name, r.dimension, r.description, r.detection_type, JSON.stringify(r.config), r.weight, r.severity, i, now, now);
    });
    console.log('[ui-review] Seeded 12 default scoring rules');
  } else {
    // Update existing English-named rules to Chinese
    const nameMap: Record<string, string> = {
      'contrast_ratio': '颜色对比度',
      'font_hierarchy': '标题层级',
      'spacing_consistency': '间距一致性',
      'click_target_size': '点击区域大小',
      'color_convergence': '颜色收敛度',
      'font_count': '字体数量',
      'text_readability': '文本可读性',
      'cta_prominence': 'CTA 突出度',
      'responsive_meta': '响应式标签',
      'image_alt': '图片替代文本',
      'heading_structure': '标题结构',
      'performance_load': '加载性能',
    };
    const updateStmt = db.prepare('UPDATE ui_review_rules SET name = ?, updated_at = ? WHERE name = ?');
    const now = new Date().toISOString();
    for (const [oldName, newName] of Object.entries(nameMap)) {
      updateStmt.run(newName, now, oldName);
    }
  }

  // Seed a default style skill if empty, or update existing Anti-Slop skill
  const antiSlopSkill = db.prepare('SELECT id FROM ui_style_skills WHERE name = ?').get('Anti-Slop 高级编辑风') as any;
  const now = new Date().toISOString();
  
  const perfectSkillTemplate = `# Anti-Slop Design Protocol (高级编辑风设计规范)

本规范旨在消除 LLM 生成前端代码时常见的“AI 廉价感”（AI Slop），构建具备顶级 SaaS 质感、克制色彩与细腻微交互的现代 Web 界面。

## 0. BRIEF INFERENCE (动手前先读懂需求)
- **目标受众**：B2B、创意机构、DTC 消费品等
- **目标情绪**：克制、高能、高级感、粗野主义等
- **强制输出**：在写任何代码前，必须输出一行：\`Design Read: [受众]. [Dial 1], [Dial 2], [Dial 3]. [排版策略].\`
- **反默认纪律**：拒绝“居中标题 + 3列特征卡片 + 紫色渐变按钮”的默认状态。主动打破肌肉记忆。

## 1. Typography (排版纪律)
- **大标题 (Hero)**: 必须使用 \`tracking-tighter leading-none\`，收紧字距，极具视觉张力。例如：\`text-5xl md:text-7xl font-extrabold tracking-tighter leading-none text-gray-900\`
- **正文 (Body)**: 限制宽度以提升可读性，默认使用 \`max-w-[65ch] leading-relaxed text-gray-600\`。
- **无衬线体优先**: 默认严禁使用衬线体。必须使用现代无衬线体（如 Geist, Inter, SF Pro）。
- **斜体下沉保护**: 使用大标题斜体时，为 \`y, g, p\` 等字母保留底部空间（\`pb-1\` 或 \`leading-[1.1]\`）。

## 2. Color & Material (色彩与材质)
- **紫色禁令 (The Lila Rule)**：严禁使用 AI 默认的紫色/蓝色发光渐变 (\`from-purple-500 to-blue-500\`)！
- **高级色彩搭配**：避免“米白背景+红铜色+墨黑文字”的陈词滥调。尝试“冷银色+冷灰”、“纯黑+纯白+高饱和单色”。
- **阴影法则**：禁止使用 \`rgba(0,0,0,x)\` 的纯黑干瘪阴影，必须混入环境色。例如使用 \`shadow-sm shadow-gray-200/50\`，或者多层弥散阴影。
- **圆角一致性**：全站锁定一种圆角风格（如统一 \`rounded-xl\` 即 12px，或全直角 \`rounded-none\`），绝不可混用。

## 3. Layout & Structure (布局结构)
- **反居中偏见**：不要每个模块都使用 \`text-center flex flex-col items-center\`。尝试 40/60 不对称分栏、左文右图布局。
- **Hero 区纪律**：Hero 必须在一屏内，标题最多 2 行，副标题最多 20 字。顶部间距最大 \`pt-24\`。
- **眉题限制**：禁止在每个区块上方都加一行全大写的 \`tracking-widest\` 标签。每 3 个区块最多允许 1 个。
- **Bento 网格规则**：便当盒网格必须刚好填满内容，绝对不允许留空网格。

## 4. Components & Details (组件细节规范)

### 4.1 表格设计 (Data Tables)
- **呼吸感留白**：单元格必须有充足的 padding，例如 \`py-4 px-6\`，拒绝拥挤。
- **表头弱化**：表头不需要强烈的背景色，使用极淡的灰色（如 \`bg-gray-50/50\`）或透明，文字使用 \`text-sm font-semibold text-gray-500\`。
- **极细边框**：仅保留底边框，使用极淡的颜色 \`border-b border-gray-100\`，去除垂直边框。
- **悬停反馈**：行 Hover 时使用极淡的背景色 \`hover:bg-gray-50/80\`，不要过分抢眼。

**示例代码 (Table):**
\`\`\`html
<div class="w-full overflow-hidden rounded-xl border border-gray-100 shadow-sm shadow-gray-200/50 bg-white">
  <table class="w-full text-left border-collapse">
    <thead>
      <tr class="bg-gray-50/50">
        <th class="py-4 px-6 text-sm font-semibold text-gray-500 border-b border-gray-100">User</th>
        <th class="py-4 px-6 text-sm font-semibold text-gray-500 border-b border-gray-100">Role</th>
      </tr>
    </thead>
    <tbody>
      <tr class="hover:bg-gray-50/80 transition-colors group">
        <td class="py-4 px-6 text-sm text-gray-900 border-b border-gray-50">Alice</td>
        <td class="py-4 px-6 text-sm text-gray-600 border-b border-gray-50">Admin</td>
      </tr>
    </tbody>
  </table>
</div>
\`\`\`

### 4.2 列表设计 (Unordered Lists)
- **去除默认圆点**：使用自定义的极简图标（如 Lucide 的 Check 或 ArrowRight）代替原生的 \`list-disc\`。
- **间距控制**：列表项之间增加合理的间距 \`space-y-3\`。
- **图标对齐**：确保图标与多行文本的第一行顶部对齐，使用 \`flex items-start gap-3\`。

**示例代码 (List):**
\`\`\`html
<ul class="space-y-3">
  <li class="flex items-start gap-3 text-gray-600">
    <Check class="w-5 h-5 text-gray-400 shrink-0 mt-0.5" stroke-width="1.5" />
    <span class="leading-relaxed">Advanced typographic scale with tight tracking.</span>
  </li>
  <li class="flex items-start gap-3 text-gray-600">
    <Check class="w-5 h-5 text-gray-400 shrink-0 mt-0.5" stroke-width="1.5" />
    <span class="leading-relaxed">Strict adherence to environmental shadows and tactile feedback.</span>
  </li>
</ul>
\`\`\`

### 4.3 交互与按钮 (Interactive & Buttons)
- **触觉反馈 (Tactile Feedback)**：按钮 \`:active\` 状态必须有 \`-translate-y-[1px]\` 或 \`scale-[0.98]\` 的物理按压感。
- **CTA 折行禁令**：桌面端按钮文字绝对不允许折行。
- **优雅的 Focus**：必须提供 \`:focus-visible\` 状态，如 \`focus-visible:ring-2 focus-visible:ring-gray-200 focus-visible:ring-offset-2\`。

**示例代码 (Button):**
\`\`\`html
<button class="inline-flex items-center justify-center px-6 py-3 text-sm font-medium text-white bg-gray-900 rounded-xl hover:bg-gray-800 active:scale-[0.98] transition-all shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2">
  Get Started
</button>
\`\`\`

### 4.4 背景图案与纹理 (Background & Textures)
- **拒绝廉价渐变**：不要使用生硬的线性渐变作为全屏背景。
- **微噪点与网格**：倾向于使用极淡的网格线 (\`bg-grid-slate-100\`)、点状图案 (\`bg-dot-slate-200\`) 或 CSS 噪点纹理，以增加物理材质感。
- **背景模糊 (Glassmorphism)**：使用 \`backdrop-blur-md bg-white/70\` 结合极细边框 \`border border-white/20\` 来实现高级毛玻璃效果，不要过度降低不透明度。

**示例代码 (Background Grid):**
\`\`\`html
<div class="relative w-full min-h-screen bg-white">
  <!-- Subtle Grid Pattern -->
  <div class="absolute inset-0 bg-[url('/grid.svg')] bg-center [mask-image:linear-gradient(180deg,white,rgba(255,255,255,0))]"></div>
  <!-- Content -->
  <div class="relative z-10">...</div>
</div>
\`\`\`

## 5. Performance & AI Tells (性能与 AI 露馅特征)
- **硬件加速**：动画必须使用 \`transform\` 和 \`opacity\`，严禁动画化 \`margin\` 或 \`height\`。
- **AI 露馅特征（必须避免）**：
  - 滥用 \`bg-gradient-to-r from-purple-500 to-blue-500\`。
  - 大标题忘记加 \`tracking-tighter\`。
  - 强行混用衬线体和无衬线体。
  - 页面里每一个模块都是居中的。
  - 使用 "Jane Doe", "Acme Corp" 等假名。
  - 终极禁忌：在每个副标题或引言里使用破折号（—）。

## 6. FINAL PRE-FLIGHT CHECK (起飞前最后检查)
1. 页面所有的圆角风格统一了吗？
2. 主题色是否收敛到了唯一的一个？
3. 大标题的字距是否使用了 \`tracking-tighter\` 收紧？
4. 是否删除了毫无意义的卡片外层边框？
5. 是否清除了所有 AI 默认的紫色/蓝色渐变发光？
6. CTAs (按钮) 是否在一行内展示完毕？
如果全部通过，输出即可。`;

  if (!antiSlopSkill) {
    db.prepare(`
      INSERT INTO ui_style_skills (id, name, description, design_features, thumbnail_url, industry_type, skill_template, enabled, usage_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, '', '', ?, 1, 0, ?, ?)
    `).run(
      uuidv4(),
      'Anti-Slop 高级编辑风',
      '拒绝廉价的 AI 默认设计，严格执行顶级排版、色彩与间距纪律。具备高视觉张力、克制的色彩和细腻的微交互。',
      JSON.stringify({
        palette: ['#0A0A0A', '#FFFFFF', '#18181B', '#F3F4F6', '#10B981'],
        spacing_style: 'asymmetric and spacious',
        layout: '40/60 split, minimal centering, high variance',
        font_style: 'modern sans-serif (Geist/Inter), tight tracking (tracking-tighter) for headings',
        vibe: 'editorial, anti-slop, premium',
        border_radius: 'strict 12px or sharp corners (0px)',
        shadow: 'environmental diffused shadows, NO pure black shadows',
        animation: 'tactile feedback on active (scale-98)',
      }),
      perfectSkillTemplate,
      now, now
    );
    console.log('[ui-review] Seeded 1 default style skill (Anti-Slop)');
  } else {
    // Update the existing skill to use the perfect template
    db.prepare('UPDATE ui_style_skills SET skill_template = ?, updated_at = ? WHERE id = ?').run(
      perfectSkillTemplate,
      now,
      antiSlopSkill.id
    );
    console.log('[ui-review] Updated existing Anti-Slop style skill template');
  }

  // Seed SEO pages for /ui-review (zh + en)
  const existingSeo = db.prepare("SELECT id FROM seo_pages WHERE path = '/ui-review' AND locale = 'zh'").get();
  if (!existingSeo) {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO seo_pages (id, path, locale, title, description, keywords, og_title, og_description, og_image, canonical, no_index, json_ld, priority, changefreq, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', '', 0, '', ?, 'weekly', ?, ?)
    `).run(
      uuidv4(), '/ui-review', 'zh',
      'Web UI 测评 - AI 驱动的设计质感评分与优化 | QiaoNan',
      '输入网址即可获得专业的 UI 设计评分报告，覆盖排版、色彩、间距、布局、一致性、质感六大维度，并生成像素级优化代码。',
      'UI测评,网页设计评分工具,AI自动审查网页设计,在线UI评分,网站设计优化方案,如何提升网页设计质感,SaaS产品UI优化,免费网页设计检测,前端页面视觉评分,网站配色分析工具,AI生成前端优化代码',
      'Web UI 测评 - AI 设计优化引擎',
      '输入产品网址，获取对标顶尖 SaaS 平台的像素级优化方案与重构代码。',
      0.8, now, now
    );
    db.prepare(`
      INSERT INTO seo_pages (id, path, locale, title, description, keywords, og_title, og_description, og_image, canonical, no_index, json_ld, priority, changefreq, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', '', 0, '', ?, 'weekly', ?, ?)
    `).run(
      uuidv4(), '/ui-review', 'en',
      'Web UI Review - AI-Powered Design Quality Scoring & Optimization | QiaoNan',
      'Enter any URL to get a professional UI design quality report covering typography, color, spacing, layout, consistency and aesthetics, with pixel-perfect optimization code.',
      'UI review tool online,AI website design scorer,how to improve website design quality,free UI audit tool,web page visual analysis,SaaS UI optimization,automated design feedback,website color harmony checker,typography scoring tool,AI generated CSS optimization',
      'Web UI Review - AI Design Optimization Engine',
      'Enter your product URL to get pixel-perfect optimization aligned with top-tier SaaS standards.',
      0.8, now, now
    );
    console.log('[ui-review] Seeded SEO pages for /ui-review (zh + en)');
  }
}
