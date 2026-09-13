import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';

// 展示稿对外接入的 key 管理（migration 100）。只测两件「读起来完全正常」的事：
// ① 发 key 的接口没被 requireAdmin 挡住的话，任何登录用户都能给自己发一把绑到别人账号上的
//    key（每次都 200，后台那张表里多出来一行，没有一处报错）；
// ② 上限填 0 被兜成缺省值的话，管理员以为已经把这把 key 冻住了，而第三方那边照样在调。

const { app } = await import('../app.js');
const { createUser } = await import('./helpers.js');

let admin: ReturnType<typeof createUser>;
let plain: ReturnType<typeof createUser>;

beforeAll(() => {
  admin = createUser('admin');
  plain = createUser('user');
});

describe('ppt SDK key 管理', () => {
  it('普通登录用户发不出 key（这道闸门漏了的话每次都是 200）', async () => {
    const res = await request(app)
      .post('/api/ppt/admin/sdk-keys')
      .set(plain.auth)
      .send({ userId: plain.id, allowedOrigins: 'https://partner.example.com' });
    expect(res.status).toBe(403);

    // 列表也要挡住：只挡写不挡读的话，别人账号的 pk 和白名单会被列出来。
    expect((await request(app).get('/api/ppt/admin/sdk-keys').set(plain.auth)).status).toBe(403);
  });

  it('上限填 0 就是 0（不能兜成缺省值，那等于没冻住）', async () => {
    const created = await request(app)
      .post('/api/ppt/admin/sdk-keys')
      .set(admin.auth)
      .send({
        userId: plain.id, name: '冻住的接入方', allowedOrigins: 'https://partner.example.com',
        dailyAiLimit: 0, maxDecks: 0,
      });
    expect(created.status).toBe(200);
    expect(created.body.daily_ai_limit).toBe(0);
    expect(created.body.max_decks).toBe(0);

    const list = await request(app).get('/api/ppt/admin/sdk-keys').set(admin.auth);
    const row = list.body.find((k: any) => k.pk === created.body.pk);
    expect(row.daily_ai_limit).toBe(0);
    expect(row.ai_used_today).toBe(0);
    expect(row.decks).toBe(0);
  });
});
