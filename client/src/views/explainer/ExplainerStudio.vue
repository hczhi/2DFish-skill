<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { apiPost } from '../../lib/api'
import { activeAppKey, keyInfo, refreshKeyInfo } from '../../lib/appKey'
import { STYLES, type StyleId, shotWindows } from '../../components/explainer/scene'
import { type Script, type ScriptShot, DURATIONS, MAX_SHOTS, MAX_PROMPT, ROLES, ROLE_NAMES, LAYOUT_NAMES, durationText, writeScript, writeScene, exportVideo, scriptKey, loadDraft, saveDraft } from '../../components/explainer/script'
import { LAYOUTS } from '../../components/explainer/scene'
import type { Scene } from '../../components/explainer/scene'
import ExplainerPlayer from '../../components/explainer/ExplainerPlayer.vue'

// 代码动画视频：① 选风格、写内容、选时长 → ② AI 出剧本（分镜 + 时间线），每一项都能改 → ③ 确认后生成视频（下一片）。
// 编辑状态自动存在浏览器本地，刷新不丢。
const style = ref<StyleId>('whiteboard')
const STYLE_BLURB: Record<StyleId, string> = {
  whiteboard: '马克笔在白板上一笔一笔写画，适合科普、原理讲解',
  blueprint: '白线画在蓝晒纸上，按制图顺序出图，适合机械、结构、流程',
  sketch: '纯白纸上的细线手绘，一镜一张图，红橙蓝手写批注，适合观点、方法论',
}
const prompt = ref('')
const duration = ref<number>(20)
const script = ref<Script | null>(null)
const notes = ref<string[]>([])
const busy = ref(false)
const error = ref('')
const saveError = ref('')
// ③ 画面：AI 把剧本翻译成场景 JSON，播放器按当前风格画（风格可以直接切，不用重新生成）
const scene = ref<Scene | null>(null)
const sceneNotes = ref<string[]>([])
const sceneFrom = ref('')
const compileNotes = ref<string[]>([])
const sceneBusy = ref(false)
const sceneError = ref('')
// ④ 导出：服务器逐帧渲染成 MP4。导出的是「现在的画面 + 现在选的风格」
const exporting = ref(false)
const exportError = ref('')
const exportNotes = ref<string[]>([])
const exportDone = ref('')
// 售卖型 key：这次实际调了几次 AI（每次 1 点），如实说出来
const lastCalls = ref('')
const exportProgress = ref<{ done: number; total: number } | null>(null)
const HEADING_MAX = 16

// 售卖型 key（EXP-…）：编辑页没有站点顶栏，余额和充值在自己的顶栏上；key 模式下不调 /api/auth/me（影子用户会被 403）。
// 扣点：生成剧本 / 生成画面各 1 点（网关扣），导出 5 点（失败不扣）
const keyMode = !!activeAppKey()
const topupOpen = ref(false)
const topupCode = ref('')
const topupBusy = ref(false)
const topupMsg = ref('')
const topupErr = ref('')
async function redeem() {
  if (topupBusy.value || !topupCode.value.trim()) return
  topupBusy.value = true; topupErr.value = ''; topupMsg.value = ''
  try {
    const r = await apiPost<{ points: number; balance: number }>('/api/app-keys/redeem', { code: topupCode.value })
    topupMsg.value = `已充入 ${r.points} 点，现在可用 ${r.balance} 点`
    topupCode.value = ''
    await refreshKeyInfo()
  } catch (e: any) {
    topupErr.value = e.message || '充值失败'
  } finally {
    topupBusy.value = false
  }
}

onMounted(() => {
  if (keyMode) refreshKeyInfo()
  const d = loadDraft()
  if (!d) return
  style.value = d.style; prompt.value = d.prompt; duration.value = d.duration; script.value = d.script; notes.value = d.notes || []
  scene.value = d.scene || null; sceneNotes.value = d.sceneNotes || []; sceneFrom.value = d.sceneFrom || ''
})
watch([style, prompt, duration, script, notes, scene, sceneNotes, sceneFrom], () => {
  saveError.value = saveDraft({ style: style.value, prompt: prompt.value, duration: duration.value, script: script.value, notes: notes.value, scene: scene.value, sceneNotes: sceneNotes.value, sceneFrom: sceneFrom.value })
}, { deep: true })

