import { getDatabase } from '../../db/index.js';
import { SECTORS, STAGES, isSector, type Sector, type Stage } from './standards.js';

// 融资方案章的「平台参考口径」：行业 × 当前轮次 → 常见投前估值区间、常见出让比例、到下一轮的门槛。
// 这些数**不让模型编**（硬规则 3：一个模型现编的「行业标准」读起来和真的一模一样）：缺省值写在这里，
// 管理员在后台按经验校准（bp_benchmarks 表只存改过的格子），报告上一律标「平台参考口径」。
//
// 门槛的 metric 必须是 5.12 能算出来的键（通用 INPUTS / 行业 SECTOR_INPUTS / 'annual' = 年度或年化收入），
// 对不上的话那一行在报告里只能显示「无法对照」—— 所以 validateBenchmark 会拒掉不认识的键。

export interface Threshold {
  /** 对照哪个数：5.12 的输入键，或 'annual'（年度 / 年化收入，万元）；healthcare 这类非数字门槛用 'text'。 */
  metric: string;
  label: string;
  op: '>=' | '<=';
  /** metric = 'text' 时为 0（只展示 label）。金额一律万元、百分比 0-100。 */
  value: number;
  unit: 'amount' | 'percent' | 'count' | 'months' | 'text';
}

export interface Benchmark {
  /** 常见投前估值（万元）[低, 高]。 */
  valuation: [number, number];
  /** 常见出让比例（%）[低, 高]。 */
  dilution: [number, number];
  /** 下一轮叫什么（只展示用）。 */
  nextRound: string;
  /** 到下一轮投资人通常要看到的门槛。 */
  thresholds: Threshold[];
}

const T = (metric: string, label: string, op: '>=' | '<=', value: number, unit: Threshold['unit']): Threshold => ({ metric, label, op, value, unit });

const GENERAL: Record<Exclude<Stage, 'general'>, Benchmark> = {
  angel: { valuation: [2000, 6000], dilution: [10, 20], nextRound: 'Pre-A', thresholds: [T('customers', '付费客户', '>=', 3, 'count'), T('annual', '年收入', '>=', 100, 'amount')] },
  preA: { valuation: [6000, 15000], dilution: [10, 15], nextRound: 'A 轮', thresholds: [T('annual', '年收入', '>=', 1000, 'amount'), T('customers', '付费客户', '>=', 10, 'count'), T('renewalRate', '续约 / 复购率', '>=', 50, 'percent')] },
  A: { valuation: [15000, 40000], dilution: [15, 20], nextRound: 'B 轮', thresholds: [T('annual', '年收入', '>=', 5000, 'amount'), T('grossMargin', '毛利率', '>=', 40, 'percent'), T('top1Share', '第一大客户占比', '<=', 30, 'percent')] },
  B: { valuation: [40000, 120000], dilution: [10, 15], nextRound: 'C 轮 / Pre-IPO', thresholds: [T('annual', '年收入', '>=', 20000, 'amount'), T('grossMargin', '毛利率', '>=', 45, 'percent')] },
};

/** 只列和通用不一样的行业 × 轮次；没列的格子用 GENERAL。 */
const OVERRIDES: Partial<Record<Sector, Partial<Record<Exclude<Stage, 'general'>, Partial<Benchmark>>>>> = {
  saas: {
    preA: { thresholds: [T('arr', 'ARR', '>=', 1000, 'amount'), T('ndr', '净收入留存 NDR', '>=', 100, 'percent'), T('logoChurn', '年客户流失率', '<=', 15, 'percent')] },
    A: { valuation: [20000, 50000], thresholds: [T('arr', 'ARR', '>=', 5000, 'amount'), T('ndr', '净收入留存 NDR', '>=', 110, 'percent'), T('grossMargin', '毛利率', '>=', 65, 'percent')] },
  },
  ai_service: {
    preA: { thresholds: [T('annual', '年收入', '>=', 2000, 'amount'), T('customers', '付费客户', '>=', 15, 'count'), T('productShare', '产品化收入占比', '>=', 30, 'percent')] },
    A: { thresholds: [T('annual', '年收入', '>=', 10000, 'amount'), T('productShare', '产品化收入占比', '>=', 50, 'percent'), T('grossMargin', '毛利率', '>=', 45, 'percent')] },
  },
  hardware: {
    preA: { thresholds: [T('units', '累计出货量', '>=', 10000, 'count'), T('hwMargin', '硬件毛利率', '>=', 30, 'percent'), T('returnRate', '退货 / 返修率', '<=', 5, 'percent')] },
  },
  consumer: {
    preA: { thresholds: [T('annual', '年收入', '>=', 3000, 'amount'), T('repurchase', '复购率', '>=', 30, 'percent')] },
  },
  healthcare: {
    angel: { valuation: [3000, 10000], thresholds: [T('text', '完成概念验证 / 动物实验', '>=', 0, 'text')] },
    preA: { valuation: [10000, 30000], thresholds: [T('text', '进入注册检验或临床阶段', '>=', 0, 'text')] },
    A: { valuation: [30000, 80000], thresholds: [T('text', '取得注册证或完成关键临床', '>=', 0, 'text')] },
  },
  manufacturing: {
    preA: { thresholds: [T('annual', '年收入', '>=', 3000, 'amount'), T('yieldRate', '良率', '>=', 90, 'percent')] },
  },
  platform: {
    preA: { thresholds: [T('gmv', '年 GMV', '>=', 10000, 'amount'), T('buyerRepeat', '买家复购率', '>=', 30, 'percent')] },
  },
};

