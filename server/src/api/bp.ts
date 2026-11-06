import { Router } from 'express';
import multer from 'multer';
import {
  extractFile,
  ExtractError,
  MAX_FILE_BYTES,
  SUPPORTED_EXTS,
  extFromName,
} from '../services/consult/fileExtract.js';
import { MAX_BP_CHARS, BpError } from '../services/bp/factCardService.js';
import { readAttachment, composeBpText, tooLongMessage, MAX_ATTACHMENTS, MAX_TOTAL_CHARS, type Attachment } from '../services/bp/attachments.js';
import { IMAGE_EXTS } from '../services/consult/imageExtractService.js';
import { createReport, getReport, listReports, reopenReport, reopenForRerun, deleteReport } from '../services/bp/reportStore.js';
import { runReport, missingSteps, rerunKeys, STEPS } from '../services/bp/reportRunner.js';
import { releasePoints, settlePoints, PointsExhaustedError, type PointHold } from '../services/appKeyService.js';
import { aiCallContext } from '../core/llm/callContext.js';
import { admitRun, ownerOf, sdkCallCounter, BpLimitError } from '../services/bp/billing.js';
import { sdkAiStatus } from '../services/consult/sdkLimits.js';
import { requireAdmin } from '../auth/guards.js';
import { listBenchmarks, saveBenchmark, resetBenchmark } from '../services/bp/benchmarks.js';
import { v4 as uuidv4 } from 'uuid';
import { extractUrl } from '../services/webSearchService.js';
import {
  listMaterials, addMaterial, deleteMaterial, countMaterials,
  MATERIAL_CHAPTERS, MAX_MATERIAL_CHARS, MAX_MATERIALS_PER_CHAPTER, type MaterialChapter,
} from '../services/bp/materialStore.js';

// BP 分析（前端 /consult/bp）：上传 BP → 后台串着跑各章 → 报告。BP 提取出的文字落库（bp_reports），
// 原文件不存（BP 是敏感商业信息，`api/upload.ts` 那条路转存的 COS 是公开可访问的）。
export const bpRouter = Router();

// 谁能用：管理员（网页登录）、品牌咨询卖出去的 key（`consult:key`）、品牌咨询的 iframe 嵌入（`consult:embed`）。
// 普通账号不行 —— 只藏前端入口的话任何登录账号 curl 一下照样能调，而那是平台在付 Tavily 和模型的钱。
// scope token 能碰哪几条还要过全局的 scopeGuard（auth/scopeGuard.ts 里登记了 /api/bp/reports*）。
bpRouter.use((req, res, next) => {
  if (!req.tokenScope && req.user?.role === 'admin') return next();
  if (req.tokenScope === 'consult:key') return next();
  if (req.tokenScope === 'consult:embed' && req.sdkPk && req.externalUid !== undefined) {
    // 停用 / 删掉的 pk 在这里每次都判（同 consultSdkLimits）：短 token 活一刻钟，只在开跑时判的话
    // 管理员点了停用之后那个第三方页面还能翻报告、贴补充资料。
    const st = sdkAiStatus(req.sdkPk);
    if (!st?.enabled) return res.status(403).json({ error: '接口已关闭，请联系管理员', code: 'sdk_key_disabled' });
    return next();
  }
  res.status(403).json({ error: 'BP 分析目前只对管理员、品牌咨询的 key 和品牌咨询嵌入版开放。', code: 'bp_forbidden' });
});

/** 开跑闸门的那几种拒绝：各带 code 和真实数字（合成一句「操作失败」的话接入方会一路重试）。 */
function sendLimit(res: any, e: unknown): boolean {
  if (e instanceof BpLimitError) { res.status(e.status).json({ error: e.message, code: e.code, ...e.extra }); return true; }
  if (e instanceof PointsExhaustedError) { res.status(402).json({ error: e.message, code: 'points_exhausted' }); return true; }
  return false;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 1 },
  // 中文文件名必须声明 utf8，否则文件名一路乱码（见 api/extractRoutes.ts 同一处）。
  defParamCharset: 'utf8',
  fileFilter: (_req, file, cb) => {
    const ext = extFromName(file.originalname);
    // .ppt 放过去，让 fileExtract 回那句「请另存为 .pptx」。
    if (ext === '.ppt' || (SUPPORTED_EXTS as readonly string[]).includes(ext)) cb(null, true);
    else cb(new Error(`不支持 ${ext || '没有扩展名的'} 文件。目前支持：${SUPPORTED_EXTS.join(' / ')}`));
  },
});

