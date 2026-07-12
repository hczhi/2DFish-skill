import type { Response } from 'express';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { aiGateway, aiGatewayStream, QuotaExceededError } from '../../core/llm/gateway.js';
import { getDatabase } from '../../db/index.js';
import type { CrawlResult } from './crawlerService.js';
import type { RuleResult } from './ruleEngine.js';
import type { ReferenceAnalysis } from './analysisService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface ReviewData {
  url: string;
  industryType: string;
  totalScore: number;
  dimensionScores: Record<string, number>;
  ruleResults: RuleResult[];
  llmAnalysis: string;
  crawlData: CrawlResult;
  techStack: string[];
}

export interface UserPreferences {
  targetStyle: string;       // e.g. 'minimal', 'premium', 'brand-consistent', 'creative'
  priorityDimensions: string[];  // e.g. ['typography', 'colorHarmony'] — user picks 2-3 from scored dims
  preserveElements: string[];    // e.g. ['brand-color', 'logo-position', 'navigation-structure']
}

function loadBestMatchingSkillTemplate(industryType: string): { name: string; skill_template: string; design_features: any } | null {
  const db = getDatabase();

  // Try industry-specific skill first
  let skill = db.prepare(
    "SELECT name, skill_template, design_features FROM ui_style_skills WHERE enabled = 1 AND industry_type = ? ORDER BY usage_count DESC LIMIT 1"
  ).get(industryType) as any;

  // Fallback to any enabled skill (most used)
  if (!skill) {
    skill = db.prepare(
      "SELECT name, skill_template, design_features FROM ui_style_skills WHERE enabled = 1 ORDER BY usage_count DESC LIMIT 1"
    ).get() as any;
  }

  if (!skill) return null;

  return {
    name: skill.name,
    skill_template: skill.skill_template || '',
    design_features: typeof skill.design_features === 'string'
      ? JSON.parse(skill.design_features || '{}')
      : skill.design_features,
  };
}

const DIMENSION_TO_SECTION: Record<string, string> = {
  typography: '排版层级',
  colorHarmony: '色彩和谐',
  spacing: '间距与留白',
  layout: '布局结构',
  consistency: '视觉一致性',
  aesthetics: '整体质感与细节',
};

let _knowledgeBaseCache: string | null = null;

function loadKnowledgeBase(): string {
  if (_knowledgeBaseCache) return _knowledgeBaseCache;
  try {
    const kbPath = resolve(__dirname, '../../../../skills/UI_TASTE_KNOWLEDGE.md');
    _knowledgeBaseCache = readFileSync(kbPath, 'utf-8');
    return _knowledgeBaseCache;
  } catch {
    return '';
  }
}

function extractRelevantKnowledge(dimensionScores: Record<string, number>): string {
  const kb = loadKnowledgeBase();
  if (!kb) return '';

  // Find dimensions scoring below 75 — these need knowledge injection
  const weakDimensions = Object.entries(dimensionScores)
    .filter(([, score]) => score < 75)
    .sort(([, a], [, b]) => a - b)
    .map(([dim]) => dim);

  if (weakDimensions.length === 0) return '';

  const sections: string[] = [];
  for (const dim of weakDimensions.slice(0, 4)) {
    const sectionTitle = DIMENSION_TO_SECTION[dim];
    if (!sectionTitle) continue;

    // Extract the relevant section from the knowledge base
    const sectionRegex = new RegExp(`## \\d+\\. ${sectionTitle}[^]*?(?=\\n## \\d+\\.|$)`);
    const match = kb.match(sectionRegex);
    if (match) {
      sections.push(`### ${dim} (得分: ${dimensionScores[dim]}/100)\n${match[0].slice(0, 1200)}`);
    }
  }

  return sections.join('\n\n');
}

/**
 * Build the dimension scores summary for the diagnosis section.
 */
