import { Router } from 'express';
import { STAGES, stageByKey } from '../services/consult/stages.js';
import {
  listProjects,
  createProject,
  getProject,
  updateBrief,
  renameProject,
  deleteProject,
  listEntries,
  buildStageRail,
  saveEntry,
  touchStage,
  appendMessage,
  listMessages,
  MAX_BRIEF_CHARS,
  MAX_BRAND_NAME_CHARS,
  MAX_ENTRY_FIELD_CHARS,
  MAX_ENTRY_BODY_CHARS,
} from '../services/consult/projectStore.js';
import {
  draftFastStage,
  draftDirections,
  requireStage,
  StageError,
  CONFIDENCE_VALUES,
  MAX_AI_OPPORTUNITIES,
  MAX_AI_OPPORTUNITY_CHARS,
} from '../services/consult/draftService.js';
import { chatInStage, directionsToText, draftToText } from '../services/consult/chatService.js';
import { buildIntake, applyAnswers } from '../services/consult/intakeService.js';
import {
  saveRound,
  openRound,
  saveDraftAnswers,
  markApplied,
  countAppliedRounds,
  answeredQuestions,
} from '../services/consult/intakeStore.js';
import {
  listSources,
  adoptSources,
  deleteSource,
  countSources,
  sourceLevelFor,
  MAX_SOURCES_PER_PROJECT,
} from '../services/consult/sourceStore.js';
import { webSearch, isSearchEnabled } from '../services/webSearchService.js';
import { QuotaExceededError } from '../core/llm/gateway.js';

// 品牌咨询工作台（/consult）。一个品牌 = 一个项目，全部状态落库。
// 快车道（四看）：出草稿 → 用户改 → 定稿进知识库。
// 慢车道：出方向 → 选一个（或接着聊）→ 定稿。
// 每个阶段一段对话，草稿和方向卡也写进那段对话（见 migrations/077）。

export const consultRouter = Router();

