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
    <div class="modal-overlay" v-if="showForm" @click.self="closeForm">
      <div class="modal modal-wide">
        <h3>{{ editingPage ? '编辑页面 SEO' : '添加页面 SEO' }}</h3>
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
          <div class="form-actions">
            <button type="button" class="btn-cancel" @click="closeForm">取消</button>
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
.seo-admin { max-width: 1200px; }
.section-tabs { display: flex; gap: 0; margin-bottom: 24px; border-bottom: 2px solid #e5e7eb; }
.section-tabs button { padding: 12px 24px; background: none; border: none; font-size: 14px; cursor: pointer; color: #666; border-bottom: 2px solid transparent; margin-bottom: -2px; }
.section-tabs button.active { color: #0052ff; border-bottom-color: #0052ff; font-weight: 600; }

.section-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
.section-header h2 { font-size: 18px; font-family: -apple-system, sans-serif; font-weight: 600; }

.data-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.data-table th { text-align: left; padding: 10px 12px; border-bottom: 1px solid #e5e7eb; color: #666; font-weight: 500; }
.data-table td { padding: 10px 12px; border-bottom: 1px solid #f0f0f0; vertical-align: middle; }
.data-table code { background: #f5f5f5; padding: 2px 6px; border-radius: 3px; font-size: 12px; }
.title-cell { max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.desc-cell { max-width: 200px; color: #666; font-size: 12px; }

.badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 11px; }
.badge-green { background: #dcfce7; color: #166534; }
.badge-red { background: #fef2f2; color: #991b1b; }

.btn-primary { padding: 8px 16px; background: #0052ff; color: #fff; border: none; border-radius: 6px; font-size: 13px; cursor: pointer; }
.btn-primary:hover { background: #0044d4; }
.btn-primary:disabled { opacity: 0.6; }
.btn-sm { padding: 4px 10px; background: #f5f5f5; border: 1px solid #e5e7eb; border-radius: 4px; font-size: 12px; cursor: pointer; margin-right: 4px; }
.btn-sm:hover { background: #e5e7eb; }
.btn-danger { color: #dc2626; }
.btn-cancel { padding: 8px 16px; background: #f5f5f5; border: 1px solid #e5e7eb; border-radius: 6px; font-size: 13px; cursor: pointer; }

.tips { margin-top: 20px; padding: 16px; background: #f9fafb; border-radius: 8px; font-size: 13px; color: #666; line-height: 1.8; }
.tips a { color: #0052ff; }

.globals-form { max-width: 600px; }
.globals-form .form-row { margin-bottom: 16px; }
.globals-form .form-row label { display: block; font-size: 13px; font-weight: 500; margin-bottom: 4px; }
.globals-form .form-row input, .globals-form .form-row textarea { width: 100%; padding: 8px 12px; border: 1px solid #e5e7eb; border-radius: 6px; font-size: 14px; }
.globals-form .form-row input:focus, .globals-form .form-row textarea:focus { outline: none; border-color: #0052ff; }
.globals-form .form-row small { display: block; font-size: 11px; color: #999; margin-top: 4px; }

.modal-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; z-index: 1000; }
.modal { background: #fff; border-radius: 12px; padding: 28px; max-height: 85vh; overflow-y: auto; }
.modal-wide { width: 640px; }
.modal h3 { margin: 0 0 20px; font-size: 16px; font-family: -apple-system, sans-serif; }

.form-grid .form-row { margin-bottom: 12px; }
.form-grid .form-row label { display: block; font-size: 12px; color: #333; margin-bottom: 4px; font-weight: 500; }
.form-grid .form-row label small { color: #999; font-weight: 400; }
.form-grid .form-row input, .form-grid .form-row textarea, .form-grid .form-row select {
  width: 100%; padding: 8px 12px; border: 1px solid #e5e7eb; border-radius: 6px; font-size: 13px;
}
.form-grid .form-row input:focus, .form-grid .form-row textarea:focus { outline: none; border-color: #0052ff; }
.form-grid .form-row small { font-size: 11px; color: #999; }
.form-grid .form-row small.warn { color: #dc2626; }
.form-row-inline { display: flex; gap: 16px; }
.form-row-inline .form-row { flex: 1; }
.form-checks { margin: 12px 0; font-size: 13px; }
.form-checks label { display: flex; align-items: center; gap: 6px; cursor: pointer; }
.form-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }

.generate-info { background: #f9fafb; border-radius: 8px; padding: 20px; margin-bottom: 24px; font-size: 14px; line-height: 1.8; }
.generate-info ul { margin: 12px 0; padding-left: 20px; }
.generate-info li { margin: 6px 0; }
.generate-info .note { margin-top: 12px; color: #666; font-size: 13px; }
.generate-info code { background: #e5e7eb; padding: 2px 6px; border-radius: 3px; font-size: 12px; }

.btn-generate { padding: 12px 32px; background: #10b981; color: #fff; border: none; border-radius: 8px; font-size: 15px; font-weight: 600; cursor: pointer; transition: background 0.2s; }
.btn-generate:hover { background: #059669; }
.btn-generate:disabled { opacity: 0.6; cursor: not-allowed; }

.generate-result { margin-top: 24px; padding: 20px; border-radius: 8px; font-size: 13px; }
.generate-result.success { background: #ecfdf5; border: 1px solid #a7f3d0; }
.generate-result.error { background: #fef2f2; border: 1px solid #fecaca; }
.generate-result h4 { margin: 0 0 12px; font-size: 15px; font-family: -apple-system, sans-serif; font-weight: 600; }
.result-section { margin: 8px 0; }
.result-section ul { padding-left: 18px; margin: 4px 0; }
.result-section li { margin: 2px 0; }
.result-section code { background: rgba(0,0,0,0.05); padding: 1px 5px; border-radius: 3px; }
.error-list li { color: #dc2626; }
.result-dir { margin-top: 12px; color: #666; font-size: 12px; }
.result-dir code { background: #e5e7eb; padding: 2px 6px; border-radius: 3px; }
</style>
