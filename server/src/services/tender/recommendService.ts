import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../../db/index.js';
import { aiGateway, QuotaExceededError } from '../../core/llm/gateway.js';

interface UserConfig {
  userId: string;
  keywords: Array<{ keyword: string; weight: number }>;
  clients: Array<{ clientName: string; relationshipScore: number; paymentCredit: string }>;
  preferences: {
    budgetMin: number;
    budgetMax: number;
    allowBelowMinForVip: boolean;
    preferredRegions: string[];
    acceptableRegions: string[];
    excludedRegions: string[];
    qualifications: string[];
    caseTags: string[];
    excludedTypes: string[];
  };
}

interface TenderRow {
  id: string;
  title: string;
  purchaser_name: string;
  budget_amount: number;
  region_name: string;
  notice_type: string;
  content_text: string;
  publish_date: string;
  keyword: string;
}

interface ScoreResult {
  totalScore: number;
  tier: string;
  scoreBusiness: number;
  scoreBudget: number;
  scoreQualification: number;
  scoreRelationship: number;
  scoreRegion: number;
  scoreTimeliness: number;
  aiReason: string;
  riskNotes: string;
  aiAnalysis: string;
  aiStrategy: string;
  _prompt: string;
  _response: string;
}

const DEFAULT_WEIGHTS = {
  business: 0.30,
  budget: 0.20,
  qualification: 0.15,
  relationship: 0.15,
  region: 0.10,
  timeliness: 0.10,
};

function getWeights() {
  const db = getDatabase();
  const row = db.prepare("SELECT value FROM system_config WHERE key = 'tender_scoring_weights'").get() as any;
  if (row?.value) {
    try { return { ...DEFAULT_WEIGHTS, ...JSON.parse(row.value) }; } catch {}
  }
  return DEFAULT_WEIGHTS;
}

function getPreFilterThreshold(): number {
  const db = getDatabase();
  const row = db.prepare("SELECT value FROM system_config WHERE key = 'tender_pre_filter_threshold'").get() as any;
  if (row?.value) {
    const n = parseInt(row.value);
    if (!isNaN(n)) return n;
  }
  return 25;
}

function getScoringPrompt(): string | null {
  const db = getDatabase();
  const row = db.prepare("SELECT value FROM system_config WHERE key = 'tender_scoring_prompt'").get() as any;
  return row?.value || null;
}

function getTier(score: number, feedbackCount: number = 0): string {
  // When user has little/no feedback, relax thresholds to show more items
  if (feedbackCount < 5) {
    if (score >= 75) return 'priority';
    if (score >= 55) return 'consider';
    if (score >= 35) return 'watch';
    return 'filter';
  }
  if (score >= 85) return 'priority';
  if (score >= 65) return 'consider';
  if (score >= 45) return 'watch';
  return 'filter';
}

function scoreBudget(budgetAmount: number, config: UserConfig, purchaserName: string): number {
  if (!budgetAmount || budgetAmount === 0) return 50;
  const { budgetMin, budgetMax, allowBelowMinForVip } = config.preferences;
  if (budgetMin === 0 && budgetMax === 0) return 60;

  if (budgetAmount >= budgetMin && (budgetMax === 0 || budgetAmount <= budgetMax)) {
    return 100;
  }

  if (budgetAmount < budgetMin) {
    if (allowBelowMinForVip) {
      const isVip = config.clients.some(c => purchaserName.includes(c.clientName) && c.relationshipScore >= 7);
      if (isVip) return 70;
    }
    const ratio = budgetAmount / budgetMin;
    return Math.max(20, Math.round(ratio * 60));
  }

  if (budgetMax > 0 && budgetAmount > budgetMax) {
    const overRatio = budgetAmount / budgetMax;
    if (overRatio > 3) return 30;
    return Math.max(40, Math.round(100 - (overRatio - 1) * 30));
  }

  return 50;
}

function scoreRelationship(purchaserName: string, config: UserConfig): number {
  if (!purchaserName) return 50;
  for (const client of config.clients) {
    if (purchaserName.includes(client.clientName) || client.clientName.includes(purchaserName)) {
      if (client.paymentCredit === 'bad') return 30;
      return Math.min(100, client.relationshipScore * 10);
    }
  }
  return 50;
}

