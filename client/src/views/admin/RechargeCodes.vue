<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { apiGet, apiPost } from '../../lib/api'

// 充值码（115）：批量生成 → 标记已发放（贴进淘宝发货之后）→ 买家在应用页右上角「充值」充进自己的 key。
// 「已发放」只是后台记账，买家拿到没标发放的码照样能充。用过的码整行置灰、不能再改状态。

const props = defineProps<{ app: string }>()

const codes = ref<any[]>([])
const loading = ref(false)
const err = ref('')
const msg = ref('')
const form = ref({ count: 10, points: 100, label: '' })
const created = ref<Array<{ id: string; code: string }>>([])
const filter = ref<'all' | 'unused' | 'issued' | 'used'>('all')
const picked = ref<Set<string>>(new Set())

const STATUS_LABEL: Record<string, string> = { unused: '未使用', issued: '已发放', used: '已使用' }

const shown = computed(() => (filter.value === 'all' ? codes.value : codes.value.filter(c => c.status === filter.value)))
const counts = computed(() => {
  const n: Record<string, number> = { unused: 0, issued: 0, used: 0 }
  for (const c of codes.value) n[c.status]++
  return n
})

async function load() {
  loading.value = true
  err.value = ''
  try {
    codes.value = await apiGet('/api/admin/app-keys/codes', { app: props.app })
    picked.value = new Set()
  } catch (e: any) {
    err.value = e.message || '读取失败'
  } finally {
    loading.value = false
  }
}

async function createCodes() {
  err.value = ''
  msg.value = ''
  try {
    const res = await apiPost('/api/admin/app-keys/codes', { app: props.app, ...form.value })
    created.value = res.codes
    await load()
  } catch (e: any) {
    err.value = e.message || '生成失败'
  }
}

/** 回的是实际改了几张 —— 勾选里混着已使用的码时，要说出来而不是一句「已标记」。 */
async function setIssued(ids: string[], issued: boolean) {
  if (!ids.length) return
  err.value = ''
  msg.value = ''
  try {
    const { changed } = await apiPost('/api/admin/app-keys/codes/issue', { ids, issued })
    const skipped = ids.length - changed
    msg.value = `已把 ${changed} 张标为「${issued ? '已发放' : '未使用'}」` +
      (skipped ? `，另有 ${skipped} 张没动（${issued ? '已发放或已使用' : '未发放或已使用'}）` : '')
    await load()
  } catch (e: any) {
    err.value = e.message || '保存失败'
  }
}

function togglePick(id: string) {
  const s = new Set(picked.value)
  s.has(id) ? s.delete(id) : s.add(id)
  picked.value = s
}

async function copyCode(c: any) {
  err.value = ''
  try {
    const res = await apiGet(`/api/admin/app-keys/codes/${c.id}/reveal`)
    await copy(res.code)
  } catch (e: any) {
    err.value = e.message || '读取明文失败'
  }
}

// 复制失败必须出声：静默失败的话贴进淘宝发货的是剪贴板里别的东西。
async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    msg.value = '已复制'
  } catch {
    err.value = `复制失败（浏览器不允许），请手动选中复制：\n${text}`
  }
}

