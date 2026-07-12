<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import DOMPurify from 'dompurify'
import { apiGet, apiPost, apiPatch, apiPut, apiDelete } from '../../lib/api'
import SiteHeader from '../../components/common/SiteHeader.vue'
import SiteFooter from '../../components/common/SiteFooter.vue'

const route = useRoute()
const locale = computed(() => route.path.startsWith('/en/') ? 'en' : 'zh')

const activeTab = ref<'recommend' | 'browse' | 'settings'>('recommend')
const tierFilter = ref('all')

// Recommendations
const recommendations = ref<any[]>([])
const recTotal = ref(0)
const recPage = ref(1)
const recLoading = ref(false)

// Browse
const tenders = ref<any[]>([])
const browseTotal = ref(0)
const browsePage = ref(1)
const browseSearch = ref('')
const browseKeyword = ref('')
const browseLoading = ref(false)
const usedKeywords = ref<string[]>([])

// Settings - Keywords
const keywords = ref<any[]>([])
const keywordPool = ref<any[]>([])
const selectedPoolKeyword = ref('')
const newWeight = ref(1.0)

// Settings - Clients
const clients = ref<any[]>([])
const newClient = ref({ name: '', score: 5, credit: 'normal', notes: '' })

// Settings - Preferences
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
})
const newPreferredRegion = ref('')
const newAcceptableRegion = ref('')
const newQualification = ref('')
const newCaseTag = ref('')
const newExcludedType = ref('')

// Detail modal
const showDetail = ref(false)
const detailData = ref<any>(null)

const sanitizedHtml = computed(() => {
  if (!detailData.value?.content_html) return ''
  return DOMPurify.sanitize(detailData.value.content_html, {
    ALLOWED_TAGS: ['p', 'br', 'b', 'i', 'em', 'strong', 'a', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'div', 'span', 'img'],
    FORBID_ATTR: ['style', 'class'] // remove inline styles and classes to use our own clean CSS
  })
})

const tierLabels: Record<string, { zh: string; en: string; icon: string }> = {
  priority: { zh: '优先跟', en: 'Priority', icon: '🔥' },
  consider: { zh: '可考虑', en: 'Consider', icon: '🟡' },
  watch: { zh: '观望', en: 'Watch', icon: '⚠️' },
  filter: { zh: '过滤', en: 'Filtered', icon: '❌' },
}

onMounted(() => {
  loadRecommendations()
})

async function loadRecommendations() {
  recLoading.value = true
  try {
    const data = await apiGet('/api/tender/recommendations', { tier: tierFilter.value, page: recPage.value, page_size: 20 })
    recommendations.value = data.items
    recTotal.value = data.total
  } catch (e: any) {
    console.error(e)
  } finally {
    recLoading.value = false
  }
}

async function loadUsedKeywords() {
  try {
    usedKeywords.value = await apiGet('/api/tender/keywords-used')
  } catch {}
}

async function loadTenders() {
  browseLoading.value = true
  try {
    const params: any = { search: browseSearch.value, page: browsePage.value, page_size: 20 }
    if (browseKeyword.value) params.keyword = browseKeyword.value
    const data = await apiGet('/api/tender/list', params)
    tenders.value = data.items
    browseTotal.value = data.total
  } catch (e: any) {
    console.error(e)
  } finally {
    browseLoading.value = false
  }
}

async function loadSettings() {
  const [kws, cls, pref, pool] = await Promise.all([
    apiGet('/api/tender/keywords'),
    apiGet('/api/tender/clients'),
    apiGet('/api/tender/preferences'),
    apiGet('/api/tender/keyword-pool'),
  ])
  keywords.value = kws
  clients.value = cls
  preferences.value = pref
  keywordPool.value = pool
}

function switchTab(tab: 'recommend' | 'browse' | 'settings') {
  activeTab.value = tab
  if (tab === 'recommend') loadRecommendations()
  else if (tab === 'browse') { loadTenders(); loadUsedKeywords() }
  else if (tab === 'settings') loadSettings()
}

async function viewDetail(id: string) {
  try {
    detailData.value = await apiGet(`/api/tender/detail/${id}`)
    showDetail.value = true
  } catch (e: any) {
    alert(e.message)
  }
}

async function markRead(id: string) {
  await apiPatch(`/api/tender/recommendations/${id}/read`, {})
  const item = recommendations.value.find(r => r.id === id)
  if (item) item.is_read = 1
}

// Keywords
async function addKeyword() {
  if (!selectedPoolKeyword.value) return
  const alreadyAdded = keywords.value.some(k => k.keyword === selectedPoolKeyword.value)
  if (alreadyAdded) { alert(locale.value === 'en' ? 'Already added' : '已添加该关键词'); return }
  await apiPost('/api/tender/keywords', { keyword: selectedPoolKeyword.value, weight: newWeight.value })
  selectedPoolKeyword.value = ''
  newWeight.value = 1.0
  keywords.value = await apiGet('/api/tender/keywords')
}

