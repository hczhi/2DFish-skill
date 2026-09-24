<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { apiGet, apiPost, apiPatch } from '../../lib/api'
import RechargeCodes from './RechargeCodes.vue'

// 售卖型应用 key（migration 112）：按应用分开发卡、调点数、停用、看流水。
// 余额只能通过「调整」改（会写一行流水），没有直接改数字的入口 —— 那样买家来问
// 「为什么少了」时流水对不上。

const apps = ref<Array<{ app: string; prefix: string; label: string }>>([])
const app = ref('ppt')
const view = ref<'keys' | 'codes'>('keys')
const keys = ref<any[]>([])
const loading = ref(false)
const err = ref('')

const form = ref({ count: 10, balance: 100, label: '' })
const created = ref<string[]>([])

const ledgerFor = ref('')
const ledger = ref<any[]>([])

async function load() {
  loading.value = true
  err.value = ''
  try {
    keys.value = await apiGet('/api/admin/app-keys', { app: app.value })
  } catch (e: any) {
    err.value = e.message || '读取失败'
  } finally {
    loading.value = false
  }
}

async function createKeys() {
  err.value = ''
  try {
    const res = await apiPost('/api/admin/app-keys', { app: app.value, ...form.value })
    created.value = res.keys.map((k: any) => k.key)
    await load()
  } catch (e: any) {
    err.value = e.message || '生成失败'
  }
}

async function patchKey(k: any, body: Record<string, unknown>) {
  err.value = ''
  try {
    await apiPatch(`/api/admin/app-keys/${k.id}`, body)
    await load()
  } catch (e: any) {
    err.value = e.message || '保存失败'
  }
}

async function adjust(k: any) {
  const val = prompt(`调整点数（正数加、负数减）。当前 ${k.balance} 点`, '100')
  if (val === null) return
  const note = prompt('备注（会写进流水，买家来问时对账用）', '') ?? ''
  err.value = ''
  try {
    await apiPost(`/api/admin/app-keys/${k.id}/adjust`, { delta: Number(val), note })
    await load()
    if (ledgerFor.value === k.id) await openLedger(k, true)
  } catch (e: any) {
    err.value = e.message || '调整失败'
  }
}

async function openLedger(k: any, keepOpen = false) {
  if (ledgerFor.value === k.id && !keepOpen) { ledgerFor.value = ''; return }
  err.value = ''
  try {
    ledger.value = await apiGet(`/api/admin/app-keys/${k.id}/ledger`)
    ledgerFor.value = k.id
  } catch (e: any) {
    err.value = e.message || '流水读取失败'
  }
}

async function copyKey(k: any) {
  err.value = ''
  try {
    const res = await apiGet(`/api/admin/app-keys/${k.id}/reveal`)
    await copy(res.key)
  } catch (e: any) {
    err.value = e.message || '读取明文失败'
  }
}

// 复制失败必须出声：静默失败的话管理员以为剪贴板里是那批 key，贴进淘宝发货的是别的东西。
async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    err.value = ''
  } catch {
    err.value = `复制失败（浏览器不允许），请手动选中复制：\n${text}`
  }
}

