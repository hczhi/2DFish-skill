<script setup lang="ts">
import { computed, ref } from 'vue'
import Refs from './Refs.vue'
import Xsrc from './Xsrc.vue'

// 07 竞品分析（矩阵 + 融资图谱 + 生态位十字图）。数据结构见 server/src/services/bp/competitorService.ts。
// 08 对标企业在 BenchmarksView，共用本章的资料来源（锚点前缀 comp，来源列表放在 08 末尾）。

type Src = number[]
export interface Competitors {
  topic: string
  queries: string[]
  failedQueries: { q: string; error: string }[]
  sources: { n: number; title: string; url: string; published: string; tier?: 0 | 1 | 2 | 3 | 4; domain?: string; stale?: boolean }[]
  competitors: {
    name: string; positioning: string; tech: string; stage: string; diff: string; note: string; src: Src
    rounds: { round: string; date: string; amount: string; investors: string[]; lead: string; src: Src; amountUnsourced: boolean; xsrc?: number }[]
  }[]
  positionMap: {
    xLeft: string; xRight: string; yBottom: string; yTop: string
    points: { name: string; self: boolean; x: number; y: number; note: string }[]
    conclusion: string
  } | null
  positionMapNote: string | null
  benchmarks: { name: string; funding: string; revenue: string; profit: string; outlook: string; src: Src; unsourced: boolean; xsrc?: number }[]
  dropped: string[]
  fundingNote: string | null
  trimmed?: number
  userMaterials?: number
  excluded?: number
  promptSource: 'skill' | 'default'
}

const props = defineProps<{ data: Competitors }>()
const P = 'comp'

// 十字图（同模版：960×620，四象限底色、编号圆点 + 名字胶囊；手机上换成按象限归位的清单）。
const X0 = 90, X1 = 900, Y0 = 64, Y1 = 530
const px = (x: number) => X0 + x * (X1 - X0)
const py = (y: number) => Y1 - y * (Y1 - Y0)
const MX = (X0 + X1) / 2, MY = (Y0 + Y1) / 2
const textW = (s: string) => [...s].reduce((w, ch) => w + (/[\x00-\xff]/.test(ch) ? 7.5 : 13.5), 0) + 22

/** 象限角标用的轴名：去掉括号里的解释，最多 14 个字；角标分两行（横轴 / × 纵轴），左右两角错开，长轴名不会撞在中线上。 */
const shortAxis = (s: string) => {
  const t = s.replace(/（.*?）|\(.*?\)/g, '').trim() || s
  return t.length > 14 ? `${t.slice(0, 14)}…` : t
}
const shortName = (s: string, max = 8) => {
  const t = s.replace(/（.*?）|\(.*?\)/g, '').replace(/(股份)?有限(责任)?公司|集团|股份|科技|技术|智能|信息|网络/g, '').trim() || s
  return t.length > max ? `${t.slice(0, max)}…` : t
}
const ax = computed(() => {
  const m = props.data.positionMap
  return m ? { xl: shortAxis(m.xLeft), xr: shortAxis(m.xRight), yb: shortAxis(m.yBottom), yt: shortAxis(m.yTop) } : null
})

type Box = { x: number; y: number; w: number; h: number }
const hit = (a: Box, b: Box) => a.x < b.x + b.w + 4 && b.x < a.x + a.w + 4 && a.y < b.y + b.h + 3 && b.y < a.y + a.h + 3

/**
 * 名字只在悬停（触屏是点一下）时出，常显的只有本标的 —— 九家公司的名字全摊在图上必然互相压字。
 * 胶囊位置：试 8 个方位（右 / 左 / 右上 / 右下 / 左上 / 左下 / 上 / 下），取第一个不压本标的胶囊、不压别的圆点、不出框的；
 * 都放不下就退回右侧。完整名单在图下的图例里。
 */
const hov = ref<string | null>(null)
const points = computed(() => {
  const pts = props.data.positionMap?.points || []
  const ordered = [...pts.filter((p) => p.self), ...pts.filter((p) => !p.self)]
  const dots: Box[] = ordered.map((p) => ({ x: px(p.x) - 12, y: py(p.y) - 12, w: 24, h: 24 }))
  const placed: Box[] = []
  let i = 1
  return ordered.map((p, idx) => {
    const no = p.self ? 1 : ++i
    const cx = px(p.x), cy = py(p.y)
    const label = p.self ? `${shortName(p.name)} · 本标的` : p.name.length > 16 ? `${p.name.slice(0, 16)}…` : p.name
    const w = textW(label), h = 26
    const tries: [number, number][] = [[16, -h / 2], [-16 - w, -h / 2], [10, -h - 8], [10, 8], [-10 - w, -h - 8], [-10 - w, 8], [-w / 2, -h - 16], [-w / 2, 16]]
    let box: Box = { x: Math.min(cx + 16, X1 - 4 - w), y: cy - h / 2, w, h }
    for (const [dx, dy] of tries) {
      const b = { x: cx + dx, y: cy + dy, w, h }
      const inside = b.x >= X0 + 4 && b.x + w <= X1 - 4 && b.y >= Y0 + 4 && b.y + h <= Y1 - 4
      if (inside && !placed.some((o) => hit(o, b)) && !dots.some((d, j) => j !== idx && hit(d, b))) { box = b; break }
    }
    if (p.self) placed.push(box)
    return { ...p, no, cx, cy, label, w, h, lx: box.x, ly: box.y }
  })
})
const shown = computed(() => points.value.filter((p) => p.self || p.name === hov.value))

