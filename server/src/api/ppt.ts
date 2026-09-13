// HTML 展示稿（/ppt）。这一层薄：校验 → service → 响应。
import { Router, Request, Response } from 'express';
import multer from 'multer';
import { layouts, layoutById, library } from '../services/ppt/layoutLibrary.js';
import { demoDeck, demoIds, DemoNotFoundError } from '../services/ppt/demoDeck.js';
import { disabledLayoutIds, setLayoutEnabled, LayoutStateError } from '../services/ppt/layoutState.js';
import { planDeck, replanPageImages, PlanError, type PlannedPage } from '../services/ppt/planService.js';
import { cleanOutline, OutlineCleanError } from '../services/ppt/outlineCleanService.js';
import { generatePage, buildDeck, PageError } from '../services/ppt/pageService.js';
import { assemblePreview, previewShell, previewSection, PREVIEW_SLOT } from '../services/ppt/deckShell.js';
import {
  fillPageImages, generateSpecImage, applyPreparedImages, pasteIntoBuiltPage, keepAsPrepared,
  findImageSlots, specsFromSlots, realignImageRecords,
  PptImageError, type FilledImage,
} from '../services/ppt/imageService.js';
import {
  applyTextEdit,
  applyStyleEdit,
  applyRegionStyle,
  applyDelete,
  findRegionByPath,
  eidsIn,
  COLOR_PALETTE,
  PageEditError,
} from '../services/ppt/pageEdit.js';
import { isBlankPage } from '../services/ppt/blankPage.js';
import { addCanvasText, addCanvasImage, setCanvasBox, deleteCanvasEl } from '../services/ppt/canvasEdit.js';
import { aiEditRegion } from '../services/ppt/aiEditService.js';
import { aiRemakeRegion } from '../services/ppt/aiRemakeService.js';
import { exportDeck, ExportError } from '../services/ppt/exportService.js';
import { styles, defaultStyleId, deckColors } from '../services/ppt/styleLibrary.js';
import {
  designOptions, readDesignSpec, parseDesignSpec, DesignSpecError,
} from '../services/ppt/designSpec.js';
import {
  listDecks,
  createDeck,
  getDeck,
  updateDeckMeta,
  savePlan,
  listPages,
  savePageHtml,
  savePageImages,
  savePendingImages,
  savePageSetup,
  savePageVeil,
  savePageEditedHtml,
  updatePlanImageSubject,
  updatePlanPageImages,
  updatePlanPageOutline,
  deleteDeck,
  deletePage,
  insertPage,
  DeckStructureError,
  MAX_TITLE_CHARS,
  MAX_BRAND_CHARS,
  MAX_DECK_OUTLINE_CHARS,
  MAX_PAGE_NOTES_CHARS,
  MAX_PAGE_TITLE_CHARS,
  MAX_POINTS_PER_PAGE,
  MAX_POINT_CHARS,
  MAX_PAGE_OUTLINE_CHARS,
  type DeckOwner,
  type PptDeck,
  type PptDeckPage,
} from '../services/ppt/deckStore.js';
import {
  listAssets, getAsset, deleteAsset, assetGroups, rememberAsset, findAssetByUrl,
  ASSETS_PAGE_SIZE, ASSETS_NO_DECK,
} from '../services/ppt/assetStore.js';
import {
  MAX_SUBJECT_CHARS, nearestRatio, orphanedPreparedNotes, type PreparedImage,
} from '../services/ppt/imageSpec.js';
import { storeUploadedImage } from '../core/image/imageGateway.js';
import { imageSize } from '../core/image/imageSize.js';
import { requireAdmin } from '../auth/guards.js';
import { registerPptSdkRoutes, registerPptSdkAdminRoutes } from './pptSdk.js';
import { pptSdkLimits, chargeExtraPptSdkAiCalls } from '../services/ppt/sdkLimits.js';

export const pptRouter = Router();

// 对外接入（migration 100）：pk 换短 token 的路由是 PUBLIC（校验在 handler 里），
// 带 scope 的短 token 能碰哪些端点由全局 `auth/scopeGuard.ts` 管 —— 不在这里再写一份。
registerPptSdkRoutes(pptRouter);

// 对外接入的后台管理（发 pk / 配域名白名单 / 改上限 / 停用）。
// `/admin/*` 的统一闸门必须挂在任何 /admin 路由注册**之前**，Express 才会先过它 ——
// 挂在后面的话那几条发 key 的接口对任何登录用户都开着，而每一次调用都返回 200。
pptRouter.use('/admin', requireAdmin);
registerPptSdkAdminRoutes(pptRouter);

// 每把 pk 的天花板：key 停用即失效 + 每日 AI/生图次数 + 稿子总数。必须挂在下面所有业务路由
// **之前**，也必须在 /admin 之后（后台自己不受 pk 上限管）。
pptRouter.use(pptSdkLimits);

/**
 * 这次请求的稿子属于谁（100）；拿不到登录身份就 401（deck 是按归属存的，不能落到某个缺省桶里）。
 *
 * 后两项**只从签过名的 token 里取**（`authMiddleware` 写的 `req.sdkPk` / `req.externalUid`）——
 * 从 body/query 里收的话第三方页面上任何人改一个参数就换成别人的租户，而返回的是一份正常的
 * 稿子列表。AI/生图的钱记在 `owner.userId` 上（钱是绑定账号付的），别拿这个三元组当额度键。
 */
function ownerOf(req: Request, res: Response): DeckOwner | null {
  const id = (req as any).user?.id as string | undefined;
  if (!id) {
    res.status(401).json({ error: '请先登录' });
    return null;
  }
  return { userId: id, sdkPk: req.sdkPk ?? null, externalUid: req.externalUid ?? null };
}

/**
 * 六条花钱路径的错误码收口。**一份**：原来六处各写一遍，其中四处（规划整份、生成这一页、
 * ai-edit、ai-remake）漏了额度和专属渠道那两档 —— 额度用光在那四条路上是一句 500
 * 「服务器错误」，而平台那个额度弹窗只认 `429 + {error:'quota_exceeded'}`（见
 * `client/src/lib/api.ts`），于是他看到的是「这功能坏了」，会一路重试，**每次重试都真的
 * 扣一次**。专属渠道缺档位合成 500 同理：真实解法是去后台补一条接入点，而 500 指向的是我们。
 *
 * 额度那一档必须**同时**给平台形状（`error:'quota_exceeded'` 触发弹窗）和 `detail`
 * （撞的是账号总额还是这个应用的单独额度 —— 两条限制解法不同，只说「额度用完」他会去改错
 * 那个数）。`is400` 由各端点自己判（每条路的「参数不对」是不同的错误类），传错方向的后果
 * 是明确的错误码，不是静默。
 */
export function sendPptError(res: Response, e: any, is400: boolean, fallback: string): void {
  const message = e?.message || fallback;
  if (is400) {
    res.status(400).json({ error: message });
    return;
  }
  if (e?.name === 'QuotaExceededError') {
    res.status(429).json({ error: 'quota_exceeded', remaining: 0, daily_limit: e.dailyLimit, app: e.app, detail: message });
    return;
  }
  res.status(e?.name === 'DedicatedChannelError' ? 503 : 500).json({ error: message });
}

/**
 * 页序版本号对账（098）。**按页码写库、而且要花时间的那几条路都要过这一关**：
 * 生成一页要三十秒以上，这期间他删掉/移动一页的话，回来那份结果会 upsert 到**现在的**
 * 第 N 页上 —— 出来是一页完整的幻灯片，只是照着别的一页的提纲排的，两边都不报错，
 * 而这是一次真实花费。
 *
 * **没带这个字段一律 400，不能当成「跳过检查」**：那样任何一处前端漏传都会让这道保护
 * 静默失效，而现象只是偶尔某一页内容对不上标题。
 * 报错里两个版本号都要写出来 —— 只说「请刷新」的话，和网络错误在他眼里是同一句话。
 */
function checkPlanRev(req: Request, res: Response, deck: { plan_rev: number }): boolean {
  const raw = req.body?.planRev;
  if (raw === undefined || raw === null || raw === '') {
    res.status(400).json({
      error:
        '这次请求没带 planRev（页序版本号），没执行 —— 带上它才能确认你点的那一页和库里现在的第几页是同一页。刷新页面重试。',
    });
    return false;
  }
  const rev = Number(raw);
  if (!Number.isInteger(rev) || rev !== deck.plan_rev) {
    res.status(409).json({
      error:
        `这份稿子的页数/页序在你打开之后变过（你这边是第 ${rev} 版，库里是第 ${deck.plan_rev} 版），这次没执行 ——` +
        '照做的话结果会落在现在的那个页码上，而那已经不是你点的那一页了（出来是一页正常的幻灯片，只是内容对不上标题）。刷新页面再试。',
    });
    return false;
  }
  return true;
}

// ── 演示稿（落库，migration 089）────────────────────────────
// 一份 deck 是十几次真实 AI 调用，不落库的话刷新一次就全没了而界面上一句错都没有。

pptRouter.get('/decks', (req: Request, res: Response) => {
  const owner = ownerOf(req, res);
  if (!owner) return;
  res.json({ decks: listDecks(owner) });
});

pptRouter.post('/decks', (req: Request, res: Response) => {
  const owner = ownerOf(req, res);
  if (!owner) return;
  const b = req.body || {};
  const outline = String(b.outline ?? '');
  // 名字缺省取提纲第一行（那通常就是主题），但**存下来**而不是每次现算 ——
  // 现算的话改一次提纲第一行，列表里那份稿子就换了名字，读起来像另一份。
  const title = String(b.title ?? '').trim() || outline.trim().split('\n')[0]?.trim().slice(0, MAX_TITLE_CHARS) || '';
  if (!title) {
    res.status(400).json({ error: '请填写演示稿名字（或先贴一份提纲，第一行会当名字）' });
    return;
  }
  if (title.length > MAX_TITLE_CHARS) {
    res.status(400).json({ error: `名字最多 ${MAX_TITLE_CHARS} 字` });
    return;
  }
  // 超长只拒不截：截掉的是提纲后半段，而规划出来的那份「完整」规划里压根没有那几页，
  // 界面上看不出少了什么（他的提纲有二十页，规划只到第 12 页）。
  if (outline.length > MAX_DECK_OUTLINE_CHARS) {
    res.status(400).json({
      error: `提纲最多 ${MAX_DECK_OUTLINE_CHARS} 字，当前 ${outline.length} 字。请自己删减后再提交（不会自动截断）`,
    });
    return;
  }
  // 认不出的配色/字体/疏密**一律 400**（`readDesignSpec` 抛）：回落成默认那套的话，
  // 界面上那个下拉写着他挑的那个，而整份是默认配色 —— 两处对不上而一处都不报错。
  let design;
  try {
    design = b.design === undefined ? undefined : readDesignSpec(b.design);
  } catch (e: any) {
    res.status(e instanceof DesignSpecError ? 400 : 500).json({ error: e?.message || '设计规范没存上' });
    return;
  }
  const deck = createDeck(owner, {
    title,
    outline,
    brandCn: b.brandCn ? String(b.brandCn).slice(0, MAX_BRAND_CHARS) : '',
    brandEn: b.brandEn ? String(b.brandEn).slice(0, MAX_BRAND_CHARS) : '',
    styleId: b.styleId ? String(b.styleId) : '',
    // 设计规范（096）。**建稿时就定**：先生成十几页再定的话，那几页是按默认那套排的。
    design,
  });
  res.json({ deck });
});

pptRouter.get('/decks/:id', (req: Request, res: Response) => {
  const owner = ownerOf(req, res);
  if (!owner) return;
  const deck = getDeck(req.params.id, owner);
  if (!deck) {
    res.status(404).json({ error: '这份演示稿不存在（或不是你的）' });
    return;
  }
  // 解析过的设计规范一起回（096）：前端照 `design_json` 自己解一遍的话，认不出的 id
  // 两边回落得不一样 —— 界面上显示「墨绿」而画面是默认那套。`problems` 必须显示出来
  // （某一套配色从库里删了时，不说的话他以为自己从来没选过）。
  const design = parseDesignSpec(deck.design_json);
  res.json({ deck, design: design.spec, designProblems: design.problems });
});

/** 设计规范能挑的那几套（096）。前端不自己写一份 —— 写死的话库里加了一套配色它不出现，
 *  而删了一套的话他挑到一个存不进去的 id（保存时才 400，那一刻他以为是网络问题）。 */
pptRouter.get('/design-options', (_req: Request, res: Response) => {
  res.json(designOptions());
});

/**
 * 改元信息（名字 / 提纲 / 品牌 / 画风）。**只改传了的那几个字段** —— 缺省成空串的话，
 * 任何一次只改名字的保存都会把提纲清空，而两边都回「已保存」。
 */
