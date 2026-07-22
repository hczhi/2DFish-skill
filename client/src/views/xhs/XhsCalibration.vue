<template>
  <div class="page-wrapper">
    <SiteHeader />
    <div class="calib-page">
      <div class="calib">
      <div class="calib-header">
        <router-link to="/xhs/studio" class="back-link">← 返回写作台</router-link>
        <h1>校准分析</h1>
        <p class="sub">回填你已发布笔记的真实数据，看评分准不准、哪个维度真正驱动点赞。这是你调权重的依据。</p>
      </div>

      <!-- 核心指标 -->
      <div class="metrics" v-if="data">
        <div class="metric-card hc-shadow-sm">
          <div class="metric-num">{{ data.sampleCount }}</div>
          <div class="metric-label">已回填样本</div>
        </div>
        <div class="metric-card hc-shadow-sm">
          <div class="metric-num" :class="corrClass(data.totalCorrelation)">
            {{ fmtCorr(data.totalCorrelation) }}
          </div>
          <div class="metric-label">总分 vs 真实点赞 相关性</div>
        </div>
      </div>

      <div class="hint" v-if="data && data.sampleCount < data.minSamplesForStats">
        💡 至少需要 {{ data.minSamplesForStats }} 篇已回填真实数据的笔记，相关性分析才会出现。当前 {{ data.sampleCount }} 篇。
      </div>

      <!-- 权重调整（任何时候都能调）+ 相关性参考（有数据时显示） -->
      <div class="section hc-shadow-sm section-card">
        <h2>维度权重调整</h2>
        <p class="section-sub">
          改完点「保存权重」即生效，下次诊断就用新权重（无需重启）。
          <span v-if="hasStats">右侧「相关性」是你真实数据算出的参考：越高说明该维度越该给高权重。</span>
          <span v-else>回填 ≥{{ data ? data.minSamplesForStats : 3 }} 篇真实数据后，这里会出现相关性参考帮你决定怎么调。</span>
        </p>
        <div class="corr-list">
          <div v-for="d in dimCorrList" :key="d.key" class="corr-row">
            <span class="corr-name">{{ d.label }}</span>
            <template v-if="hasStats">
              <div class="corr-bar-wrap">
                <div class="corr-bar" :class="corrClass(d.value)" :style="barStyle(d.value)"></div>
              </div>
              <span class="corr-val" :class="corrClass(d.value)">{{ fmtCorr(d.value) }}</span>
            </template>
            <span v-else class="corr-placeholder">相关性：暂无数据</span>
            <label class="corr-weight-edit">
              权重
              <input v-model.number="weights[d.key]" class="w-input hc-input" type="number" step="0.1" min="0" />
            </label>
          </div>
        </div>
        <p class="advice" v-if="advice">{{ advice }}</p>
        <div class="weight-actions">
          <button class="btn-save-w" @click="saveWeights" :disabled="savingW">
            {{ savingW ? '保存中…' : '保存权重' }}
          </button>
        </div>
      </div>

      <!-- 样本对比表 -->
      <div class="section hc-shadow-sm section-card">
        <h2>笔记对比</h2>
        <table class="sample-table" v-if="allNotes.length">
          <thead>
            <tr>
              <th>标题</th><th>预测分</th><th>真实点赞</th><th>收藏</th><th>浏览</th><th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="n in allNotes" :key="n.id">
              <td class="t-title">{{ n.title || '(无标题)' }}</td>
              <td><span class="score-badge">{{ n.last_score ?? '—' }}</span></td>
              <td>
                <input v-model.number="edit[n.id].likes" class="num-input hc-input" type="number" placeholder="—" />
              </td>
              <td><input v-model.number="edit[n.id].collects" class="num-input hc-input" type="number" placeholder="—" /></td>
              <td><input v-model.number="edit[n.id].views" class="num-input hc-input" type="number" placeholder="—" /></td>
              <td><button class="btn-save" @click="saveReal(n.id)">保存</button></td>
            </tr>
          </tbody>
        </table>
        <p class="empty" v-else>还没有草稿。先去写作台写几篇并诊断，发布后回来这里回填真实数据。</p>
      </div>
    </div>
    </div>
    <SiteFooter />
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { apiGet, apiPatch, apiPut } from '../../lib/api'
import SiteHeader from '../../components/common/SiteHeader.vue'
import SiteFooter from '../../components/common/SiteFooter.vue'

