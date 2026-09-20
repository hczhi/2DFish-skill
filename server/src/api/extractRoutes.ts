// 「上传资料 → 提取文字 → AI 整理」这两条路（`POST /extract-file` / `POST /tidy-text`）
// **只有这一份**，挂在哪个模块的 Router 上由 `mountExtractRoutes` 决定（品牌咨询 + 展示稿提纲）。
//
// 为什么做成一份而不是各抄一份：这两条路上承重的全是**说给用户听的那几句话**——
// 图片那一次提取就扣了 1 次额度（`aiCalls`）、`tidied: true` 让前端别再整理第二遍、
// `tidyPlan.calls` 是服务端算的「这份要花几次」、中文文件名要 `defParamCharset: 'utf8'`、
// 超大文件要把 multer 那句英文的 'File too large' 翻成「多大算大」。抄一份出去必然缺掉
// 其中一两条，而抄出去那份**跑起来完全正常**：文件传上去了、文字也提出来了，只是
// 悄悄扣掉了他今天 10 次里的 3 次，或者一份三万字的资料被整理成了「看起来完整」的一半。
//
// **`app` 决定这两次调用记在哪个应用的额度/日志上**（`ai_logs.source`）。挂新模块时必须传
// 自己那个 —— 图省事沿用 'consult' 的话，展示稿那边的提取会去撞「品牌咨询」的应用额度：
// 管理员把咨询限成 5 次/天之后，生成提纲页上传图片会回一句说咨询额度用完了（他压根没在用咨询），
// 而后台那条「展示稿」的用量看起来一切正常。

import type { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import OpenAI from 'openai';
import { QuotaExceededError } from '../core/llm/gateway.js';
import type { ExtractApp } from '../core/llm/apps.js';
import { NoThinkingUnsupportedError } from '../core/llm/gateway.js';
import {
  extractFile,
  ExtractError,
  MAX_FILE_BYTES,
  SUPPORTED_EXTS,
  extFromName,
} from '../services/consult/fileExtract.js';
import { tidyExtractedText, planTidy, TIDY_BUDGET_CHARS } from '../services/consult/fileTidyService.js';
import {
  extractImageText,
  looksLikeImage,
  IMAGE_EXTS,
  MAX_IMAGE_BYTES,
} from '../services/consult/imageExtractService.js';
import { MAX_ATTACHMENTS } from '../services/consult/briefCompose.js';
import { StageError } from '../services/consult/draftService.js';
import { MAX_BRIEF_CHARS } from '../services/consult/projectStore.js';
import { MAX_MATERIAL_CHARS } from '../services/ppt/outlineChatService.js';

// 支持哪几个应用在 `core/llm/apps.ts` 的 `EXTRACT_APPS` 里（那边有断言「每一项都在
// AI_APPS 里」—— 这条路的 source 是参数，是全库唯一一处，所以那道断言是它的替代品）。
export type { ExtractApp } from '../core/llm/apps.js';

export interface ExtractRouteDeps {
  /** 额度和日志记在哪个应用上。**必填**，见文件头那段。 */
  app: ExtractApp;
  /** 这个模块自己的错误码收口（额度 429 / 专属渠道 503 / 上游 502 各是一句不同的话）。 */
  fail: (err: unknown, req: Request, res: Response, next: NextFunction) => void;
  /**
   * 一个请求实际打了不止一次模型时补扣（`/tidy-text` 长文件分段）。
   * 不补的话这条路对第三方相当于打了 N 折，而后台看到的是一个正常的用量数字。
   */
  chargeExtra?: (req: Request, extraCalls: number) => void;
}

/**
 * multer 缺省按 mimetype 挡不住事：`.docx` 在不同系统上是 `application/octet-stream` /
 * `application/zip` 都有，`.md` 更是常见 `text/markdown` / 空。按 mimetype 挡的话表现是
 * 「传上去说不支持」，而用户手上那个文件明明就是 .docx —— 所以按**扩展名**过滤。
 *
 * `.ppt` **故意放过这道过滤**，让 fileExtract 去回那句「请另存为 .pptx」——
 * 在这里挡掉只会得到一句笼统的「不支持」，用户不知道下一步该干什么。
 * 同理 `.heic` / `.bmp` 这些模型不吃的图片格式也放过来，由 imageExtractService 回
 * 那句「iPhone 的照片请导出成 JPG」。
 */
const PASSTHROUGH_EXTS = ['.ppt', '.heic', '.heif', '.bmp', '.tif', '.tiff', '.avif'];
const ACCEPTED_EXTS = [...SUPPORTED_EXTS, ...IMAGE_EXTS];
const fileUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 1 },
  // **中文文件名必须显式声明 utf8。** multer/busboy 缺省按 `latin1` 解
  // Content-Disposition 里的 filename，而浏览器发的是 UTF-8 字节 —— 缺省下
  // 「品牌全案 0910.pptx」变成「å ç ä¼ ... 0910.pptx」。它不报错：文件内容是好的、
  // 提取整理全部正常，只是文件名一路乱码地进卡片、进合成那行「以下来自 <文件名>」，
  // 最后进资料 —— 而那一行是唯一说得清「这段话是哪份文件里的」的地方。
  // 扩展名是 ASCII，所以 fileFilter 照常放行，一切看起来只是「显示有点怪」。
  defParamCharset: 'utf8',
  fileFilter: (_req, file, cb) => {
    const ext = extFromName(file.originalname);
    if (PASSTHROUGH_EXTS.includes(ext) || ACCEPTED_EXTS.includes(ext as any)) {
      cb(null, true);
    } else {
      cb(new Error(`不支持 ${ext || '这种没有扩展名的'} 文件。目前支持：${ACCEPTED_EXTS.join(' / ')}（老的 .ppt / iPhone 的 .heic 传上来会告诉你怎么转）`));
    }
  },
});