pptRouter.patch('/decks/:id', (req: Request, res: Response) => {
  const owner = ownerOf(req, res);
  if (!owner) return;
  const b = req.body || {};
  if (b.title !== undefined) {
    const t = String(b.title).trim();
    if (!t) {
      res.status(400).json({ error: '名字不能为空' });
      return;
    }
    if (t.length > MAX_TITLE_CHARS) {
      res.status(400).json({ error: `名字最多 ${MAX_TITLE_CHARS} 字` });
      return;
    }
  }
  if (b.outline !== undefined && String(b.outline).length > MAX_DECK_OUTLINE_CHARS) {
    res.status(400).json({
      error: `提纲最多 ${MAX_DECK_OUTLINE_CHARS} 字，当前 ${String(b.outline).length} 字（不会自动截断）`,
    });
    return;
  }
  // 整份那段要求（093）超长**拒**，不截断（和页级同一个上限、同一个道理）：截掉的半句
  // 照样发给模型，而他写在后面那条要求每一页都不会生效，也没有一处会说。
  if (b.notes !== undefined && String(b.notes).trim().length > MAX_PAGE_NOTES_CHARS) {
    res.status(400).json({
      error: `整份要求最多 ${MAX_PAGE_NOTES_CHARS} 字，当前 ${String(b.notes).trim().length} 字（截断的话你写在后面那几条不会生效，所以这里直接拒）`,
    });
    return;
  }
  // 认不出的配色/字体/疏密**一律 400**（`readDesignSpec` 抛）：回落成默认那套的话，
  // 界面上那个下拉写着他挑的那个，而整份是默认配色 —— 两处对不上而一处都不报错。
  let design;
  try {
    design = b.design === undefined ? undefined : readDesignSpec(b.design);
  } catch (e: any) {
    res.status(e instanceof DesignSpecError ? 400 : 500).json({ error: e?.message || '设计规范没存上' });
    return;
  }
  const ok = updateDeckMeta(req.params.id, owner, {
    title: b.title === undefined ? undefined : String(b.title).trim(),
    outline: b.outline === undefined ? undefined : String(b.outline),
    brandCn: b.brandCn === undefined ? undefined : String(b.brandCn).slice(0, MAX_BRAND_CHARS),
    brandEn: b.brandEn === undefined ? undefined : String(b.brandEn).slice(0, MAX_BRAND_CHARS),
    styleId: b.styleId === undefined ? undefined : String(b.styleId),
    notes: b.notes === undefined ? undefined : String(b.notes).trim(),
    design,
  });
  if (!ok) {
    // 一个字段都没传也走这里：静默回 200 的话前端那句「已保存」是假的。
    res.status(404).json({ error: '没保存上：这份演示稿不存在（或这次没有要改的字段）' });
    return;
  }
  res.json({ deck: getDeck(req.params.id, owner) });
});

pptRouter.delete('/decks/:id', (req: Request, res: Response) => {
  const owner = ownerOf(req, res);
  if (!owner) return;
  if (!deleteDeck(req.params.id, owner)) {
    res.status(404).json({ error: '这份演示稿不存在（或不是你的）' });
    return;
  }
  res.json({ ok: true });
});

// ── 素材库（migration 090）────────────────────────────
// 每一张真的生成出来的配图（**按租户**：网页登录 = 这个账号，嵌入 = 那把 pk 代表的那家公司，
// 同一把 key 下的员工共用一个素材库，判定在 `services/ppt/tenant.ts`）。
// 注意和下面那条 `/library/assets` 不是一回事：
// 那条是 deck 外壳的共享 CSS/配色资料，这两条是用户自己的图。

/**
 * 我的配图素材。`total` 一起回 —— 只回前一页的话「就这些」和「装不下」分不开。
 *
 * `?deckId=` 按稿子筛（tab 条），`groups` 是每份稿子的张数。两件事是承重的：
 * **筛和计数都在 SQL 里做**（见 `listAssets` / `assetGroups`），前端拿这 120 张再分组的话
 * 每个 tab 上的数字都偏小、而且读起来完全正常；**认不出的 `deckId` 回空列表 + 说一句**，
 * 不回落成「全部」—— 回落的话那个 tab 选中着却显示三百张，看起来像这个项目有三百张图。
 */
pptRouter.get('/assets', (req: Request, res: Response) => {
  const owner = ownerOf(req, res);
  if (!owner) return;
  const deckId = typeof req.query.deckId === 'string' ? req.query.deckId.trim() : '';
  const groups = assetGroups(owner);
  const known = deckId === ASSETS_NO_DECK ? groups.some((g) => !g.deckId) : groups.some((g) => g.deckId === deckId);
  res.json({
    ...listAssets(owner, { deckId }),
    groups,
    deckId,
    // 筛了一个一张图都没有的稿子（刚建的、或者图都删了）：不说的话那是一屏空白，
    // 和「素材库是空的」长得一样。
    note: deckId && !known ? '这份稿子在素材库里还没有图（可能刚建、也可能都删了）。' : '',
    pageSize: ASSETS_PAGE_SIZE,
  });
});

/** 上传一张图的上限。反代那层配的是 300m（docs/RELEASE.md），所以到不了这里就被拦的只有超大文件。 */
const ASSET_UPLOAD_MB = 10;

const assetUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: ASSET_UPLOAD_MB * 1024 * 1024, files: 1 },
});

/**
 * 上传一张本地图片进素材库（`multipart/form-data`，字段 `file`，可带 `deckId` 记归属）。
 *
 * 三件事是承重的：
 * ① **比例在服务端按字节算**（`imageSize` + `nearestRatio`），不信前端量的那个数 ——
 *    这一档是「贴进这一格会被裁掉两边」那句提醒的唯一依据，算错时那张图照旧贴得进去，
 *    只是主体被裁掉，接口全程 200。读不出尺寸的**直接拒**，不缺省成 16:9。
 * ② **转存走 `storeUploadedImage`**（和生图同一条路）：COS 没配时落本机磁盘，而那件事
 *    必须回给前端说出来 —— 本机磁盘上的图换机器/多实例就 404，而那时页面上只是裂图。
 * ③ **存进桶了但没记进库时要 500**：素材库里看不到它，他只会以为上传失败再传一遍，
 *    每传一遍在桶里多留一份孤儿文件。
 *
 * `mode` 存空串（不是 'concept'）：挑进图槽时 `asset.mode || spec.mode` 会回落成那一格
 * 本来要的画法 —— 写死一个的话上传的图会被当成概念插画，数据页那一格的检查就放过去了。
 */
pptRouter.post('/assets/upload', (req: Request, res: Response) => {
  const owner = ownerOf(req, res);
  if (!owner) return;
  assetUpload.single('file')(req, res, async (err) => {
    if (err) {
      const tooBig = err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE';
      res.status(400).json({
        error: tooBig
          ? `这张图超过 ${ASSET_UPLOAD_MB}MB，没有上传。先压一下（截图另存成 JPG 通常能小一个量级）再传。`
          : `文件读不出来：${err.message || '未知错误'}`,
      });
      return;
    }
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: '没收到文件（表单字段名要是 file）' });
      return;
    }

    const size = imageSize(file.buffer);
    if (!size || !size.width || !size.height) {
      // 尺寸读不出来一律拒。缺省成 16:9 的话，一张竖图会被静默当成横图记进库，
      // 之后贴进 16:9 的槽里一句提醒都没有，而画面上主体被裁掉一半。
      res.status(400).json({
        error:
          `读不出这张图的尺寸（${file.originalname || '未命名'}，${(file.size / 1024).toFixed(0)}KB）。` +
          '只支持 PNG / JPG / GIF / WebP —— 尺寸决定它按哪一档比例（16:9 / 1:1 / 3:4）记进素材库，' +
          '猜一个的话它贴进图槽时会被裁掉而没有任何提醒。请另存成 PNG 或 JPG 再传。',
      });
      return;
    }
    const ratio = nearestRatio(size.width, size.height);
    const deckId = typeof req.body?.deckId === 'string' ? req.body.deckId.trim() : '';

    try {
      const stored = await storeUploadedImage(file.buffer, {
        mime: file.mimetype,
        bucketProfile: 'ppt',
        keyPrefix: 'ppt-uploads',
      });
      rememberAsset(owner, {
        url: stored.url,
        prompt: file.originalname || '本地上传',
        mode: '',
        ratio,
        model: '本地上传',
        storage: stored.storage,
        deckId,
      });
      const asset = findAssetByUrl(owner, stored.url);
      if (!asset) {
        res.status(500).json({
          error:
            `图已经存好了（${stored.url}），但没能记进素材库 —— 别重传（每传一遍都会在存储里多留一份），` +
            '这是库写入的问题，请看服务端日志。',
        });
        return;
      }
      res.json({
        asset,
        ratio,
        pixels: `${size.width}×${size.height}`,
        // 落本机磁盘要说出来**并且说出为什么**：这张图现在只在这台机器上，
        // 换机器/多实例部署时它 404，而那时页面上只是一张裂图。
        note:
          stored.storage === 'local'
            ? `这张图存在服务器本机磁盘上，没进对象存储：${stored.reason || '原因未知'}。换机器或多实例部署时它会打不开。`
            : '',
      });
    } catch (e: any) {
      console.error('[ppt] 素材上传失败:', e?.message || e);
      res.status(500).json({ error: `上传失败：${e?.message || '未知错误'}` });
    }
  });
});

/**
 * 删一条素材。**只删这条记录** —— COS 上的文件和已经用了这张图的那几页 html 都不动，
 * 所以前端那句确认里必须写清楚（不写的话他以为这是「把这张图从稿子里去掉」，
 * 删完去翻那份 deck 图还在，而这边刚回了「已删除」）。
 */
pptRouter.delete('/assets/:id', (req: Request, res: Response) => {
  const owner = ownerOf(req, res);
  if (!owner) return;
  if (!deleteAsset(req.params.id, owner)) {
    res.status(404).json({ error: '这条素材不存在（或不是你的）' });
    return;
  }
  res.json({ ok: true });
});

/**
 * 版式效果 demo。整份 deck，`?only=L7` 只出那一页（版式库的卡片缩略图和抽屉都 iframe 它）。
 *
 * 三件事是承重的，少一件页面上就是一块白而接口全是 200：
 * ① 它在 `auth/middleware.ts` 里登记成 **public** —— `<iframe src>` 带不了 Authorization 头，
 *    而 `/api/` 下默认是 protected，于是 iframe 里显示的是一句 `Authentication required`。
 * ② `app.ts` 对这条路径单独发 `X-Frame-Options: SAMEORIGIN` —— 全局那句 DENY 连同源
 *    iframe 一起拦。
 * ③ `no-store`：改完 demo 片段重启服务后要立刻看到，缓存住的话「我改了怎么没变」查不出成因。
 */
pptRouter.get('/demo-deck.html', (req: Request, res: Response) => {
  const only = typeof req.query.only === 'string' ? req.query.only : undefined;
  try {
    const html = demoDeck(only);
    res.setHeader('Cache-Control', 'no-store');
    res.type('html').send(html);
  } catch (e: any) {
    // 错误也要能在 iframe 里读出来（那是唯一看得见的地方），所以回纯文本原文，
    // 不回 JSON —— `{"error":…}` 在 iframe 里就是一行花括号。
    const code = e instanceof DemoNotFoundError ? 404 : 500;
    res.status(code).type('text/plain; charset=utf-8').send(
      `版式 demo 出不来：${e?.message || e}\n\n现有片段：${demoSafeIds()}`
    );
  }
});

function demoSafeIds(): string {
  try {
    return demoIds().join(' / ') || '(空)';
  } catch {
    return '(读不到 demo-slides.html)';
  }
}

/**
 * 版式案例库列表。**不带 buildText**（12 份详情 md 加起来近 2000 行，
 * 列表页一个也用不上），要看完整骨架走 `GET /layouts/:id`。
 */
pptRouter.get('/layouts', (_req: Request, res: Response) => {
  // **停用的照旧返回**，只多一个 `disabled` —— 从列表里去掉的话案例库页面上那张卡凭空
  // 消失，他再也没有地方把它开回来（而库里那一行还在，规划里也确实没有它了）。
  try {
    const off = disabledLayoutIds();
    const list = layouts().map(({ buildText, ...rest }) => ({
      ...rest,
      buildLines: buildText.split('\n').length,
      disabled: off.has(rest.id),
    }));
    res.json({ layouts: list, total: list.length, disabledCount: off.size });
  } catch (e) {
    if (e instanceof LayoutStateError) {
      res.status(500).json({ error: e.message });
      return;
    }
    throw e;
  }
});

/**
 * 开 / 关一条版式（案例库页面上每张卡那个开关）。**全站共用一份**（不分用户、不分稿子）。
 *
 * 停用只影响**往后的规划**：给模型的清单里没有它了，而 `layoutById` 照旧认它 ——
 * 已经规划过的稿子里用到它的那几页照样能重新生成（只会多一句「这一页用的是已停用的版式」）。
 * 从库里删掉那一条 md 就做不到这件事：那几页会直接 400，而他停用的本意只是「以后别再挑它」。
 */