function downloadCsv() {
  const csv = 'code\n' + created.value.map(c => c.code).join('\n') + '\n'
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
  a.download = `${props.app}-recharge-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}

// 本地时间：买家报的是「我几点充的」，和他那边对不上 8 小时的话会以为充到了别人那里。
const fmt = (t: string | null) => (t ? new Date(t).toLocaleString('zh-CN', { hour12: false }) : '-')

watch(() => props.app, () => { created.value = []; msg.value = ''; load() }, { immediate: true })
</script>

<template>
  <div>
    <p v-if="err" class="err">{{ err }}</p>
    <p v-if="msg" class="ok">{{ msg }}</p>

    <div class="card">
      <h3>批量生成充值码</h3>
      <div class="row">
        <label>数量 <input v-model.number="form.count" type="number" min="1" max="500" /></label>
        <label>每张面值（点） <input v-model.number="form.points" type="number" min="1" /></label>
        <label class="grow">备注（如：淘宝 9.9 元 100 点） <input v-model="form.label" /></label>
      </div>
      <button class="btn-primary" @click="createCodes">生成</button>
      <div v-if="created.length" class="created">
        <p>✅ 已生成 {{ created.length }} 张（状态是「未使用」，贴进发货之后记得标「已发放」）：
          <button class="link" @click="copy(created.map(c => c.code).join('\n'))">复制全部</button>
          <button class="link" @click="downloadCsv">下载 CSV</button>
          <button class="link" @click="setIssued(created.map(c => c.id), true)">这一批全部标为已发放</button>
        </p>
        <textarea readonly :value="created.map(c => c.code).join('\n')" rows="6"></textarea>
      </div>
    </div>

    <div class="toolbar">
      <button v-for="f in (['all', 'unused', 'issued', 'used'] as const)" :key="f"
        :class="['chip', { active: filter === f }]" @click="filter = f">
        {{ f === 'all' ? `全部 ${codes.length}` : `${STATUS_LABEL[f]} ${counts[f]}` }}
      </button>
      <span class="spacer"></span>
      <template v-if="picked.size">
        <span class="muted">已选 {{ picked.size }} 张</span>
        <button class="link" @click="setIssued([...picked], true)">标为已发放</button>
        <button class="link" @click="setIssued([...picked], false)">撤回为未使用</button>
      </template>
    </div>

    <table v-if="shown.length">
      <thead>
        <tr><th></th><th>充值码</th><th>面值</th><th>备注</th><th>状态</th><th>生成</th><th>发放 / 使用</th><th>操作</th></tr>
      </thead>
      <tbody>
        <tr v-for="c in shown" :key="c.id" :class="{ used: c.status === 'used' }">
          <td><input type="checkbox" :disabled="c.status === 'used'" :checked="picked.has(c.id)" @change="togglePick(c.id)" /></td>
          <td><code>{{ c.code_prefix }}</code> <button v-if="c.status !== 'used'" class="link" @click="copyCode(c)">复制</button></td>
          <td>{{ c.points }} 点</td>
          <td>{{ c.label || '-' }}</td>
          <td><span :class="['badge', c.status]">{{ STATUS_LABEL[c.status] }}</span></td>
          <td>{{ fmt(c.created_at) }}</td>
          <td>
            <template v-if="c.status === 'used'">{{ fmt(c.used_at) }} 充进 <code>{{ c.used_key_prefix || '?' }}</code></template>
            <template v-else-if="c.status === 'issued'">{{ fmt(c.issued_at) }} 发放</template>
            <template v-else>-</template>
          </td>
          <td>
            <button v-if="c.status === 'unused'" class="link" @click="setIssued([c.id], true)">标为已发放</button>
            <button v-else-if="c.status === 'issued'" class="link" @click="setIssued([c.id], false)">撤回</button>
            <span v-else class="muted">-</span>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else-if="!loading" class="empty">{{ codes.length ? '这个筛选下没有码。' : '这个应用还没有充值码。' }}</p>
  </div>
</template>

<style scoped>
.err { background: #fef2f2; border: 1px solid #fecaca; color: #b91c1c; padding: 10px 14px; border-radius: 6px; font-size: 13px; white-space: pre-wrap; }
.ok { background: #ecfdf5; border: 1px solid #a7f3d0; color: #166534; padding: 8px 14px; border-radius: 6px; font-size: 13px; }
.card { border: 1px solid #e2e8f0; border-radius: 8px; padding: 18px; margin-bottom: 18px; }
.card h3 { margin: 0 0 12px; font-size: 15px; }
.row { display: flex; gap: 12px; margin-bottom: 12px; max-width: 720px; }
.row label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: #475569; width: 120px; }
.row label.grow { flex: 1; }
.row input { border: 1px solid #cbd5e1; border-radius: 6px; padding: 7px 10px; font-size: 13px; }
.btn-primary { background: #2563eb; color: #fff; border: none; border-radius: 6px; padding: 8px 16px; font-size: 13px; cursor: pointer; }
.created { margin-top: 14px; padding: 12px; background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 6px; font-size: 13px; }
.created textarea { width: 100%; box-sizing: border-box; font-family: monospace; font-size: 12px; margin-top: 6px; }
.toolbar { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; font-size: 13px; }
.chip { border: 1px solid #e2e8f0; background: #fff; border-radius: 999px; padding: 4px 12px; font-size: 12px; cursor: pointer; color: #475569; }
.chip.active { border-color: #2563eb; color: #2563eb; background: #eff6ff; }
.spacer { flex: 1; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th, td { border-bottom: 1px solid #e2e8f0; padding: 8px 10px; text-align: left; vertical-align: middle; }
th { background: #f8fafc; font-weight: 600; color: #475569; }
tr.used td { color: #94a3b8; background: #f8fafc; }
tr.used code { color: #94a3b8; }
code { background: #f1f5f9; padding: 1px 4px; border-radius: 4px; font-size: 12px; }
.link { background: none; border: none; color: #2563eb; cursor: pointer; font-size: 12px; padding: 0 2px; }
.badge { padding: 2px 8px; border-radius: 10px; font-size: 12px; }
.badge.unused { background: #dbeafe; color: #1e40af; }
.badge.issued { background: #fef3c7; color: #92400e; }
.badge.used { background: #e2e8f0; color: #64748b; }
.muted { color: #94a3b8; font-size: 12px; }
.empty { color: #94a3b8; font-size: 13px; }
</style>
