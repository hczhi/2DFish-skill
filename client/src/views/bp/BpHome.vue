<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../../lib/api'
import '../../components/bp/report.css'
import Icon from '../../components/bp/Icon.vue'
import SiteHeader from '../../components/common/SiteHeader.vue'

// BP 分析首页：新建一份体检（BP + 补充材料 + 补充说明）+ 历史报告。样式在 components/bp/report.css 的 `.bpr.home` 段。

interface Row {
  id: string; filename: string; chars: number; status: string; error: string | null; created_at: string
  company: string | null; score: number | null; band: string | null; attachments?: { name: string; kind: string }[]
}

const BP_ACCEPT = '.pdf,.pptx,.docx,.doc,.txt,.md,.ppt'
const ATT_ACCEPT = '.pdf,.pptx,.docx,.txt,.md,.png,.jpg,.jpeg,.webp,.gif'
const MAX_ATT = 9
const isImage = (f: File) => /\.(png|jpe?g|webp|gif)$/i.test(f.name) || f.type.startsWith('image/')

const router = useRouter()
const bp = ref<File | null>(null)
const atts = ref<File[]>([])
const text = ref('')
const overBp = ref(false)
const overAtt = ref(false)
const submitting = ref(false)
const error = ref('')
const attError = ref('')
const reports = ref<Row[]>([])
const listError = ref('')
const loaded = ref(false)

const imageCount = computed(() => atts.value.filter(isImage).length)
const canSubmit = computed(() => !submitting.value && (!!bp.value || !!text.value.trim()))
const STATUS_TEXT: Record<string, string> = { running: '分析中', done: '已完成', failed: '失败', interrupted: '中断' }
const BAND_NO: Record<string, number> = { 第一梯队: 1, 第二梯队: 2, 第三梯队: 3, 第四梯队: 4 }
const METHOD = [
  { t: '读材料', d: 'BP 与补充材料拆成公司、产品、团队、经营、融资五类事实；每一条都回到原文核对，标出页码与出处。' },
  { t: '查自己', d: '同一指标在不同页、BP 与附件之间是否打架；收入是不是好收入。投资人翻到第三页会发现的问题，先在这里出现。' },
  { t: '看外面', d: '工商信用、行业盘子、竞品与融资、对标企业、目标机构。读整页正文，按来源等级取用，关键数字标注几源印证。' },
  { t: '开处方', d: '五维双轨评分，拆出「改材料就能拿回来」的分；逐句改写建议、追问预演与 90 天行动清单。' },
]

function pickBp(f?: File | null) {
  if (!f) return
  bp.value = f
  error.value = ''
}
function addAtts(list: FileList | File[] | null | undefined) {
  attError.value = ''
  const incoming = [...(list || [])]
  const next = [...atts.value]
  for (const f of incoming) {
    if (!new RegExp(`(${ATT_ACCEPT.split(',').map((x) => x.replace('.', '\\.')).join('|')})$`, 'i').test(f.name)) {
      attError.value = `「${f.name}」不支持，补充材料支持 PDF / PPTX / DOCX / TXT 和 PNG / JPG / WebP 图片。`
      continue
    }
    if (next.some((x) => x.name === f.name && x.size === f.size)) continue
    if (next.length >= MAX_ATT) { attError.value = `补充材料最多 ${MAX_ATT} 份，多出来的没有加进去。`; break }
    next.push(f)
  }
  atts.value = next
}
const removeAtt = (i: number) => { atts.value = atts.value.filter((_, j) => j !== i) }
const sizeText = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

async function load() {
  try {
    const res = await api('/api/bp/reports')
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
    reports.value = data.reports
  } catch (e: any) {
    listError.value = `报告列表没加载出来：${e?.message || e}`
  } finally {
    loaded.value = true
  }
}

async function submit() {
  submitting.value = true
  error.value = ''
  try {
    const fd = new FormData()
    if (bp.value) fd.append('file', bp.value)
    // 没有 BP 文件时粘贴框里的就是 BP；有文件时它是一份「补充说明」附件。
    if (text.value.trim()) fd.append(bp.value ? 'extra' : 'text', text.value)
    for (const f of atts.value) fd.append('files', f)
    const res = await api('/api/bp/reports', { method: 'POST', body: fd })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.detail || data.error || `请求失败（HTTP ${res.status}）`)
    router.push(`/consult/bp/reports/${data.id}`)
  } catch (e: any) {
    error.value = e?.message || String(e)
  } finally {
    submitting.value = false
  }
}

