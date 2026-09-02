import { describe, it, expect } from 'vitest';
import { normalizeOriginsInput, invalidOrigins, originAllowed } from './sdkKeys.js';

// 白名单配错只有一种表现，而它完全读不出来：**接口回 success、后台那一行看着有内容，
// 而这把 key 的每个域名都换不到 token**（第三方页面上一块白，接入方只会反复核对自己
// 那个没写错的域名）。历史上这条是「编辑白名单用了 window.prompt()」引发的 —— 那个
// 对话框只有一行，多个域名被压成一条空格分隔的长字符串，而切分只认换行和逗号。
describe('SDK 白名单的切分与格式校验', () => {
  it('空格分隔的多个域名要切开，且塞成一条的坏条目不能被判成放行', () => {
    const origins = normalizeOriginsInput(
      'https://localhost:5174 https://cwb.imaginedt.cn, https://cwb.xiaozanai.com/'
    );
    expect(origins).toEqual([
      'https://localhost:5174',
      'https://cwb.imaginedt.cn',
      'https://cwb.xiaozanai.com',
    ]);
    expect(originAllowed(JSON.stringify(origins), 'https://cwb.imaginedt.cn')).toBe(true);

    // 少了 scheme / 带了路径的条目存下来只会稳定 403，所以要在保存那一刻就被挑出来。
    expect(invalidOrigins(['partner.com', 'https://partner.com/app', 'https://partner.com'])).toEqual([
      'partner.com',
      'https://partner.com/app',
    ]);
  });
});
