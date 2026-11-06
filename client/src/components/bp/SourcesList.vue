<script setup lang="ts">
import { inject, computed } from 'vue'
import Icon from './Icon.vue'
import MaterialsPanel from './MaterialsPanel.vue'
import { BP_CTX } from './ctx'
import { api } from '../../lib/api'

// 一章的资料来源。锚点带章节前缀（`src-<prefix>-<n>`）：各章各自编号，共用锚点的话
// 07 章点 [3] 会跳到 06 章那条 [3]，读者核的是另一篇文章。
// 每条标出来源等级、发布日期（较旧 / 未标日期），可以点「排除」（同名公司 / 不相关），重跑这一章后不再用它。

type Tier = 0 | 1 | 2 | 3 | 4
const props = defineProps<{
  prefix: string
  title: string
  chapter?: 'credit' | 'team' | 'industry' | 'competitors' | 'investors'
  step?: string
  sources: { n: number; title: string; url: string; published: string; tier?: Tier; domain?: string; stale?: boolean }[]
  queries: string[]
  failedQueries?: { q: string; error: string }[]
  trimmed?: number
  userMaterials?: number
  excluded?: number
}>()

const TIER_LABEL: Record<number, string> = { 0: '用户提供', 1: '官方', 2: '研报 / 权威媒体', 3: '行业媒体', 4: '自媒体' }
const ctx = inject(BP_CTX, null)
const excludedUrls = computed(() => new Set(ctx?.materials.value.filter((m) => m.chapter === props.chapter && m.kind === 'exclude').map((m) => m.url) || []))

async function exclude(s: { url: string; title: string }) {
  if (!ctx || !props.chapter) return
  const res = await api(`/api/bp/reports/${ctx.reportId}/materials`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chapter: props.chapter, kind: 'exclude', url: s.url, title: s.title }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) { alert(`没排除掉：${data.error || res.status}`); return }
  await ctx.refresh()
}
</script>

<template>
  <!-- 默认收起：来源是「想核实时才看」的内容，展开的话它占了每章将近一半的篇幅。 -->
  <details class="sources">
    <summary class="src-h"><Icon name="link" />{{ title }} · 资料来源<span class="src-count">{{ sources.length }} 条 · 按来源等级排序 · 点击展开</span></summary>
    <div v-if="userMaterials || excluded" class="src-note">这一版用了你补的 {{ userMaterials || 0 }} 份资料，排除了 {{ excluded || 0 }} 条检索结果。</div>
    <div v-if="trimmed" class="src-note">另有 {{ trimmed }} 条检索结果超出资料容量，按来源等级从低往高裁掉了，没给 AI 看。</div>
    <div v-if="failedQueries?.length" class="warn x-sys" style="margin-top:8px">
      有 {{ failedQueries.length }} 条检索词没搜成，这一章少了这部分资料：
      <ul><li v-for="f in failedQueries" :key="f.q">「{{ f.q }}」—— {{ f.error }}</li></ul>
    </div>
    <ol class="src-list">
      <li v-for="s in sources" :id="`src-${prefix}-${s.n}`" :key="s.n" :value="s.n">
        <span v-if="s.tier !== undefined" :class="['tier', `tier-${s.tier}`]">{{ TIER_LABEL[s.tier] }}</span>
        <a v-if="!s.url.startsWith('upload://')" :href="s.url" target="_blank" rel="noopener">{{ s.title || s.url }}</a>
        <span v-else>{{ s.title }}</span>
        <span class="src-date">{{ s.domain }}</span>
        <span v-if="s.tier === 0" class="src-date">用户补充</span>
        <span v-else-if="!s.published" class="date-tag nodate">未标日期</span>
        <span v-else :class="['src-date', { 'date-tag': s.stale, old: s.stale }]">{{ s.published.slice(0, 10) }}{{ s.stale ? ' · 较旧' : '' }}</span>
        <template v-if="ctx && chapter && s.tier !== 0 && ctx.editable.value">
          <span v-if="excludedUrls.has(s.url)" class="date-tag nodate">已排除（重跑后生效）</span>
          <button v-else class="src-x no-print" title="同名公司 / 不相关：重跑这一章后不再用它" @click="exclude(s)">排除</button>
        </template>
      </li>
    </ol>
    <ul class="kw"><li v-for="q in queries" :key="q">{{ q }}</li></ul>
    <MaterialsPanel v-if="chapter && step" :chapter="chapter" :step="step" />
  </details>
</template>
