<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { apiGet, apiPost, apiDelete } from '../../lib/api'

interface AgentSkill {
  id: string
  name: string
  label: string
  description: string
  source: string
  enabled: boolean | number
  file_count: number
  latest_version: number
  updated_at: string
}
interface Bot { id: string; name: string; agent_id: string; note: string; enabled: number }
interface Deployment {
  id: string; skill_id: string; bot_id: string; bot_name: string
  version: number; status: 'exported' | 'live' | 'stale'
  exported_at: string | null; confirmed_at: string | null
}

const router = useRouter()
const skills = ref<AgentSkill[]>([])
const bots = ref<Bot[]>([])
const deployments = ref<Deployment[]>([])
const loading = ref(false)
const error = ref('')
const notice = ref('')

// 新建
const newName = ref('')
// 导入
interface OneImport {
  skill: AgentSkill
  files: string[]
  skipped: { path: string; reason: string }[]
  issues?: { level: string; message: string }[]
}
const importDir = ref('')
const importing = ref(false)
const inspecting = ref(false)
// 先看看目录里有几个技能：一个目录可能是一个技能，也可能是一个套件
// （根目录一个总入口 + 每个子目录又是独立技能）。两种导法结果差很远。
const inspectResult = ref<{ rel: string; name: string; exists: boolean }[] | null>(null)
const importResult = ref<{ mode: 'single' | 'suite'; skills: OneImport[]; failed: { rel: string; name: string; reason: string }[] } | null>(null)
// 账号
const newBotName = ref('')
const newBotAgentId = ref('')

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [s, b, d] = await Promise.all([
      apiGet<{ skills: AgentSkill[] }>('/api/admin/agent-skills/skills'),
      apiGet<{ bots: Bot[] }>('/api/admin/agent-skills/bots'),
      apiGet<{ deployments: Deployment[] }>('/api/admin/agent-skills/deployments'),
    ])
    skills.value = s.skills
    bots.value = b.bots
    deployments.value = d.deployments
  } catch (e: any) {
    error.value = e?.message || '加载失败'
  } finally {
    loading.value = false
  }
}

async function createSkill() {
  const name = newName.value.trim()
  if (!name) return
  error.value = ''
  try {
    const { skill } = await apiPost<{ skill: AgentSkill }>('/api/admin/agent-skills/skills', { name })
    newName.value = ''
    router.push({ name: 'admin-agent-skill-edit', params: { id: skill.id } })
  } catch (e: any) {
    error.value = e?.message || '创建失败'
  }
}

async function doInspect() {
  const dir = importDir.value.trim()
  if (!dir) return
  inspecting.value = true
  error.value = ''
  inspectResult.value = null
  importResult.value = null
  try {
    const r = await apiPost<{ skills: { rel: string; name: string; exists: boolean }[] }>(
      '/api/admin/agent-skills/import/inspect', { dir }
    )
    inspectResult.value = r.skills
  } catch (e: any) {
    error.value = e?.message || '看不了这个目录'
  } finally {
    inspecting.value = false
  }
}

async function doImport() {
  const dir = importDir.value.trim()
  if (!dir) return
  importing.value = true
  error.value = ''
  importResult.value = null
  try {
    const r = await apiPost<any>('/api/admin/agent-skills/import/directory', { dir })
    // 跳过的文件一定要显示出来：静默少一个脚本的技能上传后能被触发，
    // 但会报「找不到文件」，那时候很难想到是导入时漏了。
    importResult.value =
      r.mode === 'suite'
        ? { mode: 'suite', skills: r.skills, failed: r.failed }
        : { mode: 'single', skills: [{ skill: r.skill, files: r.files, skipped: r.skipped, issues: r.issues }], failed: [] }
    const ok = importResult.value.skills.length
    const bad = importResult.value.failed.length
    notice.value =
      r.mode === 'suite'
        ? `套件：导入了 ${ok} 个技能${bad ? `，${bad} 个没进来（见下）` : ''}`
        : `已导入「${r.skill.name}」，共 ${r.files.length} 个文件`
    inspectResult.value = null
    importDir.value = ''
    await load()
  } catch (e: any) {
    error.value = e?.message || '导入失败'
  } finally {
    importing.value = false
  }
}

async function removeSkill(s: AgentSkill) {
  if (!confirm(`删除技能「${s.name}」？已上传到飞书的那份不会被删除，需要你自己去智能体后台删。`)) return
  try {
    await apiDelete(`/api/admin/agent-skills/skills/${s.id}`)
    await load()
  } catch (e: any) {
    error.value = e?.message || '删除失败'
  }
}

