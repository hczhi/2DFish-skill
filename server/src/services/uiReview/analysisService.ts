import { aiGateway } from '../../core/llm/gateway.js';
import type { CrawlResult } from './crawlerService.js';

export interface DimensionScore {
  score: number;
  summary: { zh: string; en: string };
  issues: Array<{ zh: string; en: string }>;
}

export interface LLMScoringResult {
  totalScore: number;
  aiGenerated: boolean;
  templateDetected: boolean;
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

const SCORING_PROMPT = `You are a brutally honest senior design critic. You evaluate the VISUAL QUALITY of web page designs with the taste level of someone who ships products at Linear, Vercel, or Stripe. You do NOT give polite scores. You score what you actually see.

Your job is to find what's WRONG, not what's right. Assume everything is mediocre until proven otherwise.

## Critical: AI-Generated & Template Detection

Before scoring, first assess whether this page shows signs of:

**AI-Generated Design (auto-deduct 10-20 points from aesthetics + layout):**
- Purple/blue neon gradients, glowing CTAs, oversaturated hero backgrounds
- "Hero with centered H1 + subtitle + button + 3-column feature cards below" (the universal AI landing page)
- Generic stock-photo-style illustrations or placeholder imagery
- Overly symmetrical, zero visual tension — everything perfectly centered
- Buzzword-heavy copy ("Supercharge", "Unleash", "Next-gen", "Seamless")
- Suspiciously "clean" but with no personality or memorable detail

**Template/Boilerplate Design (auto-deduct 10-15 points from aesthetics + layout):**
- Recognizable Bootstrap/Tailwind UI/shadcn default patterns with zero customization
- Default component library styling (no custom colors, radius, or shadow)
- Cookie-cutter section ordering: hero → features → testimonials → pricing → footer
- Generic icon + title + description card grids
- "Looks like it was built in a weekend with a template" feeling

If EITHER is detected, it is IMPOSSIBLE for aesthetics to score above 55 or layout above 60, regardless of how "clean" it appears. Clean ≠ good. Template-clean is still mediocre.

## Scoring Dimensions (each 0-100)

### 1. Typography (排版层级)
Evaluate: font hierarchy clarity, heading/body contrast, letter-spacing quality, font choice, line-height rhythm, max line width for readability.
Deduct heavily for: no tracking-tight on display text, single font-weight across the page, line width > 75ch, system font with no custom choice, oversized H1 without proportional hierarchy below.

### 2. Color Harmony (色彩和谐)
Evaluate: palette cohesion (max 1 accent color, saturation <80%), background/foreground contrast, shadow quality, accent usage restraint.
Deduct heavily for: AI purple/blue neon gradients, >2 accent colors, pure #000 text on pure #fff background (lazy contrast), gradient text on headers, warm+cool gray mixing, any "glowing" element.

### 3. Spacing & Whitespace (间距与留白)
Evaluate: consistent spacing rhythm, breathing room, padding uniformity, grid alignment.
Deduct heavily for: inconsistent padding values between similar components, cramped cards (padding < 20px), no clear spacing scale, sections jammed together.

### 4. Layout Structure (布局结构)
Evaluate: layout diversity across sections, asymmetric design variance, visual weight distribution, content grouping.
Deduct heavily for: every section using text-center, 3-equal-column card grid (the #1 template smell), no variation in section structure top to bottom, everything on a single visual plane with no depth.

### 5. Visual Consistency (视觉一致性)
Evaluate: border-radius uniformity, icon style consistency, shadow style consistency, button system coherence.
Deduct heavily for: mixed border-radius (rounded-sm next to rounded-2xl), icons from different libraries/weights, inconsistent hover/active states, buttons that don't look like they belong to the same system.

### 6. Overall Aesthetics (整体质感)
Evaluate: does this feel HANDCRAFTED or GENERATED? Is there a single memorable design detail? Would a design-conscious user trust this brand? Is there craft beyond "making it work"?
Deduct heavily for: zero memorable moments, could-be-any-SaaS feeling, no hover states or transitions, no textural detail (background, borders, micro-interactions implied by static design), AI-slop aesthetic (purple glow, oversaturated gradients, generic illustrations).

## Output Format
Return ONLY valid JSON (no markdown fences, no explanation) in this exact structure:
{
  "totalScore": <weighted average>,
  "aiGenerated": <true/false — whether you detect AI-generated or template design>,
  "templateDetected": <true/false — whether this looks like an unmodified template>,
  "dimensions": {
    "typography": {
      "score": <0-100>,
      "summary": {"zh": "<1-2句中文总结>", "en": "<1-2 sentence English summary>"},
      "issues": [{"zh": "<中文问题描述>", "en": "<English issue description>"}, ...]
    },
    "colorHarmony": { "score": <0-100>, "summary": {"zh": "...", "en": "..."}, "issues": [...] },
    "spacing": { "score": <0-100>, "summary": {"zh": "...", "en": "..."}, "issues": [...] },
    "layout": { "score": <0-100>, "summary": {"zh": "...", "en": "..."}, "issues": [...] },
    "consistency": { "score": <0-100>, "summary": {"zh": "...", "en": "..."}, "issues": [...] },
    "aesthetics": { "score": <0-100>, "summary": {"zh": "...", "en": "..."}, "issues": [...] }
  },
  "overallAnalysis": {
    "zh": "<3-5句中文整体分析>",
    "en": "<3-5 sentence English overall analysis>"
  }
}

## Scoring Calibration (STRICT)
- 90-100: World-class. Awwwards winner. You'd screenshot it for inspiration. Almost nothing gets here.
- 75-89: Genuinely polished by a skilled designer. Has personality. You can name what's special about it.
- 55-74: Functional but unremarkable. "Fine." Template-level or early-career designer work.
- 35-54: Clearly amateur or low-effort. Multiple obvious problems visible in 2 seconds.
- 0-34: Broken or actively ugly. Needs full redesign.

## Scoring Rules
- Your DEFAULT assumption is 55. Earn points upward by showing craft. Lose points by showing problems.
- A "clean" page with no issues but no personality is a 55-65, NOT 75+.
- If it looks AI-generated: cap aesthetics at 55, cap layout at 60.
- If it looks like an unmodified template: cap aesthetics at 50, cap layout at 55.
- You MUST find at least 2 issues per dimension scoring below 80. If you can't find issues, your score is too low.
- 75+ requires you to name what's SPECIFICALLY good. "Clean layout" is not specific enough.
- Each dimension should have 2-4 specific issues (or empty array ONLY if score > 85).`;

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
      // Normalize boolean flags
      result.aiGenerated = !!result.aiGenerated;
      result.templateDetected = !!result.templateDetected;
      // Validate and clamp scores
      const dims = result.dimensions;
      for (const key of Object.keys(dims) as Array<keyof typeof dims>) {
        dims[key].score = Math.max(0, Math.min(100, Math.round(dims[key].score)));
      }
      // Enforce caps if AI/template detected but model didn't obey
      if (result.aiGenerated) {
        dims.aesthetics.score = Math.min(dims.aesthetics.score, 55);
        dims.layout.score = Math.min(dims.layout.score, 60);
      }
      if (result.templateDetected) {
        dims.aesthetics.score = Math.min(dims.aesthetics.score, 50);
        dims.layout.score = Math.min(dims.layout.score, 55);
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
    score: 50,
    summary: { zh: '评分不可用', en: 'Scoring unavailable' },
    issues: [],
  };
  return {
    totalScore: 50,
    aiGenerated: false,
    templateDetected: false,
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
