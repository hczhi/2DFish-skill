<template>
  <div class="page-wrapper">
    <SiteHeader />
    <div class="xhs-studio">
      <!-- 左侧：写作区 -->
    <div class="editor-pane">
      <div class="editor-header">
        <router-link to="/xhs" class="back-link">← 返回首页</router-link>
        <input v-model="niche" class="niche-input hc-input" placeholder="赛道/人群（选填，如：省钱/职场女性）" />
        <div class="header-actions">
          <span class="save-hint" v-if="savedAt">已保存 {{ savedAt }}</span>
          <div class="drafts-dropdown">
            <button class="btn-ghost" @click="toggleDrafts">草稿 ▾</button>
            <div class="drafts-menu hc-shadow" v-if="showDrafts">
              <button class="draft-new" @click="newNote">＋ 新建笔记</button>
              <div v-if="drafts.length === 0" class="draft-empty">还没有草稿</div>
              <div v-for="d in drafts" :key="d.id" class="draft-item" :class="{ active: d.id === noteId }">
                <span class="draft-title" @click="openDraft(d.id)">
                  {{ d.title || '(无标题)' }}
                  <span class="draft-score" v-if="d.last_score != null">{{ d.last_score }}分</span>
                </span>
                <button class="draft-del" @click.stop="deleteDraft(d.id)" title="删除">✕</button>
              </div>
            </div>
          </div>
          <router-link to="/xhs/calibration" class="btn-ghost">校准</router-link>
          <button class="btn-ghost" @click="saveDraft" :disabled="saving">{{ saving ? '保存中…' : '存草稿' }}</button>
        </div>
      </div>

      <!-- 用写作 Skill 生成整篇 -->
      <div class="skill-gen-bar">
        <select v-model="genSkillId" class="hc-input skill-select">
          <option value="">选择写作 Skill…</option>
          <option v-for="s in writingSkills" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
        <input v-model="genTopic" class="hc-input topic-input" placeholder="主题（如：油皮夏天不脱妆粉底推荐）" @keyup.enter="generateWithSkill" />
        <button class="btn-primary" @click="generateWithSkill" :disabled="genLoading || !genSkillId || !genTopic.trim()">
          {{ genLoading ? '生成中…' : '用 Skill 生成' }}
        </button>
        <router-link to="/xhs/skills" class="btn-ghost">管理 Skill</router-link>
      </div>

      <input v-model="title" class="title-input" placeholder="标题（决定用户点不点开）" @input="scheduleScore" />
      <textarea
        ref="bodyRef"
        v-model="body"
        class="body-input"
        placeholder="正文…（选中一段文字，可以问 AI 怎么改）"
        @input="scheduleScore"
        @select="onSelect"
        @mouseup="onSelect"
        @keyup="onSelect"
      ></textarea>

      <!-- 选中文字后浮出的"问 AI"栏 -->
      <div class="selection-bar hc-shadow" v-if="selection">
        <span class="sel-preview">已选中「{{ selection.slice(0, 24) }}{{ selection.length > 24 ? '…' : '' }}」</span>
        <input v-model="question" class="ask-input" placeholder="想问 AI 什么？（如：这段怎么改更抓人）" @keyup.enter="askAI" />
        <button class="btn-primary" @click="askAI" :disabled="asking || !question">{{ asking ? '思考中…' : '问 AI' }}</button>
      </div>
    </div>

    <!-- 右侧：诊断区 -->
    <div class="panel-pane">
      <div class="panel-section">
        <div class="score-header">
          <div class="total-score" :class="scoreClass">
            <span class="score-num">{{ result ? result.totalScore : '—' }}</span>
            <span class="score-label">爆款潜力</span>
          </div>
          <button class="btn-primary score-btn" @click="scoreNow" :disabled="scoring || (!title && !body)">
            {{ scoring ? '诊断中…' : '立即诊断' }}
          </button>
        </div>
        <div class="ai-smell" v-if="result && result.aiSmell">⚠️ 检测到 AI 味，情绪/共鸣已被压分</div>
      </div>

      <!-- 维度雷达（简单条形） -->
      <div class="panel-section" v-if="result">
        <div class="dim-list">
          <div v-for="d in dimList" :key="d.key" class="dim-row" @click="expanded = expanded === d.key ? '' : d.key">
            <div class="dim-top">
              <span class="dim-name">{{ d.label }}</span>
              <span class="dim-score" :class="barClass(d.score)">{{ d.score }}/10</span>
            </div>
            <div class="dim-bar"><div class="dim-fill" :class="barClass(d.score)" :style="{ width: d.score * 10 + '%' }"></div></div>
            <div class="dim-detail hc-shadow-sm" v-if="expanded === d.key">
              <p class="dim-reason">{{ d.reason }}</p>
              <p class="dim-suggestion" v-if="d.suggestion">
                💡 {{ d.suggestion }}
                <span class="fb-btns">
                  <button class="fb-btn" @click.stop="feedback(d.key, 'accept_suggestion')" title="有用">👍</button>
                  <button class="fb-btn" @click.stop="feedback(d.key, 'reject_suggestion')" title="没用">👎</button>
                </span>
              </p>
            </div>
          </div>
        </div>
      </div>

      <!-- 一句话总结 -->
      <div class="panel-section" v-if="result">
        <div class="top-suggestion hc-shadow-sm" v-if="result.topSuggestion">
          <div class="ts-label">最该改的一处</div>
          <p>{{ result.topSuggestion }}</p>
        </div>
        <p class="overall">{{ result.overall }}</p>
      </div>

      <!-- AI 问答结果 -->
      <div class="panel-section" v-if="answer || asking">
        <div class="ts-label">AI 建议</div>
        <div class="answer-text">{{ answer }}<span v-if="asking" class="cursor">▋</span></div>
      </div>

      <div class="panel-empty" v-if="!result && !answer && !asking">
        <p>在左侧写好标题和正文，点「立即诊断」看看能不能爆 🔥</p>
      </div>
    </div>
  </div>
  <SiteFooter />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { apiGet, apiPost, apiPut, apiDelete } from '../../lib/api'
