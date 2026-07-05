<template>
  <div class="page">
    <div class="page-header">
      <h1>模块 & Token 管理</h1>
    </div>

    <!-- Module List -->
    <section class="section">
      <h2>子模块配置</h2>
      <p class="hint">管理各子模块的 API 白名单和启用状态。第三方通过 Token 调用时，只能访问白名单内的 API 路径。</p>

      <div class="hc-table-container" v-if="modules.length">
        <table class="hc-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>名称</th>
              <th>描述</th>
              <th>API 白名单</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in modules" :key="m.id">
              <td><code>{{ m.id }}</code></td>
              <td><strong>{{ m.name }}</strong></td>
              <td class="desc-cell">{{ m.description }}</td>
              <td>
                <code class="path-tag" v-for="p in parseAllowedPaths(m.allowed_paths)" :key="p">{{ p }}</code>
              </td>
              <td>
                <span class="hc-badge" :class="m.enabled ? 'hc-badge-green' : 'hc-badge-red'">
                  {{ m.enabled ? '启用' : '禁用' }}
                </span>
              </td>
              <td>
                <div class="table-actions">
                  <button class="hc-btn hc-btn-secondary hc-btn-sm" @click="editModule(m)">编辑</button>
                  <button class="hc-btn hc-btn-secondary hc-btn-sm" @click="toggleModule(m)">
                    {{ m.enabled ? '禁用' : '启用' }}
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <AdminPagination v-if="modules.length" v-model="currentPage" :total="totalModules" :total-pages="totalPages" />
      <button class="btn-primary" @click="showAddModule = true" style="margin-top: 16px;">+ 添加模块</button>
    </section>

    <!-- Edit Module Modal -->
    <HcModal v-model="showEditModule" :title="`编辑模块: ${editingModule?.name || ''}`" max-width="560px">
      <div class="form-group">
        <label>名称</label>
        <input v-model="moduleForm.name" />
      </div>
      <div class="form-group">
        <label>描述</label>
        <input v-model="moduleForm.description" />
      </div>
      <div class="form-group">
        <label>API 白名单 <small>(每行一个路径，支持 * 通配符)</small></label>
        <textarea v-model="moduleForm.allowedPathsText" rows="5" placeholder="/api/ai/fish*&#10;/api/discover/articles"></textarea>
      </div>
      <template #footer>
        <button class="btn-secondary" @click="showEditModule = false">取消</button>
        <button class="btn-primary" @click="saveModule">保存</button>
      </template>
    </HcModal>

    <!-- Add Module Modal -->
    <HcModal v-model="showAddModule" title="添加模块" max-width="560px">
      <div class="form-group">
        <label>模块 ID <small>(英文标识，不可修改)</small></label>
        <input v-model="newModuleForm.id" placeholder="my-module" />
      </div>
      <div class="form-group">
        <label>名称</label>
        <input v-model="newModuleForm.name" placeholder="模块名称" />
      </div>
      <div class="form-group">
        <label>描述</label>
        <input v-model="newModuleForm.description" placeholder="模块功能描述" />
      </div>
      <div class="form-group">
        <label>API 白名单 <small>(每行一个路径)</small></label>
        <textarea v-model="newModuleForm.allowedPathsText" rows="4" placeholder="/api/xxx"></textarea>
      </div>
      <template #footer>
        <button class="btn-secondary" @click="showAddModule = false">取消</button>
        <button class="btn-primary" @click="addModule">创建</button>
      </template>
    </HcModal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { apiGet, apiPost, api } from '../../lib/api'
import HcModal from '../../components/common/HcModal.vue'
import AdminPagination from '../../components/common/AdminPagination.vue'

interface ModuleConfig {
  id: string
  name: string
  description: string
  allowed_paths: string
  enabled: number
  created_at: string
}

const PAGE_SIZE = 20
const modules = ref<ModuleConfig[]>([])
const totalModules = ref(0)
const currentPage = ref(1)
const totalPages = computed(() => Math.ceil(totalModules.value / PAGE_SIZE))
const showEditModule = ref(false)
const showAddModule = ref(false)
const editingModule = ref<ModuleConfig | null>(null)
const moduleForm = ref({ name: '', description: '', allowedPathsText: '' })
const newModuleForm = ref({ id: '', name: '', description: '', allowedPathsText: '' })

watch(currentPage, loadModules)
onMounted(loadModules)

async function loadModules() {
  const data = await apiGet<{ modules: ModuleConfig[]; total: number }>(`/api/admin/modules?page=${currentPage.value}&page_size=${PAGE_SIZE}`)
  modules.value = data.modules
  totalModules.value = data.total
}

function parseAllowedPaths(json: string): string[] {
  try { return JSON.parse(json) } catch { return [] }
}

function editModule(m: ModuleConfig) {
  editingModule.value = m
  moduleForm.value = {
    name: m.name,
    description: m.description,
    allowedPathsText: parseAllowedPaths(m.allowed_paths).join('\n'),
  }
  showEditModule.value = true
}

async function saveModule() {
  if (!editingModule.value) return
  const paths = moduleForm.value.allowedPathsText.split('\n').map(p => p.trim()).filter(Boolean)
  await api(`/api/admin/modules/${editingModule.value.id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      name: moduleForm.value.name,
      description: moduleForm.value.description,
      allowed_paths: paths,
    }),
  })
  showEditModule.value = false
  await loadModules()
}

async function toggleModule(m: ModuleConfig) {
  await api(`/api/admin/modules/${m.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ enabled: m.enabled ? 0 : 1 }),
  })
  await loadModules()
}

async function addModule() {
  const paths = newModuleForm.value.allowedPathsText.split('\n').map(p => p.trim()).filter(Boolean)
  await apiPost('/api/admin/modules', {
    id: newModuleForm.value.id,
    name: newModuleForm.value.name,
    description: newModuleForm.value.description,
    allowed_paths: paths,
  })
  showAddModule.value = false
  newModuleForm.value = { id: '', name: '', description: '', allowedPathsText: '' }
  await loadModules()
}
</script>

<style scoped>
.page { max-width: 1200px; }
.section { margin-bottom: 48px; }
.section h2 { font-size: 20px; margin: 0 0 8px; }
.hint { font-size: 13px; color: var(--c-text-sub); margin-bottom: 24px; }
.desc-cell { max-width: 200px; color: var(--c-text-sub); font-size: 12px; }
.path-tag { display: inline-block; background: #f3f4f6; padding: 2px 8px; border-radius: 4px; font-size: 11px; margin: 2px 4px 2px 0; font-family: var(--font-mono); }
.form-group { margin-bottom: 16px; }
.form-group label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 6px; }
.form-group small { font-weight: normal; color: var(--c-text-sub); }
.form-group textarea { width: 100%; font-family: var(--font-mono); font-size: 13px; }
</style>
