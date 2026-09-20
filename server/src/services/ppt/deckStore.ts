import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../../db/index.js';
import { MAX_OUTLINE_CHARS, MAX_PAGES } from './planService.js';
import { type DesignSpec } from './designSpec.js';
import { type PptOwner, platformOwner, tenantSql, tenantArgs } from './tenant.js';
import { BLANK_LAYOUT_ID, BLANK_LAYOUT_NAME, BLANK_LAYOUT_TITLE, blankPageHtml } from './blankPage.js';

// 演示稿的读写（migration 089）。**所有查询都带归属键** —— 只按 id 取的话
// 换个账号带上别人的 deck id 就能读到（甚至改到）他那份稿子，而返回的是一份
// 正常的 deck，界面上一句错都没有。
//
// 归属键 = 租户 = `(绑定账号, 那把 pk)`，**一份**放在 `tenant.ts`（和素材库共用；各拼一遍的
// 话稿子按公司共用而素材按员工隔离，现象是「同事的稿子我打得开，里面那几张图我挑不到」）。
// `external_uid` 只记「这一份是谁建的」，不参与筛选 —— 同一家公司的员工要看得到彼此的稿子。

/** @deprecated 名字留着兼容既有调用（`api/ppt.ts` 和几个测试）；类型就是 {@link PptOwner}。 */
export type DeckOwner = PptOwner;
export { platformOwner };

export interface PptDeck {
  id: string;
  user_id: string;
  title: string;
  outline: string;
  brand_cn: string;
  brand_en: string;
  style_id: string;
  /** 整份统一的那段要求（093，字体/排版/语气）。每一页生成时都带上，和页级那段一起发。 */
  notes: string;
  /**
   * 整份的设计规范（096：配色/字体/疏密，见 `designSpec.ts`）。空串 = 默认那一套。
   * 它是靠覆盖 `:root` 生效的，所以改一次**已经生成的页刷新就变**，不用重新生成。
   */
  design_json: string;
  /** planService 的整份返回（JSON 字符串）。空串 = 还没规划过。 */
  plan_json: string;
  planned_total: number;
  /**
   * 页数/页序的版本号（098）。**每次结构改动 +1**，按页码写库的那几条路要带着它来
   * （见那份迁移的头注：不带的话一次三十秒的生成会写到别的一页上，而出来是一页正常的幻灯片）。
   */
  plan_rev: number;
  status: string;
  created_at: string;
  updated_at: string;
}

/** 名字上限。它只出现在列表和 deck 外壳上，超了直接拒（截断的话列表里两份稿子同名）。 */
export const MAX_TITLE_CHARS = 80;
/** 品牌名上限，和前端那两个 input 的 maxlength 一致。 */
export const MAX_BRAND_CHARS = 24;
/** 提纲上限就是规划那一步的上限（planService.MAX_OUTLINE_CHARS）—— 两处写两个数的话，
 *  存得进去而一点「开始规划」就被拒，用户看不出是哪一边的限制。 */
export const MAX_DECK_OUTLINE_CHARS = MAX_OUTLINE_CHARS;

/** 列表一行。带上「规划了几页 / 已生成几页 / 配了几页图」——
 *  这三个数是他判断「这份稿子干到哪了」的唯一依据，少了就只剩一个名字和时间。 */
export interface PptDeckRow {
  id: string;
  title: string;
  outline_chars: number;
  planned_total: number;
  built_count: number;
  imaged_count: number;
  brand_cn: string;
  style_id: string;
  /** 列表上也要显示配色（096）：只在设置面板里的话，「这几份稿子颜色为什么不一样」得逐份点开。 */
  design_json: string;
  created_at: string;
  updated_at: string;
}

export function listDecks(owner: DeckOwner): PptDeckRow[] {
  const db = getDatabase();
  return db
    .prepare(
      `SELECT d.id, d.title, d.planned_total, d.brand_cn, d.style_id, d.design_json, d.created_at, d.updated_at,
              LENGTH(d.outline) AS outline_chars,
              (SELECT COUNT(*) FROM ppt_deck_pages p
                WHERE p.deck_id = d.id AND p.html <> '') AS built_count,
              -- 「图配齐了的页数」= html 里已经没有占位图的那些页，**不是**「跑过配图的页数」：
              -- 跑过但全失败的那一页在预览里就是「这版设计得比较空」，算进去的话列表上
              -- 这个数字会说谎（他以为图都好了，转出去才发现半份是占位图）。
              (SELECT COUNT(*) FROM ppt_deck_pages p
                WHERE p.deck_id = d.id AND p.html LIKE '%data-img-prompt%'
                  AND p.html NOT LIKE '%/ppt-cases/ph-%') AS imaged_count
         FROM ppt_decks d
        WHERE ${tenantSql('d.')}
        ORDER BY d.updated_at DESC`
    )
    .all(...tenantArgs(owner)) as PptDeckRow[];
}

export function createDeck(
  owner: DeckOwner,
  data: {
    title: string; outline: string; brandCn?: string; brandEn?: string; styleId?: string;
    /** 设计规范（096）。**建稿时就定下来**：先生成十几页再定的话，那些页是按默认那套排的。 */
    design?: DesignSpec;
  }
): PptDeck {
  const db = getDatabase();
  const now = new Date().toISOString();
  const id = uuidv4();
  db.prepare(
    `INSERT INTO ppt_decks
       (id, user_id, sdk_pk, external_uid, title, outline, brand_cn, brand_en, style_id,
        design_json, plan_json, planned_total, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', 0, 'active', ?, ?)`
  ).run(
    id,
    ...tenantArgs(owner),
    // 建的人只记在这一列上（**不参与筛选**），同公司的同事要看得到这一份。
    owner.externalUid,
    data.title,
    data.outline,
    data.brandCn || '',
    data.brandEn || '',
    data.styleId || '',
    data.design ? JSON.stringify(data.design) : '',
    now,
    now
  );
  return getDeck(id, owner)!;
}

export function getDeck(id: string, owner: DeckOwner): PptDeck | null {
  const db = getDatabase();
  return (
    (db.prepare(`SELECT * FROM ppt_decks WHERE id = ? AND ${tenantSql()}`).get(id, ...tenantArgs(owner)) as
      | PptDeck
      | undefined) || null
  );
}

/**
 * 改这份稿子的元信息（名字 / 提纲 / 品牌 / 画风）。只更新**真的传了的**那几个字段：
 * 缺省成空串的话，任何一次只改名字的保存都会把提纲清空，而两边都回「已保存」。
 */
