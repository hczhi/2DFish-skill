<template>
  <div class="analytics-page page">
    <div class="page-header">
      <h1>数据统计</h1>
      <div class="header-actions">
        <select v-model="days" @change="loadStats" class="days-select">
          <option :value="7">近 7 天</option>
          <option :value="14">近 14 天</option>
          <option :value="30">近 30 天</option>
          <option :value="90">近 90 天</option>
        </select>
      </div>
    </div>

    <div class="stats-overview">
      <div class="stat-card">
        <div class="stat-label">今日 PV</div>
        <div class="stat-value">{{ stats.today_pv }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">今日 UV</div>
        <div class="stat-value">{{ stats.today_uv }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">{{ days }}天 PV</div>
        <div class="stat-value">{{ stats.total_pv }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">{{ days }}天 UV</div>
        <div class="stat-value">{{ stats.total_uv }}</div>
      </div>
    </div>

    <div class="chart-section">
      <h2 class="section-title">趋势</h2>
      <div class="chart-container">
        <div class="chart-bars">
          <div
            v-for="d in stats.daily_trend"
            :key="d.date"
            class="chart-bar-group"
          >
            <div class="bar-stack">
              <div class="bar bar-pv" :style="{ height: barHeight(d.pv, maxPV) + 'px' }" :title="`PV: ${d.pv}`"></div>
              <div class="bar bar-uv" :style="{ height: barHeight(d.uv, maxPV) + 'px' }" :title="`UV: ${d.uv}`"></div>
            </div>
            <div class="bar-label">{{ formatDate(d.date) }}</div>
            <div class="bar-value">{{ d.pv }}</div>
          </div>
        </div>
        <div class="chart-legend">
          <span class="legend-item"><span class="legend-dot pv"></span> PV</span>
          <span class="legend-item"><span class="legend-dot uv"></span> UV</span>
        </div>
      </div>
    </div>

    <div class="section">
      <h2 class="section-title">热门页面 TOP 20</h2>
      <div class="hc-table-container">
        <table class="hc-table">
          <thead>
            <tr>
              <th>页面</th>
              <th>PV</th>
              <th>UV</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in stats.top_pages" :key="p.path">
              <td class="path-cell">{{ p.path }}</td>
              <td>{{ p.pv }}</td>
              <td>{{ p.uv }}</td>
            </tr>
            <tr v-if="!stats.top_pages?.length">
              <td colspan="3" class="empty-cell">暂无数据</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="section">
      <h2 class="section-title">实时访问</h2>
      <button class="hc-btn hc-btn-secondary hc-btn-sm" @click="loadRecent" :disabled="loadingRecent">刷新</button>
      <div class="hc-table-container" style="margin-top: 12px;">
        <table class="hc-table">
          <thead>
            <tr>
              <th>时间</th>
              <th>页面</th>
              <th>IP</th>
              <th>来源</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(r, i) in recentViews" :key="i">
              <td class="time-cell">{{ formatTime(r.created_at) }}</td>
              <td class="path-cell">{{ r.path }}</td>
              <td>{{ r.ip }}</td>
              <td class="ref-cell">{{ shortRef(r.referrer) }}</td>
            </tr>
            <tr v-if="!recentViews.length">
              <td colspan="4" class="empty-cell">暂无数据</td>
            </tr>
          </tbody>
        </table>
        <AdminPagination v-if="recentViews.length" v-model="recentPage" :total="totalRecent" :total-pages="totalRecentPages" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { authFetch } from '../../lib/auth'
import AdminPagination from '../../components/common/AdminPagination.vue'

const PAGE_SIZE = 20
const days = ref(7)
const loadingRecent = ref(false)
const recentPage = ref(1)
const totalRecent = ref(0)
const totalRecentPages = computed(() => Math.ceil(totalRecent.value / PAGE_SIZE))

interface DailyTrend {
  date: string
  pv: number
  uv: number
}

interface TopPage {
  path: string
  pv: number
  uv: number
}

interface StatsData {
  today_pv: number
  today_uv: number
  total_pv: number
  total_uv: number
  daily_trend: DailyTrend[]
  top_pages: TopPage[]
}

interface RecentView {
  path: string
  referrer: string
  user_agent: string
  ip: string
  created_at: string
}

const stats = ref<StatsData>({
  today_pv: 0,
  today_uv: 0,
  total_pv: 0,
  total_uv: 0,
  daily_trend: [],
  top_pages: [],
})

const recentViews = ref<RecentView[]>([])

const maxPV = computed(() => {
  if (!stats.value.daily_trend.length) return 1
  return Math.max(...stats.value.daily_trend.map(d => d.pv), 1)
})

function barHeight(value: number, max: number): number {
  return Math.max(4, (value / max) * 160)
}

function formatDate(dateStr: string): string {
  const parts = dateStr.split('-')
  return `${parts[1]}/${parts[2]}`
}

function formatTime(isoStr: string): string {
  if (!isoStr) return ''
  const d = new Date(isoStr)
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}

function shortRef(ref: string): string {
  if (!ref) return '-'
  try {
    return new URL(ref).hostname
  } catch {
    return ref.slice(0, 30)
  }
}

async function loadStats() {
  try {
    const res = await authFetch(`/api/analytics/stats/overview?days=${days.value}`)
    if (res.ok) {
      stats.value = await res.json()
    }
  } catch { /* silent */ }
}

async function loadRecent() {
  loadingRecent.value = true
  try {
    const res = await authFetch(`/api/analytics/stats/recent?page=${recentPage.value}&page_size=${PAGE_SIZE}`)
    if (res.ok) {
      const data = await res.json()
      recentViews.value = data.items
      totalRecent.value = data.total
    }
  } catch { /* silent */ }
  loadingRecent.value = false
}

watch(recentPage, loadRecent)

onMounted(() => {
  loadStats()
  loadRecent()
})
</script>

<style scoped>
.analytics-page { max-width: 1200px; margin: 0 auto; }

.header-actions { display: flex; gap: 12px; align-items: center; }

.days-select {
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
.days-select:hover {
  background: #ffffff;
  border-color: #3B5BDB;
}

.stats-overview {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  margin-bottom: 40px;
}

.stat-card {
  background: #ffffff;
  border-radius: 10px;
  border: 1px solid rgba(0, 0, 0, 0.05);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.03);
  padding: 24px;
  text-align: center;
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}
.stat-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.06);
}
.stat-label {
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

.section-title {
  font-family: var(--font-sans, sans-serif);
  font-size: 20px;
  font-weight: 700;
  margin: 0 0 16px;
  padding-bottom: 8px;
  border-bottom: 1px solid #e5e7eb;
}

.chart-section {
  margin-bottom: 40px;
}

.chart-container {
  background: #ffffff;
  border-radius: 10px;
  border: 1px solid rgba(0, 0, 0, 0.05);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.04);
  padding: 24px;
}

.chart-bars {
  display: flex;
  align-items: flex-end;
  gap: 4px;
  height: 200px;
  padding-bottom: 40px;
  overflow-x: auto;
}

.chart-bar-group {
  display: flex;
  flex-direction: column;
  align-items: center;
  flex: 1;
  min-width: 32px;
}

.bar-stack {
  display: flex;
  gap: 2px;
  align-items: flex-end;
  height: 160px;
}

.bar {
  width: 12px;
  min-height: 4px;
  transition: height 0.3s;
}
.bar-pv { background: var(--c-blue-primary); }
.bar-uv { background: #111; }

.bar-label {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--c-text-sub);
  margin-top: 8px;
  white-space: nowrap;
}

.bar-value {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--c-text-main);
  font-weight: bold;
}

.chart-legend {
  display: flex;
  gap: 16px;
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--c-border);
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: var(--font-mono);
  font-size: 11px;
  text-transform: uppercase;
}

.legend-dot {
  width: 12px;
  height: 12px;
  border: 1px solid var(--c-text-main);
}
.legend-dot.pv { background: var(--c-blue-primary); }
.legend-dot.uv { background: #111; }

.section { margin-bottom: 40px; }

.path-cell {
  font-family: var(--font-mono);
  font-size: 13px;
  max-width: 400px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.time-cell {
  font-family: var(--font-mono);
  font-size: 12px;
  white-space: nowrap;
}

.ref-cell {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--c-text-sub);
}

.empty-cell {
  text-align: center;
  color: var(--c-text-sub);
  font-family: var(--font-mono);
  font-size: 12px;
  padding: 32px !important;
}

@media (max-width: 768px) {
  .stats-overview { grid-template-columns: repeat(2, 1fr); }
}
</style>
