import { describe, it, expect, beforeEach } from 'vitest';
import { initDatabase, getDatabase } from '../db/index.js';
import { createAppKeys, applyDelta, getAppKey, listLedger, findAppKeyByRaw, authenticateAppKey, holdPoints, settlePoints, createRechargeCodes, redeemRechargeCode, setRechargeIssued, listRechargeCodes } from './appKeyService.js';
import { aiGateway } from '../core/llm/gateway.js';
import { upsertProvider } from './aiProviderService.js';
import { authMiddleware } from '../auth/middleware.js';
import { scopeGuard } from '../auth/scopeGuard.js';

initDatabase();

beforeEach(() => {
  const db = getDatabase();
  db.prepare('DELETE FROM app_keys').run();
  db.prepare('DELETE FROM app_key_ledger').run();
  db.prepare('DELETE FROM recharge_codes').run();
  db.prepare("DELETE FROM user WHERE username LIKE 'key:%'").run();
});

describe('应用 key 的点数', () => {
  it('被拒的扣减不留下任何痕迹，流水加总始终等于余额', () => {
    // 余额和流水各自看起来都正常、但对不上 —— 买家来问「为什么少了」时拿不出对账依据。
    const { keys } = createAppKeys('ppt', 1, 100);
    const id = keys[0].id;
    applyDelta(id, -30, 'adjust');
    expect(() => applyDelta(id, -71, 'charge')).toThrow(/余额不足/);

    const sum = listLedger(id).reduce((s, l) => s + l.delta, 0);
    expect(getAppKey(id)!.balance).toBe(70);
    expect(sum).toBe(70);
    expect(listLedger(id)[0].balance_after).toBe(70);
  });

  it('照着订单手敲的小写、带空格的 key 也认得出', () => {
    // 认不出的话买家看到「无效」，只会一直核对那把没抄错的 key。
    const { keys } = createAppKeys('consult', 1, 0);
    const typed = ` ${keys[0].key.toLowerCase().replace(/-/g, '- ')} `;
    expect(findAppKeyByRaw(typed)?.id).toBe(keys[0].id);
  });
});

describe('应用 key 当身份用', () => {
  it('同一张卡每次是同一个用户，两张卡互相不是同一个用户', () => {
    // 前者错了是「我的稿子刷新就没了」，后者错了是 A 买家的稿子列在 B 买家那里 —— 都是一列正常的稿子。
    const { keys } = createAppKeys('ppt', 2, 10);
    const a1 = authenticateAppKey(keys[0].key).user_id;
    const a2 = authenticateAppKey(keys[0].key).user_id;
    const b = authenticateAppKey(keys[1].key).user_id;
    expect(a2).toBe(a1);
    expect(b).not.toBe(a1);
  });

  it('ppt 的卡碰不到 ppt 之外的接口', () => {
    // 影子用户本身是个普通用户，漏了 scope 的话这张卡能以它的身份调 /api/xhs、/api/chat，每个都 200。
    const { keys } = createAppKeys('ppt', 1, 10);
    const req: any = { path: '/api/xhs/structure', method: 'POST', headers: { authorization: `Bearer ${keys[0].key}` } };
    let status = 0;
    const res: any = { status: (s: number) => ((status = s), { json: () => undefined }) };
    authMiddleware(req, res, () => scopeGuard(req, res, () => (status = 200)));
    expect(status).toBe(403);
  });
});

describe('按次扣点', () => {
  it('余额只够一次时，并发的第二次在调用前就被拒，结算后流水对得上', () => {
    // 不冻结的话两次都放行：两次都花了平台的钱，结算时才发现只够扣一次。
    const { keys } = createAppKeys('ppt', 1, 1);
    const userId = authenticateAppKey(keys[0].key).user_id;
    const first = holdPoints(userId, 1);
    expect(() => holdPoints(userId, 1)).toThrow(/还剩 0 点/);
    settlePoints(first, 'build-page', null);

    const row = getAppKey(keys[0].id)!;
    expect([row.balance, row.frozen]).toEqual([0, 0]);
    expect(listLedger(keys[0].id)[0]).toMatchObject({ kind: 'charge', delta: -1, operation: 'build-page' });
  });

  it('上游失败的调用不扣点、也不留冻结', async () => {
    // 冻结漏解的话可用点数悄悄少一截、永远不回来，而流水上一行都没有。
    getDatabase().prepare('DELETE FROM ai_providers').run();
    upsertProvider({ kind: 'llm', tier: 'default', label: 'p', model: 'm', base_url: 'https://example.invalid/v1', api_key: 'sk-x', enabled: 1 });
    const { keys } = createAppKeys('ppt', 1, 3);
    const userId = authenticateAppKey(keys[0].key).user_id;

    await expect(
      aiGateway({ messages: [{ role: 'user', content: 'hi' }] }, { userId, source: 'ppt', operation: 'build-page', timeoutMs: 200, maxRetries: 0 })
    ).rejects.toThrow();

    const row = getAppKey(keys[0].id)!;
    expect([row.balance, row.frozen]).toEqual([3, 0]);
    expect(listLedger(keys[0].id).filter((l) => l.kind === 'charge')).toHaveLength(0);
  });
});

describe('充值码', () => {
  it('同一张码充第二次不再加点，且说清楚是已经充进这把 key 了', () => {
    // 加两遍的话两次都回「充值成功」；只说「已使用」的话双击的人以为第一下没成、去找卖家。
    const { keys } = createAppKeys('ppt', 1, 0);
    const { codes } = createRechargeCodes('ppt', 1, 100);
    expect(redeemRechargeCode(keys[0].id, codes[0].code).balance).toBe(100);
    expect(() => redeemRechargeCode(keys[0].id, codes[0].code)).toThrow(/已经在 .* 充进你这把 key/);
    expect(getAppKey(keys[0].id)!.balance).toBe(100);
  });

  it('别的应用的码充不进来，而且码不会被吃掉', () => {
    // 被吃掉的话他换到正确的页面再充时看到「已被用过」，那张码的钱就没了。
    const { keys } = createAppKeys('ppt', 1, 0);
    const { codes } = createRechargeCodes('consult', 1, 100);
    expect(() => redeemRechargeCode(keys[0].id, codes[0].code)).toThrow(/品牌咨询/);
    expect(listRechargeCodes('consult')[0].status).toBe('unused');
  });

  it('用过的码撤回发放也变不回「未使用」', () => {
    // 变回去的话后台显示它还能卖，再卖出去就是买家付了钱充不上。
    const { keys } = createAppKeys('ppt', 1, 0);
    const { codes } = createRechargeCodes('ppt', 1, 50);
    setRechargeIssued([codes[0].id], true);
    redeemRechargeCode(keys[0].id, codes[0].code);
    expect(setRechargeIssued([codes[0].id], false)).toBe(0);
    expect(listRechargeCodes('ppt')[0].status).toBe('used');
  });
});
