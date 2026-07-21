<template>
  <div class="xhs-skills">
    <SiteHeader />
    <div class="page">
      <div class="topbar">
        <router-link to="/xhs" class="back">&larr; 返回</router-link>
        <h1>写作 Skill 调试台</h1>
        <p class="sub">创建你自己的写作风格 skill，用它生成文章，再根据产出提意见让 AI 帮你不断完善。调好的 skill 可在写作台直接选用。</p>
      </div>

      <div v-if="error" class="err">{{ error }}</div>

      <div class="layout">
        <!-- 左：skill 列表 + 编辑 -->
        <aside class="left">
          <div class="left-head">
            <span>我的写作 Skill</span>
            <div class="head-btns">
              <button class="mini accent" @click="openScaffold">✨ AI 搭建</button>
              <button class="mini" @click="createSkill">+ 新建</button>
            </div>
          </div>
          <ul class="skill-list">
            <li
              v-for="s in skills" :key="s.id"
              :class="{ active: s.id === currentId }"
              @click="selectSkill(s.id)"
            >
              <span class="s-name">{{ s.name }}</span>
              <button class="s-del" @click.stop="removeSkill(s)">×</button>
            </li>
            <li v-if="!skills.length" class="empty">还没有 skill，点「新建」开始</li>
          </ul>

          <!-- 当前 skill 的多文件编辑 -->
          <div class="editor" v-if="current">
            <input class="name-input" v-model="current.name" @blur="saveMeta" placeholder="skill 名称" />
            <div class="file-tabs">
              <button
                v-for="f in files" :key="f.id"
                class="ftab" :class="{ active: f.id === activeFileId }"
                @click="activeFileId = f.id"
              >
                {{ f.kind === 'main' ? '📄 主文件' : '📎 ' + f.filename }}
                <span v-if="f.kind === 'reference'" class="ftab-x" @click.stop="removeFile(f)">×</span>
              </button>
              <button class="ftab add" @click="addFile">+ 引用</button>
            </div>
            <textarea
              v-if="activeFile"
              v-model="activeFile.body"
              class="file-body"
              placeholder="在这里写你的写作风格规范……主文件里可用 {{ref:文件名}} 引用左侧引用文件"
            ></textarea>
            <div class="editor-actions">
              <button class="mini" :disabled="busy" @click="saveActiveFile">保存文件</button>
            </div>
          </div>
        </aside>

        <!-- 右：调试闭环 -->
        <main class="right" v-if="current">
          <section class="block">
            <h3>1 · 用这个 skill 生成一篇</h3>
            <input v-model="topic" class="topic" placeholder="输入主题，如：平价油皮夏天不脱妆的粉底推荐" />
            <button class="primary" :disabled="busy || !topic.trim()" @click="generate">
              {{ generating ? '生成中…' : '生成文章' }}
            </button>
            <div class="output" v-if="output">{{ output }}</div>
          </section>

          <section class="block" v-if="output">
            <h3>2 · 对产出提修改意见</h3>
            <textarea v-model="feedback" class="feedback" placeholder="例如：开头太平淡，标题不够抓人，正文缺少个人使用感受……"></textarea>
            <button class="primary" :disabled="busy || !feedback.trim()" @click="refine">
              {{ refining ? 'AI 提炼规则中…' : '让 AI 完善 skill' }}
            </button>
          </section>

          <section class="block" v-if="refineResult">
            <h3>3 · AI 的改进建议</h3>
            <div class="changes">
              <div class="changes-title">本次提炼出的规则改动：</div>
              <ul>
                <li v-for="(c, i) in refineResult.changes" :key="i">{{ c }}</li>
              </ul>
            </div>
            <details class="diff">
              <summary>查看改进后的完整主文件</summary>
              <pre>{{ refineResult.newMainBody }}</pre>
            </details>
            <div class="adopt-actions">
              <button class="ghost" @click="refineResult = null">忽略</button>
              <button class="primary" :disabled="busy" @click="adopt">采纳并更新 skill</button>
            </div>
          </section>
        </main>

        <main class="right placeholder" v-else>
          <p>← 选择或新建一个写作 skill 开始调试</p>
        </main>
      </div>
    </div>

    <!-- AI 搭建第一版 skill 弹窗 -->
    <div v-if="scaffoldOpen" class="modal-overlay" @click.self="scaffoldOpen = false">
      <div class="modal">
        <h2>✨ 让 AI 帮我搭第一版 Skill</h2>
        <template v-if="!scaffoldDraft">
          <div class="fg">
            <label>你想要一个什么样的写作 skill？</label>
            <input v-model="scaffoldDesc" placeholder="如：写平价美妆测评，风格真实接地气" />
          </div>
          <div class="fg">
            <label>贴 1~3 篇你认可的范文（可选，贴了更准 —— AI 会逆向提炼它们的套路）</label>
            <textarea v-model="scaffoldSamples" rows="8" placeholder="把你收藏的爆款笔记正文贴进来，多篇之间用一行 --- 分隔"></textarea>
          </div>
          <div class="modal-actions">
            <button class="ghost" @click="scaffoldOpen = false">取消</button>
            <button class="primary" :disabled="scaffolding || (!scaffoldDesc.trim() && !scaffoldSamples.trim())" @click="runScaffold">
              {{ scaffolding ? 'AI 生成中…' : '生成初稿' }}
            </button>
          </div>
        </template>

        <!-- 预览草稿 -->
        <template v-else>
          <div class="draft-meta">
            <div><strong>名称：</strong>{{ scaffoldDraft.suggestedName }}</div>
            <div class="draft-desc">{{ scaffoldDraft.description }}</div>
          </div>
          <div class="fg">
            <label>Skill 主文件初稿（保存后仍可继续编辑/调试）</label>
            <textarea v-model="scaffoldDraft.mainBody" rows="16" class="draft-body"></textarea>
          </div>
          <div class="modal-actions">
            <button class="ghost" @click="scaffoldDraft = null">重新生成</button>
            <button class="primary" :disabled="scaffolding" @click="adoptScaffold">保存为新 Skill</button>
          </div>
        </template>
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

