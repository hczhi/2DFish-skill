<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { apiGet, apiPost, apiPatch, apiDelete } from '../../lib/api'

// 展示稿对外接入（migration 100）的后台：发 pk、配域名白名单、调每把 key 的上限、看用量。
// 写法照 ConsultManagement.vue（同一个 pk 模型），两处差别都在这一页上说出来：
// ① 上限是「每日 AI 次数 / 稿子数」，而 ppt 一次操作不等于一次调用（生成一页 1 次、每张图
//    1 次生图），所以那个数看着大；② 删 key 不会删它名下的稿子。
//
// 上限和用量必须同屏显示 —— 只显示上限的话，接入方那边被限额挡住时这一行看起来完全正常，
// 管理员没法判断该调高上限还是有人在滥用。

const keys = ref<any[]>([])
const users = ref<any[]>([])
const loading = ref(false)
const err = ref('')
const createdPk = ref('')
const origin = location.origin

const form = ref({ userId: '', name: '', origins: '', dailyAiLimit: 120, maxDecks: 50 })

async function load() {
  loading.value = true
  err.value = ''
  try {
    keys.value = await apiGet('/api/ppt/admin/sdk-keys')
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
    const res = await apiPost('/api/ppt/admin/sdk-keys', {
      userId: form.value.userId,
      name: form.value.name.trim(),
      allowedOrigins: form.value.origins,
      dailyAiLimit: form.value.dailyAiLimit,
      maxDecks: form.value.maxDecks,
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
    await apiPatch(`/api/ppt/admin/sdk-keys/${pk}`, body)
    await load()
  } catch (e: any) {
    err.value = e.message || '保存失败'
  }
}

// 白名单**不能用 `prompt()`** 改：那个对话框只有一行，浏览器会把多行的默认值压成一条空格
// 分隔的长字符串，点确定就把「三个域名」存成了一条谁都匹配不上的条目 —— 接口回 success、
// 表里那一行看着有内容，而这把 key 的每个域名都换不到 token。所以这里是行内 textarea。
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
    await apiPatch(`/api/ppt/admin/sdk-keys/${pk}`, { allowedOrigins: originsText.value })
    editingPk.value = ''
    await load()
  } catch (e: any) {
    // 失败要**留在编辑态**：关掉的话他刚敲的那几行没了，而列表里显示的还是旧名单。
    err.value = e.message || '保存失败'
  } finally {
    savingOrigins.value = false
  }
}

function editLimit(k: any, field: 'dailyAiLimit' | 'maxDecks') {
  const cur = field === 'dailyAiLimit' ? k.daily_ai_limit : k.max_decks
  const label = field === 'dailyAiLimit'
    ? '每天最多几次 AI 调用（生成一页 1 次、每张图 1 次生图；0 = 冻住这把 key）'
    : '名下最多几份稿子'
  const val = prompt(label, String(cur))
  if (val === null) return
  patchKey(k.pk, { [field]: Number(val) })
}

async function removeKey(k: any) {
  if (!confirm(`确认删除 ${k.pk.slice(0, 20)}…？\n第三方页面会立刻用不了，已经签出去的短 token 也同时失效。\n它名下的 ${k.decks} 份稿子不会被删（数据留在库里，但没有入口能打开）。`)) return
  err.value = ''
  try {
    await apiDelete(`/api/ppt/admin/sdk-keys/${k.pk}`)
    await load()
  } catch (e: any) {
    err.value = e.message || '删除失败'
  }
}

