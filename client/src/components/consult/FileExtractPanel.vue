<script setup lang="ts">
// 上传客户资料文件（最多 5 个）→ 服务端提取文字 → **自动**交给 AI 提炼 →
// 每份是一张卡片，创建项目时**自动带进**客户资料，不用他逐份点「插入」。
//
// 两种文件的额度账**不一样**，界面上必须分得出来：文档（txt/md/docx/doc/pptx/pdf）提取
// 不花钱、整理花 1 次起；**图片提取本身就是一次 AI 调用**（图里的字只有模型读得出来），
// 而且那一次已经把内容归好类了，所以图片**不再自动整理第二遍**（服务端回 `tidied: true`）。
// 混着算的话，传三张截图会静默扣掉他今天 10 次里的 3 次，而那一步写着「正在提取文字…」。
//
// 三件事是承重的：
// ① **原文那一栏必须一直留着**：整理的失败形态是「读起来很通顺，但删掉了要紧的一段 /
//    补了一个原文没有的数字」，原文是他核对这件事的唯一依据。
// ② **自动整理是要花 AI 额度的**（每份 1 次起，长文件分段就是几次；登录用户缺省 10 次/天）。
//    以前长文件不自动跑就是怕静默扣费；现在按要求一律自动跑，那这笔账必须**写在界面上**：
//    每张卡片显示这份花了几次，头上显示这次上传一共花了几次。不显示的话他只会在别处
//    发现今天的额度突然不够了（硬规则 1）。
// ③ 撞上额度上限（429）之后**停止**给后面的文件自动整理，并明说剩下几份带的是原文 ——
//    接着打的话后面每一份都等满一次超时再失败，而每张卡片看起来只是「整理失败」。
//
// 这个面板是**唯一**一份文件上传 UI。不要在别处再抄一份：抄出去的那份必然缺掉 notes、
// 缺掉那笔额度账、或者缺掉字数上限的提示，而它跑起来一切正常。

import { ref, reactive, computed, watch } from 'vue'
import { api } from '../../lib/api'

const props = defineProps<{
  /** 他手打的那段资料现在有多少字 —— 用来提前算「加上文件会不会超上限」。 */
  currentChars: number
}>()

/** 带给创建接口的那几份（服务端再合成一次并复查上限，见 briefCompose.ts）。 */
interface Attachment {
  filename: string
  text: string
  variant: 'tidy' | 'raw'
}

const emit = defineEmits<{
  (e: 'change', list: Attachment[]): void
  /**
   * 还有文件在提取/整理。父页面拿它**禁掉「创建项目」** —— 不禁的话他在整理跑完之前
   * 点下去，那几份内容压根不在 attachments 里，而项目建出来一切正常（资料里少几节，
   * 读起来完整），后面十二步就照着少几份的资料推。
   */
  (e: 'busy', v: boolean): void
}>()

interface Extracted {
  filename: string
  ext: string
  text: string
  chars: number
  notes: string[]
  briefLimit: number
  budgetChars: number
  maxFiles: number
  maxImageBytes: number
  /** 'image' = 这一份是大模型读出来的（没有原文可比对，见 kind 在卡片上的用处）。 */
  kind: 'file' | 'image'
  /** 光是「提取」这一步已经花掉的额度（图片 1，文档 0）。 */
  aiCalls: number
  /** 已经是提炼过的了 → 前端**跳过**自动整理（再整一遍是白花第二次额度）。 */
  tidied: boolean
  /** 图片这条路超预算也要出声（它不走 /tidy-text，没有那边的 overBudget）。 */
  overBudget?: boolean
  /**
   * 有几页一个字都没提取到（整页是图 / 文字画在图里）。图片那条路没有这个字段。
   *
   * 显示在卡片的字数那一行，**不进 notes 那一栏黄框**：每份 PPT 都顶一条的话，
   * 真出问题的那条就淹了。但也不能一个字不说 —— 剩下那些页拼起来读着完整，
   * 没人会发现少了几页，而这几页的解法不一样（导成图片单独传）。
   */
  emptyPages?: number
  /** 整理这份文字要花几次 AI 调用 —— **服务端算的**，前端不许自己按字数除（会漂）。 */
  tidyPlan: { calls: number; chunkChars: number; maxChars: number }
}