function formatDimensionScores(scores: Record<string, number>): string {
  return Object.entries(scores)
    .sort(([, a], [, b]) => a - b) // worst first
    .map(([dim, score]) => `- **${dim}**: ${score}/100`)
    .join('\n');
}

/**
 * Group failed rules by dimension for structured diagnosis output.
 */
function groupRulesByDimension(rules: RuleResult[]): Record<string, RuleResult[]> {
  const groups: Record<string, RuleResult[]> = {};
  for (const rule of rules) {
    if (!groups[rule.dimension]) groups[rule.dimension] = [];
    groups[rule.dimension].push(rule);
  }
  return groups;
}

export async function generateSkillMarkdown(
  reviewData: ReviewData,
  referenceAnalysis?: ReferenceAnalysis,
  userId?: string,
  userPreferences?: UserPreferences
): Promise<string> {
  const failedRules = reviewData.ruleResults.filter(r => !r.passed);
  const groupedIssues = groupRulesByDimension(failedRules);

  // Load the best matching skill template from admin-managed skills
  const styleSkill = loadBestMatchingSkillTemplate(reviewData.industryType);

  // Extract relevant knowledge based on weak dimensions
  const relevantKnowledge = extractRelevantKnowledge(reviewData.dimensionScores);

  // Build grouped issues text
  const groupedIssuesText = Object.keys(groupedIssues)
    .sort((a, b) => (reviewData.dimensionScores[a] || 100) - (reviewData.dimensionScores[b] || 100))
    .map(dim => {
      const rules = groupedIssues[dim];
      const items = rules.map((r, i) =>
        `${i + 1}. [${r.severity.toUpperCase()}] ${r.name}: ${r.details}${r.affectedElements?.length ? '\n   影响元素: ' + r.affectedElements.join(', ') : ''}`
      ).join('\n');
      return `### ${dim} (${reviewData.dimensionScores[dim] || '?'}/100)\n${items}`;
    })
    .join('\n\n');

  // Determine industry benchmark
  const industryBenchmark = reviewData.industryType === 'saas'
    ? '标杆：Linear、Vercel、Notion。特征：极度克制、功能优先、无衬线字体、中性色底 + 单一强调色。'
    : reviewData.industryType === 'ecommerce'
      ? '标杆：Apple Store、Shopify。特征：产品图片为核心、留白慷慨、可适度使用衬线体。'
      : reviewData.industryType === 'content'
        ? '标杆：Medium、Substack。特征：阅读体验优先、排版极致、单栏为主、最小化干扰。'
        : '标杆：Stripe、Linear Marketing。特征：视觉冲击力强、叙事性布局、克制但有记忆点。';

  const prompt = `你是一位资深前端设计工程师，拥有 10 年以上审美经验。你的任务是为这个网页生成一份"AI 可执行的修改指令清单"——用户会直接把这份输出复制给 Cursor/Claude 等 AI 编程工具来执行修改。

## 核心原则
1. 每条指令必须精确到选择器和属性值，不要泛泛而谈
2. 指令分三级：[CSS调优]（只改样式值）、[结构调整]（调整 HTML 结构）、[布局重构]（重新设计 section 布局）
3. 按影响力排序：先输出能最大幅度提升观感的改动
4. 说明"为什么改"——让执行的 AI 理解设计意图，而不是盲目执行

---

## 被评审页面信息
- URL: ${reviewData.url}
- 技术栈: ${reviewData.techStack.join(', ')}
- 综合得分: ${reviewData.totalScore}/100
- 行业: ${reviewData.industryType || 'general'}
- 行业基准: ${industryBenchmark}

## 各维度得分
${formatDimensionScores(reviewData.dimensionScores)}

## 检测到的具体问题
${groupedIssuesText}

## 页面当前设计参数
- 字体: ${reviewData.crawlData.fonts.join(', ') || '未检测到'}
- 颜色: ${reviewData.crawlData.colors.slice(0, 10).join(', ') || '未检测到'}
- DOM 结构摘要: ${reviewData.crawlData.domSummary?.slice(0, 500) || '无'}

${styleSkill ? `## 设计系统参考 ("${styleSkill.name}")
- 色板: ${styleSkill.design_features.palette?.join(', ') || '继承页面'}
- 间距风格: ${styleSkill.design_features.spacing_style || '一致的 8px 网格'}
- 布局: ${styleSkill.design_features.layout || '标准'}
- 字体风格: ${styleSkill.design_features.font_style || '现代无衬线'}
- 圆角: ${styleSkill.design_features.border_radius || '统一'}
- 阴影: ${styleSkill.design_features.shadow || '环境色调阴影'}
` : ''}

## 审美标准参考（针对薄弱维度）
${relevantKnowledge || '（所有维度得分 ≥ 75，无需额外参考）'}

---

## 输出格式（严格遵循）

输出一份可以直接复制给 AI 编程工具的指令文档，格式如下：

\`\`\`
你是一个高级前端工程师，需要按以下清单优化这个页面的视觉设计。
每条改动都有明确的选择器和目标值，请逐条执行。
不要改动业务逻辑和数据绑定，只调整视觉呈现。

页面：${reviewData.url}
技术栈：${reviewData.techStack.join(', ')}
核心问题：[用1-2句话概括这个页面最大的视觉问题]

---

[逐条列出修改指令，每条格式如下]

[级别] 标题
选择器/目标区域：xxx
现状：具体描述当前的问题状态
改为：具体的目标状态（包含属性值或结构描述）
原因：为什么这样改能提升观感
${/* 如果涉及代码 */''}\`\`\`css
具体的 CSS 代码
${''}\`\`\`
\`\`\`

## 输出规则
- 输出 8-15 条修改指令
- 前 3 条应该是影响最大的改动（通常是布局或排版问题）
- 每条指令必须具体到这个页面的真实选择器或元素
- [布局重构] 级别的指令要描述目标布局的视觉效果
- [CSS调优] 级别的指令要给出具体的 CSS 属性和值
- 不要输出泛泛的建议如"优化间距"，要说"padding: 16px → 32px"
- 如果当前字体是系统默认字体，推荐具体的替代字体
- 总输出 1000-1500 字，密实有料，不灌水`;

  try {
    const { response } = await aiGateway(
      { messages: [{ role: 'user', content: prompt }], temperature: 0.6, max_tokens: 8000 },
      { userId: userId || 'system', source: 'ui-review', operation: 'generate-skill' }
    );

    // Increment usage count for the matched skill
    if (styleSkill) {
      const db = getDatabase();
      db.prepare("UPDATE ui_style_skills SET usage_count = usage_count + 1 WHERE name = ?").run(styleSkill.name);
    }

    return response.choices[0]?.message?.content || '';
  } catch (e) {
    console.error('[ui-review] Skill generation failed:', e);
    return `# UI 优化指令\n\n生成失败，请重试。`;
  }
}

