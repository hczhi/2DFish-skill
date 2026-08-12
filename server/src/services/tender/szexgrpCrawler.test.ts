import { describe, it, expect } from 'vitest';
import { __testables } from './szexgrpCrawlerService.js';

const { extractBudget, extractRegion, isOpenForRegistration, detailPageUrl, WANTED_NOTICE_CODES } = __testables;

// 这个站的正文是模板渲染的「标签 值」对，单位写在标签括号里。
// 下面几条都是「解析错了不会报错，只会让标讯带着错的数字进推荐池」的路径。
describe('szexgrp 预算解析', () => {
  it('下浮率报价的「采购控制价（%） 8」不能被当成 8 元预算', () => {
    // 真实样本：预算 390 万的工程，控制价那一栏写的是下浮率百分比。
    // 存成 8 元的话，评分时预算轴判「远低于下限」压到底分，
    // 而后台一切正常显示「已评分」—— 用户永远看不到这个 390 万的项目。
    const text = '报价方式 下浮率 采购控制价（%） 8 采购控制价说明 本项目预算金额为390万元，采用下浮率进行报价。';
    expect(extractBudget(text).budgetAmount).not.toBe(8);
    // 单位白名单挡掉 %，兜底正则再从说明里捞到真实的 390 万。
    // 捞不到也没关系（留 0 走中性分），捞成 8 才是灾难。
    expect(extractBudget(text).budgetAmount).toBe(3_900_000);
  });

  it('只有 %、说明里也没写金额时留空，不退而用那个百分数', () => {
    expect(extractBudget('报价方式 下浮率 采购控制价（%） 8 评审方法 综合评估法'))
      .toEqual({ budget: '', budgetAmount: 0 });
  });

  it('「采购控制价（元） 683900」取到 683900，不乘 10000', () => {
    const r = extractBudget('标段编号 YG26QG0046317-01 报价方式 总价 采购控制价（元） 683900 采购控制价（大写） 陆拾捌万叁仟玖佰元整');
    expect(r.budgetAmount).toBe(683900);
  });

  it('「采购控制价（万元） 38」要乘 10000', () => {
    expect(extractBudget('采购控制价（万元） 38 评审方法 综合评估法').budgetAmount).toBe(380000);
  });
});

describe('szexgrp 项目地址解析', () => {
  it('取到省市区，不把后面的「项目类型」吃进来', () => {
    // 吃进来的话 region_name 变成「广东省深圳市宝安区 项目类型 工程」，
    // scoreRegion 的 includes 仍能命中「深圳」，所以不会报错 ——
    // 只是多维表格和前端的地区列显示成一句怪话。
    expect(extractRegion('项目编号 YG26QG0047483 项目地址 广东省深圳市宝安区 项目类型 工程 采购方式 公开招标'))
      .toBe('广东省深圳市宝安区');
  });

  it('外地项目照原样保留，不按「深圳」纠正', () => {
    // 抽空了的话地区轴拿 50 分中性分，用户配的「排除外地」拦不住它。
    expect(extractRegion('项目地址 贵州省黔南布依族苗族自治州龙里县 项目类型 服务'))
      .toBe('贵州省黔南布依族苗族自治州龙里县');
  });
});

describe('szexgrp 报名截止过滤', () => {
  it('解析不出截止时间时放过，不静默丢光', () => {
    // 平台改了日期格式的那天，如果这里返回 false，
    // 当天所有在报项目会一条不入库，而爬取日志显示「Done: 0 new」。
    const now = Date.parse('2026-08-11T12:00:00');
    expect(isOpenForRegistration(null, now)).toBe(true);
    expect(isOpenForRegistration('待定', now)).toBe(true);
  });

  it('已过截止的挡掉，未过的放过', () => {
    const now = Date.parse('2026-08-11T12:00:00');
    expect(isOpenForRegistration('2026-08-10 18:00:00', now)).toBe(false);
    expect(isOpenForRegistration('2026-08-19 10:30:00', now)).toBe(true);
  });
});

// 链接坏掉的表现是「页面卡在 loading」——不报错、不 404、后台写「已处理」。
// 三条都是「拼错了看起来像成功」的路径。
describe('szexgrp 详情链接', () => {
  it('必须带 bidSectionNumber（缺了详情页 JS 直接 return，永远转圈）', () => {
    const url = detailPageUrl({
      contentId: 20564530,
      bidSectionNumber: 'YG26QG0047043-01',
      noticeTypeCode: 'ygcg_cggg',
    } as any);
    expect(url).toBe('https://ygcg.szexgrp.com/jyxxDetails.htm?bidSectionNumber=YG26QG0047043-01&contentId=20564530&code=cggg');
  });

  it('bidSectionNumber 为空时换 details.htm（意向征集有 3/200 是空的）', () => {
    // 仍拼 jyxxDetails 的话这几条稳定是转圈页；details.htm 只认 contentId。
    expect(detailPageUrl({ contentId: 20571616, bidSectionNumber: '', noticeTypeCode: 'ygcg_cgzb_xjgg' } as any))
      .toBe('https://ygcg.szexgrp.com/details.htm?contentId=20571616');
  });

  it('code 只取 noticeTypeCode 的第二段', () => {
    // 站内 home.js 就是 split('_')[1]，`ygcg_cgzb_xjgg` → `cgzb`。
    expect(detailPageUrl({ contentId: 1, bidSectionNumber: 'X-01', noticeTypeCode: 'ygcg_cgzb_xjgg' } as any))
      .toContain('&code=cgzb');
  });
});

describe('szexgrp 公告类型白名单', () => {
  it('只放可报名的三类，结果/公示类不在内', () => {
    // 白名单按 noticeTypeCode 而不是中文名：中文名是 CMS 可改的展示文案，
    // 改了之后整类公告会静默一条都不入库（列表照样返回）。
    expect([...WANTED_NOTICE_CODES].sort()).toEqual(['ygcg_cggg', 'ygcg_cgzb_xjgg', 'ygcg_yqh']);
    for (const code of ['ygcg_hxrgs', 'ygcg_jggs', 'ygcg_dbjggs', 'ygcg_htxqgs', 'ygcg_qtgs']) {
      expect(WANTED_NOTICE_CODES.has(code)).toBe(false);
    }
  });
});