interface Skill { id: string; name: string; description: string; updated_at: string }
interface SkillFile { id: string; skill_id: string; kind: 'main' | 'reference'; filename: string; body: string; sort_order: number }
interface RefineResult { changes: string[]; newMainBody: string }

const skills = ref<Skill[]>([])
const currentId = ref('')
const current = ref<Skill | null>(null)
const files = ref<SkillFile[]>([])
const activeFileId = ref('')

const topic = ref('')
const output = ref('')
const feedback = ref('')
const refineResult = ref<RefineResult | null>(null)

const generating = ref(false)
const refining = ref(false)
const busy = computed(() => generating.value || refining.value)
const error = ref('')

// AI 搭建第一版
interface ScaffoldDraft { suggestedName: string; description: string; mainBody: string }
const scaffoldOpen = ref(false)
const scaffoldDesc = ref('')
const scaffoldSamples = ref('')
const scaffolding = ref(false)
const scaffoldDraft = ref<ScaffoldDraft | null>(null)

function openScaffold() {
  scaffoldOpen.value = true
  scaffoldDesc.value = ''
  scaffoldSamples.value = ''
  scaffoldDraft.value = null
}

async function runScaffold() {
  scaffolding.value = true
  error.value = ''
  try {
    const samples = scaffoldSamples.value
      .split(/\n-{3,}\n/)
      .map(s => s.trim())
      .filter(Boolean)
    const r = await apiPost<ScaffoldDraft>('/api/xhs/skills/scaffold', {
      description: scaffoldDesc.value, samples,
    })
    scaffoldDraft.value = r
  } catch (e: any) {
    error.value = e?.message || '生成失败'
  } finally {
    scaffolding.value = false
  }
}