export async function streamPreviewHtml(
  reviewData: ReviewData,
  referenceAnalysis: ReferenceAnalysis | undefined,
  skillMarkdown: string,
  userId: string,
  res: Response,
  userPreferences?: UserPreferences
): Promise<string> {
  const failedRules = reviewData.ruleResults.filter(r => !r.passed);

  const targetStyle = userPreferences?.targetStyle || 'professional';
  const preserveElements = userPreferences?.preserveElements || [];

  const styleDescription = targetStyle === 'minimal'
    ? 'Clean, reduced, generous whitespace, restrained palette'
    : targetStyle === 'premium'
      ? 'Luxurious, refined typography, subtle depth, sophisticated color'
      : targetStyle === 'brand-consistent'
        ? 'On-brand, cohesive, matching existing brand guidelines exactly'
        : targetStyle === 'creative'
          ? 'Bold, expressive, dynamic, visually memorable'
          : 'Professional, balanced, modern';

  // Load admin skill design tokens
  const styleSkill = loadBestMatchingSkillTemplate(reviewData.industryType);
  const designTokens = styleSkill?.design_features || {};

  const prompt = `You are a CSS optimization specialist. Generate a targeted CSS stylesheet that fixes the design issues on this webpage.

## Output Format
Output ONLY valid CSS code. No HTML, no markdown fences, no explanations.
Add a short /* comment */ before each rule group to name the issue being fixed.

## Design System Tokens (authority)
- Palette: ${designTokens.palette?.join(', ') || reviewData.crawlData.colors.slice(0, 5).join(', ')}
- Font: ${designTokens.font_style || 'modern sans-serif, tight tracking for headings'}
- Spacing: ${designTokens.spacing_style || 'consistent 8px grid'}
- Border Radius: ${designTokens.border_radius || 'consistent'}
- Shadow: ${designTokens.shadow || 'environmental, no pure black'}
- Aesthetic: ${styleDescription}

## Page Info
- URL: ${reviewData.url}
- Current fonts: ${reviewData.crawlData.fonts.slice(0, 4).join(', ')}
- Current colors: ${reviewData.crawlData.colors.slice(0, 8).join(', ')}

## DOM Structure
${reviewData.crawlData.domSummary}

## Issues to Fix
${failedRules.slice(0, 12).map((r, i) => `${i + 1}. [${r.severity}] ${r.name}: ${r.details}${r.affectedElements?.length ? ' → ' + r.affectedElements.slice(0, 3).join(', ') : ''}`).join('\n')}

${referenceAnalysis ? `## Reference Style Target
- Vibe: ${referenceAnalysis.overallVibe}, Palette: ${referenceAnalysis.palette.join(', ')}, Spacing: ${referenceAnalysis.spacingStyle}, Font: ${referenceAnalysis.fontStyle}` : ''}
${preserveElements.length ? `## DO NOT touch: ${preserveElements.join(', ')}` : ''}

## Rules
- Use the page's real CSS selectors from the DOM structure.
- 20-40 rules max. Each fixes one specific issue.
- Use !important only when needed for specificity.
- Start with @import for a premium Google Font if current fonts are generic.
- Output CSS only, starting now:`;

  // Set up SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if ((res as any).flush) (res as any).flush();
  res.flushHeaders();

  const send = (data: object) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    if ((res as any).flush) (res as any).flush();
  };

  send({ status: 'connecting' });

  let cssOutput = '';

  try {
    send({ status: 'generating' });

    const { stream, onComplete } = await aiGatewayStream(
      { messages: [{ role: 'user', content: prompt }], temperature: 0.5, max_tokens: 3000 },
      { userId, source: 'ui-review', operation: 'generate-preview' }
    );

    const startTime = Date.now();
    let inputTokens = 0;
    let outputTokens = 0;

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      if (content) {
        cssOutput += content;
        outputTokens++;
        send({ css: content });
      }
      if (chunk.usage) {
        inputTokens = chunk.usage.prompt_tokens || 0;
        outputTokens = chunk.usage.completion_tokens || outputTokens;
      }
    }

    // Strip markdown fences if LLM wrapped it
    let cleanCss = cssOutput.trim();
    if (cleanCss.startsWith('```')) {
      cleanCss = cleanCss.replace(/^```\w*\n?/, '').replace(/\n?```\s*$/, '');
    }

    onComplete(inputTokens, outputTokens, Date.now() - startTime);
    send({ cssComplete: cleanCss, done: true });
    res.end();

    return cleanCss;
  } catch (e: any) {
    console.error('[ui-review] Preview stream error:', e);
    const msg = e instanceof QuotaExceededError
      ? e.message
      : (e.message || 'LLM 调用失败 / LLM call failed');
    send({ error: msg });
    res.end();
  }

  return '';
}
