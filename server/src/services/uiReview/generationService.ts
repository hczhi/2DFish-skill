import type { Response } from 'express';
import { aiGateway, aiGatewayStream, QuotaExceededError } from '../../core/llm/gateway.js';
import { getDatabase } from '../../db/index.js';
import type { CrawlResult } from './crawlerService.js';
import type { RuleResult } from './ruleEngine.js';
import type { ReferenceAnalysis } from './analysisService.js';

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

export async function generateSkillMarkdown(
  reviewData: ReviewData,
  referenceAnalysis?: ReferenceAnalysis,
  userId?: string
): Promise<string> {
  const failedRules = reviewData.ruleResults.filter(r => !r.passed);

  // Load the best matching skill template from admin-managed skills
  const styleSkill = loadBestMatchingSkillTemplate(reviewData.industryType);

  const prompt = `You are a UI/UX optimization expert. Generate a concise, actionable optimization skill document (in Markdown) for an AI agent to improve this webpage.

## Page Info
- URL: ${reviewData.url}
- Industry: ${reviewData.industryType}
- Tech Stack: ${reviewData.techStack.join(', ')}
- Total Score: ${reviewData.totalScore}/100

## Issues Found (sorted by priority)
${failedRules.map((r, i) => `${i + 1}. [${r.severity.toUpperCase()}] ${r.name} (${r.dimension}): ${r.details}${r.affectedElements?.length ? '\n   Elements: ' + r.affectedElements.join(', ') : ''}`).join('\n')}

## Existing Design Tokens
- Fonts: ${reviewData.crawlData.fonts.join(', ')}
- Colors: ${reviewData.crawlData.colors.slice(0, 10).join(', ')}

${styleSkill ? `## Design System Baseline (from "${styleSkill.name}")
The following design protocol MUST be followed as the primary style authority:

${styleSkill.skill_template}

### Design Features
- Palette: ${styleSkill.design_features.palette?.join(', ') || 'not specified'}
- Spacing: ${styleSkill.design_features.spacing_style || 'not specified'}
- Layout: ${styleSkill.design_features.layout || 'not specified'}
- Font Style: ${styleSkill.design_features.font_style || 'not specified'}
- Border Radius: ${styleSkill.design_features.border_radius || 'not specified'}
- Shadow: ${styleSkill.design_features.shadow || 'not specified'}
- Vibe: ${styleSkill.design_features.vibe || 'not specified'}
` : ''}
${referenceAnalysis ? `## Reference Style (User-Provided Image)
The user uploaded a reference screenshot as the target aesthetic. The generated skill MUST guide the design toward this reference:
- Target Palette: ${referenceAnalysis.palette.join(', ')}
- Spacing Style: ${referenceAnalysis.spacingStyle}
- Layout Approach: ${referenceAnalysis.layoutCharacteristics}
- Font Style: ${referenceAnalysis.fontStyle}
- Overall Vibe: ${referenceAnalysis.overallVibe}

When the reference style conflicts with the Design System Baseline above, PRIORITIZE the reference style — it represents the user's explicit intent.
` : ''}

## Output Requirements
Generate a skill document with:
1. A brief context section (what page this is, what tech stack)
2. Priority fixes list - each with: specific CSS selector, current value, target value, and the actual CSS code to change
3. Design constraints section - what NOT to modify (preserve brand identity, keep functional elements)
4. The fixes should use the page's existing design tokens where possible, unless the reference style explicitly overrides them
${referenceAnalysis ? '5. A "Style Migration" section — specific changes needed to move the design toward the reference image aesthetic' : ''}
${styleSkill ? '6. All generated CSS must comply with the Design System Baseline rules (shadow quality, border-radius consistency, typography discipline, etc.)' : ''}

Keep it concise and directly executable. Use code blocks for CSS changes.`;

  try {
    const { response } = await aiGateway(
      { messages: [{ role: 'user', content: prompt }], temperature: 0.4, max_tokens: 2500 },
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
    return `# UI Optimization Skill\n\nGeneration failed. Please retry.`;
  }
}

export async function streamPreviewHtml(
  reviewData: ReviewData,
  referenceAnalysis: ReferenceAnalysis | undefined,
  skillMarkdown: string,
  userId: string,
  res: Response
): Promise<string> {
  const failedRules = reviewData.ruleResults.filter(r => !r.passed);

  // Truncate skill markdown to key sections if too long (keep under ~1500 chars for prompt budget)
  const skillContext = skillMarkdown
    ? skillMarkdown.slice(0, 2000)
    : '';

  const prompt = `You are a frontend developer. Generate a SINGLE self-contained HTML file that shows the OPTIMIZED first screen of this webpage.

## Requirements
- Output a complete HTML file with inline <style> in <head>
- Replace all images with colored placeholder <div> blocks (use relevant colors, add a text label like "Hero Image" or "Logo")
- Only render the FIRST SCREEN (above the fold, ~900px height)
- Apply all the fixes listed below
- Use modern CSS, clean typography, proper spacing
- The page should look professional and polished
- STRICTLY NO <a> tags — replace all links with <span> styled the same way
- STRICTLY NO JavaScript — no <script> tags, no inline event handlers (onclick, onload, etc.), no javascript: URLs
- This is a pure static CSS preview only

## Page Context
- URL: ${reviewData.url}
- Industry: ${reviewData.industryType}
- Tech Stack: ${reviewData.techStack.join(', ')}
- Current Score: ${reviewData.totalScore}/100

## Page Structure
${reviewData.crawlData.domSummary}

## Fixes to Apply
${failedRules.slice(0, 10).map(r => `- ${r.name}: ${r.details}`).join('\n')}

## Design Direction
- Fonts in use: ${reviewData.crawlData.fonts.slice(0, 3).join(', ')}
- Colors in use: ${reviewData.crawlData.colors.slice(0, 8).join(', ')}
${referenceAnalysis ? `
## Reference Style Target
The user wants the design to look like this reference:
- Vibe: ${referenceAnalysis.overallVibe}
- Palette: ${referenceAnalysis.palette.join(', ')}
- Spacing: ${referenceAnalysis.spacingStyle}
- Layout: ${referenceAnalysis.layoutCharacteristics}
- Font Style: ${referenceAnalysis.fontStyle}
Apply this aesthetic throughout the generated HTML.` : ''}

${skillContext ? `## Optimization Skill (MUST FOLLOW)
The following skill document was generated for this page. Your HTML/CSS code MUST implement the rules and fixes described here. This is your primary style authority:

${skillContext}` : ''}

Output ONLY the HTML code, no markdown fences, no explanation. Start with <!DOCTYPE html>.`;

  // Set up SSE — disable compression buffering
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

  let fullHtml = '';

  try {
    send({ status: 'generating' });

    const { stream, onComplete } = await aiGatewayStream(
      { messages: [{ role: 'user', content: prompt }], temperature: 0.5, max_tokens: 4000 },
      { userId, source: 'ui-review', operation: 'generate-preview' }
    );

    const startTime = Date.now();
    let inputTokens = 0;
    let outputTokens = 0;

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      if (content) {
        fullHtml += content;
        outputTokens++;
        send({ html: content });
      }
      if (chunk.usage) {
        inputTokens = chunk.usage.prompt_tokens || 0;
        outputTokens = chunk.usage.completion_tokens || outputTokens;
      }
    }

    onComplete(inputTokens, outputTokens, Date.now() - startTime);
    send({ done: true });
    res.end();
  } catch (e: any) {
    console.error('[ui-review] Preview stream error:', e);
    const msg = e instanceof QuotaExceededError
      ? e.message
      : (e.message || 'LLM 调用失败 / LLM call failed');
    send({ error: msg });
    res.end();
  }

  return fullHtml;
}
