// AI 配卡的核对。模型编出原话里没有的数字 / 条目时，卡片照样好看、照样「配好了」——
// 手测看不出来（得逐张去对原话），所以这条必须有测试。
import { describe, it, expect } from 'vitest';
import { checkCards, cnToNumber, mergeFills } from './planService.js';

const lines = [
  { id: 1, text: '大家好，今天聊聊我们公司' },
  { id: 2, text: '去年营收涨了3000%' },
  { id: 3, text: '同行平均才 20％' },
  { id: 4, text: '我们做对了三件事' },
  { id: 5, text: '第一，只做一个品类' },
  { id: 6, text: '第二，客单价提到了1,280元' },
];
const ALL = ['number', 'list', 'chapter'];

describe('checkCards', () => {
  it('原话是 3000 而模型写成 300（子串）—— 整张拦下并说原因，不上屏', () => {
    const r = checkCards([{ template: 'number', line: 2, prefix: '+', value: '300', unit: '%', title: '去年营收' }], lines, ALL);
    expect(r.cards).toEqual([]);
    expect(r.rejected[0]).toMatchObject({ line: 2, why: '原话里没有「300」这个数' });
  });

  it('清单里有一条是模型自己补的（原话没说）—— 整张拦下', () => {
    const r = checkCards(
      [{ template: 'list', line: 4, endLine: 6, title: '三件事', items: ['只做一个品类', '客单价提到了1,280元', '复购率做到四成'] }],
      lines, ALL,
    );
    expect(r.cards).toEqual([]);
    expect(r.rejected[0].why).toBe('「复购率做到四成」不是原话里的字');
  });

  it('五选一的选中项只是大小写和候选不同 —— 换成候选原文（前端一字不差认，不换的话一个都没选中）', () => {
    const r = checkCards(
      [{ template: 'choose', line: 1, endLine: 1, options: ['剪映', 'Premiere'], pick: 'premiere' }],
      [{ id: 1, text: '剪映和Premiere我都用过，最后选了premiere' }], ['choose'],
    );
    expect(r.cards[0].data.pick).toBe('Premiere');
  });

  it('原话说了「第三招」时章节编号用 03，即使第二招没配章节卡（按顺序数会显示 02）', () => {
    const tips = [
      { id: 1, text: '第一招画面切换搜转场' },
      { id: 2, text: '第二招信息爆点搜冲击' },
      { id: 3, text: '第三招元素出现搜UI' },
    ];
    const r = checkCards(
      [
        { template: 'chapter', line: 1, title: '画面切换搜转场' },
        { template: 'keyword', line: 2, key: '冲击' },
        { template: 'chapter', line: 3, title: '元素出现搜UI' },
      ],
      tips, ['chapter', 'keyword'],
    );
    expect(r.cards.filter((c) => c.template === 'chapter').map((c) => c.data.index)).toEqual(['01', '03']);
  });

  it('别的章节说了序号时，原话没说序号的那张不编号（不把「最后的绝招」编成 03）', () => {
    const tips = [
      { id: 1, text: '第一招画面切换搜转场' },
      { id: 2, text: '第二招信息爆点搜冲击' },
      { id: 3, text: '最后被问最多的绝招就是' },
    ];
    const r = checkCards(
      [1, 2, 3].map((line) => ({ template: 'chapter', line, title: tips[line - 1].text.slice(0, 8) })),
      tips, ['chapter'],
    );
    expect(r.cards.map((c) => c.data.index)).toEqual(['01', '02', '']);
  });

  it('章节编号由代码按出现顺序编，模型给的 index 不认', () => {
    const r = checkCards(
      [
        { template: 'chapter', line: 4, title: '三件事', index: '07' },
        { template: 'chapter', line: 1, title: '开场', index: '03' },
      ],
      lines, ALL,
    );
    expect(r.cards.map((c) => [c.line, c.data.index])).toEqual([[1, '01'], [4, '02']]);
  });

  it('中文数字换算：一千二百八十 = 1280、三点五 = 3.5、两万 = 20000（换错的话上屏一个错的数，读起来完全正常）', () => {
    expect([cnToNumber('一千二百八十'), cnToNumber('三点五'), cnToNumber('两万'), cnToNumber('十二')]).toEqual([1280, 3.5, 20000, 12]);
  });

  it('原话「复购率做到了百分之四十」可以配占比环 40，配 4 不行', () => {
    const ls = [{ id: 1, text: '复购率做到了百分之四十' }];
    const ok = checkCards([{ template: 'ring', line: 1, value: '40', title: '复购率' }], ls, ['ring']);
    const bad = checkCards([{ template: 'ring', line: 1, value: '4', title: '复购率' }], ls, ['ring']);
    expect([ok.cards.length, bad.cards.length]).toEqual([1, 0]);
  });

  it('第一步挑了、第二步没填出来的卡进「拦下」并说原因，不悄悄少一张', () => {
    const cands = [
      { k: 1, template: 'number', line: 2, endLine: 2 },
      { k: 2, template: 'list', line: 4, endLine: 6 },
    ];
    const r = mergeFills(cands, [{ k: 1, value: '3000', unit: '%' }], new Map(), lines);
    expect(r.raw.map((c) => c.template)).toEqual(['number']);
    expect(r.rejected).toMatchObject([{ line: 4, why: '第一步挑了这张卡，但第二步没填出来' }]);
  });

  it('第二步擅自改了卡型 / 字幕编号时不认，以第一步为准', () => {
    const r = mergeFills([{ k: 1, template: 'number', line: 2, endLine: 2 }], [{ k: 1, template: 'stamp', line: 5, value: '3000' }], new Map(), lines);
    expect(r.raw[0]).toMatchObject({ template: 'number', line: 2, value: '3000' });
  });
});
