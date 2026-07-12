<template>
  <div class="page-wrapper">
    <SiteHeader />

    <main class="ui-review-page">
      <!-- Hero Section -->
      <section v-if="!currentReview" class="hero-section">
        <!-- Text Overlay -->
        <div class="hero-text-overlay">
          <div class="hero-badge animate-fade-up delay-1">{{ locale === 'en' ? 'AI-Driven Design Optimization Engine' : 'AI 驱动的设计优化引擎' }}</div>
          <h1 class="hero-title animate-fade-up delay-2">
            <template v-if="locale === 'en'">
              <span class="serif-text"><span class="highlight-char">M</span>ake Your Product Design</span><br/><strong>More Premium</strong>
            </template>
            <template v-else>
              <span class="serif-text"><span class="highlight-char">让</span>你的产品设计</span><br/><strong>更具高级质感</strong>
            </template>
          </h1>
          <p class="hero-subtitle animate-fade-up delay-3">
            <template v-if="locale === 'en'">
              Enter your product URL and get pixel-perfect optimization plans and refactored code benchmarked against top-tier SaaS platforms.
            </template>
            <template v-else>
              输入你的产品网址，获取对标顶尖 SaaS 平台的像素级优化方案与重构代码。
            </template>
          </p>
          
          <div class="input-container animate-fade-up delay-4">
            <div class="unified-search-bar" :class="{ 'is-focused': isFocused }">
              <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
              <input
                v-model="url"
                type="url"
                :placeholder="locale === 'en' ? 'https://your-site.com' : 'https://你的网站.com'"
                class="unified-input"
                @focus="isFocused = true"
                @blur="isFocused = false"
                @keyup.enter="startReview"
              />
              <div class="bar-actions">
                <button class="start-btn" @click="startReview" :disabled="!url || loading">
                  {{ loading ? (locale === 'en' ? 'Looking...' : '正在看...') : (locale === 'en' ? 'Review My Page' : '帮我看看') }}
                </button>
              </div>
            </div>
            <div class="mode-selector">
              <button :class="['mode-btn', { active: reviewMode === 'standard' }]" @click="reviewMode = 'standard'">
                {{ locale === 'en' ? 'Quick' : '快速' }}
              </button>
              <button :class="['mode-btn mode-btn-pro', { active: reviewMode === 'pro' }]" @click="reviewMode = 'pro'">
                PRO
              </button>
              <span class="mode-hint">{{ reviewMode === 'pro' ? (locale === 'en' ? 'Deep analysis + phased fix plan' : '深度分析 + 分阶段修改方案') : (locale === 'en' ? 'Score + fix instructions' : '评分 + 修改指令') }}</span>
            </div>
          </div>
        </div>
      </section>



      <!-- Parallax Cases Section -->
      <section v-if="!currentReview" class="parallax-cases-section">
        <div class="parallax-case">
          <div class="case-text-container">
            <h2 class="case-title">
              <template v-if="locale === 'en'">Same AI,<br/>Different Result</template>
              <template v-else>同一个 AI<br/>不同的结果</template>
            </h2>
            <p class="case-desc">
              <template v-if="locale === 'en'">
                Left: you told AI "make it prettier". Right: I told AI <strong>exactly what to fix</strong>.
              </template>
              <template v-else>
                左边：你跟 AI 说"好看一点"。右边：我告诉 AI <strong>具体改哪里</strong>。
              </template>
            </p>
          </div>
          <div class="case-image-container">
            <BeforeAfterSlider
              before="/demo-before.html"
              after="/demo-after.html"
              :is-iframe="true"
              mode="slider"
            />
          </div>
        </div>
      </section>

      <!-- Instructions Section -->
      <section v-if="!currentReview" class="instructions-section">
        <div class="instructions-container">
          <h2 class="instructions-title">{{ locale === 'en' ? 'How It Works' : '怎么用' }}</h2>
          <div class="instructions-grid">
            <div class="instruction-card">
              <div class="instruction-icon">01</div>
              <h3>{{ locale === 'en' ? 'Show Me' : '给我看' }}</h3>
              <p>{{ locale === 'en' ? 'Paste your URL. That\'s all I need.' : '贴个网址就行。' }}</p>
            </div>
            <div class="instruction-card">
              <div class="instruction-icon">02</div>
              <h3>{{ locale === 'en' ? 'I\'ll Point Out' : '我来指出' }}</h3>
              <p>{{ locale === 'en' ? 'Typography, color, spacing, layout, consistency, craft — I\'ll score each and tell you what\'s off.' : '排版、配色、间距、布局、一致性、质感——逐项打分，哪里不行直接说。' }}</p>
            </div>
            <div class="instruction-card">
              <div class="instruction-icon">03</div>
              <h3>{{ locale === 'en' ? 'You Go Fix' : '你去改' }}</h3>
              <p>{{ locale === 'en' ? 'Copy my instructions into Cursor or Claude. Each fix has the exact selector and value — just execute.' : '把指令复制进 Cursor 或 Claude，每条都有选择器和值，直接执行。' }}</p>
            </div>
          </div>
        </div>
      </section>

      <!-- Progress Section -->
      <section v-else-if="currentReview.status !== 'completed' && currentReview.status !== 'failed'" class="progress-section">
        <div class="progress-container">
          <div class="progress-info">
            <div :class="['progress-badge', { 'progress-badge-pro': reviewMode === 'pro' }]">{{ reviewMode === 'pro' ? 'PRO ANALYSIS' : 'REVIEWING' }}</div>
            <h2 class="progress-title">{{ reviewMode === 'pro' ? (locale === 'en' ? 'Deep diving into your design' : '正在深度解剖你的设计') : (locale === 'en' ? 'Let me take a look' : '让我看看') }}<span class="blinking-cursor">_</span></h2>
            <p class="progress-subtitle">{{ reviewMode === 'pro' ? (locale === 'en' ? 'Running multi-dimensional analysis with industry benchmarks' : '正在做多维度深度分析和行业对标') : (locale === 'en' ? 'Checking your page against what good design actually looks like' : '正在对照专业设计标准审视你的页面') }}</p>
            
            <div class="vertical-step-list">
              <div v-for="(step, index) in steps" :key="step.key" 
                   :class="['vertical-step-item', { active: currentReview.status === step.key, done: stepDone(step.key) }]"
                   :style="{ animationDelay: `${index * 0.15}s` }">
                <div class="step-indicator">
                  <div class="step-line" v-if="index !== steps.length - 1"></div>
                  <span class="step-dot"></span>
                </div>
                <div class="step-content">
                  <span class="step-label">{{ locale === 'en' ? step.labelEn : step.label }}</span>
                  <span class="step-status-text" v-if="currentReview.status === step.key">{{ locale === 'en' ? 'Processing...' : '处理中...' }}</span>
                  <span class="step-status-text" v-else-if="stepDone(step.key)">{{ locale === 'en' ? 'Complete' : '完成' }}</span>
                  <span class="step-status-text" v-else>{{ locale === 'en' ? 'Pending' : '等待中' }}</span>
                </div>
              </div>
            </div>
          </div>
          
          <div class="progress-visual">
            <div class="scanner-container" :class="{ 'has-image': currentReview.screenshot_url }">
              <div class="scanner-line"></div>
              <div class="scanner-overlay"></div>
              
              <!-- Real Image -->
              <img v-if="currentReview.screenshot_url" :src="currentReview.screenshot_url" class="scanned-image" alt="页面截图" />
              
              <!-- Skeleton (when no image yet) -->
              <div v-if="!currentReview.screenshot_url" class="skeleton-wireframe">
                <div class="skel-header"></div>
                <div class="skel-body">
                  <div class="skel-hero"></div>
                  <div class="skel-grid">
                    <div class="skel-card"></div>
                    <div class="skel-card"></div>
                    <div class="skel-card"></div>
                  </div>
                </div>
              </div>

              <!-- Analysis Elements (active during analyzing) -->
              <div class="analysis-overlay" :class="{ active: currentReview.status === 'analyzing' }">
                <div class="measure-line horizontal" style="top: 30%"></div>
                <div class="measure-line vertical" style="left: 40%"></div>
                <div class="measure-line horizontal" style="top: 70%"></div>
                <div class="analysis-dot" style="top: 30%; left: 40%"></div>
                <div class="analysis-dot" style="top: 70%; left: 40%"></div>
                <div class="analysis-box" style="top: 20%; left: 20%; width: 30%; height: 20%"></div>
                <div class="analysis-box" style="top: 50%; left: 50%; width: 40%; height: 30%"></div>
              </div>

              <!-- Code Stream (active during generating) -->
              <div class="code-stream-overlay" :class="{ active: currentReview.status === 'generating' }">
                <div class="code-typing">
                  > Analyzing DOM structure...<br>
                  > Found typography scale issues.<br>
                  > Calculating spacing metrics...<br>
                  > Generating CSS overrides...<br>
                  <span class="terminal-cursor">_</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Error Section -->
      <section v-else-if="currentReview.status === 'failed'" class="error-section">
        <div class="error-card">
          <h2>{{ locale === 'en' ? 'Something went wrong' : '出了点问题' }}</h2>
          <p>{{ currentReview.error_message || (locale === 'en' ? 'Could not access the page. Check the URL and try again.' : '无法访问页面，检查网址后再试一次。') }}</p>
          <button class="start-btn" @click="reset">{{ locale === 'en' ? 'Try Again' : '再试一次' }}</button>
        </div>
      </section>

      <!-- Result Section -->
      <section v-else class="result-section">
        <div class="result-header">
          <div class="result-tabs">
            <button :class="{ active: activeTab === 'report' }" @click="activeTab = 'report'">{{ locale === 'en' ? 'What\'s Wrong' : '问题在哪' }}</button>
            <button v-if="currentReview.mode === 'pro'" :class="['pro-tab-btn', { active: activeTab === 'pro' }]" @click="activeTab = 'pro'">
              <span class="pro-tab-badge">PRO</span>
              {{ locale === 'en' ? 'Deep Analysis' : '深度分析' }}
            </button>
            <button :class="{ active: activeTab === 'export' }" @click="activeTab = 'export'">{{ locale === 'en' ? 'How to Fix' : '怎么改' }}</button>
          </div>
          <button class="reset-btn" @click="reset">{{ locale === 'en' ? 'Review Another' : '换一个' }}</button>
        </div>

        <!-- Report Tab -->
        <div v-if="activeTab === 'report'" class="tab-content">
          <div class="score-overview animate-fade-up delay-1">
            <div class="total-score">
              <span class="score-number">{{ displayScore }}</span>
              <span class="score-label">{{ locale === 'en' ? 'Overall' : '综合评分' }}</span>
            </div>
            <div class="dimension-scores">
              <div v-for="dim in dimensionKeys" :key="dim" class="dim-item">
                <span class="dim-name">{{ locale === 'en' ? dimensionLabelsEn[dim] : dimensionLabelsZh[dim] }}</span>
                <div class="dim-bar">
                  <div class="dim-fill" :style="{ width: getDimScore(dim) + '%' }"></div>
                </div>
                <span class="dim-value">{{ getDimScore(dim) }}</span>
              </div>
            </div>
          </div>
          <div v-if="overallAnalysisText" class="analysis-section animate-fade-up delay-2">
            <h3>{{ locale === 'en' ? 'My Take' : '我的判断' }}</h3>
            <div class="analysis-content">{{ overallAnalysisText }}</div>
          </div>
          <div v-if="dimensionIssues.length" class="issues-section animate-fade-up delay-3">
            <h3>{{ locale === 'en' ? 'Specific Problems' : '具体问题' }}</h3>
            <div class="issues-list">
              <div v-for="(group, idx) in dimensionIssues" :key="idx" class="issue-item">
                <div class="issue-header">
                  <span :class="['issue-severity', group.severity]">{{ group.severity }}</span>
                  <span class="issue-name">{{ locale === 'en' ? dimensionLabelsEn[group.dim] : dimensionLabelsZh[group.dim] }}</span>
                  <span class="issue-score">{{ group.score }}/100</span>
                </div>
                <div class="issue-summary">{{ locale === 'en' ? group.summary.en : group.summary.zh }}</div>
                <ul v-if="group.issues.length" class="issue-details-list">
                  <li v-for="(issue, i) in group.issues" :key="i">{{ locale === 'en' ? issue.en : issue.zh }}</li>
                </ul>
              </div>
            </div>
          </div>
        </div>

        <!-- Pro Deep Analysis Tab -->
        <div v-if="activeTab === 'pro' && currentReview.mode === 'pro'" class="tab-content">
          <div v-if="proAnalysis" class="pro-section">
            <!-- Industry Comparison -->
            <div class="pro-comparison animate-fade-up delay-1">
              <h3>{{ locale === 'en' ? 'Industry Comparison' : '行业对标' }}</h3>
              <p>{{ locale === 'en' ? proAnalysis.industryComparison?.en : proAnalysis.industryComparison?.zh }}</p>
              <div class="pro-score-estimate">
                <span class="label">{{ locale === 'en' ? 'Estimated score after fix:' : '修复后预估分数：' }}</span>
                <span class="value">{{ proAnalysis.estimatedScoreAfterFix }}/100</span>
              </div>
            </div>

            <!-- Dimension Deep Analyses -->
            <div class="pro-dimensions animate-fade-up delay-2">
              <h3>{{ locale === 'en' ? 'Dimension Deep Dive' : '维度深度剖析' }}</h3>
              <div v-for="(dim, idx) in proAnalysis.dimensionAnalyses" :key="idx" class="pro-dim-card">
                <div class="pro-dim-header">
                  <span class="pro-dim-name">{{ locale === 'en' ? dimensionLabelsEn[dim.dimension] : dimensionLabelsZh[dim.dimension] }}</span>
                  <span class="pro-dim-score">{{ dim.score }}/100</span>
                </div>
                <p class="pro-dim-analysis">{{ locale === 'en' ? dim.deepAnalysis?.en : dim.deepAnalysis?.zh }}</p>
                <div v-if="dim.benchmark" class="pro-dim-benchmark">{{ dim.benchmark }}</div>
                <div class="pro-issues-grid">
                  <div v-for="(issue, i) in dim.specificIssues" :key="i" class="pro-issue-item">
                    <div class="pro-issue-meta">
                      <span :class="['pro-issue-severity', issue.severity]">{{ issue.severity }}</span>
                      <span class="pro-issue-cost">{{ issue.fixCost }}</span>
                      <span class="pro-issue-location">{{ issue.location }}</span>
                    </div>
                    <div class="pro-issue-diff">
                      <div class="pro-diff-current">{{ issue.current }}</div>
                      <div class="pro-diff-arrow">→</div>
                      <div class="pro-diff-expected">{{ issue.expected }}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Execution Plan -->
            <div class="pro-plan animate-fade-up delay-3">
              <h3>{{ locale === 'en' ? 'Execution Plan' : '执行方案' }}</h3>
              <div class="pro-phases">
                <div class="pro-phase">
                  <div class="pro-phase-header">
                    <span class="pro-phase-num">1</span>
                    <span class="pro-phase-title">{{ locale === 'en' ? 'Quick wins (1-2h)' : '快速见效（1-2小时）' }}</span>
                  </div>
                  <p>{{ proAnalysis.executionPlan?.phase1 }}</p>
                </div>
                <div class="pro-phase">
                  <div class="pro-phase-header">
                    <span class="pro-phase-num">2</span>
                    <span class="pro-phase-title">{{ locale === 'en' ? 'Structure (half day)' : '结构优化（半天）' }}</span>
                  </div>
                  <p>{{ proAnalysis.executionPlan?.phase2 }}</p>
                </div>
                <div class="pro-phase">
                  <div class="pro-phase-header">
                    <span class="pro-phase-num">3</span>
                    <span class="pro-phase-title">{{ locale === 'en' ? 'Polish (optional)' : '锦上添花（可选）' }}</span>
                  </div>
                  <p>{{ proAnalysis.executionPlan?.phase3 }}</p>
                </div>
              </div>
            </div>
          </div>
          <div v-else class="pro-loading">
            <p>{{ locale === 'en' ? 'Deep analysis is being generated...' : '深度分析正在生成中...' }}</p>
          </div>
        </div>

        <!-- AI Instructions Tab -->
        <div v-if="activeTab === 'export'" class="tab-content">
          <div class="export-section">
            <p class="export-hint">{{ locale === 'en' ? 'Copy this into Cursor or Claude. It knows what to do.' : '复制到 Cursor 或 Claude 里，它知道该怎么改。' }}</p>
            <div class="export-actions">
              <button class="start-btn" @click="copySkill">{{ locale === 'en' ? 'Copy' : '复制' }}</button>
              <button class="btn-secondary" @click="downloadSkill">{{ locale === 'en' ? 'Download' : '下载' }}</button>
            </div>
            <pre class="skill-content">{{ currentReview.skill_markdown || (locale === 'en' ? 'Still working on it...' : '还在生成中...') }}</pre>
          </div>
        </div>
      </section>
    </main>

    <SiteFooter />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { apiGet, apiPost } from '../../lib/api'
