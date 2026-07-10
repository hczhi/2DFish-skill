import COS from 'cos-nodejs-sdk-v5';
import { getDatabase } from '../../db/index.js';
import { crawlPage, type CrawlResult } from './crawlerService.js';
import { runLLMScoring, analyzeReferenceImage } from './analysisService.js';
import { generateSkillMarkdown, type ReviewData } from './generationService.js';
import { getCosConfig } from '../../api/upload.js';

// Simple in-memory event store for SSE progress
const progressEvents = new Map<string, string[]>();

export function getProgressEvents(reviewId: string): string[] {
  return progressEvents.get(reviewId) || [];
}

function emitProgress(reviewId: string, step: string, message: string) {
  const events = progressEvents.get(reviewId) || [];
  events.push(JSON.stringify({ step, message, timestamp: Date.now() }));
  progressEvents.set(reviewId, events);
}

function updateStatus(reviewId: string, status: string) {
  const db = getDatabase();
  db.prepare('UPDATE ui_reviews SET status = ? WHERE id = ?').run(status, reviewId);
}

export async function executeReview(reviewId: string, userId: string): Promise<void> {
  const db = getDatabase();
  const review = db.prepare('SELECT * FROM ui_reviews WHERE id = ?').get(reviewId) as any;
  if (!review) return;

  let screenshotUrl = '';
  let crawlData: CrawlResult | null = null;

  try {
    // Step 1: Crawl
    updateStatus(reviewId, 'crawling');
    emitProgress(reviewId, 'crawling', 'Crawling page...');

    try {
      crawlData = await crawlPage(review.url);
    } catch (crawlErr: any) {
      throw new Error(`页面爬取失败，请检查网址是否可访问。\nFailed to crawl page. Please verify the URL is accessible.\n(${crawlErr.message || 'unknown error'})`);
    }

    if (!crawlData.screenshot || crawlData.screenshot.length === 0) {
      throw new Error('未能获取页面截图，请检查网址是否正确或稍后重试。\nFailed to capture screenshot. Please check the URL or try again later.');
    }

    // Upload screenshot to COS
    const cosConfig = getCosConfig();
    if (!cosConfig) throw new Error('COS 未配置，请在系统配置中设置。\nCOS not configured. Please contact admin.');

    const cos = new COS({ SecretId: cosConfig.SecretId, SecretKey: cosConfig.SecretKey });
    const cosKey = `screenshots/${reviewId}.png`;

    await new Promise<void>((resolve, reject) => {
      cos.putObject({
        Bucket: cosConfig.Bucket,
        Region: cosConfig.Region,
        Key: cosKey,
        Body: crawlData!.screenshot,
        ContentType: 'image/png',
      }, (err) => err ? reject(err) : resolve());
    });

    screenshotUrl = `http://file.qiaonan.vip/${cosKey}`;

    db.prepare('UPDATE ui_reviews SET screenshot_url = ?, crawl_data = ? WHERE id = ?').run(
      screenshotUrl,
      JSON.stringify({
        techStack: crawlData.techStack,
        fonts: crawlData.fonts,
        colors: crawlData.colors,
        performanceMetrics: crawlData.performanceMetrics,
        domSummary: crawlData.domSummary,
        elementCount: crawlData.elementData.length,
      }),
      reviewId
    );

    // Step 2: LLM Scoring
    updateStatus(reviewId, 'analyzing');
    emitProgress(reviewId, 'analyzing', 'AI scoring page design...');

    const scoringResult = await runLLMScoring(screenshotUrl, crawlData, userId);

    // Analyze reference image if provided
    let referenceAnalysis = undefined;
    if (review.reference_image_url) {
      emitProgress(reviewId, 'analyzing', 'Analyzing reference style...');
      referenceAnalysis = await analyzeReferenceImage(review.reference_image_url, userId);
      db.prepare('UPDATE ui_reviews SET reference_analysis = ? WHERE id = ?').run(JSON.stringify(referenceAnalysis), reviewId);
    }

    // Flatten issues for generation service and DB storage
    const allIssues: Array<{ name: string; dimension: string; details: string; severity: string }> = [];
    for (const [dim, data] of Object.entries(scoringResult.dimensions)) {
      for (const issue of data.issues) {
        allIssues.push({
          name: issue.en,
          dimension: dim,
          details: issue.en,
          severity: data.score < 50 ? 'error' : data.score < 70 ? 'warning' : 'info',
        });
      }
    }

    // Save scoring result + flattened issues to DB
    const ruleResultsForDb = allIssues.map(i => ({
      ruleId: '', name: i.name, dimension: i.dimension,
      severity: i.severity, passed: false, score: 0, details: i.details,
    }));
    db.prepare('UPDATE ui_reviews SET total_score = ?, dimension_scores = ?, llm_analysis = ?, rule_results = ? WHERE id = ?').run(
      scoringResult.totalScore,
      JSON.stringify(scoringResult.dimensions),
      JSON.stringify(scoringResult.overallAnalysis),
      JSON.stringify(ruleResultsForDb),
      reviewId
    );

    // Step 3: Generate
    updateStatus(reviewId, 'generating');
    emitProgress(reviewId, 'generating', 'Generating optimization skill...');

    const reviewDataForGen: ReviewData = {
      url: review.url,
      industryType: 'general',
      totalScore: scoringResult.totalScore,
      dimensionScores: Object.fromEntries(
        Object.entries(scoringResult.dimensions).map(([k, v]) => [k, v.score])
      ),
      ruleResults: allIssues.map(i => ({
        ruleId: '',
        name: i.name,
        dimension: i.dimension,
        severity: i.severity,
        passed: false,
        score: 0,
        details: i.details,
      })),
      llmAnalysis: scoringResult.overallAnalysis.en,
      crawlData,
      techStack: crawlData.techStack,
    };

    const skillMarkdown = await generateSkillMarkdown(reviewDataForGen, referenceAnalysis, userId);
    db.prepare('UPDATE ui_reviews SET skill_markdown = ? WHERE id = ?').run(skillMarkdown, reviewId);

    // Done
    updateStatus(reviewId, 'completed');
    db.prepare('UPDATE ui_reviews SET completed_at = ? WHERE id = ?').run(new Date().toISOString(), reviewId);
    emitProgress(reviewId, 'completed', 'Review complete!');

  } catch (error: any) {
    console.error(`[ui-review] Review ${reviewId} failed:`, error);
    db.prepare('UPDATE ui_reviews SET status = ?, error_message = ? WHERE id = ?').run(
      'failed', error.message || 'Unknown error', reviewId
    );
    emitProgress(reviewId, 'failed', error.message || 'Unknown error');
  } finally {
    // Clean up progress events after 5 minutes
    setTimeout(() => progressEvents.delete(reviewId), 5 * 60 * 1000);
  }
}
