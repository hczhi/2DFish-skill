import { describe, it, expect } from 'vitest';
import { __testables } from './ygcgCrawlerService.js';

const { extractContentTxt, extractDeadline, extractBudget, extractFromDetail, stripHtml, absoluteUrl, isExcludedTitle } = __testables;

describe('absoluteUrl', () => {
  it('补全两种列表 url 形态', () => {
    expect(absoluteUrl('/p92/hw/20260806/429989.html')).toBe('https://ygcg.gzggzy.cn/p92/hw/20260806/429989.html');
    expect(absoluteUrl('/hw/429195.jhtml')).toBe('https://ygcg.gzggzy.cn/hw/429195.jhtml');
  });

  it('已是绝对地址就原样返回', () => {
    expect(absoluteUrl('https://ygcg.gzggzy.cn/qt/1.jhtml')).toBe('https://ygcg.gzggzy.cn/qt/1.jhtml');
  });
});

describe('extractContentTxt', () => {
  it('取到配平的整段正文，不在第一个内层 </div> 截断', () => {
    const html = `<div class="content"><div class="content_txt"><div><p>项目名称</p></div><div>预算</div></div></div><div class="footer">粤ICP备</div>`;
    const body = extractContentTxt(html);
    expect(body).toContain('项目名称');
    expect(body).toContain('预算');
    expect(body).not.toContain('粤ICP备');
  });

  it('没有 content_txt 容器时返回空串', () => {
    expect(extractContentTxt('<div class="other">x</div>')).toBe('');
  });

  it('标签未闭合时退回到开始标签之后的全部，而不是返回空串', () => {
    const body = extractContentTxt('<div class="content_txt"><p>项目名称：测试项目');
    expect(body).toContain('测试项目');
  });
});

describe('extractDeadline', () => {
  // 以下字符串全部来自实际抓取的 40 条样本（strip 之后的形态）
  it('中文日期 + 「上午9时」', () => {
    expect(extractDeadline('报价截止时间为 2026 年 08 月 11 日 上午 9 时之前')).toBe('2026-08-11 09:00:00');
  });

  it('响应文件递交截止时间 + 24 时制', () => {
    expect(extractDeadline('九、响应文件递交截止时间 2026 年 08 月 12 日 10:00 十、')).toBe('2026-08-12 10:00:00');
  });

  it('横线日期形态', () => {
    expect(extractDeadline('递交资格预审/投标文件截止时间 2026-08-27 09:30:00')).toBe('2026-08-27 09:30:00');
  });

  it('斜线日期形态', () => {
    expect(extractDeadline('递交标书截止时间：2026/8/19 09:00 递交地址')).toBe('2026-08-19 09:00:00');
  });

  it('CMS 把数字拆成「202 6 年」也要能解析（富文本 span 被 strip 成空格）', () => {
    expect(extractDeadline('九、响应文件递交截止时间 202 6 年 8 月 13 日 09 :00 十、')).toBe('2026-08-13 09:00:00');
    expect(extractDeadline('报价截止时间为 202 6 年 8 月 9 日 17:00；')).toBe('2026-08-09 17:00:00');
  });

  it('「下午13：30」不再 +12（下午和 24 时制混写）', () => {
    expect(extractDeadline('递交投标文件截止时间：2026 年 8 月 27 日 下午 13：30')).toBe('2026-08-27 13:30:00');
  });

  it('「下午2时」要 +12', () => {
    expect(extractDeadline('报名截止时间：2026 年 8 月 27 日 下午 2 时 00')).toBe('2026-08-27 14:00:00');
  });

  it('没有时刻时补 00:00:00', () => {
    expect(extractDeadline('响应文件递交截止时间：2026年8月14日')).toBe('2026-08-14 00:00:00');
  });

  it('带「报名/递交」前缀的优先于裸「截止时间」和「公告结束时间」', () => {
    const text = '七、公告结束时间 2026 年 8 月 8 日 九、响应文件递交截止时间 2026 年 8 月 13 日 09:00';
    expect(extractDeadline(text)).toBe('2026-08-13 09:00:00');
  });

  it('公告结束时间作为最后兜底', () => {
    expect(extractDeadline('六、公告开始时间 2026-08-06 七、公告结束时间 2026-08-17 09:00')).toBe('2026-08-17 09:00:00');
  });

  it('资格条款里的「截止投标截止时间前成立期限」不产生假日期', () => {
    expect(extractDeadline('截止投标截止时间前成立期限不足两年的，应提供财务报表。')).toBe('');
  });

  it('正文完全没有截止时间就返回空串，不瞎猜', () => {
    expect(extractDeadline('报名截止时间：公告发布之日起招募期5天（自然日）。')).toBe('');
  });

  it('离谱年份不采纳', () => {
    expect(extractDeadline('报名截止时间：1026 年 8 月 9 日')).toBe('');
  });
});

