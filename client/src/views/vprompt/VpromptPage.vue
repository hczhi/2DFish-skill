<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick, h, type FunctionalComponent } from 'vue'
import SiteHeader from '../../components/common/SiteHeader.vue'
import { api } from '../../lib/api'

// 视频提示词优化：贴提示词 + 选时长（风格 / 题材 / 镜头都可不选）→ 诊断 / 镜头拆分 / 新提示词。
// 单页、不存历史，用完就走。选项表从 /api/vprompt/options 取，前端不另存一份
// （下面的 STYLE_LOOK 只是每个风格卡片的配色，不是选项本身）。

interface Opt { id: string; label: string }
interface Cam { id: string; category: string; name: string; mood: string; shot: string; angle: string; move: string; desc: string; use: string }
interface Issue { quote: string; problem: string; fix: string }
interface Shot {
  start: number; end: number; name: string; shotSize: string; focal: string; camera: string
  template: { id: string; name: string; category: string } | null
  content: string; transition: string
}
interface TimedLine { start: number; end: number; name: string; text: string }
interface Final {
  title: string; overview: string; lock: string
  camera: TimedLine[]; scene: string[]; blocking: TimedLine[]; action: TimedLine[]; chain: string[]; objects: string[]; sound: string[]
}
interface Result {
  seconds: number
  approach: { style: { label: string; by: 'user' | 'ai' }; genre: string; packs: { label: string; reason: string }[] }
  must: Issue[]; suggest: Issue[]; shots: Shot[]; final: Final; fullText: string; notes: string[]
}

const STYLE_LOOK: Record<string, string> = {
  auto: 'linear-gradient(135deg, #3a3f52, #1b1e29)',
  realistic: 'linear-gradient(135deg, #c79a6b, #3b2a1d)',
  cg3d: 'linear-gradient(135deg, #6fd3ff, #7a5cff)',
  guoman: 'linear-gradient(135deg, #e8c27a, #a33a2b)',
  anime: 'linear-gradient(135deg, #ffb3d1, #7ec8ff)',
  painterly: 'linear-gradient(135deg, #d9a35b, #4a6b5a)',
  cyberpunk: 'linear-gradient(135deg, #ff2fa0, #00e1ff)',
  semireal: 'linear-gradient(135deg, #cdbfae, #5a5149)',
}
// 「物：…」「镜头：A → B」这类条目把冒号前的短标题加粗；冒号太靠后的说明它是正文里的冒号，不拆。
const HeadText: FunctionalComponent<{ text: string }> = ({ text }) => {
  const i = text.search(/[：:]/)
  return i > 0 && i <= 12 ? [h('b', text.slice(0, i + 1)), text.slice(i + 1)] : text
}
const SHOT_COLORS = ['#ff8a3d', '#ffc23d', '#5ad1a4', '#4fa8ff', '#a98bff', '#ff6f91', '#7ee0e0', '#c2d94f']

const EXAMPLES = [
  { tag: '雨中奔跑', text: '大雨里一个男人在马路上奔跑，衣服全湿了，他很着急，跑到公交站时车刚好开走，他很失望。' },
  { tag: '天台告白', text: '男生在天台上向女生表白，女生很惊讶，犹豫了一下，然后笑着点头，风吹起她的头发。' },
  { tag: '咖啡馆日常', text: '早上的咖啡馆，店员在做拉花，一个顾客推门进来，店员抬头对他微笑，阳光很好。' },
]
const STEPS = ['理解题材、风格与人物', '逐句诊断表情、动作、物体', '按时长拆分镜头与切换', '写完整提示词']
// 服务端最坏是「一次 180 秒 + 时间段不对重排一次 180 秒」；超过这个数一定是连接断了而前端没收到。
const CLIENT_TIMEOUT_MS = 400_000

const styles = ref<Opt[]>([])
const genres = ref<Opt[]>([])
const cams = ref<Cam[]>([])
const maxCams = ref(3)
const optError = ref('')

const prompt = ref('')
const seconds = ref(8)
const style = ref('auto')
const genre = ref('auto')
const picked = ref<string[]>([])
const drawer = ref(false)
const camCat = ref('')

const loading = ref(false)
const elapsed = ref(0)
const error = ref('')
const result = ref<Result | null>(null)
const copied = ref('')
const activeShot = ref(-1)
const resultEl = ref<HTMLElement | null>(null)
let timer: ReturnType<typeof setInterval> | null = null

const categories = computed(() => [...new Set(cams.value.map((c) => c.category))])
const camsInCat = computed(() => cams.value.filter((c) => c.category === camCat.value))
const camById = (id: string) => cams.value.find((c) => c.id === id)
// 进度是按经验耗时估的（界面上写明「预计」），不是服务端回报的真实进度。
const stepAt = computed(() => Math.min(STEPS.length - 1, Math.floor(elapsed.value / 13)))
const progress = computed(() => Math.min(95, Math.round(100 * (1 - Math.exp(-elapsed.value / 40)))))
const tab = ref<'final' | 'timeline' | 'diag'>('timeline')
const styleLabel = computed(() => styles.value.find((s) => s.id === style.value)?.label || '不指定')