export function updateDeckMeta(
  id: string,
  owner: DeckOwner,
  data: {
    title?: string;
    outline?: string;
    brandCn?: string;
    brandEn?: string;
    styleId?: string;
    /** 整份统一的那段要求（093）。空串是合法值（= 他清掉了整份要求）。 */
    notes?: string;
    /** 设计规范（096）。改完不用重新生成 —— 已经生成的页靠 `:root` 覆盖跟着变。 */
    design?: DesignSpec;
  }
): boolean {
  const db = getDatabase();
  const sets: string[] = [];
  const args: unknown[] = [];
  const push = (col: string, v: string | undefined) => {
    if (v === undefined) return;
    sets.push(`${col} = ?`);
    args.push(v);
  };
  push('title', data.title);
  push('outline', data.outline);
  push('brand_cn', data.brandCn);
  push('brand_en', data.brandEn);
  push('style_id', data.styleId);
  push('notes', data.notes);
  push('design_json', data.design ? JSON.stringify(data.design) : undefined);
  if (!sets.length) return false;
  sets.push('updated_at = ?');
  args.push(new Date().toISOString(), id, ...tenantArgs(owner));
  const r = db
    .prepare(`UPDATE ppt_decks SET ${sets.join(', ')} WHERE id = ? AND ${tenantSql()}`)
    .run(...(args as any[]));
  return r.changes > 0;
}

/**
 * 存一次规划结果（整份 `PlanResult` 原样进 `plan_json`）。
 *
 * **同一个事务里把旧页清掉**：新规划的第 3 页很可能换了版式和内容，而上一版生成好的
 * 「第 3 页」会照旧挂在同一个页码下面 —— 拼出来的整份里那一页版式对不上内容，
 * 两边都不报错，翻起来只觉得「这页怪」。清页数要回给调用方并显示出来：
 * 那是十几次已经花掉的调用，不说的话他点「重新规划」时不知道自己在扔什么。
 */
export function savePlan(
  id: string,
  owner: DeckOwner,
  plan: { pages: unknown[]; problems?: string[]; usage?: unknown }
): { ok: boolean; clearedPages: number; clearedImages: number; clearedNotes: number } {
  const db = getDatabase();
  if (!getDeck(id, owner)) return { ok: false, clearedPages: 0, clearedImages: 0, clearedNotes: 0 };
  let cleared = 0;
  let clearedImages = 0;
  let clearedNotes = 0;
  const tx = db.transaction(() => {
    cleared = (
      db.prepare('SELECT COUNT(*) AS n FROM ppt_deck_pages WHERE deck_id = ? AND html <> \'\'').get(id) as {
        n: number;
      }
    ).n;
    // 备好的图也会跟着删（新规划的第 3 页和旧的第 3 页压根不是一页内容），**所以要数出来**：
    // 每一张都是一次真实花费，不说的话他不知道刚扔掉的是什么（那些图还在素材库里，
    // 可以重新挑回来 —— 这句话也得说，不然他会以为钱白花了）。
    clearedImages = (
      db.prepare(`SELECT pending_images_json AS j FROM ppt_deck_pages WHERE deck_id = ?`).all(id) as Array<{
        j: string;
      }>
    ).reduce((n, r) => n + countWithUrl(r.j), 0);
    // 他手写的那几段要求（092）也跟着删。**要数出来**：不说的话下一次生成拿到的是没带
    // 要求的那一版，而生成出来照样是一页完整的幻灯片 —— 「语气克制一点」一处都没生效，
    // 界面上也没有一处会提。
    clearedNotes = (
      db
        .prepare(`SELECT COUNT(*) AS n FROM ppt_deck_pages WHERE deck_id = ? AND setup_notes <> ''`)
        .get(id) as { n: number }
    ).n;
    db.prepare('DELETE FROM ppt_deck_pages WHERE deck_id = ?').run(id);
    // `plan_rev` 也 +1（098）：重新规划把页全清了，而上一刻发出去的「生成第 5 页」还在路上
    // —— 它回来时会照新规划的第 5 页插一行，版式和内容都不是那一页的，翻起来完全正常。
    db.prepare('UPDATE ppt_decks SET plan_json = ?, planned_total = ?, plan_rev = plan_rev + 1, updated_at = ? WHERE id = ?').run(
      JSON.stringify(plan),
      plan.pages.length,
      new Date().toISOString(),
      id
    );
  });
  tx();
  return { ok: true, clearedPages: cleared, clearedImages, clearedNotes };
}

/**
 * 改这一格图的提示词：写回 `plan_json` 里那一条 `imageSpecs[index-1].subject`。
 *
 * 三条是承重的：**必须写回库**（只留在前端的话，对话框里是他改过的那句，而下一次
 * 「AI 生成」/配图用的还是模型原来那句 —— 生出来是一张正常的图，只是不是他要的那张）；
 * **不能走 `savePlan`**（那个会把已生成的页全删掉，等于改一句提示词就扔掉十几次已经花过的
 * 调用，而界面上只是那几页变回「还没生成」）；**只动这一格**（整份覆盖的话另一格上刚改过的
 * 那句会被这次请求里的旧值顶回去，两边都回「已保存」）。
 */
export function updatePlanImageSubject(
  id: string,
  owner: DeckOwner,
  page: number,
  index: number,
  subject: string
): { ok: boolean; specs: Array<{ subject: string; mode: string; ratio: string }> } {
  return patchPlanImageSpec(id, owner, page, index, (spec) => {
    spec.subject = subject;
  });
}

/**
 * 改这一格**他自己改写的那一整条**提示词（`imageSpecs[index-1].fullPrompt`）。
 *
 * 空串 = 恢复成代码自动拼的那条，所以这里**把那个键删掉**而不是存一个空串：留着空串的话
 * 后面所有「有没有改写过」的判断都得记得多写一个 `.trim()`，漏一处那一格就永远显示着
 * 「整条已自定义」，而发出去的其实是自动拼的那条（界面和实际对不上，一处都不报错）。
 */
export function updatePlanImageFullPrompt(
  id: string,
  owner: DeckOwner,
  page: number,
  index: number,
  fullPrompt: string
): { ok: boolean; specs: Array<{ subject: string; mode: string; ratio: string }> } {
  return patchPlanImageSpec(id, owner, page, index, (spec) => {
    if (fullPrompt.trim()) spec.fullPrompt = fullPrompt;
    else delete spec.fullPrompt;
  });
}

/** 上面两条共用：只动 `plan_json` 里那一格，别的一个字不碰（见 `updatePlanImageSubject`）。 */
function patchPlanImageSpec(
  id: string,
  owner: DeckOwner,
  page: number,
  index: number,
  patch: (spec: any) => void
): { ok: boolean; specs: Array<{ subject: string; mode: string; ratio: string }> } {
  const deck = getDeck(id, owner);
  if (!deck) return { ok: false, specs: [] };
  let plan: any;
  try {
    plan = JSON.parse(deck.plan_json || '{}');
  } catch {
    return { ok: false, specs: [] };
  }
  const row = Array.isArray(plan?.pages) ? plan.pages.find((p: any) => Number(p?.page) === page) : null;
  const specs = Array.isArray(row?.imageSpecs) ? row.imageSpecs : null;
  if (!specs || !specs[index - 1]) return { ok: false, specs: [] };
  patch(specs[index - 1]);
  getDatabase()
    .prepare(`UPDATE ppt_decks SET plan_json = ?, updated_at = ? WHERE id = ? AND ${tenantSql()}`)
    .run(JSON.stringify(plan), new Date().toISOString(), id, ...tenantArgs(owner));
  return { ok: true, specs };
}

