<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch, nextTick } from 'vue'
import { apiGet, apiPost, apiPatch, apiDelete } from '../../lib/api'

const tenders = ref<any[]>([])
const total = ref(0)
const page = ref(1)
const search = ref('')
const platform = ref('')
const keywordFilter = ref('')
const loading = ref(false)
const usedKeywords = ref<string[]>([])

// Keyword pool
const keywordPool = ref<any[]>([])
const newPoolKeyword = ref('')
const newPoolCategory = ref('')
const selectedCrawlKeywords = ref<string[]>([])
const platforms = ref<any[]>([])
const selectedPlatform = ref('gdgpo')

const crawlDays = ref(14)
const crawling = ref(false)
const crawlLogs = ref<any[]>([])
const crawlStatus = ref<any>(null)
let statusPollTimer: ReturnType<typeof setInterval> | null = null

const logsContainer = ref<HTMLElement | null>(null)
const expandedLogs = ref<Set<number>>(new Set())
const logsCollapsed = ref(false)

function toggleLogDetail(index: number) {
  const s = new Set(expandedLogs.value)
  if (s.has(index)) s.delete(index)
  else s.add(index)
  expandedLogs.value = s
}

const stats = ref<any>({})
const activeTab = ref<'list' | 'drafts' | 'crawl' | 'keywords' | 'logs' | 'scoring' | 'sdk'>('list')

const enabledKeywords = computed(() => keywordPool.value.filter(k => k.enabled))

// Drafts tab state
const drafts = ref<any[]>([])
const draftsTotal = ref(0)
const draftsPage = ref(1)
const draftsLoading = ref(false)
const draftsStatusFilter = ref('')
const draftsPlatformFilter = ref('')
const draftsKeywordFilter = ref('')
const selectedDraftIds = ref<string[]>([])
const forceReprocess = ref(false)
const userList = ref<any[]>([])
const selectedUserId = ref('')

const allDraftsSelected = computed({
  get: () => drafts.value.length > 0 && selectedDraftIds.value.length === drafts.value.length,
  set: (val: boolean) => {
    if (val) {
      selectedDraftIds.value = drafts.value.map(d => d.id)
    } else {
      selectedDraftIds.value = []
    }
  }
})

watch(() => crawlStatus.value?.logs?.length, () => {
  nextTick(() => {
    if (logsContainer.value) {
      logsContainer.value.scrollTop = logsContainer.value.scrollHeight
    }
  })
})

onMounted(() => {
  loadTenders()
  loadStats()
  loadKeywordPool()
  loadPlatforms()
  loadUsedKeywords()
  pollCrawlStatus()
})

onUnmounted(() => {
  if (statusPollTimer) clearInterval(statusPollTimer)
})

async function loadUsedKeywords() {
  try {
    usedKeywords.value = await apiGet('/api/tender/keywords-used')
  } catch {}
}

async function loadTenders() {
  loading.value = true
  selectedTenderIds.value = []
  try {
    const params: any = { page: page.value, page_size: 30, search: search.value, platform: platform.value }
    if (keywordFilter.value) params.keyword = keywordFilter.value
    const data = await apiGet('/api/tender/admin/tenders', params)
    tenders.value = data.items
    total.value = data.total
  } catch (e: any) {
    console.error(e)
  } finally {
    loading.value = false
  }
}

async function loadStats() {
  try {
    stats.value = await apiGet('/api/tender/admin/stats')
  } catch {}
}

async function loadKeywordPool() {
  try {
    keywordPool.value = await apiGet('/api/tender/admin/keyword-pool')
  } catch {}
}

async function loadPlatforms() {
  try {
    platforms.value = await apiGet('/api/tender/admin/platforms')
  } catch {}
}

async function loadCrawlLogs() {
  try {
    crawlLogs.value = await apiGet('/api/tender/admin/crawl-logs')
  } catch {}
}

async function loadDrafts() {
  draftsLoading.value = true
  try {
    const params: any = { page: draftsPage.value, page_size: 20 }
    if (draftsStatusFilter.value) params.status = draftsStatusFilter.value
    if (draftsPlatformFilter.value) params.platform = draftsPlatformFilter.value
    if (draftsKeywordFilter.value) params.keyword = draftsKeywordFilter.value
    const data = await apiGet('/api/tender/admin/drafts', params)
    drafts.value = data.items
    draftsTotal.value = data.total
  } catch (e: any) {
    console.error(e)
  } finally {
    draftsLoading.value = false
  }
}

async function loadUsers() {
  try {
    userList.value = await apiGet('/api/tender/admin/users')
  } catch {}
}

async function addPoolKeyword() {
  if (!newPoolKeyword.value.trim()) return
  try {
    await apiPost('/api/tender/admin/keyword-pool', { keyword: newPoolKeyword.value.trim(), category: newPoolCategory.value.trim() })
    newPoolKeyword.value = ''
    newPoolCategory.value = ''
    await loadKeywordPool()
  } catch (e: any) {
    alert(e.message || '添加失败')
  }
}

async function togglePoolKeyword(id: string, enabled: boolean) {
  await apiPatch(`/api/tender/admin/keyword-pool/${id}`, { enabled })
  const item = keywordPool.value.find(k => k.id === id)
  if (item) item.enabled = enabled ? 1 : 0
}

async function deletePoolKeyword(id: string) {
  if (!confirm('确认删除此关键词？')) return
  await apiDelete(`/api/tender/admin/keyword-pool/${id}`)
  keywordPool.value = keywordPool.value.filter(k => k.id !== id)
}

function toggleCrawlKeyword(keyword: string) {
  const idx = selectedCrawlKeywords.value.indexOf(keyword)
  if (idx >= 0) {
    selectedCrawlKeywords.value.splice(idx, 1)
  } else {
    selectedCrawlKeywords.value.push(keyword)
  }
}

function selectAllCrawlKeywords() {
  selectedCrawlKeywords.value = enabledKeywords.value.map(k => k.keyword)
}

function clearCrawlKeywords() {
  selectedCrawlKeywords.value = []
}

async function fetchCrawlStatus() {
  try {
    crawlStatus.value = await apiGet('/api/tender/admin/crawl-status')
    const s = crawlStatus.value?.status
    if (s === 'crawling' || s === 'extracting' || s === 'recommending') {
      crawling.value = true
      startPolling()
    } else {
      crawling.value = false
      stopPolling()
    }
  } catch {}
}

function startPolling() {
  if (statusPollTimer) return
  statusPollTimer = setInterval(fetchCrawlStatus, 2000)
}

function stopPolling() {
  if (statusPollTimer) {
    clearInterval(statusPollTimer)
    statusPollTimer = null
  }
}

function pollCrawlStatus() {
  fetchCrawlStatus()
}

async function startCrawl() {
  if (selectedCrawlKeywords.value.length === 0) return alert('请选择至少一个关键词')

  crawling.value = true
  try {
    await apiPost('/api/tender/admin/crawl', { keywords: selectedCrawlKeywords.value, daysLimit: crawlDays.value, platform: selectedPlatform.value })
    startPolling()
  } catch (e: any) {
    alert('启动失败: ' + e.message)
    crawling.value = false
  }
}

