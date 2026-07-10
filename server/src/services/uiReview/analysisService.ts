import { aiGateway } from '../../core/llm/gateway.js';
import type { CrawlResult } from './crawlerService.js';

export interface DimensionScore {
  score: number;
  summary: { zh: string; en: string };
  issues: Array<{ zh: string; en: string }>;
}

export interface LLMScoringResult {
  totalScore: number;
  dimensions: {
    typography: DimensionScore;
    colorHarmony: DimensionScore;
    spacing: DimensionScore;
    layout: DimensionScore;
    consistency: DimensionScore;
    aesthetics: DimensionScore;
  };
  overallAnalysis: { zh: string; en: string };
}

export interface ReferenceAnalysis {
  palette: string[];
  spacingStyle: string;
  layoutCharacteristics: string;
  fontStyle: string;
  overallVibe: string;
}

const SCORING_PROMPT = `You are a world-class UI/UX design reviewer. You evaluate the VISUAL QUALITY of static web page designs — not performance, not interactivity, not code quality. Your standards come from top-tier SaaS products (Linear, Vercel, Stripe, Notion).

## Scoring Dimensions (each 0-100)

### 1. Typography (排版层级)
Evaluate: font hierarchy clarity, heading/body contrast, letter-spacing quality, font choice (premium sans-serif preferred), line-height rhythm, max line width for readability.
Deduct for: Inter font on "premium" pages, oversized H1 that screams, missing tight tracking on display text, serif fonts on dashboard/SaaS UI, excessive font families (>3).

### 2. Color Harmony (色彩和谐)
Evaluate: palette cohesion (max 1 accent color, saturation <80%), background/foreground contrast, shadow quality (no pure black shadows), accent usage restraint.
Deduct for: AI purple/blue neon gradients (the "Lila Ban"), oversaturated accents, gradient text on large headers, mixing warm and cool grays, pure #000000 black anywhere.

### 3. Spacing & Whitespace (间距与留白)
Evaluate: consistent spacing rhythm, breathing room between sections, padding uniformity, grid alignment, section separation clarity.
Deduct for: cramped layouts, inconsistent padding values, awkward floating element gaps, no clear spacing system (4px/8px grid).

### 4. Layout Structure (布局结构)
Evaluate: grid system usage, content hierarchy, asymmetric design variance (is it more interesting than centered-everything?), split-screen usage, meaningful white space zones.
Deduct for: generic 3-equal-column card rows, excessive text-center on everything (anti-center bias), no clear content grouping, h-screen misuse.

### 5. Visual Consistency (视觉一致性)
Evaluate: border-radius uniformity across components, icon style consistency (strokeWidth), shadow style consistency, button style uniformity, overall design system coherence.
Deduct for: mixed border-radius values (rounded-sm alongside rounded-2xl), inconsistent icon weights, different shadow styles on same-level elements, no design tokens visible.

### 6. Overall Aesthetics (整体质感)
Evaluate: does this feel expensive and polished? Professional impression, modern design language, attention to detail, "would this look at home on Dribbble/Awwwards?", uniqueness vs template feel.
Deduct for: generic/template appearance, "AI-generated" look (neon glows, oversaturated purple), cheap stock photo feel, Unsplash placeholder randomness, startup-slop naming ("Acme", "SmartFlow").

## Output Format
Return ONLY valid JSON (no markdown fences, no explanation) in this exact structure:
{
  "totalScore": <weighted average of all 6 dimensions>,
  "dimensions": {
    "typography": {
      "score": <0-100>,
      "summary": {"zh": "<1-2句中文总结>", "en": "<1-2 sentence English summary>"},
      "issues": [{"zh": "<中文问题描述>", "en": "<English issue description>"}, ...]
    },
    "colorHarmony": {
      "score": <0-100>,
      "summary": {"zh": "...", "en": "..."},
      "issues": [...]
    },
    "spacing": {
      "score": <0-100>,
      "summary": {"zh": "...", "en": "..."},
      "issues": [...]
    },
    "layout": {
      "score": <0-100>,
      "summary": {"zh": "...", "en": "..."},
      "issues": [...]
    },
    "consistency": {
      "score": <0-100>,
      "summary": {"zh": "...", "en": "..."},
      "issues": [...]
    },
    "aesthetics": {
      "score": <0-100>,
      "summary": {"zh": "...", "en": "..."},
      "issues": [...]
    }
  },
  "overallAnalysis": {
    "zh": "<3-5句中文整体分析，指出最大的优点和最需要改进的地方>",
    "en": "<3-5 sentence English overall analysis, highlight biggest strengths and improvements needed>"
  }
}

## Scoring Guidelines
- 90-100: World-class, Awwwards-level design
- 75-89: Professional, polished, minor issues
- 60-74: Decent but clearly has amateur/template issues
- 40-59: Below average, multiple obvious problems
- 0-39: Poor quality, major redesign needed
- Be critical but fair. Most generic websites score 50-70. Only truly exceptional design scores 85+.
- Each dimension should have 1-4 specific issues (or empty array if score > 85).`;

