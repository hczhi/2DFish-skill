import { describe, it, expect } from 'vitest';
import { buildConsistency } from './consistencyService.js';

const BP = [
  '--- 第 3 页 ---',
  '公司 2024 年收入 200 万元，服务客户 20 家。',
  '--- 第 9 页 ---',
  '注：上述 200 万元为成立以来累计收入。',
].join('\n');

describe('BP 一致性交叉表', () => {
  it('一处原文核不上的「口径冲突」整条丢掉，不显示成冲突也不降成单点', () => {
    const r = buildConsistency(
      {
        items: [{
          metric: '收入', status: 'conflict', severity: '致命',
          values: [{ quote: '公司 2024 年收入 200 万元' }, { quote: '年度收入为 80 万元' }],
          impact: '',
        }],
      },
      BP
    );
    expect(r.items).toEqual([]);
    expect(r.dropped).toEqual(['收入']);
  });

  it('同一段原文抄两遍不算两处，凑不成冲突', () => {
    const q = '公司 2024 年收入 200 万元';
    const r = buildConsistency(
      { items: [{ metric: '收入', status: 'conflict', values: [{ quote: q }, { quote: `「${q}」` }] }] },
      BP
    );
    expect(r.items).toEqual([]);
  });

  it('两处都核得上的冲突保留，页码由代码算', () => {
    const r = buildConsistency(
      {
        items: [{
          metric: '收入', status: 'conflict', severity: '致命',
          values: [{ quote: '公司 2024 年收入 200 万元', page: 1 }, { quote: '200 万元为成立以来累计收入' }],
        }],
      },
      BP
    );
    expect(r.items[0].values.map((v) => v.page)).toEqual([3, 9]);
  });
});