pptRouter.put('/layouts/:id/enabled', (req: Request, res: Response) => {
  const enabled = (req.body as { enabled?: unknown })?.enabled;
  if (typeof enabled !== 'boolean') {
    // 认不出的值不猜（`'false'` 猜成 true 的话开关看着关了、实际开着）。
    res.status(400).json({ error: '要传 enabled: true / false。' });
    return;
  }
  try {
    const { disabled, warnings } = setLayoutEnabled(req.params.id, enabled);
    res.json({ disabled, warnings });
  } catch (e) {
    if (e instanceof LayoutStateError) {
      res.status(400).json({ error: e.message });
      return;
    }
    throw e;
  }
});

pptRouter.get('/layouts/:id', (req: Request, res: Response) => {
  const layout = layoutById(req.params.id);
  if (!layout) {
    res.status(404).json({ error: `没有版式 ${req.params.id}` });
    return;
  }
  res.json({ layout });
});

/**
 * 配图画风库（S-A ~ S-F）。前端那个下拉照它渲染 —— 写死一份清单的话，md 里改了/加了
 * 一套画风之后界面上完全看不见，而选中的那几套照旧能用（读起来像「就这几种」）。
 */
pptRouter.get('/styles', (_req: Request, res: Response) => {
  res.json({
    styles: styles().map(({ templates, ...rest }) => rest),
    defaultStyleId: defaultStyleId(),
    /**
     * **默认那套（P-A）**的色值，界面上给个参考。每份稿子实际发给生图模型的颜色是它自己
     * 那套设计规范解析出来的（096 `deckColors(design)`）—— 这里回不了「这一份」的，
     * 因为这个端点不带 deck id。
     */
    colors: deckColors(),
  });
});

/**
 * 提纲整理：挑出提纲里的无效信息（备注 / 待办 / 口头语 / 元信息），回一份干净提纲。
 *
 * **不落库**，也不动这份稿子的任何一列：库里照旧是他原来那份提纲，换不换由前端那个
 * 「用整理后的版本 / 撤销整理」决定。直接覆盖库里那一份的话，删错的那几行连撤都撤不回来
 * —— 而整理后的提纲读起来完全通顺，他要逐字对原文才发现少了什么。
 *
 * 提纲同样取库里那一份（同 `/plan`）：收 body 的话「整理的」和「规划用的」会是两份。
 */
pptRouter.post('/decks/:id/clean-outline', async (req: Request, res: Response) => {
  const owner = ownerOf(req, res);
  if (!owner) return;
  const deck = getDeck(req.params.id, owner);
  if (!deck) {
    res.status(404).json({ error: '这份演示稿不存在（或不是你的）' });
    return;
  }
  try {
    const result = await cleanOutline(deck.outline, owner.userId);
    res.json({
      ...result,
      // 一行都没删也要能说清（前端那句「提纲很干净」靠它，而不是靠 removed 为空猜）：
      // 「模型认为没有要删的」和「这次调用其实失败了」在界面上必须分得开。
      changed: result.removed.length > 0,
      chars: { before: deck.outline.trim().length, after: result.cleaned.length },
    });
  } catch (e: any) {
    sendPptError(res, e, e instanceof OutlineCleanError, '提纲整理失败');
  }
});

/**
 * 排版规划：这份稿子的提纲 → 每页挑一个版式（不生成 HTML），结果落库。
 *
 * **提纲取库里那一份，不收 body 里的** —— 收 body 的话前端那个还没保存的编辑框会成为
 * 事实上的提纲，于是「库里存的」和「刚刚规划用的」是两份，而两边都正常返回：
 * 下次进来重新生成的是另一份内容的页。
 *
 * 失败一律 4xx/5xx 带原文，不回 `{pages:[]}`：空规划在界面上和「这份提纲拆不出页」
 * 分不开，而真实成因（额度打满 / 截断 / 模型没按 JSON 回）三种解法完全不同。
 */
pptRouter.post('/decks/:id/plan', async (req: Request, res: Response) => {
  const owner = ownerOf(req, res);
  if (!owner) return;
  const deck = getDeck(req.params.id, owner);
  if (!deck) {
    res.status(404).json({ error: '这份演示稿不存在（或不是你的）' });
    return;
  }
  try {
    const result = await planDeck(deck.outline, owner.userId);
    const saved = savePlan(deck.id, owner, result);
    if (!saved.ok) {
      // 规划本身是一次真实调用，存不下来必须说 —— 回 200 的话他刷新之后规划没了，
      // 只会以为「又要重新规划一次」，而额度已经扣过。
      res.status(500).json({ error: '规划出来了但没存上（这次调用已经花掉了），请刷新看看这份稿子还在不在。' });
      return;
    }
    // 清掉的页数和**备好的图张数**都要回：两样都是已经花掉的钱。备好的图不说的话，
    // 他重新规划完只看到「规划好了」，而刚才逐格备的那几张凭空没了（图本身还在素材库里，
    // 可以重新挑回来 —— 这半句也得说，不然他以为钱白花了）。
    res.json({
      ...result,
      // 新的页序版本号（098）：重新规划也会 +1（旧页全清了），**不回的话前端手里那个号立刻过期**
      // —— 规划完点第一次生成就是一句 409，而他刚刚才在这里成功规划过。
      planRev: getDeck(deck.id, owner)?.plan_rev ?? 0,
      clearedPages: saved.clearedPages,
      clearedImages: saved.clearedImages,
      // 他手写的那几段要求也一起没了（092）。不说的话下一次生成拿到的是没带要求的那一版，
      // 而出来照样是一页完整的幻灯片 —— 「语气克制一点」一处都没生效。
      clearedNotes: saved.clearedNotes,
    });
  } catch (e: any) {
    sendPptError(res, e, e instanceof PlanError, '排版规划失败');
  }
});

/** 这份稿子存着的规划。读不出来一律抛错 —— 空规划会让下面几条接口「成功地」什么都不做。 */
function planOf(deck: { plan_json: string }): { pages: PlannedPage[] } {
  if (!deck.plan_json) throw new PageError('这份稿子还没规划过（先规划，再生成页）。');
  try {
    const p = JSON.parse(deck.plan_json);
    if (!Array.isArray(p?.pages) || !p.pages.length) throw new Error('empty');
    return p;
  } catch {
    throw new PageError('这份稿子存着的规划读不出来（plan_json 坏了），要重新规划一次。');
  }
}

/**
 * deck 外壳上的品牌/主题/设计规范。**所有拼装都从这里拿**（生成、配图、就地编辑、拼整份、
 * 导出十几处）：漏一处的话那一处是默认配色 —— 预览里蓝的、导出的文件橙的，两份各自都好看。
 */
function shellMeta(deck: { title: string; brand_cn: string; brand_en: string; design_json?: string }) {
  return {
    brandCn: deck.brand_cn || '示例企业',
    brandEn: deck.brand_en || 'SAMPLE',
    topic: deck.title,
    design: parseDesignSpec(deck.design_json).spec,
  };
}

/** 库里这一页那一行（没有 = 这一页还没生成、也没备过图）。 */
function pageRow(deckId: string, owner: DeckOwner, page: number): PptDeckPage | undefined {
  return listPages(deckId, owner).find((p) => p.page === page);
}

/**
 * 这一页**真的有 HTML**（不是只备了图的那种空行）。判据是里面有 `<section>` 而不是
 * `html !== ''`：空串拿去拼装会抛「找不到 <section>」，而更糟的是当成「已生成」之后
 * 前端右边是一块白 —— 读起来像那一页排版塌了。
 */
// 写成类型收窄（`row is T`）：只回 boolean 的话调用点后面那句 `row.html` 会被编译器拦下，
// 于是那里只能写 `row!.html` —— 而 `!` 一旦养成习惯，哪天真的传进来一个 undefined 就是
// 运行时崩在这一行，而不是编译期就拦住。
function isBuilt<T extends { html: string }>(row?: T): row is T {
  return !!row?.html?.includes('<section');
}

/** 单页预览（套外壳、不带页脚、带这一页的蒙版）。**十几处都走它** —— 漏传蒙版那个参数的话
 *  那一处是「预览里没蒙版、刷新之后有」，两份各自都是一页正常的幻灯片。 */
function previewOf(deck: PptDeck, row: { veil_opacity?: number | null }, html: string): string {
  return assemblePreview(html, shellMeta(deck), row.veil_opacity || 0);
}

/**
 * 「改这一页」那七条接口共同的前置：登录 → 这份稿子是他的 → **页序版本号对账** → 这一页
 * 已经生成过。任何一步没过这里已经写好响应（401/404/400/409），调用方直接 `return`。
 *
 * **一份**：这段原来在七个端点里各抄了一遍，而其中六个（改字 / 改样式 / 改整块对齐 / 删这一块 /
 * ai-edit / ai-remake）漏了页序对账那一步 —— 这几条接口全按**页码**定位：他在另一个标签页
 * 里插过/删过一页之后，这边第 12 页已经是另一份内容，改下去接口 200、界面上「已修改」，
 * 而改的是隔壁那一页。`eids` 交叉核对救不了：`injectEids` 是每页从 `t1` 重编的，
 * 连着两页同版式时它是空对空。
 *
 * 页序对账放在「这一页生成过没」**之前**：版本号已经旧了的时候，那个页码指的是哪一页本身
 * 就是没意义的，先回一句「还没生成」会让他去点「生成这一页」—— 那是一次真实花费，
 * 落在的还是错的那一页。
 */
function editTarget(
  req: Request,
  res: Response,
  notBuiltTail: string
): { owner: DeckOwner; deck: PptDeck; page: number; row: PptDeckPage } | null {
  const owner = ownerOf(req, res);
  if (!owner) return null;
  const deck = getDeck(req.params.id, owner);
  if (!deck) {
    res.status(404).json({ error: '这份演示稿不存在（或不是你的）' });
    return null;
  }
  if (!checkPlanRev(req, res, deck)) return null;
  const page = Number(req.body?.page) || 0;
  const row = pageRow(deck.id, owner, page);
  if (!isBuilt(row)) {
    res.status(400).json({ error: `第 ${page} 页还没生成${notBuiltTail}` });
    return null;
  }
  return { owner, deck, page, row: row as PptDeckPage };
}

/**
 * 生成这份稿子的第 N 页 HTML，**生成完立刻落库**。
 *
 * 两件事是承重的：
 * ① 输入以库里的 `plan_json` 为准。body 里的 `title`/`points` **只有他在对话框里改过时才带**，
 *    而且是「先写回 `plan_json` 再拿这份新的去生成」—— 前端每次原样回传的话，它内存里那份
 *    （可能是上一次规划的）会成为事实上的输入，生成出来每一页都好看、只是和这份稿子的规划
 *    对不上，两边都不报错。「改了却没写回库」是同一个事故的另一半（见下面 `readPageOutline`）。
 * ② 落库失败必须报出来：这一页是一次真实调用，静默丢掉的话他刷新回来看到的是「还没生成」，
 *    只会再花一次。
 *
 * 返回带 `previewHtml`（套好 deck 外壳的单页）：预览和最终 deck 共用 `deckShell` 那一份拼装，
 * 前端自己拼一遍的话「预览里好看、真 deck 里换了骨架」两边都不报错。
 */