const DIM_LABELS: Record<string, string> = {
  titleHook: '标题钩子', opening: '开头留人', resonance: '痛点共鸣',
  emotion: '情绪浓度', value: '价值密度', interaction: '互动引导',
}
const DIM_ORDER = ['titleHook', 'opening', 'resonance', 'emotion', 'value', 'interaction']

interface CalibData {
  sampleCount: number
  minSamplesForStats: number
  totalCorrelation: number | null
  dimensionCorrelations: Record<string, number | null>
  samples: any[]
}

const data = ref<CalibData | null>(null)
const allNotes = ref<any[]>([])
const edit = reactive<Record<string, { likes: number | null; collects: number | null; views: number | null }>>({})
const weights = reactive<Record<string, number>>({})
const savingW = ref(false)

const hasStats = computed(() => !!data.value && data.value.sampleCount >= data.value.minSamplesForStats)

const dimCorrList = computed(() => {
  if (!data.value) return []
  return DIM_ORDER.map(key => ({
    key, label: DIM_LABELS[key], value: data.value!.dimensionCorrelations[key],
  }))
})

// 简单建议：找相关性最高和最低的维度，提示怎么调
const advice = computed(() => {
  if (!data.value || data.value.sampleCount < data.value.minSamplesForStats) return ''
  const entries = DIM_ORDER
    .map(k => ({ k, v: data.value!.dimensionCorrelations[k] }))
    .filter(e => e.v !== null) as { k: string; v: number }[]
  if (entries.length < 2) return ''
  entries.sort((a, b) => b.v - a.v)
  const top = entries[0], bottom = entries[entries.length - 1]
  return `📌 在你的数据里，「${DIM_LABELS[top.k]}」最能预测点赞（${fmtCorr(top.v)}），可考虑调高权重；「${DIM_LABELS[bottom.k]}」相关性最低（${fmtCorr(bottom.v)}），如果持续如此可以调低。`
})

function fmtCorr(v: number | null): string {
  if (v === null || v === undefined) return '—'
  return (v > 0 ? '+' : '') + v.toFixed(2)
}
function corrClass(v: number | null) {
  if (v === null) return 'neutral'
  if (v >= 0.5) return 'good'
  if (v >= 0.2) return 'mid'
  return 'low'
}
function barStyle(v: number | null) {
  if (v === null) return { width: '0%' }
  return { width: Math.abs(v) * 100 + '%' }
}

async function load() {
  const [calib, notes, w] = await Promise.all([
    apiGet<CalibData>('/api/xhs/calibration'),
    apiGet<any[]>('/api/xhs/notes'),
    apiGet<Record<string, number>>('/api/xhs/weights'),
  ])
  data.value = calib
  allNotes.value = notes
  for (const k of DIM_ORDER) weights[k] = w[k]
  for (const n of notes) {
    edit[n.id] = {
      likes: n.real_likes ?? null,
      collects: n.real_collects ?? null,
      views: n.real_views ?? null,
    }
  }
}

async function saveWeights() {
  savingW.value = true
  try {
    const updated = await apiPut<Record<string, number>>('/api/xhs/weights', { ...weights })
    for (const k of DIM_ORDER) weights[k] = updated[k]
  } catch (e: any) {
    alert(e.message || '保存权重失败')
  } finally {
    savingW.value = false
  }
}

async function saveReal(id: string) {
  const e = edit[id]
  try {
    await apiPatch(`/api/xhs/notes/${id}/real-data`, {
      real_likes: e.likes, real_collects: e.collects, real_views: e.views,
    })
    await load() // 重新算相关性
  } catch (err: any) {
    alert(err.message || '保存失败')
  }
}

onMounted(load)
</script>

