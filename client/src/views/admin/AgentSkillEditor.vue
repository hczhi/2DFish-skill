<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { apiGet, apiPut, apiPost, apiDelete } from '../../lib/api'

interface SkillFile { id: string; path: string; body: string; executable: number; updated_at: string }
interface Skill { id: string; name: string; label: string; description: string; source: string; enabled: number }
interface Issue { level: 'error' | 'warning'; message: string }
interface Version { id: string; version: number; note: string; created_by: string; created_at: string }
interface Bot { id: string; name: string; agent_id: string }
interface Deployment { id: string; bot_id: string; bot_name: string; version: number; status: string }
interface Variable { id: string; key: string; value: string; is_secret: number }

const route = useRoute()
const router = useRouter()
const skillId = route.params.id as string

const skill = ref<Skill | null>(null)
const files = ref<SkillFile[]>([])
const issues = ref<Issue[]>([])
const versions = ref<Version[]>([])
const deployments = ref<Deployment[]>([])
const bots = ref<Bot[]>([])
const variables = ref<Variable[]>([])

const activePath = ref('')
const draft = ref('')
const dirty = ref(false)
const error = ref('')
const notice = ref('')
const saving = ref(false)

// 导出
const exportBotId = ref('')
const exportVersionNum = ref<number | 0>(0)
const exportResult = ref<{
  skill_name: string; version: number
  files: { path: string; body: string }[]
  injected: string[]; unresolved: string[]; manual_steps: string[]
} | null>(null)

// 变量
const newVarKey = ref('')
const newVarValue = ref('')
const newVarSecret = ref(true)

const errorCount = computed(() => issues.value.filter((i) => i.level === 'error').length)
const activeFile = computed(() => files.value.find((f) => f.path === activePath.value))

async function load() {
  error.value = ''
  try {
    const r = await apiGet<{
      skill: Skill; files: SkillFile[]; versions: Version[]
      deployments: Deployment[]; issues: Issue[]
    }>(`/api/admin/agent-skills/skills/${skillId}`)
    skill.value = r.skill
    files.value = r.files
    versions.value = r.versions
    deployments.value = r.deployments
    issues.value = r.issues
    if (!activePath.value || !r.files.some((f) => f.path === activePath.value)) {
      select(r.files.find((f) => f.path === 'SKILL.md')?.path || r.files[0]?.path || '')
    }
    const b = await apiGet<{ bots: Bot[] }>('/api/admin/agent-skills/bots')
    bots.value = b.bots
    if (!exportBotId.value && b.bots.length) exportBotId.value = b.bots[0].id
    if (exportBotId.value) await loadVariables()
  } catch (e: any) {
    error.value = e?.message || '加载失败'
  }
}

async function loadVariables() {
  if (!exportBotId.value) { variables.value = []; return }
  try {
    const r = await apiGet<{ variables: Variable[] }>(
      `/api/admin/agent-skills/bots/${exportBotId.value}/variables`
    )
    variables.value = r.variables
  } catch { variables.value = [] }
}

function select(path: string) {
  // 未保存就切文件会丢内容，而用户完全看不出来丢了什么。
  if (dirty.value && !confirm('当前文件有未保存的修改，切换会丢掉。继续？')) return
  activePath.value = path
  draft.value = files.value.find((f) => f.path === path)?.body ?? ''
  dirty.value = false
}

async function saveFile() {
  if (!activePath.value) return
  saving.value = true
  error.value = ''
  try {
    await apiPut(`/api/admin/agent-skills/skills/${skillId}/files`, {
      path: activePath.value,
      body: draft.value,
      executable: activeFile.value?.executable === 1,
    })
    dirty.value = false
    notice.value = `已保存 ${activePath.value}`
    await load()
  } catch (e: any) {
    error.value = e?.message || '保存失败'
  } finally {
    saving.value = false
  }
}