// 新建报告那一次可以带多份材料（BP + 最多 9 份附件），图片也收（附件里的截图走转写）。
// 和下面补充资料那个 upload 分开：那个只收一份文档。
const uploadReport = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 1 + MAX_ATTACHMENTS },
  defParamCharset: 'utf8',
  fileFilter: (_req, file, cb) => {
    const ext = extFromName(file.originalname);
    const ok = ext === '.ppt' || (SUPPORTED_EXTS as readonly string[]).includes(ext)
      || (file.fieldname === 'files' && (IMAGE_EXTS as readonly string[]).includes(ext));
    if (ok) cb(null, true);
    else cb(new Error(`「${file.originalname}」不支持（${ext || '没有扩展名'}）。BP 支持 ${SUPPORTED_EXTS.join(' / ')}；补充材料另外支持图片 ${IMAGE_EXTS.join(' / ')}`));
  },
});

// POST /api/bp/reports  multipart：
//   file   —— BP 文件（可选；没有时 text 必填，当 BP 用）
//   text   —— 粘贴的项目介绍（没有 BP 文件时就是 BP 本身）
//   files  —— 补充材料，最多 9 份（文件 / 图片；图片花一次 AI 调用转写）
//   extra  —— 补充文字（有 BP 文件时粘贴框里的内容走这里，作为一份「粘贴文字」附件）
// 读取和字数上限当场判、当场报错（不建报告）；AI 那几章在后台跑，前端轮询 GET /reports/:id。
bpRouter.post('/reports', (req, res) => {
  uploadReport.fields([{ name: 'file', maxCount: 1 }, { name: 'files', maxCount: MAX_ATTACHMENTS }])(req, res, async (err: any) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: `有文件超过 ${Math.round(MAX_FILE_BYTES / 1024 / 1024)}MB 上限` });
      }
      if (err instanceof multer.MulterError && (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE')) {
        return res.status(400).json({ error: `补充材料最多 ${MAX_ATTACHMENTS} 份` });
      }
      return res.status(400).json({ error: err.message });
    }
    let hold: PointHold | null = null;
    try {
      const owner = ownerOf(req);
      const files = (req.files || {}) as Record<string, Express.Multer.File[]>;
      const bpFile = files.file?.[0];
      let text = String(req.body?.text || '');
      let filename = '粘贴的项目介绍';
      let emptyPages = 0;
      const notes: string[] = [];
      if (bpFile) {
        const r = await extractFile(bpFile.originalname, bpFile.buffer);
        text = r.text;
        filename = r.filename;
        emptyPages = r.emptyPages;
        notes.push(...r.notes);
      }
      text = text.trim();
      if (!text) return res.status(400).json({ error: '请上传 BP 文件，或粘贴项目介绍' });
      if (text.length > MAX_BP_CHARS) {
        return res.status(400).json({
          error: `这份 BP 提取出 ${text.length} 字，超过 ${MAX_BP_CHARS} 字上限。请删掉附录 / 大段案例页后再传 —— `
            + '这里不截断，截掉的那几页上的信息会在报告里显示成「未披露」。',
        });
      }

      // 开跑闸门在**花钱之前**（附件里的图片转写就要调模型）：pk 额度预检 → 当日次数 → key 冻结整份报告的点数。
      // 冻结的这笔一路带进 createReport，跑完结算、失败解冻；这之前任何一步报错都要在 catch 里解冻。
      hold = admitRun(owner, true);
      // 附件并行读（图片各一次转写调用）。任何一份读不出来就整次报错并点名 —— 跳过的话它还列在界面上，
      // 他以为读进去了；而报告里和它有关的那几处都会是「未披露」。
      // 转写在计费上下文里跑：key 用户已经冻结了整份报告的点数，这几次不再按次扣；嵌入版逐次计 pk 用量。
      const atts: Attachment[] = await aiCallContext.run({ coversPoints: true, onAiCall: sdkCallCounter(owner.sdkPk) }, () =>
        Promise.all((files.files || []).map((f) => readAttachment(req.user!.id, f.originalname, f.buffer))));
      const extra = String(req.body?.extra || '').trim();
      if (extra) atts.push({ name: '补充说明（粘贴）', kind: '粘贴文字', text: extra, notes: [] });
      if (text.length + atts.reduce((n, a) => n + a.text.length, 0) > MAX_TOTAL_CHARS) {
        releasePoints(hold);
        hold = null;
        return res.status(400).json({ error: tooLongMessage(text.length, atts) });
      }
      for (const a of atts) notes.push(...a.notes);

      const id = createReport({
        owner, hold, filename, text: composeBpText(text, atts), emptyPages, notes,
        attachments: atts.map((a) => ({ name: a.name, kind: a.kind, chars: a.text.length, notes: a.notes })),
      });
      hold = null; // 交给报告了：跑完结算 / 失败解冻都在 reportStore 里
      void runReport(id);
      res.status(202).json({ id });
    } catch (e: any) {
      releasePoints(hold);
      if (sendLimit(res, e)) return;
      if (e instanceof ExtractError) return res.status(400).json({ error: e.message });
      if (e instanceof BpError) return res.status(e.status).json({ error: e.message });
      if (e?.name === 'DedicatedChannelError' || e?.name === 'NoThinkingUnsupportedError') {
        return res.status(502).json({ error: e.message });
      }
      res.status(500).json({ error: e?.message || String(e) });
    }
  });
});