<style scoped>
.page-wrapper {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}
.calib-page {
  flex: 1;
  background: #FDFBF7;
  font-family: "Inter", -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
  color: #111827;
  padding: 82px 24px 80px;
}
.calib {
  max-width: 900px;
  margin: 0 auto;
}
.back-link { color: #6b7280; text-decoration: none; font-size: 14px; transition: color 0.2s; }
.back-link:hover { color: #E24A29; }
.calib-header h1 { font-size: 32px; font-weight: 900; margin: 16px 0 8px; letter-spacing: -0.5px; }
.sub { color: #6b7280; font-size: 14px; margin: 0; line-height: 1.6; }

.metrics { display: flex; gap: 16px; margin: 32px 0; }
.metric-card { flex: 1; background: #fff; border-radius: 16px; padding: 24px; border: 1px solid rgba(0,0,0,0.02); }
.metric-num { font-size: 40px; font-weight: 900; letter-spacing: -1px; }
.metric-num.good { color: #16a34a; }
.metric-num.mid { color: #ea580c; }
.metric-num.low { color: #E24A29; }
.metric-num.neutral { color: #9ca3af; }
.metric-label { font-size: 13px; color: #6b7280; margin-top: 6px; font-weight: 500; }

.hint { background: #fff7ed; color: #ea580c; padding: 14px 20px; border-radius: 12px; font-size: 14px; margin-bottom: 24px; font-weight: 500; }

.section { margin-top: 32px; }
.section-card { background: #fff; border-radius: 16px; padding: 32px; border: 1px solid rgba(0,0,0,0.02); }
.section h2 { font-size: 20px; font-weight: 800; margin: 0 0 8px; }
.section-sub { color: #6b7280; font-size: 14px; margin: 0 0 24px; line-height: 1.6; }

.corr-list { display: flex; flex-direction: column; gap: 16px; }
.corr-row { display: flex; align-items: center; gap: 16px; }
.corr-name { width: 72px; font-size: 14px; font-weight: 600; color: #374151; }
.corr-bar-wrap { flex: 1; height: 8px; background: rgba(0,0,0,0.04); border-radius: 4px; overflow: hidden; }
.corr-bar { height: 100%; border-radius: 4px; transition: width 0.5s cubic-bezier(0.34, 1.56, 0.64, 1); }
.corr-bar.good { background: #16a34a; }
.corr-bar.mid { background: #ea580c; }
.corr-bar.low { background: #E24A29; }
.corr-bar.neutral { background: #d1d5db; }
.corr-val { width: 56px; text-align: right; font-size: 14px; font-weight: 600; }
.corr-val.good { color: #16a34a; } .corr-val.mid { color: #ea580c; } .corr-val.low { color: #E24A29; } .corr-val.neutral { color: #9ca3af; }
.corr-placeholder { flex: 1; font-size: 13px; color: #d1d5db; }
.corr-weight-edit { width: 110px; font-size: 13px; color: #6b7280; text-align: right; display: flex; align-items: center; justify-content: flex-end; gap: 8px; font-weight: 500; }
.w-input { width: 56px; border: 1px solid transparent; background: #F9FAFB; border-radius: 8px; padding: 6px; font-size: 13px; text-align: center; outline: none; transition: all 0.3s; font-weight: 600; }
.w-input:focus { background: #fff; border-color: #E24A29; box-shadow: 0 0 0 4px rgba(226, 74, 41, 0.15); }
.weight-actions { display: flex; align-items: center; gap: 12px; margin-top: 24px; }
.btn-save-w { background: #E24A29; color: #fff; border: none; padding: 10px 24px; border-radius: 9999px; font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1); box-shadow: 0 4px 12px rgba(226, 74, 41, 0.2); }
.btn-save-w:hover:not(:disabled) { background: #f05431; transform: translateY(-2px); box-shadow: 0 8px 16px rgba(226, 74, 41, 0.3); }
.btn-save-w:disabled { opacity: 0.5; cursor: not-allowed; }
.advice { margin-top: 24px; background: #FEF8F6; padding: 16px 20px; border-radius: 12px; font-size: 14px; line-height: 1.6; color: #374151; font-weight: 500; }

.sample-table { width: 100%; border-collapse: collapse; font-size: 14px; }
.sample-table th { text-align: left; padding: 12px 16px; color: #6b7280; font-weight: 600; font-size: 13px; border-bottom: 1px solid #E5E7EB; }
.sample-table td { padding: 12px 16px; border-bottom: 1px solid #F3F4F6; vertical-align: middle; }
.t-title { max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
.score-badge { display: inline-block; background: #F9FAFB; padding: 4px 8px; border-radius: 6px; font-size: 13px; font-weight: 600; color: #374151; }
.num-input { width: 80px; border: 1px solid transparent; background: #F9FAFB; border-radius: 8px; padding: 6px 10px; font-size: 13px; outline: none; transition: all 0.3s; }
.num-input:focus { background: #fff; border-color: #E24A29; box-shadow: 0 0 0 4px rgba(226, 74, 41, 0.15); }
.btn-save { background: #fff; border: 1px solid #E5E7EB; padding: 6px 16px; border-radius: 9999px; font-size: 13px; font-weight: 500; cursor: pointer; transition: all 0.2s; color: #374151; }
.btn-save:hover { background: #F9FAFB; border-color: #D1D5DB; }
.empty { color: #9ca3af; font-size: 14px; text-align: center; padding: 40px 0; }

.hc-shadow-sm { box-shadow: 0 8px 24px rgba(0, 0, 0, 0.03); }
</style>
