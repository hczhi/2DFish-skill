<script setup lang="ts">
import { computed } from 'vue'
import { whereShort } from './where'

// 03 BP 优化（part='fixes'）/ 04 追问预演（part='qa'）。数据结构见 server/src/services/bp/adviceService.ts。

export interface Advice {
  fixes: { level: string; quote: string; page: number | null; doc?: string | null; problem: string; investorView: string; rewrite: string }[]
  droppedFixes: number
  qa: { q: string; why: string; answer: string; evidence: string }[]
  promptSource: 'skill' | 'default'
}

const props = defineProps<{ data: Advice; part: 'fixes' | 'qa' }>()
const LEVELS = [
  { key: '致命', cls: 'lv-fatal', title: '致命问题' },
  { key: '重要', cls: 'lv-major', title: '重要问题' },
  { key: '可选', cls: 'lv-minor', title: '可选问题' },
]
const groups = computed(() => LEVELS.map((l) => ({ ...l, list: props.data.fixes.filter((f) => f.level === l.key) })).filter((g) => g.list.length))
const count = (k: string) => props.data.fixes.filter((f) => f.level === k).length
// 卡片标题取「问题」的第一句：模型不单给标题，整段做标题太长。
const headOf = (s: string) => s.split(/[。；;！!？?]/)[0].slice(0, 60)
// 「问题」那行去掉已经当标题的第一句，只剩一句的话整行不显示（不然同一句话连着出现两遍）。
const restOf = (s: string) => {
  const h = headOf(s)
  return s.startsWith(h) ? s.slice(h.length).replace(/^[。；;！!？?\s]+/, '') : s
}
</script>

<template>
  <template v-if="part === 'fixes'">
    <p class="intro">按严重程度排。「致命」是会让投资人当场放下材料的，「重要」是影响判断进度的，「可选」是加分项。每一条都给原句和建议写法，你可以直接对着改。</p>
    <div class="bf-summary">共 {{ data.fixes.length }} 条，其中 {{ count('致命') }} 条致命、{{ count('重要') }} 条重要、{{ count('可选') }} 条可选。每条的「BP 原文」都在你的 BP 里核过、页码由系统定位。</div>
    <div v-if="data.droppedFixes" class="warn x-sys">另有 {{ data.droppedFixes }} 条改写建议，模型引的「原句」在 BP 里找不到，已丢掉不显示。</div>
    <template v-for="g in groups" :key="g.key">
      <div class="sub-h">{{ g.title }} · {{ g.list.length }} 条</div>
      <div class="x-list">
      <div v-for="(f, i) in g.list" :key="i" class="fix-item">
        <div class="fix-head">
          <span :class="['lv', g.cls]">{{ g.key }}</span>
          <b>{{ headOf(f.problem) }}</b>
          <span v-if="whereShort(f.page, f.doc)" class="fix-page" :title="f.doc || ''">{{ whereShort(f.page, f.doc) }}</span>
        </div>
        <div class="quote-line"><span class="q-k">{{ f.doc ? '附件原文' : 'BP 原文' }}</span>「{{ f.quote }}」</div>
        <div v-if="restOf(f.problem)" class="fix-p x-detail"><span class="q-k">问题</span>{{ restOf(f.problem) }}</div>
        <div class="fix-iv x-detail"><span class="q-k">投资人会想</span>{{ f.investorView }}</div>
        <div class="rewrite"><span class="q-k">建议写法</span>{{ f.rewrite }}</div>
      </div>
      </div>
    </template>
  </template>
  <template v-else>
    <p class="intro">这些问题不是危言耸听，是读你 BP 时必然浮上来的疑问。先在这里被问一遍，比在路演现场被问一遍便宜得多。</p>
    <div class="qa-list x-list">
      <div v-for="(x, i) in data.qa" :key="i" class="qa-card">
        <div class="qa-q"><span class="qa-no">Q{{ i + 1 }}</span>{{ x.q }}</div>
        <div class="qa-why">为什么会问：{{ x.why }}</div>
        <div class="qa-a"><span class="q-k">建议答法</span>{{ x.answer }}</div>
        <div v-if="x.evidence" class="qa-proof">📎 需要准备的证据：{{ x.evidence }}</div>
      </div>
    </div>
  </template>
</template>
