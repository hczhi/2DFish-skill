<script setup lang="ts">
import { ref, computed, inject } from 'vue'
import { api } from '../../lib/api'
import { BP_CTX } from './ctx'

// 一章的「补充资料」：贴链接（服务端抓正文）/ 传研报文件 / 看已排除的检索结果。
// 补了不会自己生效 —— 要点「用补充资料重跑这一章」，那会连带重跑后面的章节（确认框里列出来）。

const props = defineProps<{ chapter: 'credit' | 'team' | 'industry' | 'competitors' | 'investors'; step: string }>()
const ctx = inject(BP_CTX, null)
const mine = computed(() => ctx?.materials.value.filter((m) => m.chapter === props.chapter) || [])
const added = computed(() => mine.value.filter((m) => m.kind !== 'exclude'))
const excluded = computed(() => mine.value.filter((m) => m.kind === 'exclude'))
const url = ref('')
const busy = ref(false)
const err = ref('')
const info = ref('')
const open = ref(false)

async function call(input: RequestInfo, init: RequestInit) {
  busy.value = true
  err.value = ''
  info.value = ''
  try {
    const res = await api(String(input), init)
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
    await ctx?.refresh()
    return data
  } catch (e: any) {
    err.value = e?.message || String(e)
    return null
  } finally {
    busy.value = false
  }
}

async function addUrl() {
  const d = await call(`/api/bp/reports/${ctx!.reportId}/materials`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chapter: props.chapter, kind: 'url', url: url.value.trim() }),
  })
  if (d) { url.value = ''; info.value = `已抓下 ${d.chars} 字正文。点下面的按钮重跑这一章才会用上。` }
}

async function addFile(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  ;(e.target as HTMLInputElement).value = ''
  if (!f) return
  const fd = new FormData()
  fd.append('chapter', props.chapter) // 必须在 file 前面（multer 只解析文件之前的字段）
  fd.append('file', f)
  const d = await call(`/api/bp/reports/${ctx!.reportId}/materials/file`, { method: 'POST', body: fd })
  if (d) {
    const extra = [...(d.notes || []), d.emptyPages ? `${d.emptyPages} 页没读到文字（整页是图片）` : ''].filter(Boolean).join('；')
    info.value = `已读入 ${d.chars} 字。${extra ? `注意：${extra}。` : ''}点下面的按钮重跑这一章才会用上。`
  }
}

const remove = (id: string) => call(`/api/bp/reports/${ctx!.reportId}/materials/${id}`, { method: 'DELETE' })
</script>

<template>
  <div v-if="ctx" class="mat no-print">
    <button class="mat-toggle" @click="open = !open">
      {{ open ? '▾' : '▸' }} 补充资料<span v-if="mine.length" class="mat-cnt">已补 {{ added.length }} 份 · 已排除 {{ excluded.length }} 条</span>
      <span class="mat-hint">检索结果不准？贴链接、传研报，或在上面的来源里点「排除」，然后重跑这一章</span>
    </button>
    <div v-if="open" class="mat-body">
      <div v-if="!ctx.editable.value" class="warn">报告正在跑，跑完之后才能改补充资料。</div>
      <template v-else>
        <div class="mat-row">
          <input v-model="url" class="mat-input" placeholder="贴一个链接（研报、新闻、官网页面），服务端抓正文" :disabled="busy" @keyup.enter="url && addUrl()" />
          <button class="btn" :disabled="busy || !url.trim()" @click="addUrl">{{ busy ? '处理中…' : '抓取' }}</button>
          <label class="btn" :class="{ disabled: busy }">上传文件<input type="file" accept=".pdf,.pptx,.docx,.txt,.md" hidden :disabled="busy" @change="addFile" /></label>
        </div>
      </template>
      <div v-if="err" class="err" style="margin:8px 0 0">{{ err }}</div>
      <div v-if="info" class="mat-info">{{ info }}</div>
      <ul v-if="mine.length" class="mat-list">
        <li v-for="m in mine" :key="m.id">
          <span :class="['mat-kind', m.kind]">{{ m.kind === 'exclude' ? '已排除' : m.kind === 'file' ? '文件' : '链接' }}</span>
          <a v-if="!m.url.startsWith('upload://')" :href="m.url" target="_blank" rel="noopener">{{ m.title || m.url }}</a>
          <span v-else>{{ m.title }}</span>
          <span v-if="m.kind !== 'exclude'" class="src-date">{{ m.chars }} 字</span>
          <button v-if="ctx.editable.value" class="mat-del" :disabled="busy" @click="remove(m.id)">删除</button>
        </li>
      </ul>
      <div v-if="ctx.editable.value && mine.length" style="margin-top:10px">
        <button class="btn primary" :disabled="busy" @click="ctx.rerun(step)">用补充资料重跑这一章</button>
      </div>
    </div>
  </div>
</template>