import SiteHeader from '../../components/common/SiteHeader.vue'
import SiteFooter from '../../components/common/SiteFooter.vue'
import BeforeAfterSlider from '../../components/common/BeforeAfterSlider.vue'

const route = useRoute()
const locale = computed(() => route.path.startsWith('/en/') ? 'en' : 'zh')

const url = ref('')
const loading = ref(false)
const currentReview = ref<any>(null)
const activeTab = ref<'report' | 'pro' | 'export'>('report')
const isFocused = ref(false)
const reviewMode = ref<'standard' | 'pro'>('standard')

const displayScore = ref(0)
let scoreTimer: any = null

const scrollY = ref(0)

const updateScroll = () => {
  scrollY.value = window.scrollY
}

onMounted(() => {
  window.addEventListener('scroll', updateScroll, { passive: true })
})

onUnmounted(() => {
  window.removeEventListener('scroll', updateScroll)
  if (pollTimer) clearInterval(pollTimer)
  if (scoreTimer) clearInterval(scoreTimer)
})


watch(() => currentReview.value?.status, (newVal) => {
  if (newVal === 'completed' && currentReview.value?.mode === 'pro') {
    activeTab.value = 'pro'
  }
})

watch(() => currentReview.value?.total_score, (newVal) => {
  if (newVal !== undefined) {
    if (scoreTimer) clearInterval(scoreTimer)
    let current = 0
    const target = Math.round(newVal)
    if (target === 0) {
      displayScore.value = 0
      return
    }
    const step = target / 30 // 30 frames for the animation
    scoreTimer = setInterval(() => {
      current += step
      if (current >= target) {
        displayScore.value = target
        clearInterval(scoreTimer)
        scoreTimer = null
      } else {
        displayScore.value = Math.round(current)
      }
    }, 16)
  }
})