interface Tidied {
  text: string
  chars: number
  rawChars: number
  truncated: boolean
  addedNumbers: string[]
  notes: string[]
  calls: number
  fallbackChunks: number
  budgetChars: number
  overBudget: boolean
}

/** 一个文件在界面上的全部状态。 */
interface FileCard {
  id: number
  filename: string
  /**
   * 图片和文档在两件事上不一样，卡片必须分开显示：① 图片「提取」这一步就花了 1 次额度；
   * ② 图片**没有原文**（`raw` 是空的）—— 所以那个「原文」页签要禁掉，不禁的话他一点，
   * 这张卡片带进资料的内容就变成空的，而卡片还好好地列在界面上。
   */
  kind: 'file' | 'image'
  /** extracting = 正在提取；tidying = 正在整理；ready / failed 见 err。 */
  status: 'extracting' | 'tidying' | 'ready' | 'failed'
  /** 提取/整理的失败原因，原样显示（成因和出路各不相同，合成一句就是指错方向）。 */
  err: string
  raw: string
  tidy: string
  /** 带哪一份进资料。整理失败时只能是 raw。 */
  use: 'tidy' | 'raw'
  notes: string[]
  addedNumbers: string[]
  fallbackChunks: number
  // 服务端回的 overBudget **故意不存在卡片上**：整理成功那一份必然在预算内，
  // 而真会被拒的那种（带进资料的是原文）它是 false —— 那条警告按现在显示的字数判。
  /** 有几页一个字都没提取到（见 Extracted.emptyPages），显示在字数那一行。 */
  emptyPages: number
  /** 这份花了几次 AI 额度。 */
  calls: number
  /** 这份要分几次调用（服务端算的），整理前先显示出来。 */
  plannedCalls: number
  open: boolean
}

const ACCEPT = '.txt,.md,.docx,.doc,.pptx,.ppt,.pdf,.png,.jpg,.jpeg,.webp,.gif'
/** 按扩展名先猜是不是图片，只为了**在等结果的那几十秒里**把「这一步要花 1 次额度」写出来。 */
const IMAGE_RE = /\.(png|jpe?g|webp|gif|heic|heif|bmp|tiff?|avif)$/i

const fileInput = ref<HTMLInputElement | null>(null)
const busy = ref(false)
const err = ref('')
const cards = ref<FileCard[]>([])
const limits = ref({
  briefLimit: 20000,
  budgetChars: 3500,
  maxFiles: 5,
  tidyMax: 80000,
  maxImageBytes: 5 * 1024 * 1024,
})
/** 撞过额度上限：之后不再自动整理（会连着失败几次，每次都等满一个来回）。 */
const quotaHit = ref(false)
let seq = 0

/** 一次请求的失败。`quota` 只由 HTTP 429 置上 —— 见 post() 上面那段。 */
class ReqError extends Error {
  quota: boolean
  constructor(message: string, quota = false) {
    super(message)
    this.quota = quota
  }
}

/**
 * 这个面板的所有请求都走它。**「是不是额度用完了」只看 HTTP 429 + `quota_exceeded`
 * 这个机器码，绝不拿文案里有没有「额度」两个字去判。**
 *
 * 后端几乎每一句失败文案都带着「这次的 AI 额度已经扣了」（那是在如实交代花掉的钱），
 * 拿文案去猜的话，一次空返回、一次「模型没收到图片」都会被显示成
 * 「AI 额度已经用完，明天 0 点重置」，后面几份文件跟着不再自动整理、原样把原文
 * （页码目录都在）带进资料 —— 而账号可能压根不限额度，他等到明天还是这个结果，
 * 真实成因（思维链没关 / 这条接入点不支持看图）一个字都看不到。
 *
 * 429 的正文里有 `detail`（撞的是账号总额还是这个应用的单独额度、上限多少），有就显示它：
 * 写死「缺省 10 次/天」的话，对开了专属渠道或被单独配了应用额度的账号是句假话。
 */
