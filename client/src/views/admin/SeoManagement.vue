<template>
  <div class="seo-admin">
    <div class="section-tabs">
      <button :class="{ active: tab === 'pages' }" @click="tab = 'pages'">页面 SEO</button>
      <button :class="{ active: tab === 'globals' }" @click="tab = 'globals'">全局设置</button>
      <button :class="{ active: tab === 'generate' }" @click="tab = 'generate'">静态生成</button>
    </div>

    <!-- Pages Tab -->
    <div v-if="tab === 'pages'" class="section">
      <div class="section-header">
        <h2>各页面 SEO 配置</h2>
        <button class="btn-primary" @click="showForm = true">添加页面</button>
      </div>

      <table class="data-table">
        <thead>
          <tr>
            <th>路径</th>
            <th>标题</th>
            <th>描述</th>
            <th>优先级</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in pages" :key="p.id">
            <td><code>{{ p.path }}</code></td>
            <td class="title-cell">{{ p.title }}</td>
            <td class="desc-cell">{{ p.description?.slice(0, 40) }}{{ p.description?.length > 40 ? '...' : '' }}</td>
            <td>{{ p.priority }}</td>
            <td>
              <span class="badge" :class="p.no_index ? 'badge-red' : 'badge-green'">
                {{ p.no_index ? 'noindex' : '索引' }}
              </span>
            </td>
            <td>
              <button class="btn-sm" @click="editPage(p)">编辑</button>
              <button class="btn-sm btn-danger" @click="deletePage(p.id)">删除</button>
            </td>
          </tr>
        </tbody>
      </table>

      <div class="tips">
        <p><strong>说明：</strong>每个路径对应一个 SEO 配置，Google 爬虫访问时会看到注入的 meta 标签。</p>
        <p>sitemap.xml 和 robots.txt 根据此配置自动生成。</p>
      </div>
    </div>

    <!-- Globals Tab -->
    <div v-if="tab === 'globals'" class="section">
      <div class="section-header">
        <h2>全局 SEO 设置</h2>
      </div>

      <form @submit.prevent="saveGlobals" class="globals-form">
        <div class="form-row">
          <label>站点名称</label>
          <input v-model="globals.site_name" placeholder="QiaoNan" />
        </div>
        <div class="form-row">
          <label>站点描述</label>
          <textarea v-model="globals.site_description" rows="2" placeholder="一句话描述你的网站"></textarea>
        </div>
        <div class="form-row">
          <label>站点 URL（含 https，不带尾部 /）</label>
          <input v-model="globals.site_url" placeholder="https://your-domain.com" />
          <small>用于生成 sitemap、canonical、og:url</small>
        </div>
        <div class="form-row">
          <label>默认 OG 图片 URL</label>
          <input v-model="globals.default_og_image" placeholder="https://your-domain.com/og-image.png" />
          <small>分享到社交媒体时的默认封面图（1200x630px 推荐）</small>
        </div>
        <div class="form-row">
          <label>Google Search Console 验证码</label>
          <input v-model="globals.google_verification" placeholder="Google 提供的验证码字符串" />
        </div>
        <div class="form-row">
          <label>Bing Webmaster 验证码</label>
          <input v-model="globals.bing_verification" />
        </div>
        <button type="submit" class="btn-primary" :disabled="savingGlobals">{{ savingGlobals ? '保存中...' : '保存' }}</button>
      </form>

      <div class="tips" style="margin-top: 24px">
        <p><strong>快速检查链接：</strong></p>
        <p><a href="/robots.txt" target="_blank">/robots.txt</a> | <a href="/sitemap.xml" target="_blank">/sitemap.xml</a></p>
      </div>
    </div>

    <!-- Generate Tab -->
    <div v-if="tab === 'generate'" class="section">
      <div class="section-header">
        <h2>静态页面生成 (SSG)</h2>
      </div>

      <div class="generate-info">
        <p>点击「生成」按钮后，系统将根据当前 SEO 配置和首页内容，预生成所有页面的静态 HTML 文件。</p>
        <ul>
          <li><strong>首页 (/)</strong> — 生成完整 DOM 内容（模块卡片 + Feed 流），搜索引擎可直接抓取</li>
          <li><strong>子页面 (/fish, /board 等)</strong> — 注入 SEO meta 标签，内容仍由前端 JS 渲染</li>
          <li><strong>robots.txt / sitemap.xml</strong> — 自动生成</li>
        </ul>
        <p class="note">生成后，Nginx 可直接指向 <code>client/dist/ssg/</code> 目录提供服务，无需 Node 处理页面请求。</p>
      </div>

      <button class="btn-generate" @click="handleGenerate" :disabled="generating">
        {{ generating ? '生成中...' : '生成静态页面' }}
      </button>

      <div v-if="generateResult" class="generate-result" :class="{ success: generateResult.success, error: !generateResult.success }">
        <h4>{{ generateResult.success ? '生成成功' : '生成完成（有错误）' }}</h4>
        <div class="result-section" v-if="generateResult.generated.length">
          <p><strong>已生成页面 ({{ generateResult.generated.length }}):</strong></p>
          <ul>
            <li v-for="p in generateResult.generated" :key="p"><code>{{ p }}</code></li>
          </ul>
        </div>
        <div class="result-section" v-if="generateResult.errors.length">
          <p><strong>错误:</strong></p>
          <ul class="error-list">
            <li v-for="(e, i) in generateResult.errors" :key="i">{{ e }}</li>
          </ul>
        </div>
        <p class="result-dir">输出目录: <code>{{ generateResult.outputDir }}</code></p>
      </div>
    </div>

    <!-- Page Form Modal -->
    <HcModal v-model="showForm" :title="editingPage ? '编辑页面 SEO' : '添加页面 SEO'" max-width="640px">
      <form @submit.prevent="savePage">
        <div class="form-grid">
          <div class="form-row">
            <label>路径 *</label>
            <input v-model="form.path" placeholder="/" :disabled="!!editingPage" />
          </div>
          <div class="form-row">
            <label>页面标题 * <small>(显示在浏览器标签和搜索结果)</small></label>
            <input v-model="form.title" placeholder="摸鱼缸 - AI 桌面养鱼游戏 | QiaoNan" />
            <small :class="{ warn: form.title.length > 60 }">{{ form.title.length }}/60 字符</small>
          </div>
          <div class="form-row">
            <label>Meta Description <small>(搜索结果摘要)</small></label>
            <textarea v-model="form.description" rows="2" placeholder="160字符内的页面描述"></textarea>
            <small :class="{ warn: form.description.length > 160 }">{{ form.description.length }}/160 字符</small>
          </div>
          <div class="form-row">
            <label>关键词 <small>(逗号分隔)</small></label>
            <input v-model="form.keywords" placeholder="AI工具,效率平台,知识管理" />
          </div>
          <div class="form-row">
            <label>OG 标题 <small>(社交分享标题，留空用页面标题)</small></label>
            <input v-model="form.og_title" />
          </div>
          <div class="form-row">
            <label>OG 描述 <small>(社交分享描述，留空用 description)</small></label>
            <input v-model="form.og_description" />
          </div>
          <div class="form-row">
            <label>OG 图片 URL <small>(社交分享封面，留空用全局默认)</small></label>
            <input v-model="form.og_image" />
          </div>
          <div class="form-row">
            <label>Canonical URL <small>(留空自动生成)</small></label>
            <input v-model="form.canonical" />
          </div>
          <div class="form-row">
            <label>JSON-LD 结构化数据 <small>(可选，完整 JSON)</small></label>
            <textarea v-model="form.json_ld" rows="3" placeholder='{"@context":"https://schema.org",...}'></textarea>
          </div>
          <div class="form-row-inline">
            <div class="form-row">
              <label>Sitemap 优先级</label>
              <input v-model.number="form.priority" type="number" step="0.1" min="0" max="1" />
            </div>
            <div class="form-row">
              <label>更新频率</label>
              <select v-model="form.changefreq">
                <option value="daily">daily</option>
                <option value="weekly">weekly</option>
                <option value="monthly">monthly</option>
                <option value="yearly">yearly</option>
              </select>
            </div>
          </div>
          <div class="form-checks">
            <label><input type="checkbox" v-model="form.no_index" /> noindex（禁止搜索引擎索引）</label>
          </div>
        </div>
        <div class="form-actions" style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 24px;">
          <button type="button" class="btn-cancel" @click="closeForm">取消</button>
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

