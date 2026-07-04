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

      <div class="hc-table-container">
        <table class="hc-table">
          <thead>
            <tr>
              <th>排序</th>
              <th>Icon</th>
              <th>标题</th>
              <th>分类</th>
              <th>跨度</th>
              <th>背景/图片</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in modules" :key="item.id">
              <td>{{ item.sort_order }}</td>
              <td>{{ item.icon }}</td>
              <td>
                <div style="font-weight: 600; margin-bottom: 4px; color: var(--c-text-main);">{{ item.title }}</div>
                <div style="font-size: 12px; color: var(--c-text-sub); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; max-width: 200px;">
                  {{ item.description }}
                </div>
              </td>
              <td>
                <span class="hc-badge hc-badge-blue">{{ item.category }}</span>
              </td>
              <td>
                <code style="background: #f3f4f6; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-family: monospace;">{{ item.grid_span }}</code>
              </td>
              <td>
                <div style="display: flex; align-items: center; gap: 8px;">
                  <div style="width: 16px; height: 16px; border-radius: 4px;" :style="{ background: item.bg_color }"></div>
                  <span style="font-size: 12px; color: var(--c-text-sub);" v-if="item.image_url">有图</span>
                </div>
              </td>
              <td>
                <span :class="['hc-badge', item.visible ? 'hc-badge-green' : 'hc-badge-gray']">
                  {{ item.visible ? '显示' : '隐藏' }}
                </span>
                <span class="hc-badge hc-badge-blue" v-if="item.featured">Featured</span>
              </td>
              <td>
                <div class="table-actions">
                  <router-link :to="`/admin/home/module/${item.id}`" class="hc-btn hc-btn-secondary" style="text-decoration: none; display: inline-block;">编辑</router-link>
                  <button class="hc-btn hc-btn-danger" @click="deleteModule(item.id)">删除</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="modules.length === 0" class="empty">暂无模块，点击上方按钮添加</p>
    </div>

    <!-- Feeds Section -->
    <div v-if="tab === 'feeds'" class="section">
      <div class="section-header">
        <h2>DISCOVER 推荐内容</h2>
        <button class="hc-btn hc-btn-primary" @click="showFeedForm = true">添加推荐</button>
      </div>

      <div class="hc-table-container">
        <table class="hc-table">
          <thead>
            <tr>
              <th>排序</th>
              <th>Icon</th>
              <th>标题/链接</th>
              <th>作者</th>
              <th>背景</th>
              <th>点赞</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in feeds" :key="item.id">
              <td>{{ item.sort_order }}</td>
              <td>{{ item.icon }}</td>
              <td>
                <div style="font-weight: 600; margin-bottom: 4px; color: var(--c-text-main);">{{ item.title }}</div>
                <div style="font-size: 12px; color: var(--c-text-sub); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; max-width: 200px;">
                  <a :href="item.link" target="_blank" style="color: var(--c-blue-primary); text-decoration: none;">{{ item.link }}</a>
                </div>
              </td>
              <td>
                <div style="display: flex; align-items: center; gap: 8px;">
                  <div style="width: 24px; height: 24px; border-radius: 50%;" :style="{ background: item.avatar_color }"></div>
                  <span>{{ item.author }}</span>
                </div>
              </td>
              <td>
                <div style="display: flex; align-items: center; gap: 8px;">
                  <div style="width: 16px; height: 16px; border-radius: 4px;" :style="{ background: item.bg_color }"></div>
                </div>
              </td>
              <td>{{ item.likes }}</td>
              <td>
                <span :class="['hc-badge', item.visible ? 'hc-badge-green' : 'hc-badge-gray']">
                  {{ item.visible ? '显示' : '隐藏' }}
                </span>
              </td>
              <td>
                <div class="table-actions">
                  <button class="hc-btn hc-btn-secondary" @click="editFeed(item)">编辑</button>
                  <button class="hc-btn hc-btn-danger" @click="deleteFeed(item.id)">删除</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="feeds.length === 0" class="empty">暂无推荐内容</p>
    </div>

    <!-- Feed Modal -->
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
  border-bottom: 1px solid #e5e7eb; 
}
.section-tabs button {
  padding: 12px 24px; 
  background: none; 
  border: none;
  border-bottom: 2px solid transparent; 
  font-family: var(--font-sans, sans-serif);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer; 
  color: var(--c-text-sub, #555); 
  margin-bottom: -1px;
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}
.section-tabs button:hover {
  color: var(--c-text-main, #111);
}
.section-tabs button.active { 
  color: #3B5BDB; 
  border-bottom-color: #3B5BDB;
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
  font-family: var(--font-sans, sans-serif);
  font-weight: 700;
}

.data-table code { background: #f3f4f6; padding: 4px 8px; border-radius: 4px; font-family: var(--font-mono); font-size: 11px; }
.data-table small { color: var(--c-text-sub); display: block; margin-top: 4px; }

.empty { text-align: center; color: var(--c-text-sub); padding: 60px; font-family: var(--font-sans, sans-serif); font-size: 14px; border: 1px dashed #d1d5db; border-radius: 10px; }

.form-row { margin-bottom: 20px; }
.form-checks { display: flex; flex-wrap: wrap; gap: 24px; margin: 24px 0; font-family: var(--font-sans, sans-serif); font-size: 13px; font-weight: 600; }
.form-checks label { display: flex; align-items: center; gap: 8px; cursor: pointer; font-weight: bold; margin-bottom: 0 !important; }
.form-checks input[type="checkbox"] { width: 16px; height: 16px; accent-color: var(--c-blue-primary); }
</style>