let pollTimer: any = null

const steps = [
  { key: 'pending', label: '准备中', labelEn: 'Preparing' },
  { key: 'crawling', label: '打开页面', labelEn: 'Opening page' },
  { key: 'analyzing', label: '审视设计', labelEn: 'Reviewing design' },
  { key: 'generating', label: '写修改方案', labelEn: 'Writing fix plan' },
  { key: 'completed', label: '好了', labelEn: 'Done' },
]

const dimensionKeys = ['typography', 'colorHarmony', 'spacing', 'layout', 'consistency', 'aesthetics']

const dimensionLabelsZh: Record<string, string> = {
  typography: '排版层级',
  colorHarmony: '色彩和谐',
  spacing: '间距与留白',
  layout: '布局结构',
  consistency: '视觉一致性',
  aesthetics: '整体质感',
}

const dimensionLabelsEn: Record<string, string> = {
  typography: 'Typography',
  colorHarmony: 'Color Harmony',
  spacing: 'Spacing & Whitespace',
  layout: 'Layout Structure',
  consistency: 'Visual Consistency',
  aesthetics: 'Overall Aesthetics',
}


const parsedDimensions = computed(() => {
  if (!currentReview.value?.dimension_scores) return null
  try { return JSON.parse(currentReview.value.dimension_scores) } catch { return null }
})

const proAnalysis = computed(() => {
  if (!currentReview.value?.pro_analysis) return null
  try { return JSON.parse(currentReview.value.pro_analysis) } catch { return null }
})

function getDimScore(dim: string): number {
  const dims = parsedDimensions.value
  if (!dims || !dims[dim]) return 0
  return Math.round(dims[dim].score ?? dims[dim] ?? 0)
}

const overallAnalysisText = computed(() => {
  if (!currentReview.value?.llm_analysis) return ''
  try {
    const analysis = JSON.parse(currentReview.value.llm_analysis)
    return locale.value === 'en' ? analysis.en : analysis.zh
  } catch {
    return currentReview.value.llm_analysis
  }
})

const dimensionIssues = computed(() => {
  const dims = parsedDimensions.value
  if (!dims) return []
  const results: any[] = []
  for (const dim of dimensionKeys) {
    const data = dims[dim]
    if (!data || !data.issues || data.issues.length === 0) continue
    results.push({
      dim,
      score: data.score,
      severity: data.score < 50 ? 'error' : data.score < 70 ? 'warning' : 'info',
      summary: data.summary || { zh: '', en: '' },
      issues: data.issues,
    })
  }
  results.sort((a, b) => a.score - b.score)
  return results
})

function stepDone(key: string) {
  const order = steps.map(s => s.key)
  const currentIdx = order.indexOf(currentReview.value?.status)
  const stepIdx = order.indexOf(key)
  return stepIdx < currentIdx
}

async function startReview() {
  if (!url.value) return
  loading.value = true
  try {
    const result = await apiPost('/api/ui-review/start', {
      url: url.value,
      mode: reviewMode.value,
    })
    currentReview.value = { id: result.id, status: 'pending', url: url.value }
    startPolling(result.id)
  } catch (e: any) {
    alert(e.message || '提交失败')
  } finally {
    loading.value = false
  }
}

function startPolling(id: string) {
  pollTimer = setInterval(async () => {
    try {
      const review = await apiGet(`/api/ui-review/${id}`)
      currentReview.value = review
      if (review.status === 'completed' || review.status === 'failed') {
        clearInterval(pollTimer)
        pollTimer = null
      }
    } catch {}
  }, 10000)
}


