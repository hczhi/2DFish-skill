import { describe, it, expect } from 'vitest';
import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  AuthenticationError,
  InternalServerError,
  RateLimitError,
} from 'openai';
import { describeCommandError } from './commandError.js';

// 这个文件的读者是**飞书群里的人**，而他：
//   - 没有平台账号，打不开后台，看不到服务端日志
//   - 不知道「AI 中转站」这个东西存在
//   - 需要知道两件事：这是谁的问题、要不要重发
//
// 真实事故（2026-08-09）：AI 中转站的域名解析没了，nginx 返回 502 的 HTML 错误页，
// OpenAI SDK 把**响应体原文**放进 e.message，于是助理往群里贴了一整页
// `<html><head><title>502 Bad Gateway</title>…<center>nginx</center>` ——
// 用户完全无从下手，只会以为助理坏了，去查飞书权限和机器人是否掉线。

/** 造一个"上游返回了 HTTP 错误"的异常，body 是 nginx 的 HTML 错误页（非 JSON）。 */
function nginxError(status: number) {
  const html =
    '<html>\n<head><title>502 Bad Gateway</title></head>\n' +
    '<body>\n<center><h1>502 Bad Gateway</h1></center>\n<hr><center>nginx</center>\n</body>\n</html>\n';
  // SDK 拿不到 JSON body 时走的就是这条路：errJSON=undefined，message=响应体原文。
  return APIError.generate(status, undefined, `${status} ${html}`, {});
}

describe('上游 AI 服务返回 HTTP 错误', () => {
  // 这是那次事故的回归用例。HTML 一个字都不许进回帖 ——
  // 它对群里的人零信息量，只会盖掉真正该说的那句话。
  it('502 的 nginx HTML 错误页不进回帖', () => {
    const detail = describeCommandError(nginxError(502));
    expect(detail.message).not.toContain('<html>');
    expect(detail.message).not.toContain('nginx');
    expect(detail.message).not.toContain('Bad Gateway');
    expect(detail.message).toContain('AI 服务暂时不可用');
    expect(detail.message).toContain('502');
  });

  // 「本次没有执行任何操作」必须说：意图解析是第一步，这类错误发生在
  // 任何动作跑起来之前。不说的话用户不敢重发（怕建出两个项目）。
  it('说清没执行任何操作 + 可以重发', () => {
    const detail = describeCommandError(nginxError(502));
    expect(detail.message).toContain('没有执行任何操作');
    expect(detail.message).toContain('再说一遍');
  });

  it('503 / 504 同样处理', () => {
    for (const status of [503, 504]) {
      const detail = describeCommandError(nginxError(status));
      expect(detail.message).toContain('AI 服务暂时不可用');
      expect(detail.message).toContain(String(status));
      expect(detail.message).not.toContain('<html>');
    }
  });

  // 401/403 是唯一**不该**说「过一会儿再试」的：密钥不会自己变好，
  // 重发一百遍都是同一个结果，正确的处置是找管理员。
  it('401 不劝重发，而是指向管理员换密钥', () => {
    const detail = describeCommandError(
      new AuthenticationError(401, { message: 'invalid api key' }, undefined, {})
    );
    expect(detail.message).toContain('密钥');
    expect(detail.message).toContain('管理员');
    expect(detail.message).not.toContain('再说一遍');
  });

  it('429 说的是限流，不是"坏了"', () => {
    const detail = describeCommandError(new RateLimitError(429, undefined, undefined, {}));
    expect(detail.message).toContain('限流');
    expect(detail.message).toContain('429');
  });

  it('404 指向"地址或模型名不对"，而不是让人重发', () => {
    // 这条踩过：中转站 base_url 少写/多写一层 /v1 时报的就是 404，
    // 而「请再说一遍」会让用户白试很多遍。
    const detail = describeCommandError(
      APIError.generate(404, undefined, '404 Invalid URL (POST /v1/chat/completions)', {})
    );
    expect(detail.message).toContain('模型名');
    expect(detail.message).toContain('管理员');
    expect(detail.message).not.toContain('再说一遍');
  });

  it('500 兜底也不漏原文', () => {
    const detail = describeCommandError(
      new InternalServerError(500, { message: 'upstream exploded' }, undefined, {})
    );
    expect(detail.message).toContain('AI 服务出错');
    expect(detail.message).not.toContain('exploded');
  });

  it('status 落进 code，后台日志能查', () => {
    expect(describeCommandError(nginxError(502)).code).toBe(502);
  });

  it('不是 advisory —— 上游挂了是真故障，该带红叉', () => {
    expect(describeCommandError(nginxError(502)).advisory).toBeFalsy();
  });
});