function scoreRegion(regionName: string, config: UserConfig): number {
  if (!regionName) return 50;
  const { preferredRegions, acceptableRegions, excludedRegions } = config.preferences;

  for (const r of excludedRegions) {
    if (regionName.includes(r)) return 10;
  }
  for (const r of preferredRegions) {
    if (regionName.includes(r)) return 100;
  }
  for (const r of acceptableRegions) {
    if (regionName.includes(r)) return 70;
  }

  if (preferredRegions.length === 0 && acceptableRegions.length === 0) return 60;
  return 40;
}

function scoreTimeliness(publishDate: string): number {
  if (!publishDate) return 50;
  const pub = new Date(publishDate);
  const now = new Date();
  const daysSince = (now.getTime() - pub.getTime()) / (1000 * 60 * 60 * 24);

  if (daysSince <= 1) return 100;
  if (daysSince <= 3) return 85;
  if (daysSince <= 7) return 65;
  if (daysSince <= 14) return 45;
  return 25;
}

function scoreKeywordMatch(tender: TenderRow, config: UserConfig): number {
  if (config.keywords.length === 0) return 50;

  let maxScore = 0;
  const searchText = `${tender.title} ${tender.content_text}`.toLowerCase();

  for (const kw of config.keywords) {
    if (kw.weight < 0) {
      if (searchText.includes(kw.keyword.toLowerCase())) return 10;
      continue;
    }
    if (searchText.includes(kw.keyword.toLowerCase())) {
      const score = Math.min(100, 70 + kw.weight * 30);
      maxScore = Math.max(maxScore, score);
    }
  }

  return maxScore || 30;
}

