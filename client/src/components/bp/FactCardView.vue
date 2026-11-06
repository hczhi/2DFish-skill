<script setup lang="ts">
import { computed } from 'vue'
import Module from './Module.vue'
import { whereLong } from './where'

// 企业基本面里来自 BP 事实卡的几个模块（编号由报告页按章节位置传入）。数据结构见 server/src/services/bp/factCardService.ts。
// 每条都带「材料披露 / 计算 / 推断 / 未披露 / 原文对不上」标签：同一张卡上真抄到的和模型推的必须看得出区别。

type Label = 'disclosed' | 'computed' | 'inferred' | 'missing' | 'unverified'
interface Item { field: string; value: string; label: Label; quote: string; page: number | null; doc?: string | null; basis: string }
interface Section { key: string; title: string; items: Item[] }
export interface FactCard {
  sections: Section[]
  issues: { text: string; quote: string; page: number | null; doc?: string | null }[]
}

const props = withDefaults(defineProps<{ card: FactCard; cn?: string; start?: number }>(), { cn: '05', start: 1 })
const no = (i: number) => `${props.cn}.${props.start + i}`

const LABEL_TEXT: Record<Label, string> = {
  disclosed: '材料披露', computed: '计算', inferred: '推断', missing: '未披露', unverified: '原文对不上',
}
const sec = (k: string) => props.card.sections.find((s) => s.key === k)?.items || []
const intro = computed(() => sec('company').find((i) => i.field === '一句话介绍' && i.label !== 'missing')?.value || '')
const companyFacts = computed(() => sec('company').filter((i) => i.field !== '一句话介绍'))
const team = computed(() => sec('team'))
const teamKnown = computed(() => team.value.filter((i) => i.label !== 'missing'))
</script>

<template>
  <Module :no="no(0)" title="企业基本盘" desc="BP 里写了什么就记什么；没写的标「未披露」，模型推断的单独标出来。">
    <p v-if="intro" class="intro">{{ intro }}</p>
    <div class="facts">
      <div v-for="(it, i) in companyFacts" :key="i" :class="['fact', it.label]">
        <span>{{ it.field }}<em :class="['lbl', it.label]">{{ LABEL_TEXT[it.label] }}</em></span>
        <div class="fact-value">{{ it.value || '未披露' }}</div>
        <div v-if="it.label === 'disclosed' || it.label === 'unverified'" class="fact-q x-detail">「{{ it.quote }}」<template v-if="whereLong(it.page, it.doc)"> · {{ whereLong(it.page, it.doc) }}</template></div>
        <div v-else-if="it.basis" class="fact-q x-detail">依据：{{ it.basis }}</div>
      </div>
    </div>
  </Module>

  <Module :no="no(1)" title="产品与技术" class="x-detail">
    <div class="facts two">
      <div v-for="(it, i) in sec('product')" :key="i" :class="['fact', it.label]">
        <span>{{ it.field }}<em :class="['lbl', it.label]">{{ LABEL_TEXT[it.label] }}</em></span>
        <div class="fact-value">{{ it.value || '未披露' }}</div>
        <div v-if="it.label === 'disclosed' || it.label === 'unverified'" class="fact-q x-detail">「{{ it.quote }}」<template v-if="whereLong(it.page, it.doc)"> · {{ whereLong(it.page, it.doc) }}</template></div>
        <div v-else-if="it.basis" class="fact-q x-detail">依据：{{ it.basis }}</div>
      </div>
    </div>
  </Module>

  <Module :no="no(2)" title="经营数据" desc="BP 自己披露的经营数字。是否可信、口径是否一致，见上方一致性交叉表与收入质量体检。" class="x-detail">
    <div class="facts two">
      <div v-for="(it, i) in sec('operations')" :key="i" :class="['fact', it.label]">
        <span>{{ it.field }}<em :class="['lbl', it.label]">{{ LABEL_TEXT[it.label] }}</em></span>
        <div class="fact-value">{{ it.value || '未披露' }}</div>
        <div v-if="it.label === 'disclosed' || it.label === 'unverified'" class="fact-q x-detail">「{{ it.quote }}」<template v-if="whereLong(it.page, it.doc)"> · {{ whereLong(it.page, it.doc) }}</template></div>
        <div v-else-if="it.basis" class="fact-q x-detail">依据：{{ it.basis }}</div>
      </div>
    </div>
  </Module>

  <Module :no="no(3)" title="本轮融资" class="x-detail">
    <div class="facts two">
      <div v-for="(it, i) in sec('financing')" :key="i" :class="['fact', it.label]">
        <span>{{ it.field }}<em :class="['lbl', it.label]">{{ LABEL_TEXT[it.label] }}</em></span>
        <div class="fact-value">{{ it.value || '未披露' }}</div>
        <div v-if="it.label === 'disclosed' || it.label === 'unverified'" class="fact-q x-detail">「{{ it.quote }}」<template v-if="whereLong(it.page, it.doc)"> · {{ whereLong(it.page, it.doc) }}</template></div>
        <div v-else-if="it.basis" class="fact-q x-detail">依据：{{ it.basis }}</div>
      </div>
    </div>
  </Module>

  <Module :no="no(4)" title="创始团队" desc="履历均为 BP 自述；外部核验见上方团队竞争力评估。" class="x-detail">
    <p v-if="!teamKnown.length" class="pending">BP 里没有写团队成员。</p>
    <div class="frow">
      <div v-for="(it, i) in teamKnown" :key="i" class="fcard">
        <div class="fname">{{ it.value.split(/[，,：:（(]/)[0] }}</div>
        <div class="ftitle">{{ it.field }} <em :class="['lbl', it.label]">{{ LABEL_TEXT[it.label] }}</em></div>
        <div class="fbio">{{ it.value }}</div>
        <div v-if="it.label === 'unverified'" class="fact-q">「{{ it.quote }}」—— 这段原文在 BP 里找不到</div>
      </div>
    </div>
  </Module>

  <Module v-if="card.issues.length" :no="no(5)" title="存疑与矛盾（事实卡初筛）" tone="risk" desc="抽事实卡时顺手发现的；逐条核过原文的完整版见上方一致性交叉表。" class="x-detail">
    <div v-for="(x, i) in card.issues" :key="i" class="risk-row">
      <span class="pos-badge pos-mid">存疑</span>
      <div>
        {{ x.text }}
        <div v-if="x.quote" class="fact-q">「{{ x.quote }}」<template v-if="whereLong(x.page, x.doc)"> · {{ whereLong(x.page, x.doc) }}</template></div>
      </div>
    </div>
  </Module>
</template>
