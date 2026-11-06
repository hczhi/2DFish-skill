<script setup lang="ts">
import { computed } from 'vue'
import Refs from './Refs.vue'
import SourcesList from './SourcesList.vue'

// 09 目标融资对象。数据结构见 server/src/services/bp/investorService.ts。
// confidence 由服务端按「机构名 / 合伙人是否在被引资料里」定；partnerRejected = 模型给了名字但资料里查不到。

export interface Investors {
  queries: string[]
  failedQueries: { q: string; error: string }[]
  sources: { n: number; title: string; url: string; published: string; tier?: 0 | 1 | 2 | 3 | 4; domain?: string; stale?: boolean }[]
  investors: {
    name: string; type: string; circle: string; deal: string; partner: string; partnerRejected: string; role: string
    fit: string; why: string; approach: string; confidence: '已公开' | '部分公开'; src: number[]
  }[]
  approachNote: string
  dropped: string[]
  trimmed?: number
  userMaterials?: number
  excluded?: number
  promptSource: 'skill' | 'default'
}

const props = defineProps<{ data: Investors }>()
const P = 'inv'
const GROUPS = [
  { key: '已投同类', title: '第一圈层 · 已投同类案子（判断成本最低）', note: '他们不需要你解释赛道，只需要你解释凭什么是你' },
  { key: '国家队 / 产业资本', title: '第二圈层 · 国家队与产业资本（背书与估值锚）', note: '解决的不是钱，是「谁替你背书」' },
  { key: '其他', title: '其他有本赛道出资记录的机构', note: '' },
]
const groups = computed(() => GROUPS.map((g) => ({ ...g, list: props.data.investors.filter((x) => x.circle === g.key) })).filter((g) => g.list.length))
const withPartner = computed(() => props.data.investors.filter((x) => x.partner).length)
</script>

<template>
  <p class="intro">这一章回答的不是「谁有钱」，而是「谁最近为和你一样的东西花过钱」。只列在检索资料里查得到本赛道出资记录的机构，按圈层排，不按名气排。</p>
  <div class="ti-sum">
    共列出 {{ data.investors.length }} 家机构，其中 {{ withPartner }} 家查到了公开的对口人；其余标「待核实」不是没查，是公开资料里查不到署名 —— 走引荐路径。
  </div>
  <div v-if="data.dropped.length" class="warn x-sys">
    模型还给了 {{ data.dropped.length }} 家机构（{{ data.dropped.join('、') }}），在它引的资料里找不到，已丢掉不显示。
  </div>

  <div v-for="g in groups" :key="g.key">
    <div class="ti-gh"><b>{{ g.title }}</b><span v-if="g.note" class="ti-gn">{{ g.note }}</span><span class="ti-gc">{{ g.list.length }} 家</span></div>
    <div class="ti-grid x-list">
      <div v-for="x in g.list" :key="x.name" class="ti-card">
        <div class="ti-top">
          <span class="ti-name">{{ x.name }}</span>
          <span v-if="x.type" class="ti-type">{{ x.type }}</span>
          <span :class="['ti-fit', x.confidence === '已公开' ? 'f-high' : 'f-mid']">{{ x.confidence }}</span>
        </div>
        <div class="ti-row"><span class="ti-k">同类案子</span>{{ x.deal }}</div>
        <div class="ti-row ti-ppl">
          <span class="ti-k">对口人</span>
          <template v-if="x.partner"><b>{{ x.partner }}</b><template v-if="x.role"> · {{ x.role }}</template><span class="ti-conf c-ok">已公开</span></template>
          <template v-else><b>待核实</b><span class="ti-conf c-todo">待核实</span>
            <div v-if="x.partnerRejected" class="muted x-sys" style="font-size:13px">模型给了「{{ x.partnerRejected }}」，资料里查不到这个人，已去掉</div>
          </template>
        </div>
        <div class="ti-row"><span class="ti-k">为什么投你</span>{{ x.why }}</div>
        <div v-if="x.fit" class="ti-row"><span class="ti-k">匹配度</span>{{ x.fit }}</div>
        <div class="ti-row ti-go"><span class="ti-k">怎么触达</span>{{ x.approach }}</div>
        <div class="ti-src x-detail">来源<Refs :prefix="P" :src="x.src" /></div>
      </div>
    </div>
  </div>
  <p v-if="data.approachNote" class="footnote">🧭 {{ data.approachNote }}</p>
  <SourcesList :prefix="P" title="目标融资对象" chapter="investors" step="investors" :sources="data.sources" :queries="data.queries" :failed-queries="data.failedQueries"
    :trimmed="data.trimmed" :user-materials="data.userMaterials" :excluded="data.excluded" />
</template>