async function deleteKeyword(id: string) {
  await apiDelete(`/api/tender/keywords/${id}`)
  keywords.value = keywords.value.filter(k => k.id !== id)
}

async function toggleKeyword(id: string, enabled: boolean) {
  await apiPatch(`/api/tender/keywords/${id}`, { enabled })
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

function formatBudget(amount: number): string {
  if (!amount) return '-'
  if (amount >= 10000) return `${(amount / 10000).toFixed(1)}万`
  return `${amount}元`
}

// Feedback
const showFeedbackDialog = ref(false)
const feedbackTarget = ref<any>(null)
const feedbackType = ref<'suitable' | 'not_suitable'>('suitable')
const feedbackReason = ref('')

function openFeedback(rec: any, type: 'suitable' | 'not_suitable') {
  if (rec.user_feedback === type) return
  feedbackTarget.value = rec
  feedbackType.value = type
  feedbackReason.value = ''
  showFeedbackDialog.value = true
}

async function submitFeedback() {
  if (!feedbackTarget.value) return
  try {
    await apiPost('/api/tender/feedback', {
      tenderId: feedbackTarget.value.tender_id,
      recommendationId: feedbackTarget.value.id,
      feedback: feedbackType.value,
      reason: feedbackReason.value,
    })
    feedbackTarget.value.user_feedback = feedbackType.value
    feedbackTarget.value.feedback_reason = feedbackReason.value
    showFeedbackDialog.value = false
  } catch (e: any) {
    alert(e.message || '提交失败')
  }
}
</script>

<template>
  <div class="page-wrapper">
    <SiteHeader />
    <main class="tender-page">
      <div class="tender-container">
        
        <!-- Compact Header & Controls -->
        <div class="dashboard-header">
          <div class="header-titles">
            <h1 class="hero-title">
              {{ locale === 'en' ? 'Bid Recommendations' : '标讯智能推荐' }}
            </h1>
            <p class="tender-subtitle">{{ locale === 'en' ? 'AI-powered bid matching engine.' : 'AI 驱动的标讯匹配引擎。' }}</p>
          </div>
          
          <div class="header-controls">
            <!-- Filter embedded in header when on recommend tab -->
            <div v-if="activeTab === 'recommend'" class="tier-filter">
              <span class="filter-label">{{ locale === 'en' ? 'Filter:' : '筛选：' }}</span>
              <button :class="{ active: tierFilter === 'all' }" @click="tierFilter = 'all'; loadRecommendations()">{{ locale === 'en' ? 'All' : '全部' }}</button>
              <button :class="{ active: tierFilter === 'priority' }" @click="tierFilter = 'priority'; loadRecommendations()">🔥 {{ locale === 'en' ? 'Priority' : '优先跟' }}</button>
              <button :class="{ active: tierFilter === 'consider' }" @click="tierFilter = 'consider'; loadRecommendations()">🟡 {{ locale === 'en' ? 'Consider' : '可考虑' }}</button>
              <button :class="{ active: tierFilter === 'watch' }" @click="tierFilter = 'watch'; loadRecommendations()">⚠️ {{ locale === 'en' ? 'Watch' : '观望' }}</button>
            </div>
            
            <!-- Search embedded in header when on browse tab -->
            <div v-if="activeTab === 'browse'" class="browse-search">
              <select v-model="browseKeyword" class="keyword-filter-select" @change="browsePage = 1; loadTenders()">
                <option value="">{{ locale === 'en' ? 'All Keywords' : '全部关键词' }}</option>
                <option v-for="kw in usedKeywords" :key="kw" :value="kw">{{ kw }}</option>
              </select>
              <div class="search-input-wrapper">
                <svg class="search-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                <input v-model="browseSearch" :placeholder="locale === 'en' ? 'Search by title or purchaser...' : '按标题或采购人搜索...'" @keyup.enter="browsePage = 1; loadTenders()" />
              </div>
            </div>

            <div class="tender-tabs">
              <button :class="{ active: activeTab === 'recommend' }" @click="switchTab('recommend')">
                {{ locale === 'en' ? 'My Recommendations' : '我的推荐' }}
              </button>
              <button :class="{ active: activeTab === 'browse' }" @click="switchTab('browse')">
                {{ locale === 'en' ? 'All Tenders' : '全部标讯' }}
              </button>
              <button :class="{ active: activeTab === 'settings' }" @click="switchTab('settings')">
                {{ locale === 'en' ? 'My Preferences' : '个人配置' }}
              </button>
            </div>
          </div>
        </div>

        <!-- Recommendations Tab -->
        <div v-if="activeTab === 'recommend'" class="tab-content">
          <div v-if="recLoading" class="loading-state">{{ locale === 'en' ? 'Loading...' : '加载中...' }}</div>
          <div v-else-if="recommendations.length === 0" class="empty-state">
            <p>{{ locale === 'en' ? 'No recommendations yet. Configure your preferences first.' : '暂无推荐，请先配置个人偏好。' }}</p>
          </div>
          <div v-else class="rec-list-v2">
            <div v-for="rec in recommendations" :key="rec.id" :class="['rec-card-v2', rec.tier]" @click="viewDetail(rec.tender_id)">
              <div class="tier-accent"></div>
              
              <div class="rec-main-content">
                <div class="rec-header">
                  <div class="rec-score-block">
                    <span class="score-value">{{ rec.total_score }}</span>
                    <span class="score-label">{{ locale === 'en' ? 'Score' : '匹配度' }}</span>
                  </div>
                  
                  <div class="rec-title-group">
                    <div class="rec-title-row">
                      <h3 class="rec-title">{{ rec.title }}</h3>
                      <span class="tier-badge">{{ tierLabels[rec.tier]?.icon }} {{ locale === 'en' ? tierLabels[rec.tier]?.en : tierLabels[rec.tier]?.zh }}</span>
                    </div>
                    <div class="rec-meta">
                      <template v-if="rec.purchaser_name">
                        <span class="meta-item">{{ rec.purchaser_name }}</span>
                        <span class="meta-divider">·</span>
                      </template>
                      <template v-if="rec.budget_amount">
                        <span class="meta-item meta-budget">{{ formatBudget(rec.budget_amount) }}</span>
                        <span class="meta-divider">·</span>
                      </template>
                      <template v-if="rec.region_name">
                        <span class="meta-item">{{ rec.region_name }}</span>
                        <span class="meta-divider">·</span>
                      </template>
                      <span class="meta-item">{{ rec.publish_date?.slice(0, 10) }}</span>
                    </div>
                  </div>
                </div>

                <div class="rec-ai-insights">
                  <div class="insight-row" v-if="rec.ai_reason">
                    <svg class="insight-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M12 16v-4"></path><path d="M12 8h.01"></path></svg>
                    <p><strong>{{ locale === 'en' ? 'Reason: ' : '推荐理由：' }}</strong>{{ rec.ai_reason }}</p>
                  </div>
                  <div class="insight-row" v-if="rec.ai_strategy">
                    <svg class="insight-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>
                    <p><strong>{{ locale === 'en' ? 'Strategy: ' : '投标思路：' }}</strong>{{ rec.ai_strategy }}</p>
                  </div>
                  <div class="insight-row risk" v-if="rec.risk_notes">
                    <svg class="insight-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
                    <p><strong>{{ locale === 'en' ? 'Risk: ' : '风险提示：' }}</strong>{{ rec.risk_notes }}</p>
                  </div>
                </div>
              </div>

              <div class="rec-footer-v2">
                <div class="score-breakdown">
                  <div class="sub-score"><span>{{ locale === 'en' ? 'Biz' : '业务' }}</span><strong>{{ rec.score_business }}</strong></div>
                  <div class="sub-score"><span>{{ locale === 'en' ? 'Budget' : '预算' }}</span><strong>{{ rec.score_budget }}</strong></div>
                  <div class="sub-score"><span>{{ locale === 'en' ? 'Region' : '地区' }}</span><strong>{{ rec.score_region }}</strong></div>
                  <div class="sub-score"><span>{{ locale === 'en' ? 'Rel' : '关系' }}</span><strong>{{ rec.score_relationship }}</strong></div>
                </div>
                <div class="rec-feedback-v2" @click.stop>
                  <button
                    :class="['feedback-btn', 'suitable', { active: rec.user_feedback === 'suitable' }]"
                    @click="openFeedback(rec, 'suitable')"
                  >{{ locale === 'en' ? '👍 Suitable' : '👍 适合' }}</button>
                  <button
                    :class="['feedback-btn', 'not-suitable', { active: rec.user_feedback === 'not_suitable' }]"
                    @click="openFeedback(rec, 'not_suitable')"
                  >{{ locale === 'en' ? '👎 Not suitable' : '👎 不适合' }}</button>
                  <span v-if="rec.user_feedback" class="feedback-reason-hint">{{ rec.feedback_reason }}</span>
                </div>
              </div>
            </div>
          </div>

          <div v-if="recTotal > 20" class="pagination">
            <button :disabled="recPage <= 1" @click="recPage--; loadRecommendations()">{{ locale === 'en' ? 'Prev' : '上一页' }}</button>
            <span>{{ recPage }} / {{ Math.ceil(recTotal / 20) }}</span>
            <button :disabled="recPage * 20 >= recTotal" @click="recPage++; loadRecommendations()">{{ locale === 'en' ? 'Next' : '下一页' }}</button>
          </div>
        </div>

        <!-- Browse Tab -->
        <div v-if="activeTab === 'browse'" class="tab-content">
          <div v-if="browseLoading" class="loading-state">{{ locale === 'en' ? 'Loading...' : '加载中...' }}</div>
          <div v-else-if="tenders.length === 0" class="empty-state">
            <p>{{ locale === 'en' ? 'No tenders found.' : '暂无标讯数据。' }}</p>
          </div>
          <div v-else class="tender-list">
            <div v-for="tender in tenders" :key="tender.id" class="tender-card" @click="viewDetail(tender.id)">
              <h3>{{ tender.title }}</h3>
              <div class="tender-meta">
                <template v-if="tender.purchaser_name">
                  <span class="meta-item">{{ tender.purchaser_name }}</span>
                  <span class="meta-divider">·</span>
                </template>
                <template v-if="tender.budget_amount">
                  <span class="meta-item meta-budget">{{ formatBudget(tender.budget_amount) }}</span>
                  <span class="meta-divider">·</span>
                </template>
                <template v-if="tender.region_name">
                  <span class="meta-item">{{ tender.region_name }}</span>
                  <span class="meta-divider">·</span>
                </template>
                <span class="meta-item">{{ tender.publish_date?.slice(0, 10) }}</span>
                <template v-if="tender.notice_type">
                  <span class="meta-divider">·</span>
                  <span class="meta-item">{{ tender.notice_type }}</span>
                </template>
              </div>
            </div>
          </div>

          <div v-if="browseTotal > 20" class="pagination">
            <button :disabled="browsePage <= 1" @click="browsePage--; loadTenders()">{{ locale === 'en' ? 'Prev' : '上一页' }}</button>
            <span>{{ browsePage }} / {{ Math.ceil(browseTotal / 20) }}</span>
            <button :disabled="browsePage * 20 >= browseTotal" @click="browsePage++; loadTenders()">{{ locale === 'en' ? 'Next' : '下一页' }}</button>
          </div>
        </div>

        <!-- Settings Tab -->
        <div v-if="activeTab === 'settings'" class="tab-content settings-content">
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
      </div>

      <!-- Detail Modal -->
      <Teleport to="body">
        <div v-if="showDetail && detailData" class="modal-overlay" @click.self="showDetail = false">
          <div class="modal-dialog">
            <div class="modal-header">
              <h2 class="modal-title">{{ detailData.title }}</h2>
              <button class="modal-close" @click="showDetail = false">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>
            </div>
            
            <div class="modal-body">
              <div class="detail-meta-box">
                <div class="meta-item" v-if="detailData.purchaser_name">
                  <strong>{{ locale === 'en' ? 'Purchaser' : '采购人' }}</strong>
                  <span>{{ detailData.purchaser_name }}</span>
                </div>
                <div class="meta-item" v-if="detailData.budget">
                  <strong>{{ locale === 'en' ? 'Budget' : '预算' }}</strong>
                  <span>{{ detailData.budget }}</span>
                </div>
                <div class="meta-item" v-if="detailData.region_name">
                  <strong>{{ locale === 'en' ? 'Region' : '地区' }}</strong>
                  <span>{{ detailData.region_name }}</span>
                </div>
                <div class="meta-item" v-if="detailData.publish_date">
                  <strong>{{ locale === 'en' ? 'Published' : '发布日期' }}</strong>
                  <span>{{ detailData.publish_date?.slice(0, 10) }}</span>
                </div>
                <div class="meta-item" v-if="detailData.notice_type">
                  <strong>{{ locale === 'en' ? 'Type' : '类型' }}</strong>
                  <span>{{ detailData.notice_type }}</span>
                </div>
                <div class="meta-item" v-if="detailData.contact_name">
                  <strong>{{ locale === 'en' ? 'Contact' : '联系人' }}</strong>
                  <span>{{ detailData.contact_name }} {{ detailData.contact_phone }}</span>
                </div>
              </div>

              <div class="content-header">
                <h3 class="section-title">{{ locale === 'en' ? 'Content' : '正文' }}</h3>
                <a v-if="detailData.url" :href="detailData.url" target="_blank" class="original-link-btn">
                  {{ locale === 'en' ? 'View Original Document' : '查看原文' }}
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
                </a>
              </div>

              <div v-if="sanitizedHtml" class="detail-content">
                <div class="tender-html-content" v-html="sanitizedHtml"></div>
              </div>
              <div v-else-if="detailData.content_text" class="detail-content">
                <p class="tender-text-content">{{ detailData.content_text.slice(0, 2000) }}</p>
              </div>
            </div>
          </div>
        </div>
      </Teleport>

      <!-- Feedback Dialog -->
      <Teleport to="body">
        <div v-if="showFeedbackDialog" class="modal-overlay" @click.self="showFeedbackDialog = false">
          <div class="feedback-dialog">
            <div class="feedback-dialog-header">
              <h3>{{ feedbackType === 'suitable' ? (locale === 'en' ? 'Mark as Suitable' : '标记为适合') : (locale === 'en' ? 'Mark as Not Suitable' : '标记为不适合') }}</h3>
              <button class="modal-close" @click="showFeedbackDialog = false">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>
            </div>
            <div class="feedback-dialog-body">
              <p class="feedback-tender-title">{{ feedbackTarget?.title }}</p>
              <label>{{ locale === 'en' ? 'Reason (helps AI learn your preferences):' : '原因（帮助 AI 学习你的偏好）：' }}</label>
              <textarea v-model="feedbackReason" :placeholder="feedbackType === 'suitable' ? (locale === 'en' ? 'e.g. We have strong experience in this category...' : '例：这类活动策划我们团队很擅长...') : (locale === 'en' ? 'e.g. Budget too low, not our expertise...' : '例：预算太低不值得投、不是我们的强项...')" rows="3"></textarea>
            </div>
            <div class="feedback-dialog-footer">
              <button class="btn-cancel" @click="showFeedbackDialog = false">{{ locale === 'en' ? 'Cancel' : '取消' }}</button>
              <button class="btn-confirm" @click="submitFeedback">{{ locale === 'en' ? 'Submit' : '提交' }}</button>
            </div>
          </div>
        </div>
      </Teleport>
    </main>
    <SiteFooter />
  </div>
</template>

<style scoped>
.page-wrapper {
  --font-sans: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Inter, Arial, sans-serif;
  --color-text: #1d1d1f;
  --color-muted: #86868b;
  --color-soft: #d2d2d7;
  --color-bg: #fbfbfd;
  --color-bg-elevated: #ffffff;
  --color-border: rgba(0, 0, 0, 0.05);
  --color-border-strong: rgba(0, 0, 0, 0.1);
  --color-fill: rgba(0, 0, 0, 0.03);
  --color-fill-strong: rgba(0, 0, 0, 0.06);
  --shadow-sm: 0 4px 24px rgba(0, 0, 0, 0.02);
  --shadow-md: 0 8px 32px rgba(0, 0, 0, 0.04);
  --shadow-lg: 0 16px 48px rgba(0, 0, 0, 0.06);
  position: relative;
  min-height: 100vh;
  background: var(--color-bg);
  color: var(--color-text);
  overflow: hidden;
}

.tender-page {
  position: relative;
  padding: 100px 24px 64px;
}

.tender-container {
  position: relative;
  max-width: 1024px;
  margin: 0 auto;
}

/* Compact Header */
.dashboard-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 24px;
  padding: 0 0 16px 0;
  margin-bottom: 24px;
  border-bottom: 0.5px solid var(--color-border-strong);
}

