import { describe, it, expect } from 'vitest';
import { buildCompetitors, applyFunding } from './competitorService.js';
import { buildInvestors } from './investorService.js';
import { scoreDims } from './diagnosisService.js';
import { buildFixes } from './adviceService.js';

const contents = new Map([
  [1, '智能质检赛道主要玩家包括 深度视觉、慧眼科技 等。'],
  [2, '深度视觉 完成 B 轮 2 亿元融资，由红杉中国领投，高瓴跟投。红杉中国合伙人周逵表示看好。'],
  [3, '行业新闻：某机构发布年度报告。'],
]);

describe('07 竞品', () => {
  it('资料里找不到名字的竞品整家丢掉，并报出来', () => {
    const r = buildCompetitors({ competitors: [{ name: '深度视觉', src: [1] }, { name: '编出来科技', src: [1] }] }, contents, '我方');
    expect(r.competitors.map((c) => c.name)).toEqual(['深度视觉']);
    expect(r.dropped).toEqual(['编出来科技']);
  });

  it('融资轮次的投资方不在被引资料里时去掉，不显示成投资方', () => {
    const { competitors, dropped } = buildCompetitors({ competitors: [{ name: '深度视觉', src: [1] }] }, contents, '');
    applyFunding(competitors, { funding: [{ name: '深度视觉', rounds: [{ round: 'B 轮', amount: '2 亿元', investors: ['红杉中国', '经纬创投'], lead: '红杉中国', src: [2] }] }] }, contents, dropped);
    expect(competitors[0].rounds[0].investors).toEqual(['红杉中国']);
    expect(dropped).toContain('经纬创投（深度视觉 的投资方）');
  });

  it('被引资料里没提到这家竞品的融资不挂到它头上', () => {
    const { competitors, dropped } = buildCompetitors({ competitors: [{ name: '慧眼科技', src: [1] }] }, contents, '');
    applyFunding(competitors, { funding: [{ name: '慧眼科技', rounds: [{ round: 'B 轮', amount: '2 亿元', investors: ['红杉中国'], src: [2] }] }] }, contents, dropped);
    expect(competitors[0].rounds).toEqual([]);
  });
});

describe('09 目标融资对象', () => {
  it('资料里查不到的合伙人名字清空、标部分公开，并留下模型给的那个名字', () => {
    const r = buildInvestors({ investors: [{ name: '红杉中国', partner: '张三', circle: '已投同类', src: [2] }] }, contents);
    expect(r.investors[0]).toMatchObject({ partner: '', partnerRejected: '张三', confidence: '部分公开' });
  });

  it('资料里有的合伙人保留、标已公开', () => {
    const r = buildInvestors({ investors: [{ name: '红杉中国', partner: '周逵', src: [2] }] }, contents);
    expect(r.investors[0]).toMatchObject({ partner: '周逵', confidence: '已公开' });
  });
});

describe('01-02 五维评分', () => {
  const dims = (o: Record<string, [number, number]>) => ({
    dims: Object.fromEntries(Object.entries(o).map(([k, [fact, proof]]) => [k, { fact, proof }])),
  });

  it('总分 / 可回收分 / 梯队由代码算，展示用 100 分制', () => {
    const r = scoreDims(dims({ market: [70, 50], tech: [80, 40], commercial: [50, 60], team: [60, 60], capital: [40, 30] }), '');
    expect(r.total).toBe(300);
    expect(r.totalP).toBe(60);
    expect(r.band).toBe('第三梯队');
    // 商业化举证 > 事实那一维不算负的可回收分
    expect(r.recoverable).toBe(20 + 40 + 0 + 0 + 10);
    expect(r.recoverableP).toBe(14);
  });

  it('五维缺一维直接报错，不按四维算总分', () => {
    expect(() => scoreDims(dims({ market: [70, 50], tech: [80, 40], commercial: [50, 60], team: [60, 60] }), '')).toThrow(/资本化/);
  });
});

describe('03 BP 优化', () => {
  it('原句在 BP 里核不上的改写建议丢掉并计数', () => {
    const bp = '--- 第 4 页 ---\n我们是行业领先的智能质检平台。';
    const r = buildFixes({ fixes: [{ quote: '我们是行业领先的智能质检平台', rewrite: '…' }, { quote: '我们年收入 5000 万', rewrite: '…' }] }, bp);
    expect(r.fixes.map((f) => f.page)).toEqual([4]);
    expect(r.droppedFixes).toBe(1);
  });
});

describe('5.1 企业信用档案', () => {
  const credit = new Map([
    [1, '苏州深蓝智造科技有限公司 法定代表人 王明，注册资本 1000 万元。'],
    [2, '深蓝智造（深圳）被执行人信息：执行标的 300 万元。'],
  ]);

  it('被引资料里没有这家公司全称的（同名 / 简称命中）不算查到', async () => {
    const { buildCredit } = await import('./creditService.js');
    const items = buildCredit({ items: { lawsuits: { value: '被执行 300 万元', src: [2] } } }, credit, '苏州深蓝智造科技有限公司');
    expect(items.find((i) => i.key === 'lawsuits')).toMatchObject({ found: false, otherCompany: true, value: '公开网页未检索到（不代表没有）' });
  });

  it('模型写「无」不能显示成「无」，一律是没查到', async () => {
    const { buildCredit } = await import('./creditService.js');
    const items = buildCredit({ items: { penalties: { value: '无', src: [1] } } }, credit, '苏州深蓝智造科技有限公司');
    expect(items.find((i) => i.key === 'penalties')).toMatchObject({ found: false, value: '公开网页未检索到（不代表没有）' });
  });
});

describe('01 体检结论：模型把结论放错层', () => {
  const five = { market: { fact: 60, proof: 40 }, tech: { fact: 60, proof: 40 }, commercial: { fact: 60, proof: 40 }, team: { fact: 60, proof: 40 }, capital: { fact: 60, proof: 40 } };

  it('top3 / verdict 被塞进 dims 里时照样取出来，不显示成空', () => {
    const r = scoreDims({ dims: { ...five, verdict: '方向对', top3: [{ title: '补收入表', why: 'w', fix: 'f' }] } }, '');
    expect(r.top3.map((t) => t.title)).toEqual(['补收入表']);
    expect(r.missingParts).toEqual([]);
  });

  it('真没给的时候记下来，界面据此提示重跑', () => {
    expect(scoreDims({ dims: five }, '').missingParts).toEqual(['verdict', 'top3']);
  });
});