async function post(url: string, body: FormData | Record<string, unknown>, onTooLarge?: string): Promise<any> {
  const res = await api(url, {
    method: 'POST',
    body: body instanceof FormData ? body : JSON.stringify(body),
  })
  if (res.ok) return res.json()
  if (res.status === 413 && onTooLarge) throw new ReqError(onTooLarge)
  const data = await res.json().catch(() => ({} as any))
  if (res.status === 429 && data.error === 'quota_exceeded') {
    throw new ReqError(
      data.detail || `今日 AI 额度已用完（${data.daily_limit ?? '?'} 次/天），每天 0 点重置。`,
      true
    )
  }
  throw new ReqError(data.error || `HTTP ${res.status}`)
}

const full = computed(() => cards.value.length >= limits.value.maxFiles)
const textOf = (c: FileCard) => (c.use === 'tidy' ? c.tidy : c.raw)
/**
 * 带进资料的那几份。空的不带（服务端会拒），失败但有原文的照旧带原文 ——
 * 悄悄不带的话资料里少一节，而那张卡片还在界面上。
 */
const ready = computed(() =>
  cards.value
    .map((c) => ({ filename: c.filename, text: textOf(c).trim(), variant: c.use }))
    .filter((a) => a.text)
)
/**
 * 「合计多少字」。**这是服务端 briefCompose.composeBrief 的第二份实现**（提前告诉他
 * 超没超），拼法改一边必须改另一边 —— 两边漂了的话界面显示 19800 字，点创建被拒 20300 字。
 */
const blockLens = computed(() =>
  ready.value.map(
    (a) => `【上传文件：${a.filename}（${a.variant === 'tidy' ? 'AI 整理' : '原文'}）】\n${a.text}`.length
  )
)
const attachChars = computed(() => blockLens.value.reduce((n, x) => n + x, 0))
/** 分节之间那个 `\n\n` 也算字数（服务端是 join('\n\n')，只在非空的几节之间加）。 */
const total = computed(() => {
  const lens = [props.currentChars, ...blockLens.value].filter((n) => n > 0)
  return lens.reduce((n, x) => n + x, 0) + Math.max(0, lens.length - 1) * 2
})
const overBy = computed(() => Math.max(0, total.value - limits.value.briefLimit))
const spentCalls = computed(() => cards.value.reduce((n, c) => n + c.calls, 0))
const anyBusy = computed(() => cards.value.some((c) => c.status === 'extracting' || c.status === 'tidying'))

watch(ready, (v) => emit('change', v), { deep: true, immediate: true })
watch(anyBusy, (v) => emit('busy', v))

function pick() {
  err.value = ''
  fileInput.value?.click()
}

async function onFiles(e: Event) {
  const input = e.target as HTMLInputElement
  const files = [...(input.files || [])]
  // 同一批文件连着传两次也要能触发 change，所以选完就清掉 input 的值。
  input.value = ''
  if (!files.length) return

  // 超过上限的那几个**说出来**，不静默丢：丢掉的那份他以为传上去了，
  // 而卡片列表看起来就是一份正常的清单。
  const room = limits.value.maxFiles - cards.value.length
  const take = files.slice(0, Math.max(0, room))
  if (files.length > take.length) {
    err.value =
      `最多 ${limits.value.maxFiles} 个，没收下：${files.slice(take.length).map((f) => f.name).join('、')}。`
  }

  busy.value = true
  // 一个个来：五个几百兆的文件同时上传会把内存和带宽一起打满，而表现只是「传了很久没反应」。
  for (const file of take) await addOne(file)
  busy.value = false
}

