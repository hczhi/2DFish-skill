<script setup lang="ts">
import Module from './Module.vue'

// 09 融资方案。数据结构见 server/src/services/bp/financingService.ts —— 所有数字都由系统按公式算，
// 估值区间 / 出让比例 / 下一轮门槛来自「平台参考口径」（后台可校准），不是联网查到的、也不是模型编的。

export interface Financing {
  stage: string; stageLabel: string; stageBasis: string; sector: string; sectorLabel: string
  ask: { value: number | null; basis: string }
  burn: { value: number | null; basis: string }
  runwayMonths: number | null
  suggestedAsk: [number, number] | null
  askVerdict: 'low' | 'ok' | 'high' | 'unknown'
  askNote: string
  reference: { valuation: [number, number]; dilution: [number, number]; nextRound: string; edited: boolean } | null
  impliedPre: [number, number] | null
  disclosedValuation: { value: number | null; raw: string }
  valuationVerdict: 'below' | 'within' | 'above' | 'unknown'
  valuationNote: string
  milestones: { label: string; target: string; current: string; status: 'met' | 'gap' | 'unknown'; gap: string }[]
  equity: { found: boolean; holders: { name: string; pct: number }[]; topPct: number | null; hasPlatform: boolean; flags: { level: 'risk' | 'watch' | 'ok'; text: string }[] }
  terms: { name: string; what: string; bottom: string }[]
  advice: { summary: string; ask: string; valuation: string; milestones: string; equity: string; sequencing: string }
  numbersOutside: string[]
  promptSource: 'skill' | 'default'
}

const props = withDefaults(defineProps<{ data: Financing; cn?: string }>(), { cn: '09' })
const no = (i: number) => `${props.cn}.${i}`
const wan = (n: number) => (n >= 10000 ? `${+(n / 10000).toFixed(2)} 亿` : `${Math.round(n)} 万`)
const AV: Record<string, [string, string]> = { low: ['rq-risk', '融少了'], ok: ['rq-good', '合理'], high: ['rq-watch', '偏多'], unknown: ['', '无法判断'] }
const VV: Record<string, [string, string]> = { below: ['rq-watch', '低于参考区间'], within: ['rq-good', '落在参考区间'], above: ['rq-risk', '高于参考区间'], unknown: ['', '无法判断'] }
const MS: Record<string, string> = { met: 'rq-good', gap: 'rq-risk', unknown: '' }
</script>

