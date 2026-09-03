<template>
  <div class="page">
    <div class="head">
      <div>
        <div class="crumb">
          <router-link to="/ppt/decks">← 演示稿列表</router-link>
        </div>
        <h1>
          <input
            v-model="title"
            class="title-input"
            maxlength="80"
            placeholder="这份演示稿的名字"
            @blur="saveMeta()"
          />
        </h1>
        <p class="sub">
          贴一份提纲，AI 把它拆成逐页、并从<router-link to="/ppt/layouts">案例库那 22 个版式</router-link>里给每页挑一个。
          这一步<b>只挑版式、不生成 HTML</b> —— 先看它挑得准不准（每页都有理由和效果 demo），挑准了再往下生成。
        </p>
      </div>
      <a class="btn-ghost" href="/api/ppt/demo-deck.html" target="_blank">看全部版式 demo ↗</a>
    </div>

    <!-- 打不开这份稿子（换了账号 / 已删掉 / id 抄错）必须说清并给一条回列表的路：
         只留一个空的提纲框的话，读起来像「这份稿子里什么都没有」，他会当场重打一遍提纲。 -->
    <p v-if="loadErr" class="err">{{ loadErr }} <router-link to="/ppt/decks">回演示稿列表</router-link></p>

    <!-- 「哪些东西存下来了」必须写在界面上。这一版只存提纲/名字/品牌/画风：
         不说的话他会以为规划和已生成的页也存着，关掉页面回来发现只剩提纲，
         而那十几次调用的额度已经花掉了。 -->
    <p class="save-note" :class="{ bad: metaErr }">
      <template v-if="metaErr">{{ metaErr }}</template>
      <template v-else>
        {{ savingMeta ? '保存中…' : metaSavedAt ? `名字 / 提纲 / 品牌 / 画风已存（${metaSavedAt}）` : '名字 / 提纲 / 品牌 / 画风会存进这份稿子' }}
        · <b>规划结果和已生成的页这一版还没落库</b> —— 刷新会丢，这一片正在接。
      </template>
    </p>

    <div class="input-box">
      <textarea
        v-model="outline"
        :disabled="running"
        @blur="saveMeta()"
        placeholder="贴提纲。一行一条，带层级最好，例如：

云启数科 · AI 转型方案汇报
一、为什么现在做
  1. 行业三个变化：算力降本 / 政策 / 客户预期
  2. 我们的现状：三条业务线、两个痛点
二、我们怎么做
  1. 三阶段路径（试点 → 复制 → 平台化）
  2. 组织与人才
三、投入与回报
  1. 预算拆分
  2. 12 个月里程碑