.header-titles {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.hero-title {
  margin: 0;
  font-family: var(--font-sans);
  font-size: 28px;
  font-weight: 600;
  line-height: 1.1;
  letter-spacing: -0.03em;
  color: var(--color-text);
}

.tender-subtitle {
  margin: 0;
  font-family: var(--font-sans);
  font-size: 13px;
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
  gap: 20px;
  flex-shrink: 0;
}

.tender-tabs button {
  min-height: 32px;
  padding: 0 2px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  font-family: var(--font-sans);
  font-size: 14px;
  font-weight: 500;
  color: var(--color-muted);
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  transition: color 0.2s ease, border-color 0.2s ease;
}

.tender-tabs button:hover {
  color: var(--color-text);
}

.tender-tabs button.active {
  color: var(--color-text) !important;
  border-bottom: 2px solid var(--color-text);
}

.tier-filter {
  display: flex;
  align-items: center;
  gap: 6px;
}

.filter-label {
  display: none;
}

.tier-filter button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 28px;
  padding: 0 12px;
  border: 0.5px solid var(--color-border-strong);
  border-radius: 999px;
  background: var(--color-bg-elevated);
  font-family: var(--font-sans);
  font-size: 12px;
  font-weight: 500;
  color: var(--color-muted);
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  transition: all 0.2s ease;
}

