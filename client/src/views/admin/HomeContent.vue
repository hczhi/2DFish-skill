<template>
  <div class="home-content-admin">
    <div class="section-tabs">
      <button :class="{ active: tab === 'modules' }" @click="tab = 'modules'">模块卡片</button>
      <button :class="{ active: tab === 'feeds' }" @click="tab = 'feeds'">推荐内容</button>
    </div>

    <!-- Modules Section -->
    <div v-if="tab === 'modules'" class="section">
      <div class="section-header">
        <h2>首页模块卡片</h2>
        <button class="btn-primary" @click="showModuleForm = true">添加模块</button>
      </div>

      <table class="data-table">
        <thead>
          <tr>
            <th>排序</th>
            <th>Icon</th>
            <th>标题</th>
            <th>路径</th>
            <th>分类</th>
            <th>布局</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="m in modules" :key="m.id">
            <td>{{ m.sort_order }}</td>
            <td>{{ m.icon }}</td>
            <td><strong>{{ m.title }}</strong><br><small>{{ m.description }}</small></td>
            <td><code>{{ m.path }}</code></td>
            <td>{{ m.category }}</td>
            <td>{{ m.grid_span }}</td>
            <td>
              <span class="badge" :class="m.visible ? 'badge-green' : 'badge-gray'">
                {{ m.visible ? '显示' : '隐藏' }}
              </span>
              <span class="badge badge-blue" v-if="m.featured">推荐</span>
            </td>
            <td>
              <button class="btn-sm" @click="editModule(m)">编辑</button>
              <button class="btn-sm btn-danger" @click="deleteModule(m.id)">删除</button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="modules.length === 0" class="empty">暂无模块，点击上方按钮添加</p>
    </div>

    <!-- Feeds Section -->
    <div v-if="tab === 'feeds'" class="section">
      <div class="section-header">
        <h2>DISCOVER 推荐内容</h2>
        <button class="btn-primary" @click="showFeedForm = true">添加内容</button>
      </div>

      <table class="data-table">
        <thead>
          <tr>
            <th>排序</th>
            <th>Icon</th>
            <th>标题</th>
            <th>作者</th>
            <th>点赞</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="f in feeds" :key="f.id">
            <td>{{ f.sort_order }}</td>
            <td>{{ f.icon }}</td>
            <td>{{ f.title }}</td>
            <td>{{ f.author }}</td>
            <td>{{ f.likes }}</td>
            <td>
              <span class="badge" :class="f.visible ? 'badge-green' : 'badge-gray'">
                {{ f.visible ? '显示' : '隐藏' }}
              </span>
            </td>
            <td>
              <button class="btn-sm" @click="editFeed(f)">编辑</button>
              <button class="btn-sm btn-danger" @click="deleteFeed(f.id)">删除</button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="feeds.length === 0" class="empty">暂无推荐内容</p>
    </div>

    <!-- Module Form Modal -->
    <div class="modal-overlay" v-if="showModuleForm" @click.self="closeModuleForm">
      <div class="modal">
        <h3>{{ editingModule ? '编辑模块' : '添加模块' }}</h3>
        <form @submit.prevent="saveModule">
          <div class="form-row">
            <label>标题 *</label>
            <input v-model="moduleForm.title" required />
          </div>
          <div class="form-row">
            <label>描述</label>
            <input v-model="moduleForm.description" />
          </div>
          <div class="form-row">
            <label>Icon (emoji)</label>
            <input v-model="moduleForm.icon" placeholder="🐟" />
          </div>
          <div class="form-row">
            <label>跳转路径</label>
            <input v-model="moduleForm.path" placeholder="/fish" />
          </div>
          <div class="form-row">
            <label>分类标签</label>
            <input v-model="moduleForm.category" placeholder="Game" />
          </div>
          <div class="form-row">
            <label>背景色</label>
            <input v-model="moduleForm.bg_color" placeholder="#f0f5ff" />
          </div>
          <div class="form-row">
            <label>背景图URL</label>
            <input v-model="moduleForm.image_url" />
          </div>
          <div class="form-row">
            <label>网格布局</label>
            <select v-model="moduleForm.grid_span">
              <option value="1x1">1x1 (标准)</option>
              <option value="2x2">2x2 (大块)</option>
              <option value="2x1">2x1 (横宽)</option>
              <option value="1x2">1x2 (竖高)</option>
            </select>
          </div>
          <div class="form-row">
            <label>排序</label>
            <input v-model.number="moduleForm.sort_order" type="number" />
          </div>
          <div class="form-checks">
            <label><input type="checkbox" v-model="moduleForm.featured" /> 推荐（大图展示）</label>
            <label><input type="checkbox" v-model="moduleForm.require_auth" /> 需要登录</label>
            <label><input type="checkbox" v-model="moduleForm.visible" /> 显示</label>
          </div>
          <div class="form-actions">
            <button type="button" class="btn-cancel" @click="closeModuleForm">取消</button>
            <button type="submit" class="btn-primary">保存</button>
          </div>
        </form>
      </div>
    </div>

    <!-- Feed Form Modal -->
    <div class="modal-overlay" v-if="showFeedForm" @click.self="closeFeedForm">
      <div class="modal">
        <h3>{{ editingFeed ? '编辑推荐' : '添加推荐' }}</h3>
        <form @submit.prevent="saveFeed">
          <div class="form-row">
            <label>标题 *</label>
            <input v-model="feedForm.title" required />
          </div>
          <div class="form-row">
            <label>作者</label>
            <input v-model="feedForm.author" />
          </div>
          <div class="form-row">
            <label>Icon (emoji)</label>
            <input v-model="feedForm.icon" placeholder="💡" />
          </div>
          <div class="form-row">
            <label>背景色</label>
            <input v-model="feedForm.bg_color" placeholder="#f0f5ff" />
          </div>
          <div class="form-row">
            <label>头像颜色</label>
            <input v-model="feedForm.avatar_color" placeholder="#0077ff" />
          </div>
          <div class="form-row">
            <label>链接</label>
            <input v-model="feedForm.link" placeholder="https://..." />
          </div>
          <div class="form-row">
            <label>点赞数</label>
            <input v-model.number="feedForm.likes" type="number" />
          </div>
          <div class="form-row">
            <label>图片高度 (px)</label>
            <input v-model.number="feedForm.image_height" type="number" />
          </div>
          <div class="form-row">
            <label>排序</label>
            <input v-model.number="feedForm.sort_order" type="number" />
          </div>
          <div class="form-checks">
            <label><input type="checkbox" v-model="feedForm.visible" /> 显示</label>
          </div>
          <div class="form-actions">
            <button type="button" class="btn-cancel" @click="closeFeedForm">取消</button>
            <button type="submit" class="btn-primary">保存</button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { authFetch } from '../../lib/auth'