import { getToken } from '../../lib/auth'
import SiteHeader from '../../components/common/SiteHeader.vue'
import SiteFooter from '../../components/common/SiteFooter.vue'

interface DimScore { score: number; reason: string; suggestion: string }
interface ScoreResult {
  totalScore: number
  aiSmell: boolean
  dimensions: Record<string, DimScore>
  topSuggestion: string
  overall: string
}

const DIM_LABELS: Record<string, string> = {
  titleHook: '标题钩子',
  opening: '开头留人',
  resonance: '痛点共鸣',
  emotion: '情绪浓度',
  value: '价值密度',
  interaction: '互动引导',
}
const DIM_ORDER = ['titleHook', 'opening', 'resonance', 'emotion', 'value', 'interaction']

const title = ref('')
const body = ref('')
const niche = ref('')
const noteId = ref<string | null>(null)

const result = ref<ScoreResult | null>(null)
const scoring = ref(false)
const expanded = ref('')

const bodyRef = ref<HTMLTextAreaElement | null>(null)
const selection = ref('')
const question = ref('')
const answer = ref('')
const asking = ref(false)

const saving = ref(false)
const savedAt = ref('')

const drafts = ref<any[]>([])
const showDrafts = ref(false)

// 用写作 skill 生成整篇
interface WritingSkill { id: string; name: string }
const writingSkills = ref<WritingSkill[]>([])
const genSkillId = ref('')
const genTopic = ref('')
const genLoading = ref(false)

async function loadWritingSkills() {
  try {
    const r = await apiGet<{ skills: WritingSkill[] }>('/api/xhs/skills')
    writingSkills.value = r.skills
  } catch { /* 忽略 */ }
}