onMounted(async () => {
  try {
    const res = await api('/api/vprompt/options')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const d = await res.json()
    styles.value = d.styles
    genres.value = d.genres
    cams.value = d.cameras
    maxCams.value = d.maxCameras
    camCat.value = d.cameras[0]?.category || ''
  } catch (e: any) {
    // 选项拿不到时照样能用（全按「不指定」），但要说出来，不然他以为这页就没有这些选择。
    optError.value = `风格 / 题材 / 镜头选项没加载出来（${e?.message || e}），现在只能按「不指定」优化。刷新页面可重试。`
  }
})
// 滚动时让工具条上的标签跟着当前看到的那一节走
function onScroll() {
  if (!result.value) return
  for (const k of ['diag', 'final', 'timeline'] as const) {
    const el = document.getElementById(`r-${k}`)
    if (el && el.getBoundingClientRect().top < 180) {
      tab.value = k
      return
    }
  }
  tab.value = 'timeline'
}
onMounted(() => {
  // capture：页面实际在哪个元素上滚（window / body）因布局而异，挂在 document 上都能收到
  document.addEventListener('scroll', onScroll, { passive: true, capture: true })
  window.addEventListener('resize', onScroll)
})
onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
  document.removeEventListener('scroll', onScroll, { capture: true })
  window.removeEventListener('resize', onScroll)
})

function toggleCam(id: string) {
  const i = picked.value.indexOf(id)
  if (i >= 0) picked.value.splice(i, 1)
  else if (picked.value.length < maxCams.value) picked.value.push(id)
}

