import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../../db/index.js';
import { type PptOwner, tenantSql, tenantArgs } from './tenant.js';

// PPT 素材库的读写（migration 090/101）。**所有查询都带归属键** —— 少了它，换个账号
// 就能列到（甚至删掉）别人生成的图，而返回的是一份正常的列表，界面上一句错都没有。
//
// 归属键 = 租户 = **一家公司** = `(绑定账号, 那把 pk)`，判定和稿子共用同一份
// （`tenant.ts`）：素材按员工隔离而稿子按公司共用的话，现象是「同事的稿子我打得开，
// 里面那几张图我在挑图抽屉里找不到」，两边都不报错。`external_uid` 只记「谁生成的」。
//
// 写入点只有一个：`imageService` 里每张图**转存成功之后**（见那里的 `rememberAsset`）。
// 在生图成功前就写的话，素材库里会出现一批点开是破图的卡片，而它们和「COS 挂了」
// 长得一样；写在 api 层的话，撞额度中断的那几张（前面成功的图）就进不了库 ——
// 而那几张是真花过钱的。

export interface PptAsset {
  id: string;
  url: string;
  prompt: string;
  mode: string;
  style_id: string;
  ratio: string;
  model: string;
  storage: string;
  deck_id: string;
  page: number;
  created_at: string;
}

/** 列表一次最多回多少张。素材是累积的，全量回的话几百张图的 json 会把这个页面拖住。 */
export const ASSETS_PAGE_SIZE = 120;

/** 「没记归属」那一组（`deck_id = ''`）在接口上的值。见 `listAssets` 的注释。 */
export const ASSETS_NO_DECK = '__none__';

/**
 * 我的素材，可**按稿子筛**（素材库累积到几百张之后，不分项目那一页就是一堵图墙）。
 *
 * 筛选**必须在 SQL 里做**，不能在前端拿这 120 张再过滤：那样「这个项目就 3 张」和
 * 「这个项目的图都在第 120 张之后」在界面上完全一样 —— 一个看起来完整的项目图库，
 * 而他真正要重用的那几张根本不在里面，一处都不会说。同理 `total` 是**这一组的**总数。
 *
 * `deckId` 传 `''` / 不传 = 全部；传 `ASSETS_NO_DECK` 才是「没记归属」那一组
 * （`deck_id = ''`）。用一个哨兵值而不是空串：空串当成「没筛」的话，点那个 tab 会回
 * 全部素材，而 tab 是选中的 —— 读起来就是「这一组有三百张」。
 */
export function listAssets(
  owner: PptOwner,
  opts: { deckId?: string; limit?: number } = {}
): { assets: PptAsset[]; total: number } {
  const db = getDatabase();
  const limit = opts.limit ?? ASSETS_PAGE_SIZE;
  const deckId = opts.deckId === ASSETS_NO_DECK ? '' : opts.deckId || '';
  const byDeck = !!deckId || opts.deckId === ASSETS_NO_DECK;
  const where = byDeck ? `${tenantSql()} AND deck_id = ?` : tenantSql();
  const args: Array<string | null> = byDeck ? [...tenantArgs(owner), deckId] : [...tenantArgs(owner)];
  const total = (
    db.prepare(`SELECT COUNT(*) AS n FROM ppt_assets WHERE ${where}`).get(...args) as { n: number }
  ).n;
  const assets = db
    .prepare(
      `SELECT id, url, prompt, mode, style_id, ratio, model, storage, deck_id, page, created_at
         FROM ppt_assets WHERE ${where}
        ORDER BY created_at DESC LIMIT ?`
    )
    .all(...args, limit) as PptAsset[];
  // total 要一起回：只回前 120 张的话「素材库里就这些」和「这一页只装得下 120 张」
  // 在界面上分不开，而他会以为剩下的图丢了。
  return { assets, total };
}

export interface AssetGroup {
  /** `''` = 没记归属（接口上要用 `ASSETS_NO_DECK` 去筛它）。 */
  deckId: string;
  /** 那份稿子现在的名字；稿子已经删了就是空串（前端要标出来，见下）。 */
  title: string;
  /** 稿子还在不在。删了的**照旧要出现在 tab 里** —— 过滤掉的话那几十张图从每个 tab
   *  里都消失了，看起来像被删过，而它们还在库里、url 也还能用。 */
  deckGone: boolean;
  count: number;
  lastAt: string;
}

/**
 * 按稿子分组的张数（tab 条用它画）。
 *
 * **张数按整张表算，不是按上面那 120 张算**：拿页内数据统计的话每个 tab 上的数字都偏小，
 * 而它读起来完全正常（「这个项目 3 张」），他会以为那个项目的图丢了。
 * 所以这里单独一条 `GROUP BY`，不复用列表那次查询。
 */
