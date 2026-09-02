<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { apiGet, apiPost, apiPatch, apiDelete } from '../../lib/api'

// 品牌咨询对外接入（084/086）的后台：发 pk、配域名白名单、调每把 key 的上限、看用量。
// 上限和用量必须同屏显示 —— 只显示上限的话，接入方那边被 429 挡住时这一行看起来完全正常，
// 管理员没法判断该调高上限还是有人在滥用。

const keys = ref<any[]>([])
const users = ref<any[]>([])
const loading = ref(false)
const err = ref('')
const createdPk = ref('')

const form = ref({ userId: '', name: '', origins: '', dailyAiLimit: 50, maxProjects: 200 })

// 现成的接入代码。它在这里的理由：pk 单独发过去没用 —— 接入方最容易做错的正是
// 「自己在 iframe 里换 token」（那样 Origin 是我们的域名，白名单对每个 pk 都成立，
// 等于没配，而一切看起来正常）。给一段能直接粘的代码就绕过了这个坑。
const snippetPk = ref('')
function snippetFor(pk: string): string {
  return `<div id="consult"></div>
<script src="${location.origin}/sdk/consult-sdk.umd.cjs"><\/script>
<script>
  ConsultSDK.mountConsult({
    pk: '${pk}',
    baseUrl: '${location.origin}',
    externalUid: '你这边终端用户的稳定 id',  // 必填：项目归属键
    target: '#consult',
    onError: (msg) => alert(msg),           // 不接的话失败只写控制台，页面上是一块空白
  })
<\/script>`
}

async function load() {
  loading.value = true
  err.value = ''
  try {
    keys.value = await apiGet('/api/consult/admin/sdk-keys')
  } catch (e: any) {
    err.value = e.message || '读取失败'
  } finally {
    loading.value = false
  }
}

async function loadUsers() {
  try {
    const res = await apiGet('/api/admin/users', { pageSize: 200 })
    users.value = res.users || []
  } catch (e: any) {
    err.value = `用户列表读取失败：${e.message || e}`
  }
}

async function createKey() {
  err.value = ''
  if (!form.value.userId) { err.value = '请选择绑定账号'; return }
  try {
    const res = await apiPost('/api/consult/admin/sdk-keys', {
      userId: form.value.userId,
      name: form.value.name.trim(),
      allowedOrigins: form.value.origins,
      dailyAiLimit: form.value.dailyAiLimit,
      maxProjects: form.value.maxProjects,
    })
    createdPk.value = res.pk
    form.value.name = ''
    form.value.origins = ''
    await load()
  } catch (e: any) {
    err.value = e.message || '创建失败'
  }
}

async function patchKey(pk: string, body: Record<string, unknown>) {
  err.value = ''
  try {
    await apiPatch(`/api/consult/admin/sdk-keys/${pk}`, body)
    await load()
  } catch (e: any) {
    err.value = e.message || '保存失败'
  }
}

// 白名单**不能用 `prompt()`** 改：那个对话框只有一行，浏览器会把多行的默认值压成一条
// 空格分隔的长字符串，点确定就把「三个域名」存成了一条谁都匹配不上的条目 —— 接口回
// success、表里那一行看着有内容，而这把 key 的每个域名都换不到 token（现象是第三方
// 页面上一块白，他只会去核对自己那个没写错的域名）。所以这里是行内 textarea。
const editingPk = ref('')
const originsText = ref('')
const savingOrigins = ref(false)

function startEditOrigins(k: any) {
  editingPk.value = k.pk
  originsText.value = (k.allowed_origins || []).join('\n')
  err.value = ''
}

async function saveOrigins(pk: string) {
  err.value = ''
  savingOrigins.value = true
  try {
    await apiPatch(`/api/consult/admin/sdk-keys/${pk}`, { allowedOrigins: originsText.value })
    editingPk.value = ''
    await load()
  } catch (e: any) {
    // 失败要**留在编辑态**：关掉的话他刚敲的那几行没了，而列表里显示的还是旧名单。
    err.value = e.message || '保存失败'
  } finally {
    savingOrigins.value = false
  }
}

function editLimit(k: any, field: 'dailyAiLimit' | 'maxProjects') {
  const cur = field === 'dailyAiLimit' ? k.daily_ai_limit : k.max_projects
  const label = field === 'dailyAiLimit' ? '每天最多几次 AI 调用（0 = 冻住这把 key）' : '名下最多几个项目'
  const val = prompt(label, String(cur))
  if (val === null) return
  patchKey(k.pk, { [field]: Number(val) })
}