/**
 * 换掉这一页整份图位清单（`replanPageImages` 的结果写回 `plan_json`）。
 *
 * `images` 那个数**跟着一起写**：它是「这一页要几张图」的唯一显示来源，只改清单的话界面上
 * 写着 1 张、清单里列着 4 条，而两处都读起来正常（见 `PlannedPage.images` 的注释）。
 *
 * 同 `updatePlanImageSubject`：**不能走 `savePlan`**（那个会把已生成的页全删掉 —— 重排一次
 * 图位等于扔掉十几次已经花过的调用，而界面上只是那几页变回「还没生成」），**只动这一页**。
 */
export function updatePlanPageImages(
  id: string,
  owner: DeckOwner,
  page: number,
  specs: Array<{ subject: string; mode: string; ratio: string }>
): { ok: boolean } {
  const deck = getDeck(id, owner);
  if (!deck) return { ok: false };
  let plan: any;
  try {
    plan = JSON.parse(deck.plan_json || '{}');
  } catch {
    return { ok: false };
  }
  const row = Array.isArray(plan?.pages) ? plan.pages.find((p: any) => Number(p?.page) === page) : null;
  if (!row) return { ok: false };
  row.imageSpecs = specs;
  row.images = specs.length;
  getDatabase()
    .prepare(`UPDATE ppt_decks SET plan_json = ?, updated_at = ? WHERE id = ? AND ${tenantSql()}`)
    .run(JSON.stringify(plan), new Date().toISOString(), id, ...tenantArgs(owner));
  return { ok: true };
}

/** 这一页提纲的上限。超了一律**拒**（同 `MAX_PAGE_NOTES_CHARS` 的理由：截断的那几条
 *  照样生成出一页完整的幻灯片，只是他写的后半段一个字都没进去，也没有一处会说）。 */
export const MAX_PAGE_TITLE_CHARS = 60;
export const MAX_POINTS_PER_PAGE = 12;
export const MAX_POINT_CHARS = 200;
/** 这一页提纲**原文**的上限。整份提纲上限 `MAX_OUTLINE_CHARS`(12000)，一页给到 4000 字：
 *  再往上是他把整份提纲粘到一页里了，那一页排出来一定装不下（而它照样生成，只是内容被模型
 *  自己砍掉九成）。 */
export const MAX_PAGE_OUTLINE_CHARS = 4000;

/**
 * 改这一页的提纲：写回 `plan_json` 里那一条的 `title` / `points` / `outlineText`（提纲原文）。
 *
 * 和 `updatePlanImageSubject` 同样三条承重的理由，其中第二条最贵：**不能走 `savePlan`** ——
 * 那个会把这份稿子已生成的页全删掉，于是「改一下这一页的标题」等于扔掉十几次已经花过的
 * 调用，而界面上只是那几页变回「还没生成」。**只动这一页**（整份覆盖的话别的页上刚改过的
 * 提纲会被这次请求里的旧值顶回去，两边都回「已保存」）。
 *
 * 调用点只有「生成这一页」那一个（他要的就是「点了生成才存，没生成就不存」）—— 另开一个
 * 「保存提纲」的入口会多出一种状态：库里提纲是新的、画面是旧提纲生成的那一版，两边各自
 * 都读得通。
 *
 * `outlineText` 按 `!== undefined` 写（同 `upsertProvider` 那条）：写成
 * `row.outlineText = data.outlineText || ''` 的话，任何一次没带这个字段的编辑都会把原文
 * 悄悄清空，而生成出来照样是一页完整的幻灯片 —— 只是内容退回摘要那几句，提纲上的数字和
 * 机构名一个都不在，一处都不会说。**不重算 `outlineRange`**：那个只在规划那一步用
 * （`coverageWarnings`），行号和改过的原文对不上也不影响生成。
 */
export function updatePlanPageOutline(
  id: string,
  owner: DeckOwner,
  page: number,
  data: { title: string; points: string[]; outlineText?: string }
): { ok: boolean } {
  const deck = getDeck(id, owner);
  if (!deck) return { ok: false };
  let plan: any;
  try {
    plan = JSON.parse(deck.plan_json || '{}');
  } catch {
    return { ok: false };
  }
  const row = Array.isArray(plan?.pages) ? plan.pages.find((p: any) => Number(p?.page) === page) : null;
  if (!row) return { ok: false };
  row.title = data.title;
  row.points = data.points;
  if (data.outlineText !== undefined) row.outlineText = data.outlineText;
  getDatabase()
    .prepare(`UPDATE ppt_decks SET plan_json = ?, updated_at = ? WHERE id = ? AND ${tenantSql()}`)
    .run(JSON.stringify(plan), new Date().toISOString(), id, ...tenantArgs(owner));
  return { ok: true };
}

/**
 * 数「真的有图」的那几条。备好的图（`pending_images_json`）和配图结果（`images_json`）
 * 是同一个形状，**只有带 `url` 的才算**：失败的那几格也在数组里，一起数进去的话
 * 「这一页有 3 张图」里可能有两张在画面上是占位图（看起来只是「这版设计得比较空」）。
 */
function countWithUrl(json: string): number {
  if (!json) return 0;
  try {
    const rows = JSON.parse(json);
    return Array.isArray(rows) ? rows.filter((r: any) => r?.url).length : 0;
  } catch {
    return 0;
  }
}

/** 一页（`previewHtml` 不存，读的时候现拼 —— 见 089 的头注）。 */
export interface PptDeckPage {
  page: number;
  layout_id: string;
  html: string;
  images_json: string;
  image_style_id: string;
  problems_json: string;
  /** 生成 HTML 之前先备好的图（091）。和 `images_json` 是两回事，见那份迁移的头注。 */
  pending_images_json: string;
  /** 他自己挑的版式（092）。空 = 照规划那条。和 `layout_id`（这份 html 实际用的那条）是两回事。 */
  setup_layout_id: string;
  /** 他手写的额外要求（092，字体/排版/语气）。生成和重新生成都要带上。 */
  setup_notes: string;
  /**
   * 黑色蒙版的透明度（097，0 = 没有蒙版）。**不是 html 里的一段内联样式** ——
   * 存在列上，所以重新生成这一页之后它还在（写进 html 的话每次重生成都被覆盖掉，
   * 而界面上那个滑块还停在他调的位置）。拼装时由 `deckShell.applyVeil` 现贴。
   */
  veil_opacity: number;
  /**
   * 改成单图模式（poster）**之前**这一页的原样（104）。空串 = 这一页不是单图模式。
   * 「改回原版」照它写回去 —— 没有它的话唯一的退路是重新生成这一页（一次真实调用，
   * 而且版式和文案会重排成另一副样子）。
   */
  poster_from_html: string;
  /** 同上，变形之前那一页的配图记录（`images_json` 原文）。 */
  poster_from_images: string;
  updated_at: string;
}