export async function runLLMScoring(
  screenshotUrl: string,
  crawlData: CrawlResult,
  userId: string
): Promise<LLMScoringResult> {
  const contextPrompt = `${SCORING_PROMPT}

## Page Context
- Fonts detected: ${crawlData.fonts.slice(0, 5).join(', ') || 'unknown'}
- Colors detected: ${crawlData.colors.slice(0, 12).join(', ') || 'unknown'}
- Tech stack: ${crawlData.techStack.join(', ') || 'unknown'}

## DOM Summary
${crawlData.domSummary}

Now analyze the screenshot and score this page.`;

  const messages: any[] = [
    {
      role: 'user',
      content: [
        { type: 'text', text: contextPrompt },
        ...(screenshotUrl ? [{ type: 'image_url', image_url: { url: screenshotUrl } }] : []),
      ],
    },
  ];

  try {
    const { response } = await aiGateway(
      { messages, temperature: 0.3, max_tokens: 2000 },
      { userId, source: 'ui-review', operation: 'llm-scoring' }
    );
    const content = response.choices[0]?.message?.content || '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0]) as LLMScoringResult;
      // Validate and clamp scores
      const dims = result.dimensions;
      for (const key of Object.keys(dims) as Array<keyof typeof dims>) {
        dims[key].score = Math.max(0, Math.min(100, Math.round(dims[key].score)));
      }
      // Recalculate totalScore as weighted average
      const weights = { typography: 1.2, colorHarmony: 1.0, spacing: 1.0, layout: 1.2, consistency: 0.8, aesthetics: 1.3 };
      let weightedSum = 0;
      let totalWeight = 0;
      for (const [key, w] of Object.entries(weights)) {
        weightedSum += (dims as any)[key].score * w;
        totalWeight += w;
      }
      result.totalScore = Math.round(weightedSum / totalWeight);
      return result;
    }
  } catch (e) {
    console.error('[ui-review] LLM scoring failed:', e);
  }

  return getDefaultScoringResult();
}

function getDefaultScoringResult(): LLMScoringResult {
  const defaultDim: DimensionScore = {
    score: 60,
    summary: { zh: '评分不可用', en: 'Scoring unavailable' },
    issues: [],
  };
  return {
    totalScore: 60,
    dimensions: {
      typography: { ...defaultDim },
      colorHarmony: { ...defaultDim },
      spacing: { ...defaultDim },
      layout: { ...defaultDim },
      consistency: { ...defaultDim },
      aesthetics: { ...defaultDim },
    },
    overallAnalysis: { zh: 'AI 分析暂时不可用，请稍后重试。', en: 'AI analysis temporarily unavailable. Please retry later.' },
  };
}

export async function analyzeReferenceImage(imageUrl: string, userId: string): Promise<ReferenceAnalysis> {
  const prompt = `Analyze this design reference image. Extract the key design characteristics:

1. palette - list the main colors used (as hex codes)
2. spacingStyle - describe the spacing approach (tight, moderate, spacious)
3. layoutCharacteristics - describe the layout style (grid-based, asymmetric, centered, etc.)
4. fontStyle - describe the typography style (modern sans-serif, classic serif, monospace accent, etc.)
5. overallVibe - 1-2 words describing the overall design vibe (minimal, bold, playful, corporate, etc.)

Respond in JSON format:
{"palette": ["#xxx", ...], "spacingStyle": "...", "layoutCharacteristics": "...", "fontStyle": "...", "overallVibe": "..."}`;

  const messages: any[] = [
    {
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: imageUrl } },
      ],
    },
  ];

  try {
    const { response } = await aiGateway(
      { messages, temperature: 0.3, max_tokens: 400 },
      { userId, source: 'ui-review', operation: 'reference-analysis' }
    );
    const content = response.choices[0]?.message?.content || '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
  } catch (e) {
    console.error('[ui-review] Reference analysis failed:', e);
  }

  return { palette: [], spacingStyle: 'moderate', layoutCharacteristics: 'standard', fontStyle: 'sans-serif', overallVibe: 'modern' };
}
