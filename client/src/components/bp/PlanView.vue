<script setup lang="ts">
import Module from './Module.vue'

// 10 企业 90 天行动清单。数据结构见 server/src/services/bp/adviceService.ts（三段排期键由服务端定）。

export interface Plan {
  tradeoffs: { priority?: '高' | '中' | '低' | null; take: string; drop: string; why: string; effect: string; risk: string }[]
  quickWins: string[]
  phases: { key: string; label: string; items: { task: string; deliverable: string; ref: string }[] }[]
  reviewPoint: string
  dataRequests: { item: string; spec: string }[]
  ddChecklist: string[]
  promptSource: 'skill' | 'default'
}

const props = withDefaults(defineProps<{ data: Plan; cn?: string }>(), { cn: '11' })
const no = (i: number) => `${props.cn}.${i}`
// 优先级是模型给、服务端校验过的；旧报告没有这个字段就不显示，不按位置猜。
const PRI = { 高: 'p-high', 中: 'p-mid', 低: 'p-low' } as const
</script>

<template>
  <p class="intro">前面各章的发现，在这里收成动作：先定做什么、不做什么（重要度），再定第几周做（紧急度），最后是投资人会向你要的东西。</p>

  <Module :no="no(1)" title="战略取舍 · 做什么、不做什么" desc="「高」= 本周不做，这一轮基本可以放弃。">
    <p v-if="!data.tradeoffs.length" class="pending">没有给出战略取舍。</p>
    <div class="recs">
      <div v-for="(t, i) in data.tradeoffs" :key="i" class="rec">
        <span v-if="t.priority" :class="['pri', PRI[t.priority]]">{{ t.priority }}</span>
        <div class="rec-b">
          <b>{{ t.take }}</b>
          <div v-if="t.drop" class="rec-m">不做：{{ t.drop }}</div>
          <div class="rec-m">为什么现在：{{ t.why }}</div>
          <div class="rec-m">预期效果：{{ t.effect }} ｜ 风险：{{ t.risk }}</div>
        </div>
      </div>
    </div>
  </Module>

  <Module :no="no(2)" title="90 天排期 · 重要紧急排列" desc="按时间排，不按重要度排。前期做「改了就有分」的事，后期做「必须花时间」的事。">
    <div v-if="data.quickWins.length" class="quick-wins">
      <div class="qw-k">一周内能做掉的</div>
      <ul class="dot"><li v-for="q in data.quickWins" :key="q">{{ q }}</li></ul>
    </div>
    <div class="plan-track">
      <div v-for="p in data.phases" :key="p.key" class="phase">
        <div class="ph-window">{{ p.label }}</div>
        <p v-if="!p.items.length" class="muted">这一段没有安排。</p>
        <div v-for="(it, i) in p.items" :key="i" class="task-row">
          <div class="tk-t">{{ it.task }}</div>
          <div class="tk-meta">产出：{{ it.deliverable }}<template v-if="it.ref"> ｜ 对应：{{ it.ref }}</template></div>
        </div>
      </div>
    </div>
    <div v-if="data.reviewPoint" class="callout"><b>90 天复盘看什么</b>{{ data.reviewPoint }}</div>
  </Module>

  <Module v-if="data.dataRequests.length || data.ddChecklist.length" :no="no(3)" title="分析员行动包" tone="action" class="x-detail" desc="投资人会向你要的数据和尽调材料，提前备好。">
    <template v-if="data.dataRequests.length">
      <div class="inner-h">投资人会向你要的数据</div>
      <div class="table-wrap">
        <table class="t">
          <thead><tr><th>数据</th><th>口径</th></tr></thead>
          <tbody><tr v-for="d in data.dataRequests" :key="d.item"><td data-l="数据">{{ d.item }}</td><td data-l="口径">{{ d.spec }}</td></tr></tbody>
        </table>
      </div>
    </template>
    <template v-if="data.ddChecklist.length">
      <div class="inner-h">尽调材料清单</div>
      <ul class="dot"><li v-for="d in data.ddChecklist" :key="d">{{ d }}</li></ul>
    </template>
  </Module>
</template>
