<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { apiGet, apiPost, apiPatch, apiPut, apiDelete } from '../../lib/api'
import { getToken } from '../../lib/auth'
import { openLoginModal } from '../../lib/loginModal'
import SiteHeader from '../../components/common/SiteHeader.vue'
import SiteFooter from '../../components/common/SiteFooter.vue'
import TenderSdkGuide from '../../components/tender/TenderSdkGuide.vue'

const route = useRoute()
const router = useRouter()
const locale = computed(() => route.path.startsWith('/en/') ? 'en' : 'zh')
const prefix = computed(() => locale.value === 'en' ? '/en/tender' : '/tender')

const activeTab = ref<'preferences' | 'sdk'>('preferences')

// Keywords
const keywords = ref<any[]>([])
const keywordPool = ref<any[]>([])
const selectedPoolKeyword = ref('')
const newWeight = ref(1.0)

// Clients
const clients = ref<any[]>([])
const newClient = ref({ name: '', score: 5, credit: 'normal', notes: '' })

// Preferences
const preferences = ref({
  budgetMin: 0,
  budgetMax: 0,
  allowBelowMinForVip: false,
  preferredRegions: [] as string[],
  acceptableRegions: [] as string[],
  excludedRegions: [] as string[],
  qualifications: [] as string[],
  caseTags: [] as string[],
  excludedTypes: [] as string[],
  platforms: [] as string[],
})
const platforms = ref<any[]>([])
const newPreferredRegion = ref('')
const newAcceptableRegion = ref('')
const newQualification = ref('')
const newCaseTag = ref('')
const newExcludedType = ref('')

const loading = ref(false)

onMounted(() => {
  if (!getToken()) {
    openLoginModal(window.location.pathname, '标讯配置需要登录')
    return
  }
  if (route.query.tab === 'sdk') activeTab.value = 'sdk'
  loadSettings()
})

async function loadSettings() {
  loading.value = true
  try {
    const [kws, cls, pref, pool, plats] = await Promise.all([
      apiGet('/api/tender/keywords'),
      apiGet('/api/tender/clients'),
      apiGet('/api/tender/preferences'),
      apiGet('/api/tender/keyword-pool'),
      apiGet('/api/tender/platforms'),
    ])
    keywords.value = kws
    clients.value = cls
    // 老用户的 preferences 里可能没有 platforms 字段，兜一层避免 v-model 绑到 undefined
    preferences.value = { ...pref, platforms: pref.platforms || [] }
    keywordPool.value = pool
    platforms.value = plats
  } catch (e: any) {
    console.error(e)
  } finally {
    loading.value = false
  }
}

function goBrowse() {
  router.push(`${prefix.value}/browse`)
}

// Keywords
async function addKeyword() {
  if (!selectedPoolKeyword.value) return
  const alreadyAdded = keywords.value.some(k => k.keyword === selectedPoolKeyword.value)
  if (alreadyAdded) { alert(locale.value === 'en' ? 'Already added' : '已添加该关键词'); return }
  try {
    await apiPost('/api/tender/keywords', { keyword: selectedPoolKeyword.value, weight: newWeight.value })
  } catch (e: any) {
    alert(e?.message || (locale.value === 'en' ? 'Failed to add keyword' : '添加失败'))
    return
  }
  selectedPoolKeyword.value = ''
  newWeight.value = 1.0
  keywords.value = await apiGet('/api/tender/keywords')
}

function togglePlatform(id: string, checked: boolean) {
  const list = preferences.value.platforms
  const i = list.indexOf(id)
  if (checked && i === -1) list.push(id)
  if (!checked && i !== -1) list.splice(i, 1)
}

async function deleteKeyword(id: string) {
  await apiDelete(`/api/tender/keywords/${id}`)
  keywords.value = keywords.value.filter(k => k.id !== id)
}

async function toggleKeyword(id: string, enabled: boolean) {
  await apiPatch(`/api/tender/keywords/${id}`, { enabled })
  const item = keywords.value.find(k => k.id === id)
  if (item) item.enabled = enabled ? 1 : 0
}

// Clients
async function addClient() {
  if (!newClient.value.name.trim()) return
  await apiPost('/api/tender/clients', {
    clientName: newClient.value.name.trim(),
    relationshipScore: newClient.value.score,
    paymentCredit: newClient.value.credit,
    notes: newClient.value.notes,
  })
  newClient.value = { name: '', score: 5, credit: 'normal', notes: '' }
  clients.value = await apiGet('/api/tender/clients')
}

async function deleteClient(id: string) {
  await apiDelete(`/api/tender/clients/${id}`)
  clients.value = clients.value.filter(c => c.id !== id)
}

