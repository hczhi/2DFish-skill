import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../../db/index.js';
import { MAX_OUTLINE_CHARS } from './planService.js';
import { type DesignSpec } from './designSpec.js';

// 演示稿的读写（migration 089）。**所有查询都带 user_id** —— 只按 id 取的话
// 换个账号带上别人的 deck id 就能读到（甚至改到）他那份稿子，而返回的是一份
// 正常的 deck，界面上一句错都没有。

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

export function listDecks(userId: string): PptDeckRow[] {
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
        WHERE d.user_id = ?
        ORDER BY d.updated_at DESC`
    )
    .all(userId) as PptDeckRow[];
}

export function createDeck(
  userId: string,
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
       (id, user_id, title, outline, brand_cn, brand_en, style_id, design_json, plan_json,
        planned_total, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', 0, 'active', ?, ?)`
  ).run(
    id,
    userId,
    data.title,
    data.outline,
    data.brandCn || '',
    data.brandEn || '',
    data.styleId || '',
    data.design ? JSON.stringify(data.design) : '',
    now,
    now
  );
  return getDeck(id, userId)!;
}

export function getDeck(id: string, userId: string): PptDeck | null {
  const db = getDatabase();
  return (
    (db.prepare('SELECT * FROM ppt_decks WHERE id = ? AND user_id = ?').get(id, userId) as
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
  userId: string,
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
  args.push(new Date().toISOString(), id, userId);
  const r = db
    .prepare(`UPDATE ppt_decks SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`)
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
  userId: string,
  plan: { pages: unknown[]; problems?: string[]; usage?: unknown }
): { ok: boolean; clearedPages: number; clearedImages: number; clearedNotes: number } {
  const db = getDatabase();
  if (!getDeck(id, userId)) return { ok: false, clearedPages: 0, clearedImages: 0, clearedNotes: 0 };
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
    ).reduce((n, r) => n + countPending(r.j), 0);
    // 他手写的那几段要求（092）也跟着删。**要数出来**：不说的话下一次生成拿到的是没带
    // 要求的那一版，而生成出来照样是一页完整的幻灯片 —— 「语气克制一点」一处都没生效，
    // 界面上也没有一处会提。
    clearedNotes = (
      db
        .prepare(`SELECT COUNT(*) AS n FROM ppt_deck_pages WHERE deck_id = ? AND setup_notes <> ''`)
        .get(id) as { n: number }
    ).n;
    db.prepare('DELETE FROM ppt_deck_pages WHERE deck_id = ?').run(id);
    db.prepare('UPDATE ppt_decks SET plan_json = ?, planned_total = ?, updated_at = ? WHERE id = ?').run(
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
  userId: string,
  page: number,
  index: number,
  subject: string
): { ok: boolean; specs: Array<{ subject: string; mode: string; ratio: string }> } {
  const deck = getDeck(id, userId);
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
  specs[index - 1].subject = subject;
  getDatabase()
    .prepare('UPDATE ppt_decks SET plan_json = ?, updated_at = ? WHERE id = ? AND user_id = ?')
    .run(JSON.stringify(plan), new Date().toISOString(), id, userId);
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
  userId: string,
  page: number,
  specs: Array<{ subject: string; mode: string; ratio: string }>
): { ok: boolean } {
  const deck = getDeck(id, userId);
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
    .prepare('UPDATE ppt_decks SET plan_json = ?, updated_at = ? WHERE id = ? AND user_id = ?')
    .run(JSON.stringify(plan), new Date().toISOString(), id, userId);
  return { ok: true };
}

/** 这一页提纲的上限。超了一律**拒**（同 `MAX_PAGE_NOTES_CHARS` 的理由：截断的那几条
 *  照样生成出一页完整的幻灯片，只是他写的后半段一个字都没进去，也没有一处会说）。 */
export const MAX_PAGE_TITLE_CHARS = 60;
export const MAX_POINTS_PER_PAGE = 12;
export const MAX_POINT_CHARS = 200;

/**
 * 改这一页的提纲：写回 `plan_json` 里那一条的 `title` / `points`。
 *
 * 和 `updatePlanImageSubject` 同样三条承重的理由，其中第二条最贵：**不能走 `savePlan`** ——
 * 那个会把这份稿子已生成的页全删掉，于是「改一下这一页的标题」等于扔掉十几次已经花过的
 * 调用，而界面上只是那几页变回「还没生成」。**只动这一页**（整份覆盖的话别的页上刚改过的
 * 提纲会被这次请求里的旧值顶回去，两边都回「已保存」）。
 *
 * 调用点只有「生成这一页」那一个（他要的就是「点了生成才存，没生成就不存」）—— 另开一个
 * 「保存提纲」的入口会多出一种状态：库里提纲是新的、画面是旧提纲生成的那一版，两边各自
 * 都读得通。
 */
export function updatePlanPageOutline(
  id: string,
  userId: string,
  page: number,
  data: { title: string; points: string[] }
): { ok: boolean } {
  const deck = getDeck(id, userId);
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
  getDatabase()
    .prepare('UPDATE ppt_decks SET plan_json = ?, updated_at = ? WHERE id = ? AND user_id = ?')
    .run(JSON.stringify(plan), new Date().toISOString(), id, userId);
  return { ok: true };
}

function countPending(json: string): number {
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
  updated_at: string;
}

export function listPages(deckId: string, userId: string): PptDeckPage[] {
  const db = getDatabase();
  if (!getDeck(deckId, userId)) return [];
  return db
    .prepare(
      `SELECT page, layout_id, html, images_json, image_style_id, problems_json,
              pending_images_json, setup_layout_id, setup_notes, veil_opacity, updated_at
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
  userId: string,
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
  if (!getDeck(deckId, userId)) return false;
  const now = new Date().toISOString();
  // `pending_images_json` **不在下面这份 SET 里**（091）：备好的图是花过真钱的，而它
  // 存在于 HTML 之前 —— 跟着配图记录一起清掉的话，「重新生成这一页」会静默扔掉那几张，
  // 界面上只是「这一页又要重新配图了」。
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
  userId: string,
  data: { page: number; html: string; images: unknown[]; styleId: string; problems?: string[] }
): boolean {
  const db = getDatabase();
  if (!getDeck(deckId, userId)) return false;
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
 * 就地改文字之后把这一页的 html 写回去（**只动 html 这一列**）。
 *
 * 不走 `savePageHtml`：那个会缺省清掉 `images_json` / `image_style_id` 并把 `problems_json`
 * 覆盖成空数组（重新生成才该那样）—— 改一个标题就把「这一页 3 张图都配好了」和
 * 「这一页版式有 2 处要注意」一起悄悄擦掉，界面上只是「已保存」。
 *
 * 那一页还没有 html 时返回 false（不插行）：插的话库里多一行「有文字没内容」的页，
 * 拼整份时它是个空 `<section>`，翻起来像那一页渲染塌了。
 */
export function savePageEditedHtml(
  deckId: string,
  userId: string,
  data: { page: number; html: string }
): boolean {
  const db = getDatabase();
  if (!getDeck(deckId, userId)) return false;
  const r = db
    .prepare(
      `UPDATE ppt_deck_pages SET html = ?, updated_at = ?
        WHERE deck_id = ? AND page = ? AND html <> ''`
    )
    .run(data.html, new Date().toISOString(), deckId, data.page);
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
  userId: string,
  data: { page: number; images: unknown[] }
): boolean {
  const db = getDatabase();
  if (!getDeck(deckId, userId)) return false;
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
  userId: string,
  data: { page: number; layoutId?: string; notes?: string }
): boolean {
  const db = getDatabase();
  if (!getDeck(deckId, userId)) return false;
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
  userId: string,
  data: { page: number; opacity: number }
): boolean {
  const db = getDatabase();
  if (!getDeck(deckId, userId)) return false;
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

/**
 * 删一份稿子。页那张表要自己清 —— db/index.ts 没开 PRAGMA foreign_keys，
 * REFERENCES 只是注释，留下的孤儿页不报错，但会被列表里那几个计数一直算进去
 * （删掉的稿子不见了，而下次同 id 建一份就会带着一批别人的页）。
 */
export function deleteDeck(id: string, userId: string): boolean {
  const db = getDatabase();
  if (!getDeck(id, userId)) return false;
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM ppt_deck_pages WHERE deck_id = ?').run(id);
    db.prepare('DELETE FROM ppt_decks WHERE id = ?').run(id);
  });
  tx();
  return true;
}