describe('连不上 / 超时', () => {
  // 根因：OpenAI SDK 的错误类**一个都没设 `this.name`**，所以 `e.name` 是字面的
  // 'Error'。只看 e.name 的话这两类永远匹配不上，会掉进"未知错误原样透传"。
  it('SDK 的超时类能被认出来（它的 e.name 是 "Error"）', () => {
    const e = new APIConnectionTimeoutError({ message: 'Request timed out.' });
    expect(e.name).toBe('Error'); // 前提如果哪天变了，下面的判据也要跟着改
    const detail = describeCommandError(e);
    expect(detail.message).toContain('超时');
    expect(detail.message).toContain('没有执行任何操作');
    expect(detail.message).not.toContain('Request timed out');
  });

  // 连不上和 502 分开说：502 等一等有用，连不上多半是地址错了，等也没用。
  it('连不上说的是"检查渠道地址"，不劝重发', () => {
    const detail = describeCommandError(
      new APIConnectionError({ message: 'Connection error.', cause: new Error('ENOTFOUND') })
    );
    expect(detail.message).toContain('连不上');
    expect(detail.message).toContain('地址');
    expect(detail.message).not.toContain('ENOTFOUND');
  });
});

describe('不该被这条新分支抢走的几类', () => {
  // 飞书 SDK 抛的是 AxiosError，它也带 status。被抢走的话就丢了
  // 「缺哪个权限 + 一键申请链接 + 必须发版」那一整段。
  it('飞书的缺权限错误仍然走飞书翻译（认 code、给申请链接）', () => {
    const axiosLike = Object.assign(new Error('Request failed with status code 400'), {
      isAxiosError: true,
      status: 400,
      response: {
        status: 400,
        data: { code: 99991672, msg: 'no permission [task:task:write]', log_id: 'lg1' },
      },
    });
    const detail = describeCommandError(axiosLike, 'cli_x');
    expect(detail.kind).toBe('scope_denied');
    expect(detail.scopes).toEqual(['task:task:write']);
    expect(detail.apply_url).toContain('cli_x');
    expect(detail.message).toContain('发布新版本');
  });

  it('额度用完仍然是 advisory（不套红叉）', () => {
    const e = Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
    const detail = describeCommandError(e);
    expect(detail.advisory).toBe(true);
    expect(detail.message).toContain('额度');
  });

  it('太忙仍然是 advisory，且原样用它自己的文案', () => {
    const e = Object.assign(new Error('⏳ 现在有点忙，本次没有执行任何操作'), {
      name: 'TooBusyError',
    });
    const detail = describeCommandError(e);
    expect(detail.advisory).toBe(true);
    expect(detail.message).toBe('⏳ 现在有点忙，本次没有执行任何操作');
  });

  it('专属渠道缺档指向管理员，不是 advisory', () => {
    const e = Object.assign(new Error('missing tier'), { name: 'DedicatedChannelError' });
    const detail = describeCommandError(e);
    expect(detail.message).toContain('专属 AI 渠道');
    expect(detail.advisory).toBeFalsy();
  });

  // 动作层抛的错本来就是写给用户看的人话，加工只会变模糊。
  it('普通 Error 原样透传', () => {
    const detail = describeCommandError(new Error('通讯录里没找到「张三」，请 @ 他一下'));
    expect(detail.message).toBe('通讯录里没找到「张三」，请 @ 他一下');
  });

  it('不是对象的异常也不炸', () => {
    expect(describeCommandError('boom').message).toBe('boom');
    expect(describeCommandError(undefined).message).toBeTruthy();
  });
});