async function abortCrawl() {
  if (!confirm('确认终止当前任务？')) return
  try {
    await apiPost('/api/tender/admin/crawl-abort', {})
  } catch (e: any) {
    alert(e.message)
  }
}

async function deleteTender(id: string) {
  if (!confirm('确认删除？')) return
  await apiDelete(`/api/tender/admin/tenders/${id}`)
  tenders.value = tenders.value.filter(t => t.id !== id)
  total.value--
}

function formatBudget(amount: number): string {
  if (!amount) return '-'
  if (amount >= 10000) return `${(amount / 10000).toFixed(1)}万`
  return `${amount}元`
}

// Drafts batch operations
function toggleDraftSelection(id: string) {
  const idx = selectedDraftIds.value.indexOf(id)
  if (idx >= 0) {
    selectedDraftIds.value.splice(idx, 1)
  } else {
    selectedDraftIds.value.push(id)
  }
}

async function batchExtract(ids?: string[]) {
  const tenderIds = ids || selectedDraftIds.value
  if (tenderIds.length === 0) return alert('请选择至少一条标讯')

  try {
    await apiPost('/api/tender/admin/extract', { tenderIds, force: forceReprocess.value })
    startPolling()
    alert('AI 提取任务已启动')
  } catch (e: any) {
    alert('启动失败: ' + (e.message || '未知错误'))
  }
}

// Batch selection for list tab
const selectedTenderIds = ref<string[]>([])
const allTendersSelected = computed({
  get: () => tenders.value.length > 0 && selectedTenderIds.value.length === tenders.value.length,
  set: (val: boolean) => {
    selectedTenderIds.value = val ? tenders.value.map(t => t.id) : []
  }
})

// Score dialog
const showScoreDialog = ref(false)
const scoreDialogIds = ref<string[]>([])
const scoreForceReprocess = ref(false)

function openScoreDialog(ids: string[]) {
  scoreDialogIds.value = ids
  scoreForceReprocess.value = false
  selectedUserId.value = ''
  showScoreDialog.value = true
  loadUsers()
}

async function confirmScore() {
  try {
    await apiPost('/api/tender/admin/recommend', {
      tenderIds: scoreDialogIds.value,
      userId: selectedUserId.value || undefined,
      force: scoreForceReprocess.value
    })
    showScoreDialog.value = false
    startPolling()
    alert('推荐评分任务已启动')
  } catch (e: any) {
    alert('启动失败: ' + (e.message || '未知错误'))
  }
}

function getStatusLabel(status: string): string {
  switch (status) {
    case 'draft': return '草稿'
    case 'extracted': return '已提取'
    case 'scored': return '已评分'
    default: return status || '草稿'
  }
}

// Edit draft
const editingDraft = ref<any>(null)
const editForm = ref<any>({})

function openEditDraft(tender: any) {
  editingDraft.value = tender
  editForm.value = {
    title: tender.title || '',
    purchaser_name: tender.purchaser_name || '',
    budget_amount: tender.budget_amount || 0,
    region_name: tender.region_name || '',
    notice_type: tender.notice_type || '',
    publish_date: tender.publish_date?.slice(0, 10) || '',
    url: tender.url || '',
    content_text: tender.content_text || '',
    contact_name: tender.contact_name || '',
    contact_phone: tender.contact_phone || '',
  }
}

async function saveEditDraft() {
  if (!editingDraft.value) return
  try {
    await apiPatch(`/api/tender/admin/tenders/${editingDraft.value.id}`, editForm.value)
    // Update local data
    const inDrafts = drafts.value.find(d => d.id === editingDraft.value.id)
    if (inDrafts) Object.assign(inDrafts, editForm.value)
    const inList = tenders.value.find(t => t.id === editingDraft.value.id)
    if (inList) Object.assign(inList, editForm.value)
    editingDraft.value = null
  } catch (e: any) {
    alert('保存失败: ' + (e.message || '未知错误'))
  }
}

// Scoring config
const scoringWeights = ref({
  business: 0.30,
  budget: 0.20,
  qualification: 0.15,
  relationship: 0.15,
  region: 0.10,
  timeliness: 0.10,
})
const scoringPrompt = ref('')
const extractPrompt = ref('')
const preFilterThreshold = ref(25)
const scoringSaved = ref(false)

async function loadScoringConfig() {
  const data = await apiGet('/api/admin/config')
  const config = data.config || {}
  if (config.tender_scoring_weights?.value) {
    try { scoringWeights.value = { ...scoringWeights.value, ...JSON.parse(config.tender_scoring_weights.value) } } catch {}
  }
  if (config.tender_scoring_prompt?.value) scoringPrompt.value = config.tender_scoring_prompt.value
  if (config.tender_extract_prompt?.value) extractPrompt.value = config.tender_extract_prompt.value
  if (config.tender_pre_filter_threshold?.value) preFilterThreshold.value = parseInt(config.tender_pre_filter_threshold.value) || 25
}

async function saveScoringConfig() {
  await apiPost('/api/admin/config', { key: 'tender_scoring_weights', value: JSON.stringify(scoringWeights.value) })
  await apiPost('/api/admin/config', { key: 'tender_pre_filter_threshold', value: String(preFilterThreshold.value) })
  if (scoringPrompt.value.trim()) {
    await apiPost('/api/admin/config', { key: 'tender_scoring_prompt', value: scoringPrompt.value })
  }
  if (extractPrompt.value.trim()) {
    await apiPost('/api/admin/config', { key: 'tender_extract_prompt', value: extractPrompt.value })
  }
  scoringSaved.value = true
  setTimeout(() => scoringSaved.value = false, 2000)
}

function switchAdminTab(tab: 'list' | 'drafts' | 'crawl' | 'keywords' | 'logs' | 'scoring' | 'sdk') {
  activeTab.value = tab
  if (tab === 'list') {
    loadTenders()
    loadStats()
    loadUsers()
  }
  if (tab === 'drafts') {
    loadDrafts()
    loadUsers()
  }
  if (tab === 'crawl') loadKeywordPool()
  if (tab === 'keywords') loadKeywordPool()
  if (tab === 'scoring') loadScoringConfig()
  if (tab === 'logs') loadCrawlLogs()
  if (tab === 'sdk') {
    loadSdkKeys()
    loadUsers()
  }
}

// ==================== SDK 接入（第三方嵌入）====================
const sdkKeys = ref<any[]>([])
const sdkLoading = ref(false)
const newSdkUserId = ref('')
const newSdkName = ref('')
const newSdkOrigins = ref('')
const newSdkRateLimit = ref(60)
const createdPk = ref('')

async function loadSdkKeys() {
  sdkLoading.value = true
  try {
    sdkKeys.value = await apiGet('/api/tender/admin/sdk-keys')
  } catch (e: any) {
    console.error(e)
  } finally {
    sdkLoading.value = false
  }
}

async function createSdkKey() {
  if (!newSdkUserId.value) { alert('请选择绑定用户'); return }
  try {
    const res = await apiPost('/api/tender/admin/sdk-keys', {
      userId: newSdkUserId.value,
      name: newSdkName.value.trim(),
      allowedOrigins: newSdkOrigins.value,
      rateLimit: newSdkRateLimit.value,
    })
    createdPk.value = res.pk
    newSdkName.value = ''
    newSdkOrigins.value = ''
    newSdkUserId.value = ''
    await loadSdkKeys()
  } catch (e: any) {
    alert(e.message || '创建失败')
  }
}