async function adoptScaffold() {
  if (!scaffoldDraft.value) return
  scaffolding.value = true
  error.value = ''
  try {
    // 建 skill 外壳 → 写入主文件 → 打开它
    const r = await apiPost<{ skill: Skill }>('/api/xhs/skills', {
      name: scaffoldDraft.value.suggestedName, description: scaffoldDraft.value.description,
    })
    await apiPut(`/api/xhs/skills/${r.skill.id}/main`, { body: scaffoldDraft.value.mainBody })
    scaffoldOpen.value = false
    scaffoldDraft.value = null
    await loadSkills()
    await selectSkill(r.skill.id)
  } catch (e: any) {
    error.value = e?.message || '保存失败'
  } finally {
    scaffolding.value = false
  }
}

const activeFile = computed(() => files.value.find(f => f.id === activeFileId.value))

async function loadSkills() {
  try {
    const r = await apiGet<{ skills: Skill[] }>('/api/xhs/skills')
    skills.value = r.skills
  } catch (e: any) { error.value = e?.message || '加载失败' }
}

async function selectSkill(id: string) {
  currentId.value = id
  refineResult.value = null
  output.value = ''
  feedback.value = ''
  try {
    const [s, f] = await Promise.all([
      apiGet<{ skill: Skill }>(`/api/xhs/skills/${id}`),
      apiGet<{ files: SkillFile[] }>(`/api/xhs/skills/${id}/files`),
    ])
    current.value = s.skill
    files.value = f.files
    activeFileId.value = files.value.find(x => x.kind === 'main')?.id || files.value[0]?.id || ''
  } catch (e: any) { error.value = e?.message || '加载失败' }
}

async function createSkill() {
  const name = prompt('给你的写作 skill 起个名字', '我的写作风格')
  if (!name) return
  try {
    const r = await apiPost<{ skill: Skill }>('/api/xhs/skills', { name })
    await loadSkills()
    await selectSkill(r.skill.id)
  } catch (e: any) { error.value = e?.message || '创建失败' }
}

async function removeSkill(s: Skill) {
  if (!confirm(`删除写作 skill「${s.name}」？`)) return
  try {
    await apiDelete(`/api/xhs/skills/${s.id}`)
    if (currentId.value === s.id) { current.value = null; currentId.value = '' }
    await loadSkills()
  } catch (e: any) { error.value = e?.message || '删除失败' }
}

async function saveMeta() {
  if (!current.value) return
  try { await apiPut(`/api/xhs/skills/${current.value.id}`, { name: current.value.name }) }
  catch (e: any) { error.value = e?.message || '保存失败' }
  await loadSkills()
}

async function saveActiveFile() {
  const f = activeFile.value
  if (!f) return
  try { await apiPut(`/api/xhs/skills/files/${f.id}`, { filename: f.filename, body: f.body }) }
  catch (e: any) { error.value = e?.message || '文件保存失败' }
}

async function addFile() {
  if (!current.value) return
  const name = prompt('引用文件名（如 templates.md）')
  if (!name) return
  try {
    const r = await apiPost<{ file: SkillFile }>(`/api/xhs/skills/${current.value.id}/files`, { filename: name, body: '' })
    files.value.push(r.file)
    activeFileId.value = r.file.id
  } catch (e: any) { error.value = e?.message || '新增文件失败' }
}

async function removeFile(f: SkillFile) {
  if (!confirm(`删除引用文件「${f.filename}」？`)) return
  try {
    await apiDelete(`/api/xhs/skills/files/${f.id}`)
    files.value = files.value.filter(x => x.id !== f.id)
    if (activeFileId.value === f.id) activeFileId.value = files.value[0]?.id || ''
  } catch (e: any) { error.value = e?.message || '删除失败' }
}