export function listPages(deckId: string, owner: DeckOwner): PptDeckPage[] {
  const db = getDatabase();
  if (!getDeck(deckId, owner)) return [];
  return db
    .prepare(
      `SELECT page, layout_id, html, images_json, image_style_id, problems_json,
              pending_images_json, setup_layout_id, setup_notes, veil_opacity,
              poster_from_html, poster_from_images, updated_at
         FROM ppt_deck_pages WHERE deck_id = ? ORDER BY page`
    )
    .all(deckId) as PptDeckPage[];
}

/** deck 的 updated_at 跟着页动：不动的话列表按更新时间排序，刚生成了八页的那份还沉在底下。 */
function touchDeck(deckId: string) {
  getDatabase()
    .prepare('UPDATE ppt_decks SET updated_at = ? WHERE id = ?')
    .run(new Date().toISOString(), deckId);
}

/**
 * 存一页刚生成的 HTML（upsert）。
 *
 * **配图那两列缺省一起清掉**：重新生成 HTML 会把图槽位换回占位图，而 `images_json`
 * 留着的话界面上那一页照旧显示「图都配好了」，预览里却只是「这版设计得比较空」——
 * 两边都不报错，直到他把整份发出去。**唯一的例外是这次调用自己传进来的 `images`**：
 * 那是备好的图刚刚贴进这份 html 里的记录（091 → `applyPreparedImages`），和这份 html
 * 是同一时刻的东西，清掉的话界面上写着「还没配过图」而图就在页面里。
 */
export function savePageHtml(
  deckId: string,
  owner: DeckOwner,
  data: {
    page: number;
    layoutId: string;
    html: string;
    problems?: string[];
    /**
     * 这一次**贴进这份 html 里**的图（备好的图回填，见 `applyPreparedImages`）。
     * 不传就照旧清空 —— 缺省清空是上面那条约定，传进来的是「和这份 html 同一时刻的」记录，
     * 不是上一版留下的。不存的话界面上那一页写着「还没配过图」，而图明明已经在页面里，
     * 他会再点一次配图（那一步看到不是占位图会跳过，但「换一批图」就真的重花一遍）。
     */
    images?: unknown[];
    imageStyleId?: string;
  }
): boolean {
  const db = getDatabase();
  if (!getDeck(deckId, owner)) return false;
  const now = new Date().toISOString();
  // `pending_images_json` **不在下面这份 SET 里**（091）：备好的图是花过真钱的，而它
  // 存在于 HTML 之前 —— 跟着配图记录一起清掉的话，「重新生成这一页」会静默扔掉那几张，
  // 界面上只是「这一页又要重新配图了」。
  // `poster_from_*` 反过来**必须清掉**（104）：重新生成出来的是一页普通内容页，而那两列
  // 存着的是更早以前变成单图之前的样子 —— 留着的话「改回原版」会把这一页退回上上一版
  // （版式、文案全是旧的），而按钮上写的是「改回原版」，退回去之后也是一页正常的幻灯片。
  const imagesJson = data.images?.length ? JSON.stringify(data.images) : '';
  const styleId = data.images?.length ? data.imageStyleId || '' : '';
  db.prepare(
    `INSERT INTO ppt_deck_pages
       (id, deck_id, page, layout_id, html, images_json, image_style_id, problems_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(deck_id, page) DO UPDATE SET
       layout_id = excluded.layout_id,
       html = excluded.html,
       images_json = excluded.images_json,
       image_style_id = excluded.image_style_id,
       problems_json = excluded.problems_json,
       poster_from_html = '',
       poster_from_images = '',
       updated_at = excluded.updated_at`
  ).run(
    uuidv4(),
    deckId,
    data.page,
    data.layoutId,
    data.html,
    imagesJson,
    styleId,
    JSON.stringify(data.problems || []),
    now,
    now
  );
  touchDeck(deckId);
  return true;
}

/**
 * 存一页配好图之后的结果。**用返回的 html 覆盖那一页**（`imageService` 回的那份）——
 * 不覆盖的话拼整份用的还是占位图那一版，而预览里刚刚明明看到图了。
 *
 * 那一页还没生成过 HTML 时返回 false 而不是插一行：插的话库里会出现一行「有图没内容」的页，
 * 拼整份时它是一个空 `<section>`，翻起来像那一页渲染塌了。
 */
export function savePageImages(
  deckId: string,
  owner: DeckOwner,
  data: { page: number; html: string; images: unknown[]; styleId: string; problems?: string[] }
): boolean {
  const db = getDatabase();
  if (!getDeck(deckId, owner)) return false;
  const r = db
    .prepare(
      `UPDATE ppt_deck_pages
          SET html = ?, images_json = ?, image_style_id = ?, problems_json = ?, updated_at = ?
        WHERE deck_id = ? AND page = ? AND html <> ''`
    )
    .run(
      data.html,
      JSON.stringify(data.images || []),
      data.styleId || '',
      JSON.stringify(data.problems || []),
      new Date().toISOString(),
      deckId,
      data.page
    );
  if (!r.changes) return false;
  touchDeck(deckId);
  return true;
}

/**
 * 就地改文字之后把这一页的 html 写回去（**缺省只动 html 这一列**）。
 *
 * 不走 `savePageHtml`：那个会缺省清掉 `images_json` / `image_style_id` 并把 `problems_json`
 * 覆盖成空数组（重新生成才该那样）—— 改一个标题就把「这一页 3 张图都配好了」和
 * 「这一页版式有 2 处要注意」一起悄悄擦掉，界面上只是「已保存」。
 *
 * `images` **带了才写**（只有自由改造那条路会带）：那条路可以加/删图槽，图的序号跟着变，
 * 记录必须按新 html 重排一次（`realignImageRecords`）—— 不写的话面板上照旧写着
 * 「配图 1/1 张」并挂着缩略图，而画面里那几格全是占位图。反过来缺省就写空数组的话，
 * 每次改一个字都会把真花过钱的那几张记录擦掉（界面上只是「已保存」）。
 *
 * 那一页还没有 html 时返回 false（不插行）：插的话库里多一行「有文字没内容」的页，
 * 拼整份时它是个空 `<section>`，翻起来像那一页渲染塌了。
 */