async function generate() {
  error.value = ''
  if (!prompt.value.trim()) { error.value = '先写一下视频要讲什么'; return }
  if (script.value && !confirm('重新生成会覆盖现在的剧本（包括你改过的地方），继续吗？')) return
  busy.value = true
  try {
    const r = await writeScript({ style: style.value, prompt: prompt.value, duration: duration.value })
    script.value = r.script; notes.value = r.notes
    lastCalls.value = `剧本：创意方案 → 分镜${r.review.found ? ` → 检查出 ${r.review.found} 个问题${r.review.revised ? '、改了一轮' : '、修改没成功'}` : ' → 检查通过'}；共调用 AI ${r.calls} 次${keyMode ? `（扣 ${r.calls} 点）` : ''}`
    scene.value = null; sceneNotes.value = []; sceneFrom.value = ''
  } catch (e: any) {
    error.value = e?.message || String(e)
  } finally {
    busy.value = false
  }
}

async function makeScene() {
  if (!script.value) return
  sceneError.value = ''; sceneBusy.value = true
  const from = scriptKey(script.value)
  try {
    const r = await writeScene({ ...script.value, style: style.value })
    scene.value = r.scene; sceneNotes.value = r.notes; sceneFrom.value = from
    lastCalls.value = `画面：分 ${r.calls} 组生成，共调用 AI ${r.calls} 次${keyMode ? `（扣 ${r.calls} 点）` : ''}`
  } catch (e: any) {
    sceneError.value = e?.message || String(e)
  } finally {
    sceneBusy.value = false
  }
}
async function doExport() {
  if (!scene.value) return
  if (sceneStale.value && !confirm('剧本在生成画面之后改过了，现在导出的是旧剧本的画面。还要导出吗？')) return
  exportError.value = ''; exportNotes.value = []; exportDone.value = ''; exporting.value = true
  const started = Date.now()
  try {
    exportProgress.value = null
    const r = await exportVideo(scene.value, style.value, (done, total) => { exportProgress.value = { done, total } })
    const url = URL.createObjectURL(r.blob)
    const a = document.createElement('a')
    a.href = url; a.download = `${scene.value.title || '代码动画'}-${STYLES.find((x) => x.id === style.value)?.name.split(' ')[0] || style.value}.mp4`; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
    exportNotes.value = r.notes
    exportDone.value = `已导出（${(r.blob.size / 1024 / 1024).toFixed(1)} MB，用时 ${Math.round((Date.now() - started) / 1000)} 秒），浏览器应该已经开始下载`
  } catch (e: any) {
    exportError.value = e?.message || String(e)
  } finally {
    exporting.value = false
    exportProgress.value = null
  }
}
// 剧本在生成画面之后又改过：预览里还是旧画面，必须说出来（不说的话他以为改动已经生效）
const sceneStale = computed(() => !!scene.value && !!script.value && sceneFrom.value !== scriptKey(script.value))
const allSceneNotes = computed(() => [...sceneNotes.value, ...compileNotes.value])

// 时间线：和编译画面同一个公式（shotWindows），剧本上写的时间就是成片里的时间
const timing = computed(() => (script.value ? shotWindows(script.value.duration, script.value.shots.map((s) => s.seconds)) : null))
const fmt = (v: number) => v.toFixed(1)
// 剧本的总时长跟着上面选的时长走（改时长不用重新生成）
watch(duration, (d) => { if (script.value) script.value.duration = d })

const elementsText = (s: ScriptShot) => s.elements.join('、')
function setElements(s: ScriptShot, v: string) { s.elements = v.split(/[、,，;；\n]/).map((x) => x.trim()).filter(Boolean) }
function addShot(i: number) {
  if (!script.value || script.value.shots.length >= MAX_SHOTS) return
  script.value.shots.splice(i + 1, 0, { seconds: 5, heading: '', visual: '', elements: [], note: '' })
}
function removeShot(i: number) {
  if (!script.value || script.value.shots.length <= 1) return
  if (!confirm(`删掉第 ${i + 1} 镜？`)) return
  script.value.shots.splice(i, 1)
}
function move(i: number, d: -1 | 1) {
  const s = script.value?.shots; if (!s) return
  const j = i + d; if (j < 0 || j >= s.length) return
  ;[s[i], s[j]] = [s[j], s[i]]
}
// 前端只做提示，不拦：标题超长 / 没写元素，生成画面时会缩字号或空着，先让他看见
const problems = computed(() => (script.value?.shots || []).map((s) => {
  const p: string[] = []
  if (!s.heading.trim()) p.push('没有标题')
  if ([...s.heading].length > HEADING_MAX) p.push(`标题 ${[...s.heading].length} 字，超过 ${HEADING_MAX} 字会缩小字号`)
  if (!s.elements.length) p.push('没写要画的元素')
  if (s.elements.length > 4) p.push('元素超过 4 个，画面会很挤')
  return p
}))
const COLORS = ['#3f6fb5', '#d97757', '#3a8f6a', '#8a5cc2', '#c4943a', '#4a90a4', '#b5546f', '#6b7d3a', '#5a6fd6', '#a0603a']
</script>

