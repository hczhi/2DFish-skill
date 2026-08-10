import { describe, it, expect } from 'vitest';
import { buildCard, type FeishuTenderItem } from './feishuNotify.js';

function item(title: string, totalScore: number, extra: Partial<FeishuTenderItem> = {}): FeishuTenderItem {
  return { title, totalScore, tier: 'consider', ...extra };
}

/** 把卡片里所有 lark_md / plain_text 文本拼起来，方便断言「有没有说出来」。 */
function allText(card: any): string {
  const out: string[] = [];
  const walk = (n: any) => {
    if (!n || typeof n !== 'object') return;
    if (typeof n.content === 'string') out.push(n.content);
    for (const v of Object.values(n)) {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') walk(v);
    }
  };
  walk(card);
  return out.join('\n');
}

const titlesInOrder = (card: any): string[] =>
  card.elements
    .filter((e: any) => e.tag === 'div' && e.text?.content?.startsWith('**'))
    .map((e: any) => e.text.content.split('\n')[0].replace(/\*\*|\[|\]\(.*\)/g, ''));

describe('推送卡片：最多 5 条、按分数从高到低', () => {
  it('按分数降序排列，不管传进来的顺序', () => {
    // 评分是按标讯入库顺序产出的，所以传进来基本是乱序的。
    const card = buildCard([
      item('六十一分', 61),
      item('九十二分', 92),
      item('七十七分', 77),
    ]);
    expect(titlesInOrder(card)).toEqual(['九十二分', '七十七分', '六十一分']);
  });

  it('超过 5 条时只列前 5 条 —— 且列的是分数最高的 5 条', () => {
    // 这是排序真正的作用：卡片会截断，不排序的话高分的会被截掉。
    const items = [10, 20, 30, 40, 50, 60, 70, 80].map((s) => item(`${s}分`, s));
    const card = buildCard(items);
    expect(titlesInOrder(card)).toEqual(['80分', '70分', '60分', '50分', '40分']);
  });

  it('被截掉的条数必须写在卡片里', () => {
    // 「本轮 8 条达标」只显示 5 条又不说明，用户眼里就是只有 5 条。
    const card = buildCard(Array.from({ length: 8 }, (_, i) => item(`t${i}`, 90 - i)));
    const text = allText(card);
    expect(text).toContain('还有 **3** 条');
    // 标题里的总数是完整数量，不是显示数量
    expect(card.header.title.content).toContain('8 条');
  });

  it('刚好 5 条时不出现「还有 N 条」', () => {
    const card = buildCard(Array.from({ length: 5 }, (_, i) => item(`t${i}`, 90 - i)));
    expect(allText(card)).not.toContain('还有');
  });

  it('不修改调用方传入的数组（排序用的是副本）', () => {
    const items = [item('a', 10), item('b', 90)];
    buildCard(items);
    expect(items.map((i) => i.title)).toEqual(['a', 'b']);
  });
});

describe('推送卡片：多维表格入口', () => {
  it('有表格地址时底部是跳转按钮（url 型，不是回调型）', () => {
    const card = buildCard([item('x', 80)], 'https://feishu.cn/base/bascnXXX');
    const action = card.elements.find((e: any) => e.tag === 'action');
    expect(action).toBeTruthy();
    const btn = action.actions[0];
    expect(btn.url).toBe('https://feishu.cn/base/bascnXXX');
    // 回调型按钮需要事件订阅地址，标讯模块没有公网回调 —— 点了不会有反应。
    expect(btn.value).toBeUndefined();
    expect(btn.text.content).toContain('全部');
  });

  it('没有表格地址、且内容被截断时，给出替代说明', () => {
    // 卡片截断了却既没有「看全部」的入口也不解释，用户只会以为剩下的丢了。
    const card = buildCard(Array.from({ length: 7 }, (_, i) => item(`t${i}`, 90 - i)));
    expect(card.elements.some((e: any) => e.tag === 'action')).toBe(false);
    expect(allText(card)).toContain('登录平台查看');
  });

  it('没有表格地址、也没有截断时不加多余说明', () => {
    const card = buildCard([item('x', 80)]);
    expect(allText(card)).not.toContain('登录平台查看');
  });
});

describe('推送卡片：内容渲染', () => {
  it('标题里的半角括号被转义，不破坏 markdown 链接', () => {
    // 只转义半角 ( ) [ ]。全角（）不影响 markdown，不该动 —— 标讯标题里
    // 全角括号极常见（「（第二次）」），转义了会在卡片上显示成 \（第二次\）。
    const card = buildCard([item('某项目(第二次)[重招]', 80, { url: 'https://e.com/a' })]);
    const line = card.elements[0].text.content;
    expect(line).toContain('\\(第二次\\)');
    expect(line).toContain('\\[重招\\]');
    expect(line).toContain('](https://e.com/a)');
  });

  it('全角括号不被转义', () => {
    const card = buildCard([item('某项目（第二次）招标', 80)]);
    expect(card.elements[0].text.content).toContain('某项目（第二次）招标');
  });

  it('没有 url 时标题是纯粗体，不生成空链接', () => {
    const card = buildCard([item('无链接项目', 80)]);
    expect(card.elements[0].text.content).toBe('**无链接项目**\n🟡 考虑 · 80分');
  });

  it('元信息行带上等级、分数、采购方、地区、预算', () => {
    const card = buildCard([
      item('x', 88, { tier: 'priority', purchaserName: '某局', regionName: '广东', budgetAmount: 1_500_000 }),
    ]);
    const meta = card.elements[0].text.content.split('\n')[1];
    expect(meta).toBe('🔴 优先 · 88分 · 某局 · 广东 · 预算 150.0 万');
  });

  it('预算为 0/空时不显示「预算 0.0 万」', () => {
    const card = buildCard([item('x', 80, { budgetAmount: 0 })]);
    expect(card.elements[0].text.content).not.toContain('预算');
  });
});
