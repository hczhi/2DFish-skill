<script setup lang="ts">
import { whereShort } from './where'

// BP 可信度核验。数据结构见 server/src/services/bp/credibilityService.ts。
// 评级由系统按各条结论的占比算；每条结论引的证据来自前面几章核验过的发现。

export interface Credibility {
  rating: '高' | '中' | '低'
  ratingBasis: string
  note: string
  claims: { claim: string; page: number | null; doc: string | null; category: string; status: '已核实' | '部分核实' | '存矛盾' | '未核到'; finding: string; evidence: string[]; downgraded: boolean }[]
  contradictions: string[]
  evidence: { id: string; kind: string; text: string }[]
  droppedClaims: number
  promptSource: 'skill' | 'default'
}

const props = defineProps<{ data: Credibility }>()
const ST: Record<string, string> = { 已核实: 'bv-ver', 部分核实: 'bv-par', 存矛盾: 'bv-con', 未核到: 'bv-uns' }
const BADGE: Record<string, string> = { 高: 'bv-high', 中: 'bv-mid', 低: 'bv-low' }
const ev = (id: string) => props.data.evidence.find((e) => e.id === id)
</script>

<template>
  <div class="bv-cred">
    <span :class="['bv-badge', BADGE[data.rating]]">可信度 · {{ data.rating }}</span>
    <div><div class="bv-note">{{ data.note }}</div><div class="muted" style="margin-top:6px">{{ data.ratingBasis }}</div></div>
  </div>
  <div v-if="data.droppedClaims" class="warn x-sys">另有 {{ data.droppedClaims }} 条声明，模型引的原文在 BP 里找不到，已丢掉。</div>
  <div class="inner-h">BP 声明</div>
  <div class="x-list">
  <div v-for="(c, i) in data.claims" :key="i" class="bv-claim">
    <div class="bv-claim-head">
      <span class="bv-index">声明 {{ String(i + 1).padStart(2, '0') }}</span>
      <span class="bv-claim-title">「{{ c.claim }}」</span>
      <span :class="['bv-st', ST[c.status]]">{{ c.status }}</span>
    </div>
    <div class="bv-finding"><span class="bv-label">核验发现</span><p>{{ c.finding }}<span v-if="c.downgraded" class="uns x-sys">模型标了核实结论但没引到证据，系统改成「未核到」</span></p></div>
    <div class="bv-source x-detail">
      <span class="bv-label">出处 / 证据</span>
      <div>
        <div>{{ c.category }} · {{ whereShort(c.page, c.doc) || 'BP 原文' }}</div>
        <div v-for="id in c.evidence" :key="id">{{ id }} 〔{{ ev(id)?.kind }}〕{{ ev(id)?.text }}</div>
        <div v-if="!c.evidence.length">现有核验发现里没有能支持或否定它的证据</div>
      </div>
    </div>
  </div>
  </div>
  <template v-if="data.contradictions.length">
    <div class="inner-h">关键矛盾清单</div>
    <div class="callout callout-risk"><ul class="dot"><li v-for="x in data.contradictions" :key="x">{{ x }}</li></ul></div>
  </template>
</template>