四、下一步"
      ></textarea>
      <div class="input-foot">
        <span class="count" :class="{ over: outline.length > MAX_OUTLINE }">
          {{ outline.length }} / {{ MAX_OUTLINE }} 字
        </span>
        <div class="actions">
          <!-- 品牌名只影响 deck 外壳（页脚/封面那几个占位符），逐页 HTML 里没有它。
               留空就是「示例企业」—— 拼出来的整份 deck 页脚会印着它。 -->
          <input v-model="brandCn" class="brand" :disabled="running" placeholder="品牌中文名（可空）" maxlength="24" @blur="saveMeta()" />
          <input v-model="brandEn" class="brand en" :disabled="running" placeholder="英文名" maxlength="24" @blur="saveMeta()" />
          <!-- 画风只在生图那一步用得上，但放在这里：整份 deck 只能一个画风，配了两页图
               再回头换的话前面那几页不会自动重做（见下面那句提示）。 -->
          <select v-model="styleId" class="brand style" :title="styleHint" @change="saveMeta()">
            <option v-for="s in styleList" :key="s.id" :value="s.id">{{ s.id }} {{ s.name }}</option>
          </select>
          <button class="btn" :disabled="!canRun" @click="run">
            {{ running ? '规划中…（一次调用，通常 10–40 秒）' : pages.length ? '重新规划' : '开始规划' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 失败必须整块报出来带原文：空结果在界面上和「这份提纲拆不出页」分不开 -->
    <p v-if="error" class="err">{{ error }}</p>

    <!-- problems 是「结果能用但有话要说」。这一步的失败形态全是一份看起来完整的规划：
         编出来的版式名、被截断只规划了一半、连续五页同版式 —— 不显示的话没人发现。 -->
    <div v-if="problems.length" class="problems">
      <div class="problems-title">这次规划有 {{ problems.length }} 处要注意</div>
      <ul>
        <li v-for="(p, i) in problems" :key="i">{{ p }}</li>
      </ul>
    </div>

    <div v-if="pages.length" class="result">
      <div class="result-head">
        <span>共 {{ pages.length }} 页 · 用到 {{ usedLayouts }} 个版式 · 已生成 {{ builtCount }} 页</span>
        <span v-if="usage" class="usage">
          本次 token：输入 {{ usage.prompt_tokens }} / 输出 {{ usage.completion_tokens }}
        </span>
      </div>

      <div class="batch">
        <button class="btn" :disabled="batchRunning || !pendingCount" @click="runAll">
          {{ batchRunning ? `生成中… 第 ${batchAt} / ${pages.length} 页` : `生成${builtCount ? '剩下的 ' : '全部 '}${pendingCount} 页` }}
        </button>
        <!-- 停止是必需的：一页一次真实调用，看到前两页不对时不给停就是把剩下十几次额度花完。 -->
        <button v-if="batchRunning" class="btn-sm ghost" @click="stopBatch">停止</button>
        <button class="btn-sm" :disabled="batchRunning || !builtCount || !imgTodo" @click="fillAllImages">
          {{ imgTodo ? `给全部页配图（还差 ${imgTodo} 张）` : '全部页的图都配好了' }}
        </button>
        <button class="btn-sm" :disabled="batchRunning || builtCount < pages.length" @click="makeDeck">
          {{ deckHtml ? '重新拼整份' : `拼成整份 deck（${pages.length} 页）` }}
        </button>
        <button class="btn-sm" :disabled="batchRunning || exporting || builtCount < pages.length" @click="exportDeck">
          {{ exporting ? '导出中…' : '导出 .html' }}
        </button>
        <span v-if="builtCount < pages.length" class="hint">还差 {{ pendingCount }} 页才能拼整份</span>
      </div>
      <p v-if="batchNote" class="batch-note">{{ batchNote }}</p>
      <!-- 换画风之后已经配好的那几页**不会自动重做**：不说的话整份翻下来笔触不统一，
           而每张图单看都好、没有一处报错。 -->
      <p v-if="styleMismatch" class="batch-note warn">{{ styleMismatch }}</p>

      <template v-for="p in pages" :key="p.page">
      <div class="row">
        <div class="thumb">
          <!-- demo 和案例库那边是同一份拼出来的 deck（同一份 template.html），
               所以这里看到的就是生成阶段照着排的那个骨架。
               pointer-events:none：deck 在 document 上挂了「点一下翻页」。 -->
          <iframe :src="p.demoUrl" loading="lazy" scrolling="no" :title="`${p.layoutId} 效果 demo`"></iframe>
          <span class="page-no">P{{ p.page }}</span>
        </div>
        <div class="info">
          <div class="line1">
            <span class="kicker" v-if="p.section">{{ p.section }}</span>
            <span class="title">{{ p.title }}</span>
          </div>
          <div class="line2">
            <a class="lid" :href="p.demoUrl" target="_blank">{{ p.layoutId }} ↗</a>
            <span class="lname">{{ p.layoutName }}</span>
            <span class="ltitle">{{ p.layoutTitle }}</span>
            <span class="tag full" v-if="p.fullbleed">全幅</span>
            <span class="tag img" v-if="p.images">配图 {{ p.images }} 张</span>
          </div>
          <p class="why" :class="{ missing: !p.why }">
            {{ p.why || '（模型没给挑这个版式的理由 —— 只能自己看 demo 判断）' }}
          </p>
          <ul v-if="p.points.length" class="points">
            <li v-for="(pt, i) in p.points" :key="i">{{ pt }}</li>
          </ul>
          <div class="row-actions">
            <button class="btn-sm" :disabled="busy[p.page] || batchRunning || imgBusy[p.page]" @click="rebuild(p)">
              {{ busy[p.page] ? '生成中…' : built[p.page] ? '重新生成这一页' : '生成这一页 HTML' }}
            </button>
            <button
              v-if="built[p.page] && slotCount(p.page)"
              class="btn-sm"
              :disabled="imgBusy[p.page] || batchRunning || busy[p.page]"
              @click="fillImages(p)"
            >
              {{ imgBusy[p.page] ? '生图中…（一张几十秒）' : filledCount(p.page) ? `补齐这一页的图（还差 ${slotCount(p.page) - filledCount(p.page)} 张）` : `生成这一页的图（${slotCount(p.page)} 张）` }}
            </button>
            <button
              v-if="built[p.page] && filledCount(p.page)"
              class="btn-sm ghost"
              :disabled="imgBusy[p.page] || batchRunning"
              @click="fillImages(p, true)"
            >换一批图</button>
            <button v-if="built[p.page]" class="btn-sm ghost" @click="toggleSrc(p.page)">
              {{ showSrc[p.page] ? '收起 HTML' : '看 HTML' }}
            </button>
            <span v-if="pageErr[p.page]" class="err-inline">{{ pageErr[p.page] }}</span>
            <span v-if="imgErr[p.page]" class="err-inline">{{ imgErr[p.page] }}</span>
          </div>
        </div>
      </div>

      <!-- 生成结果紧跟在那一页下面：预览 + 问题 + 源码。预览用 srcdoc 装服务端拼好的
           单页 deck（同一份 deckShell），所以这里看到的就是最终 deck 里那一页。 -->
      <div v-if="built[p.page]" class="built">
        <!-- 生图是部分成功为常态的一步：逐张说清哪张成了、哪张还是占位图、图存哪了。
             只报一个总数的话，失败的那几格在预览里就是「设计上留白」。 -->
        <div v-if="imgInfo[p.page]" class="imgs">
          <div class="imgs-head">
            配图：{{ imgInfo[p.page].images.filter(i => i.url).length }} / {{ imgInfo[p.page].images.length }} 张有图
            <span class="stylechip">画风 {{ imgInfo[p.page].style?.id }} {{ imgInfo[p.page].style?.name }}</span>
            <span v-if="imgInfo[p.page].quotaExceeded" class="quota">AI 额度已用完，剩下的没再试</span>
          </div>
          <ul>
            <li v-for="im in imgInfo[p.page].images" :key="im.index" :class="{ bad: !im.url }">
              #{{ im.index }} {{ im.ratio }} · {{ im.mode }} · {{ im.prompt || '(没写要什么图)' }}
              <template v-if="im.url">→ <a :href="im.url" target="_blank">看原图</a>
                <em v-if="im.skipped">（上次生成的，这次跳过）</em>
                <em v-else-if="im.storage === 'local'">（存在本机磁盘）</em>
              </template>
              <template v-else>→ <span class="bad">{{ im.error || '没生成' }}（还是占位图）</span></template>
            </li>
          </ul>
        </div>
        <div v-if="imgInfo[p.page]?.problems.length" class="problems small">
          <div class="problems-title">生图有 {{ imgInfo[p.page].problems.length }} 处要注意</div>
          <ul>
            <li v-for="(x, i) in imgInfo[p.page].problems" :key="i">{{ x }}</li>
          </ul>
        </div>
        <div v-if="built[p.page].problems.length" class="problems small">
          <div class="problems-title">这一页有 {{ built[p.page].problems.length }} 处要注意</div>
          <ul>
            <li v-for="(x, i) in built[p.page].problems" :key="i">{{ x }}</li>
          </ul>
        </div>
        <div class="preview">
          <iframe :srcdoc="built[p.page].previewHtml" :title="`第 ${p.page} 页预览`"></iframe>
        </div>
        <pre v-if="showSrc[p.page]" class="src">{{ built[p.page].html }}</pre>
      </div>
      </template>

      <!-- 导出的那份文件依赖什么必须写在界面上：那几句话是唯一能解释「转给同事打开图全
           是破的」的地方，而下载下来的文件本身打开一片正常。 -->
      <p v-if="exportErr" class="err">{{ exportErr }}</p>
      <div v-if="exportNote" class="export-note">
        <b>{{ exportNote }}</b>
        <ul v-if="exportWarnings.length">
          <li v-for="(w, i) in exportWarnings" :key="i">{{ w }}</li>
        </ul>
      </div>

      <p v-if="deckErr" class="err">{{ deckErr }}</p>
      <div v-if="deckHtml" class="deck">
        <div class="deck-head">
          <b>整份预览（{{ pages.length }} 页）</b>
          <span class="hint">点画面右侧/按 → 翻页。改过某一页之后要重新拼一次。</span>
        </div>
        <div class="preview big">
          <iframe :srcdoc="deckHtml" title="整份 deck 预览"></iframe>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { apiGet, apiPost, apiPatch } from '../../lib/api'

interface PlannedPage {
  page: number; section: string; title: string; points: string[]
  layoutId: string; why: string; images: number
  layoutName: string; layoutTitle: string; fullbleed: boolean; demoUrl: string
}

/** 和服务端 planService.MAX_OUTLINE_CHARS 一致（超了服务端明确拒绝，不截断）。 */
const MAX_OUTLINE = 12000

const outline = ref('')
const running = ref(false)
const error = ref('')
const pages = ref<PlannedPage[]>([])
const problems = ref<string[]>([])
const usage = ref<{ prompt_tokens: number; completion_tokens: number; total_tokens: number } | null>(null)

interface BuiltPage { html: string; previewHtml: string; problems: string[] }
const built = ref<Record<number, BuiltPage>>({})
const busy = ref<Record<number, boolean>>({})
const pageErr = ref<Record<number, string>>({})
const showSrc = ref<Record<number, boolean>>({})

const brandCn = ref('')
const brandEn = ref('')

// ── 这份稿子（落库，migration 089）────────────────────────────
const route = useRoute()
const deckId = computed(() => String(route.params.id || ''))
const title = ref('')
const loadErr = ref('')
const savingMeta = ref(false)
const metaErr = ref('')
const metaSavedAt = ref('')
/** 上一次真的存进库里的那份值。相同就不再发请求 —— 每次失焦都发一遍的话，
 *  「已存」那句话会在什么都没改的时候不停刷新，读起来像一直在存东西。 */
let savedSnapshot = ''

function metaSnapshot() {
  return JSON.stringify([title.value.trim(), outline.value, brandCn.value, brandEn.value, styleId.value])
}

/**
 * 存这份稿子的元信息（名字 / 提纲 / 品牌 / 画风）。
 *
 * 失败**必须出声**：静默失败的话他改完提纲关掉页面，下次回来是上一版，
 * 而这中间界面上什么都没说 —— 他会以为自己记错了改没改。
 */
async function saveMeta(): Promise<boolean> {
  if (!deckId.value || loadErr.value) return false
  const snap = metaSnapshot()
  if (snap === savedSnapshot) return true
  if (!title.value.trim()) {
    metaErr.value = '名字不能为空（这一次没保存）。'
    return false
  }
  savingMeta.value = true
  metaErr.value = ''
  try {
    await apiPatch(`/api/ppt/decks/${deckId.value}`, {
      title: title.value.trim(),
      outline: outline.value,
      brandCn: brandCn.value,
      brandEn: brandEn.value,
      styleId: styleId.value,
    })
    savedSnapshot = snap
    metaSavedAt.value = new Date().toLocaleTimeString('zh-CN', { hour12: false })
    return true
  } catch (e: any) {
    metaErr.value = `没保存上：${e?.message || '请求失败'} —— 这次改的东西还只在这个页面里，别关掉。`
    return false
  } finally {
    savingMeta.value = false
  }
}

/**
 * 配图画风。清单从 `GET /api/ppt/styles` 来，**不在前端写死** —— md 里加了一套之后
 * 界面上完全看不见，而后端照旧认它（读起来像「就这几种」）。
 * 拿不到清单时下拉留空但不挡生图：服务端不给 styleId 会用它自己的默认那套。
 */
interface StyleItem { id: string; name: string; applicable: string }
const styleList = ref<StyleItem[]>([])
const styleId = ref('')
const styleHint = computed(() => {
  const s = styleList.value.find(x => x.id === styleId.value)
  return s ? `${s.id} ${s.name}：${s.applicable}` : '配图画风（生图那一步用）'
})

/**
 * 已经配过图的页里，有几页用的不是现在选的这套画风。
 * 换画风**不会**自动重做那几页 —— 不说的话整份翻下来笔触不统一，而每张单看都好。
 */
const styleMismatch = computed(() => {
  if (!styleId.value) return ''
  const bad = pages.value.filter(p => {
    const used = imgInfo.value[p.page]?.style?.id
    return used && used !== styleId.value
  }).map(p => p.page)
  if (!bad.length) return ''
  return `第 ${bad.join(' / ')} 页的图是用别的画风生成的（现在选的是 ${styleId.value}）。换画风不会自动重做已有的图 —— 要笔触统一就在那几页上点「换一批图」（每张都是一次真实花费）。`
})

const batchRunning = ref(false)
const batchAt = ref(0)
const batchNote = ref('')
let stopRequested = false

const deckHtml = ref('')
const deckErr = ref('')

const exporting = ref(false)
const exportErr = ref('')
const exportNote = ref('')
const exportWarnings = ref<string[]>([])

interface FilledImage {
  index: number; prompt: string; mode: string; ratio: string
  url?: string; error?: string; skipped?: boolean; storage?: 'cos' | 'local'
}
interface ImagesResult {
  html: string; previewHtml: string; images: FilledImage[]
  problems: string[]; quotaExceeded: boolean
  style?: { id: string; name: string }
}
const imgBusy = ref<Record<number, boolean>>({})
const imgErr = ref<Record<number, string>>({})
const imgInfo = ref<Record<number, ImagesResult>>({})

/** 这一页有几个图槽位（生图那一步认的就是 data-img-prompt）。 */
function slotCount(page: number): number {
  return (built.value[page]?.html.match(/data-img-prompt="/g) || []).length
}
/** 已经不是占位图的那几格。 */
function filledCount(page: number): number {
  const html = built.value[page]?.html || ''
  return (html.match(/data-img-prompt="/g) || []).length - (html.match(/\/ppt-cases\/ph-/g) || []).length
}
const imgTodo = computed(() =>
  pages.value.reduce((n, p) => n + (built.value[p.page] ? slotCount(p.page) - filledCount(p.page) : 0), 0)
)

// 批量生成期间不许重新规划：换一份规划之后已生成的页会被清掉，而那一刻还有一页正在跑，
// 它回来时会挂到新规划的同一个页码下面 —— 版式和内容都不是那一页的，两边都不报错。
const canRun = computed(() =>
  !running.value && !batchRunning.value && !!outline.value.trim() && outline.value.length <= MAX_OUTLINE
)
const usedLayouts = computed(() => new Set(pages.value.map(p => p.layoutId)).size)
const builtCount = computed(() => pages.value.filter(p => built.value[p.page]).length)
const pendingCount = computed(() => pages.value.length - builtCount.value)
/** deck 外壳上那个大标题：提纲第一行通常就是主题。 */
const topic = computed(() => outline.value.trim().split('\n')[0]?.trim().slice(0, 60) || '')

type BuildOutcome = 'ok' | 'fail' | 'quota'

/**
 * 某一页改过之后，拼好的整份和「已导出」那句话都要作废。
 * 留着的话整份预览翻起来完全正常（只是那一页是改之前的版本），而那句「已导出 xxx.html」
 * 会让人以为手上那个文件是最新的 —— 两样都不报错。
 */
function invalidateDeck() {
  if (deckHtml.value) { deckHtml.value = ''; deckErr.value = '' }
  if (exportNote.value) { exportNote.value = '这一页改过了，刚才导出的那个文件已经不是最新的 —— 要发出去请重新导出一次。'; exportWarnings.value = [] }
}

async function build(p: PlannedPage): Promise<BuildOutcome> {
  busy.value[p.page] = true
  pageErr.value[p.page] = ''
  let outcome: BuildOutcome = 'ok'
  try {
    const data = await apiPost<BuiltPage>('/api/ppt/pages', {
      page: p.page, total: pages.value.length, section: p.section, title: p.title,
      points: p.points, layoutId: p.layoutId, images: p.images,
      brandCn: brandCn.value || undefined, brandEn: brandEn.value || undefined, topic: topic.value || undefined,
    })
    built.value[p.page] = data
    // 拼好的整份必须作废：留着的话它翻起来完全正常，只是那一页还是改之前的版本。
    invalidateDeck()
  } catch (e: any) {
    // 失败要说在那一页上（顶上一条全局错误看不出是哪一页），而且上一版留着 ——
    // 清掉的话「重新生成失败」和「还没生成过」在界面上是同一个样子。
    const msg = e.message || '这一页生成失败'
    pageErr.value[p.page] = msg === 'quota_exceeded' ? '今天的 AI 额度用完了，这一页没生成。' : msg
    outcome = /quota_exceeded|额度/.test(msg) ? 'quota' : 'fail'
  }
  busy.value[p.page] = false
  return outcome
}

/**
 * 逐页生成（**串行**，只生成还没生成过的那几页）。
 *
 * 三件事是承重的：串行发（并发一批会撞上游频控，而回来的错误读起来像模型不行）；
 * 额度打满立刻停（接着跑十几页只会拿到十几条一样的错误，中间还夹着刚才那几页的成功）；
 * 收尾那句话必须逐类报数，不能合成一句「已完成」—— 部分成功是常态，失败的那几页在
 * 界面上就是「还没生成」的样子。
 */
async function runAll() {
  batchRunning.value = true
  stopRequested = false
  batchNote.value = ''
  let ok = 0
  const failed: number[] = []
  let quota = false
  const todo = pages.value.filter(p => !built.value[p.page])
  for (const p of todo) {
    if (stopRequested) break
    batchAt.value = p.page
    const r = await build(p)
    if (r === 'ok') ok++
    else failed.push(p.page)
    if (r === 'quota') { quota = true; break }
  }
  const rest = todo.length - ok - failed.length
  batchNote.value = [
    `这一轮生成了 ${ok} 页`,
    failed.length ? `失败 ${failed.length} 页（第 ${failed.join(' / ')} 页，错误写在那一页上）` : '',
    quota ? 'AI 额度已用完，剩下的没再试 —— 明天 0 点重置，或者去后台加额度。' : '',
    !quota && stopRequested && rest > 0 ? `你点了停止，还剩 ${rest} 页没生成。` : '',
  ].filter(Boolean).join('；')
  batchRunning.value = false
}

function stopBatch() {
  // 只置位，当前那一页跑完再停（掐断的话那次调用的额度已经花了，而界面上是「没生成」）。
  stopRequested = true
  batchNote.value = '已请求停止，当前这一页跑完就停。'
}

async function makeDeck() {
  deckErr.value = ''
  try {
    const data = await apiPost<{ html: string }>('/api/ppt/deck', {
      total: pages.value.length,
      pages: pages.value.map(p => ({ page: p.page, html: built.value[p.page]?.html || '' })),
      brandCn: brandCn.value || undefined, brandEn: brandEn.value || undefined, topic: topic.value || undefined,
    })
    deckHtml.value = data.html
  } catch (e: any) {
    deckHtml.value = ''
    deckErr.value = e.message || '整份 deck 拼不出来'
  }
}

/**
 * 导出成一个 .html 文件。拼装和改地址都在服务端（同一份 deckShell + buildDeck）。
 *
 * 两件事是承重的：`baseUrl` 传 `location.origin`（图的相对地址按它改成绝对，服务端在
 * 反代后面算出来的是 http，混合内容会被浏览器拦掉而那几格看起来只是「没配图」）；
 * 下载失败必须出声 —— `createObjectURL` / `a.click()` 静默失败时按钮点下去什么都不发生，
 * 读起来像导出功能坏了。
 */
async function exportDeck() {
  exportErr.value = ''
  exportNote.value = ''
  exportWarnings.value = []
  exporting.value = true
  try {
    const data = await apiPost<{ filename: string; html: string; warnings: string[]; placeholders: number }>(
      '/api/ppt/export',
      {
        total: pages.value.length,
        pages: pages.value.map(p => ({ page: p.page, html: built.value[p.page]?.html || '' })),
        brandCn: brandCn.value || undefined, brandEn: brandEn.value || undefined, topic: topic.value || undefined,
        baseUrl: location.origin,
      }
    )
    download(data.filename, data.html)
    exportNote.value = `已导出 ${data.filename}（${pages.value.length} 页）—— 双击就能在浏览器里放映。`
    exportWarnings.value = data.warnings || []
  } catch (e: any) {
    exportErr.value = e.message || '导出失败'
  }
  exporting.value = false
}

function download(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/html;charset=utf-8' }))
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}

function toggleSrc(page: number) { showSrc.value[page] = !showSrc.value[page] }

/**
 * 重新生成这一页 HTML 会把配好的图**换回占位图**（新 HTML 里图槽位是占位图），
 * 而那一页在预览里看起来只是「这版设计得比较空」—— 所以已经生过图的要先确认一次。
 */
function rebuild(p: PlannedPage) {
  if (filledCount(p.page) > 0 && !confirm(`第 ${p.page} 页已经配了 ${filledCount(p.page)} 张图。重新生成 HTML 会把图换回占位图，要重新生图（再花一次额度）。继续？`)) return
  imgInfo.value[p.page] = undefined as any
  imgErr.value[p.page] = ''
  build(p)
}

/**
 * 给一页配图。成功后必须用返回的 html **覆盖**这一页存着的 html —— 不覆盖的话拼整份
 * 用的还是占位图那一版，而预览里刚刚明明看到图了。
 */
async function fillImages(p: PlannedPage, force = false): Promise<BuildOutcome> {
  if (force && !confirm(`换一批图会把第 ${p.page} 页现有的 ${filledCount(p.page)} 张全部重新生成（旧的不会自动删）。继续？`)) return 'ok'
  imgBusy.value[p.page] = true
  imgErr.value[p.page] = ''
  let outcome: BuildOutcome = 'ok'
  try {
    const data = await apiPost<ImagesResult>('/api/ppt/images', {
      html: built.value[p.page]?.html || '', title: p.title, section: p.section,
      topic: topic.value || undefined, force, styleId: styleId.value || undefined,
      brandCn: brandCn.value || undefined, brandEn: brandEn.value || undefined,
    })
    built.value[p.page] = { ...built.value[p.page], html: data.html, previewHtml: data.previewHtml }
    imgInfo.value[p.page] = data
    invalidateDeck()
    if (data.quotaExceeded) outcome = 'quota'
    else if (data.images.some(i => !i.url)) outcome = 'fail'
  } catch (e: any) {
    const msg = e.message || '生图失败'
    imgErr.value[p.page] = msg === 'quota_exceeded' ? '今天的 AI 额度用完了。' : msg
    outcome = /quota_exceeded|额度/.test(msg) ? 'quota' : 'fail'
  }
  imgBusy.value[p.page] = false
  return outcome
}

/** 逐页配图（串行、可停止、逐类报数，和 runAll 一个口径）。只做还差图的那几页。 */
async function fillAllImages() {
  batchRunning.value = true
  stopRequested = false
  batchNote.value = ''
  let done = 0
  const failed: number[] = []
  let quota = false
  const todo = pages.value.filter(p => built.value[p.page] && slotCount(p.page) > filledCount(p.page))
  for (const p of todo) {
    if (stopRequested) break
    batchAt.value = p.page
    const r = await fillImages(p)
    if (r === 'ok') done++
    else failed.push(p.page)
    if (r === 'quota') { quota = true; break }
  }
  const rest = todo.length - done - failed.length
  batchNote.value = [
    `配图跑完 ${done} 页`,
    failed.length ? `有 ${failed.length} 页没配齐（第 ${failed.join(' / ')} 页，缺的那几格还是占位图，详情写在那一页下面）` : '',
    quota ? 'AI 额度已用完，剩下的没再试。' : '',
    !quota && stopRequested && rest > 0 ? `你点了停止，还剩 ${rest} 页没配图。` : '',
  ].filter(Boolean).join('；')
  batchRunning.value = false
}

onMounted(async () => {
  try {
    const data = await apiGet<{ styles: StyleItem[]; defaultStyleId: string }>('/api/ppt/styles')
    styleList.value = data.styles || []
    styleId.value = data.defaultStyleId || data.styles?.[0]?.id || ''
  } catch {
    // 画风清单拿不到不挡生图（服务端有自己的默认那套），下拉留空就是「用默认」。
  }
  await loadDeck()
})

/**
 * 读这份稿子。画风必须**在拿到清单之后**再按库里那条覆盖 —— 反过来的话
 * `/styles` 那个缺省值会盖掉他存过的画风，而下拉里显示的是缺省那套，
 * 看起来像他自己选的（下一批图于是换了笔触，没有一处报错）。
 */
async function loadDeck() {
  if (!deckId.value) {
    loadErr.value = '这个地址里没有演示稿 id。'
    return
  }
  try {
    const { deck } = await apiGet<{ deck: any }>(`/api/ppt/decks/${deckId.value}`)
    title.value = deck.title || ''
    outline.value = deck.outline || ''
    brandCn.value = deck.brand_cn || ''
    brandEn.value = deck.brand_en || ''
    if (deck.style_id) styleId.value = deck.style_id
    savedSnapshot = metaSnapshot()
  } catch (e: any) {
    loadErr.value = `打不开这份演示稿：${e?.message || '请求失败'}`
  }
}

async function run() {
  // 规划前先把提纲存下来（他常常是改完提纲直接点规划，没失焦过）：不存的话
  // 花了一次调用之后关掉页面，回来提纲还是上一版，而规划本身这一片也还没落库。
  await saveMeta()
  running.value = true
  error.value = ''
  try {
    const data = await apiPost<{
      pages: PlannedPage[]; problems: string[]
      usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
    }>('/api/ppt/plan', { outline: outline.value })
    pages.value = data.pages || []
    problems.value = data.problems || []
    usage.value = data.usage || null
    // 重新规划之后已生成的那几页必须清掉：新规划的第 3 页很可能换了版式和内容，
    // 而旧的那一版会照旧挂在「第 3 页」下面 —— 两边都不报错，看起来像新生成的。
    built.value = {}
    pageErr.value = {}
    showSrc.value = {}
    imgInfo.value = {}
    imgErr.value = {}
    batchNote.value = ''
    // 拼好的整份同理：它对应的是上一份规划的页，翻起来看不出任何异常。
    deckHtml.value = ''
    deckErr.value = ''
    exportNote.value = ''
    exportWarnings.value = []
    exportErr.value = ''
  } catch (e: any) {
    error.value = e.message || '排版规划失败'
    // 上一次的结果留在页面上：清掉的话失败之后是一片空白，读起来像「这份提纲拆不出页」。
  }
  running.value = false
}
</script>

<style scoped>
.page { max-width: 1100px; margin: 0 auto; padding: 32px 24px 64px; }
.head { display: flex; justify-content: space-between; align-items: flex-end; gap: 24px; margin-bottom: 20px; flex-wrap: wrap; }
h1 { font-size: 26px; margin: 0 0 8px; }
.crumb { margin-bottom: 10px; }
.crumb a { font-size: 12px; color: #6b7280; text-decoration: none; }
.crumb a:hover { color: #2563eb; }
/* 名字就地改（失焦即存）。做成看起来像标题的输入框，而不是一个「编辑」按钮：
   两段式的话他改完不点保存就走了，而界面上那行已经是新名字。 */
.title-input {
  font: inherit; font-size: 26px; font-weight: 600; color: #111827;
  border: 1px solid transparent; border-radius: 8px; padding: 2px 8px; margin-left: -8px;
  width: min(560px, 100%); background: transparent; outline: none;
}
.title-input:hover { border-color: #e5e7eb; }
.title-input:focus { border-color: #111827; background: #fff; }
.save-note { font-size: 12px; line-height: 1.7; color: #6b7280; margin: 12px 0 0; }
.save-note b { color: #92400e; }
.save-note.bad { color: #dc2626; }
.sub { color: #6b7280; font-size: 13px; line-height: 1.7; max-width: 780px; margin: 0; }
.sub a { color: #2563eb; }

.input-box { border: 1px solid #e5e7eb; border-radius: 12px; background: #fff; overflow: hidden; }
textarea {
  width: 100%; min-height: 220px; border: 0; outline: none; resize: vertical;
  padding: 16px 18px; font-size: 13px; line-height: 1.8; font-family: inherit; color: #1f2937;
}
textarea:disabled { background: #fafafa; color: #6b7280; }
.input-foot { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 10px 14px; border-top: 1px solid #eef0f3; background: #fafbfc; }
.count { font-size: 12px; color: #6b7280; }
.count.over { color: #dc2626; font-weight: 600; }
.btn { background: #111827; color: #fff; border: 0; border-radius: 8px; padding: 8px 18px; font-size: 13px; cursor: pointer; }
.btn:disabled { background: #d1d5db; cursor: not-allowed; }
.btn-ghost { border: 1px solid #d1d5db; background: #fff; border-radius: 8px; padding: 6px 12px; font-size: 12px; color: #374151; text-decoration: none; white-space: nowrap; }

.err { color: #dc2626; font-size: 13px; line-height: 1.7; margin: 16px 0 0; padding: 12px 14px; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; }
.problems { margin-top: 16px; padding: 12px 16px; background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; }
.problems-title { font-size: 13px; font-weight: 600; color: #92400e; margin-bottom: 6px; }
.problems ul { margin: 0; padding-left: 18px; }
.problems li { font-size: 12px; line-height: 1.8; color: #92400e; }

.brand { border: 1px solid #d1d5db; border-radius: 6px; padding: 6px 10px; font-size: 12px; width: 140px; outline: none; }
.brand.en { width: 100px; }
.brand:disabled { background: #f3f4f6; }
.actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

.result { margin-top: 24px; }
.batch { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 10px 14px; border: 1px solid #e5e7eb; border-radius: 10px; background: #fafbfc; margin-bottom: 12px; }
.hint { font-size: 12px; color: #6b7280; }
.brand.style { min-width: 168px; }
.stylechip { margin-left: 8px; padding: 1px 7px; border-radius: 999px; background: #eef2ff; color: #4338ca; font-size: 11px; }
.batch-note.warn { background: #fffbeb; border-color: #fde68a; color: #92400e; }
.export-note { font-size: 12px; line-height: 1.8; color: #1f2937; margin: 16px 0 0; padding: 10px 14px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; }
.export-note ul { margin: 6px 0 0; padding-left: 18px; }
.export-note li { color: #92400e; }
.batch-note { font-size: 12px; line-height: 1.7; color: #1f2937; margin: -4px 0 12px; padding: 8px 12px; background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px; }
.imgs { margin: 0 0 10px; padding: 8px 12px; border: 1px solid #e5e7eb; border-radius: 8px; background: #fff; }
.imgs-head { font-size: 12px; font-weight: 600; color: #374151; margin-bottom: 4px; }
.imgs-head .quota { margin-left: 8px; font-weight: 400; color: #dc2626; }
.imgs ul { margin: 0; padding-left: 18px; }
.imgs li { font-size: 12px; line-height: 1.8; color: #4b5563; }
.imgs li.bad { color: #b45309; }
.imgs li .bad { color: #b45309; }
.imgs em { font-style: normal; color: #6b7280; }
.deck { margin: 8px 0 0; }
.deck-head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; font-size: 13px; margin-bottom: 8px; }
.preview.big { border-color: #cbd5e1; }
.result-head { display: flex; justify-content: space-between; align-items: baseline; font-size: 12px; color: #6b7280; margin-bottom: 12px; }
.row { display: flex; gap: 16px; padding: 14px; border: 1px solid #e5e7eb; border-radius: 12px; background: #fff; margin-bottom: 12px; }
.thumb { position: relative; flex: 0 0 260px; aspect-ratio: 16 / 9; border: 1px solid #eef0f3; border-radius: 8px; overflow: hidden; background: #fff; }
.thumb iframe { width: 100%; height: 100%; border: 0; pointer-events: none; }
.page-no { position: absolute; left: 6px; top: 6px; font-size: 10px; padding: 2px 6px; border-radius: 3px; background: rgba(17,24,39,.72); color: #fff; }
.info { flex: 1; min-width: 0; }
.line1 { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.kicker { font-size: 11px; color: #b45309; background: #fffbeb; border-radius: 3px; padding: 1px 6px; }
.title { font-size: 15px; font-weight: 600; }
.line2 { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 6px; }
.lid { font-weight: 700; font-size: 12px; color: #2563eb; text-decoration: none; }
.lname { font-family: var(--font-mono, monospace); font-size: 12px; color: #374151; }
.ltitle { font-size: 12px; color: #6b7280; }
.tag { font-size: 10px; padding: 1px 6px; border-radius: 3px; border: 1px solid currentColor; }
.tag.full { color: #b45309; }
.tag.img { color: #7c3aed; }
.why { font-size: 12px; line-height: 1.7; color: #1f2937; margin: 8px 0 0; }
.why.missing { color: #b45309; }
.points { margin: 8px 0 0; padding-left: 18px; }
.points li { font-size: 12px; line-height: 1.8; color: #6b7280; }

.row-actions { display: flex; align-items: center; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
.btn-sm { background: #111827; color: #fff; border: 0; border-radius: 6px; padding: 5px 12px; font-size: 12px; cursor: pointer; }
.btn-sm:disabled { background: #d1d5db; cursor: not-allowed; }
.btn-sm.ghost { background: #fff; color: #374151; border: 1px solid #d1d5db; }
.err-inline { font-size: 12px; color: #dc2626; line-height: 1.6; }

.built { margin: -4px 0 16px; padding: 0 14px; }
.problems.small { margin: 0 0 10px; }
/* deck 自己的 fit() 按 iframe 视口等比缩放，所以这里给满宽满高就行 —— 再叠一层
   transform 会缩两遍（页面上是贴在左上角的一小块）。这个 iframe **不掐** pointer-events：
   它是真预览，要能点着翻页/看细节。 */
.preview { position: relative; width: 100%; aspect-ratio: 16 / 9; border: 1px solid #e5e7eb; border-radius: 10px; overflow: hidden; background: #fff; }
.preview iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
.src { margin: 10px 0 0; padding: 12px 14px; background: #0f172a; color: #e2e8f0; border-radius: 8px; font-size: 11px; line-height: 1.7; overflow: auto; max-height: 420px; white-space: pre-wrap; }
</style>