const SAMPLE_DIMS: [string, number, number][] = [['市场', 62, 45], ['技术', 64, 40], ['商业化', 58, 30], ['团队', 70, 34], ['资本化', 55, 26]]

const fmtDate = (t: string) => new Date(t).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-')
const fmtTime = (t: string) => new Date(t).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' })

onMounted(load)
</script>

<template>
  <SiteHeader />
  <div class="bpr home pe">
    <section class="h-hero">
      <!-- 纯装饰（aria-hidden）：柔光、颗粒、刻度环、走势线、水印。全部低透明度，铺满通栏。 -->
      <div class="h-deco" aria-hidden="true">
        <div class="h-glow g1" /><div class="h-glow g2" /><div class="h-grain" />
        <svg class="h-art" viewBox="0 0 1600 640" preserveAspectRatio="xMidYMid slice">
          <g fill="none" stroke="#fff">
            <circle v-for="(r, i) in [90, 160, 240, 330, 430, 540]" :key="r" cx="1500" cy="170" :r="r" :stroke-opacity="0.075 - i * 0.009" :stroke-dasharray="i % 2 ? '2 7' : ''" />
          </g>
          <g stroke="#C9A86A" stroke-opacity=".35">
            <line v-for="a in 48" :key="a" :x1="1500 + Math.cos((a * 7.5 * Math.PI) / 180) * 330" :y1="170 + Math.sin((a * 7.5 * Math.PI) / 180) * 330"
              :x2="1500 + Math.cos((a * 7.5 * Math.PI) / 180) * (a % 4 ? 338 : 348)" :y2="170 + Math.sin((a * 7.5 * Math.PI) / 180) * (a % 4 ? 338 : 348)" />
          </g>
          <path d="M1500 60 V280 M1390 170 H1610" stroke="#fff" stroke-opacity=".08" />
          <g stroke="#fff" stroke-opacity=".12">
            <path d="M120 96 h14 M127 89 v14" /><path d="M640 560 h14 M647 553 v14" /><path d="M980 70 h14 M987 63 v14" /><path d="M1520 520 h14 M1527 513 v14" />
          </g>
          <polyline points="0,560 120,548 230,556 340,522 450,530 560,498 680,506 790,470 900,478 1010,440 1120,452 1230,410 1340,418 1450,380 1600,360"
            fill="none" stroke="#C9A86A" stroke-opacity=".45" stroke-width="1.5" />
          <polygon points="0,560 120,548 230,556 340,522 450,530 560,498 680,506 790,470 900,478 1010,440 1120,452 1230,410 1340,418 1450,380 1600,360 1600,640 0,640" fill="url(#h-area)" />
          <g fill="#C9A86A"><circle v-for="p in [[340, 522], [790, 470], [1230, 410], [1450, 380]]" :key="p[0]" :cx="p[0]" :cy="p[1]" r="3" fill-opacity=".8" /></g>
          <defs>
            <linearGradient id="h-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#C9A86A" stop-opacity=".10" /><stop offset="1" stop-color="#C9A86A" stop-opacity="0" /></linearGradient>
          </defs>
          <text x="40" y="630" font-family="Georgia, 'Songti SC', serif" font-size="150" font-weight="700" fill="none" stroke="#fff" stroke-opacity=".05" letter-spacing="10">DUE DILIGENCE</text>
        </svg>
      </div>
      <div class="h-in h-hero-in">
        <div class="h-copy">
          <router-link to="/consult" class="h-back">← 返回创业者体检咨询</router-link>
          <div class="h-over"><i />VENTURE DIAGNOSTICS · 创业者版</div>
          <h1>像投资人一样，<br />先把你的 BP <span class="h-mark-u">读一遍</span>。</h1>
          <p class="h-lede">上传商业计划书和补充材料，无需对话，直接得到一份十章体检报告：分是怎么丢的、哪些改材料就能拿回来、接下来该去见谁。</p>
          <dl class="h-stats">
            <div><dt>10</dt><dd>章节报告</dd></div>
            <div><dt>5<small>×</small>2</dt><dd>维 · 事实与举证双轨</dd></div>
            <div><dt>逐条</dt><dd>引文与数字核验出处</dd></div>
          </dl>
        </div>
        <aside class="h-sample" aria-label="报告示例">
          <span class="cm tl" /><span class="cm tr" /><span class="cm bl" /><span class="cm br" />
          <div class="hs-top"><span>REPORT · 示例</span><span class="hs-tag">示意</span></div>
          <div class="hs-k">BP 五维总分</div>
          <div class="hs-num">61.8<small>/100</small></div>
          <span class="hs-band">第三梯队 · 改材料就能加分</span>
          <div class="hs-dims">
            <div v-for="d in SAMPLE_DIMS" :key="d[0]" class="hs-dim">
              <span>{{ d[0] }}</span>
              <i><b :style="{ width: `${d[1]}%` }" /><u :style="{ width: `${d[2]}%` }" /></i>
              <em>{{ d[1] }}<small>/{{ d[2] }}</small></em>
            </div>
          </div>
          <div class="hs-leg"><span><b /> 事实分</span><span><u /> 举证分</span><span class="hs-rec">可回收 +26.8</span></div>
        </aside>
      </div>
    </section>

    <main class="h-in h-main">
      <section class="h-form" aria-label="新建体检">
        <span class="fc tl" /><span class="fc tr" /><span class="fc bl" /><span class="fc br" />
        <div class="hf-head">
          <div>
            <div class="hf-over"><i />NEW DIAGNOSIS</div>
            <h2>新建一份体检</h2>
          </div>
          <ul class="hf-pills">
            <li :class="{ on: bp || text.trim() }">{{ bp ? 'BP 已选' : text.trim() ? '项目介绍已填' : '待上传 BP' }}</li>
            <li :class="{ on: atts.length }">补充材料 {{ atts.length }}<template v-if="imageCount"> · 图片 {{ imageCount }}</template></li>
          </ul>
        </div>

        <div class="hf-grid">
          <div :class="['hf-step', { done: bp }]">
            <div class="hf-k"><span class="hf-no">{{ bp ? '✓' : '01' }}</span><b>商业计划书</b><em>必选其一</em></div>
            <label :class="['hf-panel', 'hf-drop', { over: overBp, has: bp }]" @dragover.prevent="overBp = true" @dragleave="overBp = false" @drop.prevent="overBp = false; pickBp($event.dataTransfer?.files?.[0])">
              <input type="file" :accept="BP_ACCEPT" @change="pickBp(($event.target as HTMLInputElement).files?.[0])" />
              <span class="hf-ring"><Icon :name="bp ? 'file' : 'upload'" /></span>
              <template v-if="bp">
                <div class="hf-t hf-file">{{ bp.name }}</div>
                <div class="hf-meta">{{ sizeText(bp.size) }} · 点击或拖入可替换</div>
                <button class="hf-clear" type="button" @click.prevent="bp = null">移除</button>
              </template>
              <template v-else>
                <div class="hf-t">拖入 BP，或点击选择</div>
                <div class="hf-tags"><i>PDF</i><i>PPTX</i><i>DOCX</i></div>
                <div class="hf-meta">扫描件请导出带文字层的 PDF</div>
              </template>
            </label>
          </div>

          <div :class="['hf-step', { done: atts.length }]">
            <div class="hf-k"><span class="hf-no">{{ atts.length ? '✓' : '02' }}</span><b>补充材料</b><em>可选 · 最多 {{ MAX_ATT }} 份</em></div>
            <div :class="['hf-panel', 'stack', { has: atts.length }]">
              <label :class="['hf-drop', 'hf-mini', { over: overAtt }]" @dragover.prevent="overAtt = true" @dragleave="overAtt = false" @drop.prevent="overAtt = false; addAtts($event.dataTransfer?.files)">
                <input type="file" multiple :accept="ATT_ACCEPT" @change="addAtts(($event.target as HTMLInputElement).files); ($event.target as HTMLInputElement).value = ''" />
                <span class="hf-ring"><Icon name="file" /></span>
                <div class="hf-t">拖入或选择文件</div>
                <div class="hf-tags"><i>财务报表</i><i>客户合同</i><i>产品截图</i><i>媒体报道</i></div>
                <div class="hf-meta">文档或图片；图片逐字识别，每张消耗一次 AI 调用</div>
              </label>
              <ul v-if="atts.length" class="hf-list">
                <li v-for="(f, i) in atts" :key="f.name + f.size">
                  <span :class="['hf-ty', { img: isImage(f) }]">{{ isImage(f) ? '图片' : '文档' }}</span>
                  <span class="hf-n" :title="f.name">{{ f.name }}</span>
                  <span class="hf-meta">{{ sizeText(f.size) }}</span>
                  <button type="button" aria-label="移除" @click="removeAtt(i)">×</button>
                </li>
              </ul>
            </div>
            <div v-if="attError" class="hf-err">{{ attError }}</div>
          </div>

          <div :class="['hf-step', { done: text.trim() }]">
            <div class="hf-k"><span class="hf-no">{{ text.trim() ? '✓' : '03' }}</span><b>{{ bp ? '补充说明' : '项目介绍' }}</b><em>{{ bp ? '可选' : '没有 BP 时必填' }}</em></div>
            <div :class="['hf-panel', 'text', { has: text.trim() }]">
              <textarea v-model="text" :placeholder="bp ? 'BP 里没写、但你希望我们知道的：最新收入、在谈的客户、团队变动……' : '公司做什么、客户是谁、收入多少、本轮融多少。写得越具体，报告越准。'" />
              <div class="hf-count">{{ text.trim().length }} 字</div>
            </div>
          </div>
        </div>

        <div class="hf-foot">
          <p><Icon name="shield" />材料只用于生成本份报告。原文件不落盘，提取出的文字随报告保存，删除报告即一并删除。</p>
          <div class="hf-act">
            <span v-if="!canSubmit && !submitting" class="hf-need">先上传 BP，或填写项目介绍</span>
            <button class="hf-go" :disabled="!canSubmit" @click="submit">
              {{ submitting ? (imageCount ? '读取材料中（图片逐字识别中）…' : '读取材料中…') : '开始体检' }}<span v-if="!submitting">→</span>
            </button>
          </div>
        </div>
        <div v-if="error" class="err" style="margin:14px 0 0">{{ error }}</div>
      </section>

      <div class="h-orn" aria-hidden="true"><i /><b /><i /></div>

      <section class="h-method" aria-label="方法">
        <div class="h-sec"><span>Methodology</span><h2>我们怎么读一份 BP</h2></div>
        <ol>
          <li v-for="(m, i) in METHOD" :key="m.t"><b>0{{ i + 1 }}</b><h3>{{ m.t }}</h3><p>{{ m.d }}</p></li>
        </ol>
      </section>

      <div class="h-orn" aria-hidden="true"><i /><b /><i /></div>

      <section id="reports" class="h-reports" aria-label="我的报告">
        <div class="h-sec"><span>Reports</span><h2>我的报告</h2><em v-if="reports.length">共 {{ reports.length }} 份</em></div>
        <div v-if="listError" class="err">{{ listError }}</div>
        <div v-else-if="loaded && !reports.length" class="h-empty">还没有报告。上传一份 BP，几分钟后在这里打开。</div>
        <div v-else class="h-table">
          <div class="h-tr h-th"><span>项目</span><span>材料</span><span>总分</span><span>状态</span><span>生成时间</span></div>
          <router-link v-for="r in reports" :key="r.id" :to="`/consult/bp/reports/${r.id}`" class="h-tr">
            <span class="h-proj"><b>{{ r.company || r.filename }}</b><small v-if="r.company">{{ r.filename }}</small><small v-if="r.error" class="h-errline">{{ r.error }}</small></span>
            <span class="h-mat">BP<template v-if="r.attachments?.length"> + {{ r.attachments.length }} 份</template></span>
            <span class="h-score"><template v-if="r.score !== null"><b>{{ r.score }}</b><i :class="`d${BAND_NO[r.band || ''] || 0}`">{{ r.band }}</i></template><template v-else><em>—</em></template></span>
            <span><em :class="['st', r.status]">{{ STATUS_TEXT[r.status] || r.status }}</em></span>
            <span class="h-time">{{ fmtDate(r.created_at) }}<small>{{ fmtTime(r.created_at) }}</small></span>
          </router-link>
        </div>
      </section>
    </main>

    <footer class="h-foot"><div class="h-in"><span>报告基于 BP 原文与公开网页检索生成，结论供决策参考，不构成投资建议。标「出处里没有」「待核实」的内容使用前请自行核实。</span></div></footer>
  </div>
</template>