async function scoreBusinessWithLLM(tender: TenderRow, config: UserConfig, userId: string): Promise<{ score: number; qualificationScore: number; reason: string; risk: string; analysis: string; strategy: string; _prompt: string; _response: string }> {
  const caseTags = config.preferences.caseTags;
  const qualifications = config.preferences.qualifications;
  const excludedTypes = config.preferences.excludedTypes;

  const db = getDatabase();
  const tenderFull = db.prepare('SELECT project_type, project_summary, qualification_requirements, ai_extracted FROM tenders WHERE id = ?').get(tender.id) as any;
  const projectType = tenderFull?.project_type || '';
  const projectSummary = tenderFull?.project_summary || '';
  const qualReqs = tenderFull?.qualification_requirements || '[]';

  const budgetText = tender.budget_amount > 0 ? `${(tender.budget_amount / 10000).toFixed(1)}万元` : '未公开';

  // Load user feedback history for context
  const feedbacks = db.prepare(`
    SELECT f.feedback, f.reason, t.title, t.purchaser_name, t.project_type
    FROM tender_user_feedback f
    JOIN tenders t ON f.tender_id = t.id
    WHERE f.user_id = ?
    ORDER BY f.created_at DESC
    LIMIT 10
  `).all(config.userId) as any[];

  let feedbackSection = '';
  if (feedbacks.length > 0) {
    feedbackSection = `\n## 用户历史反馈（请参考判断用户偏好）\n` +
      feedbacks.map((f: any) => `- ${f.title}（${f.purchaser_name || '未知'}, ${f.project_type || '未分类'}）→ ${f.feedback === 'suitable' ? '适合' : '不适合'}${f.reason ? '，原因：' + f.reason : ''}`).join('\n');
  }

  const customPrompt = getScoringPrompt();
  let prompt: string;

  if (customPrompt) {
    prompt = customPrompt
      .replace(/\{\{title\}\}/g, tender.title)
      .replace(/\{\{purchaser\}\}/g, tender.purchaser_name)
      .replace(/\{\{budget\}\}/g, budgetText)
      .replace(/\{\{region\}\}/g, tender.region_name)
      .replace(/\{\{projectType\}\}/g, projectType || '未分类')
      .replace(/\{\{projectSummary\}\}/g, projectSummary || tender.content_text.slice(0, 600))
      .replace(/\{\{qualReqs\}\}/g, qualReqs)
      .replace(/\{\{content\}\}/g, tender.content_text.slice(0, 1000))
      .replace(/\{\{caseTags\}\}/g, caseTags.join('、') || '未配置')
      .replace(/\{\{qualifications\}\}/g, qualifications.join('、') || '未配置')
      .replace(/\{\{excludedTypes\}\}/g, excludedTypes.join('、') || '无')
      .replace(/\{\{feedbackHistory\}\}/g, feedbackSection || '暂无');
  } else {
    prompt = `你是一个资深的广告营销公司投标顾问。请对以下招标项目进行全面评估。

## 招标信息
- 标题：${tender.title}
- 采购人：${tender.purchaser_name}
- 预算：${budgetText}
- 地区：${tender.region_name}
- 项目类型：${projectType || '未分类'}
- 项目概要：${projectSummary || tender.content_text.slice(0, 600)}
- 资质要求：${qualReqs}
- 内容摘要：${tender.content_text.slice(0, 1000)}

## 我司情况
- 案例标签：${caseTags.join('、') || '未配置'}
- 已有资质：${qualifications.join('、') || '未配置'}
- 不接类型：${excludedTypes.join('、') || '无'}
${feedbackSection}

请输出严格 JSON（无 markdown 围栏）：
{
  "businessScore": <0-100的业务匹配分>,
  "qualificationScore": <0-100的资质符合分>,
  "reason": "<1句话说明推荐/不推荐的核心原因>",
  "risk": "<风险提示：资质缺口、时间紧迫、付款风险等。没有则空>",
  "analysis": "<项目分析：2-3句话分析项目的核心需求、甲方意图、竞争格局判断>",
  "strategy": "<投标思路：如果决定投标，建议的切入角度、团队配置、差异化策略、报价建议，3-4句话>"
}

评分标准：
- 不接类型命中 → businessScore = 10
- 案例标签完全匹配 → 90+，部分相关 → 60-80，不相关 → 30 以下
- 缺少硬性资质 → qualificationScore < 40
- 如果用户历史反馈中有类似项目标记为"不适合"，应降低评分
- 如果用户历史反馈中有类似项目标记为"适合"，应适当提升评分
- analysis 要有洞察，不要复述标题
- strategy 要具体可执行，不要空泛建议`;
  }

  try {
    const { response } = await aiGateway(
      { messages: [{ role: 'user', content: prompt }], temperature: 0.3, max_tokens: 1000 },
      { userId, source: 'tender', operation: 'score-business' }
    );
    const content = response.choices[0]?.message?.content || '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        score: parsed.businessScore ?? 50,
        qualificationScore: parsed.qualificationScore ?? 50,
        reason: parsed.reason || '',
        risk: parsed.risk || '',
        analysis: parsed.analysis || '',
        strategy: parsed.strategy || '',
        _prompt: prompt,
        _response: content,
      };
    }
    return { score: 50, qualificationScore: 50, reason: '解析失败', risk: '', analysis: '', strategy: '', _prompt: prompt, _response: content };
  } catch (e: any) {
    console.error('[tender] LLM scoring failed:', e.message);
    const reason = e.name === 'QuotaExceededError' ? '每日AI额度已用完' : `评分服务暂时不可用: ${e.message}`;
    return { score: 50, qualificationScore: 50, reason, risk: '', analysis: '', strategy: '', _prompt: prompt, _response: e.message };
  }
  return { score: 50, qualificationScore: 50, reason: '评分服务暂时不可用', risk: '', analysis: '', strategy: '', _prompt: prompt, _response: '' };
}

