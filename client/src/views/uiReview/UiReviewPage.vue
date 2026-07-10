<template>
  <div class="page-wrapper">
    <SiteHeader />

    <!-- Ambient Background Orbs -->
    <main class="ui-review-page">
      <!-- Hero Section -->
      <section v-if="!currentReview" class="hero-section">
        <!-- Text Overlay -->
        <div class="hero-text-overlay">
          <div class="hero-badge animate-fade-up delay-1">{{ locale === 'en' ? 'AI-Powered Design Optimization Engine' : 'AI 驱动的设计优化引擎' }}</div>
          <h1 class="hero-title animate-fade-up delay-2">
            <template v-if="locale === 'en'">
              Elevate Your Product<br/>
              With <strong>Premium Design</strong>
            </template>
            <template v-else>
              让你的产品设计<br/>
              更具<strong>高级质感</strong>
            </template>
          </h1>
          <p class="hero-subtitle animate-fade-up delay-3">{{ locale === 'en' ? 'Enter your product URL to get pixel-perfect optimization aligned with top-tier SaaS standards.' : '输入你的产品网址，获取对标顶尖 SaaS 平台的像素级优化方案与重构代码。' }}</p>
          
          <div class="input-container animate-fade-up delay-4">
            <div class="unified-search-bar" :class="{ 'is-focused': isFocused }">
              <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
              <input
                v-model="url"
                type="url"
                :placeholder="locale === 'en' ? 'Enter product URL, e.g. https://your-website.com' : '输入产品网址，例如 https://your-website.com'"
                class="unified-input"
                @focus="isFocused = true"
                @blur="isFocused = false"
                @keyup.enter="startReview"
              />
              <div class="bar-actions">
                <button class="icon-btn" :class="{ active: showAdvanced || referenceImageUrl }" @click="showAdvanced = !showAdvanced" title="上传参考风格">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                </button>
                <button class="start-btn" @click="startReview" :disabled="!url || loading">
                  {{ loading ? (locale === 'en' ? 'Analyzing...' : '分析中...') : (locale === 'en' ? 'Start Review' : '开始优化') }}
                </button>
              </div>
            </div>
            
            <transition name="modal-fade">
              <div v-show="showAdvanced" class="advanced-modal-overlay" @click.self="showAdvanced = false">
                <div class="advanced-modal">
                  <button class="modal-close-btn" @click="showAdvanced = false">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                  <div class="advanced-modal-header">
                    <label>{{ locale === 'en' ? 'Reference Style' : '参考风格' }} <span>{{ locale === 'en' ? '(optional)' : '(可选)' }}</span></label>
                    <p class="hint">{{ locale === 'en' ? 'Upload a style reference screenshot. AI will use it as a visual benchmark.' : '上传你期望的风格截图，AI 将以此为视觉基准生成重构方案' }}</p>
                  </div>
                  <ImageUpload v-model="referenceImageUrl" />
                </div>
              </div>
            </transition>
          </div>
        </div>
      </section>



      <!-- Parallax Cases Section -->
      <section v-if="!currentReview" class="parallax-cases-section">
        <div class="parallax-case">
          <div class="case-text-container">
            <h2 class="case-title">
              <template v-if="locale === 'en'">See the<br/>Difference</template>
              <template v-else>重塑<br/>视觉体验</template>
            </h2>
            <p class="case-desc">
              <template v-if="locale === 'en'">
                Swipe to compare the generic AI layout with our <strong>HC Design engineered</strong> output. Notice the typography scale, ambient shadows, and precise spacing.
              </template>
              <template v-else>
                拖拽滑块对比默认 AI 廉价感排版与 <strong>HC Design 规范</strong> 重构后的顶级 SaaS 质感。<br/>注意字距收紧、弥散环境光以及不对称分割布局带来的张力。
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
          <h2 class="instructions-title">{{ locale === 'en' ? 'How to Use' : '使用教程' }}</h2>
          <div class="instructions-grid">
            <div class="instruction-card">
              <div class="instruction-icon">01</div>
              <h3>{{ locale === 'en' ? 'Submit URL' : '提交网址' }}</h3>
              <p>{{ locale === 'en' ? 'Enter the link to the product or page you want to optimize.' : '输入您想要优化的产品或页面链接。' }}</p>
            </div>
            <div class="instruction-card">
              <div class="instruction-icon">02</div>
              <h3>{{ locale === 'en' ? 'AI Analysis' : 'AI 解析' }}</h3>
              <p>{{ locale === 'en' ? 'Our AI engine crawls the DOM and evaluates it against HC Design standards.' : '我们的 AI 引擎将抓取页面 DOM 并基于 HC Design 规范进行评估。' }}</p>
            </div>
            <div class="instruction-card">
              <div class="instruction-icon">03</div>
              <h3>{{ locale === 'en' ? 'Get Report & Code' : '获取报告与代码' }}</h3>
              <p>{{ locale === 'en' ? 'Review the detailed aesthetic score and instantly preview the refactored design.' : '查看详细的美学评分，并即时预览重构后的设计代码。' }}</p>
            </div>
          </div>
        </div>
      </section>

      <!-- Progress Section -->
      <section v-else-if="currentReview.status !== 'completed' && currentReview.status !== 'failed'" class="progress-section">
        <div class="progress-container">
          <div class="progress-info">
            <div class="progress-badge">ANALYZING</div>
            <h2 class="progress-title">{{ locale === 'en' ? 'Deep Analysis in Progress' : '正在深度重构' }}<span class="blinking-cursor">_</span></h2>
            <p class="progress-subtitle">{{ locale === 'en' ? 'AI is analyzing page structure and applying design standards' : 'AI 正在解析页面结构并应用 HC Design 规范' }}</p>
            
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
              <img v-if="currentReview.screenshot_url" :src="currentReview.screenshot_url" class="scanned-image" alt="页面截图" />
              <div v-else class="skeleton-wireframe">
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
            </div>
          </div>
        </div>
      </section>

      <!-- Error Section -->
      <section v-else-if="currentReview.status === 'failed'" class="error-section">
        <div class="error-card">
          <h2>{{ locale === 'en' ? 'Review Failed' : '评测失败' }}</h2>
          <p>{{ currentReview.error_message || (locale === 'en' ? 'Unknown error, please retry' : '未知错误，请重试') }}</p>
          <button class="start-btn" @click="reset">{{ locale === 'en' ? 'Start Over' : '重新开始' }}</button>
        </div>
      </section>

      <!-- Result Section -->
      <section v-else class="result-section">
        <div class="result-header">
          <div class="result-tabs">
            <button :class="{ active: activeTab === 'report' }" @click="activeTab = 'report'">{{ locale === 'en' ? 'Report' : '评测报告' }}</button>
            <button :class="{ active: activeTab === 'preview' }" @click="activeTab = 'preview'">{{ locale === 'en' ? 'Preview' : '优化预览' }}</button>
            <button :class="{ active: activeTab === 'export' }" @click="activeTab = 'export'">{{ locale === 'en' ? 'Export Skill' : '导出 Skill' }}</button>
          </div>
          <button class="reset-btn" @click="reset">{{ locale === 'en' ? 'New Review' : '重新评测' }}</button>
        </div>

        <!-- Report Tab -->
        <div v-if="activeTab === 'report'" class="tab-content">
          <div class="score-overview animate-fade-up delay-1">
            <div class="total-score">
              <span class="score-number">{{ displayScore }}</span>
              <span class="score-label">{{ locale === 'en' ? 'Design Quality Score' : '综合质感得分' }}</span>
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
            <h3>{{ locale === 'en' ? 'AI Analysis' : 'AI 深度解析' }}</h3>
            <div class="analysis-content">{{ overallAnalysisText }}</div>
          </div>
          <div v-if="dimensionIssues.length" class="issues-section animate-fade-up delay-3">
            <h3>{{ locale === 'en' ? 'Issues Found' : '发现的视觉问题' }}</h3>
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

        <!-- Preview Tab -->
        <div v-if="activeTab === 'preview'" class="tab-content">
          <div class="preview-container-full">
            <div class="preview-main">
              <div v-if="!previewHtml && !previewLoading && !previewError" class="preview-placeholder">
                <p>{{ locale === 'en' ? 'Generate optimized code and live preview based on HC Design standards' : '一键生成基于 HC Design 规范的重构代码与实时预览' }}</p>
                <button class="start-btn" @click="generatePreview">{{ locale === 'en' ? 'Generate Preview' : '生成优化预览' }}</button>
              </div>
              <div v-if="previewError" class="preview-error">
                <p>{{ previewError }}</p>
                <button class="btn-secondary" @click="previewError = ''; generatePreview()">{{ locale === 'en' ? 'Retry' : '重试' }}</button>
              </div>
              <div v-if="previewLoading || previewHtml" class="preview-live">
                <div class="preview-live-tabs">
                  <button :class="{ active: previewView === 'preview' }" @click="previewView = 'preview'">{{ locale === 'en' ? 'Preview' : '预览模式' }}</button>
                  <button :class="{ active: previewView === 'code' }" @click="previewView = 'code'">{{ locale === 'en' ? 'Source' : '源码模式' }}</button>
                </div>
                <div v-if="previewLoading" class="preview-status-bar">
                  <div class="loading-spinner-sm"></div>
                  <span>{{ previewStatus }}</span>
                </div>
                <iframe v-show="previewView === 'preview'" :srcdoc="cleanedPreviewHtml" class="preview-iframe" sandbox=""></iframe>
                <div v-show="previewView === 'code'" class="code-panel" ref="codePanelRef">
                  <pre><code>{{ previewRawHtml }}</code></pre>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Export Tab -->
        <div v-if="activeTab === 'export'" class="tab-content">
          <div class="export-section">
            <div class="export-actions">
              <button class="start-btn" @click="downloadSkill">{{ locale === 'en' ? 'Download Skill' : '下载 Skill 文档' }}</button>
              <button class="btn-secondary" @click="copySkill">{{ locale === 'en' ? 'Copy to Clipboard' : '复制到剪贴板' }}</button>
            </div>
            <pre class="skill-content">{{ currentReview.skill_markdown || (locale === 'en' ? 'No skill document yet. Please wait for review to complete.' : '暂无 Skill 文档，请等待评测完成') }}</pre>
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
import { getToken } from '../../lib/auth'
import ImageUpload from '../../components/common/ImageUpload.vue'
import SiteHeader from '../../components/common/SiteHeader.vue'
import SiteFooter from '../../components/common/SiteFooter.vue'
import BeforeAfterSlider from '../../components/common/BeforeAfterSlider.vue'