async function copy(s: AgentSkill) {
  const name = prompt(`复制「${s.name}」，新技能名（小写字母/数字/连字符）：`, `${s.name}-copy`)
  if (!name) return
  try {
    await apiPost(`/api/admin/agent-skills/skills/${s.id}/copy`, { name })
    await load()
  } catch (e: any) {
    error.value = e?.message || '复制失败'
  }
}

async function addBot() {
  const name = newBotName.value.trim()
  if (!name) return
  try {
    await apiPost('/api/admin/agent-skills/bots', { name, agent_id: newBotAgentId.value.trim() })
    newBotName.value = ''
    newBotAgentId.value = ''
    await load()
  } catch (e: any) {
    error.value = e?.message || '添加失败'
  }
}

async function removeBot(b: Bot) {
  if (!confirm(`删除账号「${b.name}」？它的导出变量和部署记录会一起删掉。`)) return
  try {
    await apiDelete(`/api/admin/agent-skills/bots/${b.id}`)
    await load()
  } catch (e: any) {
    error.value = e?.message || '删除失败'
  }
}

async function confirmDeploy(d: Deployment) {
  if (!confirm(`确认「${d.bot_name}」已经上传了 v${d.version}？只有你真的在智能体后台传过才点确认。`)) return
  try {
    await apiPost(`/api/admin/agent-skills/deployments/${d.id}/confirm`, {})
    await load()
  } catch (e: any) {
    error.value = e?.message || '确认失败'
  }
}

const STATUS_LABEL: Record<string, string> = {
  exported: '已导出（等待人工上传）',
  live: '已上线',
  stale: '线上是旧版（技能之后又改过）',
}

function skillName(id: string) {
  return skills.value.find((s) => s.id === id)?.name || '(已删除)'
}

onMounted(load)
</script>