async function toggleSdkKey(key: any) {
  try {
    await apiPatch(`/api/tender/admin/sdk-keys/${key.pk}`, { enabled: !key.enabled })
    await loadSdkKeys()
  } catch (e: any) {
    alert(e.message || '操作失败')
  }
}

async function editSdkOrigins(key: any) {
  const cur = (key.allowed_origins || []).join('\n')
  const val = prompt('域名白名单（每行一个，如 https://example.com）', cur)
  if (val === null) return
  try {
    await apiPatch(`/api/tender/admin/sdk-keys/${key.pk}`, { allowedOrigins: val })
    await loadSdkKeys()
  } catch (e: any) {
    alert(e.message || '保存失败')
  }
}

async function deleteSdkKey(key: any) {
  if (!confirm(`确认删除密钥 ${key.pk.slice(0, 20)}… ？第三方将立即无法换取 token。`)) return
  try {
    await apiDelete(`/api/tender/admin/sdk-keys/${key.pk}`)
    await loadSdkKeys()
  } catch (e: any) {
    alert(e.message || '删除失败')
  }
}

function copyText(text: string) {
  navigator.clipboard?.writeText(text)
}
</script>

<template>
  <div class="tender-admin">
    <div class="admin-header">
      <h1>标讯管理</h1>
      <div class="admin-stats" v-if="stats.totalTenders">
        <span>总标讯: {{ stats.totalTenders }}</span>
        <span>今日新增: {{ stats.todayTenders }}</span>
        <span>推荐记录: {{ stats.totalRecommendations }}</span>
      </div>
    </div>

    <div class="admin-tabs">
      <button :class="{ active: activeTab === 'list' }" @click="switchAdminTab('list')">标讯列表</button>
      <button :class="{ active: activeTab === 'drafts' }" @click="switchAdminTab('drafts')">草稿库</button>
      <button :class="{ active: activeTab === 'crawl' }" @click="switchAdminTab('crawl')">爬取管理</button>
      <button :class="{ active: activeTab === 'keywords' }" @click="switchAdminTab('keywords')">关键词库</button>
      <button :class="{ active: activeTab === 'scoring' }" @click="switchAdminTab('scoring')">评分配置</button>
      <button :class="{ active: activeTab === 'logs' }" @click="switchAdminTab('logs')">运行日志</button>
      <button :class="{ active: activeTab === 'sdk' }" @click="switchAdminTab('sdk')">SDK 接入</button>
    </div>

    <!-- Global Task Status Banner (visible on all tabs) -->
    <div v-if="crawlStatus && crawlStatus.status !== 'idle' && activeTab !== 'crawl'" class="crawl-status-banner global-status" :class="crawlStatus.status">
      <div class="status-header">
        <span class="status-icon" v-if="crawlStatus.status === 'crawling' || crawlStatus.status === 'extracting' || crawlStatus.status === 'recommending'">⏳</span>
        <span class="status-icon" v-else-if="crawlStatus.status === 'completed'">✅</span>
        <span class="status-icon" v-else-if="crawlStatus.status === 'failed'">❌</span>
        <span class="status-label">
          {{ crawlStatus.status === 'crawling' ? '爬取中' : crawlStatus.status === 'extracting' ? 'AI 提取中' : crawlStatus.status === 'recommending' ? '推荐计算中' : crawlStatus.status === 'completed' ? '已完成' : '失败' }}
        </span>
        <button v-if="crawlStatus.status === 'crawling' || crawlStatus.status === 'extracting' || crawlStatus.status === 'recommending'" class="btn-abort" @click="abortCrawl">终止</button>
      </div>
      <div class="status-message">{{ crawlStatus.message }}</div>
      <div v-if="crawlStatus.total > 0 && crawlStatus.status !== 'completed' && crawlStatus.status !== 'failed'" class="status-progress">
        <div class="progress-bar">
          <div class="progress-fill" :style="{ width: Math.round((crawlStatus.current / crawlStatus.total) * 100) + '%' }"></div>
        </div>
        <span class="progress-text">{{ crawlStatus.current }} / {{ crawlStatus.total }}</span>
      </div>
      <div v-if="crawlStatus.logs && crawlStatus.logs.length > 0" class="status-logs">
        <div class="logs-header" @click="logsCollapsed = !logsCollapsed">
          <span class="logs-toggle-icon">{{ logsCollapsed ? '▶' : '▼' }}</span>
          运行日志 ({{ crawlStatus.logs.length }})
        </div>
        <div v-if="!logsCollapsed" class="logs-content" ref="logsContainer">
          <div v-for="(log, i) in crawlStatus.logs" :key="i" class="log-entry">
            <div class="log-line">
              <span class="log-time">[{{ log.time }}]</span> {{ log.message }}
              <button v-if="log.detail" class="log-toggle" @click="toggleLogDetail(i)">
                {{ expandedLogs.has(i) ? '▼ 收起' : '▶ 详情' }}
              </button>
            </div>
            <pre v-if="log.detail && expandedLogs.has(i)" class="log-detail">{{ log.detail }}</pre>
          </div>
        </div>
      </div>
    </div>

    <!-- List Tab -->
    <div v-if="activeTab === 'list'" class="admin-content">
      <div class="list-toolbar">
        <input v-model="search" placeholder="搜索标题/采购人..." @keyup.enter="page = 1; loadTenders()" />
        <select v-model="platform" @change="page = 1; loadTenders()">
          <option value="">全部平台</option>
          <option value="gdgpo">广东省政府采购</option>
        </select>
        <select v-model="keywordFilter" @change="page = 1; loadTenders()">
          <option value="">全部关键词</option>
          <option v-for="kw in usedKeywords" :key="kw" :value="kw">{{ kw }}</option>
        </select>
        <button @click="page = 1; loadTenders()">搜索</button>
        <button class="btn-batch-score" :disabled="selectedTenderIds.length === 0" @click="openScoreDialog(selectedTenderIds)">
          批量评分{{ selectedTenderIds.length ? ` (${selectedTenderIds.length})` : '' }}
        </button>
      </div>

      <div v-if="loading" class="loading">加载中...</div>
      <table v-else class="tender-table">
        <thead>
          <tr>
            <th class="th-check"><input type="checkbox" v-model="allTendersSelected" /></th>
            <th>标题</th>
            <th>类型</th>
            <th>采购人</th>
            <th>预算</th>
            <th>地区</th>
            <th>发布日期</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="t in tenders" :key="t.id">
            <td class="td-check"><input type="checkbox" :value="t.id" v-model="selectedTenderIds" /></td>
            <td class="td-title">
              <a v-if="t.url" :href="t.url" target="_blank">{{ t.title }}</a>
              <span v-else>{{ t.title }}</span>
            </td>
            <td class="td-type">{{ t.notice_type || '-' }}</td>
            <td>{{ t.purchaser_name || '-' }}</td>
            <td>{{ formatBudget(t.budget_amount) }}</td>
            <td>{{ t.region_name || '-' }}</td>
            <td>{{ t.publish_date?.slice(0, 10) }}</td>
            <td><span :class="['tender-status', t.status || 'extracted']">{{ getStatusLabel(t.status) }}</span></td>
            <td class="td-actions">
              <button class="btn-sm" :disabled="crawling" @click="openScoreDialog([t.id])">评分</button>
              <button class="btn-sm btn-danger" @click="deleteTender(t.id)">删除</button>
            </td>
          </tr>
        </tbody>
      </table>

      <div v-if="total > 30" class="pagination">
        <button :disabled="page <= 1" @click="page--; loadTenders()">上一页</button>
        <span>{{ page }} / {{ Math.ceil(total / 30) }}</span>
        <button :disabled="page * 30 >= total" @click="page++; loadTenders()">下一页</button>
      </div>
    </div>

    <!-- Drafts Tab -->
    <div v-if="activeTab === 'drafts'" class="admin-content">
      <div class="drafts-toolbar">
        <div class="drafts-actions">
          <button class="btn-primary" :disabled="selectedDraftIds.length === 0 || crawling" @click="batchExtract()">
            批量AI提取 ({{ selectedDraftIds.length }})
          </button>
        </div>
        <div class="drafts-filter">
          <select v-model="draftsPlatformFilter" @change="draftsPage = 1; loadDrafts()">
            <option value="">全部平台</option>
            <option v-for="p in platforms" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select>
          <select v-model="draftsKeywordFilter" @change="draftsPage = 1; loadDrafts()">
            <option value="">全部关键词</option>
            <option v-for="kw in usedKeywords" :key="kw" :value="kw">{{ kw }}</option>
          </select>
        </div>
      </div>

      <div v-if="draftsLoading" class="loading">加载中...</div>
      <table v-else class="tender-table">
        <thead>
          <tr>
            <th class="th-checkbox"><input type="checkbox" v-model="allDraftsSelected" /></th>
            <th>标题</th>
            <th>类型</th>
            <th>采购人</th>
            <th>地区</th>
            <th>发布日期</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="t in drafts" :key="t.id">
            <td class="td-checkbox"><input type="checkbox" :checked="selectedDraftIds.includes(t.id)" @change="toggleDraftSelection(t.id)" /></td>
            <td class="td-title">
              <a v-if="t.url" :href="t.url" target="_blank">{{ t.title }}</a>
              <span v-else>{{ t.title }}</span>
            </td>
            <td class="td-type">{{ t.notice_type || '-' }}</td>
            <td>{{ t.purchaser_name || '-' }}</td>
            <td>{{ t.region_name || '-' }}</td>
            <td>{{ t.publish_date?.slice(0, 10) }}</td>
            <td class="td-actions">
              <button class="btn-sm" @click="openEditDraft(t)">编辑</button>
              <button class="btn-sm" :disabled="crawling" @click="batchExtract([t.id])">提取</button>
            </td>
          </tr>
        </tbody>
      </table>

      <div v-if="drafts.length === 0 && !draftsLoading" class="empty-hint">暂无草稿标讯</div>

      <div v-if="draftsTotal > 20" class="pagination">
        <button :disabled="draftsPage <= 1" @click="draftsPage--; loadDrafts()">上一页</button>
        <span>{{ draftsPage }} / {{ Math.ceil(draftsTotal / 20) }}</span>
        <button :disabled="draftsPage * 20 >= draftsTotal" @click="draftsPage++; loadDrafts()">下一页</button>
      </div>
    </div>

    <!-- Crawl Tab -->
    <div v-if="activeTab === 'crawl'" class="admin-content crawl-panel">
      <!-- Task Status Banner -->
      <div v-if="crawlStatus && crawlStatus.status !== 'idle'" class="crawl-status-banner" :class="crawlStatus.status">
        <div class="status-header">
          <span class="status-icon" v-if="crawlStatus.status === 'crawling' || crawlStatus.status === 'extracting' || crawlStatus.status === 'recommending'">⏳</span>
          <span class="status-icon" v-else-if="crawlStatus.status === 'completed'">✅</span>
          <span class="status-icon" v-else-if="crawlStatus.status === 'failed'">❌</span>
          <span class="status-label">
            {{ crawlStatus.status === 'crawling' ? '爬取中' : crawlStatus.status === 'extracting' ? 'AI 提取中' : crawlStatus.status === 'recommending' ? '推荐计算中' : crawlStatus.status === 'completed' ? '已完成' : '失败' }}
          </span>
          <button v-if="crawlStatus.status === 'crawling' || crawlStatus.status === 'extracting' || crawlStatus.status === 'recommending'" class="btn-abort" @click="abortCrawl">终止</button>
        </div>
        <div class="status-message">{{ crawlStatus.message }}</div>
        <div v-if="crawlStatus.total > 0 && crawlStatus.status !== 'completed' && crawlStatus.status !== 'failed'" class="status-progress">
          <div class="progress-bar">
            <div class="progress-fill" :style="{ width: Math.round((crawlStatus.current / crawlStatus.total) * 100) + '%' }"></div>
          </div>
          <span class="progress-text">{{ crawlStatus.current }} / {{ crawlStatus.total }}</span>
        </div>
        <div v-if="crawlStatus.startedAt" class="status-time">
          开始于 {{ crawlStatus.startedAt?.slice(0, 19).replace('T', ' ') }}
          <template v-if="crawlStatus.completedAt"> · 完成于 {{ crawlStatus.completedAt?.slice(0, 19).replace('T', ' ') }}</template>
        </div>
        <div v-if="crawlStatus.logs && crawlStatus.logs.length > 0" class="status-logs">
          <div class="logs-header" @click="logsCollapsed = !logsCollapsed">
            <span class="logs-toggle-icon">{{ logsCollapsed ? '▶' : '▼' }}</span>
            运行日志 ({{ crawlStatus.logs.length }})
          </div>
          <div v-if="!logsCollapsed" class="logs-content" ref="logsContainer">
            <div v-for="(log, i) in crawlStatus.logs" :key="i" class="log-entry">
              <div class="log-line">
                <span class="log-time">[{{ log.time }}]</span> {{ log.message }}
                <button v-if="log.detail" class="log-toggle" @click="toggleLogDetail(i)">
                  {{ expandedLogs.has(i) ? '▼ 收起' : '▶ 详情' }}
                </button>
              </div>
              <pre v-if="log.detail && expandedLogs.has(i)" class="log-detail">{{ log.detail }}</pre>
            </div>
          </div>
        </div>
      </div>

      <div class="crawl-config">
        <h3>爬取配置</h3>
        <div class="form-group">
          <label>选择平台</label>
          <select v-model="selectedPlatform" class="platform-select">
            <option v-for="p in platforms" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select>
          <p v-if="platforms.length === 1" class="form-hint">当前仅支持一个平台，后续可扩展更多数据源</p>
        </div>
        <div class="form-group">
          <label>选择爬取关键词</label>
          <div class="keyword-select-actions">
            <button class="btn-link" @click="selectAllCrawlKeywords">全选</button>
            <button class="btn-link" @click="clearCrawlKeywords">清除</button>
            <span class="keyword-count">已选 {{ selectedCrawlKeywords.length }} / {{ enabledKeywords.length }}</span>
          </div>
          <div class="keyword-chips">
            <button
              v-for="kw in enabledKeywords"
              :key="kw.id"
              :class="['keyword-chip', { selected: selectedCrawlKeywords.includes(kw.keyword) }]"
              @click="toggleCrawlKeyword(kw.keyword)"
            >
              {{ kw.keyword }}
              <span v-if="kw.category" class="chip-category">{{ kw.category }}</span>
            </button>
          </div>
          <p v-if="enabledKeywords.length === 0" class="empty-hint">暂无关键词，请先在「关键词库」中添加</p>
        </div>
        <div class="form-group">
          <label>时间范围（天）</label>
          <input v-model.number="crawlDays" type="number" min="1" max="30" />
        </div>
        <button class="crawl-btn" :disabled="crawling || selectedCrawlKeywords.length === 0" @click="startCrawl">
          {{ crawling ? '任务进行中...' : '开始爬取' }}
        </button>
        <p class="crawl-note">爬取完成后标讯将存入草稿库，请到「草稿库」手动执行 AI 提取和评分操作</p>
      </div>
    </div>

    <!-- Keywords Pool Tab -->
    <div v-if="activeTab === 'keywords'" class="admin-content keywords-panel">
      <div class="keywords-header">
        <h3>关键词库管理</h3>
        <p class="keywords-desc">管理全局关键词库，用户只能从此列表选择关注关键词</p>
      </div>

      <div class="add-keyword-row">
        <input v-model="newPoolKeyword" placeholder="关键词" @keyup.enter="addPoolKeyword" />
        <input v-model="newPoolCategory" placeholder="分类（可选）" @keyup.enter="addPoolKeyword" />
        <button @click="addPoolKeyword">添加</button>
      </div>

      <div class="pool-list">
        <div v-for="kw in keywordPool" :key="kw.id" :class="['pool-item', { disabled: !kw.enabled }]">
          <span class="pool-keyword">{{ kw.keyword }}</span>
          <span v-if="kw.category" class="pool-category">{{ kw.category }}</span>
          <div class="pool-actions">
            <button :class="['btn-sm', { 'btn-active': kw.enabled }]" @click="togglePoolKeyword(kw.id, !kw.enabled)">
              {{ kw.enabled ? '启用' : '禁用' }}
            </button>
            <button class="btn-sm btn-danger" @click="deletePoolKeyword(kw.id)">删除</button>
          </div>
        </div>
        <p v-if="keywordPool.length === 0" class="empty-hint">暂无关键词，请添加</p>
      </div>
    </div>

    <!-- Scoring Config Tab -->
    <div v-if="activeTab === 'scoring'" class="admin-content scoring-panel">
      <div class="scoring-section">
        <h3>评分权重</h3>
        <p class="scoring-hint">各维度权重之和应为 1.0，用于计算推荐总分</p>
        <div class="weights-grid">
          <div class="weight-item">
            <label>业务匹配</label>
            <input type="number" v-model.number="scoringWeights.business" step="0.05" min="0" max="1" />
          </div>
          <div class="weight-item">
            <label>预算匹配</label>
            <input type="number" v-model.number="scoringWeights.budget" step="0.05" min="0" max="1" />
          </div>
          <div class="weight-item">
            <label>资质符合</label>
            <input type="number" v-model.number="scoringWeights.qualification" step="0.05" min="0" max="1" />
          </div>
          <div class="weight-item">
            <label>客户关系</label>
            <input type="number" v-model.number="scoringWeights.relationship" step="0.05" min="0" max="1" />
          </div>
          <div class="weight-item">
            <label>地区匹配</label>
            <input type="number" v-model.number="scoringWeights.region" step="0.05" min="0" max="1" />
          </div>
          <div class="weight-item">
            <label>时效性</label>
            <input type="number" v-model.number="scoringWeights.timeliness" step="0.05" min="0" max="1" />
          </div>
        </div>
        <p class="weights-sum" :class="{ invalid: Math.abs(Object.values(scoringWeights).reduce((a: number, b: number) => a + b, 0) - 1) > 0.01 }">
          当前总和：{{ Object.values(scoringWeights).reduce((a: number, b: number) => a + b, 0).toFixed(2) }}
        </p>
      </div>

      <div class="scoring-section">
        <h3>预过滤阈值</h3>
        <p class="scoring-hint">规则初筛分数低于此值的标讯将跳过 LLM 评分（节省调用次数）</p>
        <input type="number" v-model.number="preFilterThreshold" min="0" max="100" class="threshold-input" />
      </div>

      <div class="scoring-section">
        <h3>评分 Prompt 模板</h3>
        <p class="scoring-hint">LLM 对标讯进行业务评分时使用的提示词。留空使用默认模板。</p>
        <p class="scoring-hint" v-pre>可用变量：<code>{{title}}</code> <code>{{purchaser}}</code> <code>{{budget}}</code> <code>{{region}}</code> <code>{{projectType}}</code> <code>{{projectSummary}}</code> <code>{{qualReqs}}</code> <code>{{content}}</code> <code>{{caseTags}}</code> <code>{{qualifications}}</code> <code>{{excludedTypes}}</code></p>
        <textarea v-model="scoringPrompt" rows="12" placeholder="留空使用默认模板..." class="prompt-textarea"></textarea>
      </div>

      <div class="scoring-section">
        <h3>提取 Prompt 模板</h3>
        <p class="scoring-hint">LLM 从招标公告中提取结构化信息时使用的提示词。留空使用默认模板。</p>
        <p class="scoring-hint" v-pre>可用变量：<code>{{count}}</code>（批次数量）<code>{{items}}</code>（项目列表文本）</p>
        <textarea v-model="extractPrompt" rows="12" placeholder="留空使用默认模板..." class="prompt-textarea"></textarea>
      </div>

      <div class="scoring-actions">
        <button class="btn-save" @click="saveScoringConfig">保存配置</button>
        <span v-if="scoringSaved" class="save-success">已保存</span>
      </div>
    </div>

    <!-- Logs Tab -->
    <div v-if="activeTab === 'logs'" class="admin-content">
      <table class="tender-table">
        <thead>
          <tr>
            <th>平台</th>
            <th>状态</th>
            <th>发现</th>
            <th>新增</th>
            <th>重复</th>
            <th>错误</th>
            <th>开始时间</th>
            <th>完成时间</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="log in crawlLogs" :key="log.id">
            <td>{{ log.platform }}</td>
            <td><span :class="['status-badge', log.status]">{{ log.status }}</span></td>
            <td>{{ log.total_found }}</td>
            <td>{{ log.new_added }}</td>
            <td>{{ log.duplicates }}</td>
            <td>{{ log.errors }}</td>
            <td>{{ log.started_at?.slice(0, 19).replace('T', ' ') }}</td>
            <td>{{ log.completed_at?.slice(0, 19).replace('T', ' ') || '-' }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- SDK 接入 Tab -->
    <div v-if="activeTab === 'sdk'" class="admin-content sdk-panel">
      <div class="sdk-intro">
        <p>为第三方纯前端项目签发 <b>publishable key（pk）</b>。第三方在页面引入 SDK 并配置 pk 后，SDK 会用 pk 向本平台换取 15 分钟的只读短 token，展示所绑定账号的标讯推荐。</p>
        <ul>
          <li>pk 是公开的，会出现在第三方页面 JS 里——安全靠 <b>绑定账号 + 域名白名单 + 只读 scope</b>，不靠保密。</li>
          <li>一个 pk 对应本平台一个账号，第三方整站看到的是<b>同一份</b>推荐。</li>
          <li>务必配置准确的域名白名单，别的网站盗用 pk 也换不到 token。</li>
        </ul>
      </div>

      <div class="sdk-create card">
        <h3>创建新密钥</h3>
        <div class="sdk-form">
          <div class="edit-form-group">
            <label>绑定账号（推荐归属）</label>
            <select v-model="newSdkUserId" class="edit-input">
              <option value="">请选择用户</option>
              <option v-for="u in userList" :key="u.id" :value="u.id">{{ u.username }}</option>
            </select>
          </div>
          <div class="edit-form-group">
            <label>备注名称</label>
            <input v-model="newSdkName" class="edit-input" placeholder="如：XX公司官网" />
          </div>
          <div class="edit-form-group">
            <label>域名白名单（每行一个）</label>
            <textarea v-model="newSdkOrigins" rows="3" class="edit-textarea" placeholder="https://example.com&#10;https://www.example.com"></textarea>
          </div>
          <div class="edit-form-group">
            <label>换取限流（次/分钟）</label>
            <input v-model.number="newSdkRateLimit" type="number" class="edit-input" style="max-width:120px" />
          </div>
          <button class="btn-primary" @click="createSdkKey">生成密钥</button>
        </div>
        <div v-if="createdPk" class="sdk-created">
          <p>✅ 已生成，请复制交给第三方（可随时在下方查看）：</p>
          <code class="pk-value">{{ createdPk }}</code>
          <button class="btn-secondary" @click="copyText(createdPk)">复制</button>
        </div>
      </div>

      <table class="tender-table" v-if="sdkKeys.length">
        <thead>
          <tr>
            <th>pk</th>
            <th>绑定账号</th>
            <th>备注</th>
            <th>白名单域名</th>
            <th>限流</th>
            <th>状态</th>
            <th>最近使用</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="k in sdkKeys" :key="k.pk">
            <td>
              <code class="pk-cell">{{ k.pk.slice(0, 16) }}…</code>
              <button class="link-btn" @click="copyText(k.pk)">复制</button>
            </td>
            <td>{{ k.username || k.user_id }}</td>
            <td>{{ k.name || '-' }}</td>
            <td>
              <span v-if="!k.allowed_origins.length" class="warn-text">未配置（无法使用）</span>
              <span v-else>{{ k.allowed_origins.join(', ') }}</span>
              <button class="link-btn" @click="editSdkOrigins(k)">编辑</button>
            </td>
            <td>{{ k.rate_limit }}/min</td>
            <td><span :class="['status-badge', k.enabled ? 'completed' : 'failed']">{{ k.enabled ? '启用' : '禁用' }}</span></td>
            <td>{{ k.last_used_at ? k.last_used_at.slice(0, 19).replace('T', ' ') : '-' }}</td>
            <td>
              <button class="link-btn" @click="toggleSdkKey(k)">{{ k.enabled ? '禁用' : '启用' }}</button>
              <button class="link-btn danger" @click="deleteSdkKey(k)">删除</button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else-if="!sdkLoading" class="empty-hint">还没有任何 SDK 密钥。</p>
    </div>
  </div>

  <!-- Score Dialog -->
  <teleport to="body">
    <div v-if="showScoreDialog" class="modal-overlay" @click.self="showScoreDialog = false">
      <div class="modal-content score-dialog">
        <div class="modal-header">
          <h3>评分设置</h3>
          <button class="modal-close" @click="showScoreDialog = false">&times;</button>
        </div>
        <div class="modal-body">
          <div class="edit-form-group">
            <label>选择用户</label>
            <select v-model="selectedUserId" class="edit-input">
              <option value="">全部用户</option>
              <option v-for="u in userList" :key="u.id" :value="u.id">{{ u.username }}</option>
            </select>
          </div>
          <div class="edit-form-group">
            <label class="force-checkbox">
              <input type="checkbox" v-model="scoreForceReprocess" />
              强制重新评分（覆盖已有结果）
            </label>
          </div>
          <p class="scoring-hint">将对 {{ scoreDialogIds.length }} 条标讯进行推荐评分</p>
        </div>
        <div class="modal-footer">
          <button class="btn-secondary" @click="showScoreDialog = false">取消</button>
          <button class="btn-primary" @click="confirmScore">开始评分</button>
        </div>
      </div>
    </div>
  </teleport>

  <!-- Edit Draft Modal -->
  <teleport to="body">
    <div v-if="editingDraft" class="modal-overlay" @click.self="editingDraft = null">
      <div class="modal-content edit-draft-modal">
        <div class="modal-header">
          <h3>编辑标讯</h3>
          <button class="modal-close" @click="editingDraft = null">&times;</button>
        </div>
        <div class="modal-body">
          <div class="edit-form-group">
            <label>标题</label>
            <input v-model="editForm.title" class="edit-input" />
          </div>
          <div class="edit-form-group">
            <label>采购人</label>
            <input v-model="editForm.purchaser_name" class="edit-input" />
          </div>
          <div class="edit-form-row">
            <div class="edit-form-group">
              <label>预算金额（元）</label>
              <input v-model.number="editForm.budget_amount" type="number" class="edit-input" />
            </div>
            <div class="edit-form-group">
              <label>地区</label>
              <input v-model="editForm.region_name" class="edit-input" />
            </div>
          </div>
          <div class="edit-form-row">
            <div class="edit-form-group">
              <label>公告类型</label>
              <input v-model="editForm.notice_type" class="edit-input" />
            </div>
            <div class="edit-form-group">
              <label>发布日期</label>
              <input v-model="editForm.publish_date" class="edit-input" placeholder="2026-07-10" />
            </div>
          </div>
          <div class="edit-form-group">
            <label>详情链接</label>
            <input v-model="editForm.url" class="edit-input" />
          </div>
          <div class="edit-form-group">
            <label>正文内容</label>
            <textarea v-model="editForm.content_text" rows="8" class="edit-textarea"></textarea>
          </div>
          <div class="edit-form-group">
            <label>联系人</label>
            <div class="edit-form-row">
              <input v-model="editForm.contact_name" class="edit-input" placeholder="姓名" />
              <input v-model="editForm.contact_phone" class="edit-input" placeholder="电话" />
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-secondary" @click="editingDraft = null">取消</button>
          <button class="btn-primary" @click="saveEditDraft">保存</button>
        </div>
      </div>
    </div>
  </teleport>
</template>

<style scoped>
.sdk-intro { background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:14px 18px; margin-bottom:16px; font-size:13px; color:#475569; }
.sdk-intro ul { margin:8px 0 0; padding-left:18px; }
.sdk-intro li { margin:4px 0; }
.sdk-create.card { border:1px solid #e2e8f0; border-radius:8px; padding:18px; margin-bottom:18px; }
.sdk-create h3 { margin:0 0 12px; font-size:15px; }
.sdk-form { display:flex; flex-direction:column; gap:10px; max-width:520px; }
.sdk-created { margin-top:14px; padding:12px; background:#ecfdf5; border:1px solid #a7f3d0; border-radius:6px; }
.pk-value { display:block; word-break:break-all; font-family:monospace; margin:6px 0; color:#065f46; }
.pk-cell { font-family:monospace; }
.link-btn { background:none; border:none; color:#2563eb; cursor:pointer; font-size:12px; margin-left:6px; padding:0; }
.link-btn.danger { color:#dc2626; }
.warn-text { color:#dc2626; }
.empty-hint { color:#94a3b8; padding:20px 0; }

.tender-admin {
  padding: 24px;
}

.admin-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 24px;
}

.admin-header h1 {
  font-size: 22px;
  font-weight: 700;
}

.admin-stats {
  display: flex;
  gap: 16px;
  font-size: 13px;
  color: #6b7280;
}

.admin-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 20px;
  border-bottom: 1px solid #e5e7eb;
  padding-bottom: 0;
}

.admin-tabs button {
  padding: 10px 20px;
  border: none;
  background: none;
  font-size: 14px;
  color: #6b7280;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
}

.admin-tabs button.active {
  color: #111827;
  border-bottom-color: #111827;
  font-weight: 600;
}

.admin-content {
  animation: fadeIn 0.2s;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.list-toolbar {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.list-toolbar input {
  flex: 1;
  min-width: 200px;
  padding: 8px 12px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 13px;
}

.list-toolbar select {
  padding: 8px 12px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 13px;
}

.list-toolbar button {
  padding: 8px 16px;
  background: #111827;
  color: #fff;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
}

.btn-batch-score {
  background: #2563eb !important;
}
.btn-batch-score:disabled {
  background: #9ca3af !important;
  cursor: not-allowed;
}

.th-check, .td-check {
  width: 36px;
  text-align: center;
}

.btn-secondary {
  background: #f3f4f6 !important;
  color: #374151 !important;
  border: 1px solid #d1d5db !important;
}

.tender-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.tender-table th {
  text-align: left;
  padding: 10px 12px;
  background: #f9fafb;
  border-bottom: 1px solid #e5e7eb;
  font-weight: 600;
  color: #374151;
}

.tender-table td {
  padding: 10px 12px;
  border-bottom: 1px solid #f3f4f6;
  color: #111827;
}

.td-title {
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.td-title a {
  color: #3b82f6;
  text-decoration: none;
}

.td-title a:hover { text-decoration: underline; }

.td-type {
  font-size: 11px;
  color: #6b7280;
  white-space: nowrap;
}

.btn-sm {
  padding: 4px 10px;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
  border: 1px solid #e5e7eb;
  background: #fff;
}

.btn-sm.btn-active {
  background: #d1fae5;
  color: #065f46;
  border-color: #a7f3d0;
}

.btn-danger { color: #dc2626; border-color: #fecaca; }

.status-badge {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
}

.status-badge.completed { background: #d1fae5; color: #065f46; }
.status-badge.running { background: #dbeafe; color: #1e40af; }
.status-badge.failed { background: #fee2e2; color: #991b1b; }

.pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  margin-top: 20px;
}

.pagination button {
  padding: 6px 12px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
  font-size: 13px;
}

.pagination button:disabled { opacity: 0.4; cursor: not-allowed; }

.loading {
  text-align: center;
  padding: 40px;
  color: #6b7280;
}

/* Crawl Panel */
.crawl-panel {
  max-width: 700px;
}

.crawl-config h3 {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 16px;
}

.form-group {
  margin-bottom: 16px;
}

.form-group label {
  display: block;
  font-size: 13px;
  font-weight: 500;
  color: #374151;
  margin-bottom: 6px;
}

.form-group input, .form-group .platform-select {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 13px;
  font-family: inherit;
}

.form-hint {
  font-size: 11px;
  color: #9ca3af;
  margin-top: 4px;
}

.keyword-select-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}

.btn-link {
  border: none;
  background: none;
  color: #3b82f6;
  font-size: 12px;
  cursor: pointer;
  padding: 0;
  text-decoration: underline;
}

.keyword-count {
  font-size: 12px;
  color: #6b7280;
}

.keyword-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 12px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #f9fafb;
  min-height: 48px;
}

.keyword-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  border: 1px solid #d1d5db;
  border-radius: 16px;
  background: #fff;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s;
}

.keyword-chip:hover {
  border-color: #3b82f6;
  background: #eff6ff;
}

.keyword-chip.selected {
  background: #111827;
  color: #fff;
  border-color: #111827;
}

.chip-category {
  font-size: 10px;
  opacity: 0.7;
  margin-left: 2px;
}

.crawl-btn {
  padding: 12px 32px;
  background: #111827;
  color: #fff;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.crawl-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.crawl-note {
  margin-top: 12px;
  font-size: 12px;
  color: #6b7280;
}

/* Keywords Pool Panel */
.keywords-panel {
  max-width: 700px;
}

.keywords-header {
  margin-bottom: 20px;
}

.keywords-header h3 {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 4px;
}

.keywords-desc {
  font-size: 13px;
  color: #6b7280;
}

.add-keyword-row {
  display: flex;
  gap: 8px;
  margin-bottom: 20px;
}

.add-keyword-row input {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 13px;
}

.add-keyword-row button {
  padding: 8px 20px;
  background: #111827;
  color: #fff;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
}

.pool-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.pool-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  transition: all 0.15s;
}

.pool-item.disabled {
  opacity: 0.5;
}

.pool-keyword {
  font-size: 14px;
  font-weight: 500;
  color: #111827;
}

.pool-category {
  font-size: 11px;
  color: #6b7280;
  padding: 2px 8px;
  background: #e5e7eb;
  border-radius: 4px;
}

.pool-actions {
  margin-left: auto;
  display: flex;
  gap: 6px;
}

.empty-hint {
  font-size: 13px;
  color: #9ca3af;
  padding: 16px 0;
  text-align: center;
}

.global-status {
  margin-bottom: 16px;
}

/* Crawl Status Banner */
.crawl-status-banner {
  padding: 16px 20px;
  border-radius: 10px;
  margin-bottom: 20px;
  border: 1px solid #e5e7eb;
  background: #f9fafb;
}

.crawl-status-banner.crawling,
.crawl-status-banner.extracting,
.crawl-status-banner.recommending {
  background: #eff6ff;
  border-color: #bfdbfe;
}

.crawl-status-banner.completed {
  background: #f0fdf4;
  border-color: #bbf7d0;
}

.crawl-status-banner.failed {
  background: #fef2f2;
  border-color: #fecaca;
}

.status-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.status-icon {
  font-size: 16px;
}

.status-label {
  font-size: 14px;
  font-weight: 600;
  color: #111827;
}

.btn-abort {
  margin-left: auto;
  padding: 4px 12px;
  background: #ef4444;
  color: white;
  border: none;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
}

.btn-abort:hover {
  background: #dc2626;
}

.status-message {
  font-size: 13px;
  color: #374151;
  margin-bottom: 8px;
}

.status-progress {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}

.progress-bar {
  flex: 1;
  height: 6px;
  background: #e5e7eb;
  border-radius: 3px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: #3b82f6;
  border-radius: 3px;
  transition: width 0.3s ease;
}

.progress-text {
  font-size: 12px;
  color: #6b7280;
  white-space: nowrap;
}

.status-time {
  font-size: 11px;
  color: #9ca3af;
}

.status-logs {
  margin-top: 12px;
  border-top: 1px solid #e5e7eb;
  padding-top: 10px;
}

.logs-header {
  font-size: 12px;
  font-weight: 600;
  color: #374151;
  margin-bottom: 6px;
  cursor: pointer;
  user-select: none;
  display: flex;
  align-items: center;
  gap: 4px;
}

.logs-header:hover {
  color: #111827;
}

.logs-toggle-icon {
  font-size: 10px;
  width: 12px;
}

.logs-content {
  max-height: 400px;
  overflow-y: auto;
  background: #111827;
  border-radius: 6px;
  padding: 10px 12px;
  font-family: 'Menlo', 'Monaco', 'Courier New', monospace;
  font-size: 11px;
  line-height: 1.6;
}

.log-entry {
  margin-bottom: 2px;
}

.log-line {
  color: #d1d5db;
  white-space: pre-wrap;
  word-break: break-all;
}

.log-time {
  color: #6b7280;
}

.log-toggle {
  background: none;
  border: 1px solid #4b5563;
  color: #9ca3af;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 3px;
  cursor: pointer;
  margin-left: 8px;
  font-family: inherit;
}

.log-toggle:hover {
  background: #374151;
  color: #e5e7eb;
}

.log-detail {
  margin: 4px 0 8px 16px;
  padding: 8px 10px;
  background: #1f2937;
  border: 1px solid #374151;
  border-radius: 4px;
  color: #9ca3af;
  font-size: 10px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 300px;
  overflow-y: auto;
}

/* Scoring Config */
.scoring-panel {
  max-width: 800px;
}

.scoring-section {
  margin-bottom: 32px;
  padding-bottom: 24px;
  border-bottom: 1px solid #e5e7eb;
}

.scoring-section:last-of-type {
  border-bottom: none;
}

.scoring-section h3 {
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 4px;
}

.scoring-hint {
  font-size: 13px;
  color: #6b7280;
  margin-top: 24px;
  margin-bottom: 0;
  text-align: center;
  background: rgba(0, 0, 0, 0.02);
  padding: 12px;
  border-radius: 8px;
}

.scoring-hint code {
  background: #f3f4f6;
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 11px;
}

.weights-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}

.weight-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.weight-item label {
  font-size: 12px;
  color: #374151;
  font-weight: 500;
}

.weight-item input {
  padding: 6px 10px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 13px;
  width: 100%;
}

.weights-sum {
  margin-top: 8px;
  font-size: 12px;
  color: #10b981;
  font-weight: 500;
}

.weights-sum.invalid {
  color: #ef4444;
}

.threshold-input {
  padding: 6px 10px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 13px;
  width: 80px;
}

.prompt-textarea {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-family: 'Menlo', 'Monaco', 'Courier New', monospace;
  font-size: 12px;
  line-height: 1.5;
  resize: vertical;
  min-height: 150px;
}

.prompt-textarea:focus {
  outline: none;
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.scoring-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 16px;
}

.btn-save {
  padding: 8px 20px;
  background: #3b82f6;
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}

.btn-save:hover {
  background: #2563eb;
}

.save-success {
  font-size: 13px;
  color: #10b981;
  font-weight: 500;
}

/* Tender Status Badges */
.tender-status {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
}

.tender-status.draft {
  background: #f3f4f6;
  color: #6b7280;
}

.tender-status.extracted {
  background: #dbeafe;
  color: #1e40af;
}

.tender-status.scored {
  background: #d1fae5;
  color: #065f46;
}

/* Drafts Tab */
.drafts-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.drafts-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.drafts-filter {
  display: flex;
  align-items: center;
  gap: 8px;
}

.drafts-filter select {
  padding: 6px 12px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 13px;
}

.btn-primary {
  padding: 8px 16px;
  background: #111827;
  color: #fff;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.user-select {
  padding: 6px 12px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 13px;
  min-width: 120px;
}

.force-checkbox {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #4b5563;
  cursor: pointer;
  margin-top: 16px;
}

.force-checkbox input {
  cursor: pointer;
}

.th-checkbox, .td-checkbox {
  width: 36px;
  text-align: center;
}

.td-actions {
  white-space: nowrap;
  display: flex;
  gap: 4px;
}

.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  animation: fadeIn 0.2s ease;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.modal-content {
  background: #ffffff;
  border-radius: 20px;
  box-shadow: 0 24px 48px -12px rgba(0, 0, 0, 0.18);
}

.edit-draft-modal {
  width: 680px;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
}

.score-dialog {
  width: 440px;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 24px 32px;
  border-bottom: 0.5px solid rgba(0, 0, 0, 0.05);
}

.modal-header h3 {
  font-size: 20px;
  font-weight: 600;
  margin: 0;
  letter-spacing: -0.02em;
}

.modal-close {
  background: rgba(0, 0, 0, 0.03);
  border: none;
  width: 32px;
  height: 32px;
  border-radius: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  color: #6b7280;
  cursor: pointer;
  padding: 0;
  transition: all 0.2s;
}

.modal-close:hover {
  background: rgba(0, 0, 0, 0.06);
  color: #111827;
}

.modal-body {
  padding: 24px 32px;
  overflow-y: auto;
  flex: 1;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 20px 32px;
  border-top: 0.5px solid rgba(0, 0, 0, 0.05);
  background: #fafafa;
  border-radius: 0 0 20px 20px;
}

.edit-form-group {
  margin-bottom: 20px;
  flex: 1;
}

.edit-form-group label {
  display: block;
  font-size: 13px;
  font-weight: 600;
  color: #4b5563;
  margin-bottom: 8px;
}

.edit-form-row {
  display: flex;
  gap: 20px;
  margin-bottom: 16px;
}

.edit-input, .edit-select {
  width: 100%;
  padding: 10px 14px;
  border: 1px solid rgba(0, 0, 0, 0.1);
  border-radius: 10px;
  font-size: 14px;
  font-family: var(--font-sans);
  background: #fbfbfd;
  transition: all 0.2s ease;
  box-sizing: border-box;
}

.edit-input:focus, .edit-select:focus {
  outline: none;
  background: #ffffff;
  border-color: #3b5bdb;
  box-shadow: 0 0 0 3px rgba(59, 91, 219, 0.1);
}
.edit-textarea {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 12px;
  font-family: 'Menlo', monospace;
  line-height: 1.5;
  resize: vertical;
}

.edit-textarea:focus {
  outline: none;
  background: #ffffff;
  border-color: #3b5bdb;
  box-shadow: 0 0 0 3px rgba(59, 91, 219, 0.1);
}
</style>