pptRouter.post('/decks/:id/pages', async (req: Request, res: Response) => {
  const owner = ownerOf(req, res);
  if (!owner) return;
  const deck = getDeck(req.params.id, owner);
  if (!deck) {
    res.status(404).json({ error: '这份演示稿不存在（或不是你的）' });
    return;
  }
  // 页序在他打开之后变过就不生成（098）：这一次要等上游几十秒，回来时写的是**现在的**
  // 第 N 页 —— 那可能已经不是他点的那一页了，而出来是一页正常的幻灯片。
  if (!checkPlanRev(req, res, deck)) return;
  const page = Number(req.body?.page) || 0;
  try {
    const plan = planOf(deck);
    const row = plan.pages.find((p) => p.page === page);
    if (!row) {
      throw new PageError(
        `第 ${page} 页不在这份稿子的规划里（规划只有 ${plan.pages.length} 页）。刷新一下看看规划是不是换过了。`
      );
    }
    // 空白页没有「生成」这一步（103）。**必须在这里拦**：往下走的话它会按案例库那套版式排出
    // 一页读得通的幻灯片，把他自己摆的文字和图整页换掉 —— 一次真实调用，而屏幕上只是
    // 「这一页怎么变样了」。前端也不给这个按钮，这一道是防另一个标签页/直接调接口。
    if (isBlankPage(row.layoutId)) {
      throw new PageError(
        `第 ${page} 页是空白页（你自己摆的），不走 AI 生成 —— 生成会按案例库的版式把这一页整页换掉，你摆的文字和图都会没了。要改就在右边预览里直接改。`
      );
    }
    // 「生成前改一下」（092）。body 里带了就先存下来再生成：不存的话下一次「重新生成」和
    // 「逐页生成」都会退回规划里那条版式、丢掉那段要求，而出来照样是一页完整的幻灯片。
    const setup = readPageSetup(req.body, row.layoutId);
    if (setup.layoutId !== undefined || setup.notes !== undefined) {
      savePageSetup(deck.id, owner, { page: row.page, layoutId: setup.layoutId, notes: setup.notes });
    }
    // 他在对话框里改过的提纲（标题 + 要点）：**存下来再生成，而且只有这一条路会存**
    // （「点了生成才保存，没生成就不保存」）。存之后下面用的就是新的那份 —— 存了却拿旧的
    // 去生成的话，出来是一页照着旧提纲排的完整幻灯片，而列表和标题栏写的是新提纲。
    const outline = readPageOutline(req.body);
    if (outline) {
      if (!updatePlanPageOutline(deck.id, owner, row.page, outline).ok) {
        throw new PageError(`第 ${page} 页的提纲没存上，这一页没生成（别直接重试，刷新一下看看规划是不是换过了）。`);
      }
      row.title = outline.title;
      row.points = outline.points;
      // 原文也要换成他改过的那一段：这里不换的话下面进 prompt 的还是规划切出来的老原文
      // （库里已经是新的了），出来是一页排得很好、内容却是他刚删掉那一版的幻灯片。
      if (outline.outlineText !== undefined) row.outlineText = outline.outlineText;
    }
    const stored = pageRow(deck.id, owner, row.page);
    // 有效版式 = 这次选的 → 上次存的 → 规划里那条。**认不出的版式在 readPageSetup 里已经
    // 400 了**，绝不悄悄回落成规划那条（他选了 L12 拿到 L07 排的一页，读起来完全正常）。
    const layoutId = setup.layoutId || stored?.setup_layout_id || row.layoutId;
    const notes = setup.notes !== undefined ? setup.notes : stored?.setup_notes || '';
    const meta = shellMeta(deck);
    const result = await generatePage(
      {
        page: row.page,
        total: plan.pages.length,
        section: row.section,
        title: row.title,
        points: row.points,
        // 这一页的提纲原文（规划那一步按行号切的）。**必须带**：不带的话这一步的输入又只剩
        // 摘要，提纲上的数字、机构名、条款一个字都进不了 prompt —— 而出来照样是一页排得
        // 很好的幻灯片，内容只剩三成，一处都不报错。老规划里没有这个字段（缺了退回老行为）。
        outlineText: row.outlineText,
        layoutId,
        notes,
        // 整份那段（093）**每页都带**，和页级那段一起发（不是二选一，见 pageService）。
        deckNotes: deck.notes || '',
        images: row.images,
        // 规格带进 prompt：图位的条数和顺序要和规划一致，备好的图才贴得对（见 pageService）。
        imageSpecs: row.imageSpecs,
        brandCn: deck.brand_cn || undefined,
        brandEn: deck.brand_en || undefined,
        topic: meta.topic,
        // 这份稿子的设计规范（096）。**和外壳同一份**（`shellMeta` 里那个）—— 两处各解析一遍
        // 的话画面按外壳那份渲染、prompt 按另一份写，紧凑档排出标准档的容量而一处都不报错。
        design: meta.design,
        // 这一页存着的蒙版（097）跟着进预览：不带的话刚生成完那一眼没有蒙版，
        // 刷新之后才有 —— 看起来像「蒙版时好时不好」。
        veil: stored?.veil_opacity || 0,
      },
      owner.userId
    );
    // 备好的图**当场贴进这份 html**（不调 AI、不花钱）。不贴的话「先备图」那一步等于白做：
    // 页面第一次显示出来仍然全是占位图，他会去点配图，那才是重新花一次钱。
    const prepared = safeJson<any[]>(
      pageRow(deck.id, owner, row.page)?.pending_images_json || '',
      []
    ).filter((x) => x?.url);
    const fill = applyPreparedImages(result.html, prepared);
    const problems = [...result.problems, ...fill.problems];
    const html = fill.html;
    const previewHtml = fill.used.length
      ? assemblePreview(html, meta, stored?.veil_opacity || 0)
      : result.previewHtml;
    // 图位清单**按这一页真的排出来的图位对齐**（纯代码，不调 AI、不花钱，见 `specsFromSlots`）。
    // 不对齐的话那几格在界面上根本不存在：换过版式 / 按真实内容多排了一块之后 `imageSpecs`
    // 还是老的，「这一页详情」里备图那一整块干脆不画（写的是「这一页还没配过图」），
    // 而画面上就是几张占位图 —— 他只剩「配全部图」那条真花钱的路。
    // **在存盘之前做**：放到后面的话这几句提示进不了 `problems_json`，刷新一次就没了。
    const sync = specsFromSlots(row.imageSpecs || [], findImageSlots(html));
    if (sync.changed) {
      if (updatePlanPageImages(deck.id, owner, row.page, sync.specs).ok) {
        row.imageSpecs = sync.specs;
        row.images = sync.specs.length;
      } else {
        // 存不上也要说：界面上照旧是老清单，他在面板上备的图会按错的格子号贴。
        sync.problems.push(
          `这一页实际排出 ${sync.specs.length} 个图位，但规划没改上（还是 ${row.images} 格）—— ` +
            '刷新一下再重新生成这一页；不改的话备图面板上少的那几格没有入口，多的那几格贴不到图。'
        );
      }
    }
    problems.push(...sync.problems);
    const saved = savePageHtml(deck.id, owner, {
      page: row.page,
      // 存**这次真的用了的**那条版式（可能是他换过的），不是规划里那条：存规划那条的话
      // 界面上这一页的标签写着 L07，画面是 L12 排的 —— 两版都是一页正常的幻灯片。
      layoutId: result.layoutId,
      html,
      problems,
      // 贴进去的那几张要一起存，否则界面上这一页写着「还没配过图」而图就在页面里。
      images: fill.used,
      imageStyleId: fill.used.length ? deck.style_id : '',
    });
    if (!saved) {
      res.status(500).json({
        error: `第 ${page} 页生成出来了但没存上（这次调用已经花掉了）。刷新一下，别直接重试。`,
      });
      return;
    }
    // 回的是**贴完图之后**那一版 html / previewHtml：回生成时那一版的话，界面上这一页
    // 是占位图而库里存的已经有图了，他会照着屏幕再点一次配图。
    res.json({
      ...result,
      html,
      previewHtml,
      problems,
      images: fill.used,
      style: fill.used.length && deck.style_id ? { id: deck.style_id, name: '' } : undefined,
      // 这次到底按哪条版式、带了什么要求（092）。回出来前端才对得上：他换了版式而这里
      // 用的是别的一条时，画面上那一页照样是一页正常的幻灯片，看不出用错了。
      // `deckNotes` 一起回：界面上只显示页级那段的话，「这一页什么要求都没写」和
      // 「这一页跟着整份那段走」分不开，而他会以为整份那段没生效、再在每页抄一遍。
      setup: { layoutId: result.layoutId, notes, deckNotes: deck.notes || '' },
      // 这一页**现在库里那份**提纲（他改过的话就是新的）。回出来前端才对得上：不回的话
      // 左边列表和标题栏还写着模型原来那句标题，而画面是按新提纲生成的 —— 两处各自都读得通。
      // 原文一起回：不回的话下次打开那个框读的是前端手上那份老原文，他会以为上一次的修改
      // 没存上、再改一遍（而库里存的才是对的）。
      outline: { title: row.title, points: row.points, outlineText: row.outlineText || '' },
      // 对齐之后的图位清单（`specsFromSlots`）。**必须回**：前端手上那份规划还是老的，
      // 不覆盖的话备图那一块照旧按 0 格 / 3 格画，而 problems 里明明写着「已改成 4 格」。
      plan: { images: row.images, imageSpecs: row.imageSpecs || [] },
    });
  } catch (e: any) {
    sendPptError(res, e, e instanceof PageError, '这一页生成失败');
  }
});

/**
 * 「生成前改一下」那两个字段的校验（092）。
 *
 * 两条都是「不校验就悄悄跑偏」：认不出的版式**一律 400**，不回落成规划那条（他选了 L12
 * 拿到 L07 排出来的一页，读起来完全正常，只会以为 L12 就长这样）；要求超长**一律 400**，
 * 不截断（截掉的半句照样发出去，而他写在后面那条要求一处都不会生效）。
 *
 * 字段没传就是 `undefined`（= 不动库里存着的那份），不是空串（= 他清空了）。
 */
function readPageSetup(
  body: any,
  planLayoutId: string
): { layoutId?: string; notes?: string } {
  const out: { layoutId?: string; notes?: string } = {};
  if (typeof body?.layoutId === 'string' && body.layoutId.trim()) {
    const id = body.layoutId.trim().toUpperCase();
    if (!layoutById(id)) {
      throw new PageError(
        `没有版式 ${id} —— 案例库里只有 ${layouts().map((l) => l.id).join(' / ')}。` +
          `这一页规划里是 ${planLayoutId}。`
      );
    }
    // 选回规划那条 = 清掉覆盖（存着一份和规划一样的值也没错，但清掉之后
    // 「换过版式」这件事在界面上才看得出来）。
    out.layoutId = id === planLayoutId ? '' : id;
  }
  if (typeof body?.notes === 'string') {
    const notes = body.notes.trim();
    if (notes.length > MAX_PAGE_NOTES_CHARS) {
      throw new PageError(
        `这一页的额外要求有 ${notes.length} 字，上限 ${MAX_PAGE_NOTES_CHARS} 字（截断的话你写在后面那几条不会生效，所以这里直接拒）。`
      );
    }
    out.notes = notes;
  }
  return out;
}

/**
 * 「生成前改提纲」那几个字段的校验。**没传 `title` 就是没改**（用库里那份），传了就整条都按
 * 传进来的算 —— 两个字段各自可选的话，「只改了标题」那一次会把要点当成空数组存进去。
 * （`outlineText` 例外：它自己按「传了才动」算，见函数末尾 —— 老前端不带这个字段时
 * 一律不动库里那份原文。）
 *
 * 三条都是「不拒就悄悄跑偏」：
 * ① **标题空一律 400**。空标题生成出来是一页没有标题的幻灯片，读起来像「这个版式就这样」。
 * ② **一条要点都不剩一律 400**。只给标题的话模型会自己编这一页的内容 —— 出来是一页
 *    排版完整、读着通顺、而内容不是他的东西的幻灯片，一处都不报错。
 * ③ **超长/超条数一律拒，不截断**（同 `MAX_PAGE_NOTES_CHARS`）：截掉的那几条照样生成出
 *    一页完整的幻灯片，只是他写在后面的一个字都没进去。
 *
 * 空行/空要点丢掉（textarea 里按行拆，中间空一行是正常打法），但**只丢空的** —— 丢完
 * 一条不剩时走 ②。
 */
function readPageOutline(body: any): { title: string; points: string[]; outlineText?: string } | null {
  if (typeof body?.title !== 'string') return null;
  const title = body.title.trim();
  if (!title) {
    throw new PageError('这一页的标题是空的 —— 生成出来会是一页没有标题的幻灯片，看起来像版式本来就这样，所以这里直接拒。');
  }
  if (title.length > MAX_PAGE_TITLE_CHARS) {
    throw new PageError(
      `这一页的标题有 ${title.length} 字，上限 ${MAX_PAGE_TITLE_CHARS} 字（版式里标题就那么大一块，再长会挤成一团或被裁掉）。`
    );
  }
  const raw = Array.isArray(body?.points) ? body.points : [];
  const points = raw.map((x: unknown) => String(x ?? '').trim()).filter(Boolean);
  if (!points.length) {
    throw new PageError('这一页一条要点都没有 —— 只给标题的话模型会自己编这一页的内容，出来那一页读着通顺但不是你的东西。至少写一条。');
  }
  if (points.length > MAX_POINTS_PER_PAGE) {
    throw new PageError(
      `这一页有 ${points.length} 条要点，上限 ${MAX_POINTS_PER_PAGE} 条（截掉后面几条的话它们一个字都不会出现在页面上，所以这里直接拒）。拆成两页更好排。`
    );
  }
  const long = points.findIndex((p: string) => p.length > MAX_POINT_CHARS);
  if (long >= 0) {
    throw new PageError(`第 ${long + 1} 条要点有 ${points[long].length} 字，上限 ${MAX_POINT_CHARS} 字 —— 一条要点是一行字，太长会被版式裁掉。`);
  }
  // 提纲原文（他在框里改过的那一段）。**没传就是没改**（用库里那份，老规划里干脆没有这个
  // 字段）；传了空串是「他有意清空」—— 允许，但那一页往后只按上面几条要点生成。
  // 超长一律拒不截断：截掉的后半段照样生成出一页完整的幻灯片，而他粘进去的那些数字一个
  // 都没进 prompt。**只 trim 首尾**：中间的换行就是提纲的分条，规范化掉之后模型看到的是
  // 一大段连着的字，排出来会把几条并成一句。
  let outlineText: string | undefined;
  if (typeof body?.outlineText === 'string') {
    outlineText = body.outlineText.trim();
    if (outlineText!.length > MAX_PAGE_OUTLINE_CHARS) {
      throw new PageError(
        `这一页的提纲原文有 ${outlineText!.length} 字，上限 ${MAX_PAGE_OUTLINE_CHARS} 字（截断的话后半段一个字都不会进 prompt，所以这里直接拒）。` +
          '这么多内容一页装不下，回上一步拆成两页。'
      );
    }
  }
  return { title, points, outlineText };
}