const route = useRoute()
const locale = computed(() => route.path.startsWith('/en/') ? 'en' : 'zh')

const url = ref('')
const referenceImageUrl = ref('')
const loading = ref(false)
const currentReview = ref<any>(null)
const activeTab = ref<'report' | 'preview' | 'export'>('report')
const previewHtml = ref('')
const previewRawHtml = ref('')
const previewLoading = ref(false)
const previewStatus = ref('正在连接...')
const previewError = ref('')
const previewView = ref<'preview' | 'code'>('code')
const codePanelRef = ref<HTMLElement | null>(null)
const isFocused = ref(false)
const showAdvanced = ref(false)

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

const cleanedPreviewHtml = computed(() => {
  let html = previewHtml.value
  // Strip markdown code fences if LLM wrapped it
  if (html.startsWith('```')) {
    html = html.replace(/^```\w*\n?/, '').replace(/\n?```\s*$/, '')
  }
  return html
})
let pollTimer: any = null

const steps = [
  { key: 'pending', label: '准备中', labelEn: 'Preparing' },
  { key: 'crawling', label: '爬取页面', labelEn: 'Crawling Page' },
  { key: 'analyzing', label: 'AI 评分中', labelEn: 'AI Scoring' },
  { key: 'generating', label: '生成建议', labelEn: 'Generating Suggestions' },
  { key: 'completed', label: '完成', labelEn: 'Complete' },
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
      referenceImageUrl: referenceImageUrl.value || undefined,
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

async function generatePreview() {
  if (!currentReview.value?.id) return
  previewLoading.value = true
  previewHtml.value = ''
  previewRawHtml.value = ''
  previewError.value = ''
  previewStatus.value = '正在连接...'
  previewView.value = 'code'
  try {
    const res = await fetch(`/api/ui-review/${currentReview.value.id}/preview`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
        'Authorization': `Bearer ${getToken()}`,
      },
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }))
      previewError.value = err.error || res.statusText
      previewLoading.value = false
      return
    }
    const reader = res.body?.getReader()
    if (!reader) {
      previewError.value = '无法读取响应流'
      previewLoading.value = false
      return
    }
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6))
            if (data.status === 'connecting') previewStatus.value = '正在连接 AI...'
            else if (data.status === 'generating') previewStatus.value = '正在生成 HTML...'
            else if (data.html) {
              previewRawHtml.value += data.html
              previewHtml.value += data.html
              // Auto-scroll code panel
              if (codePanelRef.value) {
                codePanelRef.value.scrollTop = codePanelRef.value.scrollHeight
              }
            }
            else if (data.error) {
              previewError.value = data.error
              previewLoading.value = false
            }
            else if (data.done) {
              previewLoading.value = false
              previewView.value = 'preview'
            }
          } catch {}
        }
      }
    }
  } catch (e: any) {
    previewError.value = e.message || '网络错误'
  } finally {
    previewLoading.value = false
  }
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
  alert('已复制到剪贴板')
}