<template>
  <p class="intro">把前面九章的发现，落成一套融资方案：这轮融多少、出让多少、这轮钱要换来哪些里程碑、股权和条款上注意什么。所有数字由系统按公式算；估值区间、出让比例与下一轮门槛是<b>平台参考口径</b>（{{ data.sectorLabel }} · {{ data.stageLabel }}，{{ data.stageBasis }}）。</p>
  <div v-if="data.advice.summary" class="rq-verdict">{{ data.advice.summary }}</div>
  <div v-if="data.numbersOutside.length" class="warn x-sys">建议文字里出现了系统没算出来的数字（{{ data.numbersOutside.join('、') }}），以下面卡片里的数字为准。</div>

  <Module :no="no(1)" title="融资额与现金跑道" :desc="`按月均净烧 × ${18}–${24} 个月反推建议区间，对照 BP 写的融资额。`">
    <div class="rq-grid">
      <div class="rq-card"><div class="rq-k">本轮融资额</div><div class="rq-v">{{ data.ask.value !== null ? wan(data.ask.value) : '未披露' }}</div><div class="rq-b x-detail">{{ data.ask.basis }}</div></div>
      <div class="rq-card"><div class="rq-k">月均净烧</div><div class="rq-v">{{ data.burn.value !== null ? wan(data.burn.value) : '未披露' }}</div><div class="rq-b x-detail">{{ data.burn.basis }}</div></div>
      <div class="rq-card"><div class="rq-k">能撑多久</div><div class="rq-v">{{ data.runwayMonths !== null ? `${data.runwayMonths} 个月` : '不可计算' }}</div><div class="rq-b x-detail">融资额 ÷ 月均净烧（未计账上现金）</div></div>
      <div :class="['rq-card', AV[data.askVerdict][0]]"><div class="rq-k">建议融资额</div><div class="rq-v">{{ data.suggestedAsk ? `${wan(data.suggestedAsk[0])}–${wan(data.suggestedAsk[1])}` : '不可计算' }}</div><div class="rq-b x-detail">月均净烧 × 18–24 个月</div><span class="rq-s">{{ AV[data.askVerdict][1] }}</span></div>
    </div>
    <p class="muted x-detail">{{ data.askNote }}</p>
    <div v-if="data.advice.ask" class="callout"><b>建议</b>{{ data.advice.ask }}</div>
  </Module>

  <Module :no="no(2)" title="估值与出让比例" desc="参考区间是平台参考口径；隐含估值 = 融资额 ÷ 常见出让比例 − 融资额。">
    <div class="rq-grid">
      <div class="rq-card"><div class="rq-k">参考投前估值（{{ data.stageLabel }}）</div><div class="rq-v">{{ data.reference ? `${wan(data.reference.valuation[0])}–${wan(data.reference.valuation[1])}` : '无' }}</div><div class="rq-b x-detail">{{ data.reference ? `平台参考口径${data.reference.edited ? '（后台已校准）' : ''}` : 'BP 没写清轮次，没有可比区间' }}</div></div>
      <div class="rq-card"><div class="rq-k">常见出让比例</div><div class="rq-v">{{ data.reference ? `${data.reference.dilution[0]}–${data.reference.dilution[1]}%` : '无' }}</div><div class="rq-b x-detail">平台参考口径</div></div>
      <div :class="['rq-card', data.disclosedValuation.value === null ? VV[data.valuationVerdict][0] : '']"><div class="rq-k">按融资额反推的投前估值</div><div class="rq-v">{{ data.impliedPre ? `${wan(data.impliedPre[0])}–${wan(data.impliedPre[1])}` : '不可计算' }}</div><div class="rq-b x-detail">融资额 ÷ 出让比例 − 融资额</div><span v-if="data.disclosedValuation.value === null && data.valuationVerdict !== 'unknown'" class="rq-s">{{ VV[data.valuationVerdict][1] }}</span></div>
      <div :class="['rq-card', data.disclosedValuation.value !== null ? VV[data.valuationVerdict][0] : 'na']"><div class="rq-k">BP 写的估值</div><div class="rq-v">{{ data.disclosedValuation.value !== null ? wan(data.disclosedValuation.value) : '未披露' }}</div><div class="rq-b x-detail">{{ data.disclosedValuation.raw || '投资人第一眼就要看价格' }}</div><span v-if="data.disclosedValuation.value !== null" class="rq-s">{{ VV[data.valuationVerdict][1] }}</span></div>
    </div>
    <p class="muted">{{ data.valuationNote }}</p>
    <div v-if="data.advice.valuation" class="callout"><b>建议</b>{{ data.advice.valuation }}</div>
  </Module>

  <Module :no="no(3)" :title="`里程碑地图 · 到${data.reference?.nextRound || '下一轮'}还差什么`" desc="这轮钱要换来的东西：对照下一轮投资人通常要看到的门槛（平台参考口径）。">
    <p v-if="!data.milestones.length" class="pending">没有可对照的门槛（BP 没写清轮次）。</p>
    <div v-else class="table-wrap">
      <table class="t">
        <thead><tr><th>门槛</th><th>目标</th><th>现在</th><th>差距</th></tr></thead>
        <tbody>
          <tr v-for="m in data.milestones" :key="m.label">
            <td class="cname">{{ m.label }}</td><td data-l="目标">{{ m.target }}</td><td data-l="现在">{{ m.current }}</td>
            <td data-l="差距"><span :class="['rq-s', MS[m.status]]" :style="m.status === 'met' ? 'color:#0F6E56' : m.status === 'gap' ? 'color:#A32D2D' : ''">{{ m.gap }}</span></td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-if="data.advice.milestones" class="callout"><b>这轮钱的优先级</b>{{ data.advice.milestones }}</div>
  </Module>

  <Module :no="no(4)" title="股权结构体检" desc="基于企业信用档案里的工商公开信息。">
    <div v-if="data.equity.holders.length" class="table-wrap">
      <table class="t"><thead><tr><th>股东</th><th>持股</th></tr></thead>
        <tbody><tr v-for="h in data.equity.holders" :key="h.name"><td class="cname">{{ h.name }}</td><td data-l="持股">{{ h.pct }}%</td></tr></tbody></table>
    </div>
    <div v-for="f in data.equity.flags" :key="f.text" :class="['risk-row', { ok: f.level !== 'risk' }]">
      <span :class="['pos-badge', f.level === 'risk' ? 'pos-weak' : f.level === 'watch' ? 'pos-mid' : 'pos-strong']">{{ f.level === 'risk' ? '风险' : f.level === 'watch' ? '注意' : '正常' }}</span><div>{{ f.text }}</div>
    </div>
    <div v-if="data.advice.equity" class="callout"><b>建议</b>{{ data.advice.equity }}</div>
  </Module>

  <Module :no="no(5)" title="条款预警" tone="risk" desc="这个阶段最常见、最容易吃亏的几条，以及常见的底线。">
    <div class="table-wrap">
      <table class="t"><thead><tr><th>条款</th><th>是什么</th><th>底线</th></tr></thead>
        <tbody><tr v-for="t in data.terms" :key="t.name"><td class="cname">{{ t.name }}</td><td data-l="是什么">{{ t.what }}</td><td data-l="底线">{{ t.bottom }}</td></tr></tbody></table>
    </div>
  </Module>

  <Module v-if="data.advice.sequencing" :no="no(6)" title="融资推进节奏" tone="action">
    <div class="callout">{{ data.advice.sequencing }}</div>
  </Module>
</template>