/**
 * 这份稿子已经生成的页（预览现拼 —— 存下来的话改过骨架之后老 deck 用旧骨架）。
 *
 * **外壳只回一份**（`shell` + 每页 `section`，前端做一次 `replace(previewSlot, section)`）。
 * 原来给每一页都回一整份 `assemblePreview`，也就是把同一份 85KB 的外壳抄了 N 遍：实测那份
 * 41 页的稿子响应 3658KB，而那些页的 html 合计只有 51.5KB（`server/scripts/bench-ppt.mts`），
 * 改完 141KB。这件事界面上完全看不出来 —— 只是「打开这份稿子有点慢」。
 * 其余那几条接口（生成 / 配图 / 就地编辑）照旧各回一份完整的 `previewHtml`：那是一次一页，
 * 抄不出量来，而少一处改动就少一处漂开的机会。
 *
 * 091 之后这里会出现 `html = ''` 的行（先备了图、还没生成 HTML）。那种行的 `section`
 * **必须留空**：照样拼一份的话前端把它当成「这一页已经生成」渲染成一块白，读起来像那一页
 * 排版塌了（而它其实压根没生成过）。
 */
pptRouter.get('/decks/:id/pages', (req: Request, res: Response) => {
  const owner = ownerOf(req, res);
  if (!owner) return;
  const deck = getDeck(req.params.id, owner);
  if (!deck) {
    res.status(404).json({ error: '这份演示稿不存在（或不是你的）' });
    return;
  }
  const meta = shellMeta(deck);
  const rows = listPages(deck.id, owner).map((p) => ({
    page: p.page,
    layoutId: p.layout_id,
    html: p.html,
    section: p.html ? previewSection(p.html, meta, p.veil_opacity || 0) : '',
    problems: safeJson<string[]>(p.problems_json, []),
    images: safeJson<unknown[]>(p.images_json, []),
    imageStyleId: p.image_style_id,
    // 备好的图（091）。**和 `images` 分开回**：那一个是配图跑完之后的结果，这一个在
    // HTML 之前就存在。合成一个的话「这一页图配好了」和「图只是备着、还没贴上去」
    // 在界面上分不开，而他会直接去拼整份（拼出来那几格还是占位图）。
    pendingImages: safeJson<unknown[]>(p.pending_images_json, []),
    /** 这一页的蒙版透明度（097）。滑块照它画 —— 不回的话每次刷新都归零，而库里是他调过的值。 */
    veilOpacity: p.veil_opacity || 0,
    // 生成前改的那两样（092）。`setupLayoutId` 是**他挑的**那条，`layoutId` 是这份 html
    // 实际用的那条 —— 两个不一样就是「换了版式还没重新生成」，前端必须显眼说出来：
    // 不说的话他看着旧版式排的那一页，以为新版式就长这样。
    setupLayoutId: p.setup_layout_id,
    notes: p.setup_notes,
    updatedAt: p.updated_at,
  }));
  // `previewSlot` 跟着响应一起回，前端不写死一份：两边漂开的话 replace 什么都不做，
  // 而 iframe 里是一份**没有幻灯片的空外壳** —— 一块白，和「这一页排版塌了」长得一样。
  res.json({ pages: rows, shell: previewShell(meta), previewSlot: PREVIEW_SLOT });
});

