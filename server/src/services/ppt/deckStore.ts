import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../../db/index.js';
import { MAX_OUTLINE_CHARS } from './planService.js';

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
  created_at: string;
  updated_at: string;
}

export function listDecks(userId: string): PptDeckRow[] {
  const db = getDatabase();
  return db
    .prepare(
      `SELECT d.id, d.title, d.planned_total, d.brand_cn, d.style_id, d.created_at, d.updated_at,
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
  data: { title: string; outline: string; brandCn?: string; brandEn?: string; styleId?: string }
): PptDeck {
  const db = getDatabase();
  const now = new Date().toISOString();
  const id = uuidv4();
  db.prepare(
    `INSERT INTO ppt_decks
       (id, user_id, title, outline, brand_cn, brand_en, style_id, plan_json, planned_total,
        status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, '', 0, 'active', ?, ?)`
  ).run(
    id,
    userId,
    data.title,
    data.outline,
    data.brandCn || '',
    data.brandEn || '',
    data.styleId || '',
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
  data: { title?: string; outline?: string; brandCn?: string; brandEn?: string; styleId?: string }
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
  if (!sets.length) return false;
  sets.push('updated_at = ?');
  args.push(new Date().toISOString(), id, userId);
  const r = db
    .prepare(`UPDATE ppt_decks SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`)
    .run(...(args as any[]));
  return r.changes > 0;
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
