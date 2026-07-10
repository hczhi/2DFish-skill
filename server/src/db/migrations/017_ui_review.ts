import { v4 as uuidv4 } from 'uuid';
import type { Migration } from '../migrator.js';

export const migration_017: Migration = {
  id: '017_ui_review',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS ui_reviews (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        url TEXT NOT NULL,
        reference_image_url TEXT DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending',
        industry_type TEXT DEFAULT '',
        total_score REAL DEFAULT 0,
        dimension_scores TEXT DEFAULT '{}',
        rule_results TEXT DEFAULT '[]',
        llm_analysis TEXT DEFAULT '',
        reference_analysis TEXT DEFAULT '',
        skill_markdown TEXT DEFAULT '',
        preview_html TEXT DEFAULT '',
        screenshot_url TEXT DEFAULT '',
        crawl_data TEXT DEFAULT '{}',
        error_message TEXT DEFAULT '',
        created_at TEXT NOT NULL,
        completed_at TEXT DEFAULT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_ui_reviews_user ON ui_reviews(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_ui_reviews_status ON ui_reviews(status);

      CREATE TABLE IF NOT EXISTS ui_review_rules (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        dimension TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        detection_type TEXT NOT NULL DEFAULT 'dom',
        detection_config TEXT NOT NULL DEFAULT '{}',
        weight REAL NOT NULL DEFAULT 1.0,
        severity TEXT NOT NULL DEFAULT 'warning',
        industry_weights TEXT DEFAULT '{}',
        enabled INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ui_style_skills (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        design_features TEXT NOT NULL DEFAULT '{}',
        thumbnail_url TEXT DEFAULT '',
        industry_type TEXT DEFAULT '',
        skill_template TEXT NOT NULL DEFAULT '',
        enabled INTEGER NOT NULL DEFAULT 1,
        usage_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    // Seed default rules
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
  },
};
