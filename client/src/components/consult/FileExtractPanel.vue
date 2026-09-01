<script setup lang="ts">
// 上传客户资料文件 → 服务端程序提取文字 → **先在这里预览**，用户确认后才 emit 出去。
//
// 为什么一定要有预览这一步：pptx 的文字散在各个 shape 里、doc 的文本框是分开取的、
// 扫描页一个字都提不到 —— 这几种「提取成功」的产物是一份读不懂的碎片，而它一旦进了
// 「客户原始资料」就是后面十二步每一次调用的地基，出来的结论读起来完全正常。
// 直接写进资料框的话，没有任何一处会让他发现原料是碎的。
//
// 这个面板是**唯一**一份文件上传 UI（新建页和工作台共用）。不要在别处再抄一份：
// 抄出去的那份必然缺掉 notes 或者字数上限的提示，而它跑起来一切正常。

import { ref, computed } from 'vue'
import { api, apiPost } from '../../lib/api'

const props = defineProps<{
  /** 资料框里现在有多少字 —— 用来提前算「插进去会不会超上限」。 */
  currentChars: number
}>()

const emit = defineEmits<{ (e: 'insert', text: string): void }>()

interface Extracted {
  filename: string
  ext: string
  text: string
  chars: number
  notes: string[]
  briefLimit: number
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
  /** 真的花了几次额度。 */
  calls: number
  /** 有几段是原文照搬的（那几段整理失败了）。 */
  fallbackChunks: number
}

const ACCEPT = '.txt,.md,.docx,.doc,.pptx,.ppt'

const fileInput = ref<HTMLInputElement | null>(null)
const busy = ref(false)
const err = ref('')
const result = ref<Extracted | null>(null)

/**
 * 两栏各存一份，**各自可编辑**，切来切去不丢改动。
 *
 * 传完文件**自动整理**（只在一次调用装得下的时候，见 onFile），整理完落在「AI 整理」
 * 这一栏。但原文那一栏必须一直留着并且随手能点开：整理的失败形态是「读起来很通顺，
 * 但删掉了要紧的一段 / 补了一个原文没有的数字」，原文是他核对这件事的唯一依据。
 */
const tab = ref<'raw' | 'tidy'>('raw')
const rawEdited = ref('')
const tidyEdited = ref('')
const tidy = ref<Tidied | null>(null)
const tidying = ref(false)
const tidyErr = ref('')

const current = computed({
  get: () => (tab.value === 'raw' ? rawEdited.value : tidyEdited.value),
  set: (v: string) => {
    if (tab.value === 'raw') rawEdited.value = v
    else tidyEdited.value = v
  },
})

const total = computed(() => props.currentChars + current.value.length)
const limit = computed(() => result.value?.briefLimit ?? 20000)
const overBy = computed(() => Math.max(0, total.value - limit.value))
/** 整理的输入上限（服务端的 MAX_TIDY_INPUT_CHARS，比资料框上限大得多），超了它会明确拒绝。 */
const tidyMax = computed(() => result.value?.tidyPlan?.maxChars ?? 80000)
const tooLongToTidy = computed(() => rawEdited.value.trim().length > tidyMax.value)
/**
 * 这份文字要分几次调用。**只在刚提取完那一刻是准的**（他在原文栏里删过之后，真实
 * 次数由服务端重算），所以界面上写「约」——写死一个数会在他删掉一半之后继续吓他。
 */
const plannedCalls = computed(() => result.value?.tidyPlan?.calls ?? 1)

function pick() {
  err.value = ''
  fileInput.value?.click()
}

async function onFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  // 同一个文件连着传两次也要能触发 change，所以选完就清掉 input 的值。
  input.value = ''
  if (!file) return

  busy.value = true
  err.value = ''
  discard()
  try {
    const fd = new FormData()
    fd.append('file', file)
    // 不走 apiPost —— 它会 JSON.stringify body。api() 认得 FormData（不写 Content-Type）。
    const res = await api('/api/consult/extract-file', { method: 'POST', body: fd })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.error || `HTTP ${res.status}`)
    }
    const data: Extracted = await res.json()
    result.value = data
    rawEdited.value = data.text
    // 传完直接整理 —— 提取出来的原文是碎的，让他先对着一屏页码和 CONTENTS 自己决定
    // 「要不要点整理」是白让他做一次判断。
    //
    // 但**只在一次调用装得下的时候自动跑**：更长的文件要分几次调用、花几次额度
    // （他一天只有 10 次），那种情况下自动开跑就是一次静默扣费 —— 界面上和跑了
    // 一次没有区别，他只会在别处发现额度突然不够了。那种情况留给按钮（写着次数）。
    if (data.tidyPlan?.calls === 1) void runTidy()
  } catch (e: any) {
    // 服务端那句话是带成因和出路的（扫描件 / 老 .ppt / 编码乱了各说各的），原样显示。
    err.value = e?.message || '提取失败'
  } finally {
    busy.value = false
  }
}