// Preferences
async function savePreferences() {
  await apiPut('/api/tender/preferences', preferences.value)
  alert(locale.value === 'en' ? 'Saved' : '已保存')
}

function addPreferredRegion() { if (newPreferredRegion.value.trim()) { preferences.value.preferredRegions.push(newPreferredRegion.value.trim()); newPreferredRegion.value = '' } }
function addAcceptableRegion() { if (newAcceptableRegion.value.trim()) { preferences.value.acceptableRegions.push(newAcceptableRegion.value.trim()); newAcceptableRegion.value = '' } }
function addCaseTag() { if (newCaseTag.value.trim()) { preferences.value.caseTags.push(newCaseTag.value.trim()); newCaseTag.value = '' } }
function addQualification() { if (newQualification.value.trim()) { preferences.value.qualifications.push(newQualification.value.trim()); newQualification.value = '' } }
function addExcludedType() { if (newExcludedType.value.trim()) { preferences.value.excludedTypes.push(newExcludedType.value.trim()); newExcludedType.value = '' } }

function removeFromArray(arr: string[], index: number) {
  arr.splice(index, 1)
}
</script>

<template>
  <div class="page-wrapper">
    <SiteHeader />
    <main class="tender-page">
      <div class="tender-container">

        <!-- Header -->
        <div class="dashboard-header">
          <div class="header-titles">
            <router-link :to="prefix" class="module-back">← {{ locale === 'en' ? 'Bid Recommendations' : '标讯智能推荐' }}</router-link>
            <h1 class="hero-title">
              {{ locale === 'en' ? 'Configuration' : '配置设定' }}
            </h1>
            <p class="tender-subtitle">{{ locale === 'en' ? 'Tune what AI matches for you, and embed it elsewhere.' : '调整 AI 的匹配依据，以及把推荐嵌到别处。' }}</p>
          </div>

          <div class="header-controls">
            <div class="tender-tabs">
              <button :class="{ active: activeTab === 'preferences' }" @click="activeTab = 'preferences'">
                {{ locale === 'en' ? 'My Preferences' : '个人配置' }}
              </button>
              <button :class="{ active: activeTab === 'sdk' }" @click="activeTab = 'sdk'">
                {{ locale === 'en' ? 'Get SDK' : '获取 SDK' }}
              </button>
            </div>

            <button class="link-btn" @click="goBrowse">
              {{ locale === 'en' ? 'Browse Tenders →' : '查看标讯 →' }}
            </button>
          </div>
        </div>

        <!-- Preferences Tab -->
        <div v-if="activeTab === 'preferences'" class="tab-content settings-content">
          <!-- Platforms Section -->
          <section class="settings-section">
            <h2>{{ locale === 'en' ? 'Sources' : '关注平台' }}</h2>
            <p class="section-desc">
              {{ locale === 'en'
                ? 'Only checked sources are scored and pushed to you. Check none to include all.'
                : '只有勾选的平台才会参与 AI 评分和飞书推送。一个都不勾 = 不限平台（全部参与）。' }}
            </p>
            <div class="platform-list">
              <label v-for="p in platforms" :key="p.id" class="platform-item">
                <input
                  type="checkbox"
                  :checked="preferences.platforms.includes(p.id)"
                  @change="togglePlatform(p.id, ($event.target as HTMLInputElement).checked)"
                />
                <span class="platform-name">{{ p.name }}</span>
                <span class="platform-desc">{{ p.description }}</span>
              </label>
            </div>
            <p v-if="preferences.platforms.length === 0" class="section-hint">
              {{ locale === 'en' ? 'Currently including all sources.' : '当前不限平台，全部数据源都会参与评分。' }}
            </p>
            <button class="save-btn" @click="savePreferences">{{ locale === 'en' ? 'Save' : '保存' }}</button>
          </section>

          <!-- Keywords Section -->
          <section class="settings-section">
            <h2>{{ locale === 'en' ? 'Keywords' : '关注关键词' }}</h2>
            <p class="section-desc">{{ locale === 'en' ? 'Select keywords from the predefined list to match against bids' : '从预设关键词中选择，用于匹配标讯标题和内容' }}</p>
            <div class="add-row">
              <select v-model="selectedPoolKeyword" class="keyword-select">
                <option value="" disabled>{{ locale === 'en' ? '-- Select keyword --' : '-- 选择关键词 --' }}</option>
                <option v-for="pk in keywordPool" :key="pk.id" :value="pk.keyword" :disabled="keywords.some(k => k.keyword === pk.keyword)">
                  {{ pk.keyword }}{{ pk.category ? ` (${pk.category})` : '' }}{{ keywords.some(k => k.keyword === pk.keyword) ? (locale === 'en' ? ' ✓' : ' 已添加') : '' }}
                </option>
              </select>
              <select v-model="newWeight">
                <option :value="1.0">{{ locale === 'en' ? 'Normal' : '正常权重' }}</option>
                <option :value="1.5">{{ locale === 'en' ? 'High' : '高权重' }}</option>
                <option :value="-1.0">{{ locale === 'en' ? 'Exclude' : '排除' }}</option>
              </select>
              <button @click="addKeyword">+</button>
            </div>
            <div class="items-list">
              <div v-for="kw in keywords" :key="kw.id" class="item-row">
                <span :class="['kw-tag', { negative: kw.weight < 0, disabled: !kw.enabled }]">{{ kw.keyword }}</span>
                <span class="kw-weight">{{ kw.weight > 0 ? `+${kw.weight}` : kw.weight }}</span>
                <button class="btn-sm" @click="toggleKeyword(kw.id, !kw.enabled)">{{ kw.enabled ? '✓' : '○' }}</button>
                <button class="btn-sm btn-danger" @click="deleteKeyword(kw.id)">×</button>
              </div>
            </div>
            <p class="section-hint">
              {{ locale === 'en'
                ? 'Need a keyword that is not listed? Contact an administrator to add it to the pool.'
                : '想加新词请联系管理员 —— 只有平台关键词池里的词才会被爬取，池外的词不会有数据。' }}
            </p>
          </section>

          <!-- Clients Section -->
          <section class="settings-section">
            <h2>{{ locale === 'en' ? 'Client Relationships' : '客户关系表' }}</h2>
            <p class="section-desc">{{ locale === 'en' ? 'Known purchasers and your relationship with them' : '已知采购人及关系评分' }}</p>
            <div class="add-row client-add">
              <input v-model="newClient.name" :placeholder="locale === 'en' ? 'Purchaser name' : '采购人名称'" />
              <select v-model="newClient.score">
                <option v-for="n in 10" :key="n" :value="n">{{ n }}{{ locale === 'en' ? 'pts' : '分' }}</option>
              </select>
              <select v-model="newClient.credit">
                <option value="normal">{{ locale === 'en' ? 'Normal' : '正常' }}</option>
                <option value="slow">{{ locale === 'en' ? 'Slow pay' : '拖款' }}</option>
                <option value="bad">{{ locale === 'en' ? 'Avoid' : '慎入' }}</option>
              </select>
              <button @click="addClient">+</button>
            </div>
            <div class="items-list">
              <div v-for="cl in clients" :key="cl.id" class="item-row client-row">
                <span class="client-name">{{ cl.client_name }}</span>
                <span class="client-score">{{ cl.relationship_score }}{{ locale === 'en' ? 'pts' : '分' }}</span>
                <span :class="['client-credit', cl.payment_credit]">{{ cl.payment_credit === 'normal' ? '正常' : cl.payment_credit === 'slow' ? '拖款' : '慎入' }}</span>
                <button class="btn-sm btn-danger" @click="deleteClient(cl.id)">×</button>
              </div>
            </div>
          </section>

          <!-- Preferences Section -->
          <section class="settings-section">
            <h2>{{ locale === 'en' ? 'Preferences' : '偏好设置' }}</h2>

            <div class="pref-group">
              <h3>{{ locale === 'en' ? 'Budget Range (CNY)' : '预算区间（万元）' }}</h3>
              <div class="budget-inputs">
                <input v-model.number="preferences.budgetMin" type="number" :placeholder="locale === 'en' ? 'Min' : '下限'" />
                <span>—</span>
                <input v-model.number="preferences.budgetMax" type="number" :placeholder="locale === 'en' ? 'Max' : '上限'" />
                <label><input type="checkbox" v-model="preferences.allowBelowMinForVip" /> {{ locale === 'en' ? 'Allow below for VIP clients' : '熟客可破下限' }}</label>
              </div>
            </div>

            <div class="pref-group">
              <h3>{{ locale === 'en' ? 'Preferred Regions' : '优先地区' }}</h3>
              <div class="tag-input">
                <input v-model="newPreferredRegion" :placeholder="locale === 'en' ? 'e.g. Guangzhou' : '例：广州'" @keyup.enter="addPreferredRegion()" />
                <button @click="addPreferredRegion()">+</button>
              </div>
              <div class="tags">
                <span v-for="(r, i) in preferences.preferredRegions" :key="i" class="tag">{{ r }} <button @click="removeFromArray(preferences.preferredRegions, i)">×</button></span>
              </div>
            </div>

            <div class="pref-group">
              <h3>{{ locale === 'en' ? 'Case Tags' : '案例标签' }}</h3>
              <div class="tag-input">
                <input v-model="newCaseTag" :placeholder="locale === 'en' ? 'e.g. Brand Campaign' : '例：品牌全案'" @keyup.enter="addCaseTag()" />
                <button @click="addCaseTag()">+</button>
              </div>
              <div class="tags">
                <span v-for="(t, i) in preferences.caseTags" :key="i" class="tag">{{ t }} <button @click="removeFromArray(preferences.caseTags, i)">×</button></span>
              </div>
            </div>

            <div class="pref-group">
              <h3>{{ locale === 'en' ? 'Qualifications' : '公司资质' }}</h3>
              <div class="tag-input">
                <input v-model="newQualification" :placeholder="locale === 'en' ? 'e.g. ISO9001' : '例：ISO9001'" @keyup.enter="addQualification()" />
                <button @click="addQualification()">+</button>
              </div>
              <div class="tags">
                <span v-for="(q, i) in preferences.qualifications" :key="i" class="tag">{{ q }} <button @click="removeFromArray(preferences.qualifications, i)">×</button></span>
              </div>
            </div>

            <div class="pref-group">
              <h3>{{ locale === 'en' ? 'Excluded Types' : '不接类型' }}</h3>
              <div class="tag-input">
                <input v-model="newExcludedType" :placeholder="locale === 'en' ? 'e.g. Billboard' : '例：标识标牌'" @keyup.enter="addExcludedType()" />
                <button @click="addExcludedType()">+</button>
              </div>
              <div class="tags">
                <span v-for="(t, i) in preferences.excludedTypes" :key="i" class="tag tag-negative">{{ t }} <button @click="removeFromArray(preferences.excludedTypes, i)">×</button></span>
              </div>
            </div>

            <button class="save-btn" @click="savePreferences">{{ locale === 'en' ? 'Save Preferences' : '保存偏好设置' }}</button>
          </section>
        </div>

        <!-- SDK Tab -->
        <div v-if="activeTab === 'sdk'" class="tab-content sdk-content">
          <TenderSdkGuide />
        </div>
      </div>
    </main>
    <SiteFooter />
  </div>
