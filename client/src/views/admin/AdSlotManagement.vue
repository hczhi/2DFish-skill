<template>
  <div class="ad-management page">
    <div class="page-header">
      <h1>广告位管理</h1>
      <button class="btn-primary" @click="openCreate">+ 新建广告位</button>
    </div>

    <div class="hc-table-container">
      <table class="hc-table">
        <thead>
          <tr>
            <th>页面匹配</th>
            <th>位置</th>
            <th>标签</th>
            <th>状态</th>
            <th>高度</th>
            <th>排序</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="slot in slots" :key="slot.id">
            <td><code>{{ slot.page_pattern }}</code></td>
            <td><span class="hc-badge hc-badge-blue">{{ slot.position }}</span></td>
            <td>{{ slot.label || '-' }}</td>
            <td>
              <span :class="['hc-badge', slot.enabled ? 'hc-badge-green' : 'hc-badge-gray']">
                {{ slot.enabled ? '启用' : '禁用' }}
              </span>
            </td>
            <td>{{ slot.height || 90 }}px</td>
            <td>{{ slot.sort_order }}</td>
            <td class="table-actions">
              <button class="btn-sm" @click="openEdit(slot)">编辑</button>
              <button class="btn-sm" @click="toggleEnabled(slot)">{{ slot.enabled ? '禁用' : '启用' }}</button>
              <button class="btn-sm btn-danger" @click="deleteSlot(slot.id)">删除</button>
            </td>
          </tr>
          <tr v-if="slots.length === 0">
            <td colspan="7" style="text-align:center; color: #999;">暂无广告位配置</td>
          </tr>
        </tbody>
      </table>
    </div>

    <AdminPagination v-if="slots.length" v-model="currentPage" :total="totalSlots" :total-pages="totalPages" />

    <div class="help-section">
      <h3>使用说明</h3>
      <table class="help-table">
        <tr><th>字段</th><th>说明</th></tr>
        <tr><td>页面匹配</td><td>匹配 URL 路径。<code>*</code> = 所有页面，<code>/discover/*</code> = discover 下所有页面，<code>/fish</code> = 仅 fish 页面</td></tr>
        <tr><td>位置</td><td>广告在页面中的位置标识：<code>top</code>（顶部横幅）、<code>mid-banner</code>（中间横幅）、<code>sidebar</code>（侧边栏）、<code>in-content</code>（文章中间）</td></tr>
        <tr><td>高度</td><td>广告位高度(px)，宽度由页面布局自动控制。常见尺寸：横幅 <code>90</code>，侧边栏 <code>250</code>/<code>600</code></td></tr>
        <tr><td>广告代码</td><td>AdSense 或其他广告平台的 HTML/JS 代码片段</td></tr>
      </table>
    </div>

    <!-- Edit/Create Modal -->
    <div class="modal-overlay" v-if="showModal" @click.self="showModal = false">
      <div class="modal-box">
        <h2>{{ editingSlot ? '编辑广告位' : '新建广告位' }}</h2>
        <form @submit.prevent="saveSlot">
          <div class="form-row">
            <label>页面匹配规则 *</label>
            <input v-model="form.page_pattern" placeholder="* 或 /discover/* 或 /fish" required />
          </div>
          <div class="form-row">
            <label>位置标识 *</label>
            <select v-model="form.position">
              <option value="top">top (页面顶部横幅)</option>
              <option value="sidebar">sidebar (侧边栏)</option>
              <option value="in-content">in-content (内容中间)</option>
              <option value="bottom">bottom (页面底部)</option>
            </select>
          </div>
          <div class="form-row">
            <label>标签（备注）</label>
            <input v-model="form.label" placeholder="如: 文章页侧边栏广告" />
          </div>
          <div class="form-row">
            <label>广告代码 (HTML/JS)</label>
            <textarea v-model="form.slot_code" rows="6" placeholder="粘贴 AdSense 代码..."></textarea>
          </div>
          <div class="form-row">
            <label>高度 (px)</label>
            <input v-model.number="form.height" type="number" min="0" placeholder="90" />
          </div>
          <div class="form-row">
            <label>排序</label>
            <input v-model.number="form.sort_order" type="number" />
          </div>
          <div class="form-row">
            <label><input type="checkbox" v-model="form.enabled" /> 启用</label>
          </div>
          <div class="modal-actions">
            <button type="button" class="btn-cancel" @click="showModal = false">取消</button>
            <button type="submit" class="btn-primary">保存</button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { authFetch } from '../../lib/auth'
import AdminPagination from '../../components/common/AdminPagination.vue'

interface AdSlot {
  id: string
  page_pattern: string
  position: string
  slot_code: string
  enabled: number
  label: string
  sort_order: number
  height: number
  created_at: string
  updated_at: string
}

const PAGE_SIZE = 20
const slots = ref<AdSlot[]>([])
const totalSlots = ref(0)
const currentPage = ref(1)
const totalPages = computed(() => Math.ceil(totalSlots.value / PAGE_SIZE))
const showModal = ref(false)
const editingSlot = ref<AdSlot | null>(null)

const defaultForm = () => ({
  page_pattern: '*',
  position: 'top',
  slot_code: '',
  enabled: true,
  label: '',
  sort_order: 0,
  height: 90,
})
const form = ref(defaultForm())

watch(currentPage, loadSlots)
onMounted(() => loadSlots())

async function loadSlots() {
  try {
    const res = await authFetch(`/api/ad-slots/admin/list?page=${currentPage.value}&page_size=${PAGE_SIZE}`)
    if (res.ok) {
      const data = await res.json()
      slots.value = data.items
      totalSlots.value = data.total
    }
  } catch { /* */ }
}

