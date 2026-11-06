<script setup lang="ts">
import { computed, ref } from 'vue'
import { whereShort } from './where'

// 01 体检结论 / 02 五维评分。所有分数、梯队、象限都是服务端算好的（diagnosisService.ts），这里只显示。
// part = 'summary' 渲染 01，'dims' 渲染 02。

export interface Diagnosis {
  dims: {
    key: string; name: string; factP: number; proofP: number; recoverableP: number
    band: string; quadrant: string; note: string
    deductions: { text: string; cause: string; severity: string; quote: string; page: number | null; doc?: string | null; quoteFound: boolean | null }[]
  }[]
  totalP: number; proofP: number; recoverableP: number
  band: string; quadrant: string
  verdict: string
  top3: { title: string; why: string; fix: string }[]
  benchmark: string
  scoreInText: boolean
  missingParts?: ('verdict' | 'top3')[]
  stage?: string
  stageLabel?: string
  stageBasis?: string
  stagePromptSource?: 'skill' | 'default'
  promptSource: 'skill' | 'default'
}

const props = defineProps<{ data: Diagnosis; part: 'summary' | 'dims' }>()

const BAND_NO: Record<string, number> = { 第一梯队: 1, 第二梯队: 2, 第三梯队: 3, 第四梯队: 4 }
const BAND_RANGE: Record<string, string> = { 第一梯队: '≥85', 第二梯队: '75–84', 第三梯队: '60–74', 第四梯队: '<60' }
const CAUSE: Record<string, { text: string }> = { 叙事: { text: '叙事问题' }, 证据: { text: '证据缺失' }, 事实: { text: '事实短板' }, 阶段: { text: '阶段正常' } }
const QUAD: Record<string, { tag: string; note: string }> = {
  改材料就能加分: { tag: '强事实 · 弱举证', note: '不需要新业绩，改 BP 就能把分拿回来，性价比最高' },
  可以见投资人: { tag: '强事实 · 强举证', note: '事实和举证都站得住，可以去见投资人' },
  先别急着融资: { tag: '弱事实 · 弱举证', note: '事实和举证都偏弱：先补经营，再谈融资' },
  一问就穿: { tag: '弱事实 · 强举证', note: 'BP 讲得比实际好，投资人一追问就露馅 —— 主动降叙事' },
}

// 雷达图（同模版 430×400，五维事实实线 / 举证虚线，轴端标「名称 事实 / 举证」）。
const CX = 215, CY = 204, R = 122
const ang = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / 5
const pt = (i: number, v: number) => [CX + Math.cos(ang(i)) * R * (v / 100), CY + Math.sin(ang(i)) * R * (v / 100)]
const poly = (k: 'factP' | 'proofP') => props.data.dims.map((d, i) => pt(i, d[k]).map((n) => n.toFixed(1)).join(',')).join(' ')
const ring = (v: number) => props.data.dims.map((_, i) => pt(i, v).map((n) => n.toFixed(1)).join(',')).join(' ')
const labels = computed(() => props.data.dims.map((d, i) => {
  const [x, y] = pt(i, 128)
  const anchor = Math.abs(x - CX) < 4 ? 'middle' : x > CX ? 'start' : 'end'
  return { x, y: i === 0 ? y - 26 : y + (y > CY ? 12 : -2), anchor, name: d.name, v: `${d.factP} / ${d.proofP}` }
}))

// ---- 02 五维：总览（哑铃图）+ 标签页逐维看 ----
// 扣分按病因分组：叙事 / 证据 = 改材料就能修，事实 = 要靠做事，阶段 = 这一轮正常、不用改。
// 每条扣分的「处方：」后半段拆出来当「怎么改」（模型照方法写的固定格式；没有就整段当问题）。
type Ded = Diagnosis['dims'][number]['deductions'][number]
const GROUPS: { key: string; title: string; desc: string; causes: string[] }[] = [
  { key: 'fix', title: '改材料就能修', desc: '不需要新业绩，把已有的东西写清楚、拿出证据', causes: ['叙事', '证据'] },
  { key: 'do', title: '要靠做事', desc: '事实层面的短板，改 BP 改不掉', causes: ['事实'] },
  { key: 'stage', title: '这一轮正常', desc: '按当前轮次的标尺不算问题，知道即可', causes: ['阶段'] },
]
const groupOf = (c: string) => GROUPS.find((g) => g.causes.includes(c))?.key || 'do'
const split = (t: string) => {
  const m = t.split(/\s*处方[:：]\s*/)
  return { problem: m[0].trim(), fix: m.slice(1).join('；').trim() }
}
const ranked = computed(() => [...props.data.dims]
  .map((d) => ({ ...d, nFix: d.deductions.filter((x) => groupOf(x.cause) === 'fix').length, nDo: d.deductions.filter((x) => groupOf(x.cause) === 'do').length }))
  .sort((a, b) => b.recoverableP - a.recoverableP || a.factP - b.factP))