function loadUserConfig(userId: string): UserConfig {
  const db = getDatabase();

  const keywords = db.prepare('SELECT keyword, weight FROM tender_user_keywords WHERE user_id = ? AND enabled = 1').all(userId) as any[];
  const clients = db.prepare('SELECT client_name as clientName, relationship_score as relationshipScore, payment_credit as paymentCredit FROM tender_user_clients WHERE user_id = ?').all(userId) as any[];
  const pref = db.prepare('SELECT * FROM tender_user_preferences WHERE user_id = ?').get(userId) as any;

  return {
    userId,
    keywords: keywords.map(k => ({ keyword: k.keyword, weight: k.weight })),
    clients: clients.map(c => ({ clientName: c.clientName, relationshipScore: c.relationshipScore, paymentCredit: c.paymentCredit })),
    preferences: pref ? {
      budgetMin: pref.budget_min || 0,
      budgetMax: pref.budget_max || 0,
      allowBelowMinForVip: !!pref.allow_below_min_for_vip,
      preferredRegions: JSON.parse(pref.preferred_regions || '[]'),
      acceptableRegions: JSON.parse(pref.acceptable_regions || '[]'),
      excludedRegions: JSON.parse(pref.excluded_regions || '[]'),
      qualifications: JSON.parse(pref.qualifications || '[]'),
      caseTags: JSON.parse(pref.case_tags || '[]'),
      excludedTypes: JSON.parse(pref.excluded_types || '[]'),
    } : {
      budgetMin: 0, budgetMax: 0, allowBelowMinForVip: false,
      preferredRegions: [], acceptableRegions: [], excludedRegions: [],
      qualifications: [], caseTags: [], excludedTypes: [],
    },
  };
}

export async function scoreTenderForUser(tender: TenderRow, config: UserConfig, adminUserId: string, feedbackCount: number = 0): Promise<ScoreResult> {
  const keywordScore = scoreKeywordMatch(tender, config);
  const budgetScore = scoreBudget(tender.budget_amount, config, tender.purchaser_name);
  const relationshipScore = scoreRelationship(tender.purchaser_name, config);
  const regionScore = scoreRegion(tender.region_name, config);
  const timelinessScore = scoreTimeliness(tender.publish_date);

  // LLM scoring for business + qualification + analysis + strategy
  const llmResult = await scoreBusinessWithLLM(tender, config, adminUserId);
  const businessScore = Math.round((keywordScore * 0.4 + llmResult.score * 0.6));
  const qualificationScore = llmResult.qualificationScore;

  const W = getWeights();
  const totalScore = Math.round(
    businessScore * W.business +
    budgetScore * W.budget +
    qualificationScore * W.qualification +
    relationshipScore * W.relationship +
    regionScore * W.region +
    timelinessScore * W.timeliness
  );

  return {
    totalScore,
    tier: getTier(totalScore, feedbackCount),
    scoreBusiness: businessScore,
    scoreBudget: budgetScore,
    scoreQualification: qualificationScore,
    scoreRelationship: relationshipScore,
    scoreRegion: regionScore,
    scoreTimeliness: timelinessScore,
    aiReason: llmResult.reason,
    riskNotes: llmResult.risk,
    aiAnalysis: llmResult.analysis,
    aiStrategy: llmResult.strategy,
    _prompt: llmResult._prompt,
    _response: llmResult._response,
  };
}

function preFilterScore(tender: TenderRow, config: UserConfig): number {
  const W = getWeights();
  const budgetScore = scoreBudget(tender.budget_amount, config, tender.purchaser_name);
  const relationshipScore = scoreRelationship(tender.purchaser_name, config);
  const regionScore = scoreRegion(tender.region_name, config);
  const timelinessScore = scoreTimeliness(tender.publish_date);
  const keywordScore = scoreKeywordMatch(tender, config);

  const restScore =
    budgetScore * W.budget +
    50 * W.qualification +
    relationshipScore * W.relationship +
    regionScore * W.region +
    timelinessScore * W.timeliness;

  const businessEstimate = keywordScore;
  const estimatedTotal = businessEstimate * W.business + restScore;

  return Math.round(estimatedTotal);
}