export function savePageEditedHtml(
  deckId: string,
  owner: DeckOwner,
  data: { page: number; html: string; images?: unknown[] }
): boolean {
  const db = getDatabase();
  if (!getDeck(deckId, owner)) return false;
  const r = db
    .prepare(
      `UPDATE ppt_deck_pages SET html = ?, updated_at = ?${data.images ? ', images_json = ?' : ''}
        WHERE deck_id = ? AND page = ? AND html <> ''`
    )
    .run(
      data.html,
      new Date().toISOString(),
      ...(data.images ? [JSON.stringify(data.images)] : []),
      deckId,
      data.page
    );
  if (!r.changes) return false;
  touchDeck(deckId);
  return true;
}

/**
 * 改成单图模式（104）：新的 html + **同一句 SQL 里**把变形前那一页存进 `poster_from_*`。
 *
 * 两件事必须在同一次写里：分两次写的话中间那一下失败之后，库里是「一页单图 + 没有原样」
 * —— 界面上照旧显示「改回原版」那个按钮，点下去回的是一句「找不到原来那一版」，而这一页
 * 的文字已经没了（唯一的退路是重新生成，那是一次真实调用、版式和文案都会变）。
 *
 * `images_json` 清空：单图那一页现在是占位图，留着旧记录的话面板上挂着上一版的缩略图。
 * `problems_json` 不动（那是生成这一页时 `checkPage` 报的，和「把这一页改成单图」无关）。
 */
export function savePagePoster(
  deckId: string,
  owner: DeckOwner,
  data: { page: number; html: string; fromHtml: string; fromImages: string }
): boolean {
  const db = getDatabase();
  if (!getDeck(deckId, owner)) return false;
  const r = db
    .prepare(
      `UPDATE ppt_deck_pages
          SET html = ?, images_json = '',
              poster_from_html = ?, poster_from_images = ?, updated_at = ?
        WHERE deck_id = ? AND page = ? AND html <> ''`
    )
    .run(data.html, data.fromHtml, data.fromImages, new Date().toISOString(), deckId, data.page);
  if (!r.changes) return false;
  touchDeck(deckId);
  return true;
}

/**
 * 改回原版（104）：把 `poster_from_*` 那两列原样写回 html / `images_json`，并清空它们。
 *
 * **必须连 `images_json` 一起写回**：只写 html 的话页面里那几张图回来了而面板写着
 * 「还没配过图」—— 他会再点一次「换一批图」（那是真花一遍钱），而画面上本来就是对的。
 * 清空那两列是「这一页不再是单图模式」的唯一记号（html 里那个 `data-poster` 跟着一起走）。
 */
export function restorePagePoster(deckId: string, owner: DeckOwner, page: number): boolean {
  const db = getDatabase();
  if (!getDeck(deckId, owner)) return false;
  const r = db
    .prepare(
      `UPDATE ppt_deck_pages
          SET html = poster_from_html, images_json = poster_from_images,
              poster_from_html = '', poster_from_images = '', updated_at = ?
        WHERE deck_id = ? AND page = ? AND poster_from_html <> ''`
    )
    .run(new Date().toISOString(), deckId, page);
  if (!r.changes) return false;
  touchDeck(deckId);
  return true;
}

/**
 * 存这一页备好的图（091 `pending_images_json`，整份数组原样覆盖）。
 *
 * **允许那一页还没有 HTML**（备图就是要在生成 HTML 之前做）—— 所以这里是 upsert 而不是
 * UPDATE，插进来的行 `html = ''`。那种行不会被算成「已生成」（`built_count` 数的是
 * `html <> ''`），也不会被 `POST /decks/:id/images` 当成一页可以配图的内容。
 *
 * 整份覆盖而不是逐格 UPDATE：逐格改的话「取消这一格」得再写一条删除路径，而两条路
 * 各自维护同一个数组的下标，错位一次就是「第 1 格的图贴到了第 2 格」—— 图文不符，
 * 而页面渲染完全正常。
 */
export function savePendingImages(
  deckId: string,
  owner: DeckOwner,
  data: { page: number; images: unknown[] }
): boolean {
  const db = getDatabase();
  if (!getDeck(deckId, owner)) return false;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO ppt_deck_pages
       (id, deck_id, page, layout_id, html, images_json, image_style_id, problems_json,
        pending_images_json, created_at, updated_at)
     VALUES (?, ?, ?, '', '', '', '', '', ?, ?, ?)
     ON CONFLICT(deck_id, page) DO UPDATE SET
       pending_images_json = excluded.pending_images_json,
       updated_at = excluded.updated_at`
  ).run(uuidv4(), deckId, data.page, JSON.stringify(data.images || []), now, now);
  touchDeck(deckId);
  return true;
}

/** 手写要求的上限（**整份那段和页级那段同一个数**）。超了**拒**，不截断：截掉的半句话
 *  照样发给模型，而他写在后面的那条要求（「最后一屏别写总结」）一处都不会生效，也没有一处
 *  会说。两处两个数的话，整份里写得下的那段复制到某一页会被拒，而他看不出是哪一边的限制。 */
export const MAX_PAGE_NOTES_CHARS = 500;

/**
 * 存这一页「生成前改的那些」（092：他挑的版式 + 手写要求）。
 *
 * **允许那一页还没有 HTML**（改设置就是在生成之前做的），所以是 upsert，插进来的行
 * `html = ''` —— 那种行不算「已生成」（`built_count` 数的是 `html <> ''`）。
 *
 * 只写**真的传了的**那两个字段：缺省成空串的话，任何一次只换版式的操作都会把他写的那段
 * 要求清掉，而下一次生成出来照样是一页完整的幻灯片（要求没生效，一处都不说）。
 *
 * `layout_id` 这一列**不动**：那是「现在这份 html 用哪条版式排的」，在这里跟着改的话，
 * 换了版式而还没生成（或生成失败）时界面上写着新版式、画面里是旧版式排的那一版 ——
 * 两版都是一页正常的幻灯片，看不出来。
 */
export function savePageSetup(
  deckId: string,
  owner: DeckOwner,
  data: { page: number; layoutId?: string; notes?: string }
): boolean {
  const db = getDatabase();
  if (!getDeck(deckId, owner)) return false;
  if (data.layoutId === undefined && data.notes === undefined) return false;
  const now = new Date().toISOString();
  const sets: string[] = [];
  const args: unknown[] = [];
  if (data.layoutId !== undefined) {
    sets.push('setup_layout_id = ?');
    args.push(data.layoutId);
  }
  if (data.notes !== undefined) {
    sets.push('setup_notes = ?');
    args.push(data.notes);
  }
  db.prepare(
    `INSERT INTO ppt_deck_pages
       (id, deck_id, page, layout_id, html, images_json, image_style_id, problems_json,
        pending_images_json, setup_layout_id, setup_notes, created_at, updated_at)
     VALUES (?, ?, ?, '', '', '', '', '', '', ?, ?, ?, ?)
     ON CONFLICT(deck_id, page) DO UPDATE SET
       ${sets.join(', ')},
       updated_at = ?`
  ).run(
    uuidv4(),
    deckId,
    data.page,
    data.layoutId || '',
    data.notes || '',
    now,
    now,
    ...(args as any[]),
    now
  );
  touchDeck(deckId);
  return true;
}

/**
 * 存一页的蒙版透明度（097）。
 *
 * upsert：这一页可能还没生成过（他先调暗再生成），插不进去的话保存那一下没声音、
 * 生成出来的那一页没有蒙版，而滑块停在他拖的位置。
 *
 * **不碰 html 和配图那几列**：蒙版是拼装时贴的，改它不该让「这一页配好的图」消失。
 */
export function savePageVeil(
  deckId: string,
  owner: DeckOwner,
  data: { page: number; opacity: number }
): boolean {
  const db = getDatabase();
  if (!getDeck(deckId, owner)) return false;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO ppt_deck_pages
       (id, deck_id, page, layout_id, html, images_json, image_style_id, problems_json,
        pending_images_json, setup_layout_id, setup_notes, veil_opacity, created_at, updated_at)
     VALUES (?, ?, ?, '', '', '', '', '', '', '', '', ?, ?, ?)
     ON CONFLICT(deck_id, page) DO UPDATE SET
       veil_opacity = excluded.veil_opacity,
       updated_at = excluded.updated_at`
  ).run(uuidv4(), deckId, data.page, data.opacity, now, now);
  touchDeck(deckId);
  return true;
}