const tab = ref<'modules' | 'feeds'>('modules')

interface HomeModule {
  id: string; title: string; description: string; icon: string; path: string;
  category: string; featured: number; require_auth: number; image_url: string;
  bg_color: string; sort_order: number; visible: number; grid_span: string;
}
interface HomeFeed {
  id: string; title: string; author: string; icon: string; bg_color: string;
  avatar_color: string; link: string; likes: number; image_height: number;
  sort_order: number; visible: number;
}

const modules = ref<HomeModule[]>([])
const feeds = ref<HomeFeed[]>([])
const showModuleForm = ref(false)
const showFeedForm = ref(false)
const editingModule = ref<HomeModule | null>(null)
const editingFeed = ref<HomeFeed | null>(null)

const defaultModuleForm = () => ({
  title: '', description: '', icon: '', path: '', category: '',
  bg_color: '', image_url: '', grid_span: '1x1', sort_order: 0,
  featured: false, require_auth: false, visible: true,
})
const defaultFeedForm = () => ({
  title: '', author: '', icon: '', bg_color: '#f0f5ff',
  avatar_color: '#0077ff', link: '', likes: 0, image_height: 200,
  sort_order: 0, visible: true,
})

const moduleForm = ref(defaultModuleForm())
const feedForm = ref(defaultFeedForm())

onMounted(() => { loadModules(); loadFeeds() })

async function loadModules() {
  const res = await authFetch('/api/home/admin/modules')
  modules.value = await res.json()
}
async function loadFeeds() {
  const res = await authFetch('/api/home/admin/feeds')
  feeds.value = await res.json()
}

function editModule(m: HomeModule) {
  editingModule.value = m
  moduleForm.value = {
    title: m.title, description: m.description, icon: m.icon, path: m.path,
    category: m.category, bg_color: m.bg_color, image_url: m.image_url,
    grid_span: m.grid_span, sort_order: m.sort_order,
    featured: !!m.featured, require_auth: !!m.require_auth, visible: !!m.visible,
  }
  showModuleForm.value = true
}

function closeModuleForm() {
  showModuleForm.value = false
  editingModule.value = null
  moduleForm.value = defaultModuleForm()
}

