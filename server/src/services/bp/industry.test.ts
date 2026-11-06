import { describe, it, expect } from 'vitest';
import { buildIndustry, buildQueries } from './industryService.js';

const contents = new Map([
  [1, '据艾瑞咨询，2024 年中国宠物智能用品市场规模达 102 亿元，同比增长 18.6%。'],
  [2, '行业集中度较低，CR5 约 18%。'],
]);

describe('行业分析', () => {
  it('数字不在它引的那条资料里时标成「出处里没有」，不能显示成有出处', () => {
    const r = buildIndustry({ kpis: [{ label: '市场规模', value: '3126', unit: '亿元', src: [1] }] }, contents);
    expect(r.kpis[0].unsourced).toBe(true);
  });

  it('引了一个不存在的编号等于没引', () => {
    const r = buildIndustry({ kpis: [{ label: '市场规模', value: '102', unit: '亿元', src: [7] }] }, contents);
    expect(r.kpis[0]).toMatchObject({ src: [], unsourced: true });
  });

  it('数字和增速都在被引资料里才算有出处', () => {
    const r = buildIndustry({ kpis: [{ label: '市场规模', value: '102', unit: '亿元', delta: '+18.6%', src: [1] }] }, contents);
    expect(r.kpis[0].unsourced).toBe(false);
  });

  it('检索词里的年份由代码按当前时间算', () => {
    expect(buildQueries('宠物智能用品', new Date('2026-11-05'))[0]).toBe('宠物智能用品 市场规模 亿元 增速 2025');
  });
});