export async function runRecommendationsForAllUsers(
  tenderIds?: string[],
  onLog?: (msg: string, detail?: string) => void,
  userId?: string
): Promise<{ processed: number; users: number }> {
  const db = getDatabase();

  let users: any[];
  if (userId) {
    users = db.prepare('SELECT id FROM user WHERE id = ?').all(userId) as any[];
  } else {
    users = db.prepare('SELECT id FROM user').all() as any[];
  }
  const adminUser = db.prepare("SELECT id FROM user WHERE role = 'admin' LIMIT 1").get() as any;
  const adminUserId = adminUser?.id || users[0]?.id;

  let tenders: TenderRow[];
  if (tenderIds && tenderIds.length > 0) {
    const placeholders = tenderIds.map(() => '?').join(',');
    tenders = db.prepare(`SELECT id, title, purchaser_name, budget_amount, region_name, notice_type, content_text, publish_date, keyword FROM tenders WHERE id IN (${placeholders})`).all(...tenderIds) as TenderRow[];
  } else {
    tenders = db.prepare('SELECT id, title, purchaser_name, budget_amount, region_name, notice_type, content_text, publish_date, keyword FROM tenders ORDER BY publish_date DESC LIMIT 50').all() as TenderRow[];
  }

  if (tenders.length === 0) return { processed: 0, users: 0 };

  let processed = 0;
  let skippedByFilter = 0;

  const insertStmt = db.prepare(`
    INSERT OR REPLACE INTO tender_recommendations (id, user_id, tender_id, total_score, tier, score_business, score_budget, score_qualification, score_relationship, score_region, score_timeliness, ai_reason, risk_notes, ai_analysis, ai_strategy, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const user of users) {
    const config = loadUserConfig(user.id);
    if (config.keywords.length === 0 && config.preferences.caseTags.length === 0) continue;

    // Count user's feedback to determine strictness
    const feedbackCount = (db.prepare('SELECT COUNT(*) as count FROM tender_user_feedback WHERE user_id = ?').get(user.id) as any).count;
    const threshold = feedbackCount < 5 ? Math.max(10, getPreFilterThreshold() - 15) : getPreFilterThreshold();

    let userProcessed = 0;
    let userSkipped = 0;

    for (const tender of tenders) {
      const existing = db.prepare('SELECT id FROM tender_recommendations WHERE user_id = ? AND tender_id = ?').get(user.id, tender.id) as any;
      if (existing) continue;

      // Pre-filter: rule-based quick check (relaxed for users with little feedback)
      const preScore = preFilterScore(tender, config);
      if (preScore < threshold) {
        // Save as filter tier without calling LLM
        insertStmt.run(
          uuidv4(), user.id, tender.id,
          preScore, 'filter',
          0, scoreBudget(tender.budget_amount, config, tender.purchaser_name), 0,
          scoreRelationship(tender.purchaser_name, config),
          scoreRegion(tender.region_name, config),
          scoreTimeliness(tender.publish_date),
          '规则初筛：相关度较低', '', '', '',
          new Date().toISOString()
        );
        skippedByFilter++;
        userSkipped++;
        processed++;
        continue;
      }

      try {
        const score = await scoreTenderForUser(tender, config, adminUserId, feedbackCount);
        insertStmt.run(
          uuidv4(), user.id, tender.id,
          score.totalScore, score.tier,
          score.scoreBusiness, score.scoreBudget, score.scoreQualification,
          score.scoreRelationship, score.scoreRegion, score.scoreTimeliness,
          score.aiReason, score.riskNotes,
          score.aiAnalysis, score.aiStrategy,
          new Date().toISOString()
        );
        userProcessed++;
        processed++;
        const llmDetail = score._prompt ? `📤 Prompt:\n${score._prompt.slice(0, 600)}...\n\n📥 Response:\n${score._response.slice(0, 600)}${score._response.length > 600 ? '...' : ''}` : undefined;
        onLog?.(`  [${userProcessed}] ${tender.title.slice(0, 25)} → ${score.tier} (${score.totalScore}分)`, llmDetail);
      } catch (e: any) {
        if (e instanceof QuotaExceededError) {
          onLog?.(`⚠️ AI额度已用完，评分中止`);
          return { processed, users: users.length };
        }
        console.error(`[tender] Score failed for user=${user.id} tender=${tender.id}:`, e.message);
        onLog?.(`  [错误] ${tender.title.slice(0, 25)}: ${e.message}`);
      }
    }

    onLog?.(`用户 ${user.id.slice(0, 8)} 完成：LLM评分 ${userProcessed} 条`);
  }

  onLog?.(`推荐评分全部完成：共处理 ${processed} 条`);
  return { processed, users: users.length };
}