async function runTidy() {
  if (!result.value || tidying.value) return
  tidying.value = true
  tidyErr.value = ''
  try {
    // 传的是**原文栏里现在的内容**（他可能已经删掉了目录页），不是服务端原样返回的那份。
    const data: Tidied = await apiPost('/api/consult/tidy-text', {
      filename: result.value.filename,
      text: rawEdited.value,
    })
    tidy.value = data
    tidyEdited.value = data.text
    tab.value = 'tidy'
  } catch (e: any) {
    // 额度用完 / 空返回 / 超长 各是一句不同的话，原样显示。合成「整理失败」的话
    // 他只会一直重点那个按钮，而每次重点都可能真花一次额度。
    tidyErr.value = e?.message || '整理失败'
  } finally {
    tidying.value = false
  }
}

function insert() {
  const text = current.value.trim()
  if (!text) return
  // 分节标出来源和这份是原文还是整理过的：混进正文的话过两天分不清哪句是客户写的、
  // 哪句是从 PPT 里抠的、哪句是 AI 重新组织过的。
  emit('insert', `${text}`)
  discard()
}

function discard() {
  result.value = null
  rawEdited.value = ''
  tidy.value = null
  tidyEdited.value = ''
  tidyErr.value = ''
  tab.value = 'raw'
}
</script>

