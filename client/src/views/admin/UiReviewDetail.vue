<template>
  <div class="page">
    <div class="page-header">
      <h1>评测详情</h1>
      <button class="btn-secondary" @click="$router.back()">&larr; 返回</button>
    </div>

    <div v-if="!review" class="loading">加载中...</div>

    <template v-if="review">
      <div class="detail-card">
        <div class="detail-grid">
          <div class="detail-item">
            <span class="detail-label">网址</span>
            <a :href="review.url" target="_blank" class="detail-url">{{ review.url }}</a>
          </div>
          <div class="detail-item">
            <span class="detail-label">状态</span>
            <span :class="['hc-badge', statusClass(review.status)]">{{ review.status }}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">行业</span>
            <span>{{ review.industry_type || '未识别' }}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">总分</span>
            <span class="score-badge" v-if="review.total_score">{{ Math.round(review.total_score) }}</span>
            <span v-else>-</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">用户</span>
            <span>{{ review.user_id }}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">时间</span>
            <span>{{ formatDate(review.created_at) }}</span>
          </div>
        </div>
      </div>

      <div v-if="review.screenshot_url" class="section-card">
        <h3>首屏截图</h3>
        <img :src="review.screenshot_url" class="screenshot" />
      </div>

      <div v-if="review.dimension_scores && review.dimension_scores !== '{}'" class="section-card">
        <h3>维度评分</h3>
        <div class="scores-grid">
          <div v-for="(score, dim) in parsedDimensionScores" :key="dim" class="score-item">
            <span class="dim-label">{{ dim }}</span>
            <div class="score-bar">
              <div class="score-fill" :style="{ width: score + '%' }"></div>
            </div>
            <span class="dim-score">{{ Math.round(score) }}</span>
          </div>
        </div>
      </div>

      <div v-if="review.llm_analysis" class="section-card">
        <h3>LLM 分析</h3>
        <p class="analysis-text">{{ review.llm_analysis }}</p>
      </div>

      <div v-if="review.rule_results && review.rule_results !== '[]'" class="section-card">
        <h3>规则检测结果</h3>
        <div class="rules-list">
          <div v-for="(rule, i) in parsedRuleResults" :key="i" class="rule-item" :class="{ passed: rule.passed, failed: !rule.passed }">
            <span class="rule-status">{{ rule.passed ? '✓' : '✗' }}</span>
            <span class="rule-name">{{ rule.name }}</span>
            <span v-if="rule.details" class="rule-details">{{ rule.details }}</span>
          </div>
        </div>
      </div>

      <div v-if="review.error_message" class="section-card error-section">
        <h3>错误信息</h3>
        <p>{{ review.error_message }}</p>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { apiGet } from '../../lib/api'

const route = useRoute()
const review = ref<any>(null)

const parsedDimensionScores = computed(() => {
  if (!review.value?.dimension_scores) return {}
  try { return JSON.parse(review.value.dimension_scores) } catch { return {} }
})

const parsedRuleResults = computed(() => {
  if (!review.value?.rule_results) return []
  try { return JSON.parse(review.value.rule_results) } catch { return [] }
})

function statusClass(status: string) {
  if (status === 'completed') return 'hc-badge-green'
  if (status === 'failed') return 'hc-badge-red'
  if (status === 'pending') return 'hc-badge-gray'
  return 'hc-badge-blue'
}

function formatDate(iso: string) {
  if (!iso) return '-'
  return iso.slice(0, 16).replace('T', ' ')
}

onMounted(async () => {
  review.value = await apiGet(`/api/ui-review/admin/reviews/${route.params.id}`)
})
</script>

<style scoped>
.loading {
  text-align: center;
  color: #999;
  padding: 48px;
}
.detail-card, .section-card {
  background: #fff;
  border-radius: 10px;
  border: 1px solid rgba(0,0,0,0.05);
  box-shadow: 0 8px 24px rgba(0,0,0,0.04);
  padding: 24px;
  margin-bottom: 24px;
}
.detail-grid {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 20px;
}
.detail-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.detail-label {
  font-size: 12px;
  font-weight: 600;
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.detail-url {
  color: #3B5BDB;
  text-decoration: none;
  word-break: break-all;
}
.detail-url:hover {
  text-decoration: underline;
}
.score-badge {
  display: inline-block;
  background: #4361EE;
  color: #fff;
  padding: 2px 10px;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 600;
  width: fit-content;
}
.section-card h3 {
  margin: 0 0 16px 0;
  font-size: 16px;
  font-weight: 700;
}
.screenshot {
  max-width: 100%;
  border-radius: 8px;
  border: 1px solid #e5e7eb;
}
.scores-grid {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.score-item {
  display: flex;
  align-items: center;
  gap: 12px;
}
.dim-label {
  width: 80px;
  font-size: 13px;
  font-weight: 600;
  color: #4b5563;
}
.score-bar {
  flex: 1;
  height: 8px;
  background: #f3f4f6;
  border-radius: 4px;
  overflow: hidden;
}
.score-fill {
  height: 100%;
  background: #4361EE;
  border-radius: 4px;
  transition: width 0.3s;
}
.dim-score {
  width: 32px;
  text-align: right;
  font-size: 13px;
  font-weight: 600;
}
.analysis-text {
  font-size: 14px;
  line-height: 1.8;
  color: #374151;
  white-space: pre-wrap;
  margin: 0;
}
.rules-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.rule-item {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 13px;
}
.rule-item.passed {
  background: #f0fdf4;
}
.rule-item.failed {
  background: #fef2f2;
}
.rule-status {
  font-weight: 700;
}
.rule-item.passed .rule-status { color: #059669; }
.rule-item.failed .rule-status { color: #dc2626; }
.rule-name {
  font-weight: 600;
}
.rule-details {
  color: #6b7280;
  flex: 1;
}
.error-section {
  border-color: #fecaca;
  background: #fef2f2;
}
.error-section p {
  color: #dc2626;
  margin: 0;
}
</style>
