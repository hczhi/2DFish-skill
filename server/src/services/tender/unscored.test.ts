import { describe, it, expect, beforeEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { initDatabase, getDatabase } from '../../db/index.js';
import { loadUnscoredForUser, countUnscoredForUser } from './recommendService.js';
import { TENDER_VISIBLE_DAYS } from './retention.js';

initDatabase();

const USER_A = 'user-a';
const USER_B = 'user-b';

// tender_recommendations.user_id 有外键指向 user，不建用户插不进推荐行。
// 不用 INSERT OR IGNORE —— 它会把 updated_at 的 NOT NULL 违约一起吞掉，
// 于是用户压根没建，而报出来的错是下游的 FOREIGN KEY constraint failed。
for (const [id, name] of [[USER_A, 'alice'], [USER_B, 'bob']]) {
  const now = new Date().toISOString();
  getDatabase()
    .prepare(
      `INSERT INTO user (id, username, password_hash, role, created_at, updated_at)
       VALUES (?, ?, 'x', 'user', ?, ?)`
    )
    .run(id, name, now, now);
}

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10);
}

function seedTender(opts: {
  title: string;
  platform?: string;
  publishDate?: string;
  status?: string;
}): string {
  const db = getDatabase();
  const id = uuidv4();
  db.prepare(
    `INSERT INTO tenders (id, platform, notice_id, content_hash, title, publish_date, deadline,
                          budget, budget_amount, purchaser_name, content_text, url, keyword, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, '', '', 0, '', '', '', '', ?, ?)`
  ).run(
    id,
    opts.platform ?? 'gdgpo',
    id,
    `hash-${id}`,
    opts.title,
    opts.publishDate ?? daysAgo(1),
    opts.status ?? 'extracted',
    new Date().toISOString()
  );
  return id;
}

function seedRecommendation(userId: string, tenderId: string, tier = 'consider') {
  getDatabase()
    .prepare(
      `INSERT INTO tender_recommendations (id, user_id, tender_id, total_score, tier, created_at)
       VALUES (?, ?, ?, 70, ?, ?)`
    )
    .run(uuidv4(), userId, tenderId, tier, new Date().toISOString());
}

const titles = (rows: { title: string }[]) => rows.map((r) => r.title).sort();

beforeEach(() => {
  const db = getDatabase();
  db.exec('DELETE FROM tender_recommendations');
  db.exec('DELETE FROM tenders');
});