async function generate() {
  if (!current.value) return
  // 先把当前文件存了，保证生成用的是最新 skill
  await saveActiveFile()
  generating.value = true
  output.value = ''
  refineResult.value = null
  feedback.value = ''
  try {
    const res = await fetch(`/api/xhs/skills/${current.value.id}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
      body: JSON.stringify({ topic: topic.value }),
    })
    if (!res.ok || !res.body) {
      const t = await res.text().catch(() => '')
      throw new Error(t || '生成失败')
    }
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
        try { const { delta } = JSON.parse(m[1]); if (delta) output.value += delta } catch { /* ignore */ }
      }
    }
  } catch (e: any) {
    error.value = e?.message || '生成失败'
  } finally {
    generating.value = false
  }
}

async function refine() {
  if (!current.value) return
  refining.value = true
  error.value = ''
  try {
    const r = await apiPost<RefineResult>(`/api/xhs/skills/${current.value.id}/refine`, {
      output: output.value, feedback: feedback.value,
    })
    refineResult.value = r
  } catch (e: any) {
    error.value = e?.message || '完善失败'
  } finally {
    refining.value = false
  }
}

async function adopt() {
  if (!current.value || !refineResult.value) return
  try {
    await apiPut(`/api/xhs/skills/${current.value.id}/main`, { body: refineResult.value.newMainBody })
    // 刷新文件，让主文件显示新内容
    const f = await apiGet<{ files: SkillFile[] }>(`/api/xhs/skills/${current.value.id}/files`)
    files.value = f.files
    refineResult.value = null
    feedback.value = ''
  } catch (e: any) {
    error.value = e?.message || '采纳失败'
  }
}

onMounted(loadSkills)
</script>

<style scoped>
/* sticky footer：内容矮时把页脚推到视口底部。内容区铺满全屏宽度 */
.xhs-skills { display: flex; flex-direction: column; min-height: 100vh; }
.page { flex: 1; width: 100%; padding: 32px 40px 64px; box-sizing: border-box; }
.topbar { margin-bottom: 24px; }
.back { color: #6b7280; text-decoration: none; font-size: 13px; }
.back:hover { color: #E24A29; }
.topbar h1 { font-size: 28px; font-weight: 800; margin: 8px 0; }
.sub { color: #6b7280; font-size: 14px; line-height: 1.7; max-width: 780px; }
.err { background: #fef2f2; color: #dc2626; padding: 12px 16px; border-radius: 8px; margin-bottom: 16px; }

.layout { display: grid; grid-template-columns: 480px 1fr; gap: 24px; align-items: start; }

/* 左侧 */
.left { background: #fff; border: 1px solid rgba(0,0,0,0.08); border-radius: 14px; padding: 16px; }
.left-head { display: flex; justify-content: space-between; align-items: center; font-weight: 700; margin-bottom: 12px; }
.skill-list { list-style: none; margin: 0 0 16px; padding: 0; }
.skill-list li { display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; border-radius: 8px; cursor: pointer; font-size: 14px; }
.skill-list li:hover { background: #f9fafb; }
.skill-list li.active { background: #fef0eb; color: #E24A29; font-weight: 600; }
.skill-list li.empty { color: #9ca3af; cursor: default; font-size: 13px; }
.s-del { border: none; background: transparent; color: #9ca3af; cursor: pointer; font-size: 16px; }
.s-del:hover { color: #dc2626; }

.editor { border-top: 1px solid #eee; padding-top: 16px; }
.name-input { width: 100%; box-sizing: border-box; border: 1px solid #e5e7eb; border-radius: 8px; padding: 8px 12px; font-weight: 600; margin-bottom: 12px; }
.file-tabs { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
.ftab { border: 1px solid #e5e7eb; background: #fff; border-radius: 8px; padding: 6px 10px; font-size: 12px; cursor: pointer; }
.ftab.active { background: #111; color: #fff; border-color: #111; }
.ftab.add { border-style: dashed; color: #6b7280; }
.ftab-x { margin-left: 6px; color: #f87171; }
.file-body { width: 100%; box-sizing: border-box; min-height: 300px; resize: vertical; border: 1px solid #e5e7eb; border-radius: 10px; padding: 12px; font-family: var(--font-mono, monospace); font-size: 13px; line-height: 1.7; }
.editor-actions { display: flex; justify-content: flex-end; margin-top: 8px; }

/* 右侧 */
.right { display: flex; flex-direction: column; gap: 20px; }
.right.placeholder { align-items: center; justify-content: center; color: #9ca3af; min-height: 300px; }
.block { background: #fff; border: 1px solid rgba(0,0,0,0.08); border-radius: 14px; padding: 20px 24px; }
.block h3 { margin: 0 0 14px; font-size: 16px; font-weight: 700; }
.topic { width: 100%; box-sizing: border-box; border: 1px solid #e5e7eb; border-radius: 10px; padding: 12px 14px; font-size: 14px; margin-bottom: 12px; }
.feedback { width: 100%; box-sizing: border-box; min-height: 90px; resize: vertical; border: 1px solid #e5e7eb; border-radius: 10px; padding: 12px 14px; font-size: 14px; line-height: 1.6; margin-bottom: 12px; }
.output { margin-top: 14px; background: #f9fafb; border: 1px solid #eee; border-radius: 10px; padding: 16px; white-space: pre-wrap; line-height: 1.8; font-size: 14px; }

.mini { border: 1px solid #e5e7eb; background: #fff; border-radius: 8px; padding: 6px 12px; font-size: 13px; cursor: pointer; }
.mini:hover { border-color: #E24A29; color: #E24A29; }
.primary { background: #E24A29; color: #fff; border: none; border-radius: 10px; padding: 10px 20px; font-weight: 600; cursor: pointer; }
.primary:disabled { opacity: 0.5; cursor: not-allowed; }
.ghost { background: transparent; border: 1px solid #e5e7eb; border-radius: 10px; padding: 10px 20px; cursor: pointer; }

.changes { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 10px; padding: 14px 18px; margin-bottom: 12px; }
.changes-title { font-weight: 600; margin-bottom: 8px; font-size: 13px; color: #166534; }
.changes ul { margin: 0; padding-left: 20px; line-height: 1.8; font-size: 14px; }
.diff summary { cursor: pointer; color: #6b7280; font-size: 13px; margin-bottom: 8px; }
.diff pre { background: #f9fafb; border: 1px solid #eee; border-radius: 8px; padding: 14px; max-height: 320px; overflow: auto; white-space: pre-wrap; font-size: 12px; line-height: 1.7; }
.adopt-actions { display: flex; justify-content: flex-end; gap: 12px; }

.head-btns { display: flex; gap: 8px; }
.mini.accent { border-color: #E24A29; color: #E24A29; }
.mini.accent:hover { background: #fef0eb; }

/* 弹窗 */
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.45); display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 24px; }
.modal { background: #fff; border-radius: 16px; padding: 28px 32px; width: 100%; max-width: 720px; max-height: 90vh; overflow-y: auto; }
.modal h2 { margin: 0 0 20px; font-size: 20px; font-weight: 800; }
.fg { margin-bottom: 18px; }
.fg label { display: block; font-size: 13px; font-weight: 600; color: #4b5563; margin-bottom: 8px; }
.fg input, .fg textarea { width: 100%; box-sizing: border-box; border: 1px solid #e5e7eb; border-radius: 10px; padding: 12px 14px; font-size: 14px; line-height: 1.6; }
.fg textarea { resize: vertical; font-family: inherit; }
.draft-body { font-family: var(--font-mono, monospace); font-size: 13px; }
.draft-meta { background: #f9fafb; border: 1px solid #eee; border-radius: 10px; padding: 12px 16px; margin-bottom: 16px; font-size: 14px; }
.draft-desc { color: #6b7280; margin-top: 4px; font-size: 13px; }
.modal-actions { display: flex; justify-content: flex-end; gap: 12px; margin-top: 8px; }

@media (max-width: 900px) {
  .layout { grid-template-columns: 1fr; }
}
</style>