</template>

<style scoped>
.page-wrapper {
  --font-sans: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --color-text: #111827;
  --color-muted: #6b7280;
  --color-soft: #9ca3af;
  --color-bg-elevated: #ffffff;
  --color-border: #e5e7eb;
  --color-border-strong: #d1d5db;
  --color-fill: #f9fafb;
  --color-fill-strong: #f3f4f6;
  --shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
  --primary-color: #0f172a;

  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background-color: #f8fafc;
  background-image:
    radial-gradient(at 50% 0%, #ffffff 0%, transparent 70%),
    radial-gradient(#cbd5e1 1px, transparent 1px);
  background-size: 100% 100%, 24px 24px;
  background-attachment: fixed;
  color: var(--color-text);
  font-family: var(--font-sans);
  position: relative;
  overflow-x: hidden;
}

.tender-page {
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 80px 40px 64px;
  z-index: 1;
}

.tender-container {
  width: 100%;
  flex: 1;
  display: flex;
  flex-direction: column;
}

.dashboard-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 24px;
  padding: 0 0 20px 0;
  margin-bottom: 24px;
  border-bottom: 1px solid var(--color-border-strong);
}

.header-titles {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.module-back {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-muted);
  text-decoration: none;
}

.module-back:hover {
  color: var(--color-text);
}

.hero-title {
  margin: 0;
  font-size: 28px;
  font-weight: 700;
  line-height: 1.2;
  letter-spacing: -0.02em;
  color: var(--color-text);
}

.tender-subtitle {
  margin: 0;
  font-size: 14px;
  font-weight: 500;
  color: var(--color-muted);
}

.header-controls {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 16px;
  flex-wrap: wrap;
  flex: 1;
}

.tender-tabs {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: var(--color-fill);
  padding: 4px;
  border-radius: 8px;
  border: 1px solid var(--color-border);
}

.tender-tabs button {
  min-height: 36px;
  padding: 0 16px;
  border: none;
  border-radius: 6px;
  background: transparent;
  font-family: var(--font-sans);
  font-size: 14px;
  font-weight: 600;
  color: var(--color-muted);
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.2s ease;
}

.tender-tabs button:hover {
  color: var(--color-text);
}

.tender-tabs button.active {
  color: var(--color-text) !important;
  background: var(--color-bg-elevated);
  box-shadow: var(--shadow-sm);
}

.link-btn {
  min-height: 36px;
  padding: 0 14px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg-elevated);
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: 600;
  color: var(--color-muted);
  cursor: pointer;
  white-space: nowrap;
}

