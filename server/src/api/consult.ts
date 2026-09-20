import { Router } from 'express';
import OpenAI from 'openai';
import { STAGE_DEFAULTS, stages, stageByKey, type StageDef } from '../services/consult/stages.js';
import {
  listStageOverrides,
  setStageOverride,
  parseLines,
  type StageField,
  type StageOverrideRow,
} from '../services/consult/stageOverrides.js';
import { buildBrief } from '../services/consult/briefCompose.js';
import { mountExtractRoutes } from './extractRoutes.js';
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
  type ProjectOwner,
} from '../services/consult/projectStore.js';
import {
  draftFastStage,
  draftDirections,
  requireStage,
  requireOpenStage,
  StageError,
  CONFIDENCE_VALUES,
  MAX_AI_OPPORTUNITIES,
  MAX_AI_OPPORTUNITY_CHARS,
} from '../services/consult/draftService.js';
import { buildDecisions, applyDecisions } from '../services/consult/decisionService.js';
import {
  chatInStage,
  directionsToText,
  decisionsToText,
  decidedToText,
  draftToText,
  entryToText,
} from '../services/consult/chatService.js';
import { buildReport, missingStages } from '../services/consult/reportService.js';
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
import { registerConsultSdkRoutes, registerConsultSdkAdminRoutes } from './consultSdk.js';
import { consultSdkLimits, chargeExtraSdkAiCalls } from '../services/consult/sdkLimits.js';
import { requireAdmin } from '../auth/guards.js';

// 品牌咨询工作台（/consult）。一个品牌 = 一个项目，全部状态落库。
// 快车道（四看）：出草稿 → 用户改 → 定稿进知识库。
// 慢车道：出方向 → 选一个（或接着聊）→ 定稿。
// 每个阶段一段对话，草稿和方向卡也写进那段对话（见 migrations/077）。

export const consultRouter = Router();

// 对外接入（084）：pk 换短 token 的路由是 PUBLIC（校验在 handler 里），
// 带 scope 的短 token 能碰哪些端点由全局 `auth/scopeGuard.ts` 管 —— 不在这里再写一份。
registerConsultSdkRoutes(consultRouter);

// /admin/* 统一闸门：必须挂在任何 /admin 路由注册之前，Express 才会先过它。
// SDK 的 admin 路由（发 key / 配白名单 / 停用）也必须注册在这道闸门之后。
consultRouter.use('/admin', requireAdmin);
registerConsultSdkAdminRoutes(consultRouter);

// 每把 pk 的天花板（086）：key 停用即失效 + 每日 AI 次数 + 项目总数。
// 必须挂在下面所有业务路由**之前**，也必须在 /admin 之后（后台自己不受 pk 上限管）。
consultRouter.use(consultSdkLimits);

/**
 * 这次请求属于哪个租户（085）。网页登录的用户后两项是 null；第三方 iframe 里的
 * 每个终端用户是 `(绑定账号, 那把 pk, 他那边的 uid)`。
 *
 * 两项都**只从签过名的 token 里取**（`authMiddleware` 写的 `req.sdkPk` / `req.externalUid`）——
 * 从 body/query 里收的话第三方页面上任何人改一个参数就换成别人的租户，而返回的是一份
 * 正常的项目列表。AI 额度仍旧记在 `req.user!.id` 上（钱是绑定账号付的），别拿这个当额度键。
 */
function owner(req: { user?: { id: string }; sdkPk?: string; externalUid?: string }): ProjectOwner {
  return {
    userId: req.user!.id,
    sdkPk: req.sdkPk ?? null,
    externalUid: req.externalUid ?? null,
  };
}