<template>
  <div class="fx">
    <input
      ref="fileInput"
      type="file"
      :accept="ACCEPT"
      class="hidden-input"
      @change="onFile"
    />

    <div class="fx-bar">
      <button class="btn-file" type="button" :disabled="busy" @click="pick">
        <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
          <polyline points="17 8 12 3 7 8"></polyline>
          <line x1="12" y1="3" x2="12" y2="15"></line>
        </svg>
        {{ busy ? '正在提取…' : '从文件提取文字' }}
      </button>
      <span class="fx-formats">支持 .txt / .md / .docx / .doc / .pptx（老的 .ppt 请先另存为 .pptx）</span>
    </div>

    <div v-if="err" class="fx-err">{{ err }}</div>

    <div v-if="result" class="fx-preview">
      <div class="fx-head">
        <span class="fx-count">提取到 {{ result.chars }} 字</span>
      </div>

      <!-- notes = 「提取成功了，但可能不是你要的」。吞掉它，碎片和干净的结果长得一样。 -->
      <p v-for="(n, i) in result.notes" :key="i" class="fx-note">⚠️ {{ n }}</p>

      <!-- 两栏并列。整理版**不替换**原文那一栏：原文是他核对 AI 有没有编东西的唯一依据，
           覆盖掉的话「删掉了要紧的一段」在界面上再也看不出来。 -->
      <div class="fx-tabs">
        <button type="button" :class="{ on: tab === 'raw' }" @click="tab = 'raw'">
          原文 · {{ rawEdited.length }} 字
        </button>
        <button
          type="button"
          :class="{ on: tab === 'tidy' }"
          :disabled="!tidy"
          @click="tab = 'tidy'"
        >
          AI 整理<template v-if="tidy"> · {{ tidyEdited.length }} 字</template>
        </button>

        <span class="fx-tabs-right">
          <button
            class="btn-tidy"
            type="button"
            :disabled="tidying || !rawEdited.trim() || tooLongToTidy"
            @click="runTidy"
          >
            <!-- 次数必须写在按钮上：分段整理是分几次 AI 额度（一天 10 次），
                 按钮上不写的话点下去那一刻他不知道自己花了几次。 -->
            {{ tidying
              ? (plannedCalls > 1 ? `正在分段整理…（约 ${plannedCalls} 次调用，要几分钟）` : '正在整理…（要一两分钟）')
              : tidy ? '重新整理'
              : plannedCalls > 1 ? `让 AI 整理一遍`
              : '让 AI 整理一遍' }}
          </button>
        </span>
      </div>

      <p v-if="tooLongToTidy" class="fx-note">
        原文 {{ rawEdited.trim().length }} 字，超过一次上传能整理的上限 {{ tidyMax }} 字。
        请先在「原文」里删掉 {{ rawEdited.trim().length - tidyMax }} 字再整理。
      </p>
      <p v-else-if="!tidy && !tidying && plannedCalls > 1" class="fx-hint-run">
        这份 {{ rawEdited.trim().length }} 字太长，一次调用装不下，要分成约 {{ plannedCalls }} 段整理
        —— 每段各是一次 AI 额度（缺省每天 10 次）。所以这里没有自动开跑，
        点上面那个按钮才开始。也可以先在「原文」里删掉不要的部分，段数会跟着变少。
      </p>
      <p v-if="tidying" class="fx-hint-run">
        AI 正在挑出对咨询有用的内容（品牌 / 产品 / 销量数据 / 行业 / 竞品 / 优势 / 用户 /
        渠道 / 当前问题分类归好），页码目录和跟业务无关的部分会删掉，所以结果会比原文短很多。
        它被要求<strong>可以删、可以并，绝不能编</strong>，但整理完那几条提醒还是要看 ——
        这段文字会成为后面十二步唯一的事实依据。下面显示的是原文，整理好会自动切过去。
      </p>
      <div v-if="tidyErr" class="fx-err">{{ tidyErr }}</div>

      <template v-if="tab === 'tidy' && tidy">
        <!-- 只看 addedNumbers：截断另有一条 note，两个条件写在一起的话「截断但没多数字」
             那次会渲染出一个空的红框（读起来像界面出错了）。 -->
        <p v-if="tidy.addedNumbers.length" class="fx-warn">
          ⛔ 整理后出现了原文里没有的数字：<code>{{ tidy.addedNumbers.join('、') }}</code>。
          这一步只许删和归并，不许新增，数字要原样照抄 —— 请切到「原文」逐个核对。
          模型编出来的数字一旦进了资料，后面每一步都会按它推，而它在结论里和客户亲口说的一模一样。
        </p>
        <!-- 部分段落退回了原文 = 这一栏是「半整理」的。不说的话它和整理干净的一份
             长得一模一样，而中间夹着一整段没删过的页码目录。 -->
        <p v-if="tidy.fallbackChunks > 0" class="fx-warn">
          ⚠️ 有 {{ tidy.fallbackChunks }} 段没整理成，那几段下面用的是<strong>原文</strong>（没提炼过，页码目录和无关内容都还在）。
          具体成因看下面几条。
        </p>
        <p v-for="(n, i) in tidy.notes" :key="'t' + i" class="fx-note">⚠️ {{ n }}</p>
        <p class="fx-diff">
          原文 {{ tidy.rawChars }} 字 → 整理后 {{ tidy.chars }} 字（删掉了 {{ Math.max(0, tidy.rawChars - tidy.chars) }} 字）·
          这次花了 {{ tidy.calls }} 次 AI 额度
        </p>
      </template>

      <textarea v-model="current" rows="12" spellcheck="false"></textarea>

      <div class="fx-meta">
        <span :class="{ over: overBy > 0 }">
          插入{{ tab === 'tidy' ? '「AI 整理」这份' : '「原文」这份' }}后合计 {{ total }} / {{ limit }} 字<template v-if="overBy > 0">，超出 {{ overBy }} 字</template>
        </span>
        <span class="fx-tip">
          插入的是<strong>你现在看的这一栏</strong>。这段文字会进后面每一步分析的 prompt，
          碎片或者被 AI 改过的内容进去了，出来的结论照样读得很顺 —— 没有别的地方会提醒你。
        </span>
      </div>

      <div class="fx-actions">
        <!-- 超上限也允许插入：这里拦住的话他没法在资料框里统一删。
             真正的闸门在保存那一下（服务端只拒不截），上面那行数字是提前告诉他要删多少。 -->
        <button class="btn-insert" type="button" :disabled="!current.trim()" @click="insert">
          插入{{ tab === 'tidy' ? '整理后的' : '原文' }}到资料末尾
        </button>
        <button class="btn-plain" type="button" @click="discard">丢弃</button>
      </div>
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

.fx-formats { font-size: 12px; color: rgba(255, 255, 255, 0.5); }

.fx-err {
  margin-top: 12px; padding: 12px 14px; border-radius: 10px;
  background: rgba(254, 242, 242, 0.1); border: 1px solid rgba(252, 165, 165, 0.35);
  color: #FCA5A5; font-size: 13px; line-height: 1.7; white-space: pre-wrap;
}