<template>
  <div>
    <div class="page-header">
      <h1>飞书 Skill</h1>
    </div>

    <!-- 这段话是这个页面最重要的内容：飞书没有技能写入 API，
         「发布」必然有人工的一步。不写清楚，用户点完导出就以为生效了。 -->
    <div class="notice-box">
      <strong>发布流程（飞书没有技能上传 API，最后一步必须人工）</strong>
      <ol>
        <li>在这里编辑技能 → 校验通过 → <em>冻结一个版本</em>（记录这一刻的完整内容）</li>
        <li>选一个账号<em>导出</em>（会把 <code v-pre>{{变量}}</code> 替换成该企业的真值）</li>
        <li>按导出的目录结构打包成 zip，到<em>飞书智能体（aily）后台 → 技能 → 上传技能包</em></li>
        <li>回到这里点「确认已上线」。不点的话，部署记录会一直停在「已导出」</li>
      </ol>
      我们无法从飞书那边读到「技能到底上传了没有」，所以第 4 步的确认只能靠你。
      <p class="sub">
        另外：技能只是「会做什么」，智能体的<em>档案</em>（角色定位 / 工作职责 / 行为约束）
        是在 aily 控制台里单独手填的，不在技能包里，导出和上传都带不走它。
        改技能能力时记得同步改档案，否则智能体不知道自己多了一项本事。
      </p>
    </div>

    <div v-if="error" class="err">{{ error }}</div>
    <div v-if="notice" class="ok">{{ notice }}</div>

    <!-- 技能列表 -->
    <section class="card">
      <h2>技能</h2>
      <div class="inline-form">
        <input v-model="newName" placeholder="新技能名，如 meeting-notes" @keyup.enter="createSkill" />
        <button class="btn-primary" @click="createSkill">+ 新建</button>
      </div>
      <p class="desc">技能名同时是 aily 里的目录名，只能用小写字母、数字和连字符。</p>

      <div v-if="loading">加载中…</div>
      <table class="hc-table" v-else-if="skills.length">
        <thead>
          <tr><th>技能</th><th>文件</th><th>最新版本</th><th>来源</th><th>更新时间</th><th>操作</th></tr>
        </thead>
        <tbody>
          <tr v-for="s in skills" :key="s.id">
            <td>
              <strong>{{ s.label || s.name }}</strong>
              <code class="mono">{{ s.name }}</code>
              <br /><span class="desc">{{ s.description }}</span>
            </td>
            <td>{{ s.file_count }}</td>
            <td>{{ s.latest_version ? 'v' + s.latest_version : '未冻结' }}</td>
            <td><span class="hc-badge hc-badge-gray">{{ s.source }}</span></td>
            <td>{{ s.updated_at?.slice(0, 10) }}</td>
            <td class="table-actions">
              <button class="btn-sm" @click="router.push({ name: 'admin-agent-skill-edit', params: { id: s.id } })">编辑</button>
              <button class="btn-sm" @click="copy(s)">复制</button>
              <button class="btn-danger" @click="removeSkill(s)">删除</button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else class="desc">还没有技能。可以新建一个，或从服务器目录导入。</p>
    </section>

    <!-- 导入 -->
    <section class="card">
      <h2>从目录导入</h2>
      <p class="desc">
        路径是<strong>服务器上</strong>的目录（不是你这台电脑上的），目录里必须有 SKILL.md。
        只导入文本文件（.md/.py/.json/.txt/.yaml/.sh），跳过的会在下面列出来。
        目录里有多个 SKILL.md 时按<strong>套件</strong>导入 —— 每个 SKILL.md 一个独立技能。
      </p>
      <div class="inline-form">
        <input v-model="importDir" placeholder="/Users/xxx/Downloads/director-diary-skills" class="wide"
          @keyup.enter="doInspect" />
        <button class="btn-sm" :disabled="inspecting" @click="doInspect">
          {{ inspecting ? '查看中…' : '先看看有几个' }}
        </button>
        <button class="btn-primary" :disabled="importing" @click="doImport">
          {{ importing ? '导入中…' : '导入' }}
        </button>
      </div>

      <!-- 导入前的预览：让用户看到自己要导的是一个技能还是一套 -->
      <div v-if="inspectResult" class="inspect">
        <p>
          这个目录里有 <strong>{{ inspectResult.length }}</strong> 个技能<span
            v-if="inspectResult.length > 1">（套件，会分别建成 {{ inspectResult.length }} 条记录）</span>：
        </p>
        <ul>
          <li v-for="s in inspectResult" :key="s.rel">
            <code>{{ s.rel }}</code> → <strong>{{ s.name || '(SKILL.md 里没写 name)' }}</strong>
            <span v-if="s.exists" class="dup">已存在，这一个会被跳过</span>
          </li>
        </ul>
      </div>

      <div v-if="importResult" class="import-result">
        <div v-if="importResult.failed.length" class="skipped">
          <strong>{{ importResult.failed.length }} 个技能没有导进来</strong>（其余的已经导好了，不用重来）：
          <ul>
            <li v-for="f in importResult.failed" :key="f.rel">
              <code>{{ f.rel }}</code> {{ f.name ? `（${f.name}）` : '' }} — {{ f.reason }}
            </li>
          </ul>
        </div>
        <div v-for="one in importResult.skills" :key="one.skill.id" class="one-import">
          <p>
            <strong>{{ one.skill.name }}</strong> — {{ one.files.length }} 个文件
            <span v-if="(one.issues || []).some((i) => i.level === 'error')" class="dup">校验有 error，需要修</span>
          </p>
          <div v-if="one.skipped.length" class="skipped">
            <strong>跳过了 {{ one.skipped.length }} 项</strong>（不在这个技能包里，需要的话手动补）：
            <ul>
              <li v-for="sk in one.skipped" :key="sk.path">
                <code>{{ sk.path }}</code> — {{ sk.reason }}
              </li>
            </ul>
          </div>
          <ul v-if="(one.issues || []).length" class="issue-list">
            <li v-for="(i, idx) in one.issues" :key="idx" :class="i.level">
              [{{ i.level === 'error' ? '必须修' : '提醒' }}] {{ i.message }}
            </li>
          </ul>
        </div>
      </div>
    </section>

    <!-- 账号 -->
    <section class="card">
      <h2>飞书账号（企业）</h2>
      <p class="desc">
        一个账号 = 一个飞书企业里的一个智能体。同一个技能发布到多个企业时，
        导出变量按账号分别注入 —— 所以 A 企业的密钥不会进到给 B 的包里。
      </p>
      <div class="inline-form">
        <input v-model="newBotName" placeholder="账号名称，如「想象数科」" />
        <input v-model="newBotAgentId" placeholder="智能体 id（agent_xxx，可留空）" class="wide" />
        <button class="btn-primary" @click="addBot">+ 添加</button>
      </div>
      <table class="hc-table" v-if="bots.length">
        <thead><tr><th>名称</th><th>智能体 id</th><th>操作</th></tr></thead>
        <tbody>
          <tr v-for="b in bots" :key="b.id">
            <td><strong>{{ b.name }}</strong></td>
            <td><code class="mono">{{ b.agent_id || '—' }}</code></td>
            <td class="table-actions">
              <button class="btn-danger" @click="removeBot(b)">删除</button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else class="desc">还没有账号。导出技能包时需要选一个账号来注入变量。</p>
    </section>

    <!-- 部署记录 -->
    <section class="card">
      <h2>部署记录</h2>
      <table class="hc-table" v-if="deployments.length">
        <thead>
          <tr><th>技能</th><th>账号</th><th>版本</th><th>状态</th><th>导出时间</th><th>操作</th></tr>
        </thead>
        <tbody>
          <tr v-for="d in deployments" :key="d.id">
            <td><code class="mono">{{ skillName(d.skill_id) }}</code></td>
            <td>{{ d.bot_name }}</td>
            <td>v{{ d.version }}</td>
            <td>
              <span class="hc-badge" :class="{
                'hc-badge-green': d.status === 'live',
                'hc-badge-gray': d.status === 'exported',
                'hc-badge-red': d.status === 'stale',
              }">{{ STATUS_LABEL[d.status] }}</span>
            </td>
            <td>{{ d.exported_at?.slice(0, 16).replace('T', ' ') }}</td>
            <td class="table-actions">
              <button v-if="d.status !== 'live'" class="btn-sm" @click="confirmDeploy(d)">确认已上线</button>
              <span v-else class="desc">{{ d.confirmed_at?.slice(0, 10) }} 确认</span>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else class="desc">还没有导出过任何技能。</p>
    </section>
  </div>