async function saveModule() {
  const body = { ...moduleForm.value }
  if (editingModule.value) {
    await authFetch(`/api/home/admin/modules/${editingModule.value.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
  } else {
    await authFetch('/api/home/admin/modules', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
  }
  closeModuleForm()
  loadModules()
}

async function deleteModule(id: string) {
  if (!confirm('确定删除该模块？')) return
  await authFetch(`/api/home/admin/modules/${id}`, { method: 'DELETE' })
  loadModules()
}

function editFeed(f: HomeFeed) {
  editingFeed.value = f
  feedForm.value = {
    title: f.title, author: f.author, icon: f.icon, bg_color: f.bg_color,
    avatar_color: f.avatar_color, link: f.link, likes: f.likes,
    image_height: f.image_height, sort_order: f.sort_order, visible: !!f.visible,
  }
  showFeedForm.value = true
}

function closeFeedForm() {
  showFeedForm.value = false
  editingFeed.value = null
  feedForm.value = defaultFeedForm()
}

async function saveFeed() {
  const body = { ...feedForm.value }
  if (editingFeed.value) {
    await authFetch(`/api/home/admin/feeds/${editingFeed.value.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
  } else {
    await authFetch('/api/home/admin/feeds', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
  }
  closeFeedForm()
  loadFeeds()
}

async function deleteFeed(id: string) {
  if (!confirm('确定删除？')) return
  await authFetch(`/api/home/admin/feeds/${id}`, { method: 'DELETE' })
  loadFeeds()
}
</script>

<style scoped>
.home-content-admin { max-width: 1200px; }
.section-tabs { display: flex; gap: 0; margin-bottom: 24px; border-bottom: 2px solid #e5e7eb; }
.section-tabs button {
  padding: 12px 24px; background: none; border: none; font-size: 14px;
  cursor: pointer; color: #666; border-bottom: 2px solid transparent; margin-bottom: -2px;
}
.section-tabs button.active { color: #0052ff; border-bottom-color: #0052ff; font-weight: 600; }

.section-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
.section-header h2 { font-size: 18px; font-family: -apple-system, sans-serif; font-weight: 600; }

.data-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.data-table th { text-align: left; padding: 10px 12px; border-bottom: 1px solid #e5e7eb; color: #666; font-weight: 500; }
.data-table td { padding: 10px 12px; border-bottom: 1px solid #f0f0f0; vertical-align: middle; }
.data-table code { background: #f5f5f5; padding: 2px 6px; border-radius: 3px; font-size: 12px; }
.data-table small { color: #999; }

.badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 11px; margin-right: 4px; }
.badge-green { background: #dcfce7; color: #166534; }
.badge-gray { background: #f3f4f6; color: #6b7280; }
.badge-blue { background: #dbeafe; color: #1e40af; }

.btn-primary { padding: 8px 16px; background: #0052ff; color: #fff; border: none; border-radius: 6px; font-size: 13px; cursor: pointer; }
.btn-primary:hover { background: #0044d4; }
.btn-sm { padding: 4px 10px; background: #f5f5f5; border: 1px solid #e5e7eb; border-radius: 4px; font-size: 12px; cursor: pointer; margin-right: 4px; }
.btn-sm:hover { background: #e5e7eb; }
.btn-danger { color: #dc2626; }
.btn-danger:hover { background: #fef2f2; border-color: #fca5a5; }
.btn-cancel { padding: 8px 16px; background: #f5f5f5; border: 1px solid #e5e7eb; border-radius: 6px; font-size: 13px; cursor: pointer; }

.empty { text-align: center; color: #999; padding: 40px; }

.modal-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; z-index: 1000; }
.modal { background: #fff; border-radius: 12px; padding: 28px; width: 480px; max-height: 80vh; overflow-y: auto; }
.modal h3 { margin: 0 0 20px; font-size: 16px; font-family: -apple-system, sans-serif; }

.form-row { margin-bottom: 14px; }
.form-row label { display: block; font-size: 12px; color: #666; margin-bottom: 4px; }
.form-row input, .form-row select { width: 100%; padding: 8px 12px; border: 1px solid #e5e7eb; border-radius: 6px; font-size: 14px; }
.form-row input:focus, .form-row select:focus { outline: none; border-color: #0052ff; }
.form-checks { display: flex; gap: 16px; margin: 16px 0; font-size: 13px; }
.form-checks label { display: flex; align-items: center; gap: 6px; cursor: pointer; }
.form-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }
</style>
