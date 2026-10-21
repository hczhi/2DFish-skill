import { describe, it, expect } from 'vitest';
import { buildCard } from './factCardService.js';

const BP = [
  '--- 第 1 页 ---',
  '深蓝智造 成立于 2021 年，总部位于苏州。',
  '--- 第 2 页 ---',
  '2024 年营业收入 3200 万元，本轮 A 轮拟融资 5000 万元。',
].join('\n');

const item = (sections: any, key: string, field: string) =>
  buildCard({ sections }, BP).sections.find((s) => s.key === key)!.items.find((i) => i.field === field)!;

describe('BP 事实卡', () => {
  it('标成「材料披露」但原文里找不到那句的，不能显示成材料披露', () => {
    const it1 = item(
      { financing: [{ field: '估值', value: '投前 3 亿元', label: 'disclosed', quote: '投前估值 3 亿元' }] },
      'financing',
      '估值'
    );
    expect(it1.label).toBe('unverified');
  });

  it('页码按引文所在位置算，不信模型', () => {
    const it1 = item(
      { operations: [{ field: '收入', value: '3200 万元', label: 'disclosed', quote: '2024年营业收入3200万元', page: 1 }] },
      'operations',
      '收入'
    );
    expect(it1).toMatchObject({ label: 'disclosed', page: 2 });
  });

  it('模型漏掉的必有字段显示成「未披露」，而不是那一行不存在', () => {
    const card = buildCard({ sections: { financing: [] } }, BP);
    const fields = card.sections.find((s) => s.key === 'financing')!.items.map((i) => [i.field, i.label]);
    expect(fields).toContainEqual(['估值', 'missing']);
  });
});