async function addOne(file: File) {
  // **必须是 reactive 的**：下面这些 `card.xxx = …` 是在 push 进数组之后、await 回来才发生的。
  // 写成普通对象的话 `cards.value.push(card)` 存进去的是**原始对象**（Vue 只在读数组时才
  // 包一层代理），而这个闭包一直握着原始对象 —— 改它绕过了代理，`ready` / `anyBusy` /
  // `spentCalls` 这几个 computed 收不到通知，永远停在 push 那一刻的值。
  // 症状正是「一直是处理中」：卡片自己显示得好好的（模板每次重渲染都是从原始对象上读的），
  // 而按钮写着「文件还在处理中…」、上面写着「0 个文件 0 字 / 花了 0 次额度」，
  // 于是整理好的那几份一份都带不进资料 —— 每一处看起来都对，只有那个按钮点不下去。
  const card = reactive<FileCard>({
    id: ++seq,
    filename: file.name,
    kind: IMAGE_RE.test(file.name) ? 'image' : 'file',
    status: 'extracting',
    err: '',
    raw: '',
    tidy: '',
    use: 'raw',
    notes: [],
    addedNumbers: [],
    fallbackChunks: 0,
    emptyPages: 0,
    calls: 0,
    plannedCalls: 1,
    open: false,
  })
  cards.value.push(card)

  try {
    const fd = new FormData()
    fd.append('file', file)
    // FormData 直接交给 api()（它认得 FormData，不写 Content-Type —— boundary 要浏览器自己加）。
    // 413 是**反代**（Nginx 的 `client_max_body_size`，缺省 1MB）拦下来的，请求压根没到
    // Node：所以没有我们那句带上限数字的 JSON，body 是一坨 HTML，落到缺省分支就是一句
    // 「HTTP 413」。那句话读起来像接口挂了 —— 用户会反复传同一个文件、或者去改
    // `MAX_FILE_BYTES`（那一层根本没被走到），而后端日志里一个字都没有。
    const data: Extracted = await post('/api/consult/extract-file', fd,
      `这个文件 ${(file.size / 1024 / 1024).toFixed(1)}MB，被反向代理挡下了（HTTP 413，请求没到后端）。` +
      `请把它改小，或者让运维加大 Nginx 的 client_max_body_size（docs/RELEASE.md 第六节）。`
    )
    limits.value = {
      briefLimit: data.briefLimit,
      budgetChars: data.budgetChars,
      maxFiles: data.maxFiles,
      tidyMax: data.tidyPlan?.maxChars ?? 80000,
      maxImageBytes: data.maxImageBytes ?? limits.value.maxImageBytes,
    }
    card.filename = data.filename
    card.kind = data.kind || card.kind
    card.notes = [...data.notes]
    card.emptyPages = data.emptyPages || 0
    card.plannedCalls = data.tidyPlan?.calls || 1
    // 图片这一步已经花掉的额度要如实累上去 —— 不累的话卡片上写着 0 次，
    // 而他今天的 10 次里已经少了一次。
    card.calls += data.aiCalls || 0

    // 图片：提取出来的那份**已经是提炼过的**（同一次调用既读图又归类），所以放进
    // 「AI 整理」那一栏并且**不再自动整理第二遍**。它没有原文可比对，`raw` 留空，
    // 界面上那个「原文」页签会被禁掉（服务端的 notes 里也说了这件事）。
    if (data.tidied) {
      card.tidy = data.text
      card.use = 'tidy'
      card.status = 'ready'
      return
    }

    card.raw = data.text
    // 提取完**直接整理**，不等他点：原文是碎的（页码、CONTENTS、同一句被拆成几行），
    // 让他对着一屏碎片自己决定「要不要点整理」是白让他做一次判断。
    // 代价是这一下就花掉额度，所以卡片上写着花了几次（见文件头 ②）。
    if (card.raw.trim().length > limits.value.tidyMax) {
      card.status = 'ready'
      card.notes.push(
        `原文 ${card.raw.trim().length} 字，超过一次能整理的 ${limits.value.tidyMax} 字，没有自动整理。` +
        `请删掉 ${card.raw.trim().length - limits.value.tidyMax} 字再点「重试整理」。`
      )
      return
    }
    if (quotaHit.value) {
      card.status = 'ready'
      card.notes.push('额度已用完，这一份没整理，带进资料的是**原文**。')
      return
    }
    await runTidy(card)
  } catch (e: any) {
    // 服务端那句话是带成因和出路的（扫描件 / 没文字层的 PDF / 老 .ppt / 编码乱了各说各的），
    // 原样显示。图片那条路还会真撞额度 —— 那时（且**只有**那时）停掉后面几张图的自动识别，
    // 不然剩下几张每一张都等满一个来回再失败，而卡片上只是一句「提取失败」。
    card.status = 'failed'
    card.err = e?.message || '提取失败'
    if (e instanceof ReqError && e.quota) quotaHit.value = true
  }
}

