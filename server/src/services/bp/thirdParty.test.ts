import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { initDatabase, getDatabase } from '../../db/index.js';
import { createAppKeys, getAppKey, authenticateAppKey } from '../appKeyService.js';
import { authMiddleware } from '../../auth/middleware.js';
import { scopeGuard } from '../../auth/scopeGuard.js';
import { bpRouter } from '../../api/bp.js';
import { createReport, listReports, finishReport, failReport, type BpOwner } from './reportStore.js';
import { admitRun, BP_REPORT_POINTS, BP_DAILY_RUNS } from './billing.js';

initDatabase();

const app = express();
app.use(express.json());
app.use(authMiddleware, scopeGuard);
app.use('/api/bp', bpRouter);

const base = { filename: 'x.pdf', text: 'BP', emptyPages: 0, notes: [] as string[] };

function keyOwner(points: number) {
  const { keys } = createAppKeys('consult', 1, points);
  const k = authenticateAppKey(keys[0].key);
  return { raw: keys[0].key, keyId: keys[0].id, owner: { userId: k.user_id, sdkPk: null, externalUid: null } as BpOwner };
}

beforeEach(() => {
  const db = getDatabase();
  db.exec("DELETE FROM bp_reports; DELETE FROM bp_usage; DELETE FROM app_keys; DELETE FROM app_key_ledger; DELETE FROM user WHERE username LIKE 'key:%';");
});

describe('BP 分析对第三方开放', () => {
  it('嵌入版同一个 pk 下 A 客户看不到 B 客户的报告，网页登录的账号也看不到嵌入版建的', () => {
    const a: BpOwner = { userId: 'u1', sdkPk: 'pk1', externalUid: 'A' };
    const b: BpOwner = { userId: 'u1', sdkPk: 'pk1', externalUid: 'B' };
    const web: BpOwner = { userId: 'u1', sdkPk: null, externalUid: null };
    createReport({ ...base, owner: a });
    createReport({ ...base, owner: b });
    expect(listReports(a)).toHaveLength(1);
    expect(listReports(b)).toHaveLength(1);
    expect(listReports(web)).toHaveLength(0);
  });

  it('key 用户一份报告跑完只扣一笔固定点数，失败不扣、冻结的点数退回', () => {
    const { keyId, owner } = keyOwner(500);
    const ok = createReport({ ...base, owner, hold: admitRun(owner, true) });
    expect(getAppKey(keyId)).toMatchObject({ balance: 500, frozen: BP_REPORT_POINTS });
    finishReport(ok);
    expect(getAppKey(keyId)).toMatchObject({ balance: 500 - BP_REPORT_POINTS, frozen: 0 });

    const bad = createReport({ ...base, owner, hold: admitRun(owner, true) });
    failReport(bad, '上游挂了');
    expect(getAppKey(keyId)).toMatchObject({ balance: 500 - BP_REPORT_POINTS, frozen: 0 });
    const ledger = getDatabase().prepare(`SELECT delta FROM app_key_ledger WHERE key_id = ? AND kind = 'charge'`).all(keyId) as { delta: number }[];
    expect(ledger.map((l) => l.delta)).toEqual([-BP_REPORT_POINTS]);
  });

  it('点数不够时当场拒、不吃掉当天的开跑次数', () => {
    const { owner } = keyOwner(50);
    expect(() => admitRun(owner, true)).toThrow(/点数不足/);
    const row = getDatabase().prepare(`SELECT runs FROM bp_usage`).get() as { runs: number } | undefined;
    expect(row?.runs ?? 0).toBe(0);
  });

  it('每把 key 每天开跑次数有上限（续跑 / 重跑也算）', () => {
    const { owner } = keyOwner(0);
    for (let i = 0; i < BP_DAILY_RUNS; i++) admitRun(owner, false);
    expect(() => admitRun(owner, false)).toThrow(/到上限/);
  });

  it('品牌咨询的 key 能调 BP 接口（过 scopeGuard），列表只回自己的', async () => {
    const { raw } = keyOwner(0);
    createReport({ ...base, owner: { userId: 'someone-else', sdkPk: null, externalUid: null } });
    const res = await request(app).get('/api/bp/reports').set('Authorization', `Bearer ${raw}`).expect(200);
    expect(res.body.reports).toEqual([]);
  });
});