</template>

<style scoped>
.notice-box {
  background: #fffbeb; border: 1px solid #fcd34d; border-radius: 10px;
  padding: 16px 20px; margin-bottom: 24px; font-size: 14px; line-height: 1.8; color: #78350f;
}
.notice-box ol { margin: 8px 0; padding-left: 22px; }
.notice-box em { font-style: normal; font-weight: 600; }
.notice-box code { background: #fef3c7; padding: 1px 5px; border-radius: 4px; }
.notice-box .sub { margin: 10px 0 0; padding-top: 8px; border-top: 1px solid #fde68a; }
.err { background: #fef2f2; color: #dc2626; padding: 12px 16px; border-radius: 8px; margin-bottom: 16px; }
.ok { background: #f0fdf4; color: #15803d; padding: 12px 16px; border-radius: 8px; margin-bottom: 16px; }
.card { background: #fff; border: 1px solid rgba(0,0,0,0.06); border-radius: 12px; padding: 24px; margin-bottom: 32px; }
.card h2 { font-size: 20px; font-weight: 700; margin: 0 0 12px; }
.desc { color: #9ca3af; font-size: 13px; line-height: 1.7; }
.inline-form { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 8px; }
.inline-form input { border: 1px solid #e5e7eb; border-radius: 8px; padding: 8px 12px; font-size: 14px; min-width: 240px; }
.inline-form input.wide { min-width: 360px; flex: 1; }
.mono { background: #f3f4f6; padding: 1px 6px; border-radius: 4px; font-size: 12px; margin-left: 6px; }
.import-result { margin-top: 12px; font-size: 13px; }
.skipped { background: #fef2f2; border-radius: 8px; padding: 12px 16px; margin-top: 8px; color: #7f1d1d; }
.skipped ul { margin: 6px 0 0; padding-left: 20px; }
.inspect { margin-top: 12px; font-size: 13px; background: #f9fafb; border-radius: 8px; padding: 12px 16px; }
.inspect ul { margin: 6px 0 0; padding-left: 20px; line-height: 1.9; }
.dup { color: #b45309; margin-left: 8px; font-size: 12px; }
.one-import { border-top: 1px solid #f3f4f6; padding-top: 10px; margin-top: 10px; }
.issue-list { list-style: none; padding: 0; margin: 6px 0 0; }
.issue-list li { padding: 5px 10px; border-radius: 5px; margin-bottom: 4px; line-height: 1.6; }
.issue-list li.error { background: #fef2f2; color: #991b1b; }
.issue-list li.warning { background: #fffbeb; color: #92400e; }
.hc-badge-red { background: #fee2e2; color: #b91c1c; }
</style>
