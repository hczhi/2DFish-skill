<script setup lang="ts">
import { computed } from 'vue'
import SourcesList from './SourcesList.vue'
import Refs from './Refs.vue'
import Icon from './Icon.vue'
import Xsrc from './Xsrc.vue'

// 06 宏观分析。数据结构见 server/src/services/bp/industryService.ts。
// src 是本章检索资料编号，链接由服务端按编号填；unsourced = 数字在被引资料里找不到。

type Src = number[]
export interface Industry {
  topic: string
  queries: string[]
  failedQueries: { q: string; error: string }[]
  sources: { n: number; title: string; url: string; published: string; tier?: 0 | 1 | 2 | 3 | 4; domain?: string; stale?: boolean }[]
  kpis: { label: string; value: string; unit: string; delta: string; note: string; src: Src; unsourced: boolean; xsrc?: number }[]
  marketChart: { title: string; unit: string; bars: { label: string; value: number; src: Src; unsourced: boolean; xsrc?: number }[]; footnote: string } | null
  concentration: { title: string; pct: number; label: string; note: string; src: Src; unsourced: boolean; xsrc?: number } | null
  personas: { name: string; profile: string; pains: string[]; decision: string; fit: string; evidenceKind: 'data' | 'inference'; evidence: string; src: Src }[]
  scenarios: { name: string; freq: string; heat: 1 | 2 | 3; desc: string; product: string }[]
  trends: { title: string; strength: string; judge: string; evidence: string; meaning: string; src: Src; unsourced: boolean; xsrc?: number }[]
  trimmed?: number
  keywordNote?: string | null
  userMaterials?: number
  excluded?: number
  promptSource: 'skill' | 'default'
}

const props = defineProps<{ data: Industry }>()
const P = 'ind'

const TONE: Record<string, string> = { 已发生: 't-now', 进行中: 't-now', 加速中: 't-soon', 拐点将至: 't-soon', 结构性风险: 't-risk' }
const maxBar = computed(() => Math.max(...(props.data.marketChart?.bars.map((b) => b.value) || [1])))
const donutBg = computed(() => {
  const c = props.data.concentration
  if (!c) return ''
  const col = c.unsourced ? '#A32D2D' : '#12386B'
  return `conic-gradient(${col} 0 ${c.pct}%, #eef1f6 ${c.pct}% 100%)`
})
const isDown = (d: string) => /^[-−↓]|下降|下滑/.test(d)
const HEAT = ['', '●○○', '●●○', '●●●']
</script>