// 现成的接入代码。它在这里的理由和咨询那页一样：pk 单独发过去没用 —— 接入方最容易做错的
// 正是「自己在 iframe 里换 token」（那样 Origin 是我们的域名，白名单对每个 pk 都成立，
// 等于没配，而一切看起来正常）。给一段能直接粘的代码就绕过了这个坑。
// 这里的 externalUid 注释和咨询那份**不一样**：展示稿的租户是这把 pk，它只记「谁建的」——
// 照抄「项目归属键」的话接入方会以为换个 id 就换了一个工作台，而两边看到的是同一列稿子。
const snippetPk = ref('')
function snippetFor(pk: string): string {
  return `<div id="ppt"></div>
<script src="${location.origin}/sdk/ppt-sdk.umd.cjs"><\/script>
<script>
  PptSDK.mountPpt({
    pk: '${pk}',
    baseUrl: '${location.origin}',
    externalUid: '你这边终端用户的稳定 id',  // 必填：只记录「谁建的」，同一把 key 共用工作台
    target: '#ppt',
    onError: (msg) => alert(msg),           // 不接的话失败只写控制台，页面上是一块空白
  })
<\/script>`
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
  <div class="ppt-admin">
    <div class="admin-header"><h1>展示稿 · 对外接入</h1></div>

    <p v-if="err" class="err">{{ err }}</p>

    <!-- 整条链路已经通了（换凭证 / 引导页 / SDK / 限额 / 按公司隔离）。这里留一句「先自己
         验一遍」而不是留空：SDK 是构建产物（sdk/dist），忘了发布的话 <script> 那一行 404，
         接入方页面上是一块空白，而后台这里每一行看起来都正常。 -->
    <p class="notice">发 key 之前先用示例页自己验一遍：<a class="demo" :href="`${origin}/sdk/ppt-demo.html`" target="_blank">/sdk/ppt-demo.html</a>（把白名单加上 <code>{{ origin }}</code>，粘 pk 点挂载）。它跑通了才说明 <code>ppt-sdk.umd.cjs</code> 真的发上去了。</p>

    <div class="intro">
      <p>给第三方<b>纯前端</b>页面签发 <b>publishable key（pk）</b>。他们在自己页面里用 pk 换一个短 token，再把 token 交给嵌进去的 iframe 工作台（和「咨询接入」同一套模型）。</p>
      <ul>
        <li>pk 是公开的（写在他们页面的 JS 里）—— 防线是<b>绑定账号 + 域名白名单 + 每把 key 的上限</b>，不是保密。</li>
        <li>白名单同时是 iframe 的宿主名单：只有名单里的域名能换 token、能嵌工作台。</li>
        <li><b>一次操作不等于一次调用</b>：规划一份稿子 1 次，生成 12 页是 12 次，配图是每张一次<b>生图</b>（比文本贵得多）。所以每日上限缺省是 120（约三四份完整稿子）。</li>
        <li>钱记在绑定账号上。那个账号开了「专属 AI」的话它绕过平台每日额度，<b>这里的上限就是唯一的天花板</b>。</li>
        <!-- 这条必须写在这一页上：管理员是按「一家公司一把 key」还是「一个部门/客户一把 key」
             发，取决于他知不知道同一把 key 里的人互相看得见 —— 不写的话他给一家代理商发一把，
             而那家代理商的每个客户项目都在同一个素材库和同一份稿子列表里，界面上完全正常。 -->
        <li><b>一把 key = 一家公司</b>：同一把 key 下的所有终端用户<b>共用稿子列表和素材库</b>（内部同事互相看得到、能接着改、能挑对方生成的图）。要把两家客户分开，就发<b>两把 key</b>。</li>
      </ul>
    </div>

    <div class="card">
      <h3>新建 key</h3>
      <div class="form">
        <label>绑定账号（稿子归属 + 谁付 AI 和生图的钱）
          <select v-model="form.userId">
            <option value="">请选择用户</option>
            <option v-for="u in users" :key="u.id" :value="u.id">{{ u.username }}</option>
          </select>
        </label>
        <label>备注名称
          <input v-model="form.name" placeholder="如：XX 设计公司官网" />
        </label>
        <label>域名白名单（每行一个，必填）
          <textarea v-model="form.origins" rows="3" placeholder="https://partner.com&#10;https://www.partner.com"></textarea>
        </label>
        <div class="row">
          <label>每日 AI 调用上限
            <input v-model.number="form.dailyAiLimit" type="number" min="0" />
          </label>
          <label>稿子数上限
            <input v-model.number="form.maxDecks" type="number" min="0" />
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
          <th>今日 AI</th><th>稿子</th><th>状态</th><th>最近使用</th><th>操作</th>
        </tr>
      </thead>
      <tbody>
        <template v-for="k in keys" :key="k.pk">
        <tr>
          <td><code>{{ k.pk.slice(0, 16) }}…</code> <button class="link" @click="copy(k.pk)">复制</button></td>
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
              <!-- 一行一条地列，不用逗号拼：拼成一句的话「三个域名」和「一条塞了三个域名的
                   坏条目」在屏幕上长得一模一样，而后者每个域名都是 403。 -->
              <ul v-else class="origins"><li v-for="o in k.allowed_origins" :key="o">{{ o }}</li></ul>
              <button class="link" @click="startEditOrigins(k)">编辑</button>
            </template>
          </td>
          <td :class="{ warn: k.ai_used_today >= k.daily_ai_limit }">
            {{ k.ai_used_today }} / {{ k.daily_ai_limit }}
            <button class="link" @click="editLimit(k, 'dailyAiLimit')">改</button>
          </td>
          <td :class="{ warn: k.decks >= k.max_decks }">
            {{ k.decks }} / {{ k.max_decks }}
            <button class="link" @click="editLimit(k, 'maxDecks')">改</button>
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
              <p>把这段发给接入方（他们的域名要在上面的白名单里）：<button class="link" @click="copy(snippetFor(k.pk))">复制全部</button></p>
              <pre>{{ snippetFor(k.pk) }}</pre>
              <p class="snippet-note">
                <b>不要让他们自己在 iframe 里换 token</b> —— 那样 Origin 是我们的域名，白名单对每个 pk 都成立，
                等于没配而一切看起来正常。上面这段里换 token 发生在他们自己的页面上。
              </p>
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
.ppt-admin { padding: 20px; }
.admin-header h1 { margin: 0 0 16px; font-size: 20px; }
.err { background: #fef2f2; border: 1px solid #fecaca; color: #b91c1c; padding: 10px 14px; border-radius: 6px; font-size: 13px; white-space: pre-wrap; }
.notice { background: #fffbeb; border: 1px solid #fde68a; color: #92400e; padding: 10px 14px; border-radius: 6px; font-size: 13px; margin-bottom: 14px; }
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
.snippet { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px 12px; font-size: 12px; color: #475569; }
.snippet pre { margin: 6px 0 0; overflow-x: auto; background: #0f172a; color: #e2e8f0; padding: 10px 12px; border-radius: 6px; line-height: 1.5; }
.snippet-note { margin: 8px 0 0; color: #64748b; }
.demo { color: #2563eb; }
.link { background: none; border: none; color: #2563eb; cursor: pointer; font-size: 12px; padding: 0 2px; }
.link.danger { color: #dc2626; }
.warn { color: #b45309; }
.badge { padding: 2px 8px; border-radius: 10px; font-size: 12px; }
.badge.on { background: #dcfce7; color: #166534; }
.badge.off { background: #fee2e2; color: #991b1b; }
.empty { color: #94a3b8; font-size: 13px; }
</style>
