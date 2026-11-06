<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api } from '../../lib/api'
import '../../components/bp/deck/deck.css'
import DeckSlide from '../../components/bp/deck/DeckSlide.vue'
import { buildSlides, PARTS, SHORT } from '../../components/bp/deck/slides'

// BP 报告演示版：给客户讲解用。16:9 固定画布（1600×900）按屏幕等比缩放，一屏一页。
// ←/→、空格、PageUp/Down、点左右两侧翻页；G 或右下角「总览」看全部缩略图；F 全屏；Esc 退出总览。
// 当前页记在 ?p=（刷新 / 断线重连回到原页）。内容全由 slides.ts 从已有报告数据挑，不调模型。

const route = useRoute()
const router = useRouter()
const report = ref<any>(null)
const loadError = ref('')
const idx = ref(Math.max(0, Number(route.query.p || 1) - 1))
const dir = ref<'next' | 'prev'>('next')
const overview = ref(false)
const scale = ref(1)
const isFs = ref(!!document.fullscreenElement)
const idle = ref(false)

const fact = (section: string, field: string) => {
  const it = report.value?.result.factCard?.sections.find((s: any) => s.key === section)?.items.find((i: any) => i.field === field)
  return it && it.label !== 'missing' ? it.value : ''
}
const meta = computed(() => ({
  company: fact('company', '公司名称') || report.value?.filename?.replace(/\.[^.]+$/, '') || '',
  brandLine: [fact('company', '所属行业'), fact('financing', '本轮轮次'), fact('company', '所在地')].filter(Boolean).join(' · '),
  date: report.value ? new Date(report.value.created_at).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }) : '',
}))
const deck = computed(() => (report.value ? buildSlides(report.value.result, meta.value) : { slides: [], skipped: [] }))
const slides = computed(() => deck.value.slides)
const cur = computed(() => slides.value[idx.value])

async function load() {
  try {
    const res = await api(`/api/bp/reports/${route.params.id}`)
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
    report.value = data
    document.title = `演示 · ${meta.value.company || 'BP 体检报告'}`
    if (idx.value >= slides.value.length) idx.value = 0
  } catch (e: any) {
    loadError.value = `报告没加载出来：${e?.message || e}`
  }
}

function goTo(i: number) {
  if (i < 0 || i >= slides.value.length || i === idx.value) return
  dir.value = i > idx.value ? 'next' : 'prev'
  idx.value = i
}
const next = () => goTo(idx.value + 1)
const prev = () => goTo(idx.value - 1)
watch(idx, (i) => router.replace({ query: { ...route.query, p: String(i + 1) } }))

function fit() { scale.value = Math.min(window.innerWidth / 1600, window.innerHeight / 900) }
async function toggleFs() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen()
    else await document.documentElement.requestFullscreen()
  } catch { /* 浏览器拒绝（iframe 没给 allowfullscreen 等）：照常在窗口里演示 */ }
}
function exit() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
  router.push(`/consult/bp/reports/${route.params.id}`)
}

function onKey(e: KeyboardEvent) {
  if (e.metaKey || e.ctrlKey || e.altKey) return
  const k = e.key
  if (overview.value) {
    if (k === 'Escape' || k === 'g' || k === 'G') overview.value = false
    return
  }
  if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(k)) { e.preventDefault(); next() }
  else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(k)) { e.preventDefault(); prev() }
  else if (k === 'Home') goTo(0)
  else if (k === 'End') goTo(slides.value.length - 1)
  else if (k === 'g' || k === 'G') overview.value = true
  else if (k === 'f' || k === 'F') toggleFs()
}

// 触屏左右滑。
let sx = 0, sy = 0
const onTouchStart = (e: TouchEvent) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY }
const onTouchEnd = (e: TouchEvent) => {
  const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy
  if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) (dx < 0 ? next : prev)()
}

// 鼠标不动 2.5 秒后藏起控件（讲解时画面干净）。
let idleTimer: ReturnType<typeof setTimeout> | null = null
function wake() {
  idle.value = false
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => (idle.value = true), 2500)
}
const onFs = () => { isFs.value = !!document.fullscreenElement }