function reset() {
  currentReview.value = null
  previewHtml.value = ''
  displayScore.value = 0
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
  if (scoreTimer) { clearInterval(scoreTimer); scoreTimer = null }
}

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer)
  if (scoreTimer) clearInterval(scoreTimer)
})
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
  box-shadow: 0 24px 64px rgba(59, 91, 219, 0.12), 0 8px 16px rgba(59, 91, 219, 0.04);
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

/* Ambient Orbs */
.ambient-orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(100px);
  opacity: 0.6;
  animation: float 20s infinite ease-in-out;
  z-index: 0;
  pointer-events: none;
}
.orb-1 {
  top: -100px; left: -100px;
  width: 500px; height: 500px;
  background: rgba(59, 91, 219, 0.15);
}
.orb-2 {
  bottom: 100px; right: -100px;
  width: 600px; height: 600px;
  background: rgba(59, 91, 219, 0.08);
  animation-delay: -10s;
}

@keyframes float {
  0%, 100% { transform: translate(0, 0) scale(1); }
  33% { transform: translate(30px, -50px) scale(1.1); }
  66% { transform: translate(-20px, 20px) scale(0.9); }
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
  from { opacity: 0; transform: translateY(30px); }
  to { opacity: 1; transform: translateY(0); }
}

.ui-review-page {
  max-width: 1200px;
  width: 100%;
  margin: 0 auto;
  padding: 80px 24px;
  font-family: "Inter", -apple-system, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  flex: 1;
}

