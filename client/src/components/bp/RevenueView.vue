<script setup lang="ts">
import { computed } from 'vue'

// 收入质量体检。数据结构见 server/src/services/bp/revenueService.ts —— 每个数字都由服务端按公式算。

export interface Revenue {
  verdict: string
  metrics: { name: string; value: string; basis: string; status: 'good' | 'watch' | 'risk' | null; flag: string; group?: 'sector' }[]
  gaps: { item: string; why: string; ask: string }[]
  inputs: { key: string; label: string; raw: string; quote: string; page: number | null; rejected: string | null }[]
  sector?: string
  sectorLabel?: string
  promptSource: 'skill' | 'default'
}

const props = defineProps<{ data: Revenue }>()
const STATUS_TEXT = { good: '良好', watch: '观察', risk: '风险' }
// 模型摘了但没被采用的数：不显示的话「BP 里写了」和「BP 没写」在这一章里都是「未披露」。
const rejected = computed(() => props.data.inputs.filter((i) => i.rejected))
const na = (v: string) => v === '未披露' || v === '不可计算'
const general = computed(() => props.data.metrics.filter((m) => m.group !== 'sector'))
const sector = computed(() => props.data.metrics.filter((m) => m.group === 'sector'))
</script>

<template>
  <div class="rq-verdict">{{ data.verdict }}</div>
  <div class="rq-sector">
    <span class="rq-sector-tag">行业模板 · {{ data.sectorLabel || '通用' }}</span>
    <span v-if="!data.sector || data.sector === 'general'">没有认出适用的行业模板，只看通用指标。</span>
    <span v-else>除通用指标外，按这个行业投资人最看的几项另算（公式和判档口径是平台参考口径）。</span>
  </div>
  <div class="inner-h" v-if="sector.length">通用指标</div>
  <div class="rq-grid">
    <div v-for="m in general" :key="m.name" :class="['rq-card', m.status ? `rq-${m.status}` : '', { na: na(m.value) }]">
      <div class="rq-k">{{ m.name }}</div>
      <div class="rq-v">{{ m.value }}</div>
      <div class="rq-b x-detail">算法：{{ m.basis }}</div>
      <div v-if="m.flag" class="rq-b">{{ m.flag }}</div>
      <span v-if="m.status" class="rq-s">{{ STATUS_TEXT[m.status] }}</span>
    </div>
  </div>
  <template v-if="sector.length">
    <div class="inner-h">行业专属指标 · {{ data.sectorLabel }}</div>
    <div class="rq-grid">
      <div v-for="m in sector" :key="m.name" :class="['rq-card', m.status ? `rq-${m.status}` : '', { na: na(m.value) }]">
        <div class="rq-k">{{ m.name }}</div>
        <div class="rq-v">{{ m.value }}</div>
        <div class="rq-b x-detail">算法：{{ m.basis }}</div>
        <div v-if="m.flag" class="rq-b">{{ m.flag }}</div>
        <span v-if="m.status" class="rq-s">{{ STATUS_TEXT[m.status] }}</span>
      </div>
    </div>
  </template>
  <div v-if="rejected.length" class="warn x-sys">
    以下数字模型找到了，但没核上、没有采用：
    <ul><li v-for="i in rejected" :key="i.key">{{ i.label }}「{{ i.raw }}」—— {{ i.rejected }}</li></ul>
  </div>
  <template v-if="data.gaps.length">
    <div class="inner-h x-detail">缺什么数据，向谁要</div>
    <div class="table-wrap x-detail">
      <table class="t">
        <thead><tr><th>缺失项</th><th>为什么影响判断</th><th>向谁要 / 要什么</th></tr></thead>
        <tbody>
          <tr v-for="g in data.gaps" :key="g.item">
            <td data-l="缺失项">{{ g.item }}</td><td data-l="为什么影响判断">{{ g.why }}</td><td data-l="要什么">{{ g.ask }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </template>
  <p class="footnote x-detail">口径提醒：本模块只做算术核对与缺口标注，不替代审计。每个数字的算法写在卡片上，用到的原文数字带页码。</p>
</template>
