<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch, nextTick } from 'vue'
import { apiGet, apiPost, apiPatch, apiPut, apiDelete } from '../../lib/api'

const tenders = ref<any[]>([])
const total = ref(0)
const page = ref(1)
const search = ref('')
const platform = ref('')
const keywordFilter = ref('')
const loading = ref(false)
const usedKeywords = ref<string[]>([])
// 被时效闸门挡掉的条数。列表加上闸门之后会「凭空少一批」，
// 不显示的话看起来像数据丢了 —— 它们其实都还在库里，只是不再展示和推送。
const hiddenExpired = ref(0)
const visibleDays = ref(14)

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
const activeTab = ref<'list' | 'drafts' | 'crawl' | 'keywords' | 'logs' | 'scoring' | 'sdk' | 'feishu'>('list')

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
  try {
    const params: any = { page: page.value, page_size: 30, search: search.value, platform: platform.value }
    if (keywordFilter.value) params.keyword = keywordFilter.value
    const data = await apiGet('/api/tender/admin/tenders', params)
    tenders.value = data.items
    total.value = data.total
    hiddenExpired.value = data.hiddenExpired || 0
    visibleDays.value = data.visibleDays || 14
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
  loadPurgeStats()
}

// ==================== 清空标讯数据 ====================

// 确认框里的条数必须来自这个接口，**不能**用列表的 total：那个数过了 14 天闸门
// 又叠着搜索/关键词筛选，写「确认清空 12 条」而实际删掉 3000 条 ——
// 用户是照着那个数字点确认的。
const purgeStats = ref<any[]>([])
const purgeOpen = ref(false)
const purging = ref('')
const purgeResult = ref('')

async function loadPurgeStats() {
  try {
    const r: any = await apiGet('/api/tender/admin/tenders/stats')
    purgeStats.value = r.platforms || []
  } catch {}
}

const purgeTotal = computed(() =>
  purgeStats.value.reduce((s: number, p: any) => s + (p.tenders || 0), 0))

function platformLabel(id: string): string {
  return platforms.value.find(p => p.id === id)?.name || id
}

async function doPurge(target: string) {
  const row = purgeStats.value.find((p: any) => p.platform === target)
  const count = target ? (row?.tenders || 0) : purgeTotal.value
  if (count === 0) { purgeResult.value = '没有数据可清。'; return }

  const scope = target ? `平台「${platformLabel(target)}」` : '全部平台'
  if (!confirm(`确认清空${scope}的 ${count} 条标讯？\n\n同时删掉它们的打分、用户反馈、推送记录，含草稿和已超期的行。不可恢复。\n（关键词、评分配置、爬取日志保留）`)) return
  // 全平台是真正回不去的那一下，多问一次。
  if (!target && !confirm(`再确认一次：这会清空所有平台共 ${count} 条标讯。`)) return

  purging.value = target || 'all'
  purgeResult.value = ''
  try {
    const r: any = await apiPost('/api/tender/admin/tenders/purge', target ? { platform: target } : {})
    purgeResult.value =
      `✅ 已清空${scope}：标讯 ${r.tenders} 条、打分 ${r.recommendations} 条、` +
      `用户反馈 ${r.feedback} 条、推送记录 ${r.bitableSync} 条。` +
      `\n⚠️ 飞书多维表格里的旧行不会自动消失（表是只追加的）——` +
      `要清掉得去「飞书推送」里手动推送一次做清空重灌；但候选为 0 时手动推送不会执行，` +
      `所以全清之后表会一直停在旧数据上，等下一轮爬取评分出来再推。`
    await Promise.all([loadPurgeStats(), loadTenders(), loadStats()])
  } catch (e: any) {
    purgeResult.value = `❌ ${e.message}`
  } finally {
    purging.value = ''
  }
}

function formatBudget(amount: number): string {
  if (!amount) return '-'
  if (amount >= 10000) return `${(amount / 10000).toFixed(1)}万`
  return `${amount}元`
}

