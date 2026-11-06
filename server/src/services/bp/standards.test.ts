import { describe, it, expect } from 'vitest';
import { stageOf, sectorMetrics } from './standards.js';
import { buildKeywords } from './keywordsService.js';
import type { RevenueInput } from './revenueService.js';

const card = (round: string) => ({ sections: [{ key: 'financing', title: '', items: [{ field: '本轮轮次', value: round, label: 'disclosed' as const, quote: '', page: null, doc: null, basis: '' }] }] });
const inp = (key: string, value: number, raw = String(value)): RevenueInput => ({ key, label: key, value, raw, quote: '', page: null, doc: null, rejected: null });

describe('分阶段标尺 / 分行业指标', () => {
  it('轮次由代码认：Pre-A+ 不会被当成 A 轮，认不出的不猜', () => {
    expect(stageOf(card('Pre-A+轮')).stage).toBe('preA');
    expect(stageOf(card('A+ 轮')).stage).toBe('A');
    expect(stageOf(card('B轮')).stage).toBe('B');
    expect(stageOf(card('天使轮')).stage).toBe('angel');
    expect(stageOf(card('战略融资'))).toMatchObject({ stage: 'general', basis: expect.stringContaining('认不出') });
  });

  it('模型给的行业不在清单里就按通用，不会对不上任何模板却显示成某个行业', () => {
    expect(buildKeywords({ segment: 'AI 交付服务', sector: 'AI+SaaS 混合型' }, '企业服务').sector).toBe('general');
    expect(buildKeywords({ segment: 'AI 交付服务', sector: 'ai_service' }, '企业服务').sector).toBe('ai_service');
  });

  it('行业专属比率由代码算：AI 服务的人效 = 年收入 ÷ 员工数，低于 50 万 / 人判风险', () => {
    const m = sectorMetrics('ai_service', [inp('employees', 40, '40人')], 1200, null, null).metrics;
    expect(m.find((x) => x.name === '人均年收入（人效）')).toMatchObject({ value: '30 万元', status: 'risk', group: 'sector' });
  });

  it('BP 没给的行业指标照样列出来标未披露并进缺口，不悄悄少一项', () => {
    const r = sectorMetrics('saas', [], null, null, null);
    expect(r.metrics.map((x) => x.value)).toEqual(['未披露', '未披露', '未披露', '不可计算']);
    expect(r.gaps.map((g) => g.item)).toContain('ARR');
  });
});
