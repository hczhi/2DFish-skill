<template>
  <div class="page">
    <div class="page-header">
      <h1>AI 用量看板</h1>
      <select v-model="days" @change="loadStats" class="select">
        <option value="7">最近 7 天</option>
        <option value="14">最近 14 天</option>
        <option value="30">最近 30 天</option>
      </select>
    </div>

    <!-- 总览卡片 -->
    <div class="stat-cards" v-if="stats.total">
      <div class="stat-card">
        <span class="stat-label">总调用</span>
        <span class="stat-value">{{ stats.total.calls || 0 }}</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">总 Tokens</span>
        <span class="stat-value">{{ formatNum(stats.total.tokens) }}</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">输入 Tokens</span>
        <span class="stat-value">{{ formatNum(stats.total.input_tokens) }}</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">输出 Tokens</span>
        <span class="stat-value">{{ formatNum(stats.total.output_tokens) }}</span>
      </div>
    </div>

    <!-- 按用户 -->
    <section class="section">
      <h2>按用户</h2>
      <div class="hc-table-container" v-if="stats.byUser?.length">
        <table class="hc-table">
          <thead><tr><th>用户</th><th>调用次数</th><th>Tokens</th></tr></thead>
          <tbody>
            <tr v-for="row in stats.byUser" :key="row.username">
              <td>
                <div style="font-weight: 600; color: var(--c-text-main);">{{ row.username }}</div>
              </td>
              <td>{{ row.calls }}</td>
              <td>{{ formatNum(row.tokens) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- 按来源 -->
    <section class="section">
      <h2>按模块</h2>
      <div class="hc-table-container" v-if="stats.bySource?.length">
        <table class="hc-table">
          <thead><tr><th>模块</th><th>调用次数</th><th>Tokens</th></tr></thead>
          <tbody>
            <tr v-for="row in stats.bySource" :key="row.source">
              <td>
                <span class="hc-badge hc-badge-blue">{{ row.source }}</span>
              </td>
              <td>{{ row.calls }}</td>
              <td>{{ formatNum(row.tokens) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- 按日期 -->
    <section class="section">
      <h2>按日期</h2>
      <div class="hc-table-container" v-if="stats.byDay?.length">
        <table class="hc-table">
          <thead><tr><th>日期</th><th>调用次数</th><th>Tokens</th></tr></thead>
          <tbody>
            <tr v-for="row in stats.byDay" :key="row.day">
              <td><span style="color: var(--c-text-sub); font-size: 13px;">{{ row.day }}</span></td>
              <td>{{ row.calls }}</td>
              <td>{{ formatNum(row.tokens) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { apiGet } from '../../lib/api'

const days = ref('7')
const stats = ref<any>({})

async function loadStats() {
  stats.value = await apiGet(`/api/admin/ai-usage?days=${days.value}`)
}

function formatNum(n: number | null) {
  if (!n) return '0'
  if (n > 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n > 1_000) return (n / 1_000).toFixed(1) + 'K'
  return String(n)
}

const maxCalls = computed(() => {
  if (!stats.value.byDay) return 1
  return Math.max(...stats.value.byDay.map((r: any) => r.calls), 1)
})

function barWidth(calls: number) {
  return Math.round((calls / maxCalls.value) * 100) + '%'
}

onMounted(loadStats)
</script>

<style scoped>
/* 使用 AdminLayout 注入的全局 Brutalist 样式，移除重复样式 */
.page { max-width: 1200px; }

.select { 
  font-family: var(--font-sans, sans-serif);
  font-size: 14px;
  font-weight: 600;
  padding: 8px 16px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #f9fafb;
  cursor: pointer;
  color: #374151;
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}
.select:focus {
  outline: none;
  background: #ffffff;
  border-color: #3B5BDB;
  box-shadow: 0 0 0 4px rgba(59, 91, 219, 0.15);
}

.stat-cards { 
  display: grid; 
  grid-template-columns: repeat(4, 1fr); 
  gap: 24px; 
  margin-bottom: 48px; 
}
.stat-card { 
  background: #ffffff;
  border-radius: 10px;
  border: 1px solid rgba(0, 0, 0, 0.05);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.03);
  padding: 24px;
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}
.stat-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.06);
}
.stat-label { 
  display: block; 
  font-family: var(--font-sans, sans-serif);
  font-size: 13px; 
  font-weight: 600;
  color: var(--c-text-sub); 
  margin-bottom: 8px; 
}
.stat-value { 
  font-family: var(--font-sans, sans-serif);
  font-size: 32px; 
  font-weight: 700; 
  color: #3B5BDB; 
}

.section { margin-bottom: 48px; }

.bar-chart { 
  background: #fff; 
  padding: 24px; 
  border: 2px solid var(--c-text-main, #111);
}
.bar-row { 
  display: flex; 
  align-items: center; 
  gap: 16px; 
  margin-bottom: 12px; 
}
.bar-label { 
  width: 100px; 
  font-family: var(--font-mono);
  font-size: 13px; 
  font-weight: bold;
  color: var(--c-text-main, #111); 
  flex-shrink: 0; 
}
.bar-track { 
  flex: 1; 
  height: 24px; 
  background: #f0f0f0; 
  border: 1px solid var(--c-border, #e5e7eb);
}
.bar-fill { 
  height: 100%; 
  background: var(--c-blue-primary, #0077FF); 
  transition: width 0.3s cubic-bezier(0.16, 1, 0.3, 1); 
}
.bar-value { 
  width: 60px; 
  font-family: var(--font-mono);
  font-size: 14px; 
  font-weight: bold;
  color: var(--c-text-main, #111); 
  text-align: right; 
}
</style>
