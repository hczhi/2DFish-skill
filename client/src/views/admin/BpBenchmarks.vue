<script setup lang="ts">
// BP 分析 · 平台参考口径（行业 × 当前轮次）：融资方案章的投前估值区间、常见出让比例、到下一轮的门槛。
// 缺省值在 server/src/services/bp/benchmarks.ts；这里改过的格子才落库（「已校准」），可以一键恢复缺省。
// 报告里这些数一律标「平台参考口径」—— 改坏了的后果是每份报告都拿错的标准去对照，所以保存前服务端会逐字段校验。

import { ref, computed, onMounted } from 'vue'
import { api } from '../../lib/api'

interface Row {
  sector: string; sectorLabel: string; stage: string; stageLabel: string
  data: any; defaults: any; edited: boolean; updatedAt: string | null; updatedBy: string | null
}

const rows = ref<Row[]>([])
const err = ref('')
const msg = ref('')
const sel = ref<string>('')
const draft = ref('')
const busy = ref(false)

const current = computed(() => rows.value.find((r) => `${r.sector}/${r.stage}` === sel.value) || null)
const sectors = computed(() => [...new Map(rows.value.map((r) => [r.sector, r.sectorLabel])).entries()])
const dirty = computed(() => !!current.value && draft.value !== JSON.stringify(current.value.data, null, 2))

async function load() {
  err.value = ''
  const res = await api('/api/bp/admin/benchmarks')
  const data = await res.json().catch(() => ({}))
  if (!res.ok) { err.value = data.error || `HTTP ${res.status}`; return }
  rows.value = data.rows
  if (!sel.value && rows.value.length) pick(`${rows.value[0].sector}/${rows.value[0].stage}`)
  else if (current.value) draft.value = JSON.stringify(current.value.data, null, 2)
}

function pick(key: string) {
  if (dirty.value && !confirm('这一格有没保存的改动，切走会丢掉。继续？')) return
  sel.value = key
  draft.value = JSON.stringify(current.value?.data, null, 2)
  msg.value = ''
  err.value = ''
}

async function save() {
  if (!current.value) return
  let data: unknown
  try { data = JSON.parse(draft.value) } catch (e: any) { err.value = `不是合法的 JSON：${e?.message || e}`; return }
  busy.value = true
  err.value = ''
  try {
    const res = await api(`/api/bp/admin/benchmarks/${current.value.sector}/${current.value.stage}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data }),
    })
    const out = await res.json().catch(() => ({}))
    if (!res.ok) { err.value = out.error || `HTTP ${res.status}`; return }
    msg.value = '已保存。之后新跑（或重跑 09 章）的报告按这一格对照。'
    await load()
  } finally { busy.value = false }
}

async function reset() {
  if (!current.value || !confirm('恢复成代码里的缺省值？')) return
  busy.value = true
  try {
    await api(`/api/bp/admin/benchmarks/${current.value.sector}/${current.value.stage}`, { method: 'DELETE' })
    msg.value = '已恢复缺省。'
    await load()
  } finally { busy.value = false }
}

onMounted(load)
</script>

<template>
  <div class="bb">
    <h1>BP 参考口径</h1>
    <p class="lead">融资方案章（09）用的估值区间、出让比例和下一轮门槛。按「行业 × 当前轮次」一格一格配；报告里标「平台参考口径」。金额单位万元，百分比写 0–100。</p>
    <div v-if="err" class="err">{{ err }}</div>
    <div class="layout">
      <aside>
        <div v-for="[sk, sl] in sectors" :key="sk" class="grp">
          <div class="gh">{{ sl }}</div>
          <button v-for="r in rows.filter((x) => x.sector === sk)" :key="r.stage" :class="['cell', { on: sel === `${r.sector}/${r.stage}` }]" @click="pick(`${r.sector}/${r.stage}`)">
            {{ r.stageLabel }}<em v-if="r.edited">已校准</em>
          </button>
        </div>
      </aside>
      <section v-if="current">
        <div class="hd">
          <b>{{ current.sectorLabel }} · {{ current.stageLabel }}</b>
          <span v-if="current.edited" class="tag">已校准 · {{ current.updatedBy }} · {{ current.updatedAt?.slice(0, 16).replace('T', ' ') }}</span>
          <span v-else class="tag def">缺省</span>
        </div>
        <textarea v-model="draft" spellcheck="false" />
        <div class="acts">
          <button class="pri" :disabled="busy || !dirty" @click="save">保存</button>
          <button :disabled="busy || !current.edited" @click="reset">恢复缺省</button>
          <span v-if="msg" class="ok">{{ msg }}</span>
        </div>
        <details>
          <summary>字段说明 / 缺省值</summary>
          <ul class="help">
            <li><code>valuation</code>：常见投前估值 [低, 高]，万元</li>
            <li><code>dilution</code>：常见出让比例 [低, 高]，%</li>
            <li><code>nextRound</code>：下一轮的名字</li>
            <li><code>thresholds</code>：到下一轮的门槛，每条 <code>{ metric, label, op: "&gt;=" | "&lt;=", value, unit }</code>；metric 必须是 5.12 能算出来的指标键（如 <code>annual</code> 年收入、<code>customers</code>、<code>grossMargin</code>、<code>arr</code>、<code>ndr</code>…），非数字门槛写 <code>text</code></li>
          </ul>
          <pre>{{ JSON.stringify(current.defaults, null, 2) }}</pre>
        </details>
      </section>
    </div>
  </div>
</template>

<style scoped>
.bb { padding: 24px; max-width: 1200px; }
h1 { font-size: 22px; margin: 0 0 6px; }
.lead { color: #666; font-size: 14px; margin: 0 0 16px; }
.err { white-space: pre-line; background: #fff1f0; color: #a8071a; border: 1px solid #ffccc7; padding: 10px 12px; border-radius: 6px; margin-bottom: 12px; font-size: 13px; }
.layout { display: grid; grid-template-columns: 240px 1fr; gap: 20px; }
aside { border-right: 1px solid #eee; padding-right: 12px; max-height: 75vh; overflow: auto; }
.grp { margin-bottom: 12px; }
.gh { font-size: 12px; color: #999; margin: 6px 0; }
.cell { display: flex; justify-content: space-between; width: 100%; text-align: left; padding: 6px 10px; border: 0; background: none; border-radius: 6px; cursor: pointer; font-size: 14px; }
.cell:hover { background: #f5f5f5; }
.cell.on { background: #e6f0ff; color: #1B4E85; font-weight: 600; }
.cell em { font-style: normal; font-size: 11px; color: #BA7517; }
.hd { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.tag { font-size: 12px; color: #BA7517; background: #fdf3e3; border-radius: 4px; padding: 1px 8px; }
.tag.def { color: #666; background: #f2f2f2; }
textarea { width: 100%; min-height: 420px; font-family: Menlo, monospace; font-size: 13px; line-height: 1.6; padding: 12px; border: 1px solid #ddd; border-radius: 6px; }
.acts { display: flex; gap: 10px; align-items: center; margin: 10px 0; }
.acts button { padding: 6px 16px; border: 1px solid #ccc; background: #fff; border-radius: 6px; cursor: pointer; }
.acts .pri { background: #1B4E85; color: #fff; border-color: #1B4E85; }
.acts button:disabled { opacity: .5; cursor: not-allowed; }
.ok { color: #0F6E56; font-size: 13px; }
.help { font-size: 13px; color: #555; padding-left: 18px; }
pre { background: #fafafa; border: 1px solid #eee; padding: 10px; font-size: 12px; border-radius: 6px; max-height: 300px; overflow: auto; }
</style>
