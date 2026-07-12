import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { aiGateway } from '../../core/llm/gateway.js';
import type { CrawlResult } from './crawlerService.js';
import type { LLMScoringResult } from './analysisService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface ProDimensionAnalysis {
  dimension: string;
  score: number;
  deepAnalysis: { zh: string; en: string };
  specificIssues: Array<{
    location: string;
    current: string;
    expected: string;
    severity: 'critical' | 'major' | 'minor';
    fixCost: 'css' | 'structure' | 'refactor';
  }>;
  benchmark: string;
}

export interface ProAnalysisResult {
  dimensionAnalyses: ProDimensionAnalysis[];
  executionPlan: {
    phase1: string;
    phase2: string;
    phase3: string;
  };
  industryComparison: { zh: string; en: string };
  estimatedScoreAfterFix: number;
}

let _knowledgeCache: string | null = null;

function loadKnowledge(): string {
  if (_knowledgeCache) return _knowledgeCache;
  try {
    const kbPath = resolve(__dirname, '../../../../skills/UI_TASTE_KNOWLEDGE.md');
    _knowledgeCache = readFileSync(kbPath, 'utf-8');
    return _knowledgeCache;
  } catch {
    return '';
  }
}

function getKnowledgeForDimension(dimension: string): string {
  const kb = loadKnowledge();
  if (!kb) return '';

  const dimMap: Record<string, string> = {
    typography: '排版层级',
    colorHarmony: '色彩和谐',
    spacing: '间距与留白',
    layout: '布局结构',
    consistency: '视觉一致性',
    aesthetics: '整体质感与细节',
  };

  const title = dimMap[dimension];
  if (!title) return '';

  const regex = new RegExp(`## \\d+\\. ${title}[^]*?(?=\\n## \\d+\\.|$)`);
  const match = kb.match(regex);
  return match ? match[0] : '';
}

export async function runProDimensionAnalysis(
  dimension: string,
  score: number,
  issues: Array<{ zh: string; en: string }>,
  screenshotUrl: string,
  crawlData: CrawlResult,
  userId: string
): Promise<ProDimensionAnalysis> {
  const knowledge = getKnowledgeForDimension(dimension);

  const prompt = `你是一位审美标准极高的资深设计评审师。现在需要对这个页面的"${dimension}"维度进行深度分析。

## 当前评分：${score}/100

## 已发现的问题
${issues.map((i, idx) => `${idx + 1}. ${i.zh}`).join('\n')}

## 页面数据
- 字体: ${crawlData.fonts.slice(0, 5).join(', ')}
- 颜色: ${crawlData.colors.slice(0, 10).join(', ')}
- DOM 摘要: ${crawlData.domSummary?.slice(0, 600) || '无'}

## 审美标准参考
${knowledge.slice(0, 2000)}

---

请输出严格的 JSON（无 markdown 围栏）：
{
  "deepAnalysis": {
    "zh": "<3-5句深度分析：这个维度的核心问题是什么，根本原因是什么，对用户感知的影响是什么>",
    "en": "<Same in English>"
  },
  "specificIssues": [
    {
      "location": "<具体区域/section，如 'Hero Section', 'Navigation', 'Feature Cards'>",
      "current": "<当前状态的精确描述，带具体值>",
      "expected": "<应该是什么样，带具体值或参考>",
      "severity": "<critical/major/minor>",
      "fixCost": "<css/structure/refactor>"
    }
  ],
  "benchmark": "<1句话说明同行业标杆产品在这个维度是怎么做的>"
}

要求：
- specificIssues 必须 3-6 条，按严重程度排序
- location 要具体到页面 section，不要说"整个页面"
- current 和 expected 要有具体的数值/颜色值/尺寸
- benchmark 要点名一个具体产品（如 Linear、Stripe、Vercel）`;

  const messages: any[] = [
    {
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        ...(screenshotUrl ? [{ type: 'image_url', image_url: { url: screenshotUrl } }] : []),
      ],
    },
  ];

  try {
    const { response } = await aiGateway(
      { messages, temperature: 0.4, max_tokens: 1500 },
      { userId, source: 'ui-review', operation: `pro-analysis-${dimension}` }
    );
    const content = response.choices[0]?.message?.content || '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        dimension,
        score,
        deepAnalysis: parsed.deepAnalysis,
        specificIssues: parsed.specificIssues || [],
        benchmark: parsed.benchmark || '',
      };
    }
  } catch (e) {
    console.error(`[ui-review] Pro analysis for ${dimension} failed:`, e);
  }

  return {
    dimension,
    score,
    deepAnalysis: { zh: '分析失败', en: 'Analysis failed' },
    specificIssues: [],
    benchmark: '',
  };
}

export async function generateExecutionPlan(
  scoringResult: LLMScoringResult,
  dimensionAnalyses: ProDimensionAnalysis[],
  crawlData: CrawlResult,
  url: string,
  userId: string
): Promise<{ executionPlan: { phase1: string; phase2: string; phase3: string }; industryComparison: { zh: string; en: string }; estimatedScoreAfterFix: number }> {
  const issuesSummary = dimensionAnalyses
    .map(d => `${d.dimension}(${d.score}/100): ${d.specificIssues.map(i => `[${i.fixCost}] ${i.location}: ${i.current} → ${i.expected}`).join('; ')}`)
    .join('\n');

  const prompt = `你是一位资深前端设计工程师，需要为这个页面制定一份分阶段的优化执行方案。

## 页面信息
- URL: ${url}
- 综合评分: ${scoringResult.totalScore}/100
- AI生成感: ${scoringResult.aiGenerated ? '是' : '否'}
- 模板感: ${scoringResult.templateDetected ? '是' : '否'}
- 技术栈: ${crawlData.techStack.join(', ')}

## 各维度深度分析结果
${issuesSummary}

---

输出严格 JSON（无 markdown 围栏）：
{
  "executionPlan": {
    "phase1": "<第一阶段（快速见效，1-2小时）：列出 3-5 个 CSS 级别的改动，改完立刻能感受到提升。每条格式：选择器 + 改什么 + 改成什么>",
    "phase2": "<第二阶段（结构优化，半天）：列出 2-4 个需要调整 HTML 结构的改动。每条说清楚改哪个 section、当前结构、目标结构>",
    "phase3": "<第三阶段（锦上添花，可选）：列出 2-3 个能让页面从'还行'变成'精致'的细节改动，如微交互、过渡动画、质感细节>"
  },
  "industryComparison": {
    "zh": "<2-3句话对比同行业标杆，指出最大的差距在哪 1-2 个点>",
    "en": "<Same in English>"
  },
  "estimatedScoreAfterFix": <如果以上方案全部执行，预估分数能到多少，给个务实数字>
}`;

  try {
    const { response } = await aiGateway(
      { messages: [{ role: 'user', content: prompt }], temperature: 0.5, max_tokens: 2500 },
      { userId, source: 'ui-review', operation: 'pro-execution-plan' }
    );
    const content = response.choices[0]?.message?.content || '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    console.error('[ui-review] Pro execution plan failed:', e);
  }

  return {
    executionPlan: { phase1: '生成失败', phase2: '生成失败', phase3: '生成失败' },
    industryComparison: { zh: '对比分析不可用', en: 'Comparison unavailable' },
    estimatedScoreAfterFix: scoringResult.totalScore + 15,
  };
}
