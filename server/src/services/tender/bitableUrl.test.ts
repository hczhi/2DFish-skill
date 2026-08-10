import { describe, it, expect } from 'vitest';
import { withTableParam } from './feishuBitable.js';

// 不带 ?table= 的 base 地址，飞书打开的是 base 里的**第一张**表。
// 而新建 App 自带一张只有索引列的空「数据表」，排在我们建的两张前面 ——
// 于是推送卡片的按钮点进去是一张空表，用户以为链接错了或者数据没同步。
// 实测那个 base 里的顺序就是：1.数据表(空) 2.标讯推荐 3.全部标讯。

describe('多维表格链接补 ?table=', () => {
  it('裸 base 地址补上 table 参数', () => {
    expect(withTableParam('https://x.feishu.cn/base/bascnAAA', 'tblBBB')).toBe(
      'https://x.feishu.cn/base/bascnAAA?table=tblBBB'
    );
  });

  it('已经带 table 参数的原样返回，不重复拼', () => {
    const url = 'https://x.feishu.cn/base/bascnAAA?table=tblBBB';
    expect(withTableParam(url, 'tblCCC')).toBe(url);
  });

  it('已有其他 query 时用 & 拼，不是第二个 ?', () => {
    // 拼成 `?a=1?table=` 的话整个链接就废了。
    expect(withTableParam('https://x.feishu.cn/base/bascnAAA?from=abc', 'tblBBB')).toBe(
      'https://x.feishu.cn/base/bascnAAA?from=abc&table=tblBBB'
    );
  });

  it('table 参数在中间时也认得出来（不看是不是 ? 紧跟着）', () => {
    const url = 'https://x.feishu.cn/base/bascnAAA?table=tblBBB&view=vewCCC';
    expect(withTableParam(url, 'tblZZZ')).toBe(url);
  });

  it('url 为空返回空 —— 不拼出一个只有参数的残缺地址', () => {
    expect(withTableParam('', 'tblBBB')).toBe('');
  });

  it('tableId 为空时原样返回 —— 不拼出 ?table= 空值', () => {
    // 拼成 `?table=` 的话飞书拿到一个空 table_id，行为不确定。
    expect(withTableParam('https://x.feishu.cn/base/bascnAAA', '')).toBe(
      'https://x.feishu.cn/base/bascnAAA'
    );
  });

  it('不会把 someothertable= 误判成已有 table 参数', () => {
    // 正则是 [?&]table=，要求 table 前面是参数分隔符。
    const url = 'https://x.feishu.cn/base/bascnAAA?mytable=1';
    expect(withTableParam(url, 'tblBBB')).toBe(
      'https://x.feishu.cn/base/bascnAAA?mytable=1&table=tblBBB'
    );
  });
});