.tier-filter button:hover {
  background: var(--color-fill);
  color: var(--color-text);
}

.tier-filter button.active {
  background: var(--color-text) !important;
  color: #fff !important;
  border-color: var(--color-text) !important;
}

.browse-search {
  display: flex;
  align-items: center;
  gap: 8px;
}

.keyword-filter-select {
  height: 32px;
  padding: 0 12px;
  border: 0.5px solid var(--color-border-strong);
  border-radius: 8px;
  background: var(--color-bg-elevated);
  font-size: 13px;
  color: var(--color-text);
  cursor: pointer;
}

.search-input-wrapper {
  position: relative;
  display: flex;
  align-items: center;
}

.search-icon {
  position: absolute;
  left: 12px;
  z-index: 1;
  color: var(--color-soft);
}

.search-input-wrapper input {
  width: 240px;
  min-height: 32px;
  padding: 0 12px 0 32px;
  border: 0.5px solid var(--color-border-strong);
  border-radius: 8px;
  background: var(--color-bg-elevated);
  outline: none;
  font-family: var(--font-sans);
  font-size: 13px;
  color: var(--color-text);
  transition: width 0.2s ease, border-color 0.2s ease;
}

.search-input-wrapper input:focus {
  width: 280px;
  border-color: var(--color-text);
}