async function runTidy(card: FileCard) {
  if (card.status === 'tidying') return
  card.status = 'tidying'
  card.err = ''
  try {
    // 传的是**原文栏里现在的内容**（他可能已经删掉了目录页），不是服务端原样返回的那份。
    const data: Tidied = await post('/api/consult/tidy-text', {
      filename: card.filename,
      text: card.raw,
    })
    card.tidy = data.text
    card.use = 'tidy'
    card.calls += data.calls
    card.addedNumbers = data.addedNumbers
    card.fallbackChunks = data.fallbackChunks
    card.notes = [...card.notes, ...data.notes]
    card.status = 'ready'
  } catch (e: any) {
    // 额度用完 / 空返回 / 超长 各是一句不同的话，原样显示。合成「整理失败」的话
    // 他只会一直重点那个按钮，而每次重点都可能真花一次额度。
    card.err =
      `AI 整理没成功：${e?.message || '整理失败'}\n` +
      '这一份带进资料的是**原文**（页码目录都还在）—— 可以点「重试整理」。'
    card.use = 'raw'
    card.status = 'ready'
    // 真撞上额度上限的话剩下几份必然也撞 —— 接着自动打只是让他多等几个来回。
    // 其它失败（空返回 / 上游超时 / 接入点不支持看图）**不能**走这里：走了的话后面每一份
    // 都不再整理、原样带原文进资料，而界面上给的成因是「额度用完，明天 0 点重置」。
    if (e instanceof ReqError && e.quota) quotaHit.value = true
  }
}

function remove(id: number) {
  cards.value = cards.value.filter((c) => c.id !== id)
}
</script>

