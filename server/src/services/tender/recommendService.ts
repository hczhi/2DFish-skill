import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../../db/index.js';
import { aiGateway, QuotaExceededError } from '../../core/llm/gateway.js';
import { pushTenderRecommendations, type FeishuTenderItem } from './feishuNotify.js';
import { syncUserRecommendations, syncAllTenders, getBitableUrl } from './feishuBitable.js';
import { parseFirstJson } from '../../core/llm/parseJson.js';

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
    platforms: string[];
    companyProfile: string;
    profileUpdatedAt: string | null;
  };
}

interface TenderRow {
  id: string;
  platform: string;
  title: string;
  purchaser_name: string;
  budget_amount: number;
  region_name: string;
  notice_type: string;
  content_text: string;
  publish_date: string;
  keyword: string;
  url?: string;
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
  scoredProfileAt: string | null;
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

// 有些平台（如美的询源云）根本不发布预算金额，此时"预算未知"不该被当成缺点扣分，
// 直接给满分让这一轴的权重全占满。而 gdgpo 的 0 通常是正文有预算但没抽出来，
// 给满分等于奖励抽取失败，所以仍走 50 的中性兜底。
// 华润守正同理：详情页是自然语言段落，实测 10 条抽样 0 条公开预算。
const PLATFORMS_WITHOUT_BUDGET = new Set(['meicloud', 'szecp']);

function scoreBudget(budgetAmount: number, config: UserConfig, purchaserName: string, platform: string = ''): number {
  if (!budgetAmount || budgetAmount === 0) {
    return PLATFORMS_WITHOUT_BUDGET.has(platform) ? 100 : 50;
  }
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
  const companyProfile = config.preferences.companyProfile.trim();

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

  // 公司简介段。空简介时给一句明确的"未提供"，而不是留白 ——
  // 留白会让模型自行想象一家公司，产出的 reason 看起来有理有据但全是编的。
  const profileSection = companyProfile
    ? `\n## 我司简介（用户自述，判断匹配度的首要依据）\n${companyProfile.slice(0, 1200)}`
    : '';

  // 人设从简介推导，不再写死"广告营销公司"：那句写死等于把整个模块钉在广告行业，
  // 对非广告公司的用户，评分的第一句话就已经错了。
  const persona = companyProfile
    ? '你是一名资深投标顾问。请先从"我司简介"判断这是一家什么公司、擅长什么，再据此评估以下招标项目。'
    : '你是一个资深的广告营销公司投标顾问。请对以下招标项目进行全面评估。';

  const customPrompt = getScoringPrompt();
  let prompt: string;

  if (customPrompt) {
    prompt = customPrompt
      .replace(/\{\{companyProfile\}\}/g, companyProfile || '未提供')
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

    // 后台存的自定义 prompt 是简介功能上线前写的，里面没有 {{companyProfile}} 占位符。
    // 不补这一段，凡是配过自定义 prompt 的部署都会静默丢掉简介 —— 用户填了却不起作用，
    // 比功能不存在更难排查。所以占位符缺失时把简介顶到最前面。
    if (profileSection && !/\{\{companyProfile\}\}/.test(customPrompt)) {
      prompt = `${profileSection.trim()}\n\n${prompt}`;
    }
  } else {
    prompt = `${persona}
${profileSection}

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
- strategy 要具体可执行，不要空泛建议${companyProfile ? `
- 简介与标签冲突时以简介为准：标签是简介的摘要，简介信息更全
- 简介里的业务边界（只做某环节、不接某类甲方、产能上限等）等同于硬性约束，命中就压低 businessScore
- 简介已说明能力时，不要再以"未配置案例/资质"为理由扣分或搪塞` : ''}`;
  }

  try {
    const { response } = await aiGateway(
      { messages: [{ role: 'user', content: prompt }], temperature: 0.3, max_tokens: 1000 },
      { userId, source: 'tender', operation: 'score-business' }
    );
    const content = response.choices[0]?.message?.content || '';
    const parsed = parseFirstJson<any>(content);
    if (parsed) {
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
      platforms: JSON.parse(pref.platforms || '[]'),
      companyProfile: pref.company_profile || '',
      profileUpdatedAt: pref.profile_updated_at || null,
    } : {
      budgetMin: 0, budgetMax: 0, allowBelowMinForVip: false,
      preferredRegions: [], acceptableRegions: [], excludedRegions: [],
      qualifications: [], caseTags: [], excludedTypes: [], platforms: [],
      companyProfile: '', profileUpdatedAt: null,
    },
  };
}

export async function scoreTenderForUser(tender: TenderRow, config: UserConfig, adminUserId: string, feedbackCount: number = 0): Promise<ScoreResult> {
  const keywordScore = scoreKeywordMatch(tender, config);
  const budgetScore = scoreBudget(tender.budget_amount, config, tender.purchaser_name, tender.platform);
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
    scoredProfileAt: config.preferences.profileUpdatedAt,
    _prompt: llmResult._prompt,
    _response: llmResult._response,
  };
}

