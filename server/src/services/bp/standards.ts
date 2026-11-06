import type { FactCard } from './factCardService.js';
import type { RevenueInput, RevenueMetric } from './revenueService.js';

// 分行业指标模板 + 分阶段标尺的「代码那一半」：
// - 行业清单固定在这里，模型只能从里面选（keywordsService），不认识的归 general —— 让模型自由写行业名的话，
//   「AI+SaaS 混合型」这种名字对不上任何模板，5.12 静默退回通用指标而报告上写着它是 SaaS。
// - 轮次由代码从事实卡「本轮轮次」认（stageOf），不问模型。
// - 每个行业的专属指标：模型只摘原始数字（同 5.12 通用指标），**公式、阈值、状态全在 sectorMetrics 里**。
//   阈值是行业常见口径，写在代码里、改动走代码评审；判档不交给模型（它会对每家都说「处于行业良好水平」）。

export const SECTORS = {
  saas: 'SaaS / 软件订阅',
  ai_service: 'AI 应用与服务（项目制 / 驻场）',
  hardware: '智能硬件',
  consumer: '消费品 / 品牌',
  healthcare: '医疗健康',
  manufacturing: '先进制造 / 工业',
  platform: '平台 / 交易撮合',
  general: '通用',
} as const;
export type Sector = keyof typeof SECTORS;
export const isSector = (s: unknown): s is Sector => typeof s === 'string' && Object.prototype.hasOwnProperty.call(SECTORS, s);

export const STAGES = { angel: '天使 / 种子轮', preA: 'Pre-A 轮', A: 'A 轮', B: 'B 轮及以后', general: '未写明轮次' } as const;
export type Stage = keyof typeof STAGES;

/** 从事实卡「本轮轮次」认轮次。认不出就是 general（并说出原文），不猜。 */
export function stageOf(card: Pick<FactCard, 'sections'>): { stage: Stage; basis: string } {
  const it = card.sections.find((s) => s.key === 'financing')?.items.find((i) => i.field === '本轮轮次' && i.label !== 'missing');
  const v = (it?.value || '').replace(/\s/g, '').toUpperCase();
  if (!v) return { stage: 'general', basis: 'BP 没写本轮轮次' };
  const basis = `BP 写明「${it!.value}」`;
  const t = v.replace(/轮|融资|系列|ROUND|\(.*?\)|（.*?）/g, '');
  if (/天使|种子|SEED|ANGEL/.test(t)) return { stage: 'angel', basis };
  if (/PRE-?A/.test(t)) return { stage: 'preA', basis };
  if (/^A\+*$/.test(t)) return { stage: 'A', basis };
  if (/^[B-F]\+*$/.test(t) || /PRE-?IPO|IPO/.test(t)) return { stage: 'B', basis };
  return { stage: 'general', basis: `BP 写的是「${it!.value}」，认不出对应哪一轮` };
}

/** 各行业要多摘的原始数字（单位同 revenueService：amount 万元 / percent / count / months / text）。 */
export const SECTOR_INPUTS: Record<Sector, { key: string; label: string; unit: 'amount' | 'percent' | 'count' | 'months' | 'text' }[]> = {
  saas: [
    { key: 'arr', label: 'ARR（年度经常性收入）', unit: 'amount' },
    { key: 'ndr', label: '净收入留存率 NDR', unit: 'percent' },
    { key: 'logoChurn', label: '年客户流失率', unit: 'percent' },
    { key: 'cac', label: '单客户获客成本 CAC', unit: 'amount' },
  ],
  ai_service: [
    { key: 'employees', label: '员工总数', unit: 'count' },
    { key: 'productShare', label: '产品化 / 标准化收入占比（非人天收入）', unit: 'percent' },
    { key: 'deliveryMonths', label: '单个项目平均交付周期', unit: 'months' },
  ],
  hardware: [
    { key: 'hwMargin', label: '硬件毛利率（扣除 BOM 与制造）', unit: 'percent' },
    { key: 'units', label: '累计出货量', unit: 'count' },
    { key: 'returnRate', label: '退货 / 返修率', unit: 'percent' },
  ],
  consumer: [
    { key: 'repurchase', label: '复购率', unit: 'percent' },
    { key: 'aov', label: '客单价', unit: 'amount' },
    { key: 'cac', label: '单客户获客成本 CAC', unit: 'amount' },
  ],
  healthcare: [
    { key: 'regStatus', label: '注册证 / 审批进展（原文）', unit: 'text' },
    { key: 'clinicalStage', label: '临床阶段（原文）', unit: 'text' },
  ],
  manufacturing: [
    { key: 'yieldRate', label: '良率', unit: 'percent' },
    { key: 'utilization', label: '产能利用率', unit: 'percent' },
    { key: 'backlog', label: '在手订单金额', unit: 'amount' },
  ],
  platform: [
    { key: 'gmv', label: '年 GMV', unit: 'amount' },
    { key: 'buyerRepeat', label: '买家复购率', unit: 'percent' },
  ],
  general: [],
};

