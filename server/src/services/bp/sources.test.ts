import { describe, it, expect, vi } from 'vitest';

vi.mock('../webSearchService.js', () => ({
  webSearch: vi.fn(async () => [
    { title: '同名公司新闻', url: 'https://news.example.com/a', content: '无关的摘要', score: 0.9, published: '2026-01-02', raw: '' },
    { title: '公众号转载', url: 'https://mp.weixin.qq.com/s/x', content: '市场规模 102 亿元', score: 0.8, published: '', raw: '' },
    { title: '统计局', url: 'https://www.stats.gov.cn/x', content: '市场规模 102 亿元', score: 0.5, published: '2025-03-01', raw: '' },
  ]),
}));

import { gatherSources, corroboration, tierOf, pickPassages } from './sources.js';
import { buildKeywords } from './keywordsService.js';

describe('联网资料层', () => {
  it('勾掉的链接不再进资料，用户补的资料排 [1]，官方来源排在自媒体前面', async () => {
    const g = await gatherSources(['q'], {
      chapter: '测试', exclude: new Set(['https://news.example.com/a']),
      extra: [{ title: '用户研报', url: 'upload://1', content: '这是一份研报，市场规模 102 亿元。'.repeat(20) }],
    });
    expect(g.sources.map((s) => s.url)).toEqual(['upload://1', 'https://www.stats.gov.cn/x', 'https://mp.weixin.qq.com/s/x']);
    expect(g.sources.map((s) => s.tier)).toEqual([0, 1, 4]);
  });

  it('同一个域名的两篇只算一个来源，年份不算可比数字', () => {
    const sources = [
      { n: 1, title: '', url: 'https://a.36kr.com/1', published: '', tier: 3 as const, domain: '36kr.com', stale: false },
      { n: 2, title: '', url: 'https://www.36kr.com/2', published: '', tier: 3 as const, domain: '36kr.com', stale: false },
      { n: 3, title: '', url: 'https://www.caixin.com/3', published: '', tier: 2 as const, domain: 'caixin.com', stale: false },
    ];
    const contents = new Map([[1, '2025 年规模 449 亿'], [2, '规模达 449 亿元'], [3, '2025 年行业回顾']]);
    expect(corroboration('449 亿元', contents, sources)).toBe(1);
    expect(corroboration('2025', contents, sources)).toBe(0);
  });

  it('公众号 / 百家号算自媒体，认不出的域名不降成自媒体', () => {
    expect(tierOf('https://mp.weixin.qq.com/s/abc')).toBe(4);
    expect(tierOf('https://baijiahao.baidu.com/s?id=1')).toBe(4);
    expect(tierOf('https://www.some-company.com/about')).toBe(3);
  });

  it('摘要里没有的数字段落会从正文里挑出来给模型', () => {
    const full = ['导航 首页 关于我们', '据 IDC 统计，2025 年中国企业级智能体市场规模达 212 亿元，同比增长 112%。', '推荐阅读：其他新闻'].join('\n');
    expect(pickPassages('一篇关于智能体的报道', full, ['智能体'])).toContain('212 亿元');
  });

  it('提炼词里的数字和标点去掉；没给细分赛道词时退回所属行业并说出原因', () => {
    expect(buildKeywords({ segment: '「AI 智能体交付」2026' }, '企业服务').segment).toBe('AI 智能体交付');
    expect(buildKeywords({ segment: '' }, '企业服务')).toMatchObject({ segment: '企业服务', fallback: expect.stringContaining('没给出') });
  });
});

describe('用户补的资料', () => {
  it('段落一个关键词都没命中时也不会被丢掉（退回取正文开头）', () => {
    expect(pickPassages('', '这是一份没有任何关键词命中的长文。'.repeat(30), ['智能体']).length).toBeGreaterThan(100);
  });
});