// ---------- 平台参考口径（融资方案章的估值区间 / 出让比例 / 下一轮门槛），仅管理员 ----------
// 第三方的 scope token 碰不到这几条（scopeGuard 只登记了 /api/bp/reports*），这里再挂一道 requireAdmin。
bpRouter.get('/admin/benchmarks', requireAdmin, (_req, res) => res.json({ rows: listBenchmarks() }));
bpRouter.put('/admin/benchmarks/:sector/:stage', requireAdmin, (req, res) => {
  const errs = saveBenchmark(req.params.sector, req.params.stage, req.body?.data, req.user!.username);
  if (errs.length) return res.status(400).json({ error: errs.join('\n'), errors: errs });
  res.json({ ok: true });
});
bpRouter.delete('/admin/benchmarks/:sector/:stage', requireAdmin, (req, res) => {
  resetBenchmark(req.params.sector, req.params.stage);
  res.json({ ok: true });
});

// GET /api/bp/reports  我的报告列表（不带正文）
bpRouter.get('/reports', (req, res) => {
  res.json({ reports: listReports(ownerOf(req)), steps: STEPS });
});

// GET /api/bp/reports/:id  一份报告（running 时前端轮询它看进度）
bpRouter.get('/reports/:id', (req, res) => {
  const r = getReport(req.params.id, ownerOf(req));
  if (!r) return res.status(404).json({ error: '报告不存在' });
  res.json({ ...r, steps: STEPS, missing: missingSteps(r.result), materials: listMaterials(r.id) });
});

// ---------- 补充资料（人工补料 / 排除检索结果）----------
// 补了不会自己生效：前端面板里那颗「用补充资料重跑这一章」走 /rerun。

function materialGuard(req: any, res: any): { reportId: string; chapter: MaterialChapter } | null {
  const r = getReport(req.params.id, ownerOf(req));
  if (!r) { res.status(404).json({ error: '报告不存在' }); return null; }
  const chapter = String(req.body?.chapter || '') as MaterialChapter;
  if (!(MATERIAL_CHAPTERS as readonly string[]).includes(chapter)) {
    res.status(400).json({ error: `这一章不能补资料（只有 ${MATERIAL_CHAPTERS.join(' / ')}）` });
    return null;
  }
  if (countMaterials(r.id, chapter) >= MAX_MATERIALS_PER_CHAPTER) {
    res.status(400).json({ error: `这一章已经有 ${MAX_MATERIALS_PER_CHAPTER} 条补充 / 排除了，先删掉几条再加（再多的话检索结果一条都进不去）。` });
    return null;
  }
  return { reportId: r.id, chapter };
}

function checkLength(content: string, what: string): string | null {
  const t = content.trim();
  if (t.length < 200) return `${what}只读到 ${t.length} 字，基本没有正文（可能要登录、或是纯图片），没有加进去。`;
  if (t.length > MAX_MATERIAL_CHARS) {
    return `${what}有 ${t.length} 字，超过 ${MAX_MATERIAL_CHARS} 字上限。这里不截断 —— 截掉的后半篇里的数字你会以为 AI 读过。请只保留相关的章节再传。`;
  }
  return null;
}

// POST /api/bp/reports/:id/materials  JSON：{ chapter, kind: 'url', url } 或 { chapter, kind: 'exclude', url, title }
bpRouter.post('/reports/:id/materials', async (req, res) => {
  const g = materialGuard(req, res);
  if (!g) return;
  const kind = String(req.body?.kind || '');
  const url = String(req.body?.url || '').trim();
  if (!/^https?:\/\/\S+$/i.test(url)) return res.status(400).json({ error: '请填一个以 http(s):// 开头的链接' });
  if (kind === 'exclude') {
    const id = addMaterial({ ...g, kind: 'exclude', title: String(req.body?.title || '').slice(0, 200), url, content: '' });
    return res.json({ id });
  }
  if (kind !== 'url') return res.status(400).json({ error: `不认识的 kind：${kind}` });
  try {
    const page = await extractUrl(url);
    const bad = checkLength(page.content, '这个链接');
    if (bad) return res.status(400).json({ error: bad });
    let host = url;
    try { host = new URL(url).hostname; } catch { /* 上面已校验 */ }
    const id = addMaterial({ ...g, kind: 'url', title: page.title || host, url: page.url, content: page.content });
    res.json({ id, chars: page.content.length });
  } catch (e: any) {
    const msg = String(e?.message || e);
    res.status(502).json({ error: msg === 'WEB_SEARCH_NOT_CONFIGURED' ? '没配联网搜索 key（后台「系统配置」里填 Tavily key），链接抓不了。' : `链接没抓下来：${msg}` });
  }
});

