<template>
  <div class="home-content-admin">
    <div class="section-tabs">
      <button :class="{ active: tab === 'modules' }" @click="tab = 'modules'">模块卡片</button>
      <!-- <button :class="{ active: tab === 'feeds' }" @click="tab = 'feeds'">推荐内容</button> -->
    </div>

    <!-- Modules Section -->
    <div v-if="tab === 'modules'" class="section">
      <div class="section-header">
        <h2>首页模块卡片</h2>
        <router-link to="/admin/home/module" class="btn-primary" style="text-decoration: none;">添加模块</router-link>
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
              <router-link :to="`/admin/home/module/${m.id}`" class="btn-sm" style="text-decoration: none; display: inline-block;">编辑</router-link>
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



    <!-- Feed Form Modal -->
    <HcModal v-model="showFeedForm" :title="editingFeed ? '编辑推荐' : '添加推荐'" max-width="600px">
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
        <div class="form-actions" style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 24px;">
          <button type="button" class="btn-cancel" @click="closeFeedForm">取消</button>
          <button type="submit" class="btn-primary">保存</button>
        </div>
      </form>
    </HcModal>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { authFetch } from '../../lib/auth'
import HcModal from '../../components/common/HcModal.vue'

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
const showFeedForm = ref(false)
const editingFeed = ref<HomeFeed | null>(null)

const defaultFeedForm = () => ({
  title: '', author: '', icon: '', bg_color: '#f0f5ff',
  avatar_color: '#0077ff', link: '', likes: 0, image_height: 200,
  sort_order: 0, visible: true,
})

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
/* 使用 AdminLayout 注入的全局 Brutalist 样式，移除重复样式 */
.home-content-admin { max-width: 1200px; }

.section-tabs { 
  display: flex; 
  gap: 16px; 
  margin-bottom: 32px; 
  border-bottom: 2px solid var(--c-text-main, #111); 
}
.section-tabs button {
  padding: 12px 24px; 
  background: none; 
  border: 2px solid transparent; 
  font-family: var(--font-mono, "JetBrains Mono", monospace);
  font-size: 14px;
  font-weight: bold;
  text-transform: uppercase;
  cursor: pointer; 
  color: var(--c-text-sub, #555); 
  margin-bottom: -2px;
  transition: all 0.2s;
}
.section-tabs button:hover {
  color: var(--c-text-main, #111);
}
.section-tabs button.active { 
  color: var(--c-text-main, #111); 
  border: 2px solid var(--c-text-main, #111); 
  border-bottom-color: #fff;
  background: #fff;
}

.section-header { 
  display: flex; 
  justify-content: space-between; 
  align-items: flex-end; 
  margin-bottom: 24px; 
}
.section-header h2 { 
  font-size: 24px; 
  margin: 0;
}

.data-table code { background: #f5f5f5; padding: 4px 8px; border: 1px solid #ddd; font-family: var(--font-mono); font-size: 11px; }
.data-table small { color: var(--c-text-sub); display: block; margin-top: 4px; }

.empty { text-align: center; color: var(--c-text-sub); padding: 60px; font-family: var(--font-mono); text-transform: uppercase; border: 2px dashed #ddd; }

.form-row { margin-bottom: 20px; }
.form-checks { display: flex; flex-wrap: wrap; gap: 24px; margin: 24px 0; font-family: var(--font-mono); font-size: 12px; text-transform: uppercase; }
.form-checks label { display: flex; align-items: center; gap: 8px; cursor: pointer; font-weight: bold; margin-bottom: 0 !important; }
.form-checks input[type="checkbox"] { width: 16px; height: 16px; accent-color: var(--c-blue-primary); }
</style>
