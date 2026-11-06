import { describe, it, expect } from 'vitest';
import { verifyInputs, buildRevenue, parseAmount } from './revenueService.js';

const BP = [
  '--- 第 2 页 ---',
  '2024 年实现营业收入 1.2 亿元，服务付费客户 40 家。',
  '--- 第 7 页 ---',
  '预计 2025 年第一大客户占比降至 30%。本轮拟融资 6000 万元，目前月均净亏损 800 万元。',
].join('\n');

const metric = (inputs: any) => {
  const r = buildRevenue(verifyInputs({ inputs }, BP));
  return (name: string) => r.metrics.find((m) => m.name === name);
};

describe('收入质量体检', () => {
  it('「1.2亿元」由代码换算成 12000 万元，不信模型换算', () => {
    expect(parseAmount('1.2亿元')).toBe(12000);
    expect(parseAmount('200')).toBeNull(); // 没单位不猜
  });

  it('累计月数从原文的起止年月算，不把「2023年」读成 2023×12 个月', () => {
    const text = '--- 第 1 页 ---\n2023年3月至2024年6月累计收入 300万元。';
    const r = buildRevenue(verifyInputs({ inputs: {
      cumulativeRevenue: { raw: '300万元', quote: '累计收入 300万元' },
      cumulativeMonths: { raw: '2023年3月至2024年6月', quote: '2023年3月至2024年6月累计收入' },
    } }, text));
    expect(r.metrics.find((m) => m.name === '年化收入（推算）')?.value).toBe('约 240 万元');
  });

  it('数字不在它引的原文里时不参与计算，年度收入显示未披露', () => {
    const m = metric({ annualRevenue: { raw: '3亿元', quote: '2024 年实现营业收入 1.2 亿元' } });
    expect(m('年度收入')?.value).toBe('未披露');
  });

  it('引文是预测数的不算实际占比，不会判成「良好」', () => {
    const m = metric({ top1Share: { raw: '30%', quote: '预计 2025 年第一大客户占比降至 30%' } });
    expect(m('第一大客户占比')).toBeUndefined();
    expect(m('客户集中度')?.value).toBe('未披露');
  });

  it('现金跑道按 融资额 ÷ 月均净烧 算，<12 个月判风险', () => {
    const m = metric({
      fundingAmount: { raw: '6000万元', quote: '本轮拟融资 6000 万元' },
      monthlyBurn: { raw: '800万元', quote: '目前月均净亏损 800 万元' },
    });
    expect(m('现金跑道')).toMatchObject({ value: '约 7.5 个月', status: 'risk' });
  });
});