/* Lists */
.rec-list-v2 {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.tender-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* V2 Recommendation Card */
.rec-card-v2 {
  position: relative;
  display: flex;
  flex-direction: column;
  background: var(--color-bg-elevated);
  border: 0.5px solid var(--color-border-strong);
  border-radius: 12px;
  overflow: hidden;
  cursor: pointer;
  transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.2s ease;
  animation: fadeUp 0.4s cubic-bezier(0.16, 1, 0.3, 1) both;
}

.rec-card-v2:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
  border-color: rgba(0, 0, 0, 0.15);
}

.rec-card-v2:active {
  transform: translateY(0);
  box-shadow: var(--shadow-sm);
}

.tier-accent {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: var(--color-soft);
  z-index: 1;
}

.rec-card-v2.priority .tier-accent { background: #ff453a; }
.rec-card-v2.consider .tier-accent { background: #ff9f0a; }
.rec-card-v2.watch .tier-accent { background: #86868b; }
.rec-card-v2.filter .tier-accent { background: #c4412d; }

.rec-main-content {
  padding: 20px 24px;
}

.rec-header {
  display: flex;
  gap: 16px;
  align-items: flex-start;
  margin-bottom: 20px;
}

.rec-score-block {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 60px;
  height: 60px;
  background: var(--color-bg);
  border: 0.5px solid var(--color-border-strong);
  border-radius: 10px;
  flex-shrink: 0;
}

.score-value {
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.04em;
  color: var(--color-text);
  line-height: 1;
}

.score-label {
  font-size: 11px;
  font-weight: 500;
  color: var(--color-muted);
  margin-top: 4px;
}

.rec-title-group {
  flex: 1;
  min-width: 0;
}

.rec-title-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 8px;
}

.rec-title {
  margin: 0;
  font-family: var(--font-sans);
  font-size: 16px;
  font-weight: 600;
  line-height: 1.4;
  letter-spacing: -0.01em;
  color: var(--color-text);
}

.tier-badge {
  font-size: 12px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 6px;
  background: var(--color-fill);
  color: var(--color-muted);
  white-space: nowrap;
  flex-shrink: 0;
}

.rec-card-v2.priority .tier-badge { color: #ff453a; background: rgba(255, 69, 58, 0.1); }
.rec-card-v2.consider .tier-badge { color: #ff9f0a; background: rgba(255, 159, 10, 0.1); }

.rec-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 13px;
  color: var(--color-muted);
}

.meta-budget {
  color: var(--color-text);
  font-weight: 500;
}

.rec-ai-insights {
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: var(--color-bg);
  border-radius: 8px;
  padding: 16px;
  border: 0.5px solid var(--color-border);
}

.insight-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--color-text);
}

.insight-icon {
  flex-shrink: 0;
  color: var(--color-muted);
  margin-top: 2px;
}

.insight-row p {
  margin: 0;
}

.insight-row strong {
  font-weight: 600;
  color: var(--color-text);
}

.insight-row.risk p { color: #b64a26; }
.insight-row.risk .insight-icon { color: #b64a26; }
.insight-row.risk strong { color: #b64a26; }

.rec-footer-v2 {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 24px;
  border-top: 0.5px solid var(--color-border-strong);
  background: #fbfbfd;
}

.score-breakdown {
  display: flex;
  gap: 16px;
}

.sub-score {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}

.sub-score span {
  color: var(--color-muted);
}

.sub-score strong {
  color: var(--color-text);
  font-weight: 600;
}

.rec-feedback-v2 {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* Old Cards fallback for browse tab */
.tender-card {
  position: relative;
  padding: 20px 24px;
  background: var(--color-bg-elevated);
  border: 0.5px solid rgba(0, 0, 0, 0.05);
  border-radius: 16px;
  box-shadow: var(--shadow-sm);
  cursor: pointer;
  transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.2s ease;
  animation: fadeUp 0.4s cubic-bezier(0.16, 1, 0.3, 1) both;
}

.tender-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}

.tender-card:active {
  transform: translateY(1px);
  box-shadow: var(--shadow-sm);
}

.tender-card h3 {
  margin: 0 0 8px;
  font-family: var(--font-sans);
  font-size: 16px;
  font-weight: 600;
  line-height: 1.4;
  letter-spacing: -0.01em;
  color: var(--color-text);
}

.tender-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 13px;
  color: var(--color-muted);
}

@keyframes fadeUp {
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
}

.meta-divider {
  color: var(--color-soft);
}

.meta-budget {
  color: var(--color-text);
  font-weight: 500;
}

/* Settings */
.settings-content {
  display: grid;
  gap: 16px;
}

.settings-section {
  padding: 24px;
  background: var(--color-bg-elevated);
  border: 0.5px solid rgba(0, 0, 0, 0.05);
  border-radius: 16px;
  box-shadow: var(--shadow-sm);
}

.settings-section h2 {
  margin: 0 0 6px;
  font-size: 18px;
  font-weight: 600;
  letter-spacing: -0.02em;
}

.section-desc {
  margin: 0 0 16px;
  font-size: 13px;
  color: var(--color-muted);
}

input, select {
  height: 36px;
  padding: 0 12px;
  border: 0.5px solid var(--color-border-strong);
  border-radius: 8px;
  background: transparent;
  font-size: 13px;
  color: var(--color-text);
  transition: all 0.2s ease;
}

input:focus, select:focus {
  border-color: var(--color-text);
  box-shadow: 0 0 0 3px rgba(0, 0, 0, 0.05);
  outline: none;
}

button {
  transition: all 0.2s ease;
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
  border-radius: 8px;
  background: var(--color-text);
  color: #fff;
  font-size: 13px;
  font-weight: 500;
  text-decoration: none;
  cursor: pointer;
  border: none;
}

.save-btn:hover,
.add-row button:hover,
.tag-input button:hover {
  background: #000;
  box-shadow: var(--shadow-sm);
}

.add-row {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(140px, 0.8fr) auto;
  gap: 10px;
  margin-bottom: 16px;
}

.client-add {
  grid-template-columns: minmax(0, 1.8fr) minmax(84px, 0.7fr) minmax(110px, 0.85fr) auto;
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
  border: 0.5px solid rgba(0, 0, 0, 0.05);
  border-radius: 12px;
  background: var(--color-fill);
}

.kw-tag, .client-name {
  color: var(--color-text);
  font-weight: 500;
  flex: 1;
}

.kw-tag.negative {
  color: #c4412d;
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
  border: 0.5px solid var(--color-border-strong);
  border-radius: 6px;
  background: var(--color-bg-elevated);
  color: var(--color-text);
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
}

.btn-sm:hover {
  background: var(--color-fill);
}

.btn-sm.btn-danger {
  color: #c4412d;
  background: rgba(196, 65, 45, 0.04);
  border-color: rgba(196, 65, 45, 0.1);
}

.client-credit {
  display: inline-flex;
  align-items: center;
  height: 24px;
  padding: 0 8px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
}

.client-credit.normal {
  background: rgba(0, 0, 0, 0.04);
  color: var(--color-text);
}

.client-credit.slow {
  background: rgba(180, 123, 33, 0.1);
  color: #8d5b12;
}

.client-credit.bad {
  background: rgba(196, 65, 45, 0.1);
  color: #a33423;
}

.pref-group {
  margin-bottom: 16px;
  padding: 16px;
  border: 0.5px solid rgba(0, 0, 0, 0.05);
  border-radius: 12px;
  background: var(--color-fill);
}

.pref-group h3 {
  margin: 0 0 10px;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
}

.budget-inputs, .tag-input {
  display: flex;
  align-items: center;
  gap: 10px;
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
  gap: 6px;
  margin-top: 10px;
}

.tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  border: 0.5px solid rgba(0, 0, 0, 0.05);
  border-radius: 999px;
  background: var(--color-bg-elevated);
  color: var(--color-text);
  font-size: 12px;
  font-weight: 500;
}

.tag button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--color-muted);
}

.tag button:hover {
  color: var(--color-text);
}

.tag-negative {
  background: rgba(196, 65, 45, 0.04);
  color: #b03e2d;
}

/* Modal */
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(8px);
  animation: fadeIn 0.2s ease;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.modal-dialog {
  display: flex;
  flex-direction: column;
  width: 860px;
  height: 85vh;
  max-width: 90vw;
  background: #ffffff;
  border-radius: 16px;
  box-shadow: var(--shadow-lg);
  font-family: var(--font-sans);
  overflow: hidden;
}

.modal-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 0.5px solid var(--color-border);
  background: #ffffff;
  z-index: 10;
  flex-shrink: 0;
}

