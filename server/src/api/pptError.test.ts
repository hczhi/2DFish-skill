// /ppt 六条花钱路径的错误码。额度用光时回 500 是**伪装成 bug 的成功路径的反面**：
// 平台那个额度弹窗只认 `429 + {error:'quota_exceeded'}`（`client/src/lib/api.ts`），
// 回 500 的话界面上是「这一页生成失败」，他会一路重试，而每次重试都真的扣一次额度。
// 手测要先把额度打光才看得出来，所以这条必须有测试。
import { describe, it, expect } from 'vitest';
import OpenAI from 'openai';
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

  // 线上真实现象：生成一页回 `500 {"error":"Request timed out."}`。SDK 的超时错误不设 name、
  // status 是 undefined，所以以前落进兜底那行 —— 界面上「模型太慢」和「后端崩了」同一句 500，
  // 而两者解法相反（换模型/关思维链 vs 看服务端栈）。手测测不出来（要等满 120 秒才复现）。
  it('上游超时回 504 且说出成因（不是 500 + 一句英文原文）', () => {
    const { res, out } = fakeRes();
    sendPptError(res, new OpenAI.APIConnectionTimeoutError({ message: 'Request timed out.' }), false, '这一页生成失败');
    expect(out.code).toBe(504);
    expect(out.body.error).not.toBe('Request timed out.');
    expect(out.body.error).toContain('超时');
    // 不写「额度已经扣了」的话他以为这次失败是免费的，会连着重点，每次真扣一次。
    expect(out.body.error).toContain('额度已经扣了');
    // 真正管用的动作只有换模型/关思维链 —— 没这句他只会重试。
    expect(out.body.error).toContain('关思维链');
  });
});
