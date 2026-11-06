import { describe, it, expect, beforeAll } from 'vitest';
import { initDatabase } from '../../db/index.js';
import { buildTeam, membersOf } from './teamService.js';
import { buildCredibility, ratingOf, type Claim } from './credibilityService.js';
import { computeFinancing, numbersOutside, parseHolders } from './financingService.js';
import type { RevenueInput } from './revenueService.js';

beforeAll(() => initDatabase());

const it_ = (field: string, value: string, label = 'disclosed') => ({ field, value, label, quote: '', page: null, doc: null, basis: '' }) as any;
const card = (team: any[] = [], fin: any[] = []) => ({ sections: [{ key: 'team', title: '', items: team }, { key: 'financing', title: '', items: fin }] });
const inp = (key: string, value: number, raw = String(value)): RevenueInput => ({ key, label: key, value, raw, quote: '', page: null, doc: null, rejected: null });

describe('5.10 团队', () => {
  it('名单只取 BP 原文里出现的人名；外部印证的资料里没有这个名字就丢掉，核实状态由代码定', () => {
    const bp = '创始人赵琪，曾任华为交付总监。';
    const roster = membersOf(card([it_('创始人', '赵琪，华为交付背景'), it_('CTO', '某某某，前阿里')]), bp);
    expect(roster.map((m) => m.name)).toEqual(['赵琪']);
    const contents = new Map([[1, '赵琪 曾任华为交付总监'], [2, '另一位张伟的报道']]);
    const t = buildTeam({ members: [{ name: '赵琪', signals: [{ text: '华为任职', src: [1] }, { text: '获奖', src: [2] }] }] }, roster, contents);
    expect(t.members[0]).toMatchObject({ status: '部分核实' });
    expect(t.droppedSignals).toBe(1);
  });
});

describe('5.2 可信度', () => {
  it('标了「已核实」却没引到证据清单里的条目，降成「未核到」', () => {
    const bp = '--- 第 2 页 ---\n当年服务客户 9 家，合格赢单率 87%。';
    const r = buildCredibility({ claims: [{ claim: '当年服务客户 9 家', status: '已核实', evidence: ['E99'] }] }, bp, [{ id: 'E1', kind: 'x', text: 'y' }]);
    expect(r.claims[0]).toMatchObject({ status: '未核到', downgraded: true, page: 2 });
  });

  it('整体评级由代码按占比算：存矛盾两条以上直接判低', () => {
    const c = (status: Claim['status']) => ({ status } as Claim);
    expect(ratingOf([c('已核实'), c('已核实'), c('存矛盾'), c('存矛盾'), c('已核实')]).rating).toBe('低');
    expect(ratingOf([c('已核实'), c('已核实'), c('部分核实')]).rating).toBe('高');
  });
});

describe('09 融资方案', () => {
  const rev = (inputs: RevenueInput[]) => ({ revenue: { inputs, sector: 'general', metrics: [], gaps: [], verdict: '', promptSource: 'default' } } as any);

  it('融资额 / 跑道 / 隐含估值 / 门槛差距都由代码按公式算', () => {
    const f = computeFinancing(rev([inp('fundingAmount', 1000, '1000万'), inp('monthlyBurn', 100, '100万'), inp('annualRevenue', 400, '400万')]),
      card([], [it_('本轮轮次', 'Pre-A')]));
    expect(f.runwayMonths).toBe(10);
    expect(f.askVerdict).toBe('low');
    expect(f.suggestedAsk).toEqual([1800, 2400]);
    // 参考出让 10–15%：投前 = 融资额 ÷ 比例 − 融资额
    expect(f.impliedPre!.map(Math.round)).toEqual([5667, 9000]);
    expect(f.milestones.find((m) => m.label === '年收入')).toMatchObject({ status: 'gap', gap: '还差 600 万元' });
  });

  it('BP 没写轮次时不给参考估值区间（不知道在融哪一轮就没有可比区间）', () => {
    const f = computeFinancing(rev([inp('fundingAmount', 1000, '1000万')]), card());
    expect(f.reference).toBeNull();
    expect(f.valuationVerdict).toBe('unknown');
  });

  it('建议文字里出现系统没算出来的数字会被列出来（1.2 亿 = 12000 万元算对得上）', () => {
    expect(numbersOutside('建议投前 1.2 亿，出让 15%，另外估值 3.5 亿也可以', { a: 12000, b: '10–15%' })).toEqual(['3.5']);
  });

  it('股东比例从信用档案文本里解析', () => {
    expect(parseHolders('赵琪 92.59%；深圳成我未来企业管理合伙企业 7.41%')).toEqual([
      { name: '赵琪', pct: 92.59 }, { name: '深圳成我未来企业管理合伙企业', pct: 7.41 },
    ]);
  });
});