function downloadCsv() {
  const csv = 'key\n' + created.value.join('\n') + '\n'
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
  a.download = `${app.value}-keys-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}

const KIND_LABEL: Record<string, string> = { grant: '开卡', adjust: '后台调整', charge: '消费', topup: '充值码' }
const fmt = (t: string | null) => (t ? t.slice(0, 19).replace('T', ' ') : '-')

watch(app, () => { created.value = []; ledgerFor.value = ''; load() })

onMounted(async () => {
  try {
    apps.value = await apiGet('/api/admin/app-keys/apps')
  } catch (e: any) {
    err.value = e.message || '应用列表读取失败'
  }
  load()
})
</script>

<template>
  <div class="keys-admin">
    <div class="admin-header"><h1>应用 Key</h1></div>

    <div class="tabs">
      <button v-for="a in apps" :key="a.app" :class="['tab', { active: app === a.app }]" @click="app = a.app">
        {{ a.label }} <span class="prefix">{{ a.prefix }}-</span>
      </button>
    </div>

    <div class="tabs">
      <button :class="['tab', 'sub', { active: view === 'keys' }]" @click="view = 'keys'">Key</button>
      <button :class="['tab', 'sub', { active: view === 'codes' }]" @click="view = 'codes'">充值码</button>
    </div>

    <RechargeCodes v-if="view === 'codes'" :app="app" />
    <template v-else>
    <p v-if="err" class="err">{{ err }}</p>

    <div class="card">
      <h3>批量生成</h3>
      <div class="row">
        <label>数量 <input v-model.number="form.count" type="number" min="1" max="500" /></label>
        <label>每张点数 <input v-model.number="form.balance" type="number" min="0" /></label>
        <label class="grow">备注（如：淘宝 9.9 元 100 点） <input v-model="form.label" /></label>
      </div>
      <button class="btn-primary" @click="createKeys">生成</button>
      <div v-if="created.length" class="created">
        <p>✅ 已生成 {{ created.length }} 张（下面表里随时能再复制单张）：
          <button class="link" @click="copy(created.join('\n'))">复制全部</button>
          <button class="link" @click="downloadCsv">下载 CSV</button>
        </p>
        <textarea readonly :value="created.join('\n')" rows="6"></textarea>
      </div>
    </div>

    <table v-if="keys.length">
      <thead>
        <tr><th>Key</th><th>备注</th><th>余额</th><th>状态</th><th>创建</th><th>最近使用</th><th>操作</th></tr>
      </thead>
      <tbody>
        <template v-for="k in keys" :key="k.id">
          <tr>
            <td><code>{{ k.key_prefix }}</code> <button class="link" @click="copyKey(k)">复制</button></td>
            <td>{{ k.label || '-' }}</td>
            <td>{{ k.balance }}</td>
            <td><span :class="['badge', k.enabled ? 'on' : 'off']">{{ k.enabled ? '启用' : '已停用' }}</span></td>
            <td>{{ fmt(k.created_at) }}</td>
            <td>{{ fmt(k.last_used_at) }}</td>
            <td>
              <button class="link" @click="adjust(k)">调点数</button>
              <button class="link" @click="openLedger(k)">{{ ledgerFor === k.id ? '收起流水' : '流水' }}</button>
              <button class="link" :class="{ danger: k.enabled }" @click="patchKey(k, { enabled: !k.enabled })">
                {{ k.enabled ? '停用' : '启用' }}
              </button>
            </td>
          </tr>
          <tr v-if="ledgerFor === k.id">
            <td colspan="7">
              <table class="ledger">
                <thead><tr><th>时间</th><th>类型</th><th>变动</th><th>变动后</th><th>操作</th><th>备注</th></tr></thead>
                <tbody>
                  <tr v-for="l in ledger" :key="l.id">
                    <td>{{ fmt(l.created_at) }}</td>
                    <td>{{ KIND_LABEL[l.kind] || l.kind }}</td>
                    <td :class="l.delta < 0 ? 'minus' : 'plus'">{{ l.delta > 0 ? '+' : '' }}{{ l.delta }}</td>
                    <td>{{ l.balance_after }}</td>
                    <td>{{ l.operation || '-' }}</td>
                    <td>{{ l.note || '-' }}</td>
                  </tr>
                  <tr v-if="!ledger.length"><td colspan="6" class="empty">没有流水</td></tr>
                </tbody>
              </table>
            </td>
          </tr>
        </template>
      </tbody>
    </table>
    <p v-else-if="!loading" class="empty">这个应用还没有 key。</p>
    </template>
  </div>
</template>

<style scoped>
.keys-admin { padding: 20px; }
.admin-header h1 { margin: 0 0 16px; font-size: 20px; }
.tabs { display: flex; gap: 8px; margin-bottom: 16px; }
.tab { border: 1px solid #cbd5e1; background: #fff; border-radius: 6px; padding: 6px 14px; font-size: 13px; cursor: pointer; }
.tab.active { background: #2563eb; color: #fff; border-color: #2563eb; }
.tab.sub { padding: 4px 12px; font-size: 12px; }
.tab.sub.active { background: #0f172a; border-color: #0f172a; }
.prefix { font-family: monospace; font-size: 11px; opacity: .7; }
.err { background: #fef2f2; border: 1px solid #fecaca; color: #b91c1c; padding: 10px 14px; border-radius: 6px; font-size: 13px; white-space: pre-wrap; }
.card { border: 1px solid #e2e8f0; border-radius: 8px; padding: 18px; margin-bottom: 18px; }
.card h3 { margin: 0 0 12px; font-size: 15px; }
.row { display: flex; gap: 12px; margin-bottom: 12px; max-width: 720px; }
.row label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: #475569; width: 120px; }
.row label.grow { flex: 1; }
.row input { border: 1px solid #cbd5e1; border-radius: 6px; padding: 7px 10px; font-size: 13px; }
.btn-primary { background: #2563eb; color: #fff; border: none; border-radius: 6px; padding: 8px 16px; font-size: 13px; cursor: pointer; }
.created { margin-top: 14px; padding: 12px; background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 6px; font-size: 13px; }
.created textarea { width: 100%; box-sizing: border-box; font-family: monospace; font-size: 12px; margin-top: 6px; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th, td { border-bottom: 1px solid #e2e8f0; padding: 8px 10px; text-align: left; vertical-align: top; }
th { background: #f8fafc; font-weight: 600; color: #475569; }
code { background: #f1f5f9; padding: 1px 4px; border-radius: 4px; font-size: 12px; }
.ledger { background: #f8fafc; }
.minus { color: #dc2626; }
.plus { color: #16a34a; }
.link { background: none; border: none; color: #2563eb; cursor: pointer; font-size: 12px; padding: 0 2px; }
.link.danger { color: #dc2626; }
.badge { padding: 2px 8px; border-radius: 10px; font-size: 12px; }
.badge.on { background: #dcfce7; color: #166534; }
.badge.off { background: #fee2e2; color: #991b1b; }
.empty { color: #94a3b8; font-size: 13px; }
</style>
