<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import SiteHeader from '../../components/common/SiteHeader.vue'
import AppKeyModal from '../../components/common/AppKeyModal.vue'
import CardStage from '../../components/broll/CardStage.vue'
import { templateById, TEMPLATES, categoryOf } from '../../components/broll/templates'

const route = useRoute()
const router = useRouter()

// 同 PptCover：「开始使用」只管跳编辑器，有没有 key / 账号交给守卫判（没有时它送到 /broll/key，
// 那条路由带着 ?key=1 回到这里把弹窗打开）。
const keyOpen = ref(false)
watch(() => route.query.key, (v) => { keyOpen.value = !!v }, { immediate: true })
const q = (k: string) => (typeof route.query[k] === 'string' ? (route.query[k] as string) : undefined)
function onKeyModal(open: boolean) {
  keyOpen.value = open
  if (!open && route.query.key) router.replace({ path: '/broll' })
}

function go() {
  router.push('/broll/studio')
}

const Y = '#FFD028'

// 卡片都是真组件（各自第一组测试数据），强调色换成页面的黄。卡片改了样子这里跟着变。
function card(id: string, pad = 1.2) {
  const tp = templateById(id)
  if (!tp) return null
  const data = { ...tp.fixtures[0].data, accent: Y }
  return { tp, data: { ...data, duration: tp.minDuration(data) + pad } }
}
type Card = NonNullable<ReturnType<typeof card>>
const ok = <T,>(v: T | null): v is T => !!v

// 首屏：模拟一条口播，字幕走到哪句，那句的卡叠上来
const REEL = [
  { id: 'number', sub: '去年我们的营收，增长了 300%' },
  { id: 'list', sub: '做口播的这群人：口播博主、知识博主、企业号' },
  { id: 'barchart', sub: '抖音 120 万播放，视频号 45 万' },
  { id: 'chapter', sub: '第二部分，两项成本大幅下降' },
  { id: 'compare', sub: '同行平均增速 20%，我们是 300%' },
]
  .map((r) => {
    const c = card(r.id)
    return c ? { ...c, sub: r.sub } : null
  })
  .filter(ok)
const starts = REEL.reduce<number[]>((a, r, i) => [...a, i ? a[i - 1] + REEL[i - 1].data.duration : 0], [])
const total = REEL.reduce((n, r) => n + r.data.duration, 0)

// 卡片墙
const WALL = ['ring', 'ranking', 'timeline', 'quote', 'gauge', 'keyword', 'progress', 'steps'].map((id) => card(id, 1.6)).filter(ok)

// 透明导出那一段用的卡
const ALPHA = card('ring', 1.6)

// 一个时钟驱动全页
const clock = ref(0)
let raf = 0
let last = 0
function tick(now: number) {
  if (last) clock.value += Math.min(0.05, (now - last) / 1000)
  last = now
  raf = requestAnimationFrame(tick)
}
const reelT = computed(() => clock.value % total)
const reelIdx = computed(() => {
  for (let i = REEL.length - 1; i >= 0; i--) if (reelT.value >= starts[i]) return i
  return 0
})
const reel = computed(() => REEL[reelIdx.value])
const reelLocal = computed(() => reelT.value - starts[reelIdx.value])
function jump(i: number) {
  clock.value = Math.floor(clock.value / total) * total + starts[i] + 0.01
}
const loopT = (c: Card, offset = 0) => (clock.value + offset) % c.data.duration
const tc = computed(() => {
  const s = reelT.value
  const f = Math.floor((s % 1) * 25)
  return `00:00:${String(Math.floor(s)).padStart(2, '0')}:${String(f).padStart(2, '0')}`
})

// 滚动入场
const root = ref<HTMLElement>()
let io: IntersectionObserver | null = null
onMounted(() => {
  raf = requestAnimationFrame(tick)
  io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && e.target.classList.add('in')), { threshold: 0.15 })
  root.value?.querySelectorAll('.rv').forEach((el) => io!.observe(el))
})
onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  io?.disconnect()
})