const tab = ref<string>('')
const activeKey = computed(() => tab.value || ranked.value[0]?.key || '')
const grouped = (d: Diagnosis['dims'][number]) => GROUPS
  .map((g) => ({ ...g, items: d.deductions.filter((x) => groupOf(x.cause) === g.key).sort((a, b) => Number(b.severity === '致命') - Number(a.severity === '致命')).map((x: Ded) => ({ ...x, ...split(x.text) })) }))
  .filter((g) => g.items.length || g.key !== 'stage')
const openQ = ref<Record<string, boolean>>({})
</script>

<template>
  <template v-if="part === 'summary'">
    <p class="intro">先看这一页。后面每一章都在回答同一件事：这些分是怎么丢的、哪些能靠改材料拿回来、哪些必须靠做事拿回来。</p>
    <div class="diag-hero">
      <div class="diag-score">
        <div class="ds-k">BP 五维总分</div>
        <div class="ds-num">{{ data.totalP }}<span>/100</span></div>
        <span :class="['ds-band', `band-${BAND_NO[data.band]}`]">{{ data.band }} · {{ BAND_RANGE[data.band] }}</span>
        <div class="ds-basis">按「{{ data.stageLabel || '通用' }}」标尺评分<template v-if="data.stageBasis">（{{ data.stageBasis }}）</template> · {{ data.benchmark }}</div>
        <div v-if="data.verdict" class="ds-verdict">{{ data.verdict }}</div>
        <div v-else class="ds-basis" style="color:#A32D2D">这次模型没有给出总评结论，点「重跑」再出一次。</div>
      </div>
      <div class="radar-box">
        <svg class="radar" viewBox="0 0 430 400" role="img" aria-label="五维事实分与举证分雷达图">
          <polygon v-for="v in [25, 50, 75, 100]" :key="v" :points="ring(v)" fill="none" stroke="#e2e8f0" stroke-width="0.8" />
          <line v-for="(_, i) in data.dims" :key="`l${i}`" :x1="CX" :y1="CY" :x2="pt(i, 100)[0]" :y2="pt(i, 100)[1]" stroke="#e2e8f0" stroke-width="0.8" />
          <polygon :points="poly('factP')" fill="rgba(18,56,107,.14)" stroke="#12386B" stroke-width="1.6" />
          <polygon :points="poly('proofP')" fill="rgba(186,117,23,.10)" stroke="#BA7517" stroke-width="1.4" stroke-dasharray="4 3" />
          <g v-for="l in labels" :key="l.name">
            <text :x="l.x" :y="l.y" :text-anchor="l.anchor" font-size="15" fill="#33475e">{{ l.name }}</text>
            <text :x="l.x" :y="l.y + 17" :text-anchor="l.anchor" font-size="13" fill="#8a94a6">{{ l.v }}</text>
          </g>
        </svg>
        <div class="radar-legend"><span><i class="lg-solid" />事实分（企业真实水平）</span><span><i class="lg-dash" />举证分（材料能证明多少）</span></div>
      </div>
    </div>
    <div class="dual-row x-detail">
      <div class="dual-cell"><div class="dl-k">事实分 · 企业真实水平</div><div class="dl-v">{{ data.totalP }}<span>/100</span></div></div>
      <div class="dual-cell"><div class="dl-k">举证分 · 材料能证明多少</div><div class="dl-v">{{ data.proofP }}<span>/100</span></div></div>
      <div class="dual-cell dual-hi"><div class="dl-k">可回收分 · 改材料就能拿回</div><div class="dl-v">{{ data.recoverableP }}<span>/100</span></div><div class="dl-note">不需要新业绩，只需要把已有的东西证明清楚</div></div>
    </div>
    <div class="quad-line"><span class="quad-tag">{{ QUAD[data.quadrant]?.tag }}</span><b>{{ data.quadrant }}</b><span class="quad-note">{{ QUAD[data.quadrant]?.note }}</span></div>
    <div v-if="data.scoreInText" class="warn x-sys">模型在结论文字里写了分数，可能和上面系统算的对不上，以上面的数字为准。</div>
    <div class="sub-h x-detail">最该改的三件事</div>
    <!-- 空的时候必须说出来：只剩一个标题读起来像「没什么要改的」。老报告没有 missingParts，按 top3 是否为空判。 -->
    <div v-if="!data.top3.length" class="warn x-detail">这次模型没有给出「最该改的三件事」（五维分数和扣分明细不受影响）。点本章标题右侧的「重跑」再出一次。</div>
    <div class="top3 x-detail">
      <div v-for="(t, i) in data.top3" :key="t.title" class="t3-card">
        <span class="t3-no">{{ i + 1 }}</span>
        <div><div class="t3-t">{{ t.title }}</div><div class="t3-w">{{ t.why }}</div><div class="t3-a">→ {{ t.fix }}</div></div>
      </div>
    </div>
    <p class="footnote x-detail">事实分与举证分的差额不是惩罚，而是告诉你哪些分还握在自己手里。总分、梯队、可回收分都由系统按五维分数现算（100 分制）。</p>
  </template>

  <template v-else>
    <div class="dz">
      <div class="dz-meta">
        <span class="dz-std">评分标尺 · {{ data.stageLabel || '通用' }}</span>
        <span>事实分 = 企业真实水平，举证分 = BP 能证明多少；两条柱子的长度差，是改材料就能拿回的分。</span>
      </div>

      <!-- 总览：一维一行，按可回收分排 -->
      <div class="dz-ov">
        <div class="dz-ov-h"><span>维度</span><span class="dz-scale"><i>0</i><i>50</i><i>100</i></span><span>事实 / 举证</span><span>可回收</span><span>扣分</span></div>
        <button v-for="d in ranked" :key="d.key" type="button" :class="['dz-row', { on: d.key === activeKey }]" @click="tab = d.key">
          <span class="dz-name">{{ d.name }}<small :class="`t${BAND_NO[d.band]}`">{{ d.band }}</small></span>
          <span class="dz-bars">
            <i class="dz-b dz-bf" :style="{ '--w': `${d.factP}%` }" />
            <i class="dz-b dz-bp" :style="{ '--w': `${d.proofP}%` }" />
          </span>
          <span class="dz-num"><b>{{ d.factP }}</b> / {{ d.proofP }}</span>
          <span class="dz-rec">{{ d.recoverableP > 0 ? `+${d.recoverableP}` : '—' }}</span>
          <span class="dz-cnt"><em v-if="d.nFix">改材料 {{ d.nFix }}</em><em v-if="d.nDo" class="do">做事 {{ d.nDo }}</em><em v-if="!d.nFix && !d.nDo" class="none">无</em></span>
        </button>
        <div class="dz-legend"><span><i class="dz-f" />事实分</span><span><i class="dz-pf" />举证分</span><span>两条之差 = 可回收</span></div>
      </div>

      <!-- 逐维 -->
      <div class="dz-tabs" role="tablist">
        <button v-for="d in ranked" :key="d.key" type="button" role="tab" :aria-selected="d.key === activeKey" :class="{ on: d.key === activeKey }" @click="tab = d.key">
          {{ d.name }}<small v-if="d.recoverableP > 0">+{{ d.recoverableP }}</small>
        </button>
      </div>
      <section v-for="d in ranked" v-show="d.key === activeKey" :key="d.key" class="dz-panel">
        <div class="dz-ph">
          <div class="dz-pt">{{ d.name }}<span>事实 {{ d.factP }} · 举证 {{ d.proofP }}<template v-if="d.recoverableP > 0"> · 可回收 <b>+{{ d.recoverableP }}</b></template></span></div>
          <span class="dz-quad">{{ d.quadrant }}</span>
        </div>
        <p v-if="d.note" class="dz-lead">{{ d.note }}</p>

        <div v-for="g in grouped(d)" :key="g.key" :class="['dz-g', `g-${g.key}`]">
          <div class="dz-gh"><b>{{ g.title }}</b><span class="dz-gn">{{ g.items.length }} 条</span><span class="dz-gd">{{ g.desc }}</span></div>
          <p v-if="!g.items.length" class="dz-empty">这一维没有这类扣分。</p>
          <div v-for="(x, j) in g.items" :key="j" :class="['dz-item', { fatal: x.severity === '致命' }]">
            <div class="dz-p"><span v-if="x.severity === '致命'" class="dz-fatal">致命</span><span class="dz-cause">{{ CAUSE[x.cause]?.text || x.cause }}</span>{{ x.problem }}</div>
            <div v-if="x.fix" class="dz-fix"><span>怎么改</span>{{ x.fix }}</div>
            <div v-if="x.quote" class="dz-q">
              <button type="button" :class="['dz-qb', { miss: x.quoteFound === false }]" @click="openQ[`${d.key}-${g.key}-${j}`] = !openQ[`${d.key}-${g.key}-${j}`]">
                {{ x.quoteFound === false ? '原文未定位' : `BP 原文${whereShort(x.page, x.doc) ? ` · ${whereShort(x.page, x.doc)}` : ''}` }}
                <i>{{ openQ[`${d.key}-${g.key}-${j}`] ? '收起' : '查看' }}</i>
              </button>
              <div v-if="openQ[`${d.key}-${g.key}-${j}`]" class="dz-qt">「{{ x.quote }}」<small v-if="x.quoteFound === false">这段话在 BP 里没找到原句，可能是模型改写过的说法，引用前请核对。</small></div>
            </div>
          </div>
        </div>
      </section>
    </div>
  </template>
</template>