async function removeKey(k: any) {
  if (!confirm(`确认删除 ${k.pk.slice(0, 20)}…？\n第三方页面会立刻变成「接口已关闭」，已经签出去的短 token 也同时失效。\n它名下的 ${k.projects} 个项目不会被删（数据留在库里，但没有入口能打开）。`)) return
  err.value = ''
  try {
    await apiDelete(`/api/consult/admin/sdk-keys/${k.pk}`)
    await load()
  } catch (e: any) {
    err.value = e.message || '删除失败'
  }
}

// 复制失败必须出声：静默失败的话管理员以为剪贴板里是那把 pk，粘出来是别的东西。
async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    err.value = ''
  } catch {
    err.value = `复制失败（浏览器不允许），请手动选中复制：${text}`
  }
}

onMounted(() => { load(); loadUsers() })
</script>

<template>
  <div class="consult-admin">
    <div class="admin-header"><h1>品牌咨询 · 对外接入</h1></div>

    <p v-if="err" class="err">{{ err }}</p>

    <div class="intro">
      <p>给第三方<b>纯前端</b>页面签发 <b>publishable key（pk）</b>。他们在自己页面里用 pk 换一个 15 分钟的短 token，再把 token 交给嵌进去的 iframe 工作台。</p>
      <ul>
        <li>pk 是公开的（写在他们页面的 JS 里）—— 防线是<b>绑定账号 + 域名白名单 + 每把 key 的上限</b>，不是保密。</li>
        <li>白名单同时是 iframe 的宿主名单：只有名单里的域名能换 token、能嵌工作台。</li>
        <li>咨询的每一步都会<b>花绑定账号的 AI 额度</b>，所以每把 key 都有自己的每日上限；用量在下面这张表里。</li>
        <li>接入方传的 <code>externalUid</code> 只做<b>展示隔离</b>（不同终端用户互相看不到项目），纯前端下改得掉，不是安全边界。</li>
        <li><b>换 token 必须由他们的页面自己发</b>（下面「接入代码」里的 SDK 已经这么做了）：让 iframe 自己去换的话 Origin 是我们的域名，白名单对每个 pk 都成立，等于没配。</li>
      </ul>
    </div>

    <div class="card">
      <h3>新建 key</h3>
      <div class="form">
        <label>绑定账号（项目归属 + 谁付 AI 的钱）
          <select v-model="form.userId">
            <option value="">请选择用户</option>
            <option v-for="u in users" :key="u.id" :value="u.id">{{ u.username }}</option>
          </select>
        </label>
        <label>备注名称
          <input v-model="form.name" placeholder="如：XX 咨询公司官网" />
        </label>
        <label>域名白名单（每行一个，必填）
          <textarea v-model="form.origins" rows="3" placeholder="https://partner.com&#10;https://www.partner.com"></textarea>
        </label>
        <div class="row">
          <label>每日 AI 调用上限
            <input v-model.number="form.dailyAiLimit" type="number" min="0" />
          </label>
          <label>项目数上限
            <input v-model.number="form.maxProjects" type="number" min="0" />
          </label>
        </div>
        <button class="btn-primary" @click="createKey">生成 key</button>
      </div>
      <div v-if="createdPk" class="created">
        <p>✅ 已生成（下面表里随时能再复制）：</p>
        <code>{{ createdPk }}</code>
        <button class="link" @click="copy(createdPk)">复制</button>
      </div>
    </div>

    <table v-if="keys.length">
      <thead>
        <tr>
          <th>pk</th><th>绑定账号</th><th>备注</th><th>白名单</th>
          <th>今日 AI</th><th>项目</th><th>状态</th><th>最近使用</th><th>操作</th>
        </tr>
      </thead>
      <tbody>
        <template v-for="k in keys" :key="k.pk">
        <tr>
          <td><code>{{ k.pk.slice(0, 18) }}…</code> <button class="link" @click="copy(k.pk)">复制</button></td>
          <td>{{ k.username || k.user_id }}</td>
          <td>{{ k.name || '-' }}</td>
          <td class="origins-cell">
            <template v-if="editingPk === k.pk">
              <textarea
                v-model="originsText" rows="4" spellcheck="false" class="origins-edit"
                placeholder="https://partner.com&#10;https://www.partner.com"
              ></textarea>
              <p class="origins-hint">一行一个，要带 <code>https://</code>、不带路径。</p>
              <div>
                <button class="link" :disabled="savingOrigins" @click="saveOrigins(k.pk)">
                  {{ savingOrigins ? '保存中…' : '保存' }}
                </button>
                <button class="link" @click="editingPk = ''">取消</button>
              </div>
            </template>
            <template v-else>
              <span v-if="!k.allowed_origins.length" class="warn">未配置（换不到 token）</span>
              <!-- 一行一条地列，不用逗号拼：拼成一句的话「三个域名」和「一条塞了三个域名
                   的坏条目」在屏幕上长得一模一样，而后者每个域名都是 403。 -->
              <ul v-else class="origins"><li v-for="o in k.allowed_origins" :key="o">{{ o }}</li></ul>
              <button class="link" @click="startEditOrigins(k)">编辑</button>
            </template>
          </td>
          <td :class="{ warn: k.ai_used_today >= k.daily_ai_limit }">
            {{ k.ai_used_today }} / {{ k.daily_ai_limit }}
            <button class="link" @click="editLimit(k, 'dailyAiLimit')">改</button>
          </td>
          <td :class="{ warn: k.projects >= k.max_projects }">
            {{ k.projects }} / {{ k.max_projects }}
            <button class="link" @click="editLimit(k, 'maxProjects')">改</button>
          </td>
          <td><span :class="['badge', k.enabled ? 'on' : 'off']">{{ k.enabled ? '启用' : '已停用' }}</span></td>
          <td>{{ k.last_used_at ? k.last_used_at.slice(0, 19).replace('T', ' ') : '-' }}</td>
          <td>
            <button class="link" @click="snippetPk = snippetPk === k.pk ? '' : k.pk">接入代码</button>
            <button class="link" @click="patchKey(k.pk, { enabled: !k.enabled })">{{ k.enabled ? '停用' : '启用' }}</button>
            <button class="link danger" @click="removeKey(k)">删除</button>
          </td>
        </tr>
        <tr v-if="snippetPk === k.pk">
          <td colspan="9">
            <div class="snippet">
              <p>把这段发给接入方（他们的域名要在上面的白名单里）：
                <button class="link" @click="copy(snippetFor(k.pk))">复制全部</button>
              </p>
              <pre>{{ snippetFor(k.pk) }}</pre>
            </div>
          </td>
        </tr>
        </template>
      </tbody>
    </table>
    <p v-else-if="!loading" class="empty">还没有任何 key。</p>
  </div>