.link-btn:hover {
  color: var(--color-text);
  border-color: var(--color-border-strong);
}

/* Settings */
.settings-content {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(500px, 1fr));
  gap: 24px;
}

.sdk-content {
  max-width: 900px;
}

.settings-section {
  padding: 24px;
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  box-shadow: var(--shadow-sm);
}

.settings-section h2 {
  margin: 0 0 8px;
  font-size: 18px;
  font-weight: 600;
  color: var(--color-text);
}

.section-desc {
  margin: 0 0 20px;
  font-size: 13px;
  color: var(--color-muted);
}

.section-hint {
  margin: 12px 0 0;
  font-size: 12px;
  color: var(--color-muted);
  line-height: 1.6;
}

.platform-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.platform-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-bg-elevated);
  cursor: pointer;
}

.platform-item input[type="checkbox"] {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  margin: 0;
  padding: 0;
  cursor: pointer;
}

.platform-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text);
}

.platform-desc {
  font-size: 12px;
  color: var(--color-muted);
}

input, select, textarea {
  height: 36px;
  padding: 0 12px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg-elevated);
  font-size: 13px;
  color: var(--color-text);
  transition: all 0.2s ease;
}

input:focus, select:focus, textarea:focus {
  border-color: var(--primary-color);
  box-shadow: 0 0 0 2px rgba(15, 23, 42, 0.1);
  outline: none;
}