async function addFile() {
  const path = prompt('新文件路径（相对技能根目录），如 scripts/foo.py 或 references/bar.md')
  if (!path) return
  try {
    await apiPut(`/api/admin/agent-skills/skills/${skillId}/files`, { path, body: '' })
    await load()
    select(path.replace(/^\.\//, ''))
  } catch (e: any) {
    error.value = e?.message || '新增失败'
  }
}

async function removeFile(f: SkillFile) {
  if (f.path === 'SKILL.md') {
    error.value = 'SKILL.md 不能删 —— 没有它 aily 不会加载这个技能。'
    return
  }
  if (!confirm(`删除 ${f.path}？`)) return
  try {
    await apiDelete(`/api/admin/agent-skills/skills/${skillId}/files/${f.id}`)
    await load()
  } catch (e: any) {
    error.value = e?.message || '删除失败'
  }
}

async function freeze() {
  const note = prompt('这个版本的备注（可留空）：', '') ?? ''
  error.value = ''
  try {
    const r = await apiPost<{ version: number }>(`/api/admin/agent-skills/skills/${skillId}/versions`, { note })
    notice.value = `已冻结 v${r.version}`
    await load()
  } catch (e: any) {
    error.value = e?.message || '冻结失败'
  }
}

async function doExport() {
  error.value = ''
  exportResult.value = null
  try {
    const r = await apiPost<any>(`/api/admin/agent-skills/skills/${skillId}/export`, {
      bot_id: exportBotId.value || null,
      version: exportVersionNum.value || undefined,
    })
    exportResult.value = r
    await load()
  } catch (e: any) {
    error.value = e?.message || '导出失败'
  }
}

function downloadFile(path: string, body: string) {
  const blob = new Blob([body], { type: 'text/plain;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = path.split('/').pop() || 'file.txt'
  a.click()
  URL.revokeObjectURL(a.href)
}

async function addVariable() {
  const key = newVarKey.value.trim()
  if (!key || !exportBotId.value) return
  try {
    await apiPost(`/api/admin/agent-skills/bots/${exportBotId.value}/variables`, {
      key, value: newVarValue.value, is_secret: newVarSecret.value,
    })
    newVarKey.value = ''
    newVarValue.value = ''
    await loadVariables()
  } catch (e: any) {
    error.value = e?.message || '保存失败'
  }
}

async function removeVariable(v: Variable) {
  if (!confirm(`删除变量 ${v.key}？`)) return
  try {
    await apiDelete(`/api/admin/agent-skills/variables/${v.id}`)
    await loadVariables()
  } catch (e: any) {
    error.value = e?.message || '删除失败'
  }
}

onMounted(load)
</script>

<template>
  <div v-if="skill">
    <div class="page-header">
      <div>
        <h1>{{ skill.label || skill.name }}</h1>
        <code class="mono">{{ skill.name }}</code>
      </div>
      <button class="btn-sm" @click="router.push({ name: 'admin-agent-skills' })">&larr; 返回列表</button>
    </div>

    <div v-if="error" class="err">{{ error }}</div>
    <div v-if="notice" class="ok">{{ notice }}</div>

    <!-- 校验结果放在最上面：error 会挡住冻结，用户需要先看到它 -->
    <section class="card" v-if="issues.length">
      <h2>校验</h2>
      <ul class="issues">
        <li v-for="(i, idx) in issues" :key="idx" :class="i.level">
          <strong>{{ i.level === 'error' ? '必须修' : '提醒' }}</strong>{{ i.message }}
        </li>
      </ul>
      <p v-if="errorCount" class="desc">有 {{ errorCount }} 项必须修的问题，修完才能冻结版本。</p>
    </section>
    <section class="card ok-card" v-else>
      校验通过，可以冻结版本了。
    </section>

    <!-- 编辑器 -->
    <section class="card">
      <div class="editor-head">
        <h2>文件</h2>
        <button class="btn-sm" @click="addFile">+ 新文件</button>
      </div>
      <div class="editor">
        <ul class="file-list">
          <li v-for="f in files" :key="f.id" :class="{ active: f.path === activePath }">
            <button class="file-btn" @click="select(f.path)">
              {{ f.path }}<span v-if="f.executable" class="exec" title="导出时带可执行位">x</span>
            </button>
            <button class="del" @click="removeFile(f)" title="删除">×</button>
          </li>
        </ul>
        <div class="editor-pane">
          <div class="pane-head">
            <code>{{ activePath || '（没有文件）' }}</code>
            <span v-if="dirty" class="dirty">未保存</span>
            <button class="btn-primary" :disabled="!dirty || saving" @click="saveFile">
              {{ saving ? '保存中…' : '保存' }}
            </button>
          </div>
          <textarea v-model="draft" @input="dirty = true" spellcheck="false"
            placeholder="选一个文件开始编辑"></textarea>
        </div>
      </div>
    </section>

    <!-- 版本 -->
    <section class="card">
      <div class="editor-head">
        <h2>版本</h2>
        <button class="btn-primary" :disabled="errorCount > 0" @click="freeze">冻结当前内容为新版本</button>
      </div>
      <p class="desc">
        版本是当时全部文件的完整快照。之后继续编辑不会改动已冻结的版本，
        所以「线上跑的是哪份内容」永远查得到。
      </p>
      <table class="hc-table" v-if="versions.length">
        <thead><tr><th>版本</th><th>备注</th><th>冻结人</th><th>时间</th></tr></thead>
        <tbody>
          <tr v-for="v in versions" :key="v.id">
            <td><strong>v{{ v.version }}</strong></td>
            <td>{{ v.note || '—' }}</td>
            <td>{{ v.created_by || '—' }}</td>
            <td>{{ v.created_at?.slice(0, 16).replace('T', ' ') }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else class="desc">还没有冻结过版本。</p>
    </section>

    <!-- 导出变量 -->
    <section class="card">
      <h2>导出变量（按账号）</h2>
      <p class="desc">
        技能文件里写 <code v-pre>{{SERVER_API_TOKEN}}</code> 这样的占位符，
        真值存在这里，只在导出那一刻替进去。这样把技能复制给另一个企业时，
        不会把上一个企业的密钥一起带过去。
      </p>
      <div class="inline-form">
        <select v-model="exportBotId" @change="loadVariables">
          <option value="">（选账号）</option>
          <option v-for="b in bots" :key="b.id" :value="b.id">{{ b.name }}</option>
        </select>
      </div>
      <template v-if="exportBotId">
        <div class="inline-form">
          <input v-model="newVarKey" placeholder="变量名，如 SERVER_API_TOKEN" />
          <input v-model="newVarValue" placeholder="值" class="wide" />
          <label class="chk"><input type="checkbox" v-model="newVarSecret" /> 敏感（列表里脱敏显示）</label>
          <button class="btn-primary" @click="addVariable">保存</button>
        </div>
        <table class="hc-table" v-if="variables.length">
          <thead><tr><th>变量名</th><th>值</th><th>操作</th></tr></thead>
          <tbody>
            <tr v-for="v in variables" :key="v.id">
              <td><code class="mono">{{ v.key }}</code></td>
              <td>{{ v.value || '（空）' }}</td>
              <td class="table-actions"><button class="btn-danger" @click="removeVariable(v)">删除</button></td>
            </tr>
          </tbody>
        </table>
        <p v-else class="desc">这个账号还没有变量。</p>
      </template>
    </section>

    <!-- 导出 -->
    <section class="card">
      <h2>导出技能包</h2>
      <div class="inline-form">
        <select v-model="exportBotId" @change="loadVariables">
          <option value="">（不注入变量）</option>
          <option v-for="b in bots" :key="b.id" :value="b.id">{{ b.name }}</option>
        </select>
        <select v-model.number="exportVersionNum">
          <option :value="0">最新（没有则自动冻结一个）</option>
          <option v-for="v in versions" :key="v.id" :value="v.version">v{{ v.version }}</option>
        </select>
        <button class="btn-primary" :disabled="errorCount > 0" @click="doExport">导出</button>
      </div>

      <div v-if="exportResult" class="export-result">
        <div v-if="exportResult.unresolved.length" class="warn-box">
          <strong>这些占位符没有对应的变量值，会原样留在文件里：</strong>
          {{ exportResult.unresolved.join('、') }}
          <br />脚本会把 <code v-pre>{{XXX}}</code> 当成字面量用（比如拿它当密钥去调接口，报出来是 401）。
          先在上面配好变量再导出。
        </div>
        <p v-if="exportResult.injected.length" class="desc">
          已注入：{{ exportResult.injected.join('、') }}
        </p>

        <div class="steps">
          <strong>接下来（这几步没法自动，飞书没有技能上传 API）：</strong>
          <ol><li v-for="(s, i) in exportResult.manual_steps" :key="i">{{ s }}</li></ol>
        </div>

        <h3>v{{ exportResult.version }} · 目录 {{ exportResult.skill_name }}/</h3>
        <ul class="export-files">
          <li v-for="f in exportResult.files" :key="f.path">
            <code>{{ exportResult.skill_name }}/{{ f.path }}</code>
            <button class="btn-sm" @click="downloadFile(f.path, f.body)">下载</button>
          </li>
        </ul>
      </div>
    </section>

    <!-- 部署 -->
    <section class="card" v-if="deployments.length">
      <h2>这个技能的部署</h2>
      <table class="hc-table">
        <thead><tr><th>账号</th><th>版本</th><th>状态</th></tr></thead>
        <tbody>
          <tr v-for="d in deployments" :key="d.id">
            <td>{{ d.bot_name }}</td>
            <td>v{{ d.version }}</td>
            <td>{{ d.status === 'live' ? '已上线' : d.status === 'stale' ? '线上是旧版' : '已导出，等待上传' }}</td>
          </tr>
        </tbody>
      </table>
      <p class="desc">在「飞书 Skill」列表页可以确认上线状态。</p>
    </section>
  </div>
  <div v-else-if="error" class="err">{{ error }}</div>
  <div v-else>加载中…</div>
</template>

<style scoped>
.page-header { display: flex; justify-content: space-between; align-items: flex-start; }
.mono { background: #f3f4f6; padding: 2px 8px; border-radius: 4px; font-size: 13px; }
.err { background: #fef2f2; color: #dc2626; padding: 12px 16px; border-radius: 8px; margin-bottom: 16px; }
.ok { background: #f0fdf4; color: #15803d; padding: 12px 16px; border-radius: 8px; margin-bottom: 16px; }
.card { background: #fff; border: 1px solid rgba(0,0,0,0.06); border-radius: 12px; padding: 24px; margin-bottom: 28px; }
.card h2 { font-size: 19px; font-weight: 700; margin: 0 0 12px; }
.card h3 { font-size: 15px; margin: 16px 0 8px; }
.ok-card { background: #f0fdf4; border-color: #86efac; color: #15803d; }
.desc { color: #9ca3af; font-size: 13px; line-height: 1.7; }
.issues { list-style: none; padding: 0; margin: 0; font-size: 14px; }
.issues li { padding: 8px 12px; border-radius: 6px; margin-bottom: 6px; line-height: 1.6; }
.issues li.error { background: #fef2f2; color: #991b1b; }
.issues li.warning { background: #fffbeb; color: #92400e; }
.issues strong { margin-right: 8px; }
.editor-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.editor-head h2 { margin: 0; }
.editor { display: flex; gap: 16px; align-items: stretch; }
.file-list { list-style: none; margin: 0; padding: 0; width: 240px; flex-shrink: 0;
  border: 1px solid #e5e7eb; border-radius: 8px; overflow: auto; max-height: 520px; }
.file-list li { display: flex; align-items: center; border-bottom: 1px solid #f3f4f6; }
.file-list li.active { background: #eff6ff; }
.file-btn { flex: 1; text-align: left; border: 0; background: none; padding: 9px 12px;
  font-size: 13px; font-family: ui-monospace, monospace; cursor: pointer; }
.exec { color: #059669; font-size: 10px; margin-left: 6px; }
.del { border: 0; background: none; color: #d1d5db; cursor: pointer; padding: 0 10px; font-size: 16px; }
.del:hover { color: #dc2626; }
.editor-pane { flex: 1; display: flex; flex-direction: column; }
.pane-head { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
.pane-head code { flex: 1; font-size: 13px; color: #374151; }
.dirty { color: #d97706; font-size: 12px; }
textarea { width: 100%; min-height: 480px; border: 1px solid #e5e7eb; border-radius: 8px;
  padding: 12px; font-family: ui-monospace, monospace; font-size: 13px; line-height: 1.6; resize: vertical; }
.inline-form { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 10px; }
.inline-form input, .inline-form select { border: 1px solid #e5e7eb; border-radius: 8px;
  padding: 8px 12px; font-size: 14px; min-width: 200px; background: #fff; }
.inline-form input.wide { min-width: 300px; flex: 1; }
.chk { font-size: 13px; color: #6b7280; display: flex; align-items: center; gap: 5px; }
.warn-box { background: #fef2f2; border: 1px solid #fca5a5; border-radius: 8px;
  padding: 12px 16px; font-size: 13px; line-height: 1.7; color: #991b1b; margin-bottom: 12px; }
.steps { background: #f9fafb; border-radius: 8px; padding: 12px 20px; font-size: 13px; line-height: 1.8; }
.steps ol { margin: 6px 0 0; padding-left: 20px; }
.export-files { list-style: none; padding: 0; margin: 0; font-size: 13px; }
.export-files li { display: flex; align-items: center; gap: 12px; padding: 6px 0; border-bottom: 1px solid #f3f4f6; }
.export-files code { flex: 1; font-family: ui-monospace, monospace; }
</style>