function safeJson<T>(text: string, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

/**
 * 删掉这一页（规划里那一条 + 库里那一行），后面的页码整体往前挪一位（`deckStore.deletePage`）。
 *
 * **回执要逐类报数**（html 一次调用、备好的 N 张图、他手写的要求、调过的蒙版）：只回
 * 「已删除」的话，他不知道刚扔掉的是几次真实花费 —— 而删掉的那一页在界面上只是「少了一张卡」。
 * 已经删掉的图仍在素材库里可以挑回来，这句话也要说（不说的话他以为那几张钱白花了）。
 *
 * 改完的整份规划 + 新的 `planRev` 一起回：前端照它重画，**不本地 splice** —— 本地那十几个
 * 按页码索引的 map（备图 / 蒙版 / 额外要求 / 已生成的画面）会整体错位一位，而每一页渲染出来
 * 都是一页正常的幻灯片。
 */
pptRouter.delete('/decks/:id/pages/:page', (req: Request, res: Response) => {
  const owner = ownerOf(req, res);
  if (!owner) return;
  const page = Number(req.params.page) || 0;
  try {
    const r = deletePage(req.params.id, owner, page);
    res.json(r);
  } catch (e: any) {
    res.status(e instanceof DeckStructureError ? 400 : 500).json({ error: e?.message || '这一页没删掉' });
  }
});

/**
 * 在第 `after` 页后面插一页（`after: 0` = 插到最前面）。规划里多一条、**库里不建行**
 * （新页还没生成），后面的页码整体往后挪一位（`deckStore.insertPage`）。
 *
 * **不调 AI、不花额度** —— 提纲是他自己写的。所以这里不校验配额，但版式要在这里就认掉：
 * 认不出的版式回落成前一页那条的话，他挑了 L12 而插进来的是 L07，往后翻回来读起来完全正常。
 *
 * 回执里 `layoutInherited` 必须转给界面：版式是继承前一页来的时候，那一页会撞「连续同版式
 * ≤2 页」那条规范，而规划的 problems 是上一次算的（已经标成可能不准）—— 不催他去挑一条的话，
 * 出来是两页一模一样的版式，翻起来只是「这份稿子有点单调」。
 *
 * `blank: true` 插的是**一页空白画布**（⑥，见 `blankPage.ts`）：那一条路不要要点、不挑版式，
 * 而且**插进来就带 html**（回执里 `blank` 为真）—— 前端据此不要去开「生成前确认」那个框，
 * 开了的话他会在那里按「生成这一页」，而那是一次真实调用（服务端会拦，但额度前的那一步
 * 已经让他以为空白页也要生成）。
 */
pptRouter.post('/decks/:id/insert-page', (req: Request, res: Response) => {
  const owner = ownerOf(req, res);
  if (!owner) return;
  try {
    const picked = typeof req.body?.layoutId === 'string' ? req.body.layoutId.trim().toUpperCase() : '';
    if (picked && !layoutById(picked)) {
      res.status(400).json({
        error: `没有版式 ${picked} —— 案例库里只有 ${layouts().map((l) => l.id).join(' / ')}。`,
      });
      return;
    }
    const r = insertPage(req.params.id, owner, {
      after: Number(req.body?.after),
      title: String(req.body?.title ?? ''),
      points: Array.isArray(req.body?.points) ? req.body.points : [],
      layoutId: picked,
      // 空白页（⑥）：**只认 `true`**，不认 `'false'` / `0` 这些真值不明的写法 —— 认宽了的话
      // 前端某次漏传成字符串就会插进一页空白页，而界面上它是「已生成」的一页空幻灯片。
      blank: req.body?.blank === true,
    });
    res.json(r);
  } catch (e: any) {
    res.status(e instanceof DeckStructureError ? 400 : 500).json({ error: e?.message || '这一页没插进去' });
  }
});

/**
 * 按**这一页的真实内容 + 他现在挑的那条版式**重排图位清单（一次 AI 调用，不生图、不花生图的钱）。
 *
 * 为什么要单独一个入口：图位清单是整份规划那一次定的，版式是他后来换的 —— 两者从此对不上
 * 而一处都不报错（备图面板照旧列着规划那几格、生成时 prompt 里的「正好 N 个图位」压着案例里
 * 的图位数）。**不做成「换版式就自动重排」**：那是一次真实调用，点一下下拉就扣一次额度；
 * 也不做成生成时顺便重排 —— 那时备好的图早就按旧清单贴过了。
 *
 * 三件事是承重的：
 * ① **版式取「这次传的 → 上次存的 → 规划那条」**，和生成那条路同一个顺序（`readPageSetup`
 *    已经把认不出的版式 400 掉了）。各算一份的话他看着 L11 的图位数，生成用的是 L07。
 * ② **落在新清单外面的备好的图要点名说**（`orphanedPreparedNotes`）：那几张花过钱，
 *    重排之后从备图面板上消失，而库里还留着。
 * ③ **这一页已经生成过 HTML 的话要说「要重新生成才生效」**：html 里的图位还是旧的那几个，
 *    新清单第 4 格备的图贴不进去，而面板上那一格挂着缩略图 —— 两处都读起来正常。
 */
pptRouter.post('/decks/:id/replan-images', async (req: Request, res: Response) => {
  const owner = ownerOf(req, res);
  if (!owner) return;
  const deck = getDeck(req.params.id, owner);
  if (!deck) {
    res.status(404).json({ error: '这份演示稿不存在（或不是你的）' });
    return;
  }
  // 同「生成这一页」（098）：这一次也是真实调用，而它写回 `plan_json` 里那一页的图位清单 ——
  // 页序变过之后落在别的一页上，那一页的备图面板从此按不对的清单画，一处都不报错。
  if (!checkPlanRev(req, res, deck)) return;
  const page = Number(req.body?.page) || 0;
  try {
    const plan = planOf(deck);
    const row = plan.pages.find((p) => p.page === page);
    if (!row) {
      throw new PageError(`第 ${page} 页不在这份稿子的规划里。刷新一下看看规划是不是换过了。`);
    }
    const stored = pageRow(deck.id, owner, page);
    // 他在对话框里刚换的那条版式**先存下来**（同「生成这一页」那条路）：不存的话重排是按新
    // 版式算的，而下一次生成又退回旧版式 —— 图位数和版式各说各话，两边都不报错。
    const setup = readPageSetup(req.body, row.layoutId);
    if (setup.layoutId !== undefined || setup.notes !== undefined) {
      savePageSetup(deck.id, owner, { page, layoutId: setup.layoutId, notes: setup.notes });
    }
    const layoutId = setup.layoutId || stored?.setup_layout_id || row.layoutId;
    const notes = setup.notes !== undefined ? setup.notes : stored?.setup_notes || '';
    const r = await replanPageImages(
      {
        page,
        section: row.section,
        title: row.title,
        points: row.points,
        layoutId,
        notes,
        deckNotes: deck.notes || '',
      },
      owner.userId
    );
    if (!updatePlanPageImages(deck.id, owner, page, r.specs)) {
      // 这次调用已经花掉了。静默丢的话面板上还是旧清单，他只会再点一次。
      res.status(500).json({
        error: `第 ${page} 页的图位重排出来了但没存上（这次调用已经花掉了）。刷新一下再试，别直接重试。`,
      });
      return;
    }
    const prepared = safeJson<any[]>(stored?.pending_images_json || '', []);
    const problems = [
      ...r.problems,
      ...orphanedPreparedNotes(prepared, r.specs.length),
      ...(isBuilt(stored)
        ? [
            `这一页已经生成过了 —— 画面里的图位还是旧的那几个（${layoutId} 的新清单有 ${r.specs.length} 格），` +
              '要按新清单排图位得重新生成这一页（已经备好的图会自动贴回去，不用重新花钱）。',
          ]
        : []),
    ];
    res.json({ page, layoutId: r.layoutId, imageSpecs: r.specs, problems, usage: r.usage });
  } catch (e: any) {
    sendPptError(res, e, e instanceof PageError || e instanceof PlanError, '重排图位失败');
  }
});

/**
 * 「先备图」：按规划里 `imageSpecs` 的第 index 格，给这一页备一张图 —— 从素材库挑
 * （`from='library'`，不花钱）、AI 现生一张（`from='ai'`，一次真实花费）、或者清掉
 * （`from='clear'`）。**HTML 还没生成也能备**（091 那一列就是为这个加的）。
 *
 * 四件事是承重的：
 * ① 规划里没有 `imageSpecs`（老规划 / 模型只给了张数）要**明确拒**，不能当成「这一页没有
 *    图要备」静默回一个空数组 —— 那样界面上是「备图完成、0 张」，而他等的是几张图。
 * ② index 必须落在规格数量之内：越界的话备出来的那张回填时没有对应槽位，等于白花钱，
 *    而两边都不报错。
 * ③ 素材库挑来的那张**比例/画风和这一格不一致时要出声**（不拒）：3:4 塞进 16:9 的槽位会被
 *    `cover` 裁掉两边、另一套画风混进来是笔触不统一 —— 两种都不报错，图看起来就是「不太对」。
 * ④ 存不上要报错并说「这次已经花掉了」：静默丢的话他刷新回来看到那一格还是空的，会再生一次。
 *
 * body 里可以带 `subject`（他自己改写的提示词）：**改过就写回规划**
 * （`updatePlanImageSubject`），并且 `from='subject'` 是「只存这句话、不生图」。不写回的话
 * 对话框里是他改过的那句、而下一次「AI 生成」/配图用的还是模型原来那句 —— 生出来是一张
 * 正常的图，只是不是他要的那张，没有一处会说。空的/超长的一律拒（空提示词生不出任何东西，
 * 那一格会一直停在占位图上；截断的话他写在后面那几个条件一处都没生效）。
 */
pptRouter.post('/decks/:id/prepare-images', async (req: Request, res: Response) => {
  const owner = ownerOf(req, res);
  if (!owner) return;
  const deck = getDeck(req.params.id, owner);
  if (!deck) {
    res.status(404).json({ error: '这份演示稿不存在（或不是你的）' });
    return;
  }
  // 同「生成这一页」（098）：备一张图是几十秒的真实花费，页序变过之后它会备到别的一页上
  // （那一页的面板上于是多出一张不相干的图，而两处都读起来正常）。
  if (!checkPlanRev(req, res, deck)) return;
  const page = Number(req.body?.page) || 0;
  const index = Number(req.body?.index) || 0;
  const from = String(req.body?.from || '');
  try {
    const planRow = planOf(deck).pages.find((p) => p.page === page);
    if (!planRow) {
      throw new PageError(`第 ${page} 页不在这份稿子的规划里。刷新一下看看规划是不是换过了。`);
    }
    const specs = planRow.imageSpecs || [];
    if (!specs.length) {
      throw new PageError(
        `第 ${page} 页的规划里没说清每张图画什么（老规划，或者模型只给了张数），没法提前备图 —— ` +
          '点「重新规划」跑一次才会有逐张说明（那会清掉这份稿子已经生成的页）。'
      );
    }
    if (index < 1 || index > specs.length) {
      throw new PageError(`第 ${page} 页只规划了 ${specs.length} 格图，没有第 ${index} 格（备了也没有位置贴）。`);
    }

    const row = pageRow(deck.id, owner, page);
    const before = safeJson<any[]>(row?.pending_images_json || '', []).filter((x) => x?.url);
    const kept = before.filter((x) => Number(x.index) !== index);
    // 这一格原来备的那张（换掉/清掉之后它可能还留在已经生成的 html 里 —— 见 `pastePrepared`）。
    const droppedUrl: string | undefined = before.find((x) => Number(x.index) === index)?.url;
    const problems: string[] = [];
    let picked: unknown = null;

    // 他改写的提示词：先落库再生图（顺序反了的话生成失败时那句话也丢了，他得重新写一遍）。
    const rawSubject = typeof req.body?.subject === 'string' ? req.body.subject.trim() : null;
    if (rawSubject !== null && from !== 'clear') {
      if (!rawSubject) {
        throw new PageError(`第 ${index} 格的提示词是空的 —— 空着生不出任何东西，那一格会一直停在占位图上。`);
      }
      if (rawSubject.length > MAX_SUBJECT_CHARS) {
        throw new PageError(
          `第 ${index} 格的提示词 ${rawSubject.length} 字，超过 ${MAX_SUBJECT_CHARS} 字上限。` +
            '截短一点再来 —— 截掉后半句照样能生出一张图，而你写在后面那几个条件一处都不会生效。'
        );
      }
      if (rawSubject !== specs[index - 1].subject) {
        if (!updatePlanImageSubject(deck.id, owner, page, index, rawSubject).ok) {
          throw new PageError(`第 ${index} 格的提示词没存上（这一格还是原来那句）。刷新一下再试。`);
        }
        specs[index - 1] = { ...specs[index - 1], subject: rawSubject };
      }
    }

    // 只存提示词、不生图、不动这一格已经备好的那张。
    if (from === 'subject') {
      const now = safeJson<any[]>(row?.pending_images_json || '', []).filter((x) => x?.url);
      // 已经备着一张的话，那张是照**上一句**提示词生的 —— 不说的话提示词写着 A、
      // 图是 B，而两处都读起来正常。
      if (now.some((x) => Number(x.index) === index)) {
        problems.push(`这一格已经备好的那张是照上一句提示词生的 —— 要按改过的这句重画，点「AI 生成」（一次真实花费）。`);
      }
      res.json({ page, images: now, problems, imageSpecs: specs });
      return;
    }

    if (from === 'clear') {
      // 清掉只是不再备着 —— 图本身还在素材库里（这句话要说，不然他以为刚才那次钱白花了）。
      problems.push('这一格清掉了（只是不再备着，图还在素材库里，可以再挑回来）。');
    } else if (from === 'library') {
      const asset = getAsset(String(req.body?.assetId || ''), owner);
      if (!asset) {
        throw new PageError('这张素材找不到了（可能已经在素材库里删掉了）—— 刷新素材库再挑一张。');
      }
      const spec = specs[index - 1];
      if (asset.ratio && !asset.ratio.startsWith(spec.ratio)) {
        problems.push(
          `挑的这张是 ${asset.ratio} 的，而这一格规划的是 ${spec.ratio} —— 贴进去会被裁掉两边（图本身没问题，只是构图会缺）。`
        );
      }
      // 画风和这份稿子不一套**不在这里报**：他是在挑图那一刻自己看着「画风 S-B」点下去的，
      // 报成「要注意」的话每挑一张都弹一条，真正要看的那几条（没地方贴 / 贴不上）会被冲掉。
      // 那件事由界面上那一格的标签一直显示（`PptPlan.vue` 的 `spec-meta`）。
      picked = {
        index,
        url: asset.url,
        prompt: asset.prompt,
        mode: asset.mode || spec.mode,
        ratio: asset.ratio || spec.ratio,
        styleId: asset.style_id,
        model: asset.model,
        storage: asset.storage,
        from: 'library',
        at: new Date().toISOString(),
      };
    } else if (from === 'ai') {
      const meta = shellMeta(deck);
      const r = await generateSpecImage(specs[index - 1], {
        owner,
        index,
        title: planRow.title,
        section: planRow.section || undefined,
        topic: meta.topic,
        styleId: deck.style_id || undefined,
        deckId: deck.id,
        page,
        // 图的配色跟着这份稿子的规范走（096）—— 不传的话蓝色系的稿子备出一堆橙图，
        // 每张单看都不错、一处都不报错。
        design: meta.design,
      });
      picked = r.image;
      problems.push(...r.problems);
    } else {
      // 不认识的 from 明确拒：静默当成 clear 的话，他点「AI 生成」看到的是那一格被清空，
      // 读起来像生图失败了。
      res.status(400).json({ error: `不支持的备图方式 ${from || '(空)'} —— 只有 library / ai / clear / subject。` });
      return;
    }

    const images = [...kept, ...(picked ? [picked] : [])].sort((a, b) => Number(a.index) - Number(b.index));
    if (!savePendingImages(deck.id, owner, { page, images })) {
      res.status(500).json({
        error:
          from === 'ai'
            ? `第 ${index} 格的图生成出来了但没存上（这次已经花掉了）。刷新一下再看，别直接重试。`
            : '没存上（这一格还是原来那样）。刷新一下再试。',
      });
      return;
    }
    // 这一页已经生成过 HTML 了：备好的图**当场贴进库里那份 html**（纯代码替换，不调 AI、
    // 不花钱）。只写进 `pending_images_json` 的话界面上这一格挂着缩略图而画面里还是占位图，
    // 唯一的出路是「重新生成这一页」—— 那是一次真实调用，而他要换的只是一张图。
    const pasted = isBuilt(row)
      ? pastePrepared(deck, owner, page, row, images, problems, from === 'clear' ? droppedUrl : undefined)
      : undefined;
    // `imageSpecs` 一起回去：他刚改过的那句提示词要覆盖前端内存里那份规划，不然对话框
    // 关掉再开是模型原来那句，而库里已经是新的 —— 两处不一样，界面上一处都不说。
    res.json({ page, images, problems, imageSpecs: specs, pasted });
  } catch (e: any) {
    sendPptError(res, e, e instanceof PageError || e instanceof PptImageError, '备图失败');
  }
});

/**
 * 把这一页备好的图当场贴进**库里存着的那份 html**（`pasteIntoBuiltPage` 算，这里只负责
 * 落库 + 拼预览）。换一张图之后不贴的话，界面上这一格挂着新缩略图、画面里还是原来那张
 * —— 两处都读起来正常，而唯一的出路是「重新生成这一页」（一次真实调用，还会连版式和
 * 文案一起重排）。
 *
 * 两件事在这一层：`problems_json` **沿用那一页原来那几条**（生成时 `checkPage` 报的）——
 * 换成备图这几条的话，「这一页版式塌了」那种提示会被「换了一张图」这个操作悄悄擦掉；
 * **存不上必须出声** —— 不说的话界面上是「这一格换好了」而库里那一页还是旧图，
 * 他拼出来的整份、导出的那个文件用的都是旧图。
 */
function pastePrepared(
  deck: NonNullable<ReturnType<typeof getDeck>>,
  owner: DeckOwner,
  page: number,
  row: ReturnType<typeof listPages>[number],
  images: unknown[],
  problems: string[],
  droppedUrl?: string
): { html: string; previewHtml: string; images: unknown[]; styleId: string } | undefined {
  const fill = pasteIntoBuiltPage(row.html, images as PreparedImage[], {
    images: safeJson<any[]>(row.images_json || '', []),
    droppedUrl,
  });
  problems.push(...fill.problems);
  const styleId = row.image_style_id || (fill.used.length ? deck.style_id || '' : '');
  const saved = savePageImages(deck.id, owner, {
    page,
    html: fill.html,
    images: fill.images,
    styleId,
    problems: safeJson<string[]>(row.problems_json || '', []),
  });
  if (!saved) {
    problems.push(
      '这张图没能贴进这一页（没存上）—— 画面里还是原来那一版，拼整份用的也是它。刷新一下再挑一次（图还备在这一格上，也还在素材库里）。'
    );
    return undefined;
  }
  return {
    html: fill.html,
    // 单页预览不带页脚（同 pageService / imageService）。
    previewHtml: previewOf(deck, row, fill.html),
    images: fill.images,
    styleId,
  };
}

/**
 * 调这一页那层黑色蒙版的透明度（097，**不调 AI、不花额度**）。
 *
 * 三条在这一层：
 * ① **不是布尔那种开关，收的是 0~1 的数**，超范围/不是数字一律 400 —— 夹到边界再存的话
 *    他拖到 120% 拿到的是 100%，而界面上那个数字是他拖的那个（下次刷新才变，看起来像
 *    「保存偶尔会跳」）。
 * ② **html 一个字都不改**，蒙版是拼装时贴的 —— 写进 html 的话「重新生成这一页」会把它
 *    带走，而滑块还停在他调的位置。
 * ③ 回**重拼过的 previewHtml**：前端照它换 iframe，不在本地叠一层半透明黑 ——
 *    本地叠的话预览里的层序和真 deck 不一样（本地那层压在文字上面），他会按看到的效果
 *    去调，而导出的文件是另一副样子。
 */
pptRouter.patch('/decks/:id/pages/:page/veil', (req: Request, res: Response) => {
  const owner = ownerOf(req, res);
  if (!owner) return;
  const deck = getDeck(req.params.id, owner);
  if (!deck) {
    res.status(404).json({ error: '这份演示稿不存在（或不是你的）' });
    return;
  }
  // 页序对账（098）也要过：不花钱，但同样按**页码**写库 —— 页序变过之后这一下调的是隔壁
  // 那一页，而界面上他看着的这一页跟着回来的预览一起变暗了，看起来完全正常。
  if (!checkPlanRev(req, res, deck)) return;
  const page = Number(req.params.page) || 0;
  const raw = req.body?.opacity;
  const opacity = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
    res.status(400).json({ error: `蒙版透明度要是 0 到 1 之间的数（收到 ${JSON.stringify(raw)}），这一页没改。` });
    return;
  }
  if (!savePageVeil(deck.id, owner, { page, opacity })) {
    res.status(500).json({
      error: `第 ${page} 页的蒙版没存上 —— 画面上是调过的，而库里还是原来那个值（拼整份和导出用的都是它）。刷新一下再调一次。`,
    });
    return;
  }
  const row = pageRow(deck.id, owner, page);
  res.json({
    page,
    veilOpacity: opacity,
    // 这一页还没生成时回空串：拿 '' 去拼会抛「找不到 <section>」，而他要的只是先把值存下来。
    previewHtml: isBuilt(row) ? previewOf(deck, { veil_opacity: opacity }, row.html) : '',
  });
});

/**
 * 就地改一段文字（**不调 AI、不花额度**）：他在预览里双击一段字改完失焦，这里改库里那份 html。
 *
 * 三条在这一层：
 * ① **html 从库里取，只收「哪一块 + 改前那句 + 改后那句」** —— 收整份 html 的话前端一次
 *    DOMParser 往返就可能把引号/自闭合标签/实体全换一遍（页面照样渲染），而它内存里那份
 *    还可能是重新生成前的旧版，于是「改一个标题」把整页退回上一版。
 * ② **改前那句对不上就 400**（`applyTextEdit` ②）：这次编辑是拿着旧画面在改，覆盖上去
 *    等于把另一处的改动悄悄擦掉。
 * ③ **存不上必须出声**：不说的话画面上是新文字而库里是旧的 —— 他拼出来的整份、导出的
 *    那个文件用的都是旧的那句。
 *
 * `problems_json` / `images_json` 一列都不动（`savePageEditedHtml`）。
 */