describe('取「该用户未评分的标讯」', () => {
  it('已评过的不再出现，未评过的都出现', () => {
    const scored = seedTender({ title: '已评过' });
    seedTender({ title: '没评过1' });
    seedTender({ title: '没评过2' });
    seedRecommendation(USER_A, scored);

    expect(titles(loadUnscoredForUser(USER_A, [], 100))).toEqual(['没评过1', '没评过2']);
    expect(countUnscoredForUser(USER_A, [])).toBe(2);
  });

  it('候选是 per-user 的：甲评过的对乙仍算未评分', () => {
    // 这是「按用户评分」的核心。共用一份候选列表就必然漏掉一边。
    const t = seedTender({ title: '同一条标讯' });
    seedRecommendation(USER_A, t);

    expect(loadUnscoredForUser(USER_A, [], 100)).toHaveLength(0);
    expect(titles(loadUnscoredForUser(USER_B, [], 100))).toEqual(['同一条标讯']);
  });

  it('初筛档（tier=filter）也算已评过，不会每轮重复评', () => {
    // filter 档是没走 LLM 就落的行，但它同样是「评过了」——
    // 不算的话每轮都会把这些重新走一遍初筛，处理条数永远降不下来。
    const t = seedTender({ title: '初筛掉的' });
    seedRecommendation(USER_A, t, 'filter');
    expect(loadUnscoredForUser(USER_A, [], 100)).toHaveLength(0);
  });

  it('第 50 名之后的标讯照样取得到 —— 原来 LIMIT 50 把它们永久挡在外面', () => {
    // 这是这次改造要修的那个 bug：原实现是全局 ORDER BY publish_date DESC LIMIT 50，
    // 前 50 条评完之后，后面的每轮都被 LIMIT 挡住，既不评分也不推送，
    // 而且随着新标讯入库越积越多。实测两个用户各有 60 / 59 条卡在边界外。
    const ids: string[] = [];
    for (let i = 0; i < 70; i++) {
      ids.push(seedTender({ title: `t${String(i).padStart(2, '0')}`, publishDate: daysAgo(1) }));
    }
    // 先评掉 50 条，模拟「老逻辑跑过一轮」的状态
    ids.slice(0, 50).forEach((id) => seedRecommendation(USER_A, id));

    const rest = loadUnscoredForUser(USER_A, [], 100);
    expect(rest).toHaveLength(20);
    expect(countUnscoredForUser(USER_A, [])).toBe(20);
  });

  it('14 天闸门同样管住这里：过期标讯不进候选', () => {
    seedTender({ title: '还在窗口内', publishDate: daysAgo(TENDER_VISIBLE_DAYS - 1) });
    seedTender({ title: '已过时效', publishDate: daysAgo(TENDER_VISIBLE_DAYS + 1) });

    expect(titles(loadUnscoredForUser(USER_A, [], 100))).toEqual(['还在窗口内']);
  });

  it('草稿不评分（还没做 AI 抽取，评了也是评标题）', () => {
    seedTender({ title: '草稿', status: 'draft' });
    seedTender({ title: '已抽取', status: 'extracted' });
    expect(titles(loadUnscoredForUser(USER_A, [], 100))).toEqual(['已抽取']);
  });
});

describe('平台过滤在 SQL 里做', () => {
  it('只取用户关注的平台', () => {
    seedTender({ title: '广东政采', platform: 'gdgpo' });
    seedTender({ title: '美的', platform: 'meicloud' });
    seedTender({ title: '阳光采购', platform: 'ygcg' });

    expect(titles(loadUnscoredForUser(USER_A, ['gdgpo', 'ygcg'], 100))).toEqual(['广东政采', '阳光采购']);
    expect(countUnscoredForUser(USER_A, ['gdgpo', 'ygcg'])).toBe(2);
  });

  it('空平台列表 = 不限平台（老用户与未配置过的保持全量）', () => {
    seedTender({ title: 'a', platform: 'gdgpo' });
    seedTender({ title: 'b', platform: 'meicloud' });
    expect(loadUnscoredForUser(USER_A, [], 100)).toHaveLength(2);
  });

  it('平台过滤先于 limit —— 上限不会被无关平台吃掉', () => {
    // 如果先取 limit 条再在内存里按平台丢，只关注一个平台的用户
    // 可能 200 条里只剩几条，上限就白给了。
    for (let i = 0; i < 30; i++) seedTender({ title: `别的平台${i}`, platform: 'meicloud' });
    for (let i = 0; i < 5; i++) seedTender({ title: `关注的${i}`, platform: 'ygcg' });

    const rows = loadUnscoredForUser(USER_A, ['ygcg'], 5);
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r.platform === 'ygcg')).toBe(true);
  });
});

describe('上限与「剩余 N 条」', () => {
  it('count 不受 limit 影响 —— 日志里那句「还剩 N 条」靠它才是真的', () => {
    for (let i = 0; i < 12; i++) seedTender({ title: `t${i}` });
    expect(loadUnscoredForUser(USER_A, [], 5)).toHaveLength(5);
    expect(countUnscoredForUser(USER_A, [])).toBe(12);
  });

  it('按发布日期倒序取，先评新的', () => {
    seedTender({ title: '旧', publishDate: daysAgo(10) });
    seedTender({ title: '新', publishDate: daysAgo(1) });
    seedTender({ title: '中', publishDate: daysAgo(5) });

    expect(loadUnscoredForUser(USER_A, [], 2).map((r) => r.title)).toEqual(['新', '中']);
  });
});
