<script setup lang="ts">
import { computed } from 'vue'
import Refs from './Refs.vue'
import SourcesList from './SourcesList.vue'

// 企业信用档案。数据结构见 server/src/services/bp/creditService.ts。
// 「公开网页未检索到」那句由服务端写死：查不到 ≠ 没有，风险类要指去官方库核。

export interface Credit {
  skipped: string | null
  company: string
  queries: string[]
  failedQueries: { q: string; error: string }[]
  sources: { n: number; title: string; url: string; published: string; tier?: 0 | 1 | 2 | 3 | 4; domain?: string; stale?: boolean }[]
  items: { key: string; label: string; risk: boolean; found: boolean; value: string; bpCheck: string; src: number[]; unsourced: boolean; otherCompany: boolean }[]
  whereToCheck: string
  userMaterials?: number
  excluded?: number
  promptSource: 'skill' | 'default'
}

const props = defineProps<{ data: Credit }>()
const P = 'credit'
const base = computed(() => props.data.items.filter((i) => !i.risk))
const risks = computed(() => props.data.items.filter((i) => i.risk))
</script>

<template>
  <div v-if="data.skipped" class="warn">这一模块没查：{{ data.skipped }}</div>
  <template v-else>
    <p class="muted" style="margin-bottom:10px">查询主体：<b>{{ data.company }}</b> · 只用公开网页检索，查不到不代表没有</p>
    <div class="facts two">
      <div v-for="i in base" :key="i.key" :class="['fact', { missing: !i.found }]">
        <span>{{ i.label }}</span>
        <div class="fact-value">{{ i.value }}<Refs :prefix="P" :src="i.src" /></div>
        <div v-if="i.bpCheck" class="fact-q" style="color:#854F0B">与 BP 对照：{{ i.bpCheck }}</div>
        <div v-if="i.unsourced" class="fact-q"><span class="uns">数字在被引资料里找不到</span></div>
        <div v-if="i.otherCompany" class="fact-q x-sys"><span class="uns">引的资料里没有这家公司全称，可能是同名公司，没采用</span></div>
      </div>
    </div>
    <div class="inner-h">涉诉 / 处罚 / 异常</div>
    <div v-for="i in risks" :key="i.key" :class="['risk-row', { ok: !i.found }]">
      <span :class="['pos-badge', i.found ? 'pos-weak' : 'pos-na']">{{ i.found ? '有记录' : '未检索到' }}</span>
      <div>
        <b>{{ i.label }}</b>：{{ i.value }}<Refs :prefix="P" :src="i.src" />
        <div v-if="i.otherCompany" class="fact-q x-sys"><span class="uns">引的资料里没有这家公司全称，可能是同名公司，没采用</span></div>
      </div>
    </div>
  </template>
  <div class="callout callout-warn x-detail"><b>核查口径</b>{{ data.whereToCheck }}</div>
  <SourcesList :prefix="P" title="企业信用档案" chapter="credit" step="credit" :sources="data.sources" :queries="data.queries" :failed-queries="data.failedQueries"
    :user-materials="data.userMaterials" :excluded="data.excluded" />
</template>
