<script setup lang="ts">
import { computed } from 'vue'
import { keyFindings, type ChapterHealth } from './health'

// 第一层：一页纸摘要。一屏内看完：总分 / 梯队 / 一句话、3 个关键发现、3 件最该先做的事、章节健康地图。
// 全部由代码从各章数据挑出来（health.ts），不调模型。

const props = defineProps<{
  r: any
  chapters: { no: string; title: string; id: string; part: string }[]
  health: Record<string, ChapterHealth | null>
}>()
const emit = defineEmits<{ go: [id: string] }>()

const d = computed(() => props.r.diagnosis)
const findings = computed(() => keyFindings(props.r))
const actions = computed(() => (d.value?.top3 || []).slice(0, 3))
const BAND_NO: Record<string, number> = { 第一梯队: 1, 第二梯队: 2, 第三梯队: 3, 第四梯队: 4 }
const LIGHT_TEXT: Record<string, string> = { good: '良好', watch: '需关注', risk: '风险', info: '参考', na: '未跑' }
</script>

<template>
  <section id="summary" class="sm">
    <div class="sm-top">
      <div class="sm-score">
        <div class="sm-k">BP 五维总分</div>
        <div class="sm-num" v-if="d">{{ d.totalP }}<small>/100</small></div>
        <div class="sm-num na" v-else>—</div>
        <div v-if="d" :class="['sm-band', `b${BAND_NO[d.band]}`]">{{ d.band }}</div>
        <div v-if="d" class="sm-quad">{{ d.quadrant }} · 可回收 <b>{{ d.recoverableP }}</b> 分</div>
      </div>
      <div class="sm-verdict">
        <div class="sm-k">一句话结论</div>
        <p v-if="d?.verdict">{{ d.verdict.split(/(?<=[。！？])/)[0] }}</p>
        <p v-else class="muted">评分还没跑完。</p>
        <div class="sm-meta">
          <span v-if="r.credibility">BP 可信度 <b :class="`c-${r.credibility.rating}`">{{ r.credibility.rating }}</b></span>
          <span v-if="r.financing">融资额 <b>{{ { low: '偏少', ok: '合理', high: '偏多', unknown: '—' }[r.financing.askVerdict as string] }}</b></span>
        </div>
      </div>
    </div>

    <div class="sm-cols">
      <div class="sm-col">
        <div class="sm-h">关键发现</div>
        <p v-if="!findings.length" class="muted">没有需要特别标出的问题。</p>
        <button v-for="(f, i) in findings" :key="i" type="button" class="sm-item" @click="emit('go', f.to)">
          <i :class="['ld', f.light]" /><span>{{ f.text }}</span>
        </button>
      </div>
      <div class="sm-col">
        <div class="sm-h">最该先做的三件事</div>
        <p v-if="!actions.length" class="muted">评分还没给出（可在 01 章重跑）。</p>
        <button v-for="(a, i) in actions" :key="i" type="button" class="sm-item" @click="emit('go', 'plan')">
          <b class="sm-no">{{ i + 1 }}</b><span><b>{{ a.title }}</b><br /><small>{{ a.fix }}</small></span>
        </button>
      </div>
    </div>

    <div class="sm-h">章节一览</div>
    <div class="sm-map">
      <button v-for="c in chapters" :key="c.id" type="button" :class="['sm-cell', health[c.id]?.light || 'na']" @click="emit('go', c.id)">
        <span class="sm-cno">{{ c.no }}</span>
        <span class="sm-ct">{{ c.title.split(' · ')[0] }}</span>
        <span class="sm-cl"><i :class="['ld', health[c.id]?.light || 'na']" />{{ LIGHT_TEXT[health[c.id]?.light || 'na'] }}</span>
        <span class="sm-cd">{{ health[c.id]?.headline || '还没跑到' }}</span>
      </button>
    </div>
  </section>
</template>