// 进度：按部分分段，每段里一页一个点。
const partSlides = computed(() => PARTS.map((_, p) => slides.value.map((s, i) => ({ s, i })).filter((x) => x.s.part === p)))
const curPart = computed(() => cur.value?.part ?? -1)

onMounted(() => {
  load(); fit(); wake()
  window.addEventListener('resize', fit)
  window.addEventListener('keydown', onKey)
  window.addEventListener('mousemove', wake)
  document.addEventListener('fullscreenchange', onFs)
})
onUnmounted(() => {
  window.removeEventListener('resize', fit)
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('mousemove', wake)
  document.removeEventListener('fullscreenchange', onFs)
  if (idleTimer) clearTimeout(idleTimer)
})
</script>

<template>
  <div :class="['dk', { idle: idle && !overview }]" @touchstart.passive="onTouchStart" @touchend.passive="onTouchEnd">
    <div v-if="loadError" class="dk-msg">{{ loadError }} <button class="dk-btn" @click="exit">返回报告</button></div>
    <div v-else-if="!report" class="dk-msg">正在载入报告…</div>

    <template v-else>
      <!-- 舞台 -->
      <div class="dk-stage" :style="{ width: `${1600 * scale}px`, height: `${900 * scale}px` }">
        <div class="dk-canvas" :style="{ transform: `scale(${scale})` }">
          <Transition :name="`dk-${dir}`">
            <DeckSlide :key="cur.id" :s="cur" :index="idx" :total="slides.length" :company="meta.company" />
          </Transition>
        </div>
        <button class="dk-zone l" :disabled="idx === 0" aria-label="上一页" @click="prev"><span>‹</span></button>
        <button class="dk-zone r" :disabled="idx === slides.length - 1" aria-label="下一页" @click="next"><span>›</span></button>
      </div>

      <!-- 底部控制条 -->
      <div class="dk-ctrl">
        <button class="dk-btn" @click="exit">← 退出演示</button>
        <div class="dk-prog">
          <div v-for="(seg, p) in partSlides" :key="p" :class="['dk-seg', { on: curPart === p }]">
            <span class="dk-seg-n">{{ PARTS[p] }}</span>
            <span class="dk-dots"><i v-for="x in seg" :key="x.i" :class="{ on: x.i === idx, done: x.i < idx }" :title="SHORT[x.s.id] || x.s.title" @click="goTo(x.i)" /></span>
          </div>
        </div>
        <span class="dk-pn">{{ idx + 1 }} / {{ slides.length }}</span>
        <button class="dk-btn" title="总览（G）" @click="overview = true">总览</button>
        <button class="dk-btn" :title="isFs ? '退出全屏（F）' : '全屏（F）'" @click="toggleFs">{{ isFs ? '退出全屏' : '全屏' }}</button>
      </div>

      <!-- 总览 -->
      <Transition name="dk-ov">
        <div v-if="overview" class="dk-ov" @click.self="overview = false">
          <div class="dk-ov-h">
            <b>{{ meta.company }} · 共 {{ slides.length }} 页</b>
            <span>点一页跳过去 · Esc 返回</span>
            <button class="dk-btn" @click="overview = false">返回演示</button>
          </div>
          <div class="dk-ov-grid">
            <button v-for="(s, i) in slides" :key="s.id" :class="['dk-th', { on: i === idx }]" @click="goTo(i); overview = false">
              <div class="dk-th-c"><DeckSlide :s="s" :index="i" :total="slides.length" :company="meta.company" still /></div>
              <span>{{ i + 1 }}　{{ s.kind === 'cover' ? '封面' : s.kind === 'end' ? '结束' : s.kind === 'divider' ? `第${['一', '二', '三', '四'][s.part]}部分 · ${s.title}` : SHORT[s.id] || s.title }}</span>
            </button>
          </div>
          <div v-if="deck.skipped.length" class="dk-ov-skip">
            <b>没有进演示版的内容</b>（讲解前心里有数，客户问到时可以回快速阅读版看）：
            <span v-for="(x, i) in deck.skipped" :key="i">{{ x }}</span>
          </div>
        </div>
      </Transition>
    </template>
  </div>
</template>
