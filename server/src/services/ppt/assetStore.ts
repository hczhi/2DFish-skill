import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../../db/index.js';

// PPT 素材库的读写（migration 090）。**所有查询都带 user_id** —— 少了它，换个账号
// 就能列到（甚至删掉）别人生成的图，而返回的是一份正常的列表，界面上一句错都没有。
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

export function listAssets(userId: string, limit = ASSETS_PAGE_SIZE): { assets: PptAsset[]; total: number } {
  const db = getDatabase();
  const total = (
    db.prepare('SELECT COUNT(*) AS n FROM ppt_assets WHERE user_id = ?').get(userId) as { n: number }
  ).n;
  const assets = db
    .prepare(
      `SELECT id, url, prompt, mode, style_id, ratio, model, storage, deck_id, page, created_at
         FROM ppt_assets WHERE user_id = ?
        ORDER BY created_at DESC LIMIT ?`
    )
    .all(userId, limit) as PptAsset[];
  // total 要一起回：只回前 120 张的话「素材库里就这些」和「这一页只装得下 120 张」
  // 在界面上分不开，而他会以为剩下的图丢了。
  return { assets, total };
}

/**
 * 取一条素材（备图那一步要按 id 挑图）。**带 user_id**：不带的话另一个账号的素材 id
 * 就能被备进这份稿子里，而界面上是一张正常的图。
 *
 * 找不到时回 null 由调用方明确拒 —— 拿不到就当成一个空 url 备上去的话，那一格在
 * 回填时是「这一格本来是空的」，没有一处会说他挑的那张已经被删了。
 */
export function getAsset(id: string, userId: string): PptAsset | null {
  return (
    (getDatabase()
      .prepare(
        `SELECT id, url, prompt, mode, style_id, ratio, model, storage, deck_id, page, created_at
           FROM ppt_assets WHERE id = ? AND user_id = ?`
      )
      .get(id, userId) as PptAsset | undefined) || null
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
  userId: string,
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
      `INSERT INTO ppt_assets
         (id, user_id, url, prompt, mode, style_id, ratio, model, storage, deck_id, page, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, url) DO NOTHING`
    )
    .run(
      uuidv4(),
      userId,
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
export function deleteAsset(id: string, userId: string): boolean {
  const r = getDatabase()
    .prepare('DELETE FROM ppt_assets WHERE id = ? AND user_id = ?')
    .run(id, userId);
  return r.changes > 0;
}