export function assetGroups(owner: PptOwner): AssetGroup[] {
  const rows = getDatabase()
    .prepare(
      `SELECT a.deck_id AS deckId, COUNT(*) AS count, MAX(a.created_at) AS lastAt,
              d.id AS foundId, d.title AS title
         FROM ppt_assets a
         -- JOIN 也要带 sdk_pk（列之间同样用 NULL 安全的 IS）：只按 user_id 接的话，
         -- 同一个账号下另一个租户里恰好有同 id 的稿子时会接上它的标题
         LEFT JOIN ppt_decks d ON d.id = a.deck_id AND d.user_id IS a.user_id AND d.sdk_pk IS a.sdk_pk
        WHERE ${tenantSql('a.')}
        GROUP BY a.deck_id
        ORDER BY lastAt DESC`
    )
    .all(...tenantArgs(owner)) as Array<{ deckId: string; count: number; lastAt: string; foundId: string | null; title: string | null }>;
  return rows.map((r) => ({
    deckId: r.deckId || '',
    title: r.title || '',
    // 按 `d.id` 判，不按 `title` 判：标题本来就可能是空串，那时「稿子删了」和
    // 「这份稿子没名字」会混成一个，而前端两种写的话是两句不同的提示。
    deckGone: !!r.deckId && !r.foundId,
    count: r.count,
    lastAt: r.lastAt || '',
  }));
}

/**
 * 取一条素材（备图那一步要按 id 挑图）。**带归属键**：不带的话别的租户的素材 id
 * 就能被备进这份稿子里，而界面上是一张正常的图。
 *
 * 找不到时回 null 由调用方明确拒 —— 拿不到就当成一个空 url 备上去的话，那一格在
 * 回填时是「这一格本来是空的」，没有一处会说他挑的那张已经被删了。
 */
export function getAsset(id: string, owner: PptOwner): PptAsset | null {
  return (
    (getDatabase()
      .prepare(
        `SELECT id, url, prompt, mode, style_id, ratio, model, storage, deck_id, page, created_at
           FROM ppt_assets WHERE id = ? AND ${tenantSql()}`
      )
      .get(id, ...tenantArgs(owner)) as PptAsset | undefined) || null
  );
}

/**
 * 按 url 取一条。上传接口用它把「刚记进去的那一条」整个回给前端（`rememberAsset` 只回
 * 成没成，不回 id），前端要拿那个 id 立刻把这张图贴进正在挑的那一格。
 *
 * 查不到时调用方必须喊出来：图已经存进 COS 了而库里没有这一行，素材库里看不到它 ——
 * 他会以为「上传失败」再传一遍，而每传一遍都在桶里多留一份孤儿文件。
 */
export function findAssetByUrl(owner: PptOwner, url: string): PptAsset | null {
  return (
    (getDatabase()
      .prepare(
        `SELECT id, url, prompt, mode, style_id, ratio, model, storage, deck_id, page, created_at
           FROM ppt_assets WHERE ${tenantSql()} AND url = ?`
      )
      .get(...tenantArgs(owner), url) as PptAsset | undefined) || null
  );
}

/**
 * 记一张图进素材库。
 *
 * 同一个 url 只留一行（`UNIQUE(user_id, url)`）：重复插的话列表里出现两张一样的卡，
 * 他删掉一张以为清掉了，刷新后那张图还在，看起来像删除没生效。
 *
 * **失败要抛**，由调用方决定怎么说出来 —— 生图那一步不能因为这里失败而整页报错
 * （图已经生成、钱已经花了），但也绝不能静默：静默的话素材库里少了几张，而他只会
 * 以为「这批图没存进去是正常的」，下次重用时再花一次钱。
 */
export function rememberAsset(
  owner: PptOwner,
  data: {
    url: string;
    prompt?: string;
    mode?: string;
    styleId?: string;
    ratio?: string;
    model?: string;
    storage?: string;
    deckId?: string;
    page?: number;
  }
): boolean {
  const db = getDatabase();
  const r = db
    .prepare(
      // 去重键仍是 `UNIQUE(user_id, url)`（不含 sdk_pk）—— 见 101 的头注：
      // 加上 sdk_pk 之后 NULL 互不相等，网页登录那批行同一个 url 能重复插进去。
      `INSERT INTO ppt_assets
         (id, user_id, sdk_pk, external_uid, url, prompt, mode, style_id, ratio, model, storage, deck_id, page, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, url) DO NOTHING`
    )
    .run(
      uuidv4(),
      ...tenantArgs(owner),
      // 生成这一张的人，只用来显示，不参与筛选（同公司的同事要挑得到）
      owner.externalUid,
      data.url,
      data.prompt || '',
      data.mode || '',
      data.styleId || '',
      data.ratio || '',
      data.model || '',
      data.storage || '',
      data.deckId || '',
      data.page || 0,
      new Date().toISOString()
    );
  return r.changes > 0;
}

/**
 * 删一条素材。**只删这一行**：COS 上的文件不动，已经用了这张图的那几页 html 也不动。
 *
 * 所以界面上必须写清楚「稿子里那几页还会照旧显示这张图」—— 不写的话他会以为这是
 * 「把这张图从稿子里去掉」，删完去翻那份 deck，图还在，而这边刚回了一句「已删除」。
 * 反过来真去删 COS 文件的话，正在用它的那几页立刻变破图，而那几页看起来只是「没配图」。
 */
export function deleteAsset(id: string, owner: PptOwner): boolean {
  const r = getDatabase()
    .prepare(`DELETE FROM ppt_assets WHERE id = ? AND ${tenantSql()}`)
    .run(id, ...tenantArgs(owner));
  return r.changes > 0;
}