const fmtWan = (n: number) => (n >= 10000 ? `${+(n / 10000).toFixed(2)} 亿元` : `${+n.toFixed(1)} 万元`);
const fmtPct = (n: number) => `${+n.toFixed(1)}%`;

/**
 * 纯函数：核验过的输入 → 行业专属指标 + 缺口。`annual` 是通用部分算出来的年度 / 年化收入（万元，可能为 null），
 * `grossMargin` 同理（百分比）。BP 没给的照样列出来标「未披露」并进缺口 —— 不列的话「这个行业该看的指标」
 * 和「这份 BP 恰好没有」在报告里分不出来。
 */
export function sectorMetrics(
  sector: Sector, inputs: RevenueInput[], annual: number | null, customers: number | null, grossMargin: number | null
): { metrics: RevenueMetric[]; gaps: { item: string; why: string; ask: string }[] } {
  const v = (k: string) => inputs.find((i) => i.key === k)?.value ?? null;
  const raw = (k: string) => inputs.find((i) => i.key === k)?.raw || '';
  const metrics: RevenueMetric[] = [];
  const gaps: { item: string; why: string; ask: string }[] = [];
  const add = (m: Omit<RevenueMetric, 'group'>) => metrics.push({ ...m, group: 'sector' });
  const miss = (name: string, why: string, ask: string, value = '未披露') => { add({ name, value, basis: `BP 里没有${name}的数据`, status: null, flag: '' }); gaps.push({ item: name, why, ask }); };
  const pct = (k: string, name: string, judge: (n: number) => [RevenueMetric['status'], string], why: string, ask: string) => {
    const n = v(k);
    if (n === null) return miss(name, why, ask);
    const [status, flag] = judge(n);
    add({ name, value: fmtPct(n), basis: `BP 披露「${raw(k)}」`, status, flag });
  };

  switch (sector) {
    case 'saas': {
      const arr = v('arr');
      if (arr !== null) {
        add({ name: 'ARR', value: fmtWan(arr), basis: `BP 披露「${raw('arr')}」`, status: null,
          flag: annual !== null ? `ARR 占年度收入 ${fmtPct((arr / annual) * 100)}（越高越是订阅公司，越低越像项目公司）` : '' });
      } else miss('ARR', 'SaaS 估值的分母是 ARR，不是总收入', '按月的 ARR 变化表（新增 / 扩容 / 流失）');
      pct('ndr', '净收入留存 NDR', (n) => (n >= 110 ? ['good', '≥110%：老客户在持续加购'] : n >= 100 ? ['watch', '100–110%：留住了，但扩容不多'] : ['risk', '<100%：老客户收入在缩']),
        '判断产品是否真的被用起来', '按客户群（cohort）的收入留存表');
      pct('logoChurn', '年客户流失率', (n) => (n <= 10 ? ['good', ''] : n <= 20 ? ['watch', '10–20%：中小客户为主的 SaaS 常见，但要解释'] : ['risk', '>20%：每年要先补回五分之一的客户']),
        '流失高的订阅收入不算好收入', '近 12 个月流失客户名单与原因');
      const cac = v('cac');
      const arpaMonthly = arr !== null && customers ? arr / customers / 12 : null;
      if (cac !== null && arpaMonthly && grossMargin !== null) {
        const payback = cac / (arpaMonthly * (grossMargin / 100));
        add({ name: 'CAC 回本周期', value: `约 ${+payback.toFixed(1)} 个月`, basis: `CAC「${raw('cac')}」÷（ARR ÷ 客户数 ÷ 12 × 毛利率 ${fmtPct(grossMargin)}）`,
          status: payback <= 12 ? 'good' : payback <= 24 ? 'watch' : 'risk', flag: payback > 24 ? '>24 个月：增长越快越缺钱' : '' });
      } else miss('CAC 回本周期', 'SaaS 规模化的前提是获客能回本', 'CAC（按渠道）+ ARPA + 毛利率', '不可计算');
      break;
    }
    case 'ai_service': {
      const emp = v('employees');
      if (emp && annual !== null) {
        const pp = annual / emp;
        add({ name: '人均年收入（人效）', value: fmtWan(pp), basis: `年度收入 ${fmtWan(annual)} ÷ 员工「${raw('employees')}」`,
          status: pp >= 100 ? 'good' : pp >= 50 ? 'watch' : 'risk', flag: pp < 50 ? '<50 万 / 人：收入主要靠堆人，估值会按外包公司算' : '' });
      } else miss('人均年收入（人效）', '项目制公司能不能规模化，看的是收入是否随人头线性增长', '员工总数（按交付 / 研发 / 销售拆分）+ 年度收入', emp ? '不可计算' : '未披露');
      pct('productShare', '产品化收入占比', (n) => (n >= 50 ? ['good', ''] : n >= 20 ? ['watch', '20–50%：在从项目往产品走'] : ['risk', '<20%：本质上还是人天生意']),
        '决定按软件公司还是按服务公司估值', '按收入类型拆分（订阅 / 产品授权 / 人天 / 分成）');
      const dm = v('deliveryMonths');
      if (dm !== null) add({ name: '平均交付周期', value: `${dm} 个月`, basis: `BP 披露「${raw('deliveryMonths')}」`, status: dm <= 3 ? 'good' : dm <= 6 ? 'watch' : 'risk', flag: dm > 6 ? '>6 个月：现金回款慢、并行项目数受限' : '' });
      else miss('平均交付周期', '交付周期决定并行能力和回款速度', '近 10 个项目的签约—上线—验收时间表');
      break;
    }
    case 'hardware': {
      pct('hwMargin', '硬件毛利率', (n) => (n >= 40 ? ['good', ''] : n >= 25 ? ['watch', '25–40%：要靠规模或服务收入补'] : ['risk', '<25%：卖得越多亏得越多的风险']),
        '硬件公司的生死线', 'BOM 成本表 + 制造与物流成本');
      const units = v('units');
      if (units !== null) add({ name: '累计出货量', value: `${units} 台`, basis: `BP 披露「${raw('units')}」`, status: null, flag: annual !== null && units ? `折合单台收入约 ${fmtWan(annual / units)}` : '' });
      else miss('累计出货量', '验证量产与渠道能力', '分月出货量 + 渠道分布');
      pct('returnRate', '退货 / 返修率', (n) => (n <= 3 ? ['good', ''] : n <= 8 ? ['watch', ''] : ['risk', '>8%：品控或产品定义有问题']), '品控与口碑的硬指标', '近 6 个月退货与返修记录');
      break;
    }
    case 'consumer': {
      pct('repurchase', '复购率', (n) => (n >= 40 ? ['good', ''] : n >= 20 ? ['watch', ''] : ['risk', '<20%：增长主要靠买流量']), '品牌是否真的被认可', '按月新客 / 老客销售拆分');
      const aov = v('aov'), cac = v('cac');
      if (aov !== null && cac && grossMargin !== null) {
        const r = (aov * grossMargin / 100) / cac;
        add({ name: '首单毛利 / 获客成本', value: `${+r.toFixed(2)} 倍`, basis: `客单价「${raw('aov')}」× 毛利率 ${fmtPct(grossMargin)} ÷ CAC「${raw('cac')}」`,
          status: r >= 1 ? 'good' : r >= 0.5 ? 'watch' : 'risk', flag: r < 1 ? '<1：首单亏钱，要靠复购回本' : '' });
      } else miss('首单毛利 / 获客成本', '消费品牌能否放量的关键账', '客单价 + 毛利率 + 分渠道 CAC', '不可计算');
      break;
    }
    case 'healthcare': {
      for (const k of ['regStatus', 'clinicalStage']) {
        const label = k === 'regStatus' ? '注册证 / 审批进展' : '临床阶段';
        const r = raw(k);
        if (r) add({ name: label, value: r, basis: 'BP 原文', status: null, flag: '' });
        else miss(label, '医疗项目的估值主要由审批进度决定', k === 'regStatus' ? '注册证编号 / 受理通知书' : '临床方案与入组进度');
      }
      break;
    }
    case 'manufacturing': {
      pct('yieldRate', '良率', (n) => (n >= 95 ? ['good', ''] : n >= 85 ? ['watch', ''] : ['risk', '<85%：还没过量产关']), '量产能力的硬指标', '近 3 个月分批次良率');
      pct('utilization', '产能利用率', (n) => (n >= 70 ? ['good', ''] : n >= 40 ? ['watch', ''] : ['risk', '<40%：产能闲置、折旧压利润']), '判断扩产融资是否必要', '月度产能与产量表');
      const bl = v('backlog');
      if (bl !== null && annual) {
        const m = bl / (annual / 12);
        add({ name: '在手订单覆盖', value: `约 ${+m.toFixed(1)} 个月`, basis: `在手订单「${raw('backlog')}」÷（年度收入 ${fmtWan(annual)} ÷ 12）`, status: m >= 6 ? 'good' : m >= 3 ? 'watch' : 'risk', flag: '' });
      } else miss('在手订单覆盖', '订单可见度决定扩产节奏', '在手订单清单（客户 / 金额 / 交期）', bl !== null ? '不可计算' : '未披露');
      break;
    }
    case 'platform': {
      const gmv = v('gmv');
      if (gmv !== null && annual !== null) {
        const tr = (annual / gmv) * 100;
        add({ name: '货币化率（Take rate）', value: fmtPct(tr), basis: `年度收入 ${fmtWan(annual)} ÷ GMV「${raw('gmv')}」`, status: tr >= 5 ? 'good' : tr >= 2 ? 'watch' : 'risk', flag: tr < 2 ? '<2%：GMV 很大但平台赚不到钱' : '' });
      } else miss('货币化率（Take rate）', '平台估值看 GMV，但投资人会追问能收多少钱', '年 GMV + 平台收入', gmv !== null ? '不可计算' : '未披露');
      pct('buyerRepeat', '买家复购率', (n) => (n >= 40 ? ['good', ''] : n >= 20 ? ['watch', ''] : ['risk', '<20%：交易靠补贴拉动']), '网络效应是否成立', '按月新老买家交易拆分');
      break;
    }
    case 'general':
      break;
  }
  return { metrics, gaps };
}
