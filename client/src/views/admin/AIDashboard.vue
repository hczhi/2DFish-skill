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
      <table class="data-table" v-if="stats.byUser?.length">
        <thead><tr><th>用户</th><th>调用次数</th><th>Tokens</th></tr></thead>
        <tbody>
          <tr v-for="row in stats.byUser" :key="row.username">
            <td>{{ row.username }}</td>
            <td>{{ row.calls }}</td>
            <td>{{ formatNum(row.tokens) }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- 按来源 -->
    <section class="section">
      <h2>按模块</h2>
      <table class="data-table" v-if="stats.bySource?.length">
        <thead><tr><th>模块</th><th>调用次数</th><th>Tokens</th></tr></thead>
        <tbody>
          <tr v-for="row in stats.bySource" :key="row.source">
            <td>{{ row.source }}</td>
            <td>{{ row.calls }}</td>
            <td>{{ formatNum(row.tokens) }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- 按日期 -->
    <section class="section">
      <h2>按日期</h2>
      <div class="bar-chart" v-if="stats.byDay?.length">
        <div class="bar-row" v-for="row in stats.byDay" :key="row.day">
          <span class="bar-label">{{ row.day }}</span>
          <div class="bar-track">
            <div class="bar-fill" :style="{ width: barWidth(row.calls) }"></div>
          </div>
          <span class="bar-value">{{ row.calls }}</span>
        </div>
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
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
.page-header h1 { font-family: -apple-system, sans-serif; font-size: 24px; font-weight: 600; }
.select { padding: 6px 12px; border: 1px solid #ddd; border-radius: 6px; font-size: 14px; }
.stat-cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 32px; }
.stat-card { background: #fff; padding: 20px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
.stat-label { display: block; font-size: 12px; color: #888; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
.stat-value { font-size: 28px; font-weight: 700; color: #111; }
.section { margin-bottom: 32px; }
.section h2 { font-family: -apple-system, sans-serif; font-size: 16px; font-weight: 600; margin-bottom: 12px; }
.data-table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
.data-table th { text-align: left; padding: 10px 16px; background: #f8f9fa; font-size: 13px; color: #666; }
.data-table td { padding: 10px 16px; border-top: 1px solid #f0f0f0; font-size: 14px; }
.bar-chart { background: #fff; padding: 16px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
.bar-row { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
.bar-label { width: 90px; font-size: 13px; color: #666; flex-shrink: 0; }
.bar-track { flex: 1; height: 20px; background: #f0f0f0; border-radius: 4px; overflow: hidden; }
.bar-fill { height: 100%; background: #0052FF; border-radius: 4px; transition: width 0.3s; }
.bar-value { width: 40px; font-size: 13px; color: #333; text-align: right; }
</style>