pptRouter.post('/decks/:id/edit-text', (req: Request, res: Response) => {
  const t = editTarget(req, res, '，没有可以改的内容。');
  if (!t) return;
  const { owner, deck, page, row } = t;
  try {
    const { html, text } = applyTextEdit(row.html, {
      eid: String(req.body?.eid || ''),
      oldText: String(req.body?.oldText ?? ''),
      newText: String(req.body?.newText ?? ''),
    });
    if (!savePageEditedHtml(deck.id, owner, { page, html })) {
      res.status(500).json({
        error: `第 ${page} 页没存上 —— 画面上是你改过的那句，而库里还是原来那句（拼整份和导出用的都是它）。刷新一下再改一次。`,
      });
      return;
    }
    res.json({
      page,
      eid: String(req.body?.eid || ''),
      text,
      html,
      // 单页预览不带页脚（同 pageService / imageService）。
      previewHtml: previewOf(deck, row, html),
    });
  } catch (e: any) {
    const code = e instanceof PageEditError ? 400 : 500;
    res.status(code).json({ error: e?.message || '这段文字没改上' });
  }
});

/**
 * 改一块文字的样式（颜色 / 字号 / 字重，**不调 AI、不花额度**）：他在预览里选中一块，
 * 点浮动条上的按钮，这里往库里那份 html 的那个开标签上写 inline style。
 *
 * 和 `edit-text` 同一套定位（`data-eid`）和同一条存法（`savePageEditedHtml`，只动 html 这一列）。
 * 校验全在 `applyStyleEdit`：调色板之外的颜色、越界的字号、认不出的属性**一律 400** ——
 * 静默忽略的话他点了按钮画面一点不变，看起来像按钮坏了，而接口回的是 200。
 */
pptRouter.post('/decks/:id/edit-style', (req: Request, res: Response) => {
  const t = editTarget(req, res, '，没有可以改的内容。');
  if (!t) return;
  const { owner, deck, page, row } = t;
  try {
    const { html, style } = applyStyleEdit(row.html, {
      eid: String(req.body?.eid || ''),
      style: (req.body?.style || {}) as Record<string, unknown>,
    });
    if (!savePageEditedHtml(deck.id, owner, { page, html })) {
      res.status(500).json({
        error: `第 ${page} 页没存上 —— 画面上是改过的样子，而库里还是原来那一版（拼整份和导出用的都是它）。刷新一下再改一次。`,
      });
      return;
    }
    res.json({
      page,
      eid: String(req.body?.eid || ''),
      style,
      html,
      previewHtml: previewOf(deck, row, html),
    });
  } catch (e: any) {
    const code = e instanceof PageEditError ? 400 : 500;
    res.status(code).json({ error: e?.message || '这一块的样式没改上' });
  }
});

/**
 * 改「一整块」的对齐（**不调 AI、不花额度**）：他往外选一层选中一个容器（比如 `display:flex`
 * 的那个左栏），点浮动条上的 ⤒ ⇕ ⤓，这里往那个容器的开标签上写 `align-items`。
 *
 * 和 `edit-style` 的区别只有定位：容器**没有 `data-eid`**（eid 只给「只装着一段文字」的元素），
 * 所以按「从 `<section>` 数下来的孩子下标路径」定位，再拿这一块里那串 eid 交叉核对一遍 ——
 * 不核的话浏览器和库里差一层时，样式写到了隔壁那一块上：页面照样渲染、接口 200，
 * 只是「他点的那一块没动、另一块动了」。
 */
/**
 * 按下标路径把他选中那一块切出来，**并拿前端那串 eid 交叉核对一遍**（`edit-region-style` 和
 * `delete-node` 共用一份 —— 各写一份的话哪天只在一处加了校验，另一条路照旧改/删隔壁那一块）。
 *
 * 不核的话：浏览器修正过结构（少一个闭标签、`<p>` 里塞了 `<div>`）时两边差一层，这次改动落在
 * 他没选的那一块上 —— 页面照样渲染、接口 200，只是「他点的那一块没动、另一块动了」。
 */
function pickRegion(html: string, body: any) {
  const raw = Array.isArray(body?.path) ? body.path : [];
  // 路径只收整数下标（同 ai-edit）：字符串进来的话 `children[?]` 取到 undefined，
  // 报的会是「这一块和库里对不上」—— 指错方向。
  const path = raw.map((x: unknown) => Number(x)).filter((n: number) => Number.isInteger(n) && n >= 0);
  const region = findRegionByPath(html, path);
  const want = (Array.isArray(body?.eids) ? body.eids : []).map((x: unknown) => String(x)).sort().join(',');
  const got = eidsIn(region.html).slice().sort().join(',');
  if (want !== got) {
    throw new PageEditError(
      `你选中的那一块和库里那一页对不上（这一页在这期间重新生成过或在别处改过）：` +
        `你那边是 ${want || '（没有文字块）'}，库里这一块是 ${got || '（没有文字块）'}。这次没改，刷新一下重新选。`
    );
  }
  return { path, region };
}

pptRouter.post('/decks/:id/edit-region-style', (req: Request, res: Response) => {
  const t = editTarget(req, res, '，没有可以改的内容。');
  if (!t) return;
  const { owner, deck, page, row } = t;
  try {
    const { path } = pickRegion(row.html, req.body);
    const { html, style, region: name, prev } = applyRegionStyle(row.html, {
      path,
      style: (req.body?.style || {}) as Record<string, unknown>,
    });
    if (!savePageEditedHtml(deck.id, owner, { page, html })) {
      res.status(500).json({
        error: `第 ${page} 页没存上 —— 画面上是改过的样子，而库里还是原来那一版（拼整份和导出用的都是它）。刷新一下再改一次。`,
      });
      return;
    }
    res.json({
      page,
      style,
      region: name,
      // 改之前那一条 inline 是什么（界面上要说出「取消掉的是 center」—— 不说的话那一整块
      // 变了样而他不知道该点回哪个键）。
      prev,
      html,
      previewHtml: previewOf(deck, row, html),
    });
  } catch (e: any) {
    const code = e instanceof PageEditError ? 400 : 500;
    res.status(code).json({ error: e?.message || '这一块的对齐没改上' });
  }
});

/**
 * 删掉选中的那一整块（**不调 AI、不花额度**）：他选中一段字或往外选一层选中一个容器，
 * 点浮动条上的 🗑，这里把库里那份 html 里的那一段整段剪掉。
 *
 * 定位、交叉核对、存法都和 `edit-region-style` 同一套（`pickRegion` + `savePageEditedHtml`，
 * 只动 html 这一列 —— 走生成那条存法会把配图记录和 problems 一起清掉：删一行字就把
 * 「3 张图都配好了」擦掉，而界面上只是「已删掉」）。
 *
 * 拒绝的四种（含图 / 整页 / 删空了 / 最后一段可编辑文字）全在 `applyDelete` 里，每一条的成因
 * 都要原样回给界面：合成一句「删不了」的话，「这一块有图」和「这一页只剩这一段字」下一步
 * 完全不同（前者去重新生成，后者压根不该删）。
 *
 * **撤销还没做**（下一片），所以前端那个确认框必须写明「删错了只能重新生成这一页（一次真实调用）」。
 */
pptRouter.post('/decks/:id/delete-node', (req: Request, res: Response) => {
  const t = editTarget(req, res, '，没有可以删的内容。');
  if (!t) return;
  const { owner, deck, page, row } = t;
  try {
    const { path } = pickRegion(row.html, req.body);
    const { html, removed } = applyDelete(row.html, { path });
    if (!savePageEditedHtml(deck.id, owner, { page, html })) {
      res.status(500).json({
        error: `第 ${page} 页没存上 —— 画面上那一块像是删掉了，而库里还在（拼整份和导出用的都是它）。刷新一下再删一次。`,
      });
      return;
    }
    res.json({
      page,
      removed,
      html,
      previewHtml: previewOf(deck, row, html),
    });
  } catch (e: any) {
    const code = e instanceof PageEditError ? 400 : 500;
    res.status(code).json({ error: e?.message || '这一块没删掉' });
  }
});

/**
 * 空白页画布上的摆放（**不调 AI、不花额度**）：加一个文字框 / 拖动缩放一块 / 删掉一块。
 *
 * 和上面那六条编辑同一套前置（`editTarget`：页序对账 + 这一页生成过）和同一条存法
 * （`savePageEditedHtml`，只动 html 这一列）。
 *
 * **「是不是空白页」的判据在 `canvasEdit` 里，按 html 里有没有 `.bl-canvas` 算，不按
 * `layout_id`**：要改的东西是 html，两处各判一次的话总有一处先放行 —— 往普通版式页上写
 * 绝对定位的块，那一行别的内容跟着塌，而接口 200、页面照样渲染。
 *
 * 认不出的 `op` 一律 400：静默当成「什么都不做」的话，前端拼错一个字之后画布上是「拖得动、
 * 松手就弹回去」，看起来像拖动这个功能坏了。
 */
pptRouter.post('/decks/:id/canvas', (req: Request, res: Response) => {
  const t = editTarget(req, res, '，没有可以摆的画布。');
  if (!t) return;
  const { owner, deck, page, row } = t;
  const op = String(req.body?.op || '');
  const bel = String(req.body?.bel || '');
  try {
    let html = row.html;
    let out: Record<string, unknown> = {};
    if (op === 'add-text') {
      const r = addCanvasText(html);
      html = r.html;
      out = { bel: r.bel, eid: r.eid, box: r.box };
    } else if (op === 'add-image') {
      // **只收 assetId、不收 url**：收 url 的话他能贴一个外站地址进来，导出的那份 html
      // 换台机器打开是一张裂图，而这边显示得好好的。挑别人的素材 id 也在这里挡掉
      // （`getAsset` 带租户键）—— 不挡的话那张图会出现在他的稿子里，接口 200。
      const asset = getAsset(String(req.body?.assetId || ''), owner);
      if (!asset) {
        res.status(404).json({ error: '素材库里没有这张图（或者不是你的）—— 刷新一下挑图那个抽屉再试。' });
        return;
      }
      const r = addCanvasImage(html, asset);
      html = r.html;
      out = { bel: r.bel, box: r.box, ratio: r.ratio, url: asset.url };
    } else if (op === 'box') {
      const r = setCanvasBox(html, {
        bel,
        box: {
          left: req.body?.left,
          top: req.body?.top,
          width: req.body?.width,
          height: req.body?.height,
        } as any,
      });
      html = r.html;
      out = { bel, box: r.box };
    } else if (op === 'delete') {
      html = deleteCanvasEl(html, { bel }).html;
      out = { bel };
    } else {
      res.status(400).json({ error: `认不出的画布操作「${op}」。这次没动。` });
      return;
    }
    if (!savePageEditedHtml(deck.id, owner, { page, html })) {
      res.status(500).json({
        error: `第 ${page} 页没存上 —— 画面上是你摆过的样子，而库里还是原来那一版（拼整份和导出用的都是它）。刷新一下再摆一次。`,
      });
      return;
    }
    res.json({ page, op, ...out, html, previewHtml: previewOf(deck, row, html) });
  } catch (e: any) {
    const code = e instanceof PageEditError ? 400 : 500;
    res.status(code).json({ error: e?.message || '这一块没摆上' });
  }
});

/**
 * AI 编辑选中的那一块（**一次真实调用**）：他框住一块，说一句「这三条排成两列」，
 * 模型只改结构和 inline style —— 文案发出去之前全打了码（`maskRegion`），它碰不到。
 *
 * 回来那一段过七条校验（`validateEditedRegion`），**任何一条不过就整段丢掉并说出成因**：
 * 存一段错的进去，画面上是一页读起来完全正常的幻灯片，而他后面照着它做完整份。
 */
pptRouter.post('/decks/:id/ai-edit', async (req: Request, res: Response) => {
  const t = editTarget(req, res, '，没有可以改的内容。');
  if (!t) return;
  const { owner, deck, page, row } = t;
  try {
    const raw = Array.isArray(req.body?.path) ? req.body.path : [];
    const result = await aiEditRegion(
      {
        html: row.html,
        // 路径只收整数下标：字符串进来的话 `children[?]` 取到 undefined，
        // 报的会是「这一块和库里对不上」—— 指错方向。
        path: raw.map((x: unknown) => Number(x)).filter((n: number) => Number.isInteger(n) && n >= 0),
        eids: (Array.isArray(req.body?.eids) ? req.body.eids : []).map((x: unknown) => String(x)),
        instruction: String(req.body?.instruction || ''),
      },
      owner.userId
    );
    if (!savePageEditedHtml(deck.id, owner, { page, html: result.html })) {
      res.status(500).json({
        error: `第 ${page} 页改出来了但没存上（这次调用已经花掉了）。刷新一下，别直接重试。`,
      });
      return;
    }
    res.json({
      page,
      summary: result.summary,
      region: result.region,
      html: result.html,
      previewHtml: previewOf(deck, row, result.html),
      usage: result.usage,
    });
  } catch (e: any) {
    sendPptError(res, e, e instanceof PageEditError, '这一块没改上');
  }
});