/* Hero Section */
.hero-section {
  position: relative;
  width: 100vw;
  margin-left: calc(-50vw + 50%);
  margin-right: calc(-50vw + 50%);
  padding: 64px 24px; /* Reduced top padding */
  background: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
}

.hero-text-overlay {
  position: relative;
  z-index: 10;
  text-align: center;
  max-width: 800px;
  padding: 0 24px;
}


.hero-badge {
  display: inline-block;
  padding: 6px 16px;
  background: rgba(59, 91, 219, 0.1);
  backdrop-filter: blur(8px);
  color: #3B5BDB;
  border: 1px solid rgba(59, 91, 219, 0.2);
  border-radius: 9999px;
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 24px;
}

.hero-title {
  font-size: 56px;
  font-weight: 800;
  margin: 0 0 24px 0;
  letter-spacing: -2px;
  color: #111827;
  line-height: 1.1;
}

.hero-title strong {
  background: linear-gradient(135deg, #111827 0%, #3B5BDB 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  display: inline-block;
}

.hero-subtitle {
  color: #4B5563;
  font-size: 17px;
  max-width: 580px;
  margin: 0 auto 48px;
  line-height: 1.6;
  font-weight: 500;
}

/* Instructions Section */
.instructions-section {
  padding: 80px 24px;
  max-width: 1200px;
  margin: 0 auto;
}

.instructions-title {
  text-align: left;
  font-size: 32px;
  font-weight: 800;
  letter-spacing: -1px;
  margin-bottom: 48px;
  color: #111827;
}

.instructions-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 48px;
}

.instruction-card {
  text-align: left;
  border-top: 1px solid #E5E7EB;
  padding-top: 24px;
  background: transparent;
  border-radius: 0;
  box-shadow: none;
  transition: transform 0.3s ease;
}

.instruction-card:hover {
  transform: translateY(-4px);
  box-shadow: none;
}

.instruction-icon {
  font-family: var(--font-mono, monospace);
  font-size: 14px;
  font-weight: 700;
  color: #9CA3AF;
  margin-bottom: 16px;
}

.instruction-card h3 {
  font-size: 20px;
  font-weight: 700;
  margin-bottom: 12px;
  color: #111827;
}

.instruction-card p {
  font-size: 15px;
  color: #6B7280;
  line-height: 1.6;
}

/* Unified Input Container */
.input-container {
  max-width: 720px;
  margin: 0 auto;
  position: relative;
  z-index: 10;
}

.unified-search-bar {
  display: flex;
  align-items: center;
  background: rgba(255, 255, 255, 0.85);
  backdrop-filter: blur(20px);
  border-radius: 16px;
  padding: 8px 8px 8px 20px;
  box-shadow: 0 8px 32px rgba(59, 91, 219, 0.06), 0 2px 8px rgba(59, 91, 219, 0.04), inset 0 0 0 1px rgba(59, 91, 219, 0.1);
  transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
}

.unified-search-bar.is-focused {
  background: #FFFFFF;
  box-shadow: 0 16px 48px rgba(59, 91, 219, 0.15), 0 4px 16px rgba(59, 91, 219, 0.08), inset 0 0 0 1px rgba(59, 91, 219, 0.3);
  transform: translateY(-2px);
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
  font-size: 16px;
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
  color: #3B5BDB;
  background: rgba(59, 91, 219, 0.1);
}