// POST /api/bp/reports/:id/materials/file  multipart：chapter + file（研报 / 材料，PDF / DOCX / PPTX / TXT）
// chapter 字段必须排在 file 前面：multer 只把文件之前的文本字段放进 req.body。
bpRouter.post('/reports/:id/materials/file', (req, res) => {
  upload.single('file')(req, res, async (err: any) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: `文件超过 ${Math.round(MAX_FILE_BYTES / 1024 / 1024)}MB 上限` });
      }
      return res.status(400).json({ error: err.message });
    }
    const g = materialGuard(req, res);
    if (!g) return;
    if (!req.file) return res.status(400).json({ error: '没有收到文件' });
    try {
      const r = await extractFile(req.file.originalname, req.file.buffer);
      const bad = checkLength(r.text, `「${r.filename}」`);
      if (bad) return res.status(400).json({ error: bad });
      // url 只是去重 / 锚点用的键，不是可点的链接；前端认 upload:// 不渲染成 <a>。
      const id = addMaterial({ ...g, kind: 'file', title: r.filename, url: `upload://${uuidv4()}`, content: r.text });
      res.json({ id, chars: r.text.length, notes: r.notes, emptyPages: r.emptyPages });
    } catch (e: any) {
      if (e instanceof ExtractError) return res.status(400).json({ error: e.message });
      res.status(500).json({ error: e?.message || String(e) });
    }
  });
});

// DELETE /api/bp/reports/:id/materials/:mid
bpRouter.delete('/reports/:id/materials/:mid', (req, res) => {
  const r = getReport(req.params.id, ownerOf(req));
  if (!r) return res.status(404).json({ error: '报告不存在' });
  if (!deleteMaterial(r.id, req.params.mid)) return res.status(404).json({ error: '这条补充资料不存在' });
  res.json({ ok: true });
});

// POST /api/bp/reports/:id/resume  失败 / 中断 / 缺章的报告从缺的那一章接着跑（已有的章节不重跑）
bpRouter.post('/reports/:id/resume', (req, res) => {
  const r = getReport(req.params.id, ownerOf(req));
  if (!r) return res.status(404).json({ error: '报告不存在' });
  const missing = missingSteps(r.result);
  if (!missing.length) return res.status(400).json({ error: '这份报告每一章都已经跑完了，没有可以接着跑的。' });
  // 没扣过点（上次失败 / 中断）的话这次重新冻结；扣过的续跑不再扣。次数照样算。
  let hold: PointHold | null;
  try { hold = admitRun(ownerOf(req), !r.charged); } catch (e) { if (sendLimit(res, e)) return; throw e; }
  if (!reopenReport(r.id, ownerOf(req), hold)) { releasePoints(hold); return res.status(409).json({ error: '这份报告已经在跑了。' }); }
  void runReport(r.id);
  res.status(202).json({ id: r.id, missing });
});

// POST /api/bp/reports/:id/rerun  { from: 章节键 }  清掉这一章及其后面所有章，从这一章重跑
bpRouter.post('/reports/:id/rerun', (req, res) => {
  const from = String(req.body?.from || '');
  const keys = rerunKeys(from);
  if (!keys) return res.status(400).json({ error: from === 'factCard' ? '事实卡不能单独重跑，要换的话重新上传 BP。' : `没有「${from}」这一章。` });
  const r = getReport(req.params.id, ownerOf(req));
  if (!r) return res.status(404).json({ error: '报告不存在' });
  let hold: PointHold | null;
  try { hold = admitRun(ownerOf(req), !r.charged); } catch (e) { if (sendLimit(res, e)) return; throw e; }
  if (!reopenForRerun(r.id, ownerOf(req), keys, hold)) {
    releasePoints(hold);
    return res.status(409).json({ error: '这份报告正在跑，跑完（或失败）之后才能重跑。' });
  }
  void runReport(r.id);
  res.status(202).json({ id: r.id, rerun: keys });
});

// DELETE /api/bp/reports/:id  跑着的不能删（409）
bpRouter.delete('/reports/:id', (req, res) => {
  const out = deleteReport(req.params.id, ownerOf(req));
  if (out === 'missing') return res.status(404).json({ error: '报告不存在' });
  if (out === 'running') return res.status(409).json({ error: '这份报告还在跑，跑完（或失败）之后才能删。' });
  res.json({ ok: true });
});