/** 把业务错误按自己的状态码透出去；额度用完统一 429（前端 api.ts 认这个）。 */
function fail(err: unknown, res: any, next: any): void {
  if (err instanceof QuotaExceededError) {
    // `error: 'quota_exceeded'` 是给 api.ts 那个全局弹窗认的机器码，**另外要带 detail**：
    // 撞的是账号总额还是「品牌咨询」这个应用的单独额度、上限是多少，只有 err.message 里有。
    // 不带的话前端只能写死一句「缺省 10 次/天」—— 而开了专属渠道（后台显示「不限」）
    // 或者被单独配了应用额度的账号看到这句话完全对不上，只会以为是程序算错了。
    res.status(429).json({
      error: 'quota_exceeded', remaining: 0, daily_limit: err.dailyLimit, app: err.app, detail: err.message,
    });
    return;
  }
  if (err instanceof StageError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  // 上游超时。**必须自己认出来**：SDK 的 APIConnectionTimeoutError 不设 name、status 是
  // undefined，落到 next(err) 就被全局处理器兜成一句「Internal server error」——
  // 界面上「模型太慢」和「后端崩了」于是长得一模一样，而两者的解法（换个快模型 / 看服务端栈）
  // 完全相反，用户只会一路重试，每次等满超时、每次扣一次额度。
  if (err instanceof OpenAI.APIConnectionTimeoutError) {
    res.status(504).json({
      error:
        // 这句话对所有 consult 端点都成立才行（补料问卷也走这个 fail()）——
        // 原来写的是「这一步要写好几张表」，出问卷时那是假的，用户照着去删表格是删不到的。
        `模型在超时时间内没有返回（这一步一次要写很长，带思维链的模型容易顶到超时）。这次的 AI 额度已经扣了。\n` +
        `别连着重点 —— 同样的资料它多半还是这么慢。两个真正管用的做法：` +
        `① 去「专属 AI / 系统配置」把 strong 那一档换成更快的模型；② 把客户资料删短一些再试。`,
    });
    return;
  }
  // 上游网关自己掐了这次长请求（实测那条接入点 ~300 秒回一句 nginx 的 `504 <html>`）。
  // 原文是一坨 HTML，直接透出去的话用户读不出「是时间上限，不是模型不会答」——
  // 而这两件事的解法相反：加大 max_tokens 只会更慢更稳定地撞上同一堵墙。
  if (err instanceof OpenAI.APIError && (err.status === 504 || err.status === 524)) {
    res.status(504).json({
      error:
        `上游网关掐掉了这次请求（HTTP ${err.status}）：这条接入点对单次请求有时间上限，` +
        `而这一步的思维链太长，撑不进那个上限。这次的 AI 额度已经扣了。\n` +
        `重点没有用（同样的资料它还是要想这么久）。管用的是换一个思维链短的模型：` +
        `去「专属 AI」把 strong 那一档换掉，或者把客户资料删短一些再试。`,
    });
    return;
  }
  // 上游那台机器忙不过来（实测 `503 system cpu overloaded (current: 97.5%, threshold: 90%)`）。
  // **必须和「配置错了」分开说**：原文透出去的话读起来像我们这边坏了，用户会去改文件、
  // 调参数、或者一分钟点五次（每次真扣一次额度），而问题压根不在他这边。
  // 网关已经隔 2.5 秒重发过一次了（`retryOnBusy`），所以这句话是「重发也没过」。
  if (err instanceof OpenAI.APIError && (err.status === 429 || err.status === 503 || err.status === 500 || err.status === 502)) {
    res.status(502).json({
      error:
        `上游那台机器现在忙不过来（HTTP ${err.status}）：${err.message}\n` +
        `已经自动重发过一次了，还是这句。**不是你的文件的问题**，改文件、删内容、调参数都没用 ——` +
        `等几分钟再点一次，或者去「专属 AI」换一条空闲的接入点。（这次的 AI 额度已经扣了）`,
    });
    return;
  }
  // 上游其它失败（模型名不对 / 余额不足 / 网关 4xx）要把原文带出去：
  // 兜成 500 的话这些只在服务端日志里，而它们全是一句话就能改掉的配置问题。
  if (err instanceof OpenAI.APIError) {
    res.status(502).json({
      error: `上游模型报错${err.status ? `（HTTP ${err.status}）` : ''}：${err.message}（这次的 AI 额度已经扣了）`,
    });
    return;
  }
  // 专属渠道缺档由 app.ts 的全局处理器透出原文（503），不要在这里兜成 500
  next(err);
}

/** 阶段清单（前端画阶段栏用）。放在服务端返回，避免前后端各写一份对不上。 */
consultRouter.get('/stages', (_req, res) => {
  res.json(
    stages().map((s) => ({
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

// ── 后台：改各步的「分析操法」和「本步必须产出的东西」（088）──────────────
//
// 只这两栏能改（见 stages.ts 文件头）。上限是**只拒不截**：截掉的那几条正好是他刚写的，
// 而界面上会显示「已保存」，下一次生成就按少了几条的清单跑，正文照样每节都在。
const MAX_STAGE_FIELD_CHARS = 6000;
const MAX_STAGE_FIELD_LINES = 24;

const FIELD_LABEL: Record<StageField, string> = {
  method: '分析操法',
  deliverables: '本步必须产出的东西',
};

function fieldView(defLines: string[], row?: StageOverrideRow) {
  const lines = row ? parseLines(row.body) : [];
  return {
    // 缺省和当前值一起回：后台只显示当前值的话，「这条是我改的还是本来就这样」分不出来，
    // 而恢复缺省之后他也没法比对到底变回了什么。
    default: defLines,
    current: lines.length ? lines : defLines,
    overridden: lines.length > 0,
    updated_at: row?.updated_at ?? null,
    updated_by: row?.updated_by ?? null,
  };
}

function stageAdminView(def: StageDef, ov: Map<string, StageOverrideRow>) {
  const method = fieldView(def.method, ov.get(`${def.key}.method`));
  const deliverables = fieldView(def.deliverables, ov.get(`${def.key}.deliverables`));
  return {
    key: def.key,
    label: def.label,
    group: def.group,
    lane: def.lane,
    question: def.question,
    method,
    deliverables,
    highlight: def.highlight ?? null,
    // 定稿气泡摊开的那一节按 highlight 的**前缀原词**去认（见 StageDef.highlight）。
    // 改清单时把那一项的开头改掉，气泡里那张表就再也摊不开 —— 那一步的定稿读起来
    // 只是「只有一句结论」，所以这里要当场说出来。
    highlight_broken:
      !!def.highlight && !deliverables.current.some((d) => d.startsWith(def.highlight!)),
  };
}

/** 后台列表：十四步各自的缺省 + 当前值 + 改过没有。 */
consultRouter.get('/admin/stages', (_req, res) => {
  const ov = new Map(listStageOverrides().map((r) => [`${r.stage_key}.${r.field}`, r]));
  res.json({
    limits: { chars: MAX_STAGE_FIELD_CHARS, lines: MAX_STAGE_FIELD_LINES },
    stages: STAGE_DEFAULTS.map((s) => stageAdminView(s, ov)),
  });
});

/**
 * 改一步。body `{ method?: string, deliverables?: string }`，**一行一条**（原文，服务端切）。
 *
 * 内容为空 = 回落代码里的缺省（不存空串 —— 空的操法在 prompt 里就是「这一步没有规定的
 * 顺序」，模型自己想一套把表格填满，而那种正文和照方法论推出来的一模一样）。
 * 所以「恢复缺省」就是提交一个空串，没有第二个端点。
 */
consultRouter.put('/admin/stages/:key', (req, res) => {
  const def = STAGE_DEFAULTS.find((s) => s.key === req.params.key);
  if (!def) {
    res.status(404).json({ error: `没有「${req.params.key}」这一步（阶段清单在代码里，后台只能改文字，不能加减步骤）` });
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const given = (['method', 'deliverables'] as StageField[]).filter((f) => typeof body[f] === 'string');
  if (!given.length) {
    res.status(400).json({ error: '没有要改的内容（method / deliverables 至少给一个字符串）' });
    return;
  }

  // **先全部校验再写**：写一半再拒的话界面上是一句「保存失败」，而库里这一步已经半改了，
  // 下一次生成就按这半份跑，出来的正文读起来完全正常。
  for (const f of given) {
    const text = String(body[f]);
    if (text.length > MAX_STAGE_FIELD_CHARS) {
      res.status(400).json({
        error: `「${FIELD_LABEL[f]}」${text.length} 字，超过上限 ${MAX_STAGE_FIELD_CHARS} 字。请自己删到上限以内 —— 这里不替你截，截掉的正好是最后写的那几条。`,
      });
      return;
    }
    const lines = parseLines(text);
    if (lines.length > MAX_STAGE_FIELD_LINES) {
      res.status(400).json({
        error: `「${FIELD_LABEL[f]}」有 ${lines.length} 条，超过上限 ${MAX_STAGE_FIELD_LINES} 条。这一段每次生成都要发一遍，太长会把硬规则挤下去。`,
      });
      return;
    }
  }

  const warnings: string[] = [];
  for (const f of given) {
    const r = setStageOverride(def.key, f, String(body[f]), req.user!.id);
    if (r.mode === 'default') warnings.push(`「${FIELD_LABEL[f]}」已恢复成代码里的缺省（提交的内容是空的）。`);
  }

  const ov = new Map(listStageOverrides().map((r) => [`${r.stage_key}.${r.field}`, r]));
  const view = stageAdminView(def, ov);
  if (view.highlight_broken) {
    warnings.push(
      `定稿气泡要摊开的那一节按「${def.highlight}」认，而现在的清单里没有以它开头的那一项 —— ` +
        `这一步定稿后气泡里只剩一句结论，那张表要多点一次才看得到。把那一项的开头改回「${def.highlight}」，或者告诉开发改 highlight。`
    );
  }
  res.json({ ...view, warnings });
});

// 「上传资料 → 提取文字 → AI 整理」两条路（`/extract-file` / `/tidy-text`）挂在这里，
// 实现在 `api/extractRoutes.ts`（展示稿的「生成提纲」页用的是同一份）。`app: 'consult'`
// 决定这两次调用记在哪个应用的额度/日志上 —— 那份文件头写了传错会怎样静默出错。
mountExtractRoutes(consultRouter, {
  app: 'consult',
  fail: (err, _req, res, next) => fail(err, res, next),
  chargeExtra: (req, extra) => {
    if (req.sdkPk) chargeExtraSdkAiCalls(req.sdkPk, extra);
  },
});

consultRouter.get('/projects', (req, res) => {
  res.json(listProjects(owner(req)));
});

/**
 * 建项目。body `{ brandName, brief, attachments?: [{filename, text, variant}] }`。
 *
 * `attachments` 是上传的那几个文件整理出来的正文 —— 用户**不再逐份点「插入」**，
 * 提交这一下由服务端合成（`briefCompose.buildBrief`，超长/超单份上限一律只拒不截并点名）。
 * 合成放服务端的理由见那个文件的头：前端拼好整份回传的话，少带一份在界面上看不出来。
 */
consultRouter.post('/projects', (req, res, next) => {
  const brandName = String(req.body?.brandName || '').trim();
  const typed = String(req.body?.brief || '').trim();
  if (!brandName) return res.status(400).json({ error: '请填写品牌 / 客户名称' });
  if (brandName.length > MAX_BRAND_NAME_CHARS) {
    return res.status(400).json({ error: `名称最多 ${MAX_BRAND_NAME_CHARS} 字` });
  }
  try {
    // 超长直接拒，不截断：这段资料会进四看每一次调用的 prompt，
    // 悄悄砍掉后半段的话 AI 是照着不完整的资料出结论的，而结论看起来完全正常。
    const brief = buildBrief(typed, req.body?.attachments);
    const project = createProject(owner(req), brandName, brief);
    res.json({ project, stages: buildStageRail(project.id), entries: [] });
  } catch (e) {
    fail(e, res, next);
  }
});

consultRouter.get('/projects/:id', (req, res) => {
  const project = getProject(req.params.id, owner(req));
  if (!project) return res.status(404).json({ error: '项目不存在' });
  res.json({
    project,
    stages: buildStageRail(project.id),
    entries: listEntries(project.id),
    sources: listSources(project.id),
    // 没提交的那一轮问卷（刷新页面靠它恢复：一份七八题的问卷是拿去问客户的）
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
  if (!updateBrief(req.params.id, owner(req), brief)) {
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
  if (!renameProject(req.params.id, owner(req), brandName)) {
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
    const project = getProject(req.params.id, owner(req));
    if (!project) return res.status(404).json({ error: '项目不存在' });
    const { draft, truncated, discussion } = await draftFastStage(req.user!.id, project, req.params.key);
    // 出过一轮就记一轮：界面上「第 N 轮」是他唯一能看出草稿重出过的地方
    touchStage(project.id, req.params.key, 'exploring', { incRound: true });
    // 草稿进对话：他下一句往往是「把结论里那句改成…」，指的就是这一版
    const message = appendMessage(project.id, req.params.key, {
      role: 'assistant',
      kind: 'draft',
      content: draftToText(draft),
      payload: draft,
    });
    // discussion 只回条数，不回原文（原文就在他眼前的对话里）：带上和没带上
    // 这一版读起来一模一样，不回这个数的话「聊天到底有没有用」只能靠感觉。
    res.json({
      draft,
      truncated,
      discussion: { used: discussion.used, dropped: discussion.dropped },
      message,
      stages: buildStageRail(project.id),
    });
  } catch (err) {
    fail(err, res, next);
  }
});

/**
 * 丢弃这一版草稿 / 这几个候选方向。草稿本身不落库，所以这里只做一件事：
 * 在这一步的对话里留一条 `kind='discard'`。
 *
 * 缺了这条记录，前端那句 `draft = null` 只是本地清空：对话里那张「已生成草稿」的卡片
 * 还在，而它的 payload 里存着整份草稿 —— 切走再切回来 `restoreArtifact` 会把它原样
 * 恢复到右栏，用户明明点过「丢弃」那一版又回来了，两次操作都不报错。
 * 所以前端那次调用失败必须出声，不能当成「反正本地已经清了」。
 */
consultRouter.post('/projects/:id/stages/:key/draft/discard', (req, res, next) => {
  try {
    const project = getProject(req.params.id, owner(req));
    if (!project) return res.status(404).json({ error: '项目不存在' });
    requireStage(project.id, req.params.key);
    const isDirections = String(req.body?.kind || '') === 'directions';
    const message = appendMessage(project.id, req.params.key, {
      role: 'assistant',
      kind: 'discard',
      // 「没有进知识库」这半句是重点：用户分不清「丢弃草稿」和「删掉这一步的结论」，
      // 不说的话他会以为刚才定稿的东西也一起没了。
      content: isDirections
        ? '🗑 这几个候选方向已丢弃，没有进知识库。要继续这一步就点「生成新方向」再出一版（会再花 1 次 AI 额度）。'
        : '🗑 这一版草稿已丢弃，没有进知识库。要继续这一步就点「重新生成草稿」再出一版（会再花 1 次 AI 额度）。',
    });
    res.json({ message });
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
    const project = getProject(req.params.id, owner(req));
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
    // 同 /draft：只回条数，不把对话原文再回一遍（它就在下面的对话里）
    res.json({
      ...out,
      discussion: { used: out.discussion.used, dropped: out.discussion.dropped },
      message,
      stages: buildStageRail(project.id),
    });
  } catch (err) {
    fail(err, res, next);
  }
});

/**
 * 慢车道动笔之前先定方向（岔路口）。**不改任何东西**，只在这一步的对话里留一条
 * `kind='decisions'`，供刷新之后恢复那一屏。
 *
 * 存这条记录是承重的：这一屏是「他拍过板」的唯一痕迹。不存的话切个页面回来
 * 那几处取舍就没了，而右栏一个按钮都没有，看起来像这一步什么都没发生过 ——
 * 他会直接去点「生成候选方向」，于是那几处又变成模型自己定的。
 */
consultRouter.post('/projects/:id/stages/:key/decisions', async (req, res, next) => {
  try {
    const project = getProject(req.params.id, owner(req));
    if (!project) return res.status(404).json({ error: '项目不存在' });
    const sheet = await buildDecisions(req.user!.id, project, req.params.key);
    // 不 incRound：轮次是「出过几版产出」，把问方向也算进去的话界面上的「第 N 轮」
    // 比他真正看过的草稿版数多，他会以为有一版没显示出来。
    touchStage(project.id, req.params.key, 'exploring');
    const message = appendMessage(project.id, req.params.key, {
      role: 'assistant',
      kind: 'decisions',
      content: decisionsToText(sheet),
      payload: sheet,
    });
    res.json({
      ...sheet,
      discussion: { used: sheet.discussion.used, dropped: sheet.discussion.dropped },
      message,
      stages: buildStageRail(project.id),
    });
  } catch (err) {
    fail(err, res, next);
  }
});

/**
 * 在那几处岔路口上拍板。**不花 AI 额度**（纯校验 + 落一条 `kind='decided'`），
 * 所以它不在 `AI_SPEND_ROUTES` 里。
 *
 * 落这条记录是硬要求：慢车道的 `/draft` 就是**读它**才肯写正文（没有它一律 400）——
 * 不落库的话「他拍过板」这件事只存在于前端内存里，刷新一次就没了，而那时候 AI 出的正文
 * 里那几处取舍又是它自己定的，正文读起来一模一样。
 */
consultRouter.post('/projects/:id/stages/:key/decisions/apply', (req, res, next) => {
  try {
    const project = getProject(req.params.id, owner(req));
    if (!project) return res.status(404).json({ error: '项目不存在' });
    const decided = applyDecisions(
      project.id,
      req.params.key,
      String(req.body?.sheetMessageId || ''),
      Array.isArray(req.body?.picks) ? req.body.picks : []
    );
    touchStage(project.id, req.params.key, 'exploring');
    const message = appendMessage(project.id, req.params.key, {
      // role 是 user：这几处是**他**定的。记成 assistant 的话，过两天回来看这条记录
      // 读起来就是「AI 说它定了这几处」，而那正好是这条流程要防的那件事。
      role: 'user',
      kind: 'decided',
      content: decidedToText(decided),
      payload: decided,
    });
    res.json({ ...decided, message, stages: buildStageRail(project.id) });
  } catch (err) {
    fail(err, res, next);
  }
});

/** 某个阶段的对话（含方向卡 / 草稿）。刷新页面靠它恢复。 */
consultRouter.get('/projects/:id/stages/:key/messages', (req, res) => {
  const project = getProject(req.params.id, owner(req));
  if (!project) return res.status(404).json({ error: '项目不存在' });
  if (!stageByKey(req.params.key)) return res.status(404).json({ error: '没有这个阶段' });
  res.json({ messages: listMessages(project.id, req.params.key) });
});

/** 在这个阶段里接着聊。 */
consultRouter.post('/projects/:id/stages/:key/chat', async (req, res, next) => {
  try {
    const project = getProject(req.params.id, owner(req));
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
    const project = getProject(req.params.id, owner(req));
    if (!project) return res.status(404).json({ error: '项目不存在' });

    // 不带 lane：慢车道以后也走这个定稿接口，闸门只管「阶段存在 + 前提齐了 + 还没定过」。
    // **定稿是一次性的**：定完这一步就只读了（`requireOpenStage`），下游每一步的 prompt
    // 都建立在它上面，改一句而下游那几步已经写完的话，最后拿到的是一份自相矛盾的方案。
    requireOpenStage(project.id, req.params.key);

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
    const staledLabels = staled.map((k) => stageByKey(k)?.label || k);
    // 定稿也进对话记录：不进的话这一步的对话永远以「已生成草稿」那张卡片收尾，
    // 回头看不出最终定的是哪一版（那张卡片打开的是当时那版草稿）。
    // kind='entry' 不是 'text' —— 见 chatService.entryToText 的注释。
    const message = appendMessage(project.id, req.params.key, {
      role: 'assistant',
      kind: 'entry',
      content: entryToText({ ...entry, ai_opportunities: aiOpportunities }, staledLabels),
      payload: { version: entry.version, confidence: entry.confidence, sourceLevel: entry.source_level },
    });
    res.json({
      entry,
      message,
      // 被标成待重跑的下游，前端必须显示出来：不说的话用户以为「改一句结论」
      // 只影响这一句，最后拿到的是一份自相矛盾的方案，中途一句错都不报。
      staled: staledLabels,
      stages: buildStageRail(project.id),
      entries: listEntries(project.id),
    });
  } catch (err) {
    fail(err, res, next);
  }
});

/**
 * 导出整份方案（十四章合并成一份 markdown）。前端拿到 markdown 自己存成文件。
 *
 * **没定稿完的项目一律 400**：少两章的文档在屏幕上和完整的一模一样（每章都有结论、
 * 有表格、有置信度），而它是要发给客户的东西 —— 静默导出半份等于把「还没做完」
 * 变成一份看起来做完了的交付物。回的是缺哪几步的 label，不是一句「还没完成」。
 */
consultRouter.get('/projects/:id/report', (req, res, next) => {
  try {
    const project = getProject(req.params.id, owner(req));
    if (!project) return res.status(404).json({ error: '项目不存在' });
    const entries = listEntries(project.id);
    const missing = missingStages(entries);
    if (missing.length) {
      return res.status(400).json({
        error: `还有 ${missing.length} 步没定稿，导出的会是半份方案（读起来和完整的一样）：${missing.join('、')}`,
        missing,
      });
    }
    res.json(buildReport(project, entries));
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
    const project = getProject(req.params.id, owner(req));
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
 * 暂存填了一半的答案。前端逐题失焦时调 —— 一份七八题的问卷是拿去逐条问客户的，
 * 不暂存的话切个页面就全空了，而界面上不报任何错。
 */
consultRouter.put('/projects/:id/intake/answers', (req, res) => {
  const project = getProject(req.params.id, owner(req));
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
    const project = getProject(req.params.id, owner(req));
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
    updateBrief(project.id, owner(req), brief);
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
    const project = getProject(req.params.id, owner(req));
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
    const project = getProject(req.params.id, owner(req));
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
  const project = getProject(req.params.id, owner(req));
  if (!project) return res.status(404).json({ error: '项目不存在' });
  if (!deleteSource(project.id, req.params.sid)) return res.status(404).json({ error: '这条资料不存在' });
  res.json({ sources: listSources(project.id) });
});

consultRouter.delete('/projects/:id', (req, res) => {
  if (!deleteProject(req.params.id, owner(req))) {
    return res.status(404).json({ error: '项目不存在' });
  }
  res.json({ ok: true });
});