function downloadSkill() {
  if (!currentReview.value?.skill_markdown) return
  const blob = new Blob([currentReview.value.skill_markdown], { type: 'text/markdown' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `ui-review-skill-${currentReview.value.id.slice(0, 8)}.md`
  a.click()
  URL.revokeObjectURL(a.href)
}

async function copySkill() {
  if (!currentReview.value?.skill_markdown) return
  await navigator.clipboard.writeText(currentReview.value.skill_markdown)
  alert(locale.value === 'en' ? 'Copied. Paste it into Cursor and run.' : '已复制，粘贴到 Cursor 里执行吧。')
}

function reset() {
  currentReview.value = null
  displayScore.value = 0
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
  if (scoreTimer) { clearInterval(scoreTimer); scoreTimer = null }
}

</script>

<style scoped>
.page-wrapper {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background-color: #fafafa;
  background-image: linear-gradient(rgba(0,0,0,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.03) 1px, transparent 1px);
  background-size: 40px 40px;
  padding-top: 50px; /* offset for SiteHeader */
}

/* Modal Transitions */
.modal-fade-enter-active, .modal-fade-leave-active {
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}
.modal-fade-enter-from, .modal-fade-leave-to {
  opacity: 0;
}
.modal-fade-enter-from .advanced-modal, .modal-fade-leave-to .advanced-modal {
  transform: scale(0.95) translateY(10px);
}

/* Advanced Modal Overlay */
.advanced-modal-overlay {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(8px);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.advanced-modal {
  background: #fff;
  border-radius: 24px;
  padding: 32px;
  width: 100%;
  max-width: 600px;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.12), 0 8px 16px rgba(0, 0, 0, 0.04);
  position: relative;
  transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

.modal-close-btn {
  position: absolute;
  top: 16px; right: 16px;
  width: 32px; height: 32px;
  border-radius: 50%;
  border: none;
  background: #F3F4F6;
  color: #6B7280;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s;
}

.modal-close-btn:hover {
  background: #E5E7EB;
  color: #111827;
  transform: rotate(90deg);
}

.modal-close-btn svg {
  width: 16px; height: 16px;
}

.advanced-modal-header {
  margin-bottom: 24px;
  text-align: left;
}

.advanced-modal-header label {
  display: block;
  font-size: 18px;
  font-weight: 700;
  color: #111827;
  margin-bottom: 8px;
}

.advanced-modal-header label span {
  color: #9CA3AF;
  font-weight: 400;
  font-size: 14px;
}


/* Animations */
.animate-fade-up {
  opacity: 0;
  animation: fadeUp 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}
.delay-1 { animation-delay: 0.1s; }
.delay-2 { animation-delay: 0.2s; }
.delay-3 { animation-delay: 0.3s; }
.delay-4 { animation-delay: 0.4s; }
.delay-5 { animation-delay: 0.5s; }

@keyframes fadeUp {
  from { opacity: 0; transform: translateY(40px) scale(0.98); filter: blur(4px); }
  to { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); }
}

.ui-review-page {
  box-sizing: border-box;
  max-width: 1200px;
  width: 100%;
  margin: 0 auto;
  padding: 80px 24px;
  font-family: "Inter", -apple-system, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  flex: 1;
}

/* Hero Section */
.hero-section {
  box-sizing: border-box;
  position: relative;
  width: 100%;
  padding: 0px 24px 80px 24px;
  background: transparent;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.hero-text-overlay {
  position: relative;
  z-index: 10;
  text-align: center;
  max-width: 840px;
  display: flex;
  flex-direction: column;
  align-items: center;
}


.hero-badge {
  display: inline-flex;
  align-items: center;
  padding: 6px 16px;
  background: rgba(59, 91, 219, 0.08);
  color: #3b5bdb;
  border: 1px solid rgba(59, 91, 219, 0.2);
  border-radius: 100px;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  margin-bottom: 40px;
}

.hero-title {
  font-size: 80px;
  font-weight: 900;
  margin: 0 0 32px 0;
  letter-spacing: -0.04em;
  color: #111827;
  line-height: 1.1;
}

.serif-text {
  font-family: "Source Han Serif SC", "Noto Serif SC", STZhongsong, serif;
  font-weight: 800;
}

.highlight-char {
  background: #E5E7EB;
  padding: 0 4px;
  display: inline-block;
  line-height: 1;
}

.hero-title strong {
  background: linear-gradient(135deg, #111827, #3b5bdb);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  display: inline-block;
  padding-top: 8px;
}

.hero-subtitle {
  color: #4B5563;
  font-size: 18px;
  max-width: 640px;
  margin: 0 auto 48px;
  line-height: 1.7;
  font-weight: 500;
}

/* Instructions Section */
.instructions-section {
  padding: 80px 24px;
  max-width: 1200px;
  margin: 0 auto;
}

.instructions-title {
  text-align: center;
  font-size: 36px;
  font-weight: 800;
  letter-spacing: -0.04em;
  margin-bottom: 64px;
  color: #111827;
}

.instructions-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 48px;
}

.instruction-card {
  text-align: left;
  border-top: 2px solid #111827;
  padding-top: 24px;
  background: transparent;
  border-radius: 0;
  box-shadow: none;
}

.instruction-icon {
  font-family: var(--font-mono, monospace);
  font-size: 16px;
  font-weight: 700;
  color: #111827;
  margin-bottom: 24px;
}

.instruction-card h3 {
  font-size: 24px;
  font-weight: 800;
  margin-bottom: 12px;
  color: #111827;
  letter-spacing: -0.02em;
}

.instruction-card p {
  font-size: 16px;
  color: #4B5563;
  line-height: 1.6;
}

/* Unified Input Container */
.input-container {
  box-sizing: border-box;
  max-width: 640px;
  width: 100%;
  margin: 0 auto;
  position: relative;
  z-index: 10;
}

.unified-search-bar {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  background: #ffffff;
  border-radius: 16px;
  padding: 8px 8px 8px 24px;
  box-shadow: 0 16px 32px -8px rgba(17, 24, 39, 0.08), 0 0 0 1px rgba(17, 24, 39, 0.05);
  transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
  border: none;
}

.unified-search-bar.is-focused {
  background: #ffffff;
  box-shadow: 0 40px 80px -16px rgba(17, 24, 39, 0.12), 0 0 0 1px rgba(17, 24, 39, 0.1);
  transform: translateY(-4px);
  outline: none;
  border: none;
}

.unified-search-bar:focus-within {
  outline: none;
}

.search-icon {
  width: 20px;
  height: 20px;
  color: #9CA3AF;
  margin-right: 12px;
  flex-shrink: 0;
}

.unified-input {
  flex: 1;
  border: none;
  background: transparent;
  font-size: 18px;
  font-weight: 500;
  color: #111827;
  outline: none;
  min-width: 0;
}

.unified-input::placeholder {
  color: #9CA3AF;
}

.bar-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}

.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 12px;
  border: none;
  background: transparent;
  color: #6B7280;
  cursor: pointer;
  transition: all 0.2s;
}

.icon-btn:hover {
  background: #F3F4F6;
  color: #111827;
}

.icon-btn:active {
  transform: scale(0.95);
}

.icon-btn.active {
  color: #111827;
  background: rgba(0, 0, 0, 0.1);
}

.icon-btn svg {
  width: 20px;
  height: 20px;
}

.start-btn {
  position: relative;
  overflow: hidden;
  padding: 0 32px;
  height: 48px;
  background: #8892B0;
  color: #fff;
  border: none;
  border-radius: 12px;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  white-space: nowrap;
}

.start-btn::after {
  content: '';
  position: absolute;
  top: 0; left: -100%; width: 50%; height: 100%;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.25), transparent);
  transform: skewX(-20deg);
  transition: all 0.5s ease;
}

