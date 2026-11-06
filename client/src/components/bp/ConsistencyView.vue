<script setup lang="ts">
import { whereShort } from './where'
// BP 内部一致性交叉表。数据结构见 server/src/services/bp/consistencyService.ts（每段原文都核过、页码由代码算）。

export interface Consistency {
  items: {
    metric: string
    status: 'conflict' | 'consistent' | 'single'
    severity: '致命' | '重要' | '可选' | null
    values: { quote: string; page: number | null; doc?: string | null }[]
    impact: string
  }[]
  counts: { conflict: number; consistent: number; single: number }
  dropped: string[]
  promptSource: 'skill' | 'default'
}

defineProps<{ data: Consistency }>()
const STATUS_TEXT = { conflict: '口径冲突', consistent: '多页一致', single: '单点无对照' }
</script>

<template>
  <div class="bc-sum">
    <span>共比对 {{ data.items.length }} 个指标</span>
    <span class="c">{{ data.counts.conflict }} 处口径冲突</span>
    <span>{{ data.counts.single }} 处单点无对照</span>
    <span>{{ data.counts.consistent }} 处多页一致</span>
  </div>
  <div v-if="data.dropped.length" class="warn x-sys">
    模型还报了 {{ data.dropped.length }} 条（{{ data.dropped.join('、') }}），但它引的原文在 BP 里找不到或只核得上一处，已丢掉不显示 —— 这几条可能是模型补出来的。
  </div>
  <p v-if="!data.items.length" class="pending">没有找到可以比对的指标。</p>
  <div class="x-list">
  <div v-for="(it, i) in data.items" :key="i" :class="['bc-item', `bc-${it.status}`]">
    <div class="bc-head">
      <span class="bc-metric">{{ it.metric }}</span>
      <span class="bc-tag">{{ STATUS_TEXT[it.status] }}</span>
      <span v-if="it.severity" :class="['bc-tag', { fatal: it.severity === '致命' }]">{{ it.severity }}</span>
    </div>
    <div class="bc-vals">
      <div v-for="(v, j) in it.values" :key="j" class="bc-val">
        <span class="bc-page" :title="v.doc || ''">{{ whereShort(v.page, v.doc) || 'BP 原文' }}</span>
        <span>「{{ v.quote }}」</span>
      </div>
    </div>
    <p v-if="it.impact" class="bc-impact">{{ it.impact }}</p>
  </div>
  </div>
</template>