button {
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

button:active {
  transform: translateY(1px);
}

.save-btn,
.add-row button,
.tag-input button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 36px;
  padding: 0 16px;
  border-radius: 6px;
  border: none;
  background: var(--primary-color);
  color: #fff;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}

.save-btn:hover,
.add-row button:hover,
.tag-input button:hover {
  background: #1e293b;
}

.add-row {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(120px, 0.8fr) auto;
  gap: 12px;
  margin-bottom: 20px;
}

.client-add {
  grid-template-columns: minmax(0, 1.8fr) minmax(100px, 0.7fr) minmax(100px, 0.85fr) auto;
}

.items-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.item-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-fill);
}

.kw-tag, .client-name {
  color: var(--color-text);
  font-weight: 500;
  font-size: 13px;
  flex: 1;
}

.kw-tag.negative {
  color: #ef4444;
}

.kw-tag.disabled {
  color: var(--color-soft);
  text-decoration: line-through;
}

.kw-weight, .client-score {
  color: var(--color-muted);
  font-size: 13px;
}

.btn-sm {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 28px;
  min-height: 28px;
  padding: 0 8px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg-elevated);
  color: var(--color-text);
  cursor: pointer;
  font-size: 12px;
}

.btn-sm:hover {
  background: var(--color-fill);
  border-color: var(--color-border-strong);
}

.btn-sm.btn-danger {
  color: #ef4444;
  border-color: #fecaca;
  background: #fef2f2;
}
.btn-sm.btn-danger:hover {
  background: #fee2e2;
  border-color: #fca5a5;
}

.client-credit {
  display: inline-flex;
  align-items: center;
  height: 24px;
  padding: 0 8px;
  font-size: 11px;
  font-weight: 500;
  border-radius: 4px;
}

.client-credit.normal {
  background: var(--color-fill-strong);
  color: var(--color-text);
}

.client-credit.slow {
  background: #fffbeb;
  color: #b45309;
}

.client-credit.bad {
  background: #fef2f2;
  color: #b91c1c;
}

.pref-group {
  margin-bottom: 24px;
  padding: 16px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-fill);
}

.pref-group h3 {
  margin: 0 0 12px;
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text);
}

.budget-inputs, .tag-input {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.budget-inputs label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--color-muted);
  cursor: pointer;
}

.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}

.tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--color-border);
  border-radius: 14px;
  background: var(--color-bg-elevated);
  color: var(--color-text);
  font-size: 12px;
}

.tag button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--color-soft);
  cursor: pointer;
}

.tag button:hover {
  color: #ef4444;
}

.tag-negative {
  background: #fef2f2;
  color: #b91c1c;
  border-color: #fecaca;
}
.tag-negative button:hover { color: #991b1b; }

@media (max-width: 720px) {
  .tender-page {
    padding: 80px 20px 48px;
  }

  .dashboard-header {
    flex-direction: column;
    align-items: stretch;
  }

  .header-controls {
    justify-content: flex-start;
  }

  .tender-tabs {
    width: 100%;
    overflow-x: auto;
  }

  .settings-content {
    grid-template-columns: 1fr;
  }
}
</style>