<template>
  <div v-if="data.keywordNote" class="warn x-sys">{{ data.keywordNote }}</div>
  <p class="intro">检索行业：<b>{{ data.topic }}</b>。先看几个数字建立坐标系，再拆市场盘子、人群与场景、趋势判断。共 {{ data.sources.length }} 条资料（读的是整页正文），每个数字旁标出它在几个不同来源里出现过。</p>

  <div class="sub-h">关键数字</div>
  <p v-if="!data.kpis.length" class="pending">检索资料里没有可用的量化数字。</p>
  <div class="kpi-row">
    <div v-for="(k, i) in data.kpis" :key="i" :class="['kpi', { bad: k.unsourced }]">
      <div class="kpi-top"><Icon :name="i % 3 === 0 ? 'trend' : i % 3 === 1 ? 'star' : 'pie'" /><span class="kpi-l">{{ k.label }}</span></div>
      <div class="kpi-num">{{ k.value }}<i>{{ k.unit }}</i></div>
      <span v-if="k.delta" :class="['kpi-d', { down: isDown(k.delta) }]">{{ k.delta }}</span>
      <div class="kpi-n">
        <span v-if="k.unsourced" class="uns">出处里没有这个数</span>{{ k.note }}<Refs :prefix="P" :src="k.src" /><Xsrc v-if="!k.unsourced" :n="k.xsrc" />
      </div>
    </div>
  </div>

  <template v-if="data.marketChart || data.concentration">
    <div class="sub-h">市场规模 · 盘子</div>
    <div :class="data.marketChart && data.concentration ? 'viz-grid' : ''">
      <div v-if="data.marketChart" class="viz-card">
        <div class="viz-h"><Icon name="trend" />{{ data.marketChart.title }}（{{ data.marketChart.unit }}）</div>
        <div class="bars">
          <div v-for="b in data.marketChart.bars" :key="b.label" class="bar">
            <div class="bar-track">
              <div :class="['bar-fill', { bad: b.unsourced }]" :style="{ height: `${Math.max(4, (b.value / maxBar) * 100)}%` }">
                <span class="bar-v">{{ b.value }}</span>
              </div>
            </div>
            <div class="bar-x">{{ b.label }}<Refs :prefix="P" :src="b.src" /><br /><Xsrc v-if="!b.unsourced" :n="b.xsrc" /></div>
          </div>
        </div>
        <div class="viz-f x-detail">
          {{ data.marketChart.footnote }}
          <div v-if="data.marketChart.bars.some((b) => b.unsourced)"><span class="uns">标红的柱子</span>数字在被引资料里找不到。</div>
        </div>
      </div>
      <div v-if="data.concentration" class="viz-card">
        <div class="viz-h"><Icon name="pie" />{{ data.concentration.title }}</div>
        <div class="donut-wrap">
          <div class="donut" :style="{ background: donutBg }">
            <div class="donut-l"><b>{{ data.concentration.pct }}%</b><span>{{ data.concentration.label }}</span></div>
          </div>
          <div class="donut-t"><Refs :prefix="P" :src="data.concentration.src" /><Xsrc v-if="!data.concentration.unsourced" :n="data.concentration.xsrc" /></div>
        </div>
        <div class="viz-f x-detail">
          {{ data.concentration.note }}
          <div v-if="data.concentration.unsourced"><span class="uns">出处里没有这个数</span>这个百分比在被引资料里找不到。</div>
        </div>
      </div>
    </div>
  </template>

  <template v-if="data.personas.length">
    <div class="sub-h">客户 / 消费者画像 · 谁在买</div>
    <div class="persona-grid x-list">
      <div v-for="p in data.personas" :key="p.name" :class="['persona', p.evidenceKind]">
        <div class="p-head">
          <div class="p-ava"><Icon name="user" /></div>
          <div><div class="p-name">{{ p.name }}</div><span class="p-badge">{{ p.evidenceKind === 'data' ? '数据支撑' : '推断' }}</span></div>
        </div>
        <div class="p-prof">{{ p.profile }}</div>
        <template v-if="p.pains.length">
          <div class="p-k">痛点</div>
          <ul class="p-pain"><li v-for="x in p.pains" :key="x">{{ x }}</li></ul>
        </template>
        <template v-if="p.decision"><div class="p-k">决策路径</div><div class="p-dec">{{ p.decision }}</div></template>
        <div v-if="p.fit" class="p-fit">{{ p.fit }}</div>
        <div class="p-evi x-detail">{{ p.evidence }}<Refs :prefix="P" :src="p.src" /></div>
      </div>
    </div>
  </template>

  <template v-if="data.scenarios.length">
    <div class="sub-h">应用 / 消费场景 · 什么情况下会买</div>
    <div class="scen-grid x-list">
      <div v-for="s in data.scenarios" :key="s.name" class="scen">
        <div class="s-top"><Icon name="clock" /><span class="s-name">{{ s.name }}</span></div>
        <div class="s-meta"><span v-if="s.freq" class="s-freq">{{ s.freq }}</span><span :class="['s-heat', `h${s.heat}`]">{{ HEAT[s.heat] }}</span></div>
        <div class="s-desc">{{ s.desc }}</div>
        <div v-if="s.product" class="s-prod">{{ s.product }}</div>
      </div>
    </div>
  </template>

  <div class="sub-h">行业发展趋势 · {{ data.trends.length }} 条主线</div>
  <p v-if="!data.trends.length" class="pending">检索资料里没有足以支撑的趋势判断。</p>
  <div class="trend-list x-list">
    <div v-for="(t, i) in data.trends" :key="i" :class="['trend', TONE[t.strength] || 't-now']">
      <div class="t-head">
        <span class="t-ico"><Icon :name="TONE[t.strength] === 't-risk' ? 'alert' : 'star'" /></span>
        <span class="t-ttl">{{ t.title }}</span>
        <span class="t-str">{{ t.strength }}</span>
      </div>
      <div class="t-judge">{{ t.judge }}</div>
      <div class="t-row"><span class="t-lab">证据</span><span>{{ t.evidence }}<Refs :prefix="P" :src="t.src" /><span v-if="t.unsourced" class="uns">证据里的数字出处里找不到</span><Xsrc v-else :n="t.xsrc" /></span></div>
      <div class="t-row t-m"><span class="t-lab">对你意味着</span><span>{{ t.meaning }}</span></div>
    </div>
  </div>
  <SourcesList :prefix="P" title="行业分析" chapter="industry" step="industry" :sources="data.sources" :queries="data.queries" :failed-queries="data.failedQueries"
    :trimmed="data.trimmed" :user-materials="data.userMaterials" :excluded="data.excluded" />
</template>