/** 结构改动（删页 / 加页 / 调顺序）拒绝执行时抛这个，带着原因给用户看。 */
export class DeckStructureError extends Error {}

/**
 * 规划改过结构之后，`plan.problems` 里那几条**跨页**提示（「第 3–4 页连续同版式」、
 * 「封面挑了正文版式」）说的是改之前那个顺序 —— 它们读起来仍然像是这份稿子现在的问题，
 * 而指的那两页已经不在那儿了（页码对不上，也没有一处会说）。所以在最前面标一句。
 * 已经标过就不再标：不判的话删几页就攒几条一模一样的提示。
 */
const STALE_PLAN_NOTE =
  '（这份规划之后改过页数/页序，下面这几条跨页提示是规划那一刻算的，可能已经不准。）';
function markStalePlan(problems: unknown): string[] {
  const list = Array.isArray(problems) ? (problems.filter((x) => typeof x === 'string') as string[]) : [];
  if (!list.length || list.includes(STALE_PLAN_NOTE)) return list;
  return [STALE_PLAN_NOTE, ...list];
}

export interface PageDeleteResult {
  /** 改完的整份规划（前端照它重画左边那列，不本地 splice —— 见下面第 ③ 条）。 */
  plan: any;
  /** 改完的页序版本号（098）。前端要换上它，不换的话下一次生成会 409。 */
  planRev: number;
  /** 这一页身上被一起扔掉的东西，**逐类报数**（每一项都是花过真钱的）。 */
  removed: { html: boolean; images: number; prepared: number; notes: boolean; veil: boolean };
  /** 跟着往前挪了一位的页数。 */
  shifted: number;
}

/**
 * 删一页：`plan_json` 里那一条 + `ppt_deck_pages` 那一行，后面的页码整体往前挪一位。
 *
 * 四条是承重的：
 *
 * ① **搬的是「行的页码」，不是行里的内容。** html / 备好的图 / 蒙版 / 他手写的要求全在同一行上，
 *    所以 `UPDATE … SET page = …` 一句就把一整页的状态整体搬走了。反过来（挨个把内容往前挪一行）
 *    的话，漏掉任何一列都是「那一页的图/蒙版/要求留在了原地」，而每一页显示出来都是一页
 *    正常的幻灯片。
 * ② **重编页码要两段式（先翻成负数再落最终值）。** 直接 `page = page - 1` 的话中途会撞
 *    `UNIQUE(deck_id, page)`（SQLite 逐行检查，行的处理顺序不是页码顺序），撞上那一刻整条
 *    语句失败 —— 而这时删除那一句已经跑过：库里少一页、后面的页码一个都没动，于是中间空出
 *    一个页码，前端按规划的页码去取那几页全部错位一页。
 * ③ **`plan_json` 和页表在同一个事务里改。** 分两次写的话中间任何一次失败都留下「规划里
 *    12 页、库里的页码还按 13 页排」的库，而界面上翻起来完全正常，只是每一页的画面比标题
 *    错开一位。
 * ④ **`plan_rev` 跟着 +1**（098）：上一刻发出去的那次生成必须被拒掉，否则它回来时写到的是
 *    现在的第 N 页 —— 一次真实花费换来一页照着别的提纲排的幻灯片。
 *
 * 最后一页不给删：删完之后 `plan_json` 里是个空数组、`planned_total = 0`，界面上和「还没
 * 规划过」一模一样（而提纲还在），他会以为规划丢了。
 */
export function deletePage(deckId: string, owner: DeckOwner, page: number): PageDeleteResult {
  const db = getDatabase();
  const deck = getDeck(deckId, owner);
  if (!deck) throw new DeckStructureError('这份演示稿不存在（或不是你的）');
  let plan: any;
  try {
    plan = JSON.parse(deck.plan_json || '{}');
  } catch {
    // 读不出来时**不能**当成空规划接着删：那样页表被改了而规划没有，成了 ③ 那种库。
    throw new DeckStructureError(
      '这份稿子存着的规划读不出来（plan_json 坏了），这一页没删 —— 删一页要连着改规划，只改一边会让页码和规划错开一位。'
    );
  }
  const list: any[] | null = Array.isArray(plan?.pages) ? plan.pages : null;
  if (!list?.length) throw new DeckStructureError('这份稿子还没有规划，没有页可以删。');
  const idx = list.findIndex((p: any) => Number(p?.page) === page);
  if (idx < 0) {
    throw new DeckStructureError(
      `第 ${page} 页不在这份稿子的规划里（规划只有 ${list.length} 页）。刷新一下看看规划是不是换过了。`
    );
  }
  if (list.length === 1) {
    throw new DeckStructureError(
      '整份只剩这一页了，不能删 —— 删完之后这份稿子看起来和「还没规划过」一模一样（提纲还在）。要清空请点「重新规划」。'
    );
  }
  const row = db
    .prepare(
      `SELECT html, images_json, pending_images_json, setup_notes, veil_opacity
         FROM ppt_deck_pages WHERE deck_id = ? AND page = ?`
    )
    .get(deckId, page) as
    | { html: string; images_json: string; pending_images_json: string; setup_notes: string; veil_opacity: number }
    | undefined;
  const removed = {
    html: !!row?.html,
    images: countWithUrl(row?.images_json || ''),
    prepared: countWithUrl(row?.pending_images_json || ''),
    notes: !!row?.setup_notes,
    veil: !!row?.veil_opacity,
  };
  let shifted = 0;
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM ppt_deck_pages WHERE deck_id = ? AND page = ?').run(deckId, page);
    // ② 两段式。负页码只在这个事务里存在（外面任何一处读到负页码都说明这里中断过）。
    db.prepare('UPDATE ppt_deck_pages SET page = -page WHERE deck_id = ? AND page > ?').run(deckId, page);
    shifted = db
      .prepare('UPDATE ppt_deck_pages SET page = -page - 1 WHERE deck_id = ? AND page < 0')
      .run(deckId).changes;
    list.splice(idx, 1);
    // 页码按数组顺序重编（硬规则 3：会算错的格式在代码里算，不留给别处推断）。
    list.forEach((p: any, i: number) => {
      p.page = i + 1;
    });
    plan.problems = markStalePlan(plan.problems);
    db.prepare(
      `UPDATE ppt_decks SET plan_json = ?, planned_total = ?, plan_rev = plan_rev + 1, updated_at = ?
        WHERE id = ?`
    ).run(JSON.stringify(plan), list.length, new Date().toISOString(), deckId);
  });
  tx();
  return { plan, planRev: deck.plan_rev + 1, removed, shifted };
}