.modal-title {
  margin: 0;
  font-family: var(--font-sans);
  font-size: 18px;
  font-weight: 600;
  letter-spacing: -0.01em;
  line-height: 1.4;
  color: var(--color-text);
  max-width: 90%;
}

.modal-close {
  width: 28px;
  height: 28px;
  border-radius: 14px;
  background: var(--color-fill);
  border: none;
  color: var(--color-muted);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  flex-shrink: 0;
}

.modal-close:hover {
  background: var(--color-fill-strong);
  color: var(--color-text);
}

.modal-body {
  display: flex;
  flex-direction: column;
  padding: 16px 20px;
  overflow-y: auto;
  flex: 1;
}

.detail-meta-box {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 8px;
  padding: 12px;
  background: var(--color-bg);
  border: 0.5px solid var(--color-border);
  border-radius: 6px;
  margin-bottom: 16px;
  flex-shrink: 0;
}

.meta-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.meta-item span {
  font-size: 13px;
  color: var(--color-text);
  line-height: 1.4;
  font-weight: 500;
}

.meta-item strong {
  font-size: 11px;
  font-weight: 500;
  color: var(--color-muted);
  letter-spacing: 0;
}

.content-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
  flex-shrink: 0;
}

.section-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--color-text);
}

.original-link-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 28px;
  padding: 0 12px;
  border-radius: 6px;
  background: var(--color-fill);
  color: var(--color-text);
  font-size: 12px;
  font-weight: 500;
  text-decoration: none;
  cursor: pointer;
  border: 0.5px solid var(--color-border-strong);
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