<template>
  <div class="st">
    <nav class="st-top">
      <router-link to="/explainer" class="st-back">← 代码动画视频</router-link>
      <span class="grow" />
      <template v-if="keyMode">
        <span class="st-price">按 AI 调用次数扣点：剧本 2–3 点 · 画面每 8 镜 1 点 · 导出 5 点</span>
        <button class="st-balance" @click="topupOpen = !topupOpen">余额 {{ keyInfo ? keyInfo.balance : '…' }} 点 · 充值</button>
      </template>
    </nav>
    <div v-if="keyMode && topupOpen" class="st-topup">
      <p>充进 KEY <code>{{ keyInfo?.keyPrefix || '…' }}</code>，当前 {{ keyInfo ? keyInfo.balance : '…' }} 点</p>
      <div class="st-row">
        <input v-model="topupCode" placeholder="粘贴充值码，如 EXPCZ-XXXX-XXXX-XXXX-XXXX" :disabled="topupBusy" @keydown.enter="redeem" />
        <button class="st-primary" :disabled="topupBusy || !topupCode.trim()" @click="redeem">{{ topupBusy ? '充值中…' : '充值' }}</button>
      </div>
      <p v-if="topupMsg" class="st-ok">{{ topupMsg }}</p>
      <p v-if="topupErr" class="st-error">{{ topupErr }}</p>
    </div>
    <header class="st-head">
      <h1>代码动画视频</h1>
      <p>写下要讲的内容，AI 先出一份剧本给你看和改，确认后再生成视频。</p>
    </header>

    <section class="st-card">
      <h2>① 视频设置</h2>
      <div class="st-styles">
        <button v-for="s in STYLES" :key="s.id" class="st-style" :class="{ on: style === s.id, [s.id]: true }" @click="style = s.id">
          <span class="st-swatch" />
          <b>{{ s.name }}</b>
          <small>{{ STYLE_BLURB[s.id] }}</small>
        </button>
      </div>
      <label class="st-label">要讲的内容</label>
      <textarea v-model="prompt" rows="5" :maxlength="MAX_PROMPT" placeholder="比如：手机是怎么知道你在哪的？GPS 卫星发出带时间的信号，手机算出到三颗卫星的距离，三个距离交于一点就是你的位置。" />
      <div class="st-row">
        <label>时长
          <select v-model.number="duration"><option v-for="d in DURATIONS" :key="d" :value="d">{{ durationText(d) }}</option></select>
        </label>
        <span class="st-count">{{ [...prompt].length }} / {{ MAX_PROMPT }}</span>
        <button class="st-primary" :disabled="busy" @click="generate">{{ busy ? 'AI 正在写剧本…' : script ? '重新生成剧本' : '生成剧本' }}</button>
      </div>
      <p v-if="error" class="st-error">{{ error }}</p>
    </section>

    <section v-if="script" class="st-card">
      <h2>② 剧本 <small>（每一项都可以直接改，自动保存在本机浏览器）</small></h2>
      <p v-if="saveError" class="st-error">{{ saveError }}</p>
      <div v-if="notes.length" class="st-notes">
        <b>AI 剧本有 {{ notes.length }} 处被调整：</b>
        <ul><li v-for="(n, i) in notes" :key="i">{{ n }}</li></ul>
      </div>
      <p v-if="lastCalls" class="st-calls">{{ lastCalls }}</p>
      <div v-if="script.treatment" class="st-treat">
        <b>创意方案</b>
        <label>开场钩子 <input v-model="script.treatment.hook" maxlength="80" /></label>
        <label>结构 <input :value="script.treatment.structure.join(' → ')" maxlength="300" @change="script.treatment.structure = ($event.target as HTMLInputElement).value.split(/\s*→\s*/).filter(Boolean)" /></label>
        <label>转折 <input v-model="script.treatment.turn" maxlength="80" placeholder="（没有）" /></label>
        <label>结尾 <input v-model="script.treatment.ending" maxlength="80" /></label>
        <small>创意方案是 AI 分镜时的依据；在这里改了不会自动重写分镜，要按新的方案重来就点「重新生成剧本」。</small>
      </div>
      <div class="st-meta">
        <label>标题 <input v-model="script.title" maxlength="20" /></label>
        <label class="grow">一句话 <input v-model="script.summary" maxlength="80" /></label>
      </div>

      <div class="st-timeline">
        <div v-for="(sh, i) in script.shots" :key="i" class="st-seg" :style="{ flex: timing!.windows[i][1] - timing!.windows[i][0], background: COLORS[i % COLORS.length] }" :title="`第 ${i + 1} 镜 ${fmt(timing!.windows[i][0])}–${fmt(timing!.windows[i][1])} 秒`">
          <span>{{ i + 1 }}</span>
        </div>
        <div v-if="timing!.overview" class="st-seg st-overview" :style="{ flex: timing!.overview }" title="结尾拉远看全貌"><span>全貌</span></div>
      </div>
      <div class="st-ticks"><span>0 秒</span><span>{{ script.duration }} 秒</span></div>

      <div class="st-shots">
        <article v-for="(sh, i) in script.shots" :key="i" class="st-shot">
          <div class="st-shot-head">
            <span class="st-no" :style="{ background: COLORS[i % COLORS.length] }">{{ i + 1 }}</span>
            <span class="st-time">{{ fmt(timing!.windows[i][0]) }}–{{ fmt(timing!.windows[i][1]) }} 秒</span>
            <label class="st-sec">占比 <input v-model.number="sh.seconds" type="number" min="1" max="30" /></label>
            <span class="grow" />
            <button title="上移" :disabled="i === 0" @click="move(i, -1)">↑</button>
            <button title="下移" :disabled="i === script.shots.length - 1" @click="move(i, 1)">↓</button>
            <button title="在后面加一镜" :disabled="script.shots.length >= MAX_SHOTS" @click="addShot(i)">＋</button>
            <button title="删掉这一镜" :disabled="script.shots.length <= 1" @click="removeShot(i)">✕</button>
          </div>
          <div class="st-tags">
            <label>叙事 <select v-model="sh.role"><option :value="undefined">—</option><option v-for="r in ROLES" :key="r" :value="r">{{ ROLE_NAMES[r] }}</option></select></label>
            <label>版式 <select v-model="sh.layout"><option :value="undefined">AI 来选</option><option v-for="l in LAYOUTS" :key="l" :value="l">{{ LAYOUT_NAMES[l] }}</option></select></label>
          </div>
          <label>屏幕标题 <input v-model="sh.heading" :maxlength="30" placeholder="这一镜写在屏幕上的标题" /></label>
          <label>画面怎么呈现 <textarea v-model="sh.visual" rows="2" maxlength="120" placeholder="谁在左谁在右、谁指向谁、哪个要强调" /></label>
          <label>要画的元素 <input :value="elementsText(sh)" placeholder="用顿号隔开，如：手机、三颗卫星" @change="setElements(sh, ($event.target as HTMLInputElement).value)" /></label>
          <label>注释 <input v-model="sh.note" maxlength="30" placeholder="可选：公式、结论、提示" /></label>
          <p v-if="problems[i].length" class="st-warn">{{ problems[i].join('；') }}</p>
        </article>
      </div>

      <div class="st-row st-foot">
        <span class="grow">共 {{ script.shots.length }} 镜 · {{ script.duration }} 秒 · {{ STYLES.find((s) => s.id === style)?.name }}</span>
        <button class="st-primary" :disabled="sceneBusy" @click="makeScene">{{ sceneBusy ? 'AI 正在安排画面…' : scene ? '按现在的剧本重新生成画面' : '③ 确认剧本，生成画面' }}</button>
      </div>
      <p v-if="sceneError" class="st-error">{{ sceneError }}</p>
    </section>

    <section v-if="scene" class="st-card">
      <h2>③ 画面预览 <small>（风格可以在上面直接切换，不用重新生成）</small></h2>
      <p v-if="sceneStale" class="st-stale">剧本在生成画面之后改过了，下面还是<b>旧剧本</b>的画面 —— 点上面的「按现在的剧本重新生成画面」。</p>
      <div v-if="allSceneNotes.length" class="st-notes">
        <b>画面有 {{ allSceneNotes.length }} 处要留意：</b>
        <ul><li v-for="(n, i) in allSceneNotes" :key="i">{{ n }}</li></ul>
      </div>
      <ExplainerPlayer :scene="scene" :style-id="style" @notes="compileNotes = $event" />
      <div class="st-row">
        <span class="grow st-hint">导出在服务器上逐帧渲染，{{ durationText(scene.duration) }}的视频大约要 {{ Math.max(1, Math.round(scene.duration * 1.2 / 60)) }} 分钟，期间不要关页面。</span>
        <button class="st-primary" :disabled="exporting" @click="doExport">{{ exporting ? '正在导出…' : '④ 导出 MP4' }}</button>
      </div>
      <div v-if="exporting && exportProgress" class="st-progress">
        <div class="st-bar"><i :style="{ width: `${exportProgress.total ? (100 * exportProgress.done) / exportProgress.total : 0}%` }" /></div>
        <span>{{ exportProgress.done < exportProgress.total ? `渲染第 ${exportProgress.done} / ${exportProgress.total} 帧` : '编码、准备下载…' }}</span>
      </div>
      <p v-if="exportError" class="st-error">{{ exportError }}</p>
      <p v-if="exportDone" class="st-ok">{{ exportDone }}</p>
      <div v-if="exportNotes.length" class="st-notes"><b>导出时的提示：</b><ul><li v-for="(n, i) in exportNotes" :key="i">{{ n }}</li></ul></div>
    </section>
  </div>