export interface PageInsertInput {
  /** 插在第几页**后面**（0 = 插到最前面）。 */
  after: number;
  title: string;
  /** 这一页的要点。空白页不传（传了会被拒 —— 见下面 `blank`）。 */
  points?: string[];
  /** 他挑的版式。不传 = 跟着插入位置前一页那条（见下面第 ③ 条）。 */
  layoutId?: string;
  /**
   * 插一页**空白页**（自己往上摆文字和图，见 `blankPage.ts`）。
   *
   * 和上面那条路两处不一样，各治一种「看起来完全正常」的失败：**不要要点**（空白页不进
   * 任何 prompt，收了那几条等于让他写一段永远不会出现在页面上的字）、**插进来就带 html**
   * （不带的话它是「未生成」，「生成剩下的 N 页」会花一次真实调用把画布换成一页版式排出来的
   * 幻灯片）。
   */
  blank?: boolean;
}

export interface PageInsertResult {
  plan: any;
  planRev: number;
  /** 新那一页的页码（= `after + 1`，由这里算，不让调用方猜 —— 硬规则 3）。 */
  page: number;
  /** 跟着往后挪了一位的页数。 */
  shifted: number;
  /** 新那一页最终用的版式和模块名（都是这里算出来的，界面上要照原样说出来）。 */
  layoutId: string;
  section: string;
  /** 版式是继承前后页来的（他没挑）—— 前端必须据此把「去挑一条」这句话说出来。 */
  layoutInherited: boolean;
  /** 这一页是空白页（已经带着 html 落库了）—— 前端据此**不要**去开「生成前确认」那个框。 */
  blank: boolean;
}

/**
 * 插一页（`plan_json` 里多一条，`ppt_deck_pages` 里**不建行** —— 新页还没生成，
 * 建一行空 html 的话它在「已生成」那几处会被当成生成过、预览里是一块白）。
 *
 * 和 `deletePage` 镜像的三条（理由见那边 ①②③）：搬的是「行的页码」不是行里的内容、
 * 重编页码走两段式负数绕开 `UNIQUE(deck_id, page)`、`plan_json` 和页表同一个事务、
 * `plan_rev` 跟着 +1（在路上那次生成必须被拒，否则它回来时写到的是现在的另一页）。
 *
 * 另外三条是这边独有的：
 * ① **`page` 由数组顺序重编，不信调用方给的数**（硬规则 3）。
 * ② **`kind` 留空、`why` 写明是他自己插的、`alts` 空**。`kind` 编一个（比如照前一页填
 *    「章节扉页」）的话 `kindWarnings` 会拿它去核版式挑得对不对 —— 核的是一个没人说过的
 *    前提，出来的警告读起来完全正常；`why` 写成模型口气的一句话（「这一页承接上文」）
 *    的话，他往后翻回来会以为这一页是规划出来的。
 * ③ **`layoutId` 没挑时继承前一页（没有前一页就取后一页）**，并把 `layoutInherited`
 *    回出去。悄悄回落成某条固定版式（L1）的话，插进来的那一页排出来是一页完整的幻灯片，
 *    而他压根没挑过这条 —— 而继承前一页会撞「连续同版式 ≤2 页」那条规范，所以必须让界面
 *    催他去挑一条。库里一条版式都认不出来时（清单换过、规划是旧的）也回空串让上层拒掉，
 *    因为空版式生成出来是「模型自己看着办」的一页。
 * ④ **`images: 0` / `imageSpecs: []`**：新页不配图。凭空给几格的话备图面板上挂着几个
 *    没人定过内容的图位，他备完图生成出来贴不进去（版式的图位数是另一回事）。
 *    图位是在生成之后按真的排出来的图槽补上的（`specsFromSlots`，不花钱）；在那之前想先备图，
 *    就在「生成前改一下」里换一条版式 —— 点生成会自动先重排一次图位（一次真实调用）。
 */