function preFilterScore(tender: TenderRow, config: UserConfig): number {
  const W = getWeights();
  const budgetScore = scoreBudget(tender.budget_amount, config, tender.purchaser_name, tender.platform);
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
    tenders = db.prepare(`SELECT id, platform, title, purchaser_name, budget_amount, region_name, notice_type, content_text, publish_date, keyword, url FROM tenders WHERE id IN (${placeholders})`).all(...tenderIds) as TenderRow[];
  } else {
    tenders = db.prepare('SELECT id, platform, title, purchaser_name, budget_amount, region_name, notice_type, content_text, publish_date, keyword, url FROM tenders ORDER BY publish_date DESC LIMIT 50').all() as TenderRow[];
  }

  if (tenders.length === 0) return { processed: 0, users: 0 };

  let processed = 0;
  let skippedByFilter = 0;

  const insertStmt = db.prepare(`
    INSERT OR REPLACE INTO tender_recommendations (id, user_id, tender_id, total_score, tier, score_business, score_budget, score_qualification, score_relationship, score_region, score_timeliness, ai_reason, risk_notes, ai_analysis, ai_strategy, scored_profile_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const user of users) {
    const config = loadUserConfig(user.id);
    // 简介算"已配置"：只填了简介没填标签的用户也该评分，否则新的引导路径（先写简介）
    // 走到最后一步会静默什么都不产出。
    if (
      config.keywords.length === 0 &&
      config.preferences.caseTags.length === 0 &&
      !config.preferences.companyProfile.trim()
    ) continue;

    // Count user's feedback to determine strictness
    const feedbackCount = (db.prepare('SELECT COUNT(*) as count FROM tender_user_feedback WHERE user_id = ?').get(user.id) as any).count;
    const threshold = feedbackCount < 5 ? Math.max(10, getPreFilterThreshold() - 15) : getPreFilterThreshold();

    let userProcessed = 0;
    let userSkipped = 0;
    let userSkippedByPlatform = 0;

    // 用户勾选的关注平台。空数组 = 不限平台（老用户与未配置过的用户保持全量）。
    const wantedPlatforms = new Set(config.preferences.platforms);

    // 飞书推送：本轮该用户新产生的、达到阈值的推荐（评完统一推送一条）
    const feishuPref = db.prepare(
      'SELECT feishu_webhook, feishu_secret, feishu_enabled, feishu_min_score FROM tender_user_preferences WHERE user_id = ?'
    ).get(user.id) as any;
    const feishuOn = !!feishuPref?.feishu_enabled && !!feishuPref?.feishu_webhook;
    const feishuMinScore = feishuPref?.feishu_min_score ?? 55;
    const feishuItems: FeishuTenderItem[] = [];

    for (const tender of tenders) {
      // 未勾选的平台完全不参与：不评分、不入推荐表、不推送。
      // 放在最前面，连 filter 档记录都不写，否则用户之后勾上该平台时
      // 上面的 existing 判断会把它当"已评过"而永远跳过。
      if (wantedPlatforms.size > 0 && !wantedPlatforms.has(tender.platform)) {
        userSkippedByPlatform++;
        continue;
      }

      const existing = db.prepare('SELECT id FROM tender_recommendations WHERE user_id = ? AND tender_id = ?').get(user.id, tender.id) as any;
      if (existing) continue;

      // Pre-filter: rule-based quick check (relaxed for users with little feedback)
      const preScore = preFilterScore(tender, config);
      if (preScore < threshold) {
        // Save as filter tier without calling LLM
        insertStmt.run(
          uuidv4(), user.id, tender.id,
          preScore, 'filter',
          0, scoreBudget(tender.budget_amount, config, tender.purchaser_name, tender.platform), 0,
          scoreRelationship(tender.purchaser_name, config),
          scoreRegion(tender.region_name, config),
          scoreTimeliness(tender.publish_date),
          '规则初筛：相关度较低', '', '', '',
          // 初筛没走 LLM，简介压根没参与，所以不盖版本戳：
          // 盖了就等于宣称"这条已按当前简介评过"，改简介后前台不会提示重评。
          null,
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
          score.scoredProfileAt,
          new Date().toISOString()
        );
        userProcessed++;
        processed++;
        // 达到飞书推送阈值（且非 filter 档）则收集，评完统一推送
        if (feishuOn && score.tier !== 'filter' && score.totalScore >= feishuMinScore) {
          feishuItems.push({
            title: tender.title,
            purchaserName: tender.purchaser_name,
            totalScore: score.totalScore,
            tier: score.tier,
            budgetAmount: tender.budget_amount,
            regionName: tender.region_name,
            url: tender.url ?? null,
          });
        }
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

    onLog?.(`用户 ${user.id.slice(0, 8)} 完成：LLM评分 ${userProcessed} 条${userSkippedByPlatform > 0 ? `，跳过 ${userSkippedByPlatform} 条未关注平台` : ''}`);

    // 多维表格同步（失败不影响评分主流程）。
    // 必须排在卡片推送之前：卡片按钮会跳到这张表，先把数据写进去，用户点开才不是空的。
    // 与 webhook 无关，是独立通道 —— 没配 webhook 也照样同步。
    let bitableUrl = '';
    try {
      bitableUrl = getBitableUrl(user.id);
      if (bitableUrl) {
        const r = await syncUserRecommendations(user.id, Date.now());
        if (r.synced > 0) {
          onLog?.(`  📊 多维表格已同步 ${r.synced} 条推荐给用户 ${user.id.slice(0, 8)}`);
        }
        // 「全部标讯」表独立同步：它不看分数，只要库里有新标讯就补进去。
        // 单独 try 是因为这张表失败不该让推荐表的同步结果一起被吞掉。
        try {
          const ra = await syncAllTenders(user.id, Date.now());
          if (ra.synced > 0) {
            onLog?.(`  📋 全部标讯表已同步 ${ra.synced} 条给用户 ${user.id.slice(0, 8)}`);
          }
        } catch (e: any) {
          console.error(`[tender] All-tenders sync failed for user=${user.id}:`, e.message);
          onLog?.(`  ⚠️ 全部标讯表同步失败：${e.message}`);
        }
      }
    } catch (e: any) {
      console.error(`[tender] Bitable sync failed for user=${user.id}:`, e.message);
      onLog?.(`  ⚠️ 多维表格同步失败：${e.message}`);
    }

    // 飞书推送（失败不影响评分主流程）
    if (feishuOn && feishuItems.length > 0) {
      try {
        const result = await pushTenderRecommendations(
          feishuPref.feishu_webhook,
          feishuPref.feishu_secret || undefined,
          feishuItems,
          Date.now(),
          bitableUrl || undefined
        );
        if (result.ok) {
          onLog?.(`  📮 飞书已推送 ${feishuItems.length} 条给用户 ${user.id.slice(0, 8)}`);
        } else {
          onLog?.(`  ⚠️ 飞书推送失败（code=${result.code ?? '?'} ${result.msg ?? ''}）`);
        }
      } catch (e: any) {
        console.error(`[tender] Feishu push failed for user=${user.id}:`, e.message);
        onLog?.(`  ⚠️ 飞书推送异常：${e.message}`);
      }
    }
  }

  onLog?.(`推荐评分全部完成：共处理 ${processed} 条`);
  return { processed, users: users.length };
}