const svgUrl = (svg: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(svg).replace(/'/g, '%27').replace(/\(/g, '%28').replace(/\)/g, '%29')}`

// 口播画面：一张内联 SVG（暗房间 + 人物剪影 + 轮廓光），不依赖网络
const SCENE = svgUrl(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1920 1080'>
<defs>
<radialGradient id='r' cx='70%' cy='35%' r='75%'><stop offset='0' stop-color='#3a3226'/><stop offset='.55' stop-color='#17140f'/><stop offset='1' stop-color='#0a0907'/></radialGradient>
<radialGradient id='k1' r='.5'><stop offset='0' stop-color='#ffd028' stop-opacity='.35'/><stop offset='1' stop-color='#ffd028' stop-opacity='0'/></radialGradient>
<radialGradient id='k2' r='.5'><stop offset='0' stop-color='#ffe9b0' stop-opacity='.22'/><stop offset='1' stop-color='#ffe9b0' stop-opacity='0'/></radialGradient>
<linearGradient id='p' x1='0' x2='1'><stop offset='0' stop-color='#26211b'/><stop offset='.8' stop-color='#1b1814'/><stop offset='1' stop-color='#4a3c22'/></linearGradient>
</defs>
<rect width='1920' height='1080' fill='url(#r)'/>
<circle cx='1640' cy='240' r='180' fill='url(#k1)'/><circle cx='1820' cy='520' r='120' fill='url(#k2)'/><circle cx='1180' cy='160' r='90' fill='url(#k2)'/>
<rect x='1700' y='600' width='150' height='480' rx='8' fill='#120f0c'/>
<path d='M1050 1080 C1060 860 1180 790 1340 770 L1420 770 C1580 790 1700 860 1710 1080 Z' fill='url(#p)'/>
<rect x='1330' y='640' width='100' height='150' rx='40' fill='#211c17'/>
<ellipse cx='1380' cy='520' rx='150' ry='185' fill='url(#p)'/>
<path d='M1525 430 C1545 500 1540 590 1510 650' stroke='#ffd028' stroke-opacity='.35' stroke-width='8' fill='none' stroke-linecap='round'/>
</svg>`)

// 透明底：棋盘格
const CHECKER = svgUrl(`<svg xmlns='http://www.w3.org/2000/svg' width='1920' height='1080'><defs><pattern id='c' width='64' height='64' patternUnits='userSpaceOnUse'><rect width='64' height='64' fill='#1c1c1c'/><rect width='32' height='32' fill='#262626'/><rect x='32' y='32' width='32' height='32' fill='#262626'/></pattern></defs><rect width='1920' height='1080' fill='url(#c)'/></svg>`)

const PLAIN = svgUrl(`<svg xmlns='http://www.w3.org/2000/svg' width='1920' height='1080'><rect width='1920' height='1080' fill='#121212'/></svg>`)

const MARQUEE = TEMPLATES.filter((tp) => categoryOf(tp.id) !== 'B-roll 场景').map((tp) => tp.name)

const STEPS = [
  { no: '01', name: '导入口播和字幕', desc: '选本机的口播视频（不上传），再导入剪映导出的 SRT 字幕。' },
  { no: '02', name: 'AI 一键配卡', desc: '按字幕挑出该上卡的句子，数字、清单、对比、章节各配各的卡。' },
  { no: '03', name: '拖一拖，改一改', desc: '像剪映一样在时间轴上拖位置、改时长、分轨叠放，文字当场改。' },
  { no: '04', name: '导出透明叠加层', desc: '一个透明底 .mov，放在口播上面一轨，从 0 秒对齐，完事。' },
]
</script>

<template>
  <div ref="root" class="bc">
    <SiteHeader />

    <nav class="nav">
      <span class="logo"><b>B</b>ROLL<i>口播动效卡</i></span>
      <button class="btn sm" @click="go">开始使用</button>
    </nav>

    <!-- 首屏 -->
    <header class="hero">
      <div class="copy">
        <p class="eyebrow"><span class="rec"></span>FOR TALKING-HEAD VIDEOS</p>
        <h1>
          口播只有一张脸？<br>
          给它配上<span class="mark">会动的</span><br>
          信息卡。
        </h1>
        <p class="lead">导入字幕，AI 挑出值得上屏的那句话，配好数字、清单、图表动效卡。导出透明叠加层，剪映里放上一轨就能用。</p>
        <div class="actions">
          <button class="btn" @click="go">
            开始使用
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
          </button>
          <a href="#how" class="link">怎么用 ↓</a>
        </div>
      </div>

      <div class="monitor">
        <div class="mon-bar">
          <span><i class="rec"></i>REC</span>
          <span class="mono">{{ tc }}</span>
          <span class="mono">16:9 · 1080P</span>
        </div>
        <div class="mon-screen">
          <CardStage
            v-if="reel" :key="reel.tp.id"
            :component="reel.tp.component" :data="reel.data" :t="reelLocal"
            aspect="16:9" :box="{ x: 0.05, y: 0.08, s: 0.95 }" theme="ember" bg="image" :bg-image="SCENE"
          />
          <div class="subtitle"><span :key="reelIdx">{{ reel?.sub }}</span></div>
          <i class="corner c-tl"></i><i class="corner c-tr"></i><i class="corner c-bl"></i><i class="corner c-br"></i>
        </div>
        <div class="tl">
          <div class="tl-row">
            <span class="tl-label">卡片</span>
            <div class="tl-track">
              <button
                v-for="(r, i) in REEL" :key="r.tp.id" class="tl-clip card" :class="{ on: i === reelIdx }"
                :style="{ left: `${(starts[i] / total) * 100}%`, width: `${(r.data.duration / total) * 100}%` }"
                @click="jump(i)"
              >{{ r.tp.name }}</button>
            </div>
          </div>
          <div class="tl-row">
            <span class="tl-label">字幕</span>
            <div class="tl-track">
              <span
                v-for="(r, i) in REEL" :key="r.tp.id" class="tl-clip sub"
                :style="{ left: `${(starts[i] / total) * 100}%`, width: `${(r.data.duration / total) * 100}%` }"
              ></span>
            </div>
          </div>
          <i class="playhead" :style="{ left: `calc(56px + (100% - 56px) * ${reelT / total})` }"></i>
        </div>
      </div>
    </header>

    <!-- 卡型跑马灯 -->
    <div class="marquee" aria-hidden="true">
      <div class="mq-inner">
        <span v-for="(n, i) in [...MARQUEE, ...MARQUEE]" :key="i">{{ n }}<i>✦</i></span>
      </div>
    </div>

    <!-- 怎么用 -->
    <section id="how" class="sec">
      <div class="sec-head rv">
        <p class="eyebrow">HOW IT WORKS</p>
        <h2>四步，配好一条口播。</h2>
      </div>
      <ol class="steps">
        <li v-for="(s, i) in STEPS" :key="s.no" class="rv" :style="{ transitionDelay: `${i * 80}ms` }">
          <span class="big">{{ s.no }}</span>
          <b>{{ s.name }}</b>
          <p>{{ s.desc }}</p>
        </li>
      </ol>
    </section>

    <!-- 数字不乱编 -->
    <section class="sec split">
      <div class="sec-head rv">
        <p class="eyebrow">NO MADE-UP NUMBERS</p>
        <h2>卡上的每个数，<br>都核过你的原话。</h2>
        <p class="sec-lead">AI 配的每张卡都逐张对照字幕：数字按整数比、单位必须在那句里。对不上的整张拦下，并告诉你哪里不对 —— 不会有一个编出来的数悄悄上屏。</p>
      </div>
      <div class="verify rv">
        <div class="v-line">
          <span class="v-tag">字幕 #12</span>
          <p>我们这个月复购率做到了 <u>40%</u>，行业平均只有 15%</p>
        </div>
        <div class="v-card pass">
          <span class="v-ico">✓</span>
          <div><b>占比环 · 40%</b><small>「40」「%」都在原话里</small></div>
          <em>已上屏</em>
        </div>
        <div class="v-card fail">
          <span class="v-ico">✕</span>
          <div><b>数字冲击 · 400%</b><small>原话里没有「400」，整张拦下</small></div>
          <em>已拦下</em>
        </div>
      </div>
    </section>

    <!-- 透明导出 -->
    <section class="sec">
      <div class="sec-head rv">
        <p class="eyebrow">TRANSPARENT EXPORT</p>
        <h2>导出的是透明层，<br>不是一段黑底视频。</h2>
      </div>
      <div v-if="ALPHA" class="alpha rv">
        <figure>
          <CardStage
            :component="ALPHA.tp.component" :data="ALPHA.data" :t="loopT(ALPHA)"
            aspect="16:9" :box="{ x: 0.08, y: 0.16, s: 1.25 }" theme="ember" bg="image" :bg-image="CHECKER"
          />
          <figcaption><b>导出的 .mov</b>透明底，PNG / HEVC 两种可选</figcaption>
        </figure>
        <span class="plus">+</span>
        <figure>
          <CardStage
            :component="ALPHA.tp.component" :data="ALPHA.data" :t="loopT(ALPHA)"
            aspect="16:9" :box="{ x: 0.08, y: 0.16, s: 1.25 }" theme="ember" bg="image" :bg-image="SCENE"
          />
          <figcaption><b>剪映里叠在口播上</b>作者实测透明，放上一轨即可</figcaption>
        </figure>
      </div>
    </section>

    <!-- 卡片墙 -->
    <section class="sec">
      <div class="sec-head row rv">
        <div>
          <p class="eyebrow">CARD LIBRARY</p>
          <h2>{{ TEMPLATES.length }} 种动效卡，<br>横竖屏都放得下。</h2>
        </div>
        <p class="sec-lead">数据、文字强调、列表结构、章节节奏、界面模拟……颜色字体整套跟主题走，换主题 = 整条视频一起换。</p>
      </div>
      <div class="wall">
        <div v-for="(c, i) in WALL" :key="c.tp.id" class="tile rv" :style="{ transitionDelay: `${(i % 4) * 70}ms` }">
          <CardStage
            :component="c.tp.component" :data="c.data" :t="loopT(c, i * 0.9)"
            aspect="16:9" :box="{ x: 0.07, y: 0.1, s: 1.05 }" theme="ember" bg="image" :bg-image="PLAIN"
          />
          <span class="tile-name">{{ c.tp.name }}</span>
        </div>
      </div>
    </section>

    <!-- 收尾 -->
    <section class="end rv">
      <p class="eyebrow dark">READY WHEN YOU ARE</p>
      <h2>下一条口播，<br>十分钟配好动效。</h2>
      <button class="btn dark" @click="go">
        开始使用
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
      </button>
    </section>

    <AppKeyModal :model-value="keyOpen" app="broll" :next="q('next')" :reason="q('reason')" @update:model-value="onKeyModal" />
  </div>
</template>

<style scoped>
.bc {
  --y: #ffd028;
  --bg: #0a0a0a;
  --ink: #f4f1e8;
  --mute: #8a877e;
  --line: #222;
  min-height: 100vh; background: var(--bg); color: var(--ink); overflow-x: hidden;
  font-family: 'PingFang SC', 'Noto Sans SC', -apple-system, 'Helvetica Neue', sans-serif;
}
.mono { font-family: 'JetBrains Mono', 'SF Mono', Menlo, monospace; }
/* 封面上不要编辑器里那条字幕安全区虚线 */
.bc :deep(.cs-safe) { display: none; }
.bc :deep(.cs) { border-radius: 0; }

/* 导航 */
.nav { max-width: 1280px; margin: 0 auto; padding: 72px 32px 22px; display: flex; justify-content: space-between; align-items: center; }
.logo { font-weight: 900; font-size: 20px; letter-spacing: .06em; display: flex; align-items: baseline; gap: 2px; }
.logo b { background: var(--y); color: #000; padding: 0 6px; margin-right: 2px; }
.logo i { font-style: normal; font-weight: 500; font-size: 13px; letter-spacing: .1em; color: var(--mute); margin-left: 12px; }

.btn {
  display: inline-flex; align-items: center; gap: 10px; border: 0; cursor: pointer;
  background: var(--y); color: #000; font-weight: 800; font-size: 17px; letter-spacing: .02em;
  padding: 16px 30px; border-radius: 0; box-shadow: 6px 6px 0 #fff2; transition: transform .15s, box-shadow .15s;
}
.btn:hover { transform: translate(-2px, -2px); box-shadow: 8px 8px 0 #fff3; }
.btn svg { width: 20px; height: 20px; }
.btn.sm { font-size: 14px; padding: 9px 18px; box-shadow: none; }
.btn.dark { background: #000; color: var(--y); box-shadow: 6px 6px 0 #0003; }

.eyebrow { font-family: 'JetBrains Mono', 'SF Mono', Menlo, monospace; font-size: 12px; letter-spacing: .22em; color: var(--y); margin: 0 0 20px; display: flex; align-items: center; gap: 10px; }
.eyebrow.dark { color: #000; justify-content: center; }
.rec { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #ff3b30; animation: blink 1.2s steps(2) infinite; }
@keyframes blink { 50% { opacity: .2; } }

/* 首屏 */
.hero { max-width: 1280px; margin: 0 auto; padding: 40px 32px 90px; display: grid; grid-template-columns: 0.9fr 1.1fr; gap: 64px; align-items: center; }
h1 { font-size: clamp(40px, 4.6vw, 66px); line-height: 1.12; font-weight: 900; letter-spacing: -.02em; margin: 0 0 28px; }
.mark { position: relative; white-space: nowrap; color: #000; padding: 0 .12em; z-index: 0; }
.mark::before { content: ''; position: absolute; inset: .08em -.02em .02em; background: var(--y); z-index: -1; transform: skew(-6deg); animation: swipe .9s .3s cubic-bezier(.7, 0, .2, 1) both; transform-origin: left; }
@keyframes swipe { from { clip-path: inset(0 100% 0 0); } to { clip-path: inset(0 0 0 0); } }
.lead { color: #b9b5aa; font-size: 17px; line-height: 1.85; max-width: 30em; margin: 0 0 40px; }
.actions { display: flex; align-items: center; gap: 28px; }
.link { color: var(--ink); text-decoration: none; font-weight: 600; border-bottom: 2px solid var(--y); padding-bottom: 2px; }

.monitor { background: #111; border: 1px solid #2a2a2a; padding: 10px; box-shadow: 0 40px 100px #000a, 0 0 0 1px #000; }
.mon-bar { display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: var(--mute); padding: 2px 4px 10px; letter-spacing: .12em; }
.mon-bar span:first-child { display: flex; align-items: center; gap: 6px; color: #ff6b61; font-weight: 700; }
.mon-screen { position: relative; container-type: inline-size; }
.subtitle { position: absolute; left: 0; right: 0; bottom: 6%; text-align: center; pointer-events: none; }
.subtitle span { display: inline-block; font-size: 3.1cqw; font-weight: 700; color: #fff; text-shadow: 0 0 .25em #000, 0 .06em .1em #000; animation: subIn .3s ease-out; }
@keyframes subIn { from { opacity: 0; transform: translateY(.3em); } }
.corner { position: absolute; width: 18px; height: 18px; border: 0 solid var(--y); }
.corner.c-tl { left: 10px; top: 10px; border-width: 2px 0 0 2px; }
.corner.c-tr { right: 10px; top: 10px; border-width: 2px 2px 0 0; }
.corner.c-bl { left: 10px; bottom: 10px; border-width: 0 0 2px 2px; }
.corner.c-br { right: 10px; bottom: 10px; border-width: 0 2px 2px 0; }

.tl { position: relative; margin-top: 10px; padding: 8px 0 2px; border-top: 1px solid #222; }
.tl-row { display: flex; align-items: center; height: 26px; margin-bottom: 4px; }
.tl-label { width: 56px; font-size: 11px; color: var(--mute); padding-left: 4px; flex: none; }
.tl-track { position: relative; flex: 1; height: 100%; }
.tl-clip { position: absolute; top: 0; bottom: 0; border: 0; padding: 0 8px; font-size: 11px; text-align: left; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.tl-clip.card { background: #3a3215; color: #d8c88d; cursor: pointer; border-left: 2px solid var(--y); margin-right: 2px; transition: background .2s; }
.tl-clip.card.on { background: var(--y); color: #000; font-weight: 700; }
.tl-clip.sub { background: #1d1d1d; border-left: 1px solid #333; top: 6px; bottom: 6px; }
.playhead { position: absolute; top: 0; bottom: 0; width: 2px; background: #fff; box-shadow: 0 0 8px #fff8; pointer-events: none; }
.playhead::before { content: ''; position: absolute; top: -4px; left: -4px; border: 5px solid transparent; border-top-color: #fff; }

/* 跑马灯 */
.marquee { background: var(--y); color: #000; overflow: hidden; transform: rotate(-1.2deg); margin: 0 -20px; padding: 14px 0; }
.mq-inner { display: flex; width: max-content; animation: mq 60s linear infinite; }
.mq-inner span { font-weight: 900; font-size: 22px; white-space: nowrap; padding: 0 18px; display: flex; align-items: center; gap: 36px; }
.mq-inner i { font-style: normal; font-size: 14px; }
@keyframes mq { to { transform: translateX(-50%); } }

/* 通用段落 */
.sec { max-width: 1280px; margin: 0 auto; padding: 120px 32px 0; }
.sec-head { margin-bottom: 56px; }
.sec-head.row { display: flex; justify-content: space-between; align-items: flex-end; gap: 48px; }
h2 { font-size: clamp(32px, 3.4vw, 48px); line-height: 1.2; font-weight: 900; letter-spacing: -.01em; margin: 0; }
.sec-lead { color: #a5a196; line-height: 1.85; max-width: 34em; margin: 24px 0 0; }
.sec-head.row .sec-lead { margin: 0; max-width: 26em; }

.steps { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(4, 1fr); border-top: 1px solid var(--line); }
.steps li { padding: 36px 28px 0 0; border-right: 1px solid var(--line); margin-right: 28px; }
.steps li:last-child { border-right: 0; }
.big { display: block; font-size: 72px; font-weight: 900; line-height: 1; color: transparent; -webkit-text-stroke: 1.5px var(--y); margin-bottom: 26px; font-family: 'Helvetica Neue', Arial, sans-serif; }
.steps b { display: block; font-size: 20px; margin-bottom: 12px; }
.steps p { margin: 0; color: var(--mute); line-height: 1.8; font-size: 14px; }

.split { display: grid; grid-template-columns: 1fr 1fr; gap: 72px; align-items: center; }
.split .sec-head { margin: 0; }
.verify { background: #111; border: 1px solid #222; padding: 28px; display: grid; gap: 14px; }
.v-line { padding: 18px 20px; background: #0a0a0a; border: 1px dashed #333; }
.v-tag { font-family: 'JetBrains Mono', Menlo, monospace; font-size: 11px; color: var(--mute); letter-spacing: .1em; }
.v-line p { margin: 8px 0 0; font-size: 17px; line-height: 1.6; }
.v-line u { text-decoration: none; background: var(--y); color: #000; padding: 0 4px; font-weight: 700; }
.v-card { display: flex; align-items: center; gap: 16px; padding: 16px 20px; }
.v-card div { flex: 1; }
.v-card b { display: block; font-size: 16px; }
.v-card small { color: var(--mute); font-size: 13px; }
.v-card em { font-style: normal; font-size: 12px; font-weight: 700; letter-spacing: .08em; }
.v-ico { width: 30px; height: 30px; display: grid; place-items: center; font-weight: 900; flex: none; }
.v-card.pass { background: #1e1a08; border-left: 3px solid var(--y); }
.v-card.pass .v-ico { background: var(--y); color: #000; }
.v-card.pass em { color: var(--y); }
.v-card.fail { background: #1a0d0c; border-left: 3px solid #ff5a4e; }
.v-card.fail .v-ico { background: #ff5a4e; color: #000; }
.v-card.fail b { text-decoration: line-through; text-decoration-color: #ff5a4e; color: #c9c4b8; }
.v-card.fail em { color: #ff5a4e; }

.alpha { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 28px; }
.alpha figure { margin: 0; border: 1px solid #222; background: #111; padding: 10px; }
.alpha figcaption { padding: 14px 4px 4px; color: var(--mute); font-size: 13px; }
.alpha figcaption b { display: block; color: var(--ink); font-size: 16px; margin-bottom: 4px; }
.plus { font-size: 48px; font-weight: 300; color: var(--y); }

.wall { display: grid; grid-template-columns: repeat(4, 1fr); gap: 2px; background: #1a1a1a; border: 1px solid #1a1a1a; }
.tile { position: relative; background: #121212; }
.tile-name { display: block; border-top: 1px solid #1a1a1a; background: #0a0a0a; color: var(--mute); font-size: 13px; padding: 10px 14px; transition: background .2s, color .2s; }
.tile:hover .tile-name { background: var(--y); color: #000; }

.end { margin-top: 140px; background: var(--y); color: #000; text-align: center; padding: 110px 32px; }
.end h2 { font-size: clamp(36px, 4.6vw, 64px); margin-bottom: 44px; }

/* 滚动入场 */
.rv { opacity: 0; transform: translateY(28px); transition: opacity .7s ease, transform .7s cubic-bezier(.2, .7, .2, 1); }
.rv.in { opacity: 1; transform: none; }

@media (max-width: 960px) {
  .hero, .split { grid-template-columns: 1fr; gap: 48px; }
  .steps { grid-template-columns: 1fr 1fr; row-gap: 40px; }
  .steps li:nth-child(2) { border-right: 0; }
  .alpha { grid-template-columns: 1fr; }
  .plus { text-align: center; }
  .wall { grid-template-columns: 1fr 1fr; }
  .sec-head.row { flex-direction: column; align-items: flex-start; }
}
</style>