.start-btn:hover:not(:disabled)::after {
  left: 150%;
  transition: left 0.7s ease;
}

.start-btn:hover:not(:disabled) {
  background: #6B7280;
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(107, 114, 128, 0.3);
}

.start-btn:active:not(:disabled) {
  transform: scale(0.98);
}

.start-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.hint {
  margin: 8px 0 0;
  font-size: 12px;
  color: #9CA3AF;
}

/* Parallax Cases Section */
.parallax-cases-section {
  margin-top: 60px;
  margin-bottom: 120px;
  display: flex;
  flex-direction: column;
  padding: 0; /* Remove horizontal padding to allow full width */
}

.parallax-case {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 48px;
  width: 100%;
  max-width: 100%;
  margin: 0;
}

.case-text-container {
  width: 100%;
  max-width: 800px;
  text-align: center;
  will-change: transform, opacity;
  z-index: 2;
  padding: 0 24px;
}

.case-title {
  font-size: 64px;
  font-weight: 900;
  color: #111827;
  margin: 0 0 24px 0;
  line-height: 1.1;
  letter-spacing: -0.04em;
}

.case-desc {
  font-size: 20px;
  color: #6B7280;
  line-height: 1.6;
  margin: 0;
}

.case-desc strong {
  background: linear-gradient(135deg, #111827 0%, #111827 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  display: inline;
}

.case-image-container {
  width: 100%;
  max-width: 1600px; /* Make it significantly larger */
  aspect-ratio: 16 / 11; /* Increase height for a taller display area */
  border-radius: 32px;
  overflow: hidden;
  box-shadow: 0 40px 80px rgba(0, 0, 0, 0.15), 0 16px 32px rgba(0, 0, 0, 0.05), 0 0 0 1px rgba(0, 0, 0, 0.05);
  will-change: transform, opacity;
  background: #fff; /* Solid background, no transparency */
  position: relative;
  margin: 0 auto;
}

.case-image-container :deep(.before-after-slider) {
  width: 100%;
  height: 100%;
}

/* Progress Section Redesign */
.progress-section {
  width: 100%;
  max-width: 1200px;
  margin: 0 auto;
  padding: 40px 0;
}

.progress-container {
  display: flex;
  background: rgba(255, 255, 255, 0.8);
  backdrop-filter: blur(24px);
  border-radius: 32px;
  box-shadow: 0 32px 64px rgba(0, 0, 0, 0.08), 0 2px 12px rgba(0, 0, 0, 0.03), inset 0 0 0 1px rgba(255,255,255,0.8);
  border: 1px solid rgba(0, 0, 0, 0.05);
  align-items: stretch;
  overflow: hidden;
  min-height: 560px;
}

.progress-info {
  flex: 0 0 42%;
  display: flex;
  flex-direction: column;
  padding: 56px 48px;
  justify-content: center;
  position: relative;
  z-index: 2;
}

.progress-badge {
  font-family: var(--font-mono, monospace);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 2px;
  color: #111827;
  background: rgba(0, 0, 0, 0.1);
  padding: 6px 12px;
  border-radius: 9999px;
  align-self: flex-start;
  margin-bottom: 24px;
  animation: pulseBadge 2s infinite;
}

@keyframes pulseBadge {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.progress-badge-pro {
  background: linear-gradient(135deg, #f59e0b, #d97706);
  color: #fff;
}

.progress-title {
  font-size: 40px;
  font-weight: 900;
  letter-spacing: -1.5px;
  color: #111827;
  margin: 0 0 16px 0;
  line-height: 1.1;
}

.blinking-cursor {
  color: #111827;
  animation: blink 1s step-end infinite;
}

@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}

.progress-subtitle {
  font-size: 15px;
  color: #6B7280;
  margin: 0 0 48px 0;
  line-height: 1.6;
}

.vertical-step-list {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.vertical-step-item {
  display: flex;
  gap: 24px;
  opacity: 0;
  transform: translateX(-20px);
  animation: slideInRight 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

@keyframes slideInRight {
  to { opacity: 1; transform: translateX(0); }
}

.step-indicator {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.step-line {
  position: absolute;
  top: 24px;
  bottom: -24px;
  width: 2px;
  background: #E5E7EB;
  z-index: 1;
  transition: background 0.4s ease;
}

.vertical-step-item.done .step-line {
  background: #111827;
}

.vertical-step-item .step-dot {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #E5E7EB;
  border: 3px solid #fff;
  z-index: 2;
  transition: all 0.4s ease;
}

.vertical-step-item.active .step-dot {
  background: #111827;
  box-shadow: 0 0 0 4px rgba(0, 0, 0, 0.2);
  animation: pulseDot 2s infinite;
}

@keyframes pulseDot {
  0% { box-shadow: 0 0 0 0 rgba(0, 0, 0, 0.4); }
  70% { box-shadow: 0 0 0 10px rgba(0, 0, 0, 0); }
  100% { box-shadow: 0 0 0 0 rgba(0, 0, 0, 0); }
}

.vertical-step-item.done .step-dot {
  background: #111827;
}

.step-content {
  padding-bottom: 32px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.step-label {
  font-size: 17px;
  font-weight: 600;
  color: #9CA3AF;
  transition: color 0.3s;
}

.vertical-step-item.active .step-label,
.vertical-step-item.done .step-label {
  color: #111827;
}

.step-status-text {
  font-family: var(--font-mono, monospace);
  font-size: 12px;
  color: #9CA3AF;
}

.vertical-step-item.active .step-status-text {
  color: #111827;
}

.progress-visual {
  flex: 1;
  position: relative;
  background: #F3F4F6;
  overflow: hidden;
  border-left: none; /* Remove harsh border */
}

/* Add a soft gradient fade over the image to blend it with the left panel */
.progress-visual::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  width: 240px;
  background: linear-gradient(to right, rgba(255, 255, 255, 1) 0%, rgba(255, 255, 255, 0.8) 30%, rgba(255, 255, 255, 0) 100%);
  z-index: 20;
  pointer-events: none;
}

.scanner-container {
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  width: 100%;
  height: 100%;
}

.scanner-line {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: #111827;
  box-shadow: 0 0 20px 2px #111827, 0 4px 10px rgba(0, 0, 0, 0.4);
  z-index: 10;
  animation: scan 3s cubic-bezier(0.4, 0, 0.2, 1) infinite;
}

@keyframes scan {
  0% { top: 0; opacity: 0; }
  10% { opacity: 1; }
  90% { opacity: 1; }
  100% { top: 100%; opacity: 0; }
}

.scanner-overlay {
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  background: linear-gradient(to bottom, transparent, rgba(0, 0, 0, 0.08) 50%, transparent);
  background-size: 100% 200%;
  animation: scanBg 3s cubic-bezier(0.4, 0, 0.2, 1) infinite;
  z-index: 9;
  pointer-events: none;
}

@keyframes scanBg {
  0% { background-position: 0 -100%; }
  100% { background-position: 0 200%; }
}

.scanned-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: top center;
  opacity: 0;
  transform-origin: center top;
  animation: imageReveal 1.2s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

@keyframes imageReveal {
  0% { opacity: 0; transform: scale(1.05); filter: blur(10px); }
  100% { opacity: 1; transform: scale(1); filter: blur(0); }
}

/* Analysis Overlay Animations */
.analysis-overlay {
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  pointer-events: none;
  z-index: 15;
  opacity: 0;
  transition: opacity 0.5s ease;
}

.analysis-overlay.active {
  opacity: 1;
}

.measure-line {
  position: absolute;
  background: rgba(59, 91, 219, 0.4);
}

.measure-line.horizontal {
  left: 0; right: 0; height: 1px;
  animation: scanLineH 4s ease-in-out infinite alternate;
}

.measure-line.vertical {
  top: 0; bottom: 0; width: 1px;
  animation: scanLineV 5s ease-in-out infinite alternate;
}

.analysis-dot {
  position: absolute;
  width: 8px; height: 8px;
  border-radius: 50%;
  background: #3b5bdb;
  transform: translate(-50%, -50%);
  box-shadow: 0 0 0 4px rgba(59, 91, 219, 0.2);
  animation: pulseDot 2s infinite;
}

.analysis-box {
  position: absolute;
  border: 1px dashed rgba(59, 91, 219, 0.6);
  background: rgba(59, 91, 219, 0.05);
  animation: breatheBox 3s ease-in-out infinite alternate;
}

@keyframes scanLineH {
  0% { transform: translateY(-50px); opacity: 0.2; }
  100% { transform: translateY(50px); opacity: 0.8; }
}

@keyframes scanLineV {
  0% { transform: translateX(-50px); opacity: 0.2; }
  100% { transform: translateX(50px); opacity: 0.8; }
}

@keyframes breatheBox {
  0% { transform: scale(0.98); opacity: 0.4; }
  100% { transform: scale(1.02); opacity: 1; }
}

/* Code Stream Overlay */
.code-stream-overlay {
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(17, 24, 39, 0.85);
  backdrop-filter: blur(4px);
  z-index: 25;
  opacity: 0;
  transition: opacity 0.5s ease;
  display: flex;
  align-items: flex-end;
  padding: 32px;
}

.code-stream-overlay.active {
  opacity: 1;
}

.code-typing {
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 14px;
  line-height: 1.8;
  color: #10B981;
  text-shadow: 0 0 4px rgba(16, 185, 129, 0.4);
}

.terminal-cursor {
  animation: blink 1s step-end infinite;
}

.skeleton-wireframe {
  width: 100%;
  height: 100%;
  padding: 48px;
  display: flex;
  flex-direction: column;
  gap: 32px;
  background: #F9FAFB;
}

.skel-header {
  height: 48px;
  background: #E5E7EB;
  border-radius: 12px;
  width: 100%;
  animation: skelPulse 2s infinite;
}

.skel-body {
  display: flex;
  flex-direction: column;
  gap: 32px;
  flex: 1;
}

.skel-hero {
  height: 200px;
  background: #E5E7EB;
  border-radius: 16px;
  animation: skelPulse 2s infinite 0.2s;
}

.skel-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 24px;
  flex: 1;
}

.skel-card {
  background: #E5E7EB;
  border-radius: 16px;
  animation: skelPulse 2s infinite 0.4s;
}

@keyframes skelPulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}

@media (max-width: 900px) {
  .progress-container {
    flex-direction: column;
    padding: 0;
    gap: 0;
  }
  .progress-info {
    padding: 40px 32px;
  }
  .progress-title {
    font-size: 32px;
  }
  .progress-visual {
    width: 100%;
    min-height: 400px;
    border-left: none;
    border-top: 1px solid rgba(0,0,0,0.05);
  }
  .skeleton-wireframe {
    padding: 24px;
    gap: 16px;
  }
}

/* Result Section Redesign */
.result-section {
  background: transparent;
  border-radius: 0;
  box-shadow: none;
  border: none;
  margin-top: 40px;
}

.result-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 0 24px 0;
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);
  margin-bottom: 32px;
}

.result-tabs {
  display: flex;
  gap: 8px;
  background: rgba(0, 0, 0, 0.03);
  padding: 6px;
  border-radius: 9999px;
  backdrop-filter: blur(8px);
}

.result-tabs button {
  padding: 10px 24px;
  border: none;
  background: transparent;
  font-size: 14px;
  font-weight: 600;
  color: #6B7280;
  cursor: pointer;
  border-radius: 9999px;
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

.result-tabs button:hover {
  color: #111827;
}

.result-tabs button.active {
  color: #111827;
  background: #fff;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05), 0 1px 2px rgba(0,0,0,0.02);
}

.pro-tab-btn {
  display: flex;
  align-items: center;
  gap: 6px;
}

.pro-tab-btn.active {
  background: linear-gradient(135deg, #fffbeb, #fff) !important;
  border: 1px solid rgba(245, 158, 11, 0.3);
}

.pro-tab-badge {
  font-size: 10px;
  font-weight: 700;
  background: linear-gradient(135deg, #f59e0b, #d97706);
  color: #fff;
  padding: 1px 5px;
  border-radius: 3px;
  letter-spacing: 0.5px;
}

.reset-btn {
  padding: 8px 16px;
  background: #F9FAFB;
  border: 1px solid #E5E7EB;
  border-radius: 12px;
  font-size: 13px;
  font-weight: 600;
  color: #374151;
  cursor: pointer;
  transition: all 0.2s;
}

.reset-btn:hover {
  background: #F3F4F6;
}

.reset-btn:active {
  transform: scale(0.98);
}

.tab-content {
  padding: 0;
}

/* Score Overview Redesign */
.score-overview {
  display: flex;
  gap: 64px;
  background: transparent;
  padding: 0 0 48px 0;
  border-radius: 0;
  margin-bottom: 48px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);
  align-items: center;
}

.total-score {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  min-width: 200px;
}

.score-number {
  font-family: var(--font-sans, sans-serif);
  font-size: 120px;
  font-weight: 900;
  color: #111827;
  line-height: 0.9;
  letter-spacing: -4px;
}

.score-label {
  font-family: var(--font-mono, monospace);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 2px;
  text-transform: uppercase;
  color: #111827;
  margin-top: 12px;
}

.dimension-scores {
  flex: 1;
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 32px 64px;
}

.dim-item {
  display: flex;
  align-items: center;
  gap: 20px;
}

.dim-name {
  width: 60px;
  font-family: var(--font-sans, sans-serif);
  font-size: 14px;
  font-weight: 600;
  color: #4B5563;
}

.dim-bar {
  flex: 1;
  height: 4px;
  background: rgba(0, 0, 0, 0.04);
  border-radius: 9999px;
  overflow: hidden;
  position: relative;
}

.dim-fill {
  height: 100%;
  background: #111827;
  border-radius: 9999px;
  transition: width 1s cubic-bezier(0.16, 1, 0.3, 1);
}

.dim-value {
  width: 32px;
  font-family: var(--font-mono, monospace);
  font-size: 14px;
  font-weight: 700;
  text-align: right;
  color: #111827;
}

/* Analysis & Issues Redesign */
.analysis-section {
  margin-bottom: 64px;
}

.analysis-section h3, .issues-section h3 {
  font-family: var(--font-sans, sans-serif);
  font-size: 20px;
  font-weight: 800;
  letter-spacing: -0.5px;
  color: #111827;
  margin: 0 0 24px 0;
}

.analysis-content {
  font-size: 16px;
  line-height: 1.8;
  color: #4B5563;
  background: transparent;
  padding: 0 0 0 24px;
  border-left: 3px solid #111827;
  border-radius: 0;
  white-space: pre-wrap;
  position: relative;
}

.analysis-content::before {
  content: '"';
  position: absolute;
  top: -20px;
  left: -12px;
  font-family: var(--font-serif, serif);
  font-size: 80px;
  color: rgba(0, 0, 0, 0.1);
  line-height: 1;
  pointer-events: none;
}

.issues-list {
  display: flex;
  flex-direction: column;
  border-top: 1px solid rgba(0, 0, 0, 0.05);
}

.issue-item {
  background: transparent;
  border: none;
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);
  border-radius: 0;
  padding: 24px 0;
  box-shadow: none;
  transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1), padding-left 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

.issue-item:hover {
  transform: translateX(8px);
}

.issue-header {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 12px;
}

.issue-name {
  font-family: var(--font-sans, sans-serif);
  font-size: 16px;
  font-weight: 700;
  color: #111827;
}

.issue-detail {
  font-size: 15px;
  color: #6B7280;
  line-height: 1.6;
}

.issue-severity {
  padding: 6px 12px;
  border-radius: 9999px;
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 1px;
  text-transform: uppercase;
  min-width: 64px;
  text-align: center;
}

.issue-severity.error {
  background: #fee2e2;
  color: #dc2626;
  border: 1px solid rgba(220, 38, 38, 0.1);
}

.issue-severity.warning {
  background: #fef3c7;
  color: #d97706;
  border: 1px solid rgba(217, 119, 6, 0.1);
}

.issue-severity.critical, .issue-severity.error { background: #FEF2F2; color: #DC2626; }
.issue-severity.warning { background: #FFFBEB; color: #D97706; }
.issue-severity.info { background: #F0F9FF; color: #0284C7; }

.issue-score {
  margin-left: auto;
  font-family: var(--font-mono, monospace);
  font-size: 14px;
  font-weight: 600;
  color: #6B7280;
}

.issue-summary {
  font-size: 15px;
  color: #374151;
  line-height: 1.6;
  margin-bottom: 8px;
}

.issue-details-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.issue-details-list li {
  font-size: 14px;
  color: #6B7280;
  line-height: 1.7;
  padding: 4px 0 4px 16px;
  position: relative;
}

.issue-details-list li::before {
  content: '';
  position: absolute;
  left: 0;
  top: 12px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #D1D5DB;
}

/* Preview */
.preview-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 24px;
  height: 400px;
  background: #F9FAFB;
  border-radius: 16px;
  border: 1px dashed #D1D5DB;
}

.preview-placeholder p {
  color: #6B7280;
  font-size: 15px;
}

.btn-secondary {
  padding: 10px 24px;
  background: #fff;
  color: #374151;
  border: 1px solid #E5E7EB;
  border-radius: 12px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-secondary:hover {
  background: #F9FAFB;
}

.btn-secondary:active {
  transform: scale(0.98);
}

.preview-live {
  border: 1px solid #E5E7EB;
  border-radius: 16px;
  overflow: hidden;
}

.css-preview-layout {
  display: grid;
  grid-template-columns: 1fr 1.2fr;
  gap: 0;
  min-height: 500px;
}

.css-preview-left {
  border-right: 1px solid #E5E7EB;
  display: flex;
  flex-direction: column;
}

.css-preview-right {
  display: flex;
  flex-direction: column;
}

.css-preview-label {
  padding: 10px 16px;
  font-size: 12px;
  font-weight: 600;
  color: #6B7280;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  background: #F9FAFB;
  border-bottom: 1px solid #E5E7EB;
}

.css-preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #F9FAFB;
  border-bottom: 1px solid #E5E7EB;
}

.copy-css-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  margin-right: 12px;
  font-size: 12px;
  font-weight: 500;
  color: #4B5563;
  background: #fff;
  border: 1px solid #D1D5DB;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s;
}

.copy-css-btn:hover {
  background: #F3F4F6;
  color: #1F2937;
}

.screenshot-container {
  flex: 1;
  overflow: auto;
  padding: 12px;
  background: #F3F4F6;
}

.screenshot-img {
  width: 100%;
  height: auto;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.08);
}

.screenshot-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #9CA3AF;
  font-size: 14px;
}

.code-panel {
  background: #111827;
  color: #E5E7EB;
  padding: 20px;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 13px;
  line-height: 1.6;
  flex: 1;
  overflow: auto;
  max-height: 500px;
}

.code-panel pre {
  margin: 0;
  white-space: pre-wrap;
}

.css-usage-hint {
  padding: 14px 20px;
  background: #F0FDF4;
  border-top: 1px solid #BBF7D0;
  font-size: 13px;
  color: #166534;
  line-height: 1.5;
}

.css-usage-hint strong {
  color: #14532D;
}

@media (max-width: 768px) {
  .css-preview-layout {
    grid-template-columns: 1fr;
  }
  .css-preview-left {
    border-right: none;
    border-bottom: 1px solid #E5E7EB;
    max-height: 250px;
  }
}

.preview-status-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  background: #F9FAFB;
  color: #4B5563;
  font-size: 13px;
  font-family: 'JetBrains Mono', monospace;
  border-bottom: 1px solid #E5E7EB;
}