.icon-btn svg {
  width: 20px;
  height: 20px;
}

.start-btn {
  position: relative;
  overflow: hidden;
  padding: 0 28px;
  height: 44px;
  background: #3B5BDB;
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
  background: #2B45A8;
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(59, 91, 219, 0.3);
}

.start-btn:active:not(:disabled) {
  transform: translateY(1px);
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
  margin-top: 160px;
  margin-bottom: 120px;
  display: flex;
  flex-direction: column;
  padding: 0; /* Remove horizontal padding to allow full width */
}

.parallax-case {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 64px;
  width: 100%;
  max-width: 100%; /* Remove max-width constraint */
  margin: 0;
}

.case-text-container {
  width: 100%;
  max-width: 800px;
  text-align: center;
  will-change: transform, opacity;
  z-index: 2;
  padding: 0 24px; /* Add padding back here for text */
}

.case-title {
  font-size: 56px;
  font-weight: 800;
  color: #111827;
  margin: 0 0 24px 0;
  line-height: 1.1;
  letter-spacing: -1.5px;
}

.case-desc {
  font-size: 20px;
  color: #6B7280;
  line-height: 1.6;
  margin: 0;
}

.case-desc strong {
  background: linear-gradient(135deg, #111827 0%, #3B5BDB 100%);
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
  box-shadow: 0 40px 80px rgba(59, 91, 219, 0.15), 0 16px 32px rgba(59, 91, 219, 0.05), 0 0 0 1px rgba(59, 91, 219, 0.05);
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
  box-shadow: 0 32px 64px rgba(59, 91, 219, 0.08), 0 2px 12px rgba(0, 0, 0, 0.03), inset 0 0 0 1px rgba(255,255,255,0.8);
  border: 1px solid rgba(59, 91, 219, 0.05);
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
  color: #3B5BDB;
  background: rgba(59, 91, 219, 0.1);
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

.progress-title {
  font-size: 40px;
  font-weight: 900;
  letter-spacing: -1.5px;
  color: #111827;
  margin: 0 0 16px 0;
  line-height: 1.1;
}

.blinking-cursor {
  color: #3B5BDB;
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
  background: #3B5BDB;
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
  background: #3B5BDB;
  box-shadow: 0 0 0 4px rgba(59, 91, 219, 0.2);
  animation: pulseDot 2s infinite;
}

@keyframes pulseDot {
  0% { box-shadow: 0 0 0 0 rgba(59, 91, 219, 0.4); }
  70% { box-shadow: 0 0 0 10px rgba(59, 91, 219, 0); }
  100% { box-shadow: 0 0 0 0 rgba(59, 91, 219, 0); }
}

.vertical-step-item.done .step-dot {
  background: #3B5BDB;
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
  color: #3B5BDB;
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
  background: #3B5BDB;
  box-shadow: 0 0 20px 2px #3B5BDB, 0 4px 10px rgba(59, 91, 219, 0.4);
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
  background: linear-gradient(to bottom, transparent, rgba(59, 91, 219, 0.08) 50%, transparent);
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
  color: #3B5BDB;
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
  background: #3B5BDB;
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
  border-left: 3px solid #3B5BDB;
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
  color: rgba(59, 91, 219, 0.1);
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

.preview-live-tabs {
  display: flex;
  border-bottom: 1px solid #E5E7EB;
  background: #F9FAFB;
}

.preview-live-tabs button {
  padding: 12px 24px;
  border: none;
  background: none;
  font-size: 14px;
  font-weight: 600;
  color: #6B7280;
  cursor: pointer;
  border-bottom: 2px solid transparent;
}

.preview-live-tabs button.active {
  color: #3B5BDB;
  border-bottom-color: #3B5BDB;
  background: #fff;
}

.preview-iframe {
  width: 100%;
  height: 600px;
  border: none;
  background: #fff;
}

.code-panel {
  background: #111827;
  color: #E5E7EB;
  padding: 24px;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 13px;
  line-height: 1.6;
  height: 600px;
  overflow: auto;
}

.code-panel pre {
  margin: 0;
  white-space: pre-wrap;
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
  border-top-color: #3B5BDB;
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

/* Responsive */
@media (max-width: 768px) {
  .hero-title { font-size: 36px; }
  .input-row { flex-direction: column; }
  .score-overview { flex-direction: column; gap: 32px; }
  .dimension-scores { grid-template-columns: 1fr; }
  .result-tabs { flex-wrap: wrap; gap: 16px; }
}
</style>