describe('extractBudget', () => {
  it('¥ 前缀 + 元', () => {
    expect(extractBudget('五．采购控制价 ¥500,000元 六．')).toEqual({
      budget: '采购控制价 ¥500,000元',
      budgetAmount: 500000,
    });
  });

  it('「预算（控制价）：人民币914,200元」', () => {
    expect(extractBudget('预算（控制价）：人民币914,200元').budgetAmount).toBe(914200);
  });

  it('万元要乘 10000', () => {
    expect(extractBudget('预算（最高限价）59万元').budgetAmount).toBe(590000);
  });

  it('「万」在捕获组外时不放大以元为单位的预算（历史 bug）', () => {
    // 正文别处出现「万」（投标保证金贰万元整），预算本身是元
    const text = '项目控制价：125000.00 元。投标保证金贰万元整。';
    expect(extractBudget(text).budgetAmount).toBe(125000);
  });

  it('数字被 CMS 拆开也能解析', () => {
    expect(extractBudget('采购控制价 总价包干 ¥9 9800 元').budgetAmount).toBe(99800);
  });

  it('没有预算返回 0', () => {
    expect(extractBudget('本项目不公开预算。')).toEqual({ budget: '', budgetAmount: 0 });
  });

  it('金额为 0 不算命中', () => {
    expect(extractBudget('控制价：0元').budgetAmount).toBe(0);
  });
});

describe('extractFromDetail', () => {
  it('抽采购人 / 联系人 / 电话', () => {
    const text = '采购人名称： 中山珠江啤酒有限公司 联系人： 陈小军 联系电话： 13420495736';
    const r = extractFromDetail(text);
    expect(r.purchaserName).toBe('中山珠江啤酒有限公司');
    expect(r.contactName).toBe('陈小军');
    expect(r.contactPhone).toBe('13420495736');
  });

  it('带区号的电话去掉内部空格', () => {
    expect(extractFromDetail('联系电话： 020-33972487').contactPhone).toBe('020-33972487');
  });

  it('丢掉「（盖章）」这类占位，不存成采购方', () => {
    expect(extractFromDetail('招标人：（盖章）').purchaserName).toBe('');
  });

  it('抽不到就留空串', () => {
    expect(extractFromDetail('本公告无联系方式。').purchaserName).toBe('');
  });
});

describe('isExcludedTitle', () => {
  it('挡掉结果类 / 无法报名的公告', () => {
    for (const t of [
      '某项目中标结果公告',
      '某项目成交公告',
      '2026年度宣传品及宣传活动服务项目失败公告',
      '某项目终止公告',
      '某项目中标候选人公示',
      '车载智能视频可视化监管系统运维服务合同公告',
    ]) {
      expect(isExcludedTitle(t), t).toBe(true);
    }
  });

  it('放过还能报名的公告', () => {
    for (const t of [
      'VT系列135mm上下壳偏摆落料模具采购公告',
      '穗云水厂深度处理工程造价咨询服务招标公告',
      '船务公司信息机房网络安全加固项目资格预审公告',
    ]) {
      expect(isExcludedTitle(t), t).toBe(false);
    }
  });
});

describe('不按报名状态过滤（ygcg 全量抓取）', () => {
  // 这个站没有状态字段，截止时间只能从正文里猜（覆盖率约 85%，且「公告结束时间」
  // 兜底出来的值偏早）。拿这种推断值删数据会丢掉还能报的项目，所以只解析、不过滤。
  // 这里锁住这个决定：模块不该再导出「是否已结束」的判断。
  it('不导出报名状态判断函数', () => {
    expect('isClosed' in __testables).toBe(false);
  });

  it('已过期的截止时间照样解析出来（入库供用户自己判断，不丢弃）', () => {
    expect(extractDeadline('响应文件递交截止时间 2020 年 1 月 1 日 09:00')).toBe('2020-01-01 09:00:00');
  });
});

describe('stripHtml', () => {
  it('去标签并还原平台实际用到的实体', () => {
    expect(stripHtml('<p>控制价 &yen;500,000元 &amp; &nbsp;含税</p>')).toBe('控制价 ¥500,000元 & 含税');
  });

  it('丢掉 script / style', () => {
    expect(stripHtml('<style>.a{}</style><script>var a=1</script><p>正文</p>')).toBe('正文');
  });
});
