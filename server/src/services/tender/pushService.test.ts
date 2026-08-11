import { describe, it, expect, beforeEach, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { initDatabase, getDatabase } from '../../db/index.js';
import { loadPushItems, loadPushSummary, runManualPush } from './pushService.js';

initDatabase();

// 手动推送的失败方式几乎全是「看起来成功」：按钮旁边显示 28 条、群里收到的卡片
// 标题写 5 条（或者干脆报「没有要推送的内容」），而两个数字都来自 200 的接口。
// 手测唯一能发现的办法是数群里那张卡片，所以这里断言两者必须同源。

// 打桩打在 pushToChats 上（而不是 pushTenderRecommendations）：pushToChats 调的是
// 模块内部那个绑定，换掉导出拦不住它。failChats 里的群会被判失败，用来验证部分成功。
const pushCalls: any[] = [];
const failChats = new Set<string>();
vi.mock('./feishuNotify.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./feishuNotify.js')>();
  return {
    ...actual,
    pushToChats: vi.fn(async (_cred: any, chatIds: string[], items: any[]) => {
      pushCalls.push({ chatIds, items });
      return chatIds.map((chatId) =>
        failChats.has(chatId)
          ? { chatId, ok: false, error: '230013 机器人未加入该群' }
          : { chatId, ok: true, messageId: `om_${chatId}` }
      );
    }),
  };
});

// 重灌打的是真飞书，这里打桩。默认「没启用多维表格」（skipped），
// 单个用例按需覆盖成成功/失败。
let rebuildResult: any = { recommend: { cleared: 0, written: 0 }, followKept: 0, skipped: '未启用或配置不完整' };
vi.mock('./feishuBitable.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./feishuBitable.js')>();
  return {
    ...actual,
    rebuildBitableTables: vi.fn(async () => rebuildResult),
  };
});

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10);
}

function seedTender(title: string, publishDate = daysAgo(1), platform = 'gdgpo'): string {
  const id = uuidv4();
  getDatabase()
    .prepare(
      `INSERT INTO tenders (id, platform, notice_id, content_hash, title, publish_date, deadline,
                            budget, budget_amount, purchaser_name, content_text, url, keyword, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, '', '', 0, '', '', '', '', 'extracted', ?)`
    )
    .run(id, platform, id, `hash-${id}`, title, publishDate, new Date().toISOString());
  return id;
}

function seedRec(
  userId: string,
  tenderId: string,
  score: number,
  tier = 'consider',
  syncedAt: string | null = null
) {
  getDatabase()
    .prepare(
      `INSERT INTO tender_recommendations (id, user_id, tender_id, total_score, tier, bitable_synced_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(uuidv4(), userId, tenderId, score, tier, syncedAt, new Date().toISOString());
}

function seedPref(userId: string, over: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  const cols = {
    feishu_app_id: 'cli_x',
    feishu_app_secret: 'sec_x',
    feishu_chat_id: 'oc_abc',
    feishu_min_score: 70,
    ...over,
  };
  const keys = Object.keys(cols);
  getDatabase()
    .prepare(
      `INSERT INTO tender_user_preferences (id, user_id, ${keys.join(', ')}, created_at, updated_at)
       VALUES (?, ?, ${keys.map(() => '?').join(', ')}, ?, ?)`
    )
    .run(uuidv4(), userId, ...keys.map((k) => (cols as any)[k]), now, now);
}

let userId: string;

beforeEach(() => {
  pushCalls.length = 0;
  failChats.clear();
  rebuildResult = { recommend: { cleared: 0, written: 0 }, followKept: 0, skipped: '未启用或配置不完整' };
  userId = uuidv4();
  const db = getDatabase();
  db.prepare('DELETE FROM tender_recommendations').run();
  db.prepare('DELETE FROM tenders').run();
  db.prepare('DELETE FROM tender_user_preferences').run();
  // 推荐行和偏好行都有外键指向 user，不建用户会报下游的 FOREIGN KEY constraint failed。
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO user (id, username, password_hash, role, created_at, updated_at)
     VALUES (?, ?, 'x', 'user', ?, ?)`
  ).run(userId, `u-${userId.slice(0, 8)}`, now, now);
});

describe('手动推送：预览数和实推条数同源', () => {
  it('预览说几条，卡片里就是几条', async () => {
    seedPref(userId);
    for (let i = 0; i < 3; i++) seedRec(userId, seedTender(`达标 ${i}`), 80);
    seedRec(userId, seedTender('不达标'), 50);

    const summary = loadPushSummary(userId);
    expect(summary.recommendCount).toBe(3);

    const r = await runManualPush(userId, Date.now());
    expect(r.ok).toBe(true);
    expect(r.pushed).toBe(3);
    expect(pushCalls[0].items).toHaveLength(3);
  });

  it('已同步进多维表格的推荐照样会被推 —— 两个状态互不相干', async () => {
    // 原来的自动推送只推「本轮新评出来的」。手动推送若也跟着状态位走，
    // 同步过一次之后按钮就永远推不出东西，而预览数还写着 3 条。
    seedPref(userId);
    seedRec(userId, seedTender('早就同步过了'), 88, 'priority', new Date().toISOString());

    expect(loadPushSummary(userId).recommendCount).toBe(1);
    const r = await runManualPush(userId, Date.now());
    expect(r.pushed).toBe(1);
  });

  it('filter 档和过期标讯两边都不算 —— 预览多算一条就意味着卡片少一条', async () => {
    seedPref(userId);
    seedRec(userId, seedTender('正常'), 90);
    seedRec(userId, seedTender('初筛掉的'), 90, 'filter');
    seedRec(userId, seedTender('30 天前的', daysAgo(30)), 90);

    expect(loadPushSummary(userId).recommendCount).toBe(1);
    expect(loadPushItems(userId)).toHaveLength(1);
  });
});