.loading-spinner-sm {
  width: 16px;
  height: 16px;
  border: 2px solid #E5E7EB;
  border-top-color: #111827;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* Export Section */
.export-section {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.export-hint {
  font-size: 14px;
  color: #6B7280;
  line-height: 1.5;
  margin: 0;
}

.export-actions {
  display: flex;
  gap: 16px;
}

.skill-content {
  background: #F9FAFB;
  border: 1px solid #E5E7EB;
  border-radius: 10px;
  padding: 24px;
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  max-height: 600px;
  overflow-y: auto;
  color: #374151;
  font-family: 'JetBrains Mono', monospace;
}

/* Error */
.error-card {
  background: #FEF2F2;
  border: 1px solid #FCA5A5;
  border-radius: 12px;
  padding: 48px;
  text-align: center;
}

.error-card h2 { color: #DC2626; margin: 0 0 16px 0; }
.error-card p { color: #7F1D1D; margin: 0 0 32px 0; }

/* Preferences Panel */
.preferences-panel {
  background: rgba(67, 97, 238, 0.03);
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 20px;
  padding: 32px;
  margin-bottom: 32px;
}

.pref-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.pref-title {
  font-size: 18px;
  font-weight: 700;
  color: #111827;
  margin: 0;
}

.pref-skip {
  background: none;
  border: none;
  font-size: 13px;
  color: #9CA3AF;
  cursor: pointer;
  font-weight: 500;
  transition: color 0.2s;
}

.pref-skip:hover {
  color: #6B7280;
  text-decoration: underline;
}

.pref-desc {
  font-size: 14px;
  color: #6B7280;
  margin: 0 0 24px 0;
  line-height: 1.5;
}

.pref-group {
  margin-bottom: 20px;
}

.pref-label {
  display: block;
  font-size: 13px;
  font-weight: 600;
  color: #374151;
  margin-bottom: 10px;
  letter-spacing: 0.02em;
}

.pref-hint {
  font-weight: 400;
  color: #9CA3AF;
}

.pref-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.pref-chip {
  padding: 8px 16px;
  border-radius: 9999px;
  border: 1px solid #E5E7EB;
  background: #fff;
  color: #4B5563;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

.pref-chip:hover {
  border-color: rgba(0, 0, 0, 0.4);
  color: #111827;
}

.pref-chip.active {
  background: rgba(0, 0, 0, 0.1);
  border-color: #111827;
  color: #111827;
  font-weight: 600;
}

.pref-chip-toggle.active {
  background: rgba(0, 0, 0, 0.08);
  border-color: rgba(0, 0, 0, 0.3);
  color: #111827;
}

.pref-checks {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.pref-check-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 10px;
  border: 1px solid #E5E7EB;
  background: #fff;
  cursor: pointer;
  transition: all 0.2s;
}

.pref-check-item:hover {
  border-color: rgba(0, 0, 0, 0.3);
}

.pref-check-item.checked {
  background: rgba(0, 0, 0, 0.06);
  border-color: rgba(0, 0, 0, 0.3);
}

.pref-check-item.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.pref-check-item input[type="checkbox"] {
  width: 14px;
  height: 14px;
  accent-color: #111827;
  cursor: pointer;
}

.pref-check-item .check-label {
  font-size: 13px;
  font-weight: 500;
  color: #374151;
}

.pref-check-item.checked .check-label {
  color: #111827;
  font-weight: 600;
}

.pref-actions {
  margin-top: 24px;
  display: flex;
  align-items: center;
  gap: 16px;
}

.pref-confirm-btn {
  padding: 0 32px;
  height: 42px;
}

/* Preferences Panel Transition */
.pref-fade-enter-active, .pref-fade-leave-active {
  transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
}
.pref-fade-enter-from, .pref-fade-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}

/* Mode Selector */
.mode-selector {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-top: 16px;
}

.mode-btn {
  padding: 6px 16px;
  border-radius: 9999px;
  border: 1px solid rgba(0, 0, 0, 0.1);
  background: rgba(0, 0, 0, 0.03);
  color: #4B5563;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.mode-btn:hover {
  background: rgba(0, 0, 0, 0.05);
  color: #111827;
}

.mode-btn.active {
  background: #111827;
  border-color: #111827;
  color: #fff;
}

.mode-btn-pro.active {
  background: #059669;
  border-color: #059669;
}

.mode-hint {
  font-size: 12px;
  color: var(--text-tertiary);
  margin-left: 8px;
}

/* Pro Section */
.pro-section {
  display: flex;
  flex-direction: column;
  gap: 48px;
}

.pro-comparison {
  background: #ffffff;
  border-left: 4px solid #111827;
  border-top: 1px solid rgba(0,0,0,0.05);
  border-right: 1px solid rgba(0,0,0,0.05);
  border-bottom: 1px solid rgba(0,0,0,0.05);
  border-radius: 0 16px 16px 0;
  padding: 32px 40px;
  box-shadow: 0 12px 32px -8px rgba(0,0,0,0.03);
}

.pro-comparison h3 {
  font-size: 18px;
  font-weight: 800;
  margin-bottom: 16px;
  color: #111827;
  letter-spacing: -0.02em;
}

.pro-comparison p {
  font-size: 15px;
  line-height: 1.8;
  color: #4B5563;
}

.pro-score-estimate {
  margin-top: 24px;
  padding-top: 24px;
  border-top: 1px dashed rgba(0, 0, 0, 0.1);
  display: flex;
  align-items: baseline;
  gap: 16px;
}

.pro-score-estimate .label {
  font-size: 14px;
  font-weight: 600;
  color: #6B7280;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.pro-score-estimate .value {
  font-family: var(--font-sans, sans-serif);
  font-size: 48px;
  font-weight: 900;
  letter-spacing: -2px;
  color: #111827;
  line-height: 1;
}

/* Pro Dimensions */
.pro-dimensions h3 {
  font-size: 24px;
  font-weight: 800;
  margin-bottom: 24px;
  color: #111827;
  letter-spacing: -0.03em;
}

.pro-dim-card {
  background: transparent;
  border: none;
  border-top: 2px solid #111827;
  border-radius: 0;
  padding: 24px 0;
  margin-bottom: 40px;
}

.pro-dim-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.pro-dim-name {
  font-weight: 800;
  font-size: 20px;
  color: #111827;
  letter-spacing: -0.02em;
}

.pro-dim-score {
  font-family: var(--font-mono, monospace);
  font-size: 16px;
  font-weight: 700;
  color: #111827;
}

.pro-dim-analysis {
  font-size: 15px;
  line-height: 1.8;
  color: #4B5563;
  margin-bottom: 24px;
}

.pro-dim-benchmark {
  font-size: 14px;
  color: #111827;
  padding: 16px 20px;
  background: rgba(0, 0, 0, 0.02);
  border-radius: 8px;
  margin-bottom: 32px;
  border-left: 3px solid #111827;
  font-weight: 500;
}

/* Pro Issues Grid */
.pro-issues-grid {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.pro-issue-item {
  background: transparent;
  border-top: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 0;
  padding: 24px 0;
}
.pro-issue-item:last-child {
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
}

.pro-issue-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.pro-issue-severity {
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  padding: 4px 8px;
  border-radius: 4px;
  letter-spacing: 0.05em;
}

.pro-issue-severity.critical {
  background: #fee2e2;
  color: #dc2626;
  border: 1px solid rgba(220, 38, 38, 0.2);
}

.pro-issue-severity.major {
  background: #fef3c7;
  color: #d97706;
  border: 1px solid rgba(217, 119, 6, 0.2);
}

.pro-issue-severity.minor {
  background: #f3f4f6;
  color: #4b5563;
  border: 1px solid rgba(75, 85, 99, 0.2);
}

.pro-issue-cost {
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  padding: 4px 8px;
  border-radius: 4px;
  background: #f3f4f6;
  color: #4b5563;
  border: 1px solid rgba(0,0,0,0.05);
}

.pro-issue-location {
  font-family: var(--font-mono, monospace);
  font-size: 12px;
  color: #6b7280;
  font-weight: 600;
}

.pro-issue-diff {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  font-size: 14px;
  line-height: 1.6;
  background: #fafafa;
  padding: 16px;
  border-radius: 8px;
  border: 1px dashed rgba(0,0,0,0.1);
  margin-top: 12px;
}

.pro-diff-current {
  color: #ef4444;
  flex: 1;
  text-decoration: line-through;
  opacity: 0.8;
}

.pro-diff-arrow {
  color: #9ca3af;
  flex-shrink: 0;
  font-family: var(--font-mono, monospace);
}

.pro-diff-expected {
  color: #059669;
  flex: 1;
  font-weight: 500;
}

/* Pro Execution Plan */
.pro-plan h3 {
  font-size: 24px;
  font-weight: 800;
  margin-bottom: 24px;
  color: #111827;
  letter-spacing: -0.03em;
}

.pro-phases {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 24px;
}

.pro-phase {
  background: #ffffff;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 16px;
  padding: 32px 24px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.02);
  transition: transform 0.2s;
}

.pro-phase:hover {
  transform: translateY(-4px);
  box-shadow: 0 12px 24px rgba(0,0,0,0.04);
}

.pro-phase-header {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 20px;
}

.pro-phase-num {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: #111827;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 800;
  font-family: var(--font-mono, monospace);
}

.pro-phase-title {
  font-weight: 800;
  font-size: 16px;
  color: #111827;
}

.pro-phase p {
  font-size: 14px;
  line-height: 1.7;
  color: #4b5563;
  white-space: pre-line;
}

/* Pro Loading */
.pro-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 200px;
  color: var(--text-tertiary);
  font-size: 14px;
}

/* Responsive */
@media (max-width: 768px) {
  .hero-title { font-size: 36px; }
  .input-row { flex-direction: column; }
  .score-overview { flex-direction: column; gap: 32px; }
  .dimension-scores { grid-template-columns: 1fr; }
  .result-tabs { flex-wrap: wrap; gap: 16px; }
  .pref-checks { grid-template-columns: repeat(2, 1fr); }
  .pref-chips { gap: 6px; }
  .preferences-panel { padding: 20px; }
}
</style>