/**
 * 自由改造选中那一块（**一次真实调用**）：可以重排结构、新写文案、加图槽，不受案例库那条
 * 版式约束。和 `ai-edit` 分成两个端点、不做成一个 `mode` 开关：那两条路放开的规则不一样
 * （这边允许中文和删原文），一个开关传错值就会静默走另一条 —— 现象是「AI 怎么没照我说的改」。
 */
pptRouter.post('/decks/:id/ai-remake', async (req: Request, res: Response) => {
  const t = editTarget(req, res, '，没有可以改的内容。');
  if (!t) return;
  const { owner, deck, page, row } = t;
  try {
    const raw = Array.isArray(req.body?.path) ? req.body.path : [];
    const result = await aiRemakeRegion(
      {
        html: row.html,
        // 路径只收整数下标（同 ai-edit）：字符串进来的话报的会是「这一块和库里对不上」——指错方向。
        path: raw.map((x: unknown) => Number(x)).filter((n: number) => Number.isInteger(n) && n >= 0),
        eids: (Array.isArray(req.body?.eids) ? req.body.eids : []).map((x: unknown) => String(x)),
        instruction: String(req.body?.instruction || ''),
      },
      owner.userId
    );
    // 加/删了图槽之后配图记录要按新 html 重排一次（`realignImageRecords`）：图的序号是按
    // 出现顺序数的，不重排的话面板上写着「配图 1/1 张」而画面里全是占位图，或者下一次贴
    // 备好的图落到隔壁那一格上 —— 两种都是页面渲染完全正常、接口 200。
    const was = safeJson<FilledImage[]>(row.images_json || '', []);
    const re = realignImageRecords(result.html, was);
    // 规划里那份图位清单也要跟着对齐（和「生成这一页」走同一个 `specsFromSlots`：已有那几格
    // 连他改过的提示词一起原样留着，只按格数增删）。不对齐的话新加的那几格在界面上**根本
    // 不存在** —— 备图那一块按老清单画 1 格，而画面上是 2 个图槽，他只剩「配全部图」那条
    // 真花钱的路，且换一张要重花一次。
    const slots = findImageSlots(result.html);
    const planRow = planOf(deck).pages.find((p) => p.page === page);
    const sync = specsFromSlots(planRow?.imageSpecs || [], slots);
    let plan: { images: number; imageSpecs: typeof sync.specs } | undefined;
    if (sync.changed) {
      if (updatePlanPageImages(deck.id, owner, page, sync.specs).ok) {
        plan = { images: sync.specs.length, imageSpecs: sync.specs };
        // 格数变少时，落在新清单外面那几张**备好的**图（花过钱的）要当场点名：备图面板按新
        // 清单画，于是它们从界面上消失而库里还留着 —— 下一次生成这一页才会冒出一句「第 N 格
        // 备好的图没地方贴」，那时他对不回是这一次改造弄的。
        result.notes.push(
          ...orphanedPreparedNotes(
            safeJson<PreparedImage[]>(row.pending_images_json || '', []),
            sync.specs.length
          )
        );
      } else {
        // 存不上要说出来：界面上照旧是老清单，而他在面板上备的图会按错的格子号贴。
        result.notes.push(
          `这一页现在有 ${slots.length} 个图槽，但规划里那份清单没改上（还是 ${planRow?.imageSpecs?.length || 0} 格）——` +
            '刷新一下重新改一次；不改的话备图面板上多出来那几格没有入口，而画面上它们就在那儿。'
        );
      }
    }
    if (slots.length > sync.specs.length) {
      // 超过一页 6 格的那几格备不了图（清单按上限截了），而画面上它们和别的格子长得一样。
      result.notes.push(
        `这一页排出了 ${slots.length} 个图槽，超过一页 ${sync.specs.length} 格的上限 —— 第 ${sync.specs.length + 1} 格往后` +
          '备不了图、也换不了图（只能走「配全部图」那条真花钱的路）。改成少几格的排法更好。'
      );
    }
    if (!savePageEditedHtml(deck.id, owner, { page, html: result.html, images: re.changed ? re.images : undefined })) {
      res.status(500).json({
        error: `第 ${page} 页改出来了但没存上（这次调用已经花掉了）。刷新一下，别直接重试。`,
      });
      return;
    }
    res.json({
      page,
      summary: result.summary,
      // 「改了什么」逐条回给前端并且**必须显示出来**：丢掉的原文 / AI 新写的文案在这里，
      // 只显示 summary 的话那几条改动在画面上读起来完全正常（一眼看得见的那几种不在这里，
      // 见 `aiRemakeService` 头注）。
      notes: result.notes,
      region: result.region,
      html: result.html,
      previewHtml: previewOf(deck, row, result.html),
      // 重排过就把新的那份回给前端：不回的话面板上那份「配图 x/y 张」还是旧的，
      // 而库里已经是对的 —— 他要刷新一次才看得到真实的图况。
      images: re.changed ? re.images : undefined,
      // 对齐之后的图位清单（同「生成这一页」那条路）。**必须回**：前端手上那份规划还是老的，
      // 不覆盖的话备图那一块照旧按 1 格画，而画面上已经是 2 个图槽了。
      plan,
      usage: result.usage,
    });
  } catch (e: any) {
    sendPptError(res, e, e instanceof PageEditError, '这一块没改上');
  }
});

/** 浮动条上那几个色块 —— 前端不硬编码一份（两份漂开的话他点的那个颜色会被 400 拒掉）。 */
pptRouter.get('/edit-palette', (_req: Request, res: Response) => {
  res.json({ colors: COLOR_PALETTE });
});

/**
 * 给这份稿子的第 N 页配图：按每个图元素的 `data-img-prompt` 逐张生图，把占位图换成
 * 转存后的地址，**换好的 html 覆盖库里那一页**。
 *
 * html 从库里取，不收 body —— 收的话前端内存里那份（可能是重新生成前的旧版）会被配上图
 * 再存回去，那一页于是回退成上一版内容而图是新的，两边都不报错。
 * 部分成功是常态（一张失败别的照样贴上去），所以逐张回 `images`，失败的那几格保留占位图。
 */
pptRouter.post('/decks/:id/images', async (req: Request, res: Response) => {
  // 页序对账同「生成这一页」（098）：一页几张图就是几次真实花费，页序变过之后它们贴到别的一页上。
  const t = editTarget(req, res, '（先生成这一页，再生成它的图）。');
  if (!t) return;
  const { owner, deck, page, row } = t;
  const planRow = safeJson<{ pages?: PlannedPage[] }>(deck.plan_json, {}).pages?.find(
    (p) => p.page === page
  );
  try {
    const meta = shellMeta(deck);
    const result = await fillPageImages(row.html, {
      owner,
      title: planRow?.title || deck.title,
      section: planRow?.section || undefined,
      topic: meta.topic,
      force: !!req.body?.force,
      styleId: deck.style_id || undefined,
      meta,
      // 出处：素材库里那张卡要能说出「这是哪份稿子第几页生成的」，不然一堆图之外
      // 没有任何线索能对回去（同一句提示词在两份稿子里都用过）。
      deckId: deck.id,
      page,
      // 配完图那一眼的预览要带这一页的蒙版（097），否则「配了图之后蒙版没了」。
      veil: row.veil_opacity || 0,
    });
    // 对外接入（100）：这一次真的生了几张图就按几张扣。中间件只知道「来了一个请求」，扣的是 1
    // —— 不补差额的话生图这条路对第三方相当于打了 N 折（一次最多 4 张），而后台显示的用量是
    // 一个完全正常的数字。跳过的那几格（已经有图了）不算钱，所以不扣。
    if (req.sdkPk) {
      const generated = result.images.filter((img) => !img.skipped).length;
      chargeExtraPptSdkAiCalls(req.sdkPk, generated - 1);
    }
    // 部分成功也要存：那几张成功的图都是真花过钱的，不存等于让他再花一遍。
    const saved = savePageImages(deck.id, owner, {
      page,
      html: result.html,
      images: result.images,
      styleId: result.style?.id || deck.style_id,
      problems: row.problems_json ? safeJson<string[]>(row.problems_json, []) : [],
    });
    if (!saved) {
      res.status(500).json({
        error: `第 ${page} 页的图生成出来了但没存上（这几张已经花过钱了）。刷新一下再看，别直接重试。`,
      });
      return;
    }
    // 配好的图同时记进「备好的图」（`keepAsPrepared`）：不记的话「重新生成这一页」会把
    // 这几张付费图静默扔掉（回填只认 `pending_images_json`），界面上只是「这一页又要配图了」。
    const kept = keepAsPrepared(
      safeJson<PreparedImage[]>(row.pending_images_json || '', []),
      result.images,
      { styleId: result.style?.id || deck.style_id || '', prevStyleId: row.image_style_id || undefined }
    );
    if (!savePendingImages(deck.id, owner, { page, images: kept })) {
      // 图已经贴进这一页了（上面存过），只是没记成「备好的」—— 不说的话下一次重新生成
      // 这一页时它们会凭空消失，而那时看起来只是「这一页还没配图」。
      result.problems = [
        ...result.problems,
        '这几张图已经贴进这一页了，但没记成「备好的图」—— 现在重新生成这一页会把它们换回占位图（要重新花一次钱）。刷新一下再点一次「补齐这一页的图」（已经配好的那几格会跳过，不重复花钱）。',
      ];
    }
    res.json(result);
  } catch (e: any) {
    // 专属渠道缺 kind=image 那一档是 503（配置问题），不是 500 —— 合成 500 的话
    // 用户只会以为服务坏了，而真实解法是去后台补一条接入点。额度那一档到不了这里
    // （`fillPageImages` 逐格吞掉、回 `quotaExceeded`），走 `sendPptError` 只是为了
    // 万一哪天改成往外抛时不用记得再补一遍。
    sendPptError(res, e, e instanceof PptImageError, '生图失败');
  }
});

/**
 * 把这份稿子已生成的那几页拼成整份 deck（不调 AI）。**页从库里读**，前端不回传 ——
 * 回传的话它内存里那份（少一页、或者某页是配图前的旧版）就是拼出来的东西，
 * 而拼出来的 deck 翻起来完全正常。缺页时 400 并点名，见 `buildDeck`。
 */
pptRouter.post('/decks/:id/deck', (req: Request, res: Response) => {
  const owner = ownerOf(req, res);
  if (!owner) return;
  const deck = getDeck(req.params.id, owner);
  if (!deck) {
    res.status(404).json({ error: '这份演示稿不存在（或不是你的）' });
    return;
  }
  try {
    const rows = listPages(deck.id, owner).map((p) => ({ page: p.page, html: p.html, veil: p.veil_opacity || 0 }));
    const html = buildDeck(rows, deck.planned_total, shellMeta(deck));
    res.json({ html, pages: deck.planned_total });
  } catch (e: any) {
    const code = e instanceof PageError ? 400 : 500;
    res.status(code).json({ error: e?.message || '整份 deck 拼不出来' });
  }
});

/**
 * 导出整份 deck 成一个 .html 文件（不调 AI，页同样从库里读）。回 JSON 而不是直接下载：
 * 这份文件依赖什么（占位图没换 / 图在本机磁盘 / 字体走 CDN）必须能显示在界面上 ——
 * 直接回 attachment 的话那几句话没地方说，而用户拿到的是一份「打开一片正常、图全是破的」文件。
 *
 * `baseUrl` 由前端传 `location.origin`（图的相对地址要按它改成绝对地址）：服务端按
 * `req.protocol` 算的话，反代后面拿到的是 http 而用户访问的是 https —— 混合内容会被
 * 浏览器拦掉，而那几格看起来就是「没配图」。
 */
pptRouter.post('/decks/:id/export', (req: Request, res: Response) => {
  const owner = ownerOf(req, res);
  if (!owner) return;
  const deck = getDeck(req.params.id, owner);
  if (!deck) {
    res.status(404).json({ error: '这份演示稿不存在（或不是你的）' });
    return;
  }
  const baseUrl = String(req.body?.baseUrl || '').trim() || `${req.protocol}://${req.get('host')}`;
  try {
    const rows = listPages(deck.id, owner).map((p) => ({ page: p.page, html: p.html, veil: p.veil_opacity || 0 }));
    res.json(exportDeck(rows, deck.planned_total, shellMeta(deck), baseUrl));
  } catch (e: any) {
    const code = e instanceof ExportError || e instanceof PageError ? 400 : 500;
    res.status(code).json({ error: e?.message || '导出失败' });
  }
});

/** deck 级共享资料（:root 变量 + 通用组件 CSS、配色 token、配图风格）。 */
pptRouter.get('/library/assets', (_req: Request, res: Response) => {
  const lib = library();
  res.json({
    template: lib.template,
    design_tokens: lib.designTokens,
    illustration_style: lib.illustrationStyle,
  });
});