const tab = ref<'pages' | 'globals' | 'generate'>('pages')

interface SeoPage {
  id: string; path: string; title: string; description: string; keywords: string;
  og_title: string; og_description: string; og_image: string; canonical: string;
  no_index: number; json_ld: string; priority: number; changefreq: string;
}

const pages = ref<SeoPage[]>([])
const globals = ref<Record<string, string>>({})
const showForm = ref(false)
const editingPage = ref<SeoPage | null>(null)
const savingGlobals = ref(false)

const defaultForm = () => ({
  path: '', title: '', description: '', keywords: '',
  og_title: '', og_description: '', og_image: '', canonical: '',
  no_index: false, json_ld: '', priority: 0.5, changefreq: 'weekly',
})
const form = ref(defaultForm())

onMounted(() => { loadPages(); loadGlobals() })

async function loadPages() {
  const res = await authFetch('/api/seo/admin/pages')
  pages.value = await res.json()
}

async function loadGlobals() {
  const res = await authFetch('/api/seo/admin/globals')
  globals.value = await res.json()
}

function editPage(p: SeoPage) {
  editingPage.value = p
  form.value = {
    path: p.path, title: p.title, description: p.description, keywords: p.keywords,
    og_title: p.og_title, og_description: p.og_description, og_image: p.og_image,
    canonical: p.canonical, no_index: !!p.no_index, json_ld: p.json_ld,
    priority: p.priority, changefreq: p.changefreq,
  }
  showForm.value = true
}

