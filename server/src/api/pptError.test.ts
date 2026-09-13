// /ppt 六条花钱路径的错误码。额度用光时回 500 是**伪装成 bug 的成功路径的反面**：
// 平台那个额度弹窗只认 `429 + {error:'quota_exceeded'}`（`client/src/lib/api.ts`），
// 回 500 的话界面上是「这一页生成失败」，他会一路重试，而每次重试都真的扣一次额度。
// 手测要先把额度打光才看得出来，所以这条必须有测试。
import { describe, it, expect } from 'vitest';
import { sendPptError } from './ppt.js';
import { QuotaExceededError } from '../core/llm/gateway.js';
import { DedicatedChannelError } from '../services/aiProviderService.js';

function fakeRes() {
  const out: { code?: number; body?: any } = {};
  const res = {
    status(c: number) { out.code = c; return res; },
    json(b: any) { out.body = b; return res; },
  } as any;
  return { res, out };
}

describe('sendPptError', () => {
  it('额度用光回 429 + quota_exceeded（弹窗认这个），不是 500', () => {
    const { res, out } = fakeRes();
    sendPptError(res, new QuotaExceededError(10), false, '这一页生成失败');
    expect(out.code).toBe(429);
    expect(out.body.error).toBe('quota_exceeded');
    // 撞的是账号总额还是某个应用的单独额度，解法不同 —— detail 里必须带着原话。
    expect(out.body.detail).toContain('10次/天');
  });

  it('专属渠道缺档位回 503，不是 500（真实解法是去后台补一条接入点）', () => {
    const { res, out } = fakeRes();
    sendPptError(res, new DedicatedChannelError('缺 kind=image 的接入点'), false, '生图失败');
    expect(out.code).toBe(503);
    expect(out.body).toEqual({ error: '缺 kind=image 的接入点' });
  });
});