export function defaultBenchmark(sector: Sector, stage: Exclude<Stage, 'general'>): Benchmark {
  return { ...GENERAL[stage], ...(OVERRIDES[sector]?.[stage] || {}) } as Benchmark;
}

/** 生效值：后台改过用后台的，没改用缺省。stage = general（BP 没写轮次）时不给参考口径 —— 不知道在融哪一轮，就没有可比的区间。 */
export function benchmarkFor(sector: Sector, stage: Stage): { data: Benchmark; edited: boolean } | null {
  if (stage === 'general') return null;
  const row = getDatabase().prepare(`SELECT data_json FROM bp_benchmarks WHERE sector = ? AND stage = ?`).get(sector, stage) as { data_json: string } | undefined;
  if (row) {
    try { return { data: JSON.parse(row.data_json), edited: true }; } catch { /* 坏数据退回缺省（validateBenchmark 挡过，理论上到不了） */ }
  }
  return { data: defaultBenchmark(sector, stage), edited: false };
}

const METRIC_KEYS = new Set(['annual', 'text', 'customers', 'grossMargin', 'renewalRate', 'top1Share', 'top3Share', 'recurringShare', 'monthlyBurn', 'annualRevenue',
  'arr', 'ndr', 'logoChurn', 'cac', 'employees', 'productShare', 'deliveryMonths', 'hwMargin', 'units', 'returnRate', 'repurchase', 'aov', 'yieldRate', 'utilization', 'backlog', 'gmv', 'buyerRepeat']);

/** 后台保存前校验。返回错误清单（空 = 通过）—— 每条说清哪个字段、错在哪。 */
export function validateBenchmark(x: any): string[] {
  const errs: string[] = [];
  const pair = (v: any, name: string) => {
    if (!Array.isArray(v) || v.length !== 2 || !v.every((n) => typeof n === 'number' && n >= 0) || v[0] > v[1]) errs.push(`${name} 要写成 [低, 高] 两个非负数字，且低 ≤ 高`);
  };
  pair(x?.valuation, 'valuation（投前估值，万元）');
  pair(x?.dilution, 'dilution（出让比例，%）');
  if (Array.isArray(x?.dilution) && x.dilution[1] > 60) errs.push('dilution 上限超过 60%，多半是单位写错了（这里是百分比）');
  if (typeof x?.nextRound !== 'string' || !x.nextRound.trim()) errs.push('nextRound 要写下一轮的名字，比如「A 轮」');
  if (!Array.isArray(x?.thresholds)) errs.push('thresholds 要是一个数组');
  else x.thresholds.forEach((t: any, i: number) => {
    if (!METRIC_KEYS.has(t?.metric)) errs.push(`thresholds[${i}].metric「${t?.metric}」不是 5.12 能算出来的指标，报告里会显示成「无法对照」。可用：${[...METRIC_KEYS].join(' / ')}`);
    if (typeof t?.label !== 'string' || !t.label.trim()) errs.push(`thresholds[${i}].label 不能为空`);
    if (t?.op !== '>=' && t?.op !== '<=') errs.push(`thresholds[${i}].op 只能是 ">=" 或 "<="`);
    if (typeof t?.value !== 'number') errs.push(`thresholds[${i}].value 要是数字（金额单位万元、百分比写 0-100）`);
    if (!['amount', 'percent', 'count', 'months', 'text'].includes(t?.unit)) errs.push(`thresholds[${i}].unit 只能是 amount / percent / count / months / text`);
  });
  return errs;
}

export function listBenchmarks() {
  const rows = getDatabase().prepare(`SELECT sector, stage, data_json, updated_at, updated_by FROM bp_benchmarks`).all() as { sector: string; stage: string; data_json: string; updated_at: string; updated_by: string | null }[];
  const edited = new Map(rows.map((r) => [`${r.sector}/${r.stage}`, r]));
  const out = [];
  for (const sector of Object.keys(SECTORS) as Sector[]) {
    for (const stage of ['angel', 'preA', 'A', 'B'] as const) {
      const r = edited.get(`${sector}/${stage}`);
      out.push({
        sector, sectorLabel: SECTORS[sector], stage, stageLabel: STAGES[stage],
        data: r ? JSON.parse(r.data_json) : defaultBenchmark(sector, stage), defaults: defaultBenchmark(sector, stage),
        edited: !!r, updatedAt: r?.updated_at || null, updatedBy: r?.updated_by || null,
      });
    }
  }
  return out;
}

export function saveBenchmark(sector: string, stage: string, data: unknown, by: string): string[] {
  if (!isSector(sector) || !['angel', 'preA', 'A', 'B'].includes(stage)) return [`没有 ${sector} / ${stage} 这一格`];
  const errs = validateBenchmark(data);
  if (errs.length) return errs;
  getDatabase().prepare(
    `INSERT INTO bp_benchmarks (sector, stage, data_json, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(sector, stage) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at, updated_by = excluded.updated_by`
  ).run(sector, stage, JSON.stringify(data), new Date().toISOString(), by);
  return [];
}

export function resetBenchmark(sector: string, stage: string): void {
  getDatabase().prepare(`DELETE FROM bp_benchmarks WHERE sector = ? AND stage = ?`).run(sector, stage);
}