/**
 * 把这两条路挂到某个模块的 Router 上（路径固定是 `/extract-file` 和 `/tidy-text`）。
 *
 * **两条路都要挂**：只挂 `/extract-file` 的话前端那个面板传完文件就去打 `/tidy-text`，
 * 拿回一个 404 —— 界面上每张卡片都是「整理失败，带的是原文」，读起来像模型出了问题。
 */
export function mountExtractRoutes(router: Router, deps: ExtractRouteDeps): void {
  /**
   * 上传的资料文件 → 纯文本。**不落库、不存原文件。**
   *
   * 不存原文件是有意的：`api/upload.ts` 那条路是转存 COS，而 `file.qiaonan.vip` 是公开
   * 可访问的 —— 客户的品牌资料、预算、竞品名单传上去等于公开。这里只在内存里解析完就丢
   * （图片也一样：base64 直接进请求，不落盘、不转存）。
   *
   * 两条路，按文件头分派：
   * - 文件（txt/md/docx/doc/pptx/pdf）：程序提取，**不花 AI 额度**；
   * - 图片（png/jpg/webp/gif）：**一次 AI 调用**（图里的字只有模型读得出来）。
   *   所以响应里带 `aiCalls`，界面上必须显示 —— 一次「提取」静默扣掉他今天 10 次里的一次
   *   是这条路最容易发生的静默扣费（硬规则 1）。图片那份已经是提炼过的，`tidied: true`
   *   告诉前端**不要再自动整理一遍**（那是白花第二次额度）。
   *
   * 返回的文本给前端**预览**用，所以这里**不套**总字数上限：一份 PPT 提取出三万字是常事，
   * 在这里截掉的话用户看到的是一份「看起来完整」的资料。上限那道闸门在各模块提交那一步
   * （只拒不截），这里只把字数如实回给界面。
   */
  router.post('/extract-file', (req: Request, res: Response, next: NextFunction) => {
    fileUpload.single('file')(req, res, async (err: any) => {
      if (err) {
        // 超大文件必须单独认：multer 的 LIMIT_FILE_SIZE 原文是英文的 'File too large'，
        // 直接透出去用户看不出是「多大算大」，只会反复传同一个文件。
        if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({
            error: `文件超过 ${Math.round(MAX_FILE_BYTES / 1024 / 1024)}MB。请把 PPT 里的图片压一下，或者只传其中一部分。`,
          });
        }
        return res.status(400).json({ error: err.message || '上传失败' });
      }
      if (!req.file) return res.status(400).json({ error: '请选择要上传的文件' });

      const name = req.file.originalname;
      const limits = {
        briefLimit: briefLimitOf(deps.app),
        budgetChars: TIDY_BUDGET_CHARS,
        fileLimit: fileLimitOf(deps.app),
        maxFiles: MAX_ATTACHMENTS,
        maxImageBytes: MAX_IMAGE_BYTES,
      };
      try {
        // 图片走大模型识别（花一次额度），其余走程序提取。判据是**文件头 + 扩展名**，
        // 不只看扩展名：一张改名成 .docx 的截图落到 zip 解析上只会回一句「解压失败」。
        if (looksLikeImage(extFromName(name), req.file.buffer)) {
          const img = await extractImageText(req.user!.id, name, req.file.buffer, deps.app);
          return res.json({
            filename: name,
            ext: extFromName(name),
            kind: 'image',
            ...img,
            ...limits,
            // 已经是提炼过的了 —— 前端据此**跳过**自动整理（再整一遍是白花第二次额度，
            // 而且这条路上压根没有原文，第二次只会离图更远）。
            tidied: true,
            // 他要是自己点「重新整理」，那一下要花几次额度还是由服务端算（前端不许自己除）。
            tidyPlan: planTidy(img.text),
          });
        }
        const result = await extractFile(name, req.file.buffer);
        // tidyPlan 由服务端算：前端要照它决定「传完直接自动整理」还是「先问一句这要花
        // 几次额度」。前端自己按字数除一下的话那个数会和真实调用次数漂开，界面上写着
        // 1 次而实际扣了 4 次 —— 他只会以为额度算错了。
        res.json({
          ...result,
          kind: 'file',
          aiCalls: 0,
          tidied: false,
          ...limits,
          tidyPlan: planTidy(result.text),
        });
      } catch (e: any) {
        // ExtractError 的 message 就是给用户看的那句话（带成因和出路），原样透出去。
        // 兜成一句「提取失败」的话，「扫描件」「老 .ppt」「编码乱了」三种解法完全不同。
        if (e instanceof ExtractError) return res.status(400).json({ error: e.message });
        // 图片那条路会撞额度（429）、上游超时（504）、模型不认图（502）—— 这几种各是
        // 一句不同的话，交给各模块自己的 fail()。兜成 500 的话「今天额度用完了」会显示成
        // 「服务器出错」，他只会一直重传同一张图，而每次都可能真扣一次。
        // NoThinkingUnsupportedError 也走 fail()（它最终由 app.ts 透原文回 502）：
        // 落到下面那句的话，「接入点的模型关不掉思维链」会被套上「解析这个文件时出错了」，
        // 而他会以为是这张图/这个文件的问题，一路重传。
        if (
          e instanceof StageError || e instanceof QuotaExceededError || e instanceof OpenAI.APIError
          || e instanceof NoThinkingUnsupportedError
        ) {
          return deps.fail(e, req, res, next);
        }
        console.error(`[${deps.app}] extract-file failed:`, e?.message);
        res.status(500).json({ error: `解析这个文件时出错了：${e?.message || '未知错误'}` });
      }
    });
  });

  /**
   * 把提取出来的碎文本交给模型清理（只删不编，见 fileTidyService）。
   * **长文本会分几次调用，每次都是一次真实的 AI 额度**（`/extract-file` 的 `tidyPlan.calls`
   * 提前把这个数告诉界面，由用户点那个写着次数的按钮 —— 悄悄花掉他今天 10 次里的 4 次
   * 是这条路上最容易发生的静默扣费）。
   *
   * 不接项目/稿子 id：新建页上还没有那个东西。也因此这段文本由前端传上来 —— 这里不写任何库，
   * 结果还是回到预览框里等用户确认。
   */
  router.post('/tidy-text', async (req: Request, res: Response, next: NextFunction) => {
    const text = String(req.body?.text ?? '');
    const filename = String(req.body?.filename || '未命名文件').slice(0, 200);
    try {
      const result = await tidyExtractedText(req.user!.id, filename, text, deps.app);
      // 按 pk 的日额度是在中间件里**每个请求扣 1** 的（那时候还没解析 body，不可能知道
      // 这次要分几段）。分了 N 段就是 N 次真实调用，差额在这里补。
      if (deps.chargeExtra && result.calls > 1) deps.chargeExtra(req, result.calls - 1);
      res.json(result);
    } catch (e) {
      deps.fail(e, req, res, next);
    }
  });
}

/**
 * 界面上那句「加上这份会不会超上限」按哪个数算 —— 每个模块**用自己那条**上限，
 * 不在这里写一个数：写死的那个和真正拦人的那道闸门一旦漂开，面板上那句
 * 「合计 N / 上限 M」就是假的，他删到「不超」了还是被拒（而报错里是另一个数字）。
 */
function briefLimitOf(app: ExtractApp): number {
  return app === 'ppt' ? MAX_MATERIAL_CHARS : MAX_BRIEF_CHARS;
}

/**
 * **单份**字数上限，`0` = 不限（只看上面那条合计）。展示稿提纲那条路是 0
 * （`composeMaterials` 给 `parseAttachments` 传的是 `null`）。
 *
 * 这个字段的唯一用处是卡片上那行「N / M 字」。写死 `budgetChars`（AI 提炼的**目标**字数）
 * 的话，提纲页上一份 7442 字的资料会显示成「7442 / 3500 字」并标红 —— 而服务端压根不拦它，
 * 他会照着那个假上限进卡片删掉一半正文，删掉的正是排在后面的那几节（提纲照样出得来）。
 */
function fileLimitOf(app: ExtractApp): number {
  return app === 'ppt' ? 0 : TIDY_BUDGET_CHARS;
}