function closeForm() {
  showForm.value = false
  editingPage.value = null
  form.value = defaultForm()
}

async function savePage() {
  const body = { ...form.value }
  if (editingPage.value) {
    await authFetch(`/api/seo/admin/pages/${editingPage.value.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
  } else {
    await authFetch('/api/seo/admin/pages', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
  }
  closeForm()
  loadPages()
}

async function deletePage(id: string) {
  if (!confirm('确定删除？')) return
  await authFetch(`/api/seo/admin/pages/${id}`, { method: 'DELETE' })
  loadPages()
}

async function saveGlobals() {
  savingGlobals.value = true
  await authFetch('/api/seo/admin/globals', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(globals.value),
  })
  savingGlobals.value = false
}

// SSG Generate
interface GenerateResult {
  success: boolean
  generated: string[]
  errors: string[]
  outputDir: string
}

const generating = ref(false)
const generateResult = ref<GenerateResult | null>(null)

async function handleGenerate() {
  generating.value = true
  generateResult.value = null
  try {
    const res = await authFetch('/api/seo/admin/generate', { method: 'POST' })
    generateResult.value = await res.json()
  } catch (e: any) {
    generateResult.value = { success: false, generated: [], errors: [e.message || 'Network error'], outputDir: '' }
  }
  generating.value = false
}
</script>

<style scoped>
/* 使用 AdminLayout 注入的全局 Brutalist 样式，移除重复样式 */
.seo-admin { max-width: 1200px; }
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
  font-family: var(--font-mono); 
  font-size: 14px; 
  font-weight: bold;
  text-transform: uppercase;
  cursor: pointer; 
  color: var(--c-text-sub); 
  margin-bottom: -2px; 
  transition: all 0.2s;
}
.section-tabs button:hover { color: var(--c-text-main); }
.section-tabs button.active { 
  color: var(--c-text-main); 
  border: 2px solid var(--c-text-main); 
  border-bottom-color: #fff; 
  background: #fff; 
}

.section-header { 
  display: flex; 
  justify-content: space-between; 
  align-items: flex-end; 
  margin-bottom: 24px; 
}
.section-header h2 { font-size: 24px; margin: 0; }

.data-table code { background: #f5f5f5; padding: 4px 8px; border: 1px solid var(--c-border); font-family: var(--font-mono); font-size: 11px; }
.title-cell { max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: bold; }
.desc-cell { max-width: 200px; color: var(--c-text-sub); font-size: 12px; }

.badge-red { background: #fef2f2; color: #991b1b; }

.tips { 
  margin-top: 24px; 
  padding: 24px; 
  background: #f8f8f8; 
  border: 2px dashed var(--c-text-main);
  font-family: var(--font-mono);
  font-size: 13px; 
  color: var(--c-text-sub); 
  line-height: 1.8; 
}
.tips a { color: var(--c-blue-primary); text-decoration: none; font-weight: bold; }
.tips a:hover { text-decoration: underline; }

.globals-form { max-width: 600px; }

.modal-wide { width: 640px; padding: 0; }
.modal-wide h3 { padding: 24px 32px; margin: 0; border-bottom: 2px solid var(--c-text-main); background: #f8f8f8; }
.form-grid { padding: 24px 32px; }
.form-grid .form-row small { font-family: var(--font-mono); font-size: 11px; color: var(--c-text-sub); display: block; margin-top: 4px; }
.form-grid .form-row small.warn { color: #dc2626; font-weight: bold; }
.form-row-inline { display: flex; gap: 24px; }
.form-row-inline .form-row { flex: 1; }
.form-checks { margin: 16px 0; font-family: var(--font-mono); font-size: 13px; font-weight: bold; }
.form-checks label { display: flex; align-items: center; gap: 8px; cursor: pointer; margin-bottom: 0 !important; }

.generate-info { 
  background: #f8f8f8; 
  border: 2px solid var(--c-text-main);
  padding: 24px; 
  margin-bottom: 32px; 
  font-size: 14px; 
  line-height: 1.8; 
}
.generate-info ul { margin: 16px 0; padding-left: 24px; }
.generate-info li { margin: 8px 0; }
.generate-info .note { margin-top: 16px; color: var(--c-text-sub); font-family: var(--font-mono); font-size: 13px; font-weight: bold; }
.generate-info code { background: #fff; padding: 2px 6px; border: 1px solid var(--c-text-main); font-family: var(--font-mono); font-size: 12px; }

.btn-generate { 
  padding: 16px 32px; 
  background: #10b981; 
  color: #fff; 
  border: 2px solid #10b981; 
  font-family: var(--font-mono);
  font-size: 16px; 
  font-weight: bold; 
  text-transform: uppercase;
  cursor: pointer; 
  transition: all 0.2s; 
  box-shadow: 6px 6px 0 var(--c-text-main);
}
.btn-generate:hover { 
  transform: translate(-2px, -2px);
  box-shadow: 8px 8px 0 var(--c-text-main);
}
.btn-generate:disabled { opacity: 0.6; cursor: not-allowed; transform: none; box-shadow: none; }

.generate-result { 
  margin-top: 32px; 
  padding: 24px; 
  border: 2px solid var(--c-text-main); 
  font-size: 14px; 
}
.generate-result.success { background: #ecfdf5; box-shadow: 8px 8px 0 #10b981; }
.generate-result.error { background: #fef2f2; box-shadow: 8px 8px 0 #dc2626; }
.generate-result h4 { margin: 0 0 16px; font-size: 18px; font-family: var(--font-serif); font-weight: 700; text-transform: uppercase; }
.result-section { margin: 12px 0; }
.result-section ul { padding-left: 24px; margin: 8px 0; }
.result-section li { margin: 4px 0; font-family: var(--font-mono); font-size: 13px; }
.result-section code { background: #fff; padding: 2px 6px; border: 1px solid var(--c-text-main); }
.error-list li { color: #dc2626; font-weight: bold; }
.result-dir { margin-top: 24px; color: var(--c-text-sub); font-family: var(--font-mono); font-size: 13px; font-weight: bold; }
.result-dir code { background: #fff; padding: 4px 8px; border: 1px solid var(--c-text-main); color: var(--c-text-main); }
</style>