.fx-preview {
  margin-top: 16px; padding: 16px; border-radius: 14px;
  background: rgba(0, 0, 0, 0.25); border: 1px solid rgba(255, 255, 255, 0.12);
}
.fx-head { display: flex; align-items: baseline; gap: 12px; margin-bottom: 10px; }
.fx-head strong { font-size: 14px; color: #fff; word-break: break-all; }
.fx-count { font-size: 12px; color: rgba(255, 255, 255, 0.55); flex-shrink: 0; }

.fx-note {
  margin: 0 0 10px; padding: 9px 12px; border-radius: 8px;
  background: rgba(255, 184, 0, 0.1); border: 1px solid rgba(255, 184, 0, 0.3);
  color: #FCD34D; font-size: 12.5px; line-height: 1.7;
}

/* 两栏 + 右侧那个整理按钮 */
.fx-tabs { display: flex; align-items: center; gap: 6px; margin-bottom: 10px; flex-wrap: wrap; }
.fx-tabs > button {
  padding: 6px 12px; border-radius: 8px; cursor: pointer;
  font-size: 12.5px; font-weight: 600; font-family: inherit;
  background: transparent; color: rgba(255, 255, 255, 0.55);
  border: 1px solid rgba(255, 255, 255, 0.12);
  transition: all 0.2s;
}
.fx-tabs > button:hover:not(:disabled) { color: #fff; border-color: rgba(255, 255, 255, 0.3); }
.fx-tabs > button.on {
  color: #FFB800; border-color: rgba(255, 184, 0, 0.5); background: rgba(255, 184, 0, 0.1);
}
.fx-tabs > button:disabled { opacity: 0.4; cursor: default; }

.fx-tabs-right { margin-left: auto; }
.btn-tidy {
  padding: 6px 14px; border-radius: 999px; cursor: pointer;
  font-size: 12.5px; font-weight: 600; font-family: inherit;
  color: #FFB800; background: rgba(255, 184, 0, 0.1);
  border: 1px solid rgba(255, 184, 0, 0.45);
  transition: all 0.2s;
}
.btn-tidy:hover:not(:disabled) { background: rgba(255, 184, 0, 0.2); }
.btn-tidy:disabled { opacity: 0.45; cursor: default; }

.fx-hint-run {
  margin: 0 0 10px; padding: 9px 12px; border-radius: 8px;
  background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.65); font-size: 12.5px; line-height: 1.7;
}
.fx-hint-run strong { color: #FCD34D; }

/* 「整理后多出了原文没有的数字」—— 这条要比 note 更刺眼：它是这条链路上最贵的失败。 */
.fx-warn {
  margin: 0 0 10px; padding: 10px 12px; border-radius: 8px;
  background: rgba(254, 242, 242, 0.1); border: 1px solid rgba(252, 165, 165, 0.45);
  color: #FCA5A5; font-size: 12.5px; line-height: 1.7;
}
.fx-warn code {
  font-family: "SF Mono", Menlo, Monaco, monospace;
  background: rgba(0, 0, 0, 0.35); padding: 1px 5px; border-radius: 4px; color: #FECACA;
}

.fx-diff { margin: 0 0 8px; font-size: 12px; color: rgba(255, 255, 255, 0.5); }

.fx-preview textarea {
  width: 100%; box-sizing: border-box; padding: 12px;
  border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 10px;
  background: rgba(0, 0, 0, 0.3); color: rgba(255, 255, 255, 0.9);
  font-size: 13px; line-height: 1.8; font-family: inherit; resize: vertical;
}
.fx-preview textarea:focus { outline: none; border-color: rgba(255, 184, 0, 0.6); }

.fx-meta { margin-top: 10px; display: flex; flex-direction: column; gap: 6px; font-size: 12px; }
.fx-meta > span:first-child { color: rgba(255, 255, 255, 0.7); font-weight: 600; }
.fx-meta > span:first-child.over { color: #FCA5A5; }
.fx-tip { color: rgba(255, 255, 255, 0.5); line-height: 1.7; font-weight: 400; }

.fx-actions { margin-top: 14px; display: flex; gap: 10px; }
.btn-insert {
  padding: 9px 18px; border-radius: 999px; border: none; cursor: pointer;
  background: #FFB800; color: #111; font-size: 13px; font-weight: 700; font-family: inherit;
}
.btn-insert:hover:not(:disabled) { background: #E6A600; }
.btn-insert:disabled { opacity: 0.5; cursor: default; }
.btn-plain {
  padding: 9px 18px; border-radius: 999px; cursor: pointer;
  background: transparent; color: rgba(255, 255, 255, 0.6);
  border: 1px solid rgba(255, 255, 255, 0.16); font-size: 13px; font-family: inherit;
}
.btn-plain:hover { color: #fff; border-color: rgba(255, 255, 255, 0.35); }
</style>