<template>
  <div class="fx">
    <input
      ref="fileInput"
      type="file"
      multiple
      :accept="ACCEPT"
      class="hidden-input"
      @change="onFiles"
    />

    <div class="fx-bar">
      <button class="btn-file" type="button" :disabled="busy || full" @click="pick">
        <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
          <polyline points="17 8 12 3 7 8"></polyline>
          <line x1="12" y1="3" x2="12" y2="15"></line>
        </svg>
        {{ busy ? '正在处理…' : full ? `已经 ${cards.length} 个（上限）` : '上传客户资料文件' }}
      </button>
      <!-- 格式和上限只留一行。不支持的格式（老 .ppt / .heic / 扫描件 PDF）由服务端在
           那张卡片上回一句带出路的话 —— 提前把注意事项铺在这里，他也是传了才会看。 -->
      <span class="fx-formats">
        最多 {{ limits.maxFiles }} 个（已选 {{ cards.length }}）·
        文档 txt / md / docx / doc / pptx / pdf ·
        图片 png / jpg / webp / gif ≤ {{ Math.round(limits.maxImageBytes / 1024 / 1024) }}MB
      </span>
    </div>

    <p class="fx-lead">
      上传后<strong>自动 AI 提炼</strong>（每份 ≤ {{ limits.budgetChars }} 字），创建项目时自动带进资料。
      文档 1 次额度起（长文件分几次），图片 1 次/张 —— 每份实际花了几次写在卡片上。
    </p>

    <div v-if="err" class="fx-err">{{ err }}</div>
    <div v-if="quotaHit" class="fx-err">
      AI 额度用完了，后面的文件带进资料的是<strong>原文</strong>（页码目录都还在）。明天 0 点重置。
    </div>

    <div v-for="c in cards" :key="c.id" class="fx-card">
      <div class="fx-card-head">
        <strong :title="c.filename">{{ c.filename }}</strong>
        <span class="fx-state" :class="{ bad: c.status === 'failed' }">
          <template v-if="c.status === 'extracting'">
            <svg class="spin-icon" viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: -2px; margin-right: 4px;">
              <circle cx="12" cy="12" r="10" opacity="0.25"></circle>
              <path d="M12 2a10 10 0 0 1 10 10"></path>
            </svg>
            <!-- 图片这一步就在花额度，等的那几十秒里必须先说出来（等完再说等于事后通知）。 -->
            <template v-if="c.kind === 'image'">AI 读图中…（1 次额度）</template>
            <template v-else>提取文字中…</template>
          </template>
          <template v-else-if="c.status === 'tidying'">
            <svg class="spin-icon" viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: -2px; margin-right: 4px;">
              <circle cx="12" cy="12" r="10" opacity="0.25"></circle>
              <path d="M12 2a10 10 0 0 1 10 10"></path>
            </svg>
            AI 提炼中…<template v-if="c.plannedCalls > 1">（{{ c.plannedCalls }} 段）</template>
          </template>
          <template v-else-if="c.status === 'failed'">提取失败</template>
          <template v-else>
            {{ textOf(c).length }} / {{ limits.budgetChars }} 字
            <!-- 「这一份是谁写的」不能省：AI 读图那份没有原文可比对，可信度和抠出来的字不一样。 -->
            <template v-if="c.kind === 'image'">· AI 读图</template>
            <template v-else-if="c.use === 'tidy'">· AI 整理</template>
            <template v-else>· 原文</template>
            <!-- 整页是图的那几页：不显示的话剩下的页拼起来读着完整，没人发现少了几页。
                 放在这一行而不是下面的黄框里 —— 每份 PPT 都顶一条黄框的话真问题就淹了。 -->
           
            <template v-if="c.calls">· {{ c.calls }} 次额度</template>
          </template>
        </span>
        <span class="fx-card-actions">
          <!-- 没有「让 AI 整理」这个按钮：整理是上传就自动跑的，留个按钮等于让他判断
               一件他没有依据判断的事。**只有整理没成时**才出现「重试整理」——
               不留的话一次上游 503 就只能删掉重传（图片重传还要再花一次额度）。 -->
          <button
            v-if="c.status === 'ready' && c.use === 'raw' && c.raw.trim()"
            class="btn-mini"
            type="button"
            @click="runTidy(c)"
          >重试整理</button>
          <button v-if="c.status === 'ready'" class="btn-mini" type="button" @click="c.open = !c.open">
            {{ c.open ? '收起' : '查看 / 编辑' }}
          </button>
          <button class="btn-mini danger" type="button" :disabled="c.status === 'tidying'" @click="remove(c.id)">删除</button>
        </span>
      </div>

      <div v-if="c.err" class="fx-err">{{ c.err }}</div>

      <!-- 「整理后多出了原文没有的数字」是这条链路上最贵的失败：那个数字会以「客户说的」
           身份进全部结论，而它在正文里和客户亲口说的一模一样。 -->
      <p v-if="c.addedNumbers.length" class="fx-warn">
        ⛔ 多出了原文里没有的数字：<code>{{ c.addedNumbers.join('、') }}</code> —— 请切到「原文」核对。
      </p>
      <p v-if="c.fallbackChunks > 0" class="fx-warn">
        ⚠️ 有 {{ c.fallbackChunks }} 段没整理成，用的是<strong>原文</strong>。
      </p>
      <!-- 「超过单份上限 N 字，点重试整理」那条警告去掉了。两个理由：① 整理成功的那一份
           **必然**在预算内（服务端自己压、压不动按小节切），所以正常路径上它压根不该出现 ——
           而它照旧闪出来过：`textOf` 在整理跑完前拿到的是原文（11873 字），于是「AI 提炼中…」
           底下顶着一句「提交会被拒」，那是在为一件正在被解决的事报警；② 剩下那种真超预算的
           （整理失败 / 额度用完 → 带的是原文）已经各有一句说明成因的话在下面，再加一句
           「请点重试整理」只是把同一件事说第二遍。 -->
      <!-- notes = 「成功了，但可能不是你要的」。吞掉它，碎片和干净的结果长得一样。 -->
      <p v-for="(n, i) in c.notes" :key="i" class="fx-note">⚠️ {{ n }}</p>

      <template v-if="c.open">
        <!-- 原文那一栏一直留着：整理的失败形态是「读起来通顺但改过/漏掉了一段」，
             原文是他核对这件事的唯一依据。 -->
        <div class="fx-tabs">
          <button type="button" :class="{ on: c.use === 'tidy' }" :disabled="!c.tidy" @click="c.use = 'tidy'">
            {{ c.kind === 'image' ? 'AI 读图' : 'AI 整理' }}<template v-if="c.tidy"> · {{ c.tidy.length }} 字</template>
          </button>
          <!-- 图片没有原文（`raw` 是空的）。不禁掉的话他一点，这张卡片带进资料的内容就
               变成空的（服务端会把空的那一份拒掉），而卡片还好好地列在这儿。 -->
          <button type="button" :class="{ on: c.use === 'raw' }" :disabled="!c.raw" @click="c.use = 'raw'">
            <template v-if="c.kind === 'image'">原文（图片没有）</template>
            <template v-else>原文 · {{ c.raw.length }} 字</template>
          </button>
          <span class="fx-switch-tip">带进资料的是<strong>选中的这一栏</strong></span>
        </div>
        <textarea
          :value="textOf(c)"
          rows="12"
          spellcheck="false"
          @input="c.use === 'tidy' ? (c.tidy = ($event.target as HTMLTextAreaElement).value) : (c.raw = ($event.target as HTMLTextAreaElement).value)"
        ></textarea>
      </template>
    </div>

    <div v-if="cards.length" class="fx-total">
      <span :class="{ over: overBy > 0 }">
        手打 {{ currentChars }} 字 + {{ ready.length }} 个文件 {{ attachChars }} 字 =
        合计 {{ total }} / {{ limits.briefLimit }} 字<template v-if="overBy > 0">，超出 {{ overBy }} 字（提交会被拒）</template>
      </span>
      <span class="fx-tip">这次上传花了 {{ spentCalls }} 次 AI 额度。</span>
      <span v-if="anyBusy" class="fx-tip">还有文件在处理，跑完再创建 —— 没跑完的那几份不会带进去。</span>
    </div>
  </div>
