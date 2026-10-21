<script setup lang="ts">
import { ref, computed } from 'vue'
import { api } from '../../lib/api'

// BP 投资分析 · 第一步：上传 BP → 项目事实卡。不存历史，刷新就没了。

type Label = 'disclosed' | 'computed' | 'inferred' | 'missing' | 'unverified'
interface Item { field: string; value: string; label: Label; quote: string; page: number | null; basis: string }
interface Section { key: string; title: string; items: Item[] }
interface Card {
  filename: string; chars: number; sections: Section[]
  issues: { text: string; quote: string; page: number | null }[]; notes: string[]
}

const LABEL_TEXT: Record<Label, string> = {
  disclosed: '材料披露', computed: '计算结果', inferred: '推断', missing: '未披露', unverified: '原文对不上',
}

const file = ref<File | null>(null)
const text = ref('')
const loading = ref(false)
const error = ref('')
const card = ref<Card | null>(null)

const canSubmit = computed(() => !loading.value && (!!file.value || !!text.value.trim()))

function onFile(e: Event) {
  file.value = (e.target as HTMLInputElement).files?.[0] || null
}

async function submit() {
  loading.value = true
  error.value = ''
  card.value = null
  try {
    const fd = new FormData()
    if (file.value) fd.append('file', file.value)
    else fd.append('text', text.value)
    const res = await api('/api/bp/fact-card', { method: 'POST', body: fd })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.detail || data.error || `请求失败（HTTP ${res.status}）`)
    card.value = data
  } catch (e: any) {
    error.value = e?.message || String(e)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="bp">
    <h1>BP 项目事实卡</h1>
    <p class="lead">上传商业计划书，抽出公司、产品、团队、经营、融资五类事实，每条标注出处和可信度。每次消耗 1 次 AI 额度。</p>

    <div class="input">
      <label class="file">
        <input type="file" accept=".pdf,.pptx,.docx,.doc,.txt,.md,.ppt" @change="onFile" />
      </label>
      <textarea v-if="!file" v-model="text" rows="5" placeholder="或者直接粘贴项目介绍文字" />
      <button :disabled="!canSubmit" @click="submit">{{ loading ? '分析中（约 30-90 秒）…' : '生成事实卡' }}</button>
    </div>

    <div v-if="error" class="error">{{ error }}</div>

    <div v-if="card" class="card">
      <div class="meta">{{ card.filename }} · {{ card.chars }} 字</div>
      <ul v-if="card.notes.length" class="notes">
        <li v-for="(n, i) in card.notes" :key="i">{{ n }}</li>
      </ul>

      <section v-for="s in card.sections" :key="s.key">
        <h2>{{ s.title }}</h2>
        <table>
          <tr v-for="(it, i) in s.items" :key="i" :class="it.label">
            <td class="field">{{ it.field }}</td>
            <td class="value">
              <div>{{ it.value || '—' }}</div>
              <div v-if="it.label === 'disclosed' || it.label === 'unverified'" class="quote">
                「{{ it.quote }}」<span v-if="it.page"> · 第 {{ it.page }} 页</span>
              </div>
              <div v-else-if="it.basis" class="quote">依据：{{ it.basis }}</div>
            </td>
            <td class="tag"><span :class="['lbl', it.label]">{{ LABEL_TEXT[it.label] }}</span></td>
          </tr>
        </table>
      </section>

      <section v-if="card.issues.length">
        <h2>存疑 / 矛盾</h2>
        <ul class="issues">
          <li v-for="(x, i) in card.issues" :key="i">
            {{ x.text }}
            <div v-if="x.quote" class="quote">「{{ x.quote }}」<span v-if="x.page"> · 第 {{ x.page }} 页</span></div>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>

<style scoped>
.bp { max-width: 960px; margin: 0 auto; padding: 32px 20px 80px; color: #1f2329; }
h1 { font-size: 26px; margin: 0 0 6px; }
.lead { color: #646a73; margin: 0 0 20px; }
.input { display: flex; flex-direction: column; gap: 12px; padding: 16px; border: 1px solid #e5e6eb; border-radius: 10px; }
textarea { width: 100%; padding: 10px; border: 1px solid #dee0e3; border-radius: 6px; font: inherit; resize: vertical; }
button { align-self: flex-start; padding: 8px 20px; border: 0; border-radius: 6px; background: #3370ff; color: #fff; cursor: pointer; }
button:disabled { background: #bbbfc4; cursor: not-allowed; }
.error { margin-top: 16px; padding: 12px; border-radius: 6px; background: #fff0f0; color: #c02a2a; white-space: pre-line; }
.card { margin-top: 24px; }
.meta { color: #8f959e; font-size: 13px; }
.notes { margin: 12px 0; padding: 12px 12px 12px 30px; background: #fff7e6; border-radius: 6px; color: #8a5a00; }
h2 { font-size: 18px; margin: 24px 0 8px; }
table { width: 100%; border-collapse: collapse; }
td { padding: 8px; border-bottom: 1px solid #f0f1f2; vertical-align: top; }
.field { width: 130px; color: #646a73; }
.tag { width: 90px; text-align: right; }
.quote { margin-top: 4px; font-size: 12px; color: #8f959e; }
tr.missing .value { color: #bbbfc4; }
.lbl { font-size: 12px; padding: 2px 8px; border-radius: 10px; background: #f0f1f2; color: #646a73; white-space: nowrap; }
.lbl.disclosed { background: #e8f8ee; color: #1a7f42; }
.lbl.computed { background: #e8f0ff; color: #245bdb; }
.lbl.inferred { background: #fff3e0; color: #b25e00; }
.lbl.unverified { background: #fff0f0; color: #c02a2a; }
.issues li { margin-bottom: 8px; }
</style>