describe('手动推送：推不出去的时候必须说清为什么', () => {
  it('没有达标推荐时 blockedBy 带上阈值，而不是空着让人点', () => {
    seedPref(userId, { feishu_min_score: 70 });
    seedRec(userId, seedTender('只有 50 分'), 50);

    const s = loadPushSummary(userId);
    expect(s.recommendCount).toBe(0);
    expect(s.blockedBy).toContain('70');
  });

  it('缺群 ID 时不去调飞书，直接说缺群 ID', async () => {
    // 让它打过去只会拿回一句「推送失败」，管理员分不清是配置问题还是飞书的问题。
    seedPref(userId, { feishu_chat_id: '' });
    seedRec(userId, seedTender('达标'), 90);

    expect(loadPushSummary(userId).blockedBy).toBe('未配置推送群');
    const r = await runManualPush(userId, Date.now());
    expect(r.ok).toBe(false);
    expect(pushCalls).toHaveLength(0);
  });

  it('群 ID 带首尾空格时去掉再用 —— 带空格调接口报 230002「群不存在」', async () => {
    seedPref(userId, { feishu_chat_id: '  oc_abc  ' });
    seedRec(userId, seedTender('达标'), 90);

    await runManualPush(userId, Date.now());
    expect(pushCalls[0].chatIds).toEqual(['oc_abc']);
  });

  it('多个群用中文逗号/换行分隔时逐个拆开 —— 整列当一个 id 用会报 230002', async () => {
    // 这一列存的是逗号分隔的多个 id，手拼时中文逗号和换行都很自然。
    // 不拆的话飞书只会回一句「群不存在」，管理员盯着自己刚复制的两个 id 找不出问题。
    seedPref(userId, { feishu_chat_id: 'oc_a，oc_b\noc_c' });
    seedRec(userId, seedTender('达标'), 90);

    const s = loadPushSummary(userId);
    expect(s.chatIds).toEqual(['oc_a', 'oc_b', 'oc_c']);

    await runManualPush(userId, Date.now());
    expect(pushCalls[0].chatIds).toEqual(['oc_a', 'oc_b', 'oc_c']);
  });

  it('一个群失败不能被另外两个的成功吃掉 —— 逐群结果必须带出来', async () => {
    // 合成一个成败是这里最容易「看起来成功」的地方：报成功那个群的人从此收不到推送，
    // 后台一直显示 ✅；报失败管理员会重推，另外两个群于是收到两条一样的卡片。
    seedPref(userId, { feishu_chat_id: 'oc_a,oc_bad,oc_c' });
    seedRec(userId, seedTender('达标'), 90);
    failChats.add('oc_bad');

    const r = await runManualPush(userId, Date.now());
    expect(r.ok).toBe(true);
    expect(r.chats.filter((c) => !c.ok).map((c) => c.chatId)).toEqual(['oc_bad']);
    expect(r.chats.find((c) => c.chatId === 'oc_bad')?.error).toContain('230013');
  });

});

describe('手动推送：重灌把表清空了却没灌完，不能再发卡片', () => {
  it('重灌返回 error 时卡片不发出去', async () => {
    // 这时表是空的。照样发卡片的话用户点底部按钮看到空表，会以为数据丢了 ——
    // 而群里那条消息本身长得完全正常。群里没消息是看得见的，所以宁可不发。
    seedPref(userId);
    seedRec(userId, seedTender('达标'), 90);
    rebuildResult = {
      recommend: { cleared: 12, written: 0 },
      followKept: 0,
      error: '表已清空，但写入中断（1254045 字段不存在）—— 表格现在是不完整的，请再点一次重建。',
    };

    const r = await runManualPush(userId, Date.now());
    expect(r.ok).toBe(false);
    expect(r.error).toContain('已清空');
    expect(pushCalls).toHaveLength(0);
  });

  it('重灌抛异常时同样不发卡片，并把原因带出来', async () => {
    seedPref(userId);
    seedRec(userId, seedTender('达标'), 90);
    const { rebuildBitableTables } = await import('./feishuBitable.js');
    vi.mocked(rebuildBitableTables).mockRejectedValueOnce(new Error('飞书接口超时'));

    const r = await runManualPush(userId, Date.now());
    expect(r.ok).toBe(false);
    expect(r.error).toContain('飞书接口超时');
    expect(pushCalls).toHaveLength(0);
  });

  it('重灌成功时把两张表的行数带回去 —— 前端要把它报给管理员', async () => {
    seedPref(userId);
    seedRec(userId, seedTender('达标'), 90);
    rebuildResult = {
      recommend: { cleared: 12, written: 1 },
      all: { cleared: 96, written: 125 },
      followKept: 3,
    };

    const r = await runManualPush(userId, Date.now());
    expect(r.ok).toBe(true);
    expect(r.rebuild?.recommend.written).toBe(1);
    expect(r.rebuild?.followKept).toBe(3);
  });
});