export function insertPage(deckId: string, owner: DeckOwner, input: PageInsertInput): PageInsertResult {
  const db = getDatabase();
  const deck = getDeck(deckId, owner);
  if (!deck) throw new DeckStructureError('这份演示稿不存在（或不是你的）');
  let plan: any;
  try {
    plan = JSON.parse(deck.plan_json || '{}');
  } catch {
    throw new DeckStructureError(
      '这份稿子存着的规划读不出来（plan_json 坏了），这一页没插进去 —— 插一页要连着改规划，只改一边会让页码和规划错开一位。'
    );
  }
  const list: any[] | null = Array.isArray(plan?.pages) ? plan.pages : null;
  if (!list?.length) {
    throw new DeckStructureError('这份稿子还没有规划，插不了页 —— 先点「开始规划」，那一步会按提纲分页。');
  }
  const after = Number(input.after);
  if (!Number.isInteger(after) || after < 0 || after > list.length) {
    throw new DeckStructureError(
      `插入位置不对（第 ${input.after} 页之后），这份稿子现在一共 ${list.length} 页。刷新一下看看页数是不是变了。`
    );
  }
  if (list.length >= MAX_PAGES) {
    throw new DeckStructureError(
      `这份稿子已经 ${list.length} 页，到上限 ${MAX_PAGES} 页了 —— 再插的话规划、生成、导出那几处对页数的假设都不成立。要加内容请先删掉几页。`
    );
  }
  const blank = !!input.blank;
  const title = (input.title || '').trim();
  const points = (input.points || []).map((p) => String(p ?? '').trim()).filter(Boolean);
  // 这两条和 `updatePlanPageOutline` 用的是同一套上限（各写一套的话这一条路能插进去一页
  // 超长的提纲，而改提纲那条路拒它 —— 生成出来是被版式裁掉半截的一页）。
  // 空白页也要标题：那是缩略图和「整份目录」上这一页唯一的名字（空着的话左边那一栏里它是
  // 一格「(这一页没标题)」的灰卡，和「这一页渲染塌了」分不开）。
  if (!title) throw new DeckStructureError('新这一页的标题是空的 —— 生成出来会是一页没有标题的幻灯片，看起来像版式本来就这样。');
  if (title.length > MAX_PAGE_TITLE_CHARS) {
    throw new DeckStructureError(`标题有 ${title.length} 字，上限 ${MAX_PAGE_TITLE_CHARS} 字（版式里标题就那么大一块，再长会挤成一团或被裁掉）。`);
  }
  // 空白页收了要点也没地方用（它不进任何 prompt、也不会排到页面上）—— 静默扔掉的话他写的
  // 那几条在界面上从此不存在，而这一页插得好好的。
  if (blank && points.length) {
    throw new DeckStructureError('空白页不吃要点 —— 那几条不会出现在页面上（空白页不走 AI 生成，内容全靠你自己往画布上摆）。要按要点排的话插一页普通的。');
  }
  if (blank && (input.layoutId || '').trim()) {
    throw new DeckStructureError('空白页不挑版式（它就是一张空画布）—— 要用案例库里那条版式的话插一页普通的。');
  }
  if (!blank && !points.length) {
    throw new DeckStructureError('新这一页一条要点都没有 —— 只给标题的话模型会自己编这一页的内容，出来那一页读着通顺但不是你的东西。至少写一条。');
  }
  if (points.length > MAX_POINTS_PER_PAGE) {
    throw new DeckStructureError(`这一页有 ${points.length} 条要点，上限 ${MAX_POINTS_PER_PAGE} 条。拆成两页更好排。`);
  }
  const long = points.findIndex((p) => p.length > MAX_POINT_CHARS);
  if (long >= 0) {
    throw new DeckStructureError(`第 ${long + 1} 条要点有 ${points[long].length} 字，上限 ${MAX_POINT_CHARS} 字 —— 一条要点是一行字，太长会被版式裁掉。`);
  }
  const prev = after > 0 ? list[after - 1] : null;
  const next = list[after] || null;
  const picked = (input.layoutId || '').trim().toUpperCase();
  const layoutId = blank ? BLANK_LAYOUT_ID : picked || String(prev?.layoutId || next?.layoutId || '');
  if (!layoutId) {
    throw new DeckStructureError('这一页没有版式（前后页也读不出来），插不进去 —— 没有版式的话生成那一步是「模型自己看着办」，出来一页和这份稿子不是一套设计。');
  }
  // 模块名（`.slide-header .kicker`）跟着前一页 —— 在这一章里插一页是常态。空着的话
  // 生成出来那一页顶上少一行，读起来像「这个版式没有模块名」。
  // **空白页一律空着**：那条页眉带是生成那一步贴上去的，空白页压根没有那一步 ——
  // 填了的话左边缩略图上这一页挂着一个模块名，而画面上从来没有它。
  const section = blank ? '' : String(prev?.section || next?.section || '');
  const page = after + 1;
  const now = new Date().toISOString();
  let shifted = 0;
  const tx = db.transaction(() => {
    db.prepare('UPDATE ppt_deck_pages SET page = -page WHERE deck_id = ? AND page >= ?').run(deckId, page);
    shifted = db
      .prepare('UPDATE ppt_deck_pages SET page = -page + 1 WHERE deck_id = ? AND page < 0')
      .run(deckId).changes;
    // 空白页**在这里就把 html 落进去**（上面那条腾出来的空位）：不落的话它是「未生成」，
    // 「生成剩下的 N 页」会把它算进去 —— 一次真实调用，出来是一页按案例库版式排的幻灯片，
    // 而他摆的东西全没了（读起来完全正常，只是不是他那一页）。
    if (blank) {
      db.prepare(
        `INSERT INTO ppt_deck_pages
           (id, deck_id, page, layout_id, html, images_json, image_style_id, problems_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, '', '', '[]', ?, ?)`
      ).run(uuidv4(), deckId, page, BLANK_LAYOUT_ID, blankPageHtml(), now, now);
    }
    list.splice(after, 0, {
      page,
      section,
      kind: '',
      title,
      points,
      layoutId,
      why: blank
        ? '你自己插的空白页 —— 内容靠你往画布上摆，不走 AI 生成。'
        : picked
          ? '你自己插的一页，版式是你挑的。'
          : '你自己插的一页，版式先跟着前后页 —— 记得挑一条。',
      alts: [],
      images: 0,
      imageSpecs: [],
      // 界面上那三行（版式名 / 中文标题 / demo 链接）**跟着页一起存**：前端读的就是
      // `plan_json`（规划那一步也是这么存的）。空白页没有 demo，`demoUrl` 必须留空 ——
      // 随便指一条的话点开是别人的版式 demo，而他会以为空白页就长那样。
      ...(blank
        ? { layoutName: BLANK_LAYOUT_NAME, layoutTitle: BLANK_LAYOUT_TITLE, fullbleed: false, demoUrl: '' }
        : {}),
    });
    list.forEach((p: any, i: number) => {
      p.page = i + 1;
    });
    plan.problems = markStalePlan(plan.problems);
    db.prepare(
      `UPDATE ppt_decks SET plan_json = ?, planned_total = ?, plan_rev = plan_rev + 1, updated_at = ?
        WHERE id = ?`
    ).run(JSON.stringify(plan), list.length, now, deckId);
  });
  tx();
  return { plan, planRev: deck.plan_rev + 1, page, shifted, layoutId, section, layoutInherited: !blank && !picked, blank };
}

/**
 * 删一份稿子。页那张表要自己清 —— db/index.ts 没开 PRAGMA foreign_keys，
 * REFERENCES 只是注释，留下的孤儿页不报错，但会被列表里那几个计数一直算进去
 * （删掉的稿子不见了，而下次同 id 建一份就会带着一批别人的页）。
 */
export function deleteDeck(id: string, owner: DeckOwner): boolean {
  const db = getDatabase();
  if (!getDeck(id, owner)) return false;
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM ppt_deck_pages WHERE deck_id = ?').run(id);
    db.prepare('DELETE FROM ppt_decks WHERE id = ?').run(id);
  });
  tx();
  return true;
}