</template>

<style scoped>
.fx { margin-top: 12px; }
.hidden-input { display: none; }

.fx-bar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }

.btn-file {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 9px 16px; border-radius: 999px; cursor: pointer;
  font-size: 13px; font-weight: 600; font-family: inherit;
  color: rgba(255, 255, 255, 0.9);
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.16);
  transition: all 0.2s;
}
.btn-file:hover:not(:disabled) { background: rgba(255, 255, 255, 0.12); border-color: rgba(255, 184, 0, 0.6); }
.btn-file:disabled { opacity: 0.5; cursor: default; }

.fx-formats { font-size: 12px; color: rgba(255, 255, 255, 0.5); line-height: 1.6; }
.fx-lead {
  margin: 10px 0 0; font-size: 12.5px; line-height: 1.8; color: rgba(255, 255, 255, 0.6);
}
.fx-lead strong { color: #FCD34D; font-weight: 600; }

.fx-err {
  margin-top: 12px; padding: 12px 14px; border-radius: 10px;
  background: rgba(254, 242, 242, 0.1); border: 1px solid rgba(252, 165, 165, 0.35);
  color: #FCA5A5; font-size: 13px; line-height: 1.7; white-space: pre-wrap;
}
.fx-err strong { color: #FECACA; }

.fx-card {
  margin-top: 14px; padding: 14px; border-radius: 14px;
  background: rgba(0, 0, 0, 0.25); border: 1px solid rgba(255, 255, 255, 0.12);
}
.fx-card-head { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.fx-card-head strong {
  font-size: 13.5px; color: #fff; word-break: break-all; max-width: 100%;
}
.fx-state { font-size: 12px; color: rgba(255, 255, 255, 0.55); }
.fx-state.bad { color: #FCA5A5; }
.fx-card-actions { margin-left: auto; display: flex; gap: 6px; flex-shrink: 0; }

.btn-mini {
  padding: 5px 11px; border-radius: 999px; cursor: pointer;
  font-size: 12px; font-weight: 600; font-family: inherit;
  color: rgba(255, 255, 255, 0.75); background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.16); transition: all 0.2s;
}
.btn-mini:hover:not(:disabled) { color: #fff; border-color: rgba(255, 184, 0, 0.6); }
.btn-mini:disabled { opacity: 0.4; cursor: default; }
.btn-mini.danger:hover:not(:disabled) { color: #FCA5A5; border-color: rgba(252, 165, 165, 0.5); }

.fx-note {
  margin: 10px 0 0; padding: 9px 12px; border-radius: 8px;
  background: rgba(255, 184, 0, 0.1); border: 1px solid rgba(255, 184, 0, 0.3);
  color: #FCD34D; font-size: 12.5px; line-height: 1.7;
}
/* 比 note 更刺眼：编出来的数字 / 半整理的那份是这条链路上最贵的失败。 */
.fx-warn {
  margin: 10px 0 0; padding: 10px 12px; border-radius: 8px;
  background: rgba(254, 242, 242, 0.1); border: 1px solid rgba(252, 165, 165, 0.45);
  color: #FCA5A5; font-size: 12.5px; line-height: 1.7;
}
.fx-warn code {
  font-family: "SF Mono", Menlo, Monaco, monospace;
  background: rgba(0, 0, 0, 0.35); padding: 1px 5px; border-radius: 4px; color: #FECACA;
}
.fx-warn strong { color: #FECACA; }

.fx-tabs { display: flex; align-items: center; gap: 6px; margin: 12px 0 10px; flex-wrap: wrap; }
.fx-tabs > button {
  padding: 6px 12px; border-radius: 8px; cursor: pointer;
  font-size: 12.5px; font-weight: 600; font-family: inherit;
  background: transparent; color: rgba(255, 255, 255, 0.55);
  border: 1px solid rgba(255, 255, 255, 0.12); transition: all 0.2s;
}
.fx-tabs > button:hover:not(:disabled) { color: #fff; border-color: rgba(255, 255, 255, 0.3); }
.fx-tabs > button.on { color: #FFB800; border-color: rgba(255, 184, 0, 0.5); background: rgba(255, 184, 0, 0.1); }
.fx-tabs > button:disabled { opacity: 0.4; cursor: default; }
.fx-switch-tip { margin-left: auto; font-size: 12px; color: rgba(255, 255, 255, 0.45); }
.fx-switch-tip strong { color: rgba(255, 255, 255, 0.7); }

.fx-card textarea {
  width: 100%; box-sizing: border-box; padding: 12px;
  border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 10px;
  background: rgba(0, 0, 0, 0.3); color: rgba(255, 255, 255, 0.9);
  font-size: 13px; line-height: 1.8; font-family: inherit; resize: vertical;
}
.fx-card textarea:focus { outline: none; border-color: rgba(255, 184, 0, 0.6); }

.fx-total {
  margin-top: 14px; padding-top: 12px; border-top: 1px solid rgba(255, 255, 255, 0.1);
  display: flex; flex-direction: column; gap: 6px; font-size: 12px;
}
.fx-total > span:first-child { color: rgba(255, 255, 255, 0.75); font-weight: 600; }
.fx-total > span:first-child.over { color: #FCA5A5; }
.fx-tip { color: rgba(255, 255, 255, 0.5); line-height: 1.7; }
.spin-icon { animation: spin 1s linear infinite; }
@keyframes spin { 100% { transform: rotate(360deg); } }
</style>
