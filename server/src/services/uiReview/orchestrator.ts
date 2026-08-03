import COS from 'cos-nodejs-sdk-v5';
import { getDatabase } from '../../db/index.js';
import { crawlPage, type CrawlResult } from './crawlerService.js';
import { runLLMScoring, analyzeReferenceImage } from './analysisService.js';
import { generateSkillMarkdown, type ReviewData } from './generationService.js';
import { runProDimensionAnalysis, generateExecutionPlan } from './proAnalysisService.js';
import { getCosConfig } from '../../api/upload.js';
import { startJob, type JobKind } from '../../core/jobs.js';

// 进度以前放在模块级 Map 里（还带一个 5 分钟后 delete 的 setTimeout），
// 进程一重启就全没：SSE 流拿不到任何 progress，而 ui_reviews 那一行还停在
// crawling/analyzing，前端永远等不到 done。现在落到 jobs 表（见 core/jobs.ts）。
const REVIEW_JOB: JobKind = 'ui-review';

/** SSE 只取最新一条进度，所以读 job 行上的 step/message 就够，不必回放全部日志。 */
export function getLatestProgress(reviewId: string): { step: string; message: string } | null {
  const row = getDatabase().prepare(
    `SELECT step, message FROM jobs WHERE kind = ? AND ref_id = ?
     ORDER BY started_at DESC, rowid DESC LIMIT 1`
  ).get(REVIEW_JOB, reviewId) as { step: string; message: string } | undefined;
  return row && row.step ? row : null;
}

/**
 * 重启后把中断的 review 收尾。reapZombieJobs() 只管 jobs 表，
 * ui_reviews 自己的 status 列还停在 crawling/analyzing/generating —— 不清的话
 * 前端 SSE 会一直轮询一个永远不会推进的状态（既不 completed 也不 failed）。
 */
export function failInterruptedReviews(): number {
  const r = getDatabase().prepare(
    `UPDATE ui_reviews SET status = 'failed', error_message = '服务重启，任务中断'
     WHERE status IN ('pending', 'crawling', 'analyzing', 'generating')`
  ).run();
  if (r.changes > 0) console.log(`[ui-review] 已将 ${r.changes} 条重启前中断的评审标为 failed`);
  return r.changes;
}

function updateStatus(reviewId: string, status: string) {
  const db = getDatabase();
  db.prepare('UPDATE ui_reviews SET status = ? WHERE id = ?').run(status, reviewId);
}

export async function executeReview(reviewId: string, userId: string): Promise<void> {
  const db = getDatabase();
  const review = db.prepare('SELECT * FROM ui_reviews WHERE id = ?').get(reviewId) as any;
  if (!review) return;

  const job = startJob(REVIEW_JOB, { refId: reviewId, createdBy: userId, message: 'Queued...' });
  const emitProgress = (_id: string, step: string, message: string) => {
    job.progress({ step, message });
    job.log(message);
  };

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

    screenshotUrl = `https://file.qiaonan.vip/${cosKey}`;

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

    // Step 2.5: Pro deep analysis (if pro mode)
    if (review.mode === 'pro') {
      emitProgress(reviewId, 'analyzing', 'Running deep analysis on weak dimensions...');

      // Convert screenshot to base64 data URI to avoid model-side download timeouts
      let screenshotForPro = screenshotUrl;
      if (crawlData!.screenshot && crawlData!.screenshot.length > 0) {
        const b64 = Buffer.from(crawlData!.screenshot).toString('base64');
        screenshotForPro = `data:image/png;base64,${b64}`;
      }

      // Find dimensions scoring below 75
      const weakDimensions = Object.entries(scoringResult.dimensions)
        .filter(([, data]) => data.score < 75)
        .sort(([, a], [, b]) => a.score - b.score)
        .slice(0, 4);

      const dimensionAnalyses = [];
      for (const [dim, data] of weakDimensions) {
        emitProgress(reviewId, 'analyzing', `Deep analyzing: ${dim}...`);
        const analysis = await runProDimensionAnalysis(
          dim, data.score, data.issues, screenshotForPro, crawlData!, userId
        );
        dimensionAnalyses.push(analysis);
      }

      emitProgress(reviewId, 'analyzing', 'Generating execution plan...');
      const planResult = await generateExecutionPlan(
        scoringResult, dimensionAnalyses, crawlData!, review.url, userId
      );

      const proAnalysis = { dimensionAnalyses, ...planResult };
      db.prepare('UPDATE ui_reviews SET pro_analysis = ? WHERE id = ?').run(
        JSON.stringify(proAnalysis), reviewId
      );
    }

    // Step 3: Generate
    updateStatus(reviewId, 'generating');
    emitProgress(reviewId, 'generating', 'Generating fix instructions...');

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
    job.progress({ step: 'completed', message: 'Review complete!' });
    job.done({ totalScore: scoringResult.totalScore }, 'Review complete!');
    job.log('Review complete!');

  } catch (error: any) {
    console.error(`[ui-review] Review ${reviewId} failed:`, error);
    db.prepare('UPDATE ui_reviews SET status = ?, error_message = ? WHERE id = ?').run(
      'failed', error.message || 'Unknown error', reviewId
    );
    // step 也要写成 failed：SSE 读的是 job 行上的 step/message，
    // 不改的话前端最后收到的进度还停在 'analyzing'。
    job.progress({ step: 'failed', message: error.message || 'Unknown error' });
    job.fail(error);
    job.log(`失败: ${error.message || 'Unknown error'}`);
  }
}