function openCreate() {
  editingSlot.value = null
  form.value = defaultForm()
  showModal.value = true
}

function openEdit(slot: AdSlot) {
  editingSlot.value = slot
  form.value = {
    page_pattern: slot.page_pattern,
    position: slot.position,
    slot_code: slot.slot_code,
    enabled: !!slot.enabled,
    label: slot.label,
    sort_order: slot.sort_order,
    height: slot.height || 90,
  }
  showModal.value = true
}

async function saveSlot() {
  const body = {
    ...form.value,
    enabled: form.value.enabled ? 1 : 0,
  }

  if (editingSlot.value) {
    await authFetch(`/api/ad-slots/admin/${editingSlot.value.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } else {
    await authFetch('/api/ad-slots/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  showModal.value = false
  await loadSlots()
}

async function toggleEnabled(slot: AdSlot) {
  await authFetch(`/api/ad-slots/admin/${slot.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: slot.enabled ? 0 : 1 }),
  })
  await loadSlots()
}

async function deleteSlot(id: string) {
  if (!confirm('确认删除此广告位？')) return
  await authFetch(`/api/ad-slots/admin/${id}`, { method: 'DELETE' })
  await loadSlots()
}
</script>

<style scoped>
.help-section {
  margin-top: 48px;
  padding: 24px;
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
}
.help-section h3 { margin: 0 0 16px; font-size: 16px; }
.help-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.help-table th, .help-table td { padding: 8px 12px; border-bottom: 1px solid #e5e7eb; text-align: left; }
.help-table th { font-weight: 600; width: 120px; }
.help-table code { background: #e5e7eb; padding: 2px 6px; border-radius: 4px; font-size: 12px; }

.modal-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 1000;
  display: flex; align-items: center; justify-content: center;
}
.modal-box {
  background: #fff; border-radius: 16px; padding: 32px; width: 560px; max-width: 90vw;
  max-height: 85vh; overflow-y: auto; box-shadow: 0 20px 60px rgba(0,0,0,0.15);
}
.modal-box h2 { margin: 0 0 24px; font-size: 20px; }
.modal-actions { display: flex; justify-content: flex-end; gap: 12px; margin-top: 24px; }

.form-row { margin-bottom: 16px; }
.form-row textarea {
  font-family: var(--font-mono, monospace);
  font-size: 12px;
  resize: vertical;
}
</style>
