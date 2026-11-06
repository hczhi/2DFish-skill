<script setup lang="ts">
import Refs from './Refs.vue'
import SourcesList from './SourcesList.vue'

// 团队竞争力评估。数据结构见 server/src/services/bp/teamService.ts。
// 成员核实状态、「外部验证」等级都由系统按留下来的印证算；印证的资料里必须出现这个人的名字。

export interface Team {
  skipped: string | null
  overall: { level: string; note: string }
  dims: { key: string; name: string; level: string; evidence: string; gap: string }[]
  members: { name: string; role: string; bio: string; signals: { text: string; src: number[] }[]; gaps: string; verifyPath: string; status: string }[]
  advice: string[]
  droppedSignals: number
  queries: string[]
  failedQueries: { q: string; error: string }[]
  sources: { n: number; title: string; url: string; published: string; tier?: 0 | 1 | 2 | 3 | 4; domain?: string; stale?: boolean }[]
  promptSource: 'skill' | 'default'
}

defineProps<{ data: Team }>()
const P = 'team'
const LV: Record<string, string> = { 强: 'lv-strong', 中: 'lv-mid', 弱: 'lv-weak', 待核实: 'lv-unknown' }
const MS: Record<string, string> = { 已核实: 'ok', 部分核实: 'pt', 待外部核实: 'no' }
</script>

<template>
  <div v-if="data.skipped" class="warn">这一模块没做完：{{ data.skipped }}</div>
  <template v-if="!data.skipped">
    <div class="tm-overall"><span :class="['tm-lv', LV[data.overall.level]]">{{ data.overall.level }}</span><span class="tm-ov-note">{{ data.overall.note }}</span></div>
    <div class="tm-grid">
      <div v-for="d in data.dims" :key="d.key" class="tm-dim">
        <div class="tm-dim-top"><span class="tm-dim-name">{{ d.name }}</span><span :class="['tm-lv', LV[d.level]]">{{ d.level }}</span></div>
        <div class="tm-dim-ev">{{ d.evidence }}</div>
        <div v-if="d.gap" class="tm-vnote">⚠ {{ d.gap }}</div>
      </div>
    </div>
  </template>
  <div v-if="data.members.length" class="inner-h">核心成员背景卡（外部交叉验证）</div>
  <div v-if="data.droppedSignals" class="muted x-sys" style="margin-bottom:8px">另有 {{ data.droppedSignals }} 条模型给的印证，引用的资料里没有这个人的名字（可能是同名的人），已丢掉。</div>
  <div class="tm-mbrs">
    <div v-for="m in data.members" :key="m.name" class="tm-mbr">
      <div class="tm-mbr-head"><span class="tm-mbr-name">{{ m.name }}</span><span :class="['tm-status', MS[m.status]]">{{ m.status }}</span></div>
      <div class="tm-mbr-title">{{ m.role }}</div>
      <div class="tm-mbr-bio">BP 自述：{{ m.bio }}</div>
      <div v-if="m.signals.length" class="tm-sigs"><span v-for="(s, i) in m.signals" :key="i" class="tm-sig">{{ s.text }}<Refs :prefix="P" :src="s.src" /></span></div>
      <div v-if="m.gaps" class="tm-vnote">待核实：{{ m.gaps }}</div>
      <div class="tm-srcs x-detail">核实路径：{{ m.verifyPath }}</div>
    </div>
  </div>
  <template v-if="data.advice.length">
    <div class="inner-h">核实与补强建议</div>
    <div class="callout callout-warn"><ul class="dot"><li v-for="a in data.advice" :key="a">{{ a }}</li></ul></div>
  </template>
  <SourcesList :prefix="P" title="团队核验" chapter="team" step="team" :sources="data.sources" :queries="data.queries" :failed-queries="data.failedQueries" />
</template>