const quads = computed(() => {
  const m = props.data.positionMap
  if (!m) return []
  const q = (x: number, y: number) => points.value.filter((p) => (p.x >= 0.5 ? 1 : 0) === x && (p.y >= 0.5 ? 1 : 0) === y)
  return [
    { h: `${m.xLeft} × ${m.yTop}`, pts: q(0, 1) }, { h: `${m.xRight} × ${m.yTop}`, pts: q(1, 1) },
    { h: `${m.xLeft} × ${m.yBottom}`, pts: q(0, 0) }, { h: `${m.xRight} × ${m.yBottom}`, pts: q(1, 0) },
  ].filter((x) => x.pts.length)
})
</script>

<template>
  <p class="intro">纳入口径：解决同一个客户问题的公司（含不同技术路线的替代者）。每家竞品的名字都在所引资料里核过。</p>
  <div v-if="data.dropped.length" class="warn x-sys">
    模型还给了 {{ data.dropped.length }} 个名字（{{ data.dropped.join('、') }}），在它引的检索资料里找不到，已丢掉不显示 —— 可能是模型补出来的。
  </div>

  <div class="sub-h">能力与模式对照</div>
  <div class="table-wrap">
    <table class="t wide">
      <thead><tr><th>竞品</th><th>定位</th><th>技术 / 产品路线</th><th>融资阶段</th><th>和你比</th></tr></thead>
      <tbody>
        <tr v-for="c in data.competitors" :key="c.name">
          <td class="cname">{{ c.name }}<Refs :prefix="P" :src="c.src" /><span v-if="c.note" class="csub">{{ c.note }}</span></td>
          <td data-l="定位">{{ c.positioning }}</td>
          <td data-l="技术路线">{{ c.tech }}</td>
          <td data-l="融资阶段" class="val">{{ c.stage }}</td>
          <td data-l="和你比">{{ c.diff }}</td>
        </tr>
      </tbody>
    </table>
  </div>

  <div class="sub-h">竞品融资图谱 · 每条带来源</div>
  <div v-if="data.fundingNote" class="warn x-sys">{{ data.fundingNote }}</div>
  <div class="x-list">
  <div v-for="c in data.competitors" :key="c.name" class="fund-block">
    <div class="fund-head">
      <span class="fund-name">{{ c.name }}</span>
      <span class="fund-sum">{{ c.rounds.length ? `${c.rounds.length} 轮 · 最近 ${c.rounds[c.rounds.length - 1].round}` : '公开检索未覆盖' }}</span>
    </div>
    <p v-if="!c.rounds.length" class="muted">资料里没查到这家的融资记录（不代表没有融资）。</p>
    <div v-else class="fund-tl">
      <div v-for="(r, i) in c.rounds" :key="i" class="fund-item">
        <span class="fund-dot" />
        <div class="fund-card">
          <div class="fund-top"><span class="fund-round">{{ r.round }}</span><span class="fund-date">{{ r.date || '时间未披露' }}</span></div>
          <div class="fund-amt">{{ r.amount }}<span v-if="r.amountUnsourced" class="uns">金额在资料里找不到</span><Xsrc v-else :n="r.xsrc" /></div>
          <div class="fund-inv">
            <template v-if="r.lead">领投：<b>{{ r.lead }}</b><template v-if="r.investors.length > 1"> ｜ 跟投：{{ r.investors.filter((x) => x !== r.lead).join('、') }}</template></template>
            <template v-else-if="r.investors.length">投资方：{{ r.investors.join('、') }}</template>
            <template v-else>投资方未披露</template>
            <Refs :prefix="P" :src="r.src" />
          </div>
        </div>
      </div>
    </div>
  </div>

  </div>
  <div class="sub-h">企业生态位 · 十字图</div>
  <div v-if="data.positionMapNote" class="warn">{{ data.positionMapNote }}</div>
  <template v-if="data.positionMap">
    <div class="pm-box">
      <svg class="pmap" viewBox="0 0 960 620" role="img" aria-label="企业生态位十字图">
        <rect :x="X0" :y="Y0" :width="MX - X0" :height="MY - Y0" rx="10" fill="#F3F7FC" />
        <rect :x="MX" :y="Y0" :width="X1 - MX" :height="MY - Y0" rx="10" fill="#F0F8F6" />
        <rect :x="X0" :y="MY" :width="MX - X0" :height="Y1 - MY" rx="10" fill="#F7F8FA" />
        <rect :x="MX" :y="MY" :width="X1 - MX" :height="Y1 - MY" rx="10" fill="#FCF7EF" />
        <rect :x="X0" :y="Y0" :width="X1 - X0" :height="Y1 - Y0" rx="10" fill="none" stroke="#CBD6E3" stroke-width="1.2" />
        <line :x1="MX" :y1="Y0" :x2="MX" :y2="Y1" stroke="#AEBECE" stroke-width="1.2" stroke-dasharray="6 5" />
        <line :x1="X0" :y1="MY" :x2="X1" :y2="MY" stroke="#AEBECE" stroke-width="1.2" stroke-dasharray="6 5" />
        <g font-size="12.5" font-weight="650">
          <text :x="X0 + 14" :y="Y0 + 22" fill="#527CA8"><tspan :x="X0 + 14">{{ ax!.xl }}</tspan><tspan :x="X0 + 14" dy="17">× {{ ax!.yt }}</tspan></text>
          <text :x="X1 - 14" :y="Y0 + 22" fill="#32877D" text-anchor="end"><tspan :x="X1 - 14">{{ ax!.xr }}</tspan><tspan :x="X1 - 14" dy="17">× {{ ax!.yt }}</tspan></text>
          <text :x="X0 + 14" :y="Y1 - 31" fill="#7B8798"><tspan :x="X0 + 14">{{ ax!.xl }}</tspan><tspan :x="X0 + 14" dy="17">× {{ ax!.yb }}</tspan></text>
          <text :x="X1 - 14" :y="Y1 - 31" fill="#B57A32" text-anchor="end"><tspan :x="X1 - 14">{{ ax!.xr }}</tspan><tspan :x="X1 - 14" dy="17">× {{ ax!.yb }}</tspan></text>
        </g>
        <text :x="X0" y="42" font-size="14" font-weight="650" fill="#42526A">↑ {{ data.positionMap.yTop.slice(0, 26) }}</text>
        <text :x="X0" y="558" font-size="14" font-weight="650" fill="#42526A">↓ {{ data.positionMap.yBottom.slice(0, 26) }}</text>
        <text :x="X0" y="588" font-size="14" font-weight="650" fill="#42526A">← {{ data.positionMap.xLeft.slice(0, 26) }}</text>
        <text :x="X1" y="588" font-size="14" font-weight="650" fill="#42526A" text-anchor="end">{{ data.positionMap.xRight.slice(0, 26) }} →</text>
        <g v-for="p in points" :key="p.name" class="pm-dot" @mouseenter="hov = p.name" @mouseleave="hov = null" @click="hov = hov === p.name ? null : p.name">
          <circle :cx="p.cx" :cy="p.cy" r="16" fill="transparent" />
          <circle :cx="p.cx" :cy="p.cy" :r="p.self ? 12 : 10" :fill="p.self ? '#12386B' : hov === p.name ? '#B08D57' : '#5F7896'" stroke="#fff" stroke-width="2" />
          <text :x="p.cx" :y="p.cy + 1" font-size="12" font-weight="800" fill="#fff" text-anchor="middle" dominant-baseline="central">{{ p.no }}</text>
          <title>{{ p.name }}</title>
        </g>
        <g v-for="p in shown" :key="`l-${p.name}`" class="pm-lbl">
          <line :x1="p.cx" :y1="p.cy" :x2="p.lx + (p.lx > p.cx ? 0 : p.w)" :y2="p.ly + p.h / 2" stroke="#9DB0C6" stroke-width="0.8" opacity=".6" />
          <rect :x="p.lx" :y="p.ly" :width="p.w" :height="p.h" rx="6" :fill="p.self ? '#12386B' : '#FFFFFF'" :stroke="p.self ? '#12386B' : '#B08D57'" stroke-width="0.9" />
          <text :x="p.lx + p.w / 2" :y="p.ly + p.h / 2 + 1" font-size="12.5" :font-weight="p.self ? 700 : 600" :fill="p.self ? '#FFFFFF' : '#26364A'" text-anchor="middle" dominant-baseline="central">{{ p.label }}</text>
        </g>
      </svg>
      <div class="pm-qlist">
        <p class="muted" style="margin-bottom:8px">横轴：{{ data.positionMap.xLeft }} ↔ {{ data.positionMap.xRight }}；纵轴：{{ data.positionMap.yBottom }} ↔ {{ data.positionMap.yTop }}</p>
        <div v-for="q in quads" :key="q.h" class="pm-q">
          <div class="pm-qh">{{ q.h }}</div>
          <div class="pm-qb"><span v-for="p in q.pts" :key="p.name" :class="['pm-qi', { self: p.self }]"><i>{{ p.no }}</i>{{ p.name }}</span></div>
        </div>
      </div>
      <div class="pm-legend x-detail">
        <div v-for="p in points" :key="p.name" :class="['pm-item', { 'pm-self': p.self }]">
          <span class="pm-no">{{ p.no }}</span>
          <div class="pm-body"><div class="pm-h"><b>{{ p.name }}</b><span v-if="p.self" class="pm-tag">本标的</span></div><div class="pm-note">{{ p.note }}</div></div>
        </div>
      </div>
    </div>
    <div class="note-line">{{ data.positionMap.conclusion }}</div>
  </template>
</template>