</template>

<style scoped>
.consult-admin { padding: 20px; }
.admin-header h1 { margin: 0 0 16px; font-size: 20px; }
.err { background: #fef2f2; border: 1px solid #fecaca; color: #b91c1c; padding: 10px 14px; border-radius: 6px; font-size: 13px; white-space: pre-wrap; }
.intro { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px 18px; margin-bottom: 16px; font-size: 13px; color: #475569; }
.intro ul { margin: 8px 0 0; padding-left: 18px; }
.intro li { margin: 4px 0; }
.card { border: 1px solid #e2e8f0; border-radius: 8px; padding: 18px; margin-bottom: 18px; }
.card h3 { margin: 0 0 12px; font-size: 15px; }
.form { display: flex; flex-direction: column; gap: 10px; max-width: 560px; }
.form label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: #475569; }
.form input, .form select, .form textarea { border: 1px solid #cbd5e1; border-radius: 6px; padding: 7px 10px; font-size: 13px; font-family: inherit; }
.row { display: flex; gap: 12px; }
.row label { flex: 1; }
.btn-primary { align-self: flex-start; background: #2563eb; color: #fff; border: none; border-radius: 6px; padding: 8px 16px; font-size: 13px; cursor: pointer; }
.created { margin-top: 14px; padding: 12px; background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 6px; font-size: 13px; }
.created code { display: block; margin: 6px 0; word-break: break-all; font-size: 12px; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th, td { border-bottom: 1px solid #e2e8f0; padding: 8px 10px; text-align: left; vertical-align: top; }
th { background: #f8fafc; font-weight: 600; color: #475569; }
code { background: #f1f5f9; padding: 1px 4px; border-radius: 4px; font-size: 12px; }
.origins-cell { min-width: 220px; }
.origins { margin: 0; padding-left: 16px; }
.origins li { word-break: break-all; }
.origins-edit {
  width: 100%; box-sizing: border-box; border: 1px solid #cbd5e1; border-radius: 6px;
  padding: 6px 8px; font-size: 12px; font-family: inherit; line-height: 1.6; resize: vertical;
}
.origins-edit:focus { outline: none; border-color: #2563eb; }
.origins-hint { margin: 4px 0; font-size: 11px; color: #94a3b8; }
.link { background: none; border: none; color: #2563eb; cursor: pointer; font-size: 12px; padding: 0 2px; }
.link.danger { color: #dc2626; }
.warn { color: #b45309; }
.badge { padding: 2px 8px; border-radius: 10px; font-size: 12px; }
.badge.on { background: #dcfce7; color: #166534; }
.badge.off { background: #fee2e2; color: #991b1b; }
.empty { color: #94a3b8; font-size: 13px; }
.snippet { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px 12px; font-size: 12px; color: #475569; }
.snippet pre { margin: 6px 0 0; overflow-x: auto; background: #0f172a; color: #e2e8f0; padding: 10px 12px; border-radius: 6px; line-height: 1.5; }
</style>