// 入库时间显示到分钟：同一次爬取的行日期都一样，只显示到天的话
// 看不出「这批是刚抓的还是昨天的」，而这正是按它排序的目的。
function formatCreatedAt(iso: string): string {
  if (!iso) return '-'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso.slice(0, 16).replace('T', ' ')
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
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

// 评分对话框。选**用户**，不选标讯 —— 后端会自动取该用户全部未评分的标讯。
// 原来是勾标讯再评分，这个交互本身就是那个数据丢失 bug 的来源：
// 列表一页只有 30 条，勾了才评，第 2 页之后的没人会去勾，也就永远评不到。
const showScoreDialog = ref(false)

function openScoreDialog() {
  selectedUserId.value = ''
  showScoreDialog.value = true
  loadUsers()
}

async function confirmScore() {
  try {
    await apiPost('/api/tender/admin/recommend', {
      userId: selectedUserId.value || undefined,
    })
    showScoreDialog.value = false
    startPolling()
    alert('推荐评分任务已启动，进度见「运行日志」')
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

function switchAdminTab(tab: 'list' | 'drafts' | 'crawl' | 'keywords' | 'logs' | 'scoring' | 'sdk' | 'feishu') {
  activeTab.value = tab
  if (tab === 'list') {
    loadTenders()
    loadStats()
    loadUsers()
    loadPurgeStats()
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
  if (tab === 'feishu') {
    loadUsers()
  }
}

// ==================== 飞书推送配置 ====================
const feishuUserId = ref('')
const feishuCfg = ref({
  feishu_chat_id: '', feishu_min_score: 55,
  feishu_app_id: '', feishu_app_secret: '',
  bitable_app_token: '', bitable_table_id: '', bitable_all_table_id: '',
  bitable_url: '', bitable_enabled: false,
})
const feishuSaved = ref(false)
const feishuTesting = ref(false)
const bitableBusy = ref('')
// 手动推送的预览数。null = 还没取到（选人之后才有）。
const pushSummary = ref<any>(null)
const pushing = ref(false)
// 机器人所在的群列表。null = 还没拉过；available:false 时只能手填。
const botChats = ref<{ chatId: string; name: string }[]>([])
const chatsState = ref<{ loaded: boolean; available: boolean; reason: string }>({
  loaded: false, available: false, reason: '',
})
const chatsLoading = ref(false)
const grantType = ref<'email' | 'openid' | 'openchat'>('email')
const grantId = ref('')

async function loadFeishuCfg() {
  if (!feishuUserId.value) return
  try {
    feishuCfg.value = await apiGet(`/api/tender/admin/feishu/${feishuUserId.value}`)
  } catch (e: any) {
    console.error(e)
  }
  botChats.value = []
  chatsState.value = { loaded: false, available: false, reason: '' }
  await loadPushSummary()
  // 没填凭据时不去拉：只会拿回一句权限错误，把「先填 App ID」这件事说糊了。
  if (feishuCfg.value.feishu_app_id && feishuCfg.value.feishu_app_secret) await loadBotChats()
}

// 阈值改了、表格重建了，条数都会变，所以每次 loadFeishuCfg 之后都重取一遍。
async function loadPushSummary() {
  if (!feishuUserId.value) { pushSummary.value = null; return }
  try {
    pushSummary.value = await apiGet(`/api/tender/admin/feishu/${feishuUserId.value}/push-summary`)
  } catch (e: any) {
    pushSummary.value = null
    console.error(e)
  }
}

// feishu_chat_id 这一列存的是**逗号分隔的多个群 ID**，和后端 parseChatIds 一个规则。
// 前端也得按同样的规则拆，否则勾选状态会和实际推送的群不一致 ——
// 复选框显示没勾，卡片却发过去了。
function parseChatIds(raw: string): string[] {
  return String(raw || '').split(/[,，;；\s]+/).map((s) => s.trim()).filter(Boolean)
}

const selectedChatIds = computed(() => parseChatIds(feishuCfg.value.feishu_chat_id))
// 已配置但不在机器人群列表里的 id。必须单独列出来：这些通常是机器人被踢出群了，
// 而下面的复选框列表里根本不会出现它 —— 不提示的话管理员以为只配了 2 个群，
// 实际推送时那第 3 个会稳定失败。
const unknownChatIds = computed(() =>
  selectedChatIds.value.filter((id) => !botChats.value.some((c) => c.chatId === id))
)

function toggleChat(chatId: string, on: boolean) {
  const cur = selectedChatIds.value.filter((id) => id !== chatId)
  if (on) cur.push(chatId)
  feishuCfg.value.feishu_chat_id = cur.join(',')
}

// 拉机器人所在的群。需要 im:chat:readonly，它不在推送必需权限里，
// 所以拿不到时不报错、退回手填输入框，把原因显示出来。
async function loadBotChats() {
  if (!feishuUserId.value) return
  chatsLoading.value = true
  try {
    const r: any = await apiGet(`/api/tender/admin/feishu/${feishuUserId.value}/chats`)
    botChats.value = r.chats || []
    chatsState.value = { loaded: true, available: !!r.available, reason: r.reason || '' }
  } catch (e: any) {
    botChats.value = []
    chatsState.value = { loaded: true, available: false, reason: e.message || '拉取失败' }
  } finally {
    chatsLoading.value = false
  }
}

async function manualPush() {
  const s = pushSummary.value
  if (!s) return
  const chats: string[] = s.chatIds || []
  const steps = [
    `1. 把多维表格两张表**清空重灌**成当前数据（${s.recommendCount} 条达标推荐 + ${s.totalCount} 条全部标讯）；用户自己填的「跟进状态」会被保留。`,
    // 群要逐个列出来，不能只说「N 个群」：多勾一个群就是把标讯发到了不该看的人那里，
    // 而这一步一旦发出去撤不回来。
    `2. 向以下 ${chats.length} 个群各推送一张卡片（只列前 5 条，底部按钮跳到这张表）：\n   ${chats.join('\n   ')}`,
  ]
  if (!confirm(`将执行两件事：\n${steps.join('\n')}\n\n重灌是覆盖式的：表里除「跟进状态」外的人工修改会丢。\n\n继续？`)) return
  pushing.value = true
  try {
    const r: any = await apiPost(`/api/tender/admin/feishu/${feishuUserId.value}/push`, {})
    const lines: string[] = []
    if (r.rebuild) {
      const rec = r.rebuild.recommend
      lines.push(`✅ 「标讯推荐」表：清掉 ${rec.cleared} 行，重灌 ${rec.written} 行`)
      if (r.rebuild.all) {
        lines.push(`✅ 「全部标讯」表：清掉 ${r.rebuild.all.cleared} 行，重灌 ${r.rebuild.all.written} 行`)
      }
      if (r.rebuild.followKept > 0) lines.push(`✅ 保留了 ${r.rebuild.followKept} 条「跟进状态」标记`)
    }
    // 逐群报成败。多群时部分成功是常态（最常见是机器人没被拉进某个群），
    // 只报一句「已推送 N 条」的话那个群的失败就被吃掉了 —— 那群人从此收不到推送，
    // 后台一直显示 ✅。
    lines.push(`\n已推送 ${r.pushed} 条：`)
    for (const c of (r.chats || [])) {
      lines.push(c.ok ? `  ✅ ${c.chatId}` : `  ❌ ${c.chatId}：${c.error}`)
    }
    // 实推条数要报出来：和刚才看到的预览数不一样意味着这中间库变了（比如又评了一批）。
    if (r.pushed !== s.recommendCount) {
      lines.push(`\n注意：点按钮时显示 ${s.recommendCount} 条，实际推了 ${r.pushed} 条 —— 这中间库里的推荐变了。`)
    }
    alert(lines.join('\n'))
    await loadPushSummary()
  } catch (e: any) {
    // 重灌清空成功但灌入失败时表是空的，这条必须让人看到 —— 后端在这种情况下
    // 故意没发卡片，不说的话管理员只会以为「推送失败，重试一下」而不知道表已经空了。
    alert(e.message || '推送失败')
  } finally {
    pushing.value = false
  }
}

async function saveFeishuCfg() {
  if (!feishuUserId.value) { alert('请先选择用户'); return }
  try {
    await apiPut(`/api/tender/admin/feishu/${feishuUserId.value}`, feishuCfg.value)
    feishuSaved.value = true
    setTimeout(() => { feishuSaved.value = false }, 2000)
    // 阈值是保存后才生效的，不重取的话按钮旁边还是改之前的条数。
    await loadPushSummary()
  } catch (e: any) {
    alert(e.message || '保存失败')
  }
}

async function testFeishu() {
  if (!feishuUserId.value) { alert('请先选择用户'); return }
  feishuTesting.value = true
  try {
    const r: any = await apiPost(`/api/tender/admin/feishu/${feishuUserId.value}/test`, {})
    // 群要逐个列出来。测试按钮存在的意义就是发现「某个群没把机器人拉进去」，
    // 只说一句「已发送」的话恰好把它藏了。
    const lines = (r.chats || []).map((c: any) => c.ok ? `✅ ${c.chatId}` : `❌ ${c.chatId}：${c.error}`)
    alert(['测试消息已发送，请检查飞书群：', ...lines].join('\n'))
  } catch (e: any) {
    alert(e.message || '测试失败')
  } finally {
    feishuTesting.value = false
  }
}

// ==================== 多维表格 ====================

async function initBitable() {
  if (!feishuUserId.value) { alert('请先选择用户'); return }
  const rebuild = !!feishuCfg.value.bitable_app_token
  if (rebuild && !confirm('该用户已有多维表格。重建会生成一张新表，旧表里的数据和跟进标记不会迁移，确定继续？')) return
  bitableBusy.value = 'init'
  try {
    const r: any = await apiPost(`/api/tender/admin/bitable/${feishuUserId.value}/init`, rebuild ? { force: true } : {})
    await loadFeishuCfg()
    // 这一步失败必须说出来：表会停在租户默认可见范围，可能比「企业内」更宽
    // （管理员配成了「互联网上获得链接的人可阅读」），也可能更严（谁都打不开）。
    const warn = r?.tenantReadable === false
      ? '\n\n⚠️ 但「链接分享」没设置成功，这张表目前停在飞书租户的默认可见范围 —— 可能比企业内更宽（互联网可见），也可能谁都打不开。请点「设为企业内可见」重试。'
      : '\n\n链接分享已设为「本企业内获得链接的人可阅读」，并禁止转发到组织外：企业内的人点卡片按钮就能打开，不用逐个授权。'
    alert('多维表格已创建（含「标讯推荐」「全部标讯」两张表）。' + warn + '\n\n下面的「授权给用户 / 群」只在需要给人**编辑**权（维护「跟进状态」那类列）时才用。')
  } catch (e: any) {
    alert(e.message || '创建失败')
  } finally {
    bitableBusy.value = ''
  }
}

// 历史表格补做 createBitable 现在会自动做的两件事：链接补 ?table=、设为企业内可见。
async function secureBitable() {
  if (!confirm('将执行三件事：\n1. 修正表格链接，使其直接打开「标讯推荐」表；\n2. 把链接分享设为「本企业内获得链接的人可阅读」，并禁止转发到组织外；\n3. 删掉建应用时自带的那张空表（仅删「0 条记录且只有 1 个字段」的表，你自己建的表不会被动）。\n\n第 2 步之后，应用所属企业内的人拿到链接就能只读打开，不用逐个授权；组织外的人打不开。\n\n继续？')) return
  bitableBusy.value = 'secure'
  try {
    const r: any = await apiPost(`/api/tender/admin/bitable/${feishuUserId.value}/secure`, {})
    await loadFeishuCfg()
    const removed: string[] = r.removedTables || []
    const lines = [
      r.urlChanged ? '✅ 表格链接已修正（补上了 ?table=，现在直接打开「标讯推荐」）' : '· 表格链接本来就是对的，未改动',
      r.tenantReadable ? '✅ 链接分享已设为「本企业内可阅读」，且不能转发到组织外' : '⚠️ 链接分享设置失败，表仍停在租户默认可见范围（可能互联网可见，也可能谁都打不开），请重试',
      removed.length > 0 ? `✅ 已删掉 ${removed.length} 张自带空表（${removed.join('、')}）` : '· 没有需要清理的自带空表',
    ]
    alert(lines.join('\n'))
  } catch (e: any) {
    alert(e.message || '操作失败')
  } finally {
    bitableBusy.value = ''
  }
}

// 群授权一律只读：授权给群等于该群**全体成员**都能开这张表，
// 而表里是这个账号的全部投标信息（预算、评分、AI 分析和策略）。
// 给整群 edit 意味着任何一个成员都能改甚至删记录。
// 个人授权保持 edit —— 表的主人要能自己维护「跟进状态」这类列。
// 服务端也会强制这条规则，这里只是让按钮上的字和实际行为一致。
const grantPerm = computed(() => (grantType.value === 'openchat' ? 'view' : 'edit'))

async function grantBitable() {
  if (!grantId.value.trim()) { alert('请填写要授权的对象') ; return }
  bitableBusy.value = 'grant'
  try {
    await apiPost(`/api/tender/admin/bitable/${feishuUserId.value}/grant`, {
      member_type: grantType.value, member_id: grantId.value.trim(), perm: grantPerm.value,
    })
    alert(grantPerm.value === 'view' ? '授权成功（群成员只读）' : '授权成功（可编辑）')
    grantId.value = ''
  } catch (e: any) {
    alert(e.message || '授权失败')
  } finally {
    bitableBusy.value = ''
  }
}

async function syncBitable() {
  bitableBusy.value = 'sync'
  try {
    const r = await apiPost(`/api/tender/admin/bitable/${feishuUserId.value}/sync`, {})
    const parts: string[] = []
    if (r.synced > 0) parts.push(`推荐 ${r.synced} 条`)
    if (r.syncedAll > 0) parts.push(`全部标讯 ${r.syncedAll} 条`)
    if (r.allSkipped) parts.push(`（全部标讯表：${r.allSkipped}）`)
    alert(parts.length ? `已同步 ${parts.join('、')}` : '没有待同步的数据（都已推送过）')
    await loadFeishuCfg()
  } catch (e: any) {
    alert(e.message || '同步失败')
  } finally {
    bitableBusy.value = ''
  }
}

// 给已有表格补建「全部标讯」表。老用户不能走重建（会换 app_token，跟进标记全丢）。
async function initAllTable() {
  bitableBusy.value = 'allTable'
  try {
    await apiPost(`/api/tender/admin/bitable/${feishuUserId.value}/init-all-table`, {})
    await loadFeishuCfg()
    alert('「全部标讯」表已创建，点「同步全部未推送」把数据写进去。')
  } catch (e: any) {
    alert(e.message || '创建失败')
  } finally {
    bitableBusy.value = ''
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
        <!-- 过期条数必须显示：这些标讯还算在「总标讯」里，但用户列表/评分/推送都
             已经看不到它们了。不写出来的话，总数和用户实际看到的条数长期对不上。 -->
        <span
          v-if="stats.expiredTenders"
          class="stat-expired"
          :title="`超过 ${stats.visibleDays} 天的标讯不再进入用户列表、不再评分、不再推送，但数据仍保留在库中`"
        >已过时效: {{ stats.expiredTenders }}（保留数据，不再推送）</span>
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
      <button :class="{ active: activeTab === 'feishu' }" @click="switchAdminTab('feishu')">飞书推送</button>
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
          <!-- 平台列表来自 /admin/platforms（后端 crawlerRegistry），不要写死：
               之前这里硬编码只有 gdgpo，新增数据源后在列表里筛不出来。 -->
          <option v-for="p in platforms" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
        <select v-model="keywordFilter" @change="page = 1; loadTenders()">
          <option value="">全部关键词</option>
          <option v-for="kw in usedKeywords" :key="kw" :value="kw">{{ kw }}</option>
        </select>
        <button @click="page = 1; loadTenders()">搜索</button>
        <!-- 评分不再依赖这里的筛选/勾选：点开后选用户，后端评该用户全部未评分的标讯 -->
        <button class="btn-batch-score" @click="openScoreDialog()">按用户评分</button>
      </div>

      <!-- 闸门挡掉了多少条必须写出来：不说的话列表「凭空少一批」看起来像数据丢了。 -->
      <p class="list-note">
        列表按<b>入库时间</b>倒序（最新在前）。只显示入库和发布都在 {{ visibleDays }} 天内的标讯 ——
        超期的不再展示、不再评分、不再推送给用户，但数据仍在库里。
        <span v-if="hiddenExpired > 0">当前有 <b>{{ hiddenExpired }}</b> 条已超期未显示。</span>
      </p>

      <!-- 清空数据。折叠着放，展开后每个平台一行，条数是库里的真实行数
           （不是上面列表的 total —— 那个过了闸门和筛选）。 -->
      <div class="purge-box">
        <button class="purge-toggle" @click="purgeOpen = !purgeOpen; purgeOpen && loadPurgeStats()">
          {{ purgeOpen ? '▼' : '▶' }} 清空标讯数据（危险操作）
        </button>
        <div v-if="purgeOpen" class="purge-panel">
          <p class="purge-note">
            清掉标讯本体 + 打分 + 用户反馈 + 推送记录，<b>含草稿和已超期的行</b>，不可恢复。
            关键词、评分配置、爬取日志、飞书配置都保留。下面的条数是库里的真实行数，不受上面的筛选影响。
          </p>
          <table class="purge-table">
            <tr v-for="p in purgeStats" :key="p.platform">
              <td>{{ platformLabel(p.platform) }}</td>
              <td>{{ p.tenders }} 条标讯 / {{ p.recommendations }} 条打分</td>
              <td>
                <button class="btn-sm btn-danger" :disabled="!!purging" @click="doPurge(p.platform)">
                  {{ purging === p.platform ? '清理中...' : '清空这个平台' }}
                </button>
              </td>
            </tr>
            <tr v-if="!purgeStats.length"><td colspan="3">库里没有标讯数据。</td></tr>
          </table>
          <button v-if="purgeStats.length" class="btn-purge-all" :disabled="!!purging" @click="doPurge('')">
            {{ purging === 'all' ? '清理中...' : `清空全部平台（共 ${purgeTotal} 条）` }}
          </button>
          <pre v-if="purgeResult" class="purge-result">{{ purgeResult }}</pre>
        </div>
      </div>

      <div v-if="loading" class="loading">加载中...</div>
      <table v-else class="tender-table">
        <thead>
          <tr>
            <th>标题</th>
            <th>类型</th>
            <th>采购人</th>
            <th>预算</th>
            <th>地区</th>
            <th>发布日期</th>
            <!-- 列表按入库时间倒序，所以这一列必须显示出来：
                 排序依据看不见的话，一个按发布日期看起来乱序的列表读不出规律。 -->
            <th>入库时间</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="t in tenders" :key="t.id">
            <td class="td-title">
              <a v-if="t.url" :href="t.url" target="_blank">{{ t.title }}</a>
              <span v-else>{{ t.title }}</span>
            </td>
            <td class="td-type">{{ t.notice_type || '-' }}</td>
            <td>{{ t.purchaser_name || '-' }}</td>
            <td>{{ formatBudget(t.budget_amount) }}</td>
            <td>{{ t.region_name || '-' }}</td>
            <td>{{ t.publish_date?.slice(0, 10) }}</td>
            <td class="td-created">{{ formatCreatedAt(t.created_at) }}</td>
            <td><span :class="['tender-status', t.status || 'extracted']">{{ getStatusLabel(t.status) }}</span></td>
            <td class="td-actions">
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

    <!-- 飞书推送 Tab -->
    <div v-if="activeTab === 'feishu'" class="admin-content feishu-panel">
      <div class="sdk-intro">
        <p>为指定用户配置<b>飞书应用推送</b>。每次评分完成后，该用户本轮新产生、且分数达到阈值的推荐，会汇总成一条卡片消息由应用发到指定群。</p>
        <ul>
          <li>推送和下面的多维表格<b>共用同一个自建应用</b>（同一份 App ID / App Secret），只需再填一个群 ID。</li>
          <li>群 ID 在飞书里：进群 →「设置」→ 群信息里的 <code>oc_</code> 开头那串，直接复制。一个应用可以在多个群里，这里填哪个就推到哪个。</li>
          <li>必须把该应用<b>作为机器人拉进这个群</b>，否则推送报 230013。填完先点「发送测试消息」验证。</li>
          <li>卡片最多列 <b>5 条</b>（按分数从高到低），被截掉的条数会写在卡片里，底部按钮跳到多维表格看全部。</li>
          <li>推送失败<b>不重试</b>，只在运行日志里记一行。</li>
        </ul>
      </div>

      <div class="sdk-create card">
        <div class="edit-form-group">
          <label>选择用户</label>
          <select v-model="feishuUserId" class="edit-input" @change="loadFeishuCfg">
            <option value="">请选择用户</option>
            <option v-for="u in userList" :key="u.id" :value="u.id">{{ u.username }}</option>
          </select>
        </div>

        <template v-if="feishuUserId">
          <!-- 应用凭据放在最前面：群推送和多维表格都要用它，先填这个后面两块才有意义 -->
          <h4 class="bitable-title">飞书自建应用</h4>
          <ol class="bitable-steps">
            <li>在飞书开发者后台创建<b>企业自建应用</b>，把 App ID / App Secret 填在下面并保存。</li>
            <li>权限管理开通 <code>im:message:send_as_bot</code>（群推送）和 <code>bitable:app</code>（多维表格），都选<b>应用身份</b>，然后创建版本并发布。
              另可选开 <code>im:chat:readonly</code>：只用来把机器人所在的群列出来给你勾选，不开就手填群 ID，推送不受影响。</li>
            <li>「应用功能 → 机器人」打开开关，再把这个应用拉进要接收推送的群。</li>
          </ol>
          <div class="edit-form-group">
            <label>App ID</label>
            <input v-model="feishuCfg.feishu_app_id" class="edit-input" placeholder="cli_xxxxxxxxxxxx" />
          </div>
          <div class="edit-form-group">
            <label>App Secret</label>
            <input v-model="feishuCfg.feishu_app_secret" class="edit-input" placeholder="应用凭证里的 App Secret" />
          </div>

          <hr class="bitable-sep" />

          <h4 class="bitable-title">群推送</h4>
          <!-- 这里原来有个「启用飞书推送」开关，管的是评分流程里的自动推送。
               自动推送去掉之后它就什么都不管了 —— 留着比删掉更糟：管理员关掉它以为
               不会再推，而下面的按钮照样能推。推送现在只有「点按钮」这一个入口。 -->
          <p class="bitable-hint">
            卡片<b>不会</b>在评分结束时自动发出，只在下面点「立即推送到飞书群」时发。
            原因是多维表格只追加不更新：评分刚结束时行里的截止日期、预算、处理状态都还是空的，
            那时发卡片，用户点进去看到的和卡片说的不是一回事。手动推送会先把表清空重灌成当前数据。
          </p>
          <!-- 推送群支持多选，存成一列逗号分隔的 id。优先给复选框（oc_xxx 在飞书客户端里
               基本不可见，手填就是让人填错），拉不到列表时退回手填而不是卡死。 -->
          <div class="edit-form-group">
            <label>推送群（可多选，已选 {{ selectedChatIds.length }} 个）</label>

            <div v-if="chatsLoading" class="bitable-note">正在拉取机器人所在的群…</div>

            <div v-else-if="chatsState.available && botChats.length" class="chat-list">
              <label v-for="c in botChats" :key="c.chatId" class="chat-item">
                <input
                  type="checkbox"
                  :checked="selectedChatIds.includes(c.chatId)"
                  @change="toggleChat(c.chatId, ($event.target as HTMLInputElement).checked)"
                />
                <span class="chat-name">{{ c.name }}</span>
                <code class="chat-id">{{ c.chatId }}</code>
              </label>
            </div>

            <div v-else-if="chatsState.loaded && chatsState.available" class="bitable-note">
              这个应用还没被拉进任何群。到飞书群「设置 → 群机器人 → 添加机器人」把它加进去，再点下面的刷新。
            </div>

            <!-- 拉不到群列表（多半是没开 im:chat:readonly）时，手填仍然要能配 -->
            <div v-else-if="chatsState.loaded" class="bitable-note push-blocked">
              取不到群列表（{{ chatsState.reason }}）—— 下面手填群 ID 即可，推送本身不需要这个权限。
            </div>

            <!-- 手填兜底永远可见：机器人被踢出群之后上面的列表里就没有它了，
                 只有这里能看到「已经配了但列表里没有」的那些 id。 -->
            <input
              v-model="feishuCfg.feishu_chat_id"
              class="edit-input"
              style="margin-top:8px"
              placeholder="oc_xxxx,oc_yyyy（多个用逗号分隔）"
            />
            <span class="bitable-note">
              手填时多个群用逗号分隔。群 ID 在飞书群「设置 → 群信息」里复制；应用必须已作为机器人在群内，否则推送报 230013。
            </span>
            <span v-if="unknownChatIds.length" class="push-blocked">
              这 {{ unknownChatIds.length }} 个已配置的群不在机器人所在的群里（可能机器人已被移出），推送会失败：{{ unknownChatIds.join('、') }}
            </span>
            <div class="scoring-actions" style="margin-top:6px">
              <button class="btn-secondary" @click="loadBotChats" :disabled="chatsLoading">刷新群列表</button>
            </div>
          </div>
          <div class="edit-form-group">
            <label>推送分数阈值（≥ 此分才推送）</label>
            <input v-model.number="feishuCfg.feishu_min_score" type="number" min="0" max="100" class="edit-input" style="max-width:120px" />
            <span class="bitable-note">这个阈值同时决定哪些推荐会同步进「标讯推荐」表。</span>
          </div>
          <div class="scoring-actions">
            <button class="btn-primary" @click="saveFeishuCfg">保存配置</button>
            <button class="btn-secondary" @click="testFeishu" :disabled="feishuTesting" style="margin-left:8px">
              {{ feishuTesting ? '发送中…' : '发送测试消息' }}
            </button>
            <span v-if="feishuSaved" class="save-success" style="margin-left:10px">已保存</span>
          </div>

          <!-- 手动推送。推的是「当前所有达标推荐」，不是「本轮新评出来的」——
               所以这里的条数就是卡片标题里的那个数。 -->
          <div v-if="pushSummary" class="push-box">
            <div class="push-nums">
              当前达标推荐 <b>{{ pushSummary.recommendCount }}</b> 条（≥ {{ pushSummary.minScore }} 分）
              · 库里可见标讯共 <b>{{ pushSummary.totalCount }}</b> 条
            </div>
            <!-- 会收到卡片的群要列出来，只显示个数的话多勾一个群没人看得出，
                 而发出去的标讯撤不回来。这里显示的是**已保存**的配置（后端返回的），
                 上面刚勾还没保存的不算 —— 两者不一致时管理员该先点保存。 -->
            <div v-if="pushSummary.chatIds?.length" class="push-nums">
              会推送到 {{ pushSummary.chatIds.length }} 个群：{{ pushSummary.chatIds.join('、') }}
            </div>
            <div class="scoring-actions">
              <button
                class="btn-primary" @click="manualPush"
                :disabled="pushing || !!pushSummary.blockedBy"
              >
                {{ pushing ? '推送中…' : '立即推送到飞书群' }}
              </button>
              <button class="btn-secondary" @click="loadPushSummary" style="margin-left:8px">刷新条数</button>
              <!-- 按钮为什么点不了必须写出来，否则管理员只看到一个灰按钮 -->
              <span v-if="pushSummary.blockedBy" class="push-blocked">不能推送：{{ pushSummary.blockedBy }}</span>
            </div>
            <span class="bitable-note">
              点一次会先把多维表格<b>清空重灌</b>成当前数据（这样处理状态、截止日期、预算才是最新的
              —— 增量同步只追加不更新，写进去的行不会再变），再发卡片。用户填的「跟进状态」会保留。
              重灌中途失败时不会发卡片（那时表是空的）。
            </span>
          </div>

          <hr class="bitable-sep" />

          <h4 class="bitable-title">多维表格同步</h4>
          <p class="bitable-hint">
            数据会写进一张飞书多维表格里的两张表：<b>标讯推荐</b>（达到阈值的、带评分和等级）
            和 <b>全部标讯</b>（库里全量，按用户勾选的平台过滤，可自己按预算/截止日期筛）。
            表格由服务端创建并建好列，用户不用填任何 ID。推送卡片底部的按钮就跳到这张表。
          </p>
          <ol class="bitable-steps">
            <li>点「创建多维表格」即可。表会自动设成<b>应用所属企业内获得链接的人可阅读</b>（不能转发到组织外），企业内的人点卡片按钮就能打开，不用逐个授权。</li>
            <li>下面的「授权给用户 / 群」只在需要给人<b>编辑</b>权时才用（比如表主人要自己维护「跟进状态」列）。应用创建的文件不在任何人的云空间里，只能靠链接打开。</li>
            <li>可选：机器人自定义菜单加一项，类型选<b>跳转链接</b>，URL 填下面生成的表格地址 —— 用户在机器人窗口就有常驻入口。</li>
          </ol>

          <div class="edit-form-group">
            <label class="force-checkbox">
              <input type="checkbox" v-model="feishuCfg.bitable_enabled" />
              启用多维表格同步
            </label>
          </div>
          <div class="edit-form-group">
            <label>表格地址（创建后自动填入）</label>
            <input :value="feishuCfg.bitable_url" class="edit-input" readonly placeholder="尚未创建" />
          </div>

          <div class="scoring-actions">
            <button class="btn-primary" @click="initBitable" :disabled="!!bitableBusy">
              {{ bitableBusy === 'init' ? '创建中…' : (feishuCfg.bitable_app_token ? '重建多维表格' : '创建多维表格') }}
            </button>
            <button class="btn-secondary" @click="syncBitable" :disabled="!!bitableBusy || !feishuCfg.bitable_app_token" style="margin-left:8px">
              {{ bitableBusy === 'sync' ? '同步中…' : '同步全部未推送' }}
            </button>
            <!-- 只对「表已建好但没有全部标讯表」的老用户出现。重建会换 app_token，不能让他们走重建 -->
            <button
              v-if="feishuCfg.bitable_app_token && !feishuCfg.bitable_all_table_id"
              class="btn-secondary" @click="initAllTable" :disabled="!!bitableBusy" style="margin-left:8px"
            >
              {{ bitableBusy === 'allTable' ? '创建中…' : '补建「全部标讯」表' }}
            </button>
            <button
              v-if="feishuCfg.bitable_app_token"
              class="btn-secondary" @click="secureBitable" :disabled="!!bitableBusy" style="margin-left:8px"
            >
              {{ bitableBusy === 'secure' ? '处理中…' : '修正链接并设为企业内可见' }}
            </button>
            <a v-if="feishuCfg.bitable_url" :href="feishuCfg.bitable_url" target="_blank" class="bitable-open">打开表格 ↗</a>
          </div>
          <span v-if="feishuCfg.bitable_app_token" class="bitable-note">
            新建的表格已自动带 <code>?table=</code> 并设为企业内可阅读。早先创建的表格请点一次「修正链接并设为企业内可见」——
            那时候的表是<b>关闭</b>链接分享的（企业内的人打开是「无权限访问」），而不带 <code>?table=</code> 的链接点进去是 base 里的第一张（空）表。
          </span>

          <template v-if="feishuCfg.bitable_app_token">
            <div class="edit-form-group bitable-grant">
              <label>授权给用户 / 群</label>
              <div class="bitable-grant-row">
                <select v-model="grantType" class="edit-input bitable-grant-type">
                  <option value="email">飞书邮箱</option>
                  <option value="openid">用户 Open ID</option>
                  <option value="openchat">群 Chat ID</option>
                </select>
                <input v-model="grantId" class="edit-input" placeholder="填邮箱 / open_id / chat_id" />
                <button class="btn-secondary" @click="grantBitable" :disabled="!!bitableBusy">
                  {{ bitableBusy === 'grant' ? '授权中…' : (grantPerm === 'view' ? '授权（只读）' : '授权（可编辑）') }}
                </button>
              </div>
              <span class="bitable-note">授权给群需要先把应用作为机器人拉进该群，否则会因「互相不可见」失败。</span>
              <span v-if="grantType === 'openchat'" class="bitable-note bitable-note-warn">
                ⚠️ 授权给群 = 该群<strong>全体成员</strong>都能看到这张表里的全部投标信息（预算、评分、AI 分析与策略）。
                权限固定为<strong>只读</strong>，成员不能改动记录。只给个人授权时才是可编辑。
              </span>
            </div>
          </template>
        </template>
      </div>
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
          <p class="scoring-hint">
            将对该用户<b>尚未评分</b>的标讯逐条评分（入库和发布都在 14 天内、且属于他关注的平台）。
            已经评过的不会再评，也不会再花 AI 额度。达到推送阈值的会同步进多维表格。
          </p>
          <p class="scoring-hint scoring-hint-warn">
            评分<b>不发飞书卡片</b> —— 要发去「飞书推送」页点「立即推送到飞书群」。
            单轮上限 200 条／用户，未评完的条数会写在运行日志里，再点一次继续。
            AI 额度用完时评分会中止，已评出的部分仍会同步进表格。
          </p>
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

.bitable-sep { border:none; border-top:1px solid #e2e8f0; margin:22px 0 16px; }
.bitable-title { margin:0 0 6px; font-size:15px; }
.bitable-hint { margin:0 0 10px; font-size:13px; color:#64748b; }
.list-note { margin:0 0 12px; font-size:13px; color:#64748b; }
.list-note b { color:#334155; }
.td-created { font-size:12px; color:#64748b; white-space:nowrap; }

.purge-box { margin:0 0 16px; }
.purge-toggle { background:none; border:none; padding:0; font-size:13px; color:#b91c1c; cursor:pointer; }
.purge-panel { margin-top:10px; padding:12px 14px; border:1px solid #fecaca; border-radius:6px; background:#fef2f2; }
.purge-note { margin:0 0 10px; font-size:13px; color:#7f1d1d; line-height:1.6; }
.purge-table { font-size:13px; border-collapse:collapse; }
.purge-table td { padding:4px 14px 4px 0; color:#334155; }
.btn-purge-all { margin-top:10px; padding:5px 12px; font-size:13px; color:#fff; background:#dc2626; border:none; border-radius:4px; cursor:pointer; }
.btn-purge-all:disabled { opacity:.5; cursor:default; }
.purge-result { margin:10px 0 0; padding:8px 10px; background:#fff; border-radius:4px; font-size:12px; color:#334155; white-space:pre-wrap; }
.bitable-steps { margin:0 0 16px; padding-left:20px; font-size:13px; color:#475569; }
.bitable-steps li { margin:5px 0; }
.bitable-steps code { background:#f1f5f9; padding:1px 5px; border-radius:3px; font-size:12px; }
.bitable-open { margin-left:12px; font-size:13px; color:#2563eb; text-decoration:none; }
.bitable-grant { margin-top:16px; }
.bitable-grant-row { display:flex; gap:8px; align-items:center; }
.bitable-grant-type { max-width:150px; }
.bitable-note { display:block; margin-top:6px; font-size:12px; color:#94a3b8; }
.bitable-note-warn { color:#fbbf24; line-height:1.6; }

.push-box { margin-top:16px; padding:14px 16px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; }
.push-nums { margin-bottom:10px; font-size:14px; color:#334155; }
.push-nums b { color:#2563eb; font-size:16px; }
.push-blocked { margin-left:10px; font-size:13px; color:#f59e0b; }
.chat-list { max-height:220px; overflow-y:auto; border:1px solid #e2e8f0; border-radius:6px; padding:6px 10px; background:#fff; }
.chat-item { display:flex; align-items:center; gap:8px; padding:5px 0; font-size:14px; cursor:pointer; }
.chat-name { color:#334155; }
.chat-id { font-size:12px; color:#94a3b8; }

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

.stat-expired {
  color: #b45309;
  cursor: help;
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

/* 评分弹窗里两段说明相邻，第二段是「会被截掉/会中止」这类必须看到的代价，
   给个色差免得和上一段读成一整块灰字被跳过。 */
.scoring-hint-warn {
  margin-top: 8px;
  color: #b45309;
  background: rgba(180, 83, 9, 0.06);
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