/** 把业务错误按自己的状态码透出去；额度用完统一 429（前端 api.ts 认这个）。 */
function fail(err: unknown, res: any, next: any): void {
  if (err instanceof QuotaExceededError) {
    res.status(429).json({ error: 'quota_exceeded', remaining: 0, daily_limit: err.dailyLimit });
    return;
  }
  if (err instanceof StageError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  // 专属渠道缺档由 app.ts 的全局处理器透出原文（503），不要在这里兜成 500
  next(err);
}

/** 阶段清单（前端画阶段栏用）。放在服务端返回，避免前后端各写一份对不上。 */
consultRouter.get('/stages', (_req, res) => {
  res.json(
    STAGES.map((s) => ({
      key: s.key,
      label: s.label,
      group: s.group,
      lane: s.lane,
      question: s.question,
      requires: s.requires,
      method: s.method,
      deliverables: s.deliverables,
    }))
  );
});

consultRouter.get('/projects', (req, res) => {
  res.json(listProjects(req.user!.id));
});

consultRouter.post('/projects', (req, res) => {
  const brandName = String(req.body?.brandName || '').trim();
  const brief = String(req.body?.brief || '').trim();
  if (!brandName) return res.status(400).json({ error: '请填写品牌 / 客户名称' });
  if (brandName.length > MAX_BRAND_NAME_CHARS) {
    return res.status(400).json({ error: `名称最多 ${MAX_BRAND_NAME_CHARS} 字` });
  }
  // 超长直接拒，不截断：这段资料会进四看每一次调用的 prompt，
  // 悄悄砍掉后半段的话 AI 是照着不完整的资料出结论的，而结论看起来完全正常。
  if (brief.length > MAX_BRIEF_CHARS) {
    return res.status(400).json({
      error: `资料最多 ${MAX_BRIEF_CHARS} 字，当前 ${brief.length} 字。请自己删减后再提交（不会自动截断，避免 AI 照着半份资料出结论）`,
    });
  }
  const project = createProject(req.user!.id, brandName, brief);
  res.json({ project, stages: buildStageRail(project.id), entries: [] });
});

consultRouter.get('/projects/:id', (req, res) => {
  const project = getProject(req.params.id, req.user!.id);
  if (!project) return res.status(404).json({ error: '项目不存在' });
  res.json({
    project,
    stages: buildStageRail(project.id),
    entries: listEntries(project.id),
    sources: listSources(project.id),
    // 没提交的那一轮问卷（刷新页面靠它恢复：一份十几题的问卷是拿去问客户的）
    intake: openRound(project.id),
    intakeRounds: countAppliedRounds(project.id),
    // 联网能不能用必须让前端知道：藏起那个面板的话，用户以为「这个系统只会瞎猜」；
    // 显示成能用而搜出来是空的，他会以为网上真的没有这家公司的资料。
    searchEnabled: isSearchEnabled(),
  });
});

consultRouter.put('/projects/:id/brief', (req, res) => {
  const brief = String(req.body?.brief ?? '').trim();
  if (brief.length > MAX_BRIEF_CHARS) {
    return res.status(400).json({
      error: `资料最多 ${MAX_BRIEF_CHARS} 字，当前 ${brief.length} 字`,
    });
  }
  if (!updateBrief(req.params.id, req.user!.id, brief)) {
    return res.status(404).json({ error: '项目不存在' });
  }
  res.json({ ok: true });
});

consultRouter.put('/projects/:id/name', (req, res) => {
  const brandName = String(req.body?.brandName || '').trim();
  if (!brandName) return res.status(400).json({ error: '请填写品牌 / 客户名称' });
  if (brandName.length > MAX_BRAND_NAME_CHARS) {
    return res.status(400).json({ error: `名称最多 ${MAX_BRAND_NAME_CHARS} 字` });
  }
  if (!renameProject(req.params.id, req.user!.id, brandName)) {
    return res.status(404).json({ error: '项目不存在' });
  }
  res.json({ ok: true });
});

/**
 * 快车道出结论草稿。**不落库** —— 用户改完调下面那个定稿接口才存。
 * 草稿不落库的代价是刷新页面就没了，所以前端必须提示；落库的代价更大：
 * 一份没人 review 过的草稿会以「已定稿」的身份进下游 prompt。
 */
consultRouter.post('/projects/:id/stages/:key/draft', async (req, res, next) => {
  try {
    const project = getProject(req.params.id, req.user!.id);
    if (!project) return res.status(404).json({ error: '项目不存在' });
    const { draft, truncated } = await draftFastStage(req.user!.id, project, req.params.key);
    // 出过一轮就记一轮：界面上「第 N 轮」是他唯一能看出草稿重出过的地方
    touchStage(project.id, req.params.key, 'exploring', { incRound: true });
    // 草稿进对话：他下一句往往是「把结论里那句改成…」，指的就是这一版
    const message = appendMessage(project.id, req.params.key, {
      role: 'assistant',
      kind: 'draft',
      content: draftToText(draft),
      payload: draft,
    });
    res.json({ draft, truncated, message, stages: buildStageRail(project.id) });
  } catch (err) {
    fail(err, res, next);
  }
});

/**
 * 慢车道出候选方向（2-4 个互斥方向）。同样不落库 —— 用户选中哪个、改成什么样，
 * 定稿的时候才是事实。
 */
consultRouter.post('/projects/:id/stages/:key/directions', async (req, res, next) => {
  try {
    const project = getProject(req.params.id, req.user!.id);
    if (!project) return res.status(404).json({ error: '项目不存在' });
    const out = await draftDirections(req.user!.id, project, req.params.key);
    touchStage(project.id, req.params.key, 'exploring', { incRound: true });
    // 方向卡进对话：「第 2 个方向再往深挖」的指代对象只存在于这一条里
    const message = appendMessage(project.id, req.params.key, {
      role: 'assistant',
      kind: 'directions',
      content: directionsToText(out),
      payload: out,
    });
    res.json({ ...out, message, stages: buildStageRail(project.id) });
  } catch (err) {
    fail(err, res, next);
  }
});

/** 某个阶段的对话（含方向卡 / 草稿）。刷新页面靠它恢复。 */
consultRouter.get('/projects/:id/stages/:key/messages', (req, res) => {
  const project = getProject(req.params.id, req.user!.id);
  if (!project) return res.status(404).json({ error: '项目不存在' });
  if (!stageByKey(req.params.key)) return res.status(404).json({ error: '没有这个阶段' });
  res.json({ messages: listMessages(project.id, req.params.key) });
});

/** 在这个阶段里接着聊。 */
consultRouter.post('/projects/:id/stages/:key/chat', async (req, res, next) => {
  try {
    const project = getProject(req.params.id, req.user!.id);
    if (!project) return res.status(404).json({ error: '项目不存在' });
    const turn = await chatInStage(req.user!.id, project, req.params.key, String(req.body?.text || ''));
    touchStage(project.id, req.params.key, 'exploring');
    res.json({ ...turn, stages: buildStageRail(project.id) });
  } catch (err) {
    fail(err, res, next);
  }
});

/** 定稿：写进企业知识库，并把下游标成待重跑。 */
consultRouter.put('/projects/:id/stages/:key/entry', (req, res, next) => {
  try {
    const project = getProject(req.params.id, req.user!.id);
    if (!project) return res.status(404).json({ error: '项目不存在' });

    // 不带 lane：慢车道以后也走这个定稿接口，闸门只管「阶段存在 + 前提齐了」
    requireStage(project.id, req.params.key);

    const conclusion = String(req.body?.conclusion || '').trim();
    if (!conclusion) return res.status(400).json({ error: '结论不能为空' });
    // 正文单独校验：它比其余字段长一个量级（里面是好几张表），
    // 但同样只拒不截 —— 截掉的是最后那张数据置信度表，而缺了它的正文看起来是完整的。
    const body = String(req.body?.body || '').trim();
    if (body.length > MAX_ENTRY_BODY_CHARS) {
      return res.status(400).json({
        error: `正文最多 ${MAX_ENTRY_BODY_CHARS} 字，当前 ${body.length} 字（不自动截断，避免悄悄丢掉最后几节）`,
      });
    }
    // AI 机会只拒不截：他手填的第 3 条被悄悄丢掉的话，界面上是「已定稿」，
    // 而报告最后那一章里永远没有那一条 —— 方法论限的就是每步 1-2 条，超了要他自己挑。
    const aiOpportunities = (Array.isArray(req.body?.aiOpportunities) ? req.body.aiOpportunities : [])
      .map((x: unknown) => String(x ?? '').trim().replace(/\s*\n\s*/g, ' '))
      .filter(Boolean);
    if (aiOpportunities.length > MAX_AI_OPPORTUNITIES) {
      return res.status(400).json({
        error: `AI 赋能机会每步最多 ${MAX_AI_OPPORTUNITIES} 条（现在 ${aiOpportunities.length} 条）。方法论要求各模块只标 1-2 个，最后汇成独立一章 —— 自己挑最能落地的留下`,
      });
    }
    const tooLong = aiOpportunities.find((x: string) => x.length > MAX_AI_OPPORTUNITY_CHARS);
    if (tooLong) {
      return res.status(400).json({
        error: `AI 赋能机会一条最多 ${MAX_AI_OPPORTUNITY_CHARS} 字（现在 ${tooLong.length} 字）。这一栏是「只标不展开」的一句话，要展开就写进正文`,
      });
    }

    const fields = {
      conclusion,
      rationale: String(req.body?.rationale || '').trim(),
      evidence: String(req.body?.evidence || '').trim(),
      confidence: String(req.body?.confidence || 'mid'),
      // 证据级别在服务端按「实际喂给模型的是什么」算，不收前端也不问模型：
      // 这里原来硬写成 'L1'，于是一条纯靠常识编出来的结论挂着「联网检索」的牌子。
      sourceLevel: sourceLevelFor({
        hasSources: countSources(project.id) > 0,
        hasBrief: !!project.brief.trim(),
      }),
    };
    for (const [k, v] of Object.entries(fields)) {
      if (v.length > MAX_ENTRY_FIELD_CHARS) {
        return res.status(400).json({
          error: `${k} 最多 ${MAX_ENTRY_FIELD_CHARS} 字，当前 ${v.length} 字（每条定稿都会进下游的 prompt，所以不自动截断）`,
        });
      }
    }
    if (!(CONFIDENCE_VALUES as readonly string[]).includes(fields.confidence)) {
      return res.status(400).json({ error: `置信度只能是 ${CONFIDENCE_VALUES.join(' / ')}` });
    }

    const { entry, staled } = saveEntry(project.id, req.params.key, { ...fields, body, aiOpportunities });
    res.json({
      entry,
      // 被标成待重跑的下游，前端必须显示出来：不说的话用户以为「改一句结论」
      // 只影响这一句，最后拿到的是一份自相矛盾的方案，中途一句错都不报。
      staled: staled.map((k) => stageByKey(k)?.label || k),
      stages: buildStageRail(project.id),
      entries: listEntries(project.id),
    });
  } catch (err) {
    fail(err, res, next);
  }
});

// ── 补料问卷（资料补全）──────────────────────────────────

/**
 * 让 AI 读客户资料，出一份「还得问客户什么」的问卷。**不落库**（和草稿一样）——
 * 刷新就没了，前端必须说出来。
 */
consultRouter.post('/projects/:id/intake', async (req, res, next) => {
  try {
    const project = getProject(req.params.id, req.user!.id);
    if (!project) return res.status(404).json({ error: '项目不存在' });
    // 已经问过并且答过的题不再问（见 intakeStore.answeredQuestions）
    const sheet = await buildIntake(req.user!.id, project, answeredQuestions(project.id));
    const round = saveRound(project.id, sheet);
    res.json({ ...sheet, round, rounds: countAppliedRounds(project.id) });
  } catch (err) {
    fail(err, res, next);
  }
});

/**
 * 暂存填了一半的答案。前端逐题失焦时调 —— 一份十几题的问卷是拿去逐条问客户的，
 * 不暂存的话切个页面就全空了，而界面上不报任何错。
 */
consultRouter.put('/projects/:id/intake/answers', (req, res) => {
  const project = getProject(req.params.id, req.user!.id);
  if (!project) return res.status(404).json({ error: '项目不存在' });
  const roundId = String(req.body?.roundId || '');
  const answers = req.body?.answers && typeof req.body.answers === 'object' ? req.body.answers : {};
  if (!saveDraftAnswers(project.id, roundId, answers)) {
    // 找不到那一轮（或者它已经补进资料了）必须报出来：静默 200 的话前端一路
    // 显示「已暂存」，用户关掉页面，回来发现一个字都没有。
    return res.status(409).json({ error: '这一轮问卷不在了（已经补进资料或被新的一轮替换）—— 别关页面，先把填好的补进资料' });
  }
  res.json({ ok: true });
});

/**
 * 把填好的答案**追加**进客户资料。
 *
 * 服务端自己拼、自己写，不收整份 brief：前端那个 20000 字的输入框和这次追加是两个
 * 来源，让它回传整段就等于「谁最后点保存谁赢」—— 用户刚补的答案被另一边覆盖掉，
 * 而两次操作都回「已保存」。
 */
consultRouter.post('/projects/:id/intake/apply', (req, res, next) => {
  try {
    const project = getProject(req.params.id, req.user!.id);
    if (!project) return res.status(404).json({ error: '项目不存在' });
    const answers = Array.isArray(req.body?.answers) ? req.body.answers : [];
    const stamp = new Date().toISOString().slice(0, 10);
    // 先拼（超上限/一题没填在这里就抛了），再占位，最后写资料 ——
    // 反过来的话那一轮被标成已提交而资料没动，问卷就此消失。
    const { brief, applied } = applyAnswers(project, answers, stamp);
    const roundId = String(req.body?.roundId || '');
    if (roundId) {
      const map: Record<string, string> = {};
      for (const a of answers) if (a?.id) map[String(a.id)] = String(a.answer ?? '');
      if (!markApplied(project.id, roundId, map, applied)) {
        return res.status(409).json({
          error:
            '这一轮问卷已经补进资料了（去「客户原始资料」末尾看那一段）。再补一遍会让同一批答案在资料里出现两份，AI 会把它当成两处独立印证。',
        });
      }
    }
    updateBrief(project.id, req.user!.id, brief);
    res.json({ applied, brief, briefChars: brief.length, rounds: countAppliedRounds(project.id) });
  } catch (err) {
    fail(err, res, next);
  }
});

// ── 联网查资料（L1 数据源）────────────────────────────────

/**
 * 搜一次。**不落库** —— 结果要用户逐条勾选，采纳走下面那个接口。
 *
 * 没配 key 时回 503 并说清楚，不回空列表：空列表读起来是「网上没有这家公司的资料」，
 * 而真实原因是这个部署压根没接搜索。
 */
consultRouter.post('/projects/:id/stages/:key/search', async (req, res, next) => {
  try {
    const project = getProject(req.params.id, req.user!.id);
    if (!project) return res.status(404).json({ error: '项目不存在' });
    if (!stageByKey(req.params.key)) return res.status(404).json({ error: '没有这个阶段' });
    const query = String(req.body?.query || '').trim();
    if (!query) return res.status(400).json({ error: '想查什么？填一句关键词' });
    if (!isSearchEnabled()) {
      return res.status(503).json({
        error:
          '联网检索没开：管理员还没在「系统配置 > 联网搜索」里填 Tavily key。' +
          '现在 AI 只能用客户资料（L2）和模型内置知识给区间（L3），不会替你上网 —— 需要外部事实请自己贴进客户资料。',
      });
    }
    const results = await webSearch(query, { maxResults: 8 });
    res.json({ query, results });
  } catch (err) {
    // 检索本身失败（key 过期 / 配额用完 / 网络）要把原文透出去：
    // 兜成 500「服务器错误」的话，用户读成「这个词网上没有资料」，接着就按 L3 编了。
    res.status(502).json({ error: `联网检索失败：${(err as Error).message}` });
  }
});

/** 采纳勾选的结果。重复的按 url 挡掉，但挡了几条要报出去。 */
consultRouter.post('/projects/:id/stages/:key/sources', (req, res, next) => {
  try {
    const project = getProject(req.params.id, req.user!.id);
    if (!project) return res.status(404).json({ error: '项目不存在' });
    if (!stageByKey(req.params.key)) return res.status(404).json({ error: '没有这个阶段' });
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) return res.status(400).json({ error: '先勾几条再采纳' });
    // 只拒不截：截掉后半截的话用户以为 AI 读过他勾的那几条（他明明勾了）
    const room = MAX_SOURCES_PER_PROJECT - countSources(project.id);
    if (items.length > room) {
      return res.status(400).json({
        error: `一个项目最多采纳 ${MAX_SOURCES_PER_PROJECT} 条联网资料，还能加 ${Math.max(room, 0)} 条（不会自动只存前几条）。先删掉用不上的那些。`,
      });
    }
    const { added, skipped } = adoptSources(
      project.id,
      req.params.key,
      String(req.body?.query || ''),
      items
    );
    res.json({ added, skipped, sources: listSources(project.id) });
  } catch (err) {
    next(err);
  }
});

consultRouter.delete('/projects/:id/sources/:sid', (req, res) => {
  const project = getProject(req.params.id, req.user!.id);
  if (!project) return res.status(404).json({ error: '项目不存在' });
  if (!deleteSource(project.id, req.params.sid)) return res.status(404).json({ error: '这条资料不存在' });
  res.json({ sources: listSources(project.id) });
});

consultRouter.delete('/projects/:id', (req, res) => {
  if (!deleteProject(req.params.id, req.user!.id)) {
    return res.status(404).json({ error: '项目不存在' });
  }
  res.json({ ok: true });
});