</template>

<style scoped>
.st { max-width: 1100px; margin: 0 auto; padding: 28px 24px 60px; color: #222; }
.st-top { display: flex; align-items: center; gap: 12px; margin-bottom: 18px; font-size: 13px; }
.st-back { color: #1f3f7a; text-decoration: none; }
.st-price { color: #999; }
.st-calls { font-size: 12px; color: #777; margin: 0 0 12px; }
.st-treat { background: #f6f8fc; border: 1px solid #e1e7f2; border-radius: 10px; padding: 12px 14px; margin-bottom: 16px; display: grid; gap: 8px; }
.st-treat b { font-size: 14px; }
.st-treat label { font-size: 12px; color: #666; display: grid; grid-template-columns: 64px 1fr; align-items: center; gap: 8px; }
.st-treat small { color: #999; font-size: 12px; }
.st-tags { display: flex; gap: 10px; }
.st-tags label { flex-direction: row !important; align-items: center; gap: 6px !important; }
.st-tags select { padding: 3px 6px; font-size: 12px; }
.st-progress { display: flex; align-items: center; gap: 12px; margin-top: 10px; font-size: 12px; color: #666; }
.st-bar { flex: 1; height: 8px; background: #e8ebf0; border-radius: 4px; overflow: hidden; }
.st-bar i { display: block; height: 100%; background: #1f3f7a; transition: width 0.4s; }
.st-balance { border: 1px solid #d8dbe0; background: #fff; border-radius: 16px; padding: 5px 12px; cursor: pointer; font-size: 13px; }
.st-topup { background: #fff; border: 1px solid #e6e8eb; border-radius: 10px; padding: 12px 16px; margin-bottom: 16px; font-size: 13px; }
.st-topup p { margin: 0 0 6px; }
.st-head h1 { font-size: 24px; margin: 0 0 6px; }
.st-head p { margin: 0 0 20px; color: #666; }
.st-card { background: #fff; border: 1px solid #e6e8eb; border-radius: 12px; padding: 20px 22px; margin-bottom: 18px; }
.st-card h2 { font-size: 17px; margin: 0 0 14px; }
.st-card h2 small { font-weight: normal; color: #888; font-size: 13px; }
.st-styles { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px; }
.st-style { display: grid; grid-template-columns: 44px 1fr; grid-template-rows: auto auto; column-gap: 12px; text-align: left; padding: 12px 14px; border: 2px solid #e6e8eb; border-radius: 10px; background: #fafbfc; cursor: pointer; }
.st-style.on { border-color: #1f3f7a; background: #f3f6fc; }
.st-swatch { grid-row: span 2; width: 44px; height: 44px; border-radius: 8px; }
.st-style.whiteboard .st-swatch { background: linear-gradient(135deg, #fbfbf9, #e9e8e4); border: 1px solid #ddd; box-shadow: inset 6px -6px 0 -4px #d97757; }
.st-style.sketch .st-swatch { background: #fff; border: 1px solid #ddd; box-shadow: inset -8px -8px 0 -5px #e0473c, inset 8px 8px 0 -5px #2f6fdf; }
.st-style.blueprint .st-swatch { background: linear-gradient(135deg, #2a58a6, #18336b); box-shadow: inset 0 0 0 3px rgba(231, 240, 249, 0.6); }
.st-style small { color: #777; font-size: 12px; line-height: 1.5; }
.st-label { display: block; font-size: 13px; color: #555; margin-bottom: 6px; }
textarea, input, select { font: inherit; border: 1px solid #d8dbe0; border-radius: 6px; padding: 7px 9px; width: 100%; box-sizing: border-box; }
select { width: auto; margin-left: 6px; }
.st-row { display: flex; align-items: center; gap: 14px; margin-top: 12px; }
.st-count { color: #999; font-size: 12px; margin-left: auto; }
.st-primary { background: #1f3f7a; color: #fff; border: none; border-radius: 8px; padding: 9px 18px; cursor: pointer; font-size: 14px; }
.st-primary:disabled { background: #9aa6bb; cursor: not-allowed; }
.st-error { color: #c0392b; margin: 10px 0 0; white-space: pre-line; }
.st-notes { background: #fff8e8; border: 1px solid #f0dfb0; border-radius: 8px; padding: 10px 14px; margin-bottom: 14px; font-size: 13px; }
.st-notes ul { margin: 6px 0 0; padding-left: 18px; }
.st-meta { display: flex; gap: 14px; margin-bottom: 16px; }
.st-meta label { font-size: 13px; color: #555; display: flex; align-items: center; gap: 8px; white-space: nowrap; }
.grow { flex: 1; }
.st-meta label.grow input { flex: 1; }
.st-timeline { display: flex; height: 34px; border-radius: 6px; overflow: hidden; gap: 2px; }
.st-seg { display: flex; align-items: center; justify-content: center; color: #fff; font-size: 13px; min-width: 18px; }
.st-overview { background: repeating-linear-gradient(45deg, #b8bec8, #b8bec8 6px, #c9ced6 6px, #c9ced6 12px); color: #444; }
.st-ticks { display: flex; justify-content: space-between; font-size: 11px; color: #999; margin: 4px 0 18px; }
.st-shots { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.st-shot { border: 1px solid #e6e8eb; border-radius: 10px; padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; background: #fcfcfd; }
.st-shot label { font-size: 12px; color: #666; display: flex; flex-direction: column; gap: 4px; }
.st-shot-head { display: flex; align-items: center; gap: 8px; }
.st-shot-head button { border: 1px solid #d8dbe0; background: #fff; border-radius: 5px; width: 28px; height: 26px; cursor: pointer; }
.st-shot-head button:disabled { opacity: 0.35; cursor: default; }
.st-no { color: #fff; border-radius: 50%; width: 24px; height: 24px; display: inline-flex; align-items: center; justify-content: center; font-size: 13px; }
.st-time { font-variant-numeric: tabular-nums; color: #444; font-size: 13px; }
.st-sec { flex-direction: row !important; align-items: center; gap: 6px !important; }
.st-sec input { width: 58px; padding: 3px 6px; }
.st-warn { color: #b4441c; font-size: 12px; margin: 0; }
.st-stale { background: #fdecea; border: 1px solid #f5c2bd; color: #a12d22; border-radius: 8px; padding: 10px 14px; margin: 0 0 14px; font-size: 13px; }
.st-hint { color: #999; font-size: 12px; margin: 10px 0 0; }
.st-ok { color: #2e7d32; margin: 10px 0 0; font-size: 13px; }
.st-foot { border-top: 1px solid #eee; padding-top: 14px; margin-top: 18px; color: #666; font-size: 13px; }
@media (max-width: 800px) { .st-styles, .st-shots { grid-template-columns: 1fr; } }
</style>