.original-link-btn:hover {
  background: var(--color-fill-strong);
}

.original-link-btn:active {
  transform: translateY(1px) scale(0.98);
}

.tender-html-content {
  font-size: 14px;
  line-height: 1.6;
  color: #333336;
  white-space: pre-wrap;
  word-wrap: break-word;
}

.tender-html-content p,
.tender-html-content div {
  margin-bottom: 1em;
}

.tender-html-content table {
  width: 100%;
  border-collapse: collapse;
  margin: 16px 0;
  white-space: normal;
}

.tender-html-content th,
.tender-html-content td {
  border: 0.5px solid rgba(0, 0, 0, 0.05);
  padding: 8px 12px;
  text-align: left;
  vertical-align: top;
}

.tender-html-content th {
  background: #f9fafb;
  font-weight: 500;
  color: var(--color-muted);
}

.tender-html-content a {
  color: #2563eb;
  text-decoration: none;
}

.tender-html-content a:hover {
  text-decoration: underline;
}

.tender-html-content img {
  max-width: 100%;
  height: auto;
  border-radius: 8px;
  margin: 16px 0;
}

.loading-state,
.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  min-height: 300px;
  padding: 40px 20px;
  border-radius: 16px;
  text-align: center;
  color: var(--color-muted);
  font-size: 14px;
}

.pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin-top: 24px;
}

.pagination span {
  font-size: 13px;
  font-weight: 500;
  color: var(--color-muted);
}

.pagination button {
  height: 32px;
  padding: 0 12px;
  border: 0.5px solid var(--color-border-strong);
  border-radius: 8px;
  background: var(--color-bg-elevated);
  color: var(--color-text);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}

.pagination button:hover:not(:disabled) {
  background: var(--color-fill);
}

.pagination button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

@media (max-width: 720px) {
  .tender-page {
    padding: 80px 16px 48px;
  }
  
  .dashboard-header {
    flex-direction: column;
    align-items: stretch;
  }
  
  .header-controls {
    justify-content: flex-start;
  }
  
  .search-input-wrapper input,
  .search-input-wrapper input:focus {
    width: 100%;
  }
  
  .tender-tabs {
    width: 100%;
    overflow-x: auto;
  }
  
  .rec-top {
    flex-direction: column;
    align-items: flex-start;
  }
}

/* Feedback */
.rec-feedback {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 0.5px solid var(--color-border);
}

.feedback-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 30px;
  padding: 0 12px;
  border: 0.5px solid var(--color-border-strong);
  border-radius: 8px;
  background: var(--color-bg-elevated);
  font-size: 12px;
  font-weight: 500;
  color: var(--color-muted);
  cursor: pointer;
}

.feedback-btn:hover {
  background: var(--color-fill);
  color: var(--color-text);
}

.feedback-btn.suitable.active {
  background: rgba(16, 185, 129, 0.1);
  border-color: rgba(16, 185, 129, 0.3);
  color: #065f46;
}

.feedback-btn.not-suitable.active {
  background: rgba(239, 68, 68, 0.06);
  border-color: rgba(239, 68, 68, 0.2);
  color: #991b1b;
}

.feedback-reason-hint {
  font-size: 11px;
  color: var(--color-muted);
  margin-left: 8px;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Feedback Dialog */
.feedback-dialog {
  width: 440px;
  background: #fff;
  border-radius: 16px;
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

.feedback-dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px 0;
}

.feedback-dialog-header h3 {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
}

.feedback-dialog-body {
  padding: 16px 24px;
}

.feedback-tender-title {
  font-size: 13px;
  color: var(--color-muted);
  margin: 0 0 12px;
  line-height: 1.4;
}

.feedback-dialog-body label {
  display: block;
  font-size: 13px;
  font-weight: 500;
  margin-bottom: 6px;
  color: var(--color-text);
}

.feedback-dialog-body textarea {
  width: 100%;
  padding: 10px 12px;
  border: 0.5px solid var(--color-border-strong);
  border-radius: 8px;
  font-size: 13px;
  font-family: var(--font-sans);
  line-height: 1.5;
  resize: vertical;
  min-height: 72px;
}

.feedback-dialog-body textarea:focus {
  outline: none;
  border-color: var(--color-text);
  box-shadow: 0 0 0 3px rgba(0, 0, 0, 0.05);
}

.feedback-dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 16px 24px;
  border-top: 0.5px solid var(--color-border);
}

.btn-cancel {
  height: 34px;
  padding: 0 16px;
  border: 0.5px solid var(--color-border-strong);
  border-radius: 8px;
  background: transparent;
  font-size: 13px;
  cursor: pointer;
  color: var(--color-text);
}

.btn-confirm {
  height: 34px;
  padding: 0 20px;
  border: none;
  border-radius: 8px;
  background: var(--color-text);
  color: #fff;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}

.btn-confirm:hover {
  background: #000;
}
</style>
