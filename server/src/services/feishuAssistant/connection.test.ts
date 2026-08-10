import { describe, expect, it } from 'vitest';
import * as lark from '@larksuiteoapi/node-sdk';
import { explainConnectError } from './connection.js';

// 只测一件事：建连失败时给出的排查方向对不对。
//
// SDK 把所有建连失败都包成同一句「could not resolve bot identity via
// /open-apis/bot/v3/info」，真实原因在 cause、分类在 code。照抄 message 的话，
// 网络不通会显示成一个接口路径，把人指向「权限没开 / 密钥填错」——
// 失败伪装成另一种失败，手测时看到的是一句像样的错误，没人会发现方向错了。
describe('建连失败的排查方向', () => {
  it('网络不通时不能提凭证，要指向代理/VPN', () => {
    // 真实形状：LarkChannel 建连撞上本机 VPN 时抛的就是这个。
    const err = new lark.LarkChannelError(
      'not_connected',
      'could not resolve bot identity via /open-apis/bot/v3/info — required for channel to function',
      { cause: Object.assign(new Error('fetch failed'), { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } }) }
    );

    const msg = explainConnectError(err);

    expect(msg).toMatch(/代理|VPN/);
    expect(msg).toContain('UND_ERR_CONNECT_TIMEOUT');
    // 关键的负向断言：这条路径上提 App Secret 就是把人带向错的地方。
    expect(msg).not.toMatch(/App Secret/);
    // SDK 那个接口路径也不该出现 —— 它是这次误导的源头。
    expect(msg).not.toContain('bot/v3/info');
  });

  it('凭证被拒时才提 App Secret', () => {
    const err = new lark.LarkChannelError(
      'permission_denied',
      'could not resolve bot identity via /open-apis/bot/v3/info — required for channel to function',
      { cause: Object.assign(new Error('app not exist'), { code: 99991663 }) }
    );

    const msg = explainConnectError(err);

    expect(msg).toContain('App Secret');
    expect(msg).not.toMatch(/代理|VPN/);
  });

  it('认不出的错误原文保留，不能吞掉', () => {
    // 兜底分支：宁可显示看不懂的原文，也不要显示一句自信但错误的指引。
    expect(explainConnectError(new Error('某种没见过的失败'))).toContain('某种没见过的失败');
  });
});