async function run() {
  if (!prompt.value.trim() || loading.value) return
  loading.value = true
  error.value = ''
  result.value = null
  copied.value = ''
  elapsed.value = 0
  timer = setInterval(() => elapsed.value++, 1000)
  const ctrl = new AbortController()
  const kill = setTimeout(() => ctrl.abort(), CLIENT_TIMEOUT_MS)
  try {
    const res = await api('/api/vprompt/optimize', {
      method: 'POST',
      signal: ctrl.signal,
      body: JSON.stringify({ prompt: prompt.value, seconds: seconds.value, style: style.value, genre: genre.value, cameras: picked.value }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || `请求失败（HTTP ${res.status}）`)
    result.value = data
    tab.value = 'timeline'
    await nextTick()
    resultEl.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  } catch (e: any) {
    error.value =
      e?.name === 'AbortError'
        ? `等了 ${Math.round(CLIENT_TIMEOUT_MS / 60000)} 分钟还没有返回 —— 服务端那边最长也就 6 分钟，多半是连接中途断了（比如服务重启）。这次没有扣任何次数，直接再点一次即可。`
        : e?.message || String(e)
  } finally {
    clearTimeout(kill)
    if (timer) clearInterval(timer)
    timer = null
    loading.value = false
  }
}

const t = (n: number) => String(Math.round(n * 10) / 10)
const pct = (s: Shot) => (result.value ? ((s.end - s.start) / result.value.seconds) * 100 : 0)

function goTab(k: 'final' | 'timeline' | 'diag') {
  tab.value = k
  document.getElementById(`r-${k}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function goShot(i: number) {
  activeShot.value = i
  document.getElementById(`shot-${i}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

async function copy(text: string, key: string) {
  try {
    await navigator.clipboard.writeText(text)
    copied.value = key
    setTimeout(() => copied.value === key && (copied.value = ''), 2000)
  } catch {
    copied.value = 'fail'
  }
}
</script>

<template>
  <div class="vp">


    <!-- 头图：压成一条，工作台要在第一屏里 -->
    <section class="hero">
      <div class="hero-in">
        <div class="hero-l">
        
          <h1>视频提示词<em>优化</em></h1>
          <p class="lead">让提示词变成视频模型听得懂的分镜规格书。</p>
        </div>
        <ol class="flow">
          <li><b>01</b><span>贴上提示词</span></li>
          <li><b>02</b><span>选时长 · 风格 · 镜头</span></li>
          <li><b>03</b><span>拿到完整提示词</span></li>
        </ol>
      </div>
    </section>

    <main class="desk">
      <!-- 左：输入 -->
      <aside class="panel">
        <section class="sec">
          <header class="sec-h"><span class="no">1</span>你的提示词<span class="count">{{ prompt.length }} / 4000</span></header>
          <textarea v-model="prompt" rows="6" maxlength="4000" placeholder="把你写给视频模型的那段描述贴进来，一句话也行。" />
          <div class="examples">
            <span>试试</span>
            <button v-for="e in EXAMPLES" :key="e.tag" class="ex" @click="prompt = e.text">{{ e.tag }}</button>
          </div>
        </section>

        <section class="sec">
          <header class="sec-h"><span class="no">2</span>时长</header>
          <div class="seg">
            <button v-for="n in 7" :key="n" :class="{ on: seconds === n + 3 }" @click="seconds = n + 3">{{ n + 3 }}<small>s</small></button>
          </div>
        </section>

        <section class="sec">
          <header class="sec-h"><span class="no">3</span>风格<span class="hint">可不选</span></header>
          <div class="styles">
            <button
              v-for="s in styles"
              :key="s.id"
              :class="['sty', { on: style === s.id }]"
              :style="{ background: STYLE_LOOK[s.id] || STYLE_LOOK.auto }"
              @click="style = s.id"
            >
              <span>{{ s.id === 'auto' ? '不指定' : s.label }}</span>
            </button>
          </div>
        </section>

        <section class="sec">
          <header class="sec-h"><span class="no">4</span>题材<span class="hint">可不选</span></header>
          <div class="chips">
            <button v-for="g in genres" :key="g.id" :class="['chip', { on: genre === g.id }]" @click="genre = g.id">
              {{ g.id === 'auto' ? '不指定' : g.label }}
            </button>
          </div>
        </section>

        <section v-if="cams.length" class="sec">
          <header class="sec-h"><span class="no">5</span>镜头视角<span class="hint">{{ picked.length }} / {{ maxCams }} · 可不选</span></header>
          <div class="picked">
            <span v-for="id in picked" :key="id" class="pk" @click="toggleCam(id)">
              <b>{{ id }}</b>{{ camById(id)?.name }}<i>✕</i>
            </span>
            <button class="add" @click="drawer = true">{{ picked.length ? '调整' : '从 51 式运镜里挑' }} →</button>
          </div>
        </section>

        <p v-if="optError" class="err">{{ optError }}</p>

        <div class="go-wrap">
          <button class="go" :disabled="!prompt.trim() || loading" @click="run">
            <template v-if="loading"><span class="spin"></span>生成中 · {{ elapsed }}s</template>
            <template v-else>开始优化</template>
          </button>
          <p v-if="error" class="err">{{ error }}</p>
        </div>
      </aside>

      <!-- 右：输出 -->
      <section ref="resultEl" class="out">
        <!-- 空态 -->
        <div v-if="!result && !loading" class="empty">
          <div class="empty-art" aria-hidden="true">
            <i v-for="n in 4" :key="n" :style="{ background: SHOT_COLORS[n - 1], flex: [3, 2, 2, 3][n - 1] }"></i>
          </div>
          <p class="empty-t">左边填好，点「开始优化」</p>
          <p class="empty-s">结果按这个顺序出来：</p>
          <ol class="empty-l">
            <li><b>分镜时间轴</b>每个镜头几秒到几秒、景别焦段、用了哪一式运镜、怎么切过去</li>
            <li><b>完整提示词</b>一整段，按镜头 / 场景 / 动作 / 物体 / 声音分栏，时间标注写在里面，一键复制</li>
            <li><b>提示词建议</b>没写进新提示词、留给你决定要不要改的地方</li>
          </ol>
        </div>

        <!-- 生成中 -->
        <div v-if="loading" class="busy">
          <div class="busy-top">
            <span class="spin dark"></span>
            <b>{{ STEPS[stepAt] }}…</b>
            <span class="busy-t">已用 {{ elapsed }}s · 通常 40–90 秒</span>
          </div>
          <div class="bar"><i :style="{ width: progress + '%' }"></i></div>
          <ol class="steps">
            <li v-for="(st, i) in STEPS" :key="st" :class="{ done: i < stepAt, now: i === stepAt }">
              <span class="dot">{{ i < stepAt ? '✓' : i + 1 }}</span>{{ st }}
            </li>
          </ol>
          <p class="busy-n">进度条是按平常耗时估的，不是实时进度；这一步免费，失败了直接再点一次。</p>
        </div>

        <template v-if="result">
          <!-- 工具条 -->
          <div class="bar-top">
            <nav class="tabs">
              <button :class="{ on: tab === 'timeline' }" @click="goTab('timeline')">分镜时间轴<small>{{ result.shots.length }}</small></button>
              <button :class="{ on: tab === 'final' }" @click="goTab('final')">完整提示词</button>
              <button :class="{ on: tab === 'diag' }" @click="goTab('diag')">提示词建议<small>{{ result.suggest.length }}</small></button>
            </nav>
            <button class="copy-all" @click="copy(result.fullText, 'all')">{{ copied === 'all' ? '已复制 ✓' : '复制完整提示词' }}</button>
          </div>
          <p v-if="copied === 'fail'" class="err">复制失败（浏览器没给剪贴板权限），请手动选中复制。</p>

          <div class="meta">
            <span class="m"><i>风格</i>{{ result.approach.style.label || '未说明' }}<em>{{ result.approach.style.by === 'user' ? '你选的' : 'AI 判断' }}</em></span>
            <span class="m"><i>时长</i>{{ result.seconds }} 秒 · {{ result.shots.length }} 个镜头</span>
            <span v-for="p in result.approach.packs" :key="p.label" class="m"><i>规范</i>{{ p.label }}<em>{{ p.reason }}</em></span>
            <span v-if="!result.approach.packs.length" class="m"><i>规范</i>通用<em>没选题材，原文里也没看出特定题材</em></span>
          </div>
          <p v-for="n in result.notes" :key="n" class="warn">⚠ {{ n }}</p>

          <!-- 1 分镜时间轴 -->
          <section id="r-timeline" class="part">
            <h2 class="part-h">分镜时间轴<span>点一段，下面完整提示词里对应的那几行会高亮</span></h2>
            <div class="timeline">
              <button
                v-for="(s, i) in result.shots"
                :key="s.start"
                :class="['tl-seg', { on: activeShot === i }]"
                :style="{ width: pct(s) + '%', '--c': SHOT_COLORS[i % SHOT_COLORS.length] }"
                @click="goShot(i)"
              >
                <span class="tl-time">{{ t(s.start) }}–{{ t(s.end) }}s</span>
                <span class="tl-name">{{ s.name }}</span>
                <span class="tl-spec">{{ s.shotSize }} · {{ s.focal }}</span>
              </button>
            </div>
            <div class="ruler">
              <span v-for="n in result.seconds + 1" :key="n" :style="{ left: ((n - 1) / result.seconds) * 100 + '%' }">{{ n - 1 }}s</span>
            </div>
            <div class="cuts">
              <div v-for="(s, i) in result.shots" :key="s.start" :class="['cut', { on: activeShot === i }]" @click="goShot(i)">
                <i :style="{ background: SHOT_COLORS[i % SHOT_COLORS.length] }"></i>
                <div class="cut-main">
                  <p class="cut-top">
                    <b>{{ s.name }}</b>
                    <span class="cut-t">{{ i === 0 ? '开场' : s.transition }}</span>
                    <span v-if="s.template" :class="['tpl', { mine: picked.includes(s.template.id) }]">{{ s.template.id }} {{ s.template.name }}</span>
                  </p>
                  <p class="cut-c">{{ s.content }}</p>
                  <p class="cut-cam">{{ s.camera }}</p>
                </div>
              </div>
            </div>
          </section>

          <!-- 2 完整提示词 -->
          <section id="r-final" class="part">
            <article class="doc">
              <header class="doc-h">
                <span class="doc-time">0–{{ result.seconds }}s</span>
                <h2>{{ result.final.title }}</h2>
              </header>
              <div v-if="result.final.overview || result.final.lock" class="doc-lead">
                <p v-if="result.final.overview"><b>画面总述</b>{{ result.final.overview }}</p>
                <p v-if="result.final.lock"><b>人物与风格锁定</b>{{ result.final.lock }}</p>
              </div>

              <h3>【镜头·运镜】</h3>
              <ul>
                <li
                  v-for="(c, i) in result.final.camera"
                  :id="`shot-${i}`"
                  :key="'c' + i"
                  :class="{ on: activeShot === i }"
                  :style="{ '--c': SHOT_COLORS[i % SHOT_COLORS.length] }"
                >
                  <b class="tm">{{ t(c.start) }}s {{ c.name }}</b>：{{ c.text }}
                </li>
              </ul>

              <template v-if="result.final.scene.length">
                <h3>【场景·道具】</h3>
                <ul><li v-for="(x, i) in result.final.scene" :key="'s' + i"><HeadText :text="x" /></li></ul>
              </template>

              <h3>【空间·站位】</h3>
              <ul>
                <li
                  v-for="(b, i) in result.final.blocking"
                  :key="'b' + i"
                  :class="{ on: activeShot === i }"
                  :style="{ '--c': SHOT_COLORS[i % SHOT_COLORS.length] }"
                >
                  <b class="tm">{{ t(b.start) }}–{{ t(b.end) }}s {{ b.name }}</b>：{{ b.text }}
                </li>
              </ul>

              <h3>【动作·神情】</h3>
              <p class="para">
                <span
                  v-for="(a, i) in result.final.action"
                  :key="'a' + i"
                  :class="{ on: activeShot === i }"
                  :style="{ '--c': SHOT_COLORS[i % SHOT_COLORS.length] }"
                >
                  <b class="tm">（{{ t(a.start) }}–{{ t(a.end) }}s）{{ a.name }}</b>：{{ a.text }}
                </span>
              </p>

              <template v-if="result.final.chain.length">
                <h3>【环境连锁反应】</h3>
                <ul><li v-for="(x, i) in result.final.chain" :key="'h' + i"><HeadText :text="x" /></li></ul>
              </template>
              <template v-if="result.final.objects.length">
                <h3>【运动物体】</h3>
                <ul><li v-for="(x, i) in result.final.objects" :key="'o' + i"><HeadText :text="x" /></li></ul>
              </template>
              <template v-if="result.final.sound.length">
                <h3>【声音】</h3>
                <ul><li v-for="(x, i) in result.final.sound" :key="'d' + i"><HeadText :text="x" /></li></ul>
              </template>
            </article>
          </section>

          <!-- 3 提示词建议（必改项已写进完整提示词，这里只列没写进去的） -->
          <section id="r-diag" class="part">
            <h2 class="part-h">提示词建议<span>{{ result.suggest.length }} 条 · 必改的 {{ result.must.length }} 处已写进完整提示词</span></h2>
            <p v-if="!result.suggest.length" class="muted">没有额外建议。</p>
            <div class="issues">
              <div
                v-for="(x, i) in result.suggest"
                :key="i"
                class="issue"
              >
                <div class="iss-l">
                  <span class="lv">建议</span>
                  <p v-if="x.quote" class="q">{{ x.quote }}</p>
                  <p class="pb">{{ x.problem }}</p>
                </div>
                <div class="iss-r"><span>可以改成</span>{{ x.fix }}</div>
              </div>
            </div>
          </section>
        </template>
      </section>
    </main>

    <!-- 镜头抽屉 -->
    <transition name="fade">
      <div v-if="drawer" class="mask" @click.self="drawer = false">
        <div class="drawer">
          <header class="dr-head">
            <div>
              <h3>挑选镜头视角</h3>
              <p>最多 {{ maxCams }} 个，AI 会把它们放进最合适的那一段；不选就由 AI 按画面挑。</p>
            </div>
            <button class="close" @click="drawer = false">完成（{{ picked.length }}）</button>
          </header>
          <div class="cats">
            <button v-for="c in categories" :key="c" :class="['cat', { on: c === camCat }]" @click="camCat = c">
              {{ c }}<i v-if="picked.some((id) => camById(id)?.category === c)"></i>
            </button>
          </div>
          <div class="cam-grid">
            <button
              v-for="c in camsInCat"
              :key="c.id"
              :class="['cam', { on: picked.includes(c.id), off: !picked.includes(c.id) && picked.length >= maxCams }]"
              @click="toggleCam(c.id)"
            >
              <div class="cam-top">
                <b>{{ c.id }}</b>
                <span class="cam-n">{{ c.name }}</span>
                <span class="tick">{{ picked.includes(c.id) ? '✓' : '+' }}</span>
              </div>
              <p class="cam-mood">{{ c.mood }}</p>
              <p class="cam-spec">{{ c.shot }} · {{ c.angle }} · {{ c.move }}</p>
              <p class="cam-desc">{{ c.desc }}</p>
              <p v-if="c.use !== c.mood" class="cam-use">适用：{{ c.use }}</p>
            </button>
          </div>
        </div>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.vp {
  --ink: #1D2129;
  --paper: #F2F3F5;
  --card: #FFFFFF;
  --line: #E5E6EB;
  --text: #4E5969;
  --mute: #86909C;
  --amber: #FFB800;
  --amber-light: #FFF7E8;
  --coral: #F53F3F;
  --mono: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, Courier, monospace;
  min-height: 100vh; background: var(--paper); color: var(--ink);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji";
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
button { font: inherit; color: inherit; transition: all 0.2s cubic-bezier(0.34, 0.69, 0.1, 1); }
button:active:not(:disabled) { transform: scale(0.98); }
.muted { color: var(--mute); font-size: 13px; }

/* ── 头图 ── */
.hero { 
  background: #FFFFFF; 
  color: var(--ink); 
  padding: 80px 32px 32px; 
  border-bottom: 1px solid var(--line); 
  margin-bottom: 24px;
}
.hero-in { max-width: 1360px; margin: 0 auto; display: flex; align-items: flex-end; justify-content: space-between; gap: 32px; flex-wrap: wrap; }
.badges { display: flex; gap: 8px; margin-bottom: 20px; }
.badges span { padding: 4px 10px; border-radius: 4px; font-size: 12px; font-weight: 500; background: var(--paper); color: var(--text); border: none; }
.hero h1 { margin: 0; font-size: clamp(32px, 4vw, 44px); font-weight: 700; letter-spacing: -0.02em; line-height: 1.2; }
.hero h1 em { font-style: normal; color: #D97706; }
.lead { margin: 12px 0 0; font-size: 15px; color: var(--text); max-width: 540px; line-height: 1.6; }
.flow { display: flex; gap: 12px; margin: 0; padding: 0; list-style: none; }
.flow li { display: flex; flex-direction: column; gap: 4px; min-width: 140px; padding: 16px; border-radius: 8px; background: #F7F8FA; border: 1px solid var(--line); font-size: 13px; color: var(--text); }
.flow b { font-family: var(--mono); color: var(--ink); font-size: 14px; font-weight: 600; }

/* ── 工作台 ── */
.desk { max-width: 1360px; margin: 0 auto; padding: 0 32px 80px; display: grid; grid-template-columns: 360px minmax(0, 1fr); gap: 20px; align-items: start; }
.panel {
  position: sticky; top: 70px; max-height: calc(100vh - 90px); overflow-y: auto;
  background: var(--card); border-radius: 8px; border: 1px solid var(--line); box-shadow: 0 2px 5px rgba(0,0,0,0.02);
}
.panel::-webkit-scrollbar { display: none; }
.sec { padding: 20px; border-top: 1px solid var(--line); }
.sec:first-child { border-top: none; }
.sec-h { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; font-size: 14px; font-weight: 600; color: var(--ink); }
.no { display: inline-grid; place-items: center; width: 20px; height: 20px; border-radius: 4px; background: var(--paper); color: var(--text); font-size: 12px; font-family: var(--mono); font-weight: 600; }
.count, .hint { margin-left: auto; font-size: 12px; font-weight: normal; color: var(--mute); }
textarea {
  width: 100%; box-sizing: border-box; border: 1px solid transparent; border-radius: 6px; padding: 12px 14px;
  font: inherit; font-size: 14px; line-height: 1.6; resize: vertical; background: var(--paper); transition: all .2s; color: var(--ink);
}
textarea:focus { outline: none; background: #FFF; border-color: var(--amber); box-shadow: 0 0 0 2px rgba(255, 184, 0, 0.15); }
textarea::placeholder { color: var(--mute); }
.examples { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 12px; font-size: 12px; color: var(--mute); }
.ex { padding: 4px 10px; border-radius: 4px; border: 1px solid var(--line); background: #FFF; font-size: 12px; cursor: pointer; color: var(--text); }
.ex:hover { background: var(--paper); color: var(--ink); }

.seg { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; background: var(--paper); border-radius: 6px; padding: 4px; }
.seg button { border: none; background: transparent; padding: 6px 0; border-radius: 4px; cursor: pointer; font-weight: 500; font-size: 14px; color: var(--text); font-family: var(--mono); transition: all .15s; }
.seg button small { font-size: 10px; margin-left: 2px; opacity: .8; }
.seg button.on { background: var(--card); color: var(--ink); box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08); font-weight: 600; }

.styles { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.sty { position: relative; height: 50px; border: 1px solid var(--line); border-radius: 6px; cursor: pointer; overflow: hidden; text-align: left; }
.sty::after { content: ''; position: absolute; inset: 0; background: linear-gradient(transparent 30%, rgba(0,0,0,.6)); }
.sty span { position: absolute; left: 8px; right: 8px; bottom: 6px; z-index: 1; color: #fff; font-size: 12px; font-weight: 500; line-height: 1.2; }
.sty.on { box-shadow: 0 0 0 2px var(--amber); border-color: transparent; }

.chips { display: flex; flex-wrap: wrap; gap: 8px; }
.chip { padding: 6px 12px; border-radius: 4px; border: 1px solid transparent; background: var(--paper); cursor: pointer; font-size: 13px; font-weight: normal; color: var(--text); }
.chip:hover { background: #E5E6EB; }
.chip.on { background: var(--amber-light); border-color: var(--amber); color: #D97706; font-weight: 500; }

.picked { display: flex; flex-wrap: wrap; gap: 8px; }
.pk { display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; border-radius: 4px; background: var(--amber-light); border: 1px solid var(--amber); font-size: 13px; font-weight: normal; cursor: pointer; color: #D97706; }
.pk b { font-family: var(--mono); font-size: 12px; }
.pk i { font-style: normal; font-size: 11px; opacity: .5; }
.add { padding: 6px 12px; border-radius: 4px; border: 1px dashed var(--mute); background: transparent; cursor: pointer; font-size: 13px; font-weight: normal; color: var(--text); }
.add:hover { border-color: var(--amber); color: var(--amber); }

.go-wrap { position: sticky; bottom: 0; padding: 16px 20px; background: #FFFFFF; border-top: 1px solid var(--line); border-radius: 0 0 8px 8px; }
.go {
  width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 10px; border: none; border-radius: 6px;
  background: var(--amber); color: #1D2129; font-weight: 600; font-size: 15px; cursor: pointer; transition: all .15s;
}
.go:hover:not(:disabled) { background: #FFC53D; }
.go:disabled { cursor: not-allowed; opacity: .6; filter: grayscale(1); }
.spin { width: 14px; height: 14px; border-radius: 50%; border: 2px solid rgba(29, 33, 41, .2); border-top-color: #1D2129; animation: rot .8s linear infinite; flex: none; }
.spin.dark { border-color: rgba(0,0,0,.12); border-top-color: var(--amber); }
@keyframes rot { to { transform: rotate(360deg); } }
.err { margin: 12px 0 0; padding: 10px 12px; border-radius: 6px; background: #FFECE8; color: var(--coral); font-size: 13px; line-height: 1.5; white-space: pre-line; }
.panel > .err { margin: 0 20px; }
.warn { margin: 12px 0 0; color: var(--coral); font-size: 13px; }

/* ── 输出区 ── */
.out { min-width: 0; min-height: 560px; background: var(--card); border-radius: 8px; border: 1px solid var(--line); box-shadow: 0 2px 5px rgba(0,0,0,0.02); padding: 0 24px 32px; scroll-margin-top: 70px; }

.empty { padding: 80px 20px 40px; max-width: 560px; margin: 0 auto; text-align: center; }
.empty-art { display: flex; justify-content: center; gap: 6px; height: 48px; margin-bottom: 24px; }
.empty-art i { border-radius: 6px; opacity: .8; width: 40px; }
.empty-t { margin: 0 0 8px; font-size: 18px; font-weight: 600; color: var(--ink); }
.empty-s { margin: 0 0 24px; color: var(--mute); font-size: 14px; }
.empty-l { margin: 0; padding: 0; list-style: none; counter-reset: e; display: grid; gap: 12px; text-align: left; }
.empty-l li { counter-increment: e; position: relative; padding: 12px 16px 12px 48px; border-radius: 6px; background: #F7F8FA; font-size: 13px; line-height: 1.6; color: var(--text); border: 1px solid var(--line); }
.empty-l li::before { content: counter(e); position: absolute; left: 16px; top: 14px; width: 20px; height: 20px; display: grid; place-items: center; border-radius: 4px; background: #E5E6EB; color: var(--text); font-family: var(--mono); font-size: 12px; font-weight: 600; }
.empty-l b { display: block; color: var(--ink); font-size: 14px; font-weight: 600; margin-bottom: 2px; }

.busy { padding: 80px 20px; max-width: 560px; margin: 0 auto; }
.busy-top { display: flex; align-items: center; gap: 10px; font-size: 16px; font-weight: 600; }
.busy-t { margin-left: auto; font-size: 12px; color: var(--mute); font-family: var(--mono); }
.bar { height: 4px; margin-top: 16px; border-radius: 999px; background: var(--paper); overflow: hidden; }
.bar i { display: block; height: 100%; border-radius: inherit; background: var(--amber); transition: width 1s linear; }
.steps { margin: 24px 0 0; padding: 0; list-style: none; display: grid; gap: 12px; }
.steps li { display: flex; align-items: center; gap: 12px; font-size: 14px; font-weight: normal; color: var(--mute); }
.steps .dot { width: 22px; height: 22px; display: grid; place-items: center; border-radius: 50%; background: var(--paper); font-size: 12px; font-weight: 600; font-family: var(--mono); color: var(--mute); }
.steps li.done { color: var(--text); }
.steps li.done .dot { background: #E8FFEA; color: #00B42A; }
.steps li.now { color: var(--ink); font-weight: 600; }
.steps li.now .dot { background: var(--amber); color: #1D2129; }
.busy-n { margin: 24px 0 0; font-size: 13px; color: var(--mute); line-height: 1.5; }

.bar-top {
  position: sticky; top: 50px; z-index: 5; display: flex; align-items: center; justify-content: space-between; gap: 16px;
  margin: 0 -24px; padding: 12px 24px; background: rgba(255,255,255,.9); backdrop-filter: blur(8px); border-bottom: 1px solid var(--line); border-radius: 8px 8px 0 0;
}
.tabs { display: flex; gap: 2px; background: var(--paper); padding: 4px; border-radius: 6px; }
.tabs button { display: flex; align-items: center; gap: 6px; border: none; background: transparent; padding: 6px 16px; border-radius: 4px; cursor: pointer; font-size: 13px; font-weight: 500; color: var(--text); transition: all .15s; }
.tabs button.on { background: var(--card); color: var(--ink); box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08); font-weight: 600; }
.tabs small { min-width: 16px; padding: 0 4px; border-radius: 4px; background: #E5E6EB; font-size: 11px; font-family: var(--mono); text-align: center; color: var(--text); }
.tabs small.red { background: #FFECE8; color: var(--coral); }
.copy-all { padding: 6px 16px; border-radius: 4px; border: 1px solid var(--line); background: #FFF; color: var(--ink); font-size: 13px; font-weight: 500; cursor: pointer; white-space: nowrap; transition: background .15s; }
.copy-all:hover { background: var(--paper); }

.meta { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 20px; }
.m { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 4px; background: #F7F8FA; font-size: 13px; font-weight: normal; color: var(--text); }
.m i { font-style: normal; font-size: 12px; color: var(--mute); }
.m em { font-style: normal; font-size: 13px; color: var(--ink); }

.part { margin-top: 24px; scroll-margin-top: 120px; }
.part-h { display: flex; align-items: baseline; gap: 12px; margin: 0 0 16px; font-size: 16px; font-weight: 600; color: var(--ink); }
.part-h span { font-size: 12px; font-weight: normal; color: var(--mute); }

/* 完整提示词 */
.doc { padding: 24px 32px; border-radius: 8px; background: #F7F8FA; border: 1px solid var(--line); }
.doc-h { display: flex; align-items: baseline; gap: 12px; margin-bottom: 20px; }
.doc-h h2 { margin: 0; font-size: 18px; font-weight: 600; }
.doc-time { padding: 2px 8px; border-radius: 4px; background: var(--amber-light); border: 1px solid #FDE68A; color: #D97706; font-family: var(--mono); font-size: 12px; }
.doc-lead { padding: 12px 16px; border-left: 3px solid var(--amber); background: #FFFFFF; border-radius: 0 4px 4px 0; }
.doc-lead p { margin: 4px 0; font-size: 14px; line-height: 1.6; color: var(--text); }
.doc-lead b { margin-right: 8px; color: var(--ink); font-weight: 600; }
.doc h3 { margin: 24px 0 10px; font-size: 14px; font-weight: 600; color: var(--ink); }
.doc ul { margin: 0; padding-left: 1.5em; }
.doc li { margin: 6px 0; font-size: 14px; line-height: 1.6; color: var(--text); }
.doc li::marker { color: var(--mute); }
.doc li[id] { scroll-margin-top: 140px; border-radius: 4px; transition: background .3s; }
.doc li.on, .para span.on { background: color-mix(in srgb, var(--c, #FFB800) 15%, transparent); padding: 2px 4px; margin: 0 -4px; border-radius: 4px; }
.tm { color: var(--ink); font-weight: 600; }
.para { margin: 0; font-size: 14px; line-height: 1.8; color: var(--text); }
.para span { border-radius: 4px; padding: 2px 0; transition: background .3s; }

/* 时间轴 */
.timeline { display: flex; gap: 4px; padding: 8px; background: #FFFFFF; border: 1px solid var(--line); border-radius: 6px; }
.tl-seg {
  min-width: 0; text-align: left; padding: 8px 10px; border: none; border-radius: 4px; cursor: pointer;
  background: color-mix(in srgb, var(--c) 15%, transparent); transition: all .2s;
}
.tl-seg:hover, .tl-seg.on { background: color-mix(in srgb, var(--c) 25%, transparent); }
.tl-seg span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tl-time { font-family: var(--mono); font-size: 11px; color: var(--text); opacity: 0.8; }
.tl-name { margin-top: 4px; font-weight: 600; font-size: 13px; color: var(--ink); }
.tl-spec { margin-top: 2px; font-size: 12px; color: var(--mute); }
.ruler { position: relative; height: 16px; margin: 8px 6px 0; border-top: 1px solid var(--line); }
.ruler span { position: absolute; top: 4px; transform: translateX(-50%); font-size: 10px; color: var(--mute); font-family: var(--mono); }
.ruler span:first-child { transform: none; }
.ruler span:last-child { transform: translateX(-100%); }
.cuts { margin-top: 16px; display: flex; flex-direction: column; background: var(--card); border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
.cut { display: flex; gap: 16px; padding: 16px; border-bottom: 1px solid var(--line); background: transparent; cursor: pointer; transition: background .15s; }
.cut:last-child { border-bottom: none; }
.cut:hover, .cut.on { background: #F7F8FA; }
.cut > i { flex: none; width: 3px; border-radius: 2px; }
.cut-main { min-width: 0; flex: 1; }
.cut p { margin: 0; }
.cut-top { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 14px; }
.cut-top b { font-size: 14px; font-weight: 600; color: var(--ink); }
.cut-t { padding: 2px 8px; border-radius: 4px; background: var(--paper); font-size: 12px; color: var(--text); }
.tpl { padding: 2px 8px; border-radius: 4px; background: #F2F3F5; font-size: 12px; color: var(--text); }
.tpl.mine { background: var(--amber-light); color: #D97706; }
.cut-c { margin-top: 6px !important; font-size: 13px; line-height: 1.6; color: var(--ink); }
.cut-cam { margin-top: 4px !important; font-size: 12px; line-height: 1.6; color: var(--mute); }

/* 诊断 */
.issues { display: flex; flex-direction: column; background: var(--card); border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
.issue { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 24px; padding: 16px; border-bottom: 1px solid var(--line); }
.issue:last-child { border-bottom: none; }
.iss-l { padding: 0; }
.iss-r { padding: 0; color: var(--ink); font-size: 13px; line-height: 1.6; }
.iss-r span { display: block; margin-bottom: 4px; font-size: 12px; color: var(--mute); }
.lv { display: inline-flex; align-items: center; justify-content: center; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 500; }
.issue .lv { background: #E8FFEA; color: #00B42A; }
.iss-l p { margin: 0; }
.q { margin-top: 8px !important; font-size: 13px; color: var(--mute); text-decoration: line-through; }
.pb { margin-top: 6px !important; font-size: 13px; line-height: 1.6; color: var(--ink); }

/* ── 镜头抽屉 ── */
.mask { position: fixed; inset: 0; z-index: 100; background: rgba(29, 33, 41, .6); display: flex; justify-content: flex-end; }
.drawer { width: min(800px, 100%); height: 100%; background: var(--card); display: flex; flex-direction: column; box-shadow: -10px 0 20px rgba(0,0,0,.1); }
.dr-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 24px 32px 16px; border-bottom: 1px solid var(--line); }
.dr-head h3 { margin: 0 0 4px; font-size: 18px; font-weight: 600; color: var(--ink); }
.dr-head p { margin: 0; font-size: 13px; color: var(--mute); }
.close { flex: none; padding: 8px 16px; border-radius: 6px; border: none; background: #F2F3F5; color: var(--ink); cursor: pointer; font-size: 13px; transition: background .15s; }
.close:hover { background: #E5E6EB; }
.cats { display: flex; flex-wrap: wrap; gap: 8px; padding: 16px 32px; background: #F7F8FA; border-bottom: 1px solid var(--line); }
.cat { position: relative; padding: 4px 12px; border-radius: 4px; border: 1px solid var(--line); background: #FFF; cursor: pointer; font-size: 13px; color: var(--text); }
.cat.on { background: var(--amber-light); border-color: var(--amber); color: #D97706; }
.cat i { position: absolute; top: -2px; right: -2px; width: 6px; height: 6px; border-radius: 50%; background: var(--amber); }
.cam-grid { flex: 1; overflow-y: auto; padding: 24px 32px; display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; align-content: start; }
.cam { display: flex; flex-direction: column; justify-content: flex-start; text-align: left; padding: 16px; border-radius: 6px; border: 1px solid var(--line); background: #FFF; cursor: pointer; transition: all .15s; }
.cam:hover { border-color: #C9CDD4; box-shadow: 0 4px 10px rgba(0,0,0,0.05); transform: translateY(-1px); }
.cam.on { border-color: var(--amber); background: var(--amber-light); box-shadow: none; transform: none; }
.cam.off { opacity: .4; cursor: not-allowed; }
.cam p { margin: 0; }
.cam-top { display: flex; align-items: center; gap: 8px; }
.cam-top b { font-family: var(--mono); font-size: 12px; color: var(--mute); }
.cam-n { flex: 1; font-weight: 600; font-size: 14px; color: var(--ink); }
.tick { display: grid; place-items: center; width: 18px; height: 18px; border-radius: 4px; background: #F2F3F5; font-size: 11px; font-weight: bold; color: var(--mute); }
.cam.on .tick { background: var(--amber); color: #FFF; }
.cam-mood { margin-top: 6px !important; font-size: 12px; color: #D97706; }
.cam-spec { margin-top: 6px !important; font-size: 12px; color: var(--text); }
.cam-desc { margin-top: 8px !important; font-size: 12px; line-height: 1.5; color: var(--text); display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.cam-use { margin-top: 6px !important; font-size: 12px; color: var(--mute); }
.fade-enter-active, .fade-leave-active { transition: opacity .2s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

/* ── 响应式 ── */
@media (max-width: 1100px) {
  .desk { grid-template-columns: 1fr; }
  .panel { position: static; max-height: none; }
  .flow { display: none; }
}
@media (max-width: 720px) {
  .hero { padding: 80px 20px 24px; }
  .desk { padding: 0 16px 60px; }
  .out { padding: 0 16px 24px; }
  .bar-top { margin: 0 -16px; padding: 12px 16px; gap: 8px; }
  .tabs { flex: 1; min-width: 0; }
  .tabs button { flex: 1; justify-content: center; padding: 6px 4px; font-size: 12px; }
  .tabs small { display: none; }
  .copy-all { padding: 6px 10px; font-size: 12px; }
  .doc { padding: 16px; }
  .issue { grid-template-columns: 1fr; gap: 12px; padding: 16px; }
  .timeline { flex-direction: column; }
  .tl-seg { width: 100% !important; }
  .ruler { display: none; }
}
</style>
