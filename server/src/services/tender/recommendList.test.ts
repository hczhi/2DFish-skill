import { describe, it, expect, beforeEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { initDatabase, getDatabase } from '../../db/index.js';
import { listRecommendations, staleRecommendations } from './recommendList.js';
import { TENDER_VISIBLE_DAYS } from './retention.js';

// 推荐列表过不过时效闸门，在屏幕上是看不出来的：一条 16 天前入库的标讯，只要它当初
// 评了个高分，排序（total_score DESC）就把它钉在最前面，卡片和今天新评出来的长得
// 一模一样。用户侧列表 /list、飞书卡片、多维表格重灌全都过闸门 —— 只有这条路径
// （网页推荐页 + SDK 挂在外站的「投标资讯」）漏了，于是同一个人在两个地方看到的
// 不是一批东西，两边都不报错。
initDatabase();

const USER = 'user-rec-list';
{
  const now = new Date().toISOString();
  getDatabase()
    .prepare(
      `INSERT INTO user (id, username, password_hash, role, created_at, updated_at)
       VALUES (?, 'rec-lister', 'x', 'user', ?, ?)`
    )
    .run(USER, now, now);
}

function seedTender(daysAgo: number): string {
  const db = getDatabase();
  const id = uuidv4();
  const at = new Date(Date.now() - daysAgo * 86400_000);
  db.prepare(
    `INSERT INTO tenders (id, platform, notice_id, content_hash, title, publish_date, deadline,
                          budget, budget_amount, purchaser_name, content_text, url, keyword, status, created_at)
     VALUES (?, 'gdgpo', ?, ?, ?, ?, '', '', 500000, '某公司', '整合营销', '', '整合营销', 'scored', ?)`
  ).run(id, id, `hash-${id}`, `${daysAgo} 天前入库的标讯`, at.toISOString().slice(0, 10), at.toISOString());
  return id;
}

function seedRec(tenderId: string, score: number): void {
  getDatabase()
    .prepare(
      `INSERT INTO tender_recommendations (id, user_id, tender_id, total_score, tier, created_at)
       VALUES (?, ?, ?, ?, 'high', ?)`
    )
    .run(uuidv4(), USER, tenderId, score, new Date().toISOString());
}

beforeEach(() => {
  const db = getDatabase();
  db.exec('DELETE FROM tender_recommendations');
  db.exec('DELETE FROM tenders');
});

describe('推荐列表', () => {
  it('过时效闸门 —— 旧标讯的高分推荐不再钉在最前面', () => {
    // 评分时间都是今天（原来的条件 `r.created_at >= -20 days` 对两条都成立），
    // 差别只在标讯自己的入库/发布日期。
    seedRec(seedTender(TENDER_VISIBLE_DAYS + 9), 92);
    const fresh = seedTender(1);
    seedRec(fresh, 60);

    const { items, total } = listRecommendations({ userId: USER, pageSize: 20, offset: 0 });

    expect(total).toBe(1);
    expect(items.map((i) => i.tender_id)).toEqual([fresh]);
  });

  it('总数和明细同源 —— 不会出现「共 N 条」配一张空白页', () => {
    // 两条查询的 where 和 JOIN 曾经不一致（明细带 JOIN tenders、总数不带），
    // 于是界面上写着总数、翻页翻出来是空的，一句错都不报。
    for (let i = 0; i < 3; i++) seedRec(seedTender(TENDER_VISIBLE_DAYS + 3), 80);
    seedRec(seedTender(2), 70);

    const { items, total } = listRecommendations({ userId: USER, pageSize: 20, offset: 0 });

    expect(total).toBe(items.length);
  });
});

describe('重评名单', () => {
  it('不把已过时效的标讯选进来（选进来会被删掉且评不回来）', () => {
    // 调用方是「先 DELETE 旧记录、再交给 runRecommendationsForAllUsers 评」，
    // 而那边过闸门 —— 过期的那条一条都评不出来，于是记录被静默删掉、
    // 接口回 rescored:0，用户接着点，每点一次再删一批。两次点击都显示成功。
    seedRec(seedTender(TENDER_VISIBLE_DAYS + 5), 90);
    const fresh = seedTender(1);
    seedRec(fresh, 50);

    expect(staleRecommendations(USER, 'profile-changed-at')).toEqual([fresh]);
  });
});