async function generateWithSkill() {
  if (!genSkillId.value || !genTopic.value.trim()) return
  genLoading.value = true
  // 生成结果直接写进标题/正文：第一行作标题，其余作正文
  title.value = ''
  body.value = ''
  let acc = ''
  try {
    const res = await fetch(`/api/xhs/skills/${genSkillId.value}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
      body: JSON.stringify({ topic: genTopic.value }),
    })
    if (!res.ok || !res.body) throw new Error('生成失败')
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        const m = line.match(/^data: (.+)$/m)
        if (!m || m[1] === '[DONE]') continue
        try {
          const { delta } = JSON.parse(m[1])
          if (delta) {
            acc += delta
            const nl = acc.indexOf('\n')
            if (nl === -1) {
              title.value = acc
            } else {
              title.value = acc.slice(0, nl).replace(/^#+\s*/, '').trim()
              body.value = acc.slice(nl + 1).trim()
            }
          }
        } catch { /* ignore */ }
      }
    }
    scheduleScore()
  } catch (e: any) {
    body.value = '（生成失败：' + (e?.message || '未知错误') + '）'
  } finally {
    genLoading.value = false
  }
}

let scoreTimer: ReturnType<typeof setTimeout> | null = null

const dimList = computed(() => {
  if (!result.value) return []
  return DIM_ORDER.map(key => ({
    key,
    label: DIM_LABELS[key],
    ...(result.value!.dimensions[key] || { score: 0, reason: '', suggestion: '' }),
  }))
})

const scoreClass = computed(() => {
  const s = result.value?.totalScore ?? 0
  if (!result.value) return ''
  if (s >= 75) return 'good'
  if (s >= 55) return 'mid'
  return 'low'
})

function barClass(s: number) {
  if (s >= 8) return 'good'
  if (s >= 5) return 'mid'
  return 'low'
}

// 停止输入 1.5s 后自动重新诊断（有内容且已诊断过一次才自动跑，避免浪费额度）
function scheduleScore() {
  if (!result.value) return
  if (scoreTimer) clearTimeout(scoreTimer)
  scoreTimer = setTimeout(() => scoreNow(), 1500)
}

async function scoreNow() {
  if (!title.value && !body.value) return
  scoring.value = true
  try {
    result.value = await apiPost<ScoreResult>('/api/xhs/score', {
      title: title.value, body: body.value, niche: niche.value,
    })
  } catch (e: any) {
    alert(e.message || '诊断失败')
  } finally {
    scoring.value = false
  }
}

function onSelect() {
  const el = bodyRef.value
  if (!el) return
  const sel = el.value.substring(el.selectionStart, el.selectionEnd).trim()
  selection.value = sel
}

// AI 问答走 SSE 流式（用 fetch 手动读流，因为 api.ts 不处理流）
async function askAI() {
  if (!question.value) return
  asking.value = true
  answer.value = ''
  try {
    const res = await fetch('/api/xhs/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
      body: JSON.stringify({
        question: question.value,
        selection: selection.value,
        title: title.value, body: body.value, niche: niche.value,
      }),
    })
    if (!res.ok || !res.body) { throw new Error('请求失败') }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        const m = line.match(/^data: (.+)$/m)
        if (!m) continue
        if (m[1] === '[DONE]') continue
        try {
          const { delta } = JSON.parse(m[1])
          if (delta) answer.value += delta
        } catch { /* ignore */ }
      }
    }
  } catch (e: any) {
    answer.value = '（' + (e.message || 'AI 回答失败') + '）'
  } finally {
    asking.value = false
  }
}

async function saveDraft() {
  saving.value = true
  try {
    if (!noteId.value) {
      const r = await apiPost<{ id: string }>('/api/xhs/notes', {
        title: title.value, body: body.value, niche: niche.value,
      })
      noteId.value = r.id
    }
    await apiPut(`/api/xhs/notes/${noteId.value}`, {
      title: title.value, body: body.value, niche: niche.value,
      last_score: result.value?.totalScore ?? null,
      last_dimensions: result.value?.dimensions ?? {},
    })
    savedAt.value = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    loadDrafts()
  } catch (e: any) {
    alert(e.message || '保存失败')
  } finally {
    saving.value = false
  }
}

// 记录反馈：AI 建议有没有用 → "越用越懂你"的燃料
function feedback(dimension: string, type: string) {
  apiPost('/api/xhs/feedback', {
    note_id: noteId.value || '',
    type, dimension,
    payload: { suggestion: result.value?.dimensions[dimension]?.suggestion },
  }).catch(() => { /* silent */ })
}

// ===== 草稿列表 =====
async function loadDrafts() {
  try {
    drafts.value = await apiGet<any[]>('/api/xhs/notes')
  } catch { /* silent */ }
}

function toggleDrafts() {
  showDrafts.value = !showDrafts.value
  if (showDrafts.value) loadDrafts()
}

async function openDraft(id: string) {
  try {
    const n = await apiGet<any>(`/api/xhs/notes/${id}`)
    noteId.value = n.id
    title.value = n.title || ''
    body.value = n.body || ''
    niche.value = n.niche || ''
    // 恢复上次评分快照
    if (n.last_score != null && n.last_dimensions) {
      try {
        const dims = JSON.parse(n.last_dimensions)
        result.value = {
          totalScore: n.last_score, aiSmell: false, dimensions: dims,
          topSuggestion: '', overall: '（这是上次保存的评分，重新诊断可更新）',
        }
      } catch { result.value = null }
    } else {
      result.value = null
    }
    answer.value = ''
    showDrafts.value = false
  } catch (e: any) {
    alert(e.message || '打开失败')
  }
}

function newNote() {
  noteId.value = null
  title.value = ''
  body.value = ''
  result.value = null
  answer.value = ''
  savedAt.value = ''
  showDrafts.value = false
}

async function deleteDraft(id: string) {
  if (!confirm('确定删除这篇草稿？')) return
  try {
    await apiDelete(`/api/xhs/notes/${id}`)
    if (noteId.value === id) newNote()
    await loadDrafts()
  } catch (e: any) {
    alert(e.message || '删除失败')
  }
}

onMounted(() => { loadDrafts(); loadWritingSkills() })
</script>

<style scoped>
.page-wrapper {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}
.xhs-studio {
  display: flex;
  height: calc(100vh - 50px);
  margin-top: 50px;
  background: #FDFBF7;
  font-family: "Inter", -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Arial, sans-serif;
  color: #111827;
}

/* ===== 左侧编辑区 ===== */
.editor-pane {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 24px 32px;
  overflow-y: auto;
  background: #fff;
  border-right: 1px solid rgba(0,0,0,0.03);
  box-shadow: 4px 0 24px rgba(0,0,0,0.02);
  z-index: 10;
}
.editor-header {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 20px;
}
.back-link { color: #6b7280; text-decoration: none; font-size: 14px; transition: color 0.2s; }
.back-link:hover { color: #E24A29; }
.niche-input {
  flex: 1;
  border: 1px solid transparent;
  background: #F9FAFB;
  padding: 10px 16px;
  border-radius: 9999px;
  font-size: 13px;
  outline: none;
  transition: all 0.3s;
}
.niche-input:focus {
  background: #fff;
  border-color: #E24A29;
  box-shadow: 0 0 0 4px rgba(226, 74, 41, 0.15);
}
.header-actions { display: flex; align-items: center; gap: 12px; }
.save-hint { font-size: 12px; color: #9ca3af; }

/* 草稿下拉 */
.drafts-dropdown { position: relative; }
.drafts-menu {
  position: absolute; top: 40px; right: 0; z-index: 20;
  width: 280px; max-height: 360px; overflow-y: auto;
  background: #fff; border: 1px solid rgba(0,0,0,0.04); border-radius: 12px;
  padding: 8px;
}
.hc-shadow {
  box-shadow: 0 16px 32px rgba(0, 0, 0, 0.08), 0 4px 12px rgba(0, 0, 0, 0.02);
}
.hc-shadow-sm {
  box-shadow: 0 8px 16px rgba(0, 0, 0, 0.04);
}
.draft-new { width: 100%; text-align: left; border: none; background: #FEF8F6; color: #E24A29; padding: 10px 12px; border-radius: 8px; font-size: 13px; cursor: pointer; margin-bottom: 6px; transition: background 0.2s; }
.draft-new:hover { background: #FFE4DF; }
.draft-empty { color: #9ca3af; font-size: 13px; padding: 12px; text-align: center; }
.draft-item { display: flex; align-items: center; justify-content: space-between; padding: 4px; border-radius: 8px; transition: background 0.2s; }
.draft-item:hover { background: #F9FAFB; }
.draft-item.active { background: #FEF8F6; }
.draft-title { flex: 1; padding: 6px 8px; font-size: 13px; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.draft-score { color: #E24A29; font-size: 11px; margin-left: 6px; }
.draft-del { border: none; background: transparent; color: #d1d5db; cursor: pointer; font-size: 12px; padding: 4px 8px; }
.draft-del:hover { color: #dc2626; }

.skill-gen-bar {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 10px 12px;
  background: #fafafa;
  border: 1px solid #f0f0f0;
  border-radius: 10px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.skill-gen-bar .skill-select { flex: 0 0 auto; min-width: 150px; }
.skill-gen-bar .topic-input { flex: 1; min-width: 160px; }

.title-input {
  border: none;
  outline: none;
  font-size: 24px;
  font-weight: 800;
  letter-spacing: -0.5px;
  padding: 12px 0;
  border-bottom: 1px solid #f0f0f0;
  margin-bottom: 16px;
  transition: border-color 0.3s;
}
.title-input:focus { border-color: #E24A29; }
.body-input {
  flex: 1;
  border: none;
  outline: none;
  font-size: 16px;
  line-height: 1.8;
  resize: none;
  min-height: 300px;
  font-family: inherit;
}
.selection-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: #fff;
  border: 1px solid rgba(226, 74, 41, 0.2);
  border-radius: 12px;
  margin-top: 12px;
}
.sel-preview { font-size: 13px; color: #E24A29; white-space: nowrap; font-weight: 500; }
.ask-input { flex: 1; border: none; background: transparent; outline: none; font-size: 14px; }

/* ===== 右侧诊断区 ===== */
.panel-pane {
  width: 400px;
  flex-shrink: 0;
  padding: 32px 24px;
  overflow-y: auto;
  background: #FDFBF7;
}
.panel-section { margin-bottom: 24px; }
.score-header { display: flex; align-items: center; justify-content: space-between; }
.total-score { display: flex; flex-direction: column; align-items: flex-start; }
.score-num { font-size: 56px; font-weight: 900; line-height: 1; letter-spacing: -2px; }
.total-score.good .score-num { color: #16a34a; }
.total-score.mid .score-num { color: #ea580c; }
.total-score.low .score-num { color: #E24A29; }
.score-label { font-size: 13px; color: #6b7280; margin-top: 6px; font-weight: 500; }
.ai-smell { margin-top: 12px; font-size: 13px; color: #ea580c; background: #fff7ed; padding: 10px 14px; border-radius: 10px; font-weight: 500; }

.dim-list { display: flex; flex-direction: column; gap: 16px; }
.dim-row { cursor: pointer; }
.dim-top { display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 6px; }
.dim-name { font-weight: 600; color: #374151; }
.dim-score { font-weight: 600; }
.dim-score.good { color: #16a34a; }
.dim-score.mid { color: #ea580c; }
.dim-score.low { color: #E24A29; }
.dim-bar { height: 8px; background: rgba(0,0,0,0.04); border-radius: 4px; overflow: hidden; }
.dim-fill { height: 100%; border-radius: 4px; transition: width 0.5s cubic-bezier(0.34, 1.56, 0.64, 1); }
.dim-fill.good { background: #16a34a; }
.dim-fill.mid { background: #ea580c; }
.dim-fill.low { background: #E24A29; }
.dim-detail { margin-top: 10px; padding: 14px 16px; background: #fff; border-radius: 12px; font-size: 13px; border: 1px solid rgba(0,0,0,0.02); }
.dim-reason { color: #6b7280; margin: 0 0 10px; line-height: 1.6; }
.dim-suggestion { color: #111827; margin: 0; line-height: 1.6; font-weight: 500; }
.fb-btns { margin-left: 8px; }
.fb-btn { border: none; background: #F9FAFB; cursor: pointer; font-size: 13px; padding: 4px 8px; border-radius: 6px; transition: background 0.2s; }
.fb-btn:hover { background: #E5E7EB; }

.top-suggestion { background: #fff; border: 1px solid rgba(226, 74, 41, 0.15); border-radius: 12px; padding: 16px 20px; margin-bottom: 16px; }
.ts-label { font-size: 12px; font-weight: 800; color: #E24A29; margin-bottom: 8px; letter-spacing: 1px; }
.top-suggestion p, .overall { margin: 0; font-size: 14px; line-height: 1.7; color: #374151; }
.overall { color: #6b7280; }

.answer-text { font-size: 14px; line-height: 1.8; color: #374151; white-space: pre-wrap; background: #fff; padding: 16px 20px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.02); }
.cursor { color: #E24A29; animation: blink 1s infinite; }
@keyframes blink { 50% { opacity: 0; } }

.panel-empty { color: #9ca3af; font-size: 14px; text-align: center; padding: 80px 20px; line-height: 1.6; }

/* buttons */
.btn-primary {
  background: #E24A29; color: #fff; border: none; padding: 10px 20px;
  border-radius: 9999px; font-size: 14px; font-weight: 600; cursor: pointer;
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  box-shadow: 0 4px 12px rgba(226, 74, 41, 0.2);
}
.btn-primary:hover { 
  background: #f05431; 
  transform: translateY(-2px);
  box-shadow: 0 8px 16px rgba(226, 74, 41, 0.3);
}
.btn-primary:active { transform: scale(0.97); }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; transform: none; box-shadow: none; }
.score-btn { align-self: flex-start; }
.btn-ghost {
  background: #fff; color: #374151; border: 1px solid #E5E7EB; padding: 8px 16px;
  border-radius: 9999px; font-size: 13px; font-weight: 500; cursor: pointer;
  transition: all 0.2s;
}
.btn-ghost:hover { background: #F9FAFB; border-color: #D1D5DB; }
.btn-ghost:disabled { opacity: 0.5; }

/* 滚动条美化 */
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb {
  background: rgba(156, 163, 175, 0.4);
  border-radius: 9999px;
  border: 2px solid transparent;
  background-clip: content-box;
}
::-webkit-scrollbar-thumb:hover { background-color: rgba(107, 114, 128, 0.6); }

@media (max-width: 768px) {
  .xhs-studio { flex-direction: column; height: auto; }
  .panel-pane { width: 100%; border-left: none; border-top: 1px solid #eee; }
}
</style>
