<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import SiteHeader from '../../components/common/SiteHeader.vue';
import AppKeyModal from '../../components/common/AppKeyModal.vue'

const route = useRoute()
const router = useRouter()

// 「去使用」直接进列表，有没有 key / 账号交给守卫判：没有时它送到 /ppt/key，
// 那条路由带着 ?key=1 回到这里把弹窗打开。在这里另判一遍 token 的话两处条件迟早对不上。
const keyOpen = ref(false)
watch(() => route.query.key, (v) => { keyOpen.value = !!v }, { immediate: true })
const q = (k: string) => (typeof route.query[k] === 'string' ? (route.query[k] as string) : undefined)

function onKeyModal(open: boolean) {
  keyOpen.value = open
  if (!open && route.query.key) router.replace({ path: '/ppt' })
}

function go() {
  router.push('/ppt/decks')
}

const IMG = (p: string) => `https://file.qiaonan.vip/uploads/2026/09/24/${p}`
const A = {
  cover: IMG('fd43e5a2-2184-42d2-87b6-00e99ed4dc25.png'),
  pipeline: IMG('24504225-e46d-4699-b1ea-925dadfd76ce.png'),
  five: IMG('95fe2ffd-e92f-4f91-b3cc-ea0c818377a1.png'),
  cards: IMG('5e20f20f-88e8-4d78-ad0f-651e058bd230.png'),
  photo: IMG('1720da8f-a8e8-4927-ac49-cd27473fe89c.png'),
  party: IMG('b6cfa510-fc0f-48bf-9e0d-afb7a5126ce3.png'),
  agenda: IMG('91a0cf75-a3a0-44b8-92a1-0a5a599aef14.png'),
  resume: IMG('4dffcbe3-16a8-42b9-b9bb-4453d6cc01f0.png'),
  editing: IMG('497758e1-3b72-4147-9233-23a79ebbf6fc.jpg'),
}

const STEPS = [
  { no: '01', name: '聊提纲', desc: '把要讲的事说给 AI 听，或上传现成的 pptx / Word / PDF 当资料，先把每一页讲什么定下来。' },
  { no: '02', name: '整份规划版式', desc: '从 76 条真实版式里整份一起挑，封面、章节、内容页节奏统一，每页都告诉你为什么挑它。' },
  { no: '03', name: '逐页生成', desc: '一页一页出，第一页几十秒就能看到。哪页不满意单独重做那一页，不用整份重来。' },
]

const EDITS = [
  { k: '双击改字', v: '直接在页面上改，所见即所得' },
  { k: '拖动 / 拉伸', v: '任意一块挪位置、改大小' },
  { k: '改样式', v: '颜色、字号、粗细、对齐，选中就改' },
  { k: '删 / 换图', v: '删掉一块、换一张配图，当场生效' },
  { k: '改整份规范', v: '配色字体一改，已生成的页全部跟着变' },
]

const LAYERS = [
  { name: '主标题', kind: '文本框' },
  { name: '副标题', kind: '文本框' },
  { name: '红色斜切色块', kind: '形状' },
  { name: '底部弧形', kind: '形状' },
  { name: '社区大楼照片', kind: '图片' },
]

const CASES = [
  { src: A.cover, title: '封面 · 城市天际线', tag: '全幅图叠字' },
  { src: A.party, title: '党建工作汇报', tag: '斜切图文' },
  { src: A.pipeline, title: '开场 · 数据亮点', tag: '大字 + 指标' },
  { src: A.resume, title: '演讲开场', tag: '图文对半' },
  { src: A.cards, title: '优势三栏', tag: '图卡三段' },
  { src: A.photo, title: '流程说明', tag: '人物图 + 步骤' },
  { src: A.agenda, title: '演讲目录', tag: '目录页' },
  { src: A.five, title: '章节过渡', tag: '章节页' },
  { src: A.editing, title: '人物案例', tag: '斜切人物' },
]
const zoom = ref<number | null>(null)
function onKey(e: KeyboardEvent) {
  const z = zoom.value
  if (z === null) return
  if (e.key === 'Escape') zoom.value = null
  if (e.key === 'ArrowRight') zoom.value = (z + 1) % CASES.length
  if (e.key === 'ArrowLeft') zoom.value = (z + CASES.length - 1) % CASES.length
}

// 首屏编辑器演示的时间线。光标位置按元素实测算（窗口宽度随屏幕变），每一轮重新量。
const edEl = ref<HTMLElement | null>(null)
const titleEl = ref<HTMLElement | null>(null)
const swatchEl = ref<HTMLElement | null>(null)
const exportEl = ref<HTMLElement | null>(null)
const ORIGINAL = '季度工作汇报'
const title = ref(ORIGINAL)
const selected = ref(false)
const selectAll = ref(false)
const caret = ref(false)
const colored = ref(false)
const tools = ref(false)
const exporting = ref(false)
const toast = ref(false)
const clicking = ref(false)
const cur = ref({ x: 0, y: 0 })
let alive = true
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
function moveTo(el: HTMLElement | null, fx = 0.5, fy = 0.5) {
  const box = edEl.value?.getBoundingClientRect()
  const r = el?.getBoundingClientRect()
  if (!box || !r) return
  cur.value = { x: r.left - box.left + r.width * fx, y: r.top - box.top + r.height * fy }
}
async function click() {
  clicking.value = true
  await sleep(180)
  clicking.value = false
}
async function playEditor() {
  while (alive) {
    title.value = ORIGINAL; colored.value = false
    moveTo(edEl.value, 0.82, 0.9)
    await sleep(900); if (!alive) return
    moveTo(titleEl.value, 0.35, 0.55)
    await sleep(1000)
    await click(); await sleep(80); await click()
    selected.value = true; tools.value = true; selectAll.value = true
    await sleep(700)
    title.value = ''; selectAll.value = false; caret.value = true
    for (const ch of 'Q3 增长复盘') { if (!alive) return; title.value += ch; await sleep(130) }
    await sleep(400); caret.value = false
    moveTo(swatchEl.value)
    await sleep(900)
    await click(); colored.value = true
    await sleep(1000)
    tools.value = false; selected.value = false
    moveTo(exportEl.value, 0.4, 0.6)
    await sleep(1000)
    await click(); exporting.value = true
    await sleep(1000)
    exporting.value = false; toast.value = true
    await sleep(2600)
    toast.value = false
    await sleep(600)
  }
}

let io: IntersectionObserver | null = null
onMounted(() => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { title.value = 'Q3 增长复盘'; colored.value = true }
  else playEditor()
  io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io?.unobserve(e.target) }
  }, { threshold: 0.15 })
  document.querySelectorAll('.pc .reveal').forEach((el) => io!.observe(el))
  window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => { alive = false; io?.disconnect(); window.removeEventListener('keydown', onKey) })
</script>

<template>
  <div class="pc">
    <SiteHeader />
    <nav class="nav">
      <span class="brand"><i></i>HTML 展示稿</span>
      <button class="nav-cta" @click="go">去使用</button>
    </nav>

    <!-- 首屏 -->
    <section class="hero">
      <div class="hero-light" aria-hidden="true"></div>
      <div class="hero-copy">
        <p class="kicker">AI PRESENTATION · 提纲到成片</p>
        <h1><span>提纲进去，</span><span><em>能讲、能改、能交付</em></span><span>的稿子出来。</span></h1>
        <p class="lead">AI 按真实版式逐页排好，在线就地修改；<br>讲完还能导出成 <b>可编辑的 PPT 文件</b> 交给别人接着改。</p>
        <div class="hero-actions">
          <button class="cta" @click="go">
            去使用
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
          </button>
          <a href="#cases" class="ghost">看成片案例</a>
        </div>
        <dl class="stats">
          <div><dt>真实版式</dt><dd>76<small>条</small></dd></div>
          <div><dt>单份最多</dt><dd>45<small>页</small></dd></div>
          <div><dt>导出格式</dt><dd>PPTX<small>/ HTML</small></dd></div>
        </dl>
      </div>

      <!-- 模拟一次编辑：双击改字 → 换色 → 导出 PPTX，循环播放。纯演示，不接任何接口。 -->
      <div class="ed-wrap">
      <div class="ed-glow" aria-hidden="true"></div>
      <div ref="edEl" class="ed" aria-hidden="true">
        <div class="ed-bar">
          <span class="dots"><i></i><i></i><i></i></span>
          <span class="ed-name"><svg viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.4" /><path d="M5 7h6M5 10h4" stroke="currentColor" stroke-width="1.4" /></svg>季度汇报</span>
          <span class="seg"><b>编辑</b><span>放映</span></span>
          <span class="ed-icons"><svg viewBox="0 0 16 16"><path d="M6 4L3 7l3 3M3.5 7H10a3 3 0 010 6H8" fill="none" stroke="currentColor" stroke-width="1.4" /></svg><svg viewBox="0 0 16 16"><path d="M10 4l3 3-3 3M12.5 7H6a3 3 0 000 6h2" fill="none" stroke="currentColor" stroke-width="1.4" /></svg></span>
          <span ref="exportEl" class="ed-export" :class="{ busy: exporting }">
            <svg viewBox="0 0 16 16"><path d="M8 2v8M4.5 6.5L8 10l3.5-3.5M3 13h10" fill="none" stroke="currentColor" stroke-width="1.6" /></svg>{{ exporting ? '导出中…' : '导出 PPTX' }}
          </span>
        </div>
        <div class="ed-body">
          <div class="ed-rail">
            <div class="ed-thumb on"><em>1</em><div class="tv"><div class="mini"><b :class="{ hl: colored }"></b><s></s><s></s><i :style="{ backgroundImage: `url(${A.resume})` }"></i></div></div></div>
            <div class="ed-thumb"><em>2</em><div class="tv"><img :src="A.party" alt="" /></div></div>
            <div class="ed-thumb"><em>3</em><div class="tv"><img :src="A.agenda" alt="" /></div></div>
            <div class="ed-thumb"><em>4</em><div class="tv"><img :src="A.cards" alt="" /></div></div>
            <div class="ed-thumb"><em>5</em><div class="tv"><img :src="A.photo" alt="" /></div></div>
          </div>
          <div class="ed-canvas">
            <div class="ed-slide">
              <p class="es-kicker">Q3 · QUARTERLY REVIEW</p>
              <h4 ref="titleEl" class="es-title" :class="{ sel: selected, all: selectAll }">
                <template v-if="colored">Q3 <em>增长</em>复盘</template>
                <template v-else>{{ title }}</template><i v-if="caret" class="caret"></i>
                <span class="hd tl"></span><span class="hd tr"></span><span class="hd bl"></span><span class="hd br"></span>
              </h4>
              <p class="es-sub">新开 12 城 · 复购率提升 · 下季度三件事</p>
              <div class="es-metrics"><div><b>+38%</b><span>营收同比</span></div><div><b>12</b><span>新开城市</span></div><div><b>4.8</b><span>客户评分</span></div></div>
              <div class="es-photo" :style="{ backgroundImage: `url(${A.resume})` }"></div>
              <div class="ed-tools" :class="{ show: tools }">
                <span>A<sup>+</sup></span><i class="div"></i><span ref="swatchEl" class="sw o"></span><span class="sw b"></span><span class="sw k"></span><i class="div"></i><span><b>B</b></span><span>≡</span><span class="del">🗑</span>
              </div>
            </div>
          </div>
          <aside class="ed-inspect">
            <p class="ins-h">{{ selected ? '文本框 · 标题' : '页面' }}</p>
            <template v-if="selected">
              <label>字号<span class="val">52</span></label>
              <label>颜色<span class="val"><i class="chip" :class="{ o: colored }"></i>{{ colored ? '#F07A2C' : '#141A2E' }}</span></label>
              <label>粗细<span class="val">加粗</span></label>
              <label>对齐<span class="val al"><b>▤</b><span>▥</span><span>▦</span></span></label>
            </template>
            <template v-else>
              <label>版式<span class="val">斜切人物</span></label>
              <label>配色<span class="val"><i class="chip b"></i><i class="chip o"></i></span></label>
              <label>比例<span class="val">16 : 9</span></label>
              <p class="ins-tip">双击任意文字直接改</p>
            </template>
          </aside>
        </div>
        <div class="ed-status">
          <span><i class="ok"></i>已自动保存 · 改字、换色不花点数</span>
          <span>第 1 / 12 页 · 100%</span>
        </div>
        <div class="ed-toast" :class="{ show: toast }"><i>✓</i>已导出 季度汇报.pptx<span>每段文字都是可编辑的文本框</span></div>
        <svg class="ed-cursor" :class="{ click: clicking }" :style="{ transform: `translate(${cur.x}px, ${cur.y}px)` }" viewBox="0 0 24 24"><path d="M4 2l16 9-7 2-3 7z" fill="#141a2e" stroke="#fff" stroke-width="1.5" stroke-linejoin="round" /></svg>
      </div>
      </div>
    </section>

    <!-- 滚动胶片 -->
    <div class="reel" aria-hidden="true">
      <div class="reel-track">
        <img v-for="(c, i) in [...CASES, ...CASES]" :key="i" :src="c.src" alt="" loading="lazy" />
      </div>
    </div>

    <!-- 使用方法 -->
    <section class="how">
      <header class="sec-head reveal">
        <span class="chapter">HOW IT WORKS</span>
        <h2>生成只是开始，<span class="hl">改到满意、带走就用</span></h2>
        <p class="sec-sub">前三步 AI 帮你排好，后两步才是它和「一键生成 PPT」不一样的地方。</p>
      </header>

      <ol class="steps reveal">
        <li v-for="s in STEPS" :key="s.no">
          <span class="step-no">{{ s.no }}</span>
          <h3>{{ s.name }}</h3>
          <p>{{ s.desc }}</p>
        </li>
      </ol>

      <!-- 04 在线编辑 -->
      <article class="spot reveal">
        <div class="spot-text">
          <span class="spot-no">04</span>
          <h3>在线编辑，<br>哪里不对点哪里</h3>
          <p class="spot-lead">生成出来的每一页都能直接在浏览器里改，不用回到 AI 重新描述一遍。改字、挪位置、换颜色都<b>不花调用点数</b>。</p>
          <ul class="edit-list">
            <li v-for="e in EDITS" :key="e.k"><b>{{ e.k }}</b><span>{{ e.v }}</span></li>
          </ul>
        </div>
        <div class="spot-visual">
          <div class="win">
            <div class="win-bar"><i></i><i></i><i></i><span>在线编辑 · 第 12 页</span></div>
            <div class="win-body">
              <img :src="A.editing" alt="在线编辑示意" loading="lazy" />
              <div class="toolbar">
                <span>A<sup>+</sup></span><span class="sw o"></span><span class="sw b"></span><span><b>B</b></span><span>≡</span><span>🗑</span>
              </div>
            </div>
          </div>
        </div>
      </article>

      <!-- 05 导出 -->
      <article class="spot flip reveal">
        <div class="spot-text">
          <span class="spot-no">05</span>
          <h3>导出成<br>可编辑的 PPT 文件</h3>
          <p class="spot-lead">一键导出 <b>.pptx</b>，用 PowerPoint、WPS、Keynote 打开：每段文字都是文本框、每个色块都是形状、每张图单独一层 —— <b>不是一张张截图</b>，拿过去照样能改。</p>
          <div class="formats">
            <div class="fmt main"><b>.PPTX</b><span>可编辑，交付给客户 / 同事接着改</span></div>
            <div class="fmt"><b>.HTML</b><span>浏览器直接全屏放映，发链接就能看</span></div>
          </div>
          <p class="fine">渐变、模糊这类网页特效在 PPT 里会换成最接近的纯色，导出时会逐项告诉你哪里有变化。</p>
        </div>
        <div class="spot-visual">
          <div class="win ppt">
            <div class="win-bar"><i></i><i></i><i></i><span>工作汇报.pptx</span></div>
            <div class="ppt-body">
              <div class="ppt-slide">
                <img :src="A.party" alt="导出后的 PPT 页面" loading="lazy" />
                <span class="box b1"></span><span class="box b2"></span><span class="box b3"></span>
              </div>
              <aside class="pane">
                <p>选择窗格</p>
                <ul>
                  <li v-for="(l, i) in LAYERS" :key="l.name" :class="{ on: i === 0 }"><span>{{ l.name }}</span><em>{{ l.kind }}</em></li>
                </ul>
              </aside>
            </div>
          </div>
        </div>
      </article>
    </section>

    <!-- 案例 -->
    <section id="cases" class="cases">
      <header class="sec-head reveal">
        <span class="chapter">SHOWCASE</span>
        <h2>这些都是它排出来的</h2>
        <p class="sec-sub">汇报、演讲、方案、党建 —— 点开看大图。</p>
      </header>
      <div class="grid">
        <button v-for="(c, i) in CASES" :key="c.src" class="card reveal" :style="{ transitionDelay: `${(i % 3) * 90}ms` }" @click="zoom = i">
          <div class="thumb"><img :src="c.src" :alt="c.title" loading="lazy" /></div>
          <div class="card-meta"><b>{{ c.title }}</b><span>{{ c.tag }}</span></div>
        </button>
      </div>
    </section>

    <!-- 收尾 -->
    <section class="finale">
      <div class="finale-bg"><img :src="A.pipeline" alt="" loading="lazy" /></div>
      <div class="finale-inner reveal">
        <h2>下一份稿子，<br>从一段提纲开始。</h2>
        <button class="cta light" @click="go">
          去使用
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
        </button>
      </div>
    </section>

    <Teleport to="body">
      <Transition name="zoom">
        <div v-if="zoom !== null" class="lightbox" @click.self="zoom = null">
          <button class="lb-nav prev" @click="zoom = (zoom! + CASES.length - 1) % CASES.length">‹</button>
          <figure>
            <img :src="CASES[zoom].src" :alt="CASES[zoom].title" />
            <figcaption>{{ CASES[zoom].title }} · {{ CASES[zoom].tag }}</figcaption>
          </figure>
          <button class="lb-nav next" @click="zoom = (zoom! + 1) % CASES.length">›</button>
          <button class="lb-close" @click="zoom = null">×</button>
        </div>
      </Transition>
    </Teleport>

    <AppKeyModal :model-value="keyOpen" app="ppt" :next="q('next')" :reason="q('reason')" @update:model-value="onKeyModal" />
  </div>
</template>

<style scoped>
.pc {
  --blue: #1f44c4;
  --blue-deep: #0f2a7a;
  --orange: #f07a2c;
  --ink: #141a2e;
  --text: #4a5270;
  --muted: #8a91a8;
  --line: #e4e8f2;
  --bg: #f6f8fd;
  position: relative;
  min-height: 100vh;
  background: var(--bg);
  color: var(--ink);
  overflow-x: hidden;
  font-family: "PingFang SC", "Noto Sans SC", "Helvetica Neue", sans-serif;
}
img { display: block; }

/* 顶栏 */
.nav {
  position: absolute; top: 50px; left: 0; right: 0; z-index: 5;
  display: flex; align-items: center; justify-content: space-between;
  padding: 22px 5vw;
}
.brand { display: flex; align-items: center; gap: 10px; font-weight: 700; font-size: 16px; letter-spacing: .04em; }
.brand i { width: 22px; height: 14px; border-radius: 3px; background: linear-gradient(120deg, var(--blue) 60%, var(--orange) 60%); }
.nav-cta { border: 1px solid var(--line); background: rgba(255, 255, 255, .8); backdrop-filter: blur(8px); padding: 8px 20px; border-radius: 999px; font-size: 14px; cursor: pointer; color: var(--ink); transition: .25s; }
.nav-cta:hover { border-color: var(--blue); color: var(--blue); }

/* 首屏 */
.hero {
  position: relative; min-height: 100vh; box-sizing: border-box;
  display: grid; grid-template-columns: minmax(0, .8fr) minmax(0, 1.4fr); align-items: center; gap: 3.5vw;
  padding: 150px 4vw 80px; max-width: 1640px; margin: 0 auto;
}
.hero-light {
  position: absolute; inset: 0 -20vw; z-index: 0; pointer-events: none;
  background:
    radial-gradient(ellipse 50% 60% at 85% 30%, rgba(240, 122, 44, .16), transparent 70%),
    radial-gradient(ellipse 60% 70% at 70% 80%, rgba(31, 68, 196, .14), transparent 70%),
    radial-gradient(ellipse 40% 50% at 10% 10%, rgba(120, 170, 255, .18), transparent 70%);
}
.hero-copy { position: relative; z-index: 1; animation: up 1s cubic-bezier(.2, .7, .1, 1) both; }
.kicker { margin: 0 0 22px; font-size: 12px; font-weight: 700; letter-spacing: .3em; color: var(--orange); }
h1, h2, h3, h4 { font-family: inherit; }
h1 span { display: block; white-space: nowrap; }
h1 { margin: 0; font-size: clamp(30px, 3.4vw, 58px); line-height: 1.28; font-weight: 800; letter-spacing: .01em; }
h1 em { font-style: normal; color: var(--blue); }
.lead { margin: 26px 0 36px; font-size: 16px; line-height: 1.9; color: var(--text); }
.lead b { color: var(--ink); }
.hero-actions { display: flex; align-items: center; gap: 22px; flex-wrap: wrap; }

.cta {
  display: inline-flex; align-items: center; gap: 12px;
  background: var(--blue); color: #fff; border: 0; cursor: pointer;
  padding: 15px 34px; border-radius: 999px; font-size: 16px; font-weight: 600; letter-spacing: .1em;
  box-shadow: 0 12px 30px rgba(31, 68, 196, .28); transition: transform .25s, box-shadow .25s, background .25s;
}
.cta svg { width: 18px; height: 18px; transition: transform .25s; }
.cta:hover { background: #1a39a6; transform: translateY(-2px); box-shadow: 0 16px 36px rgba(31, 68, 196, .34); }
.cta:hover svg { transform: translateX(4px); }
.cta.light { background: #fff; color: var(--blue-deep); box-shadow: 0 12px 30px rgba(0, 0, 0, .2); }
.cta.light:hover { background: #fff; }
.ghost { color: var(--text); text-decoration: none; font-size: 15px; border-bottom: 1px solid var(--line); padding-bottom: 2px; }
.ghost:hover { color: var(--blue); border-color: var(--blue); }

.stats { display: flex; gap: 44px; margin: 56px 0 0; padding-top: 26px; border-top: 1px solid var(--line); }
.stats dt { font-size: 12px; color: var(--muted); letter-spacing: .1em; }
.stats dd { margin: 6px 0 0; font-size: 34px; font-weight: 800; letter-spacing: -.01em; }
.stats small { font-size: 13px; font-weight: 500; color: var(--muted); margin-left: 4px; }

/* 首屏右侧：三张幻灯片叠放 */
/* 首屏右侧：模拟编辑器 */
.ed-wrap { position: relative; z-index: 1; animation: enter 1.1s cubic-bezier(.2, .7, .1, 1) .2s both; }
.ed-glow { position: absolute; inset: 8% -4% -6% 6%; z-index: -1; border-radius: 40px; filter: blur(50px); opacity: .55;
  background: linear-gradient(120deg, rgba(31, 68, 196, .55), rgba(120, 170, 255, .35) 50%, rgba(240, 122, 44, .5)); }
.ed {
  position: relative; border-radius: 16px; overflow: hidden; background: rgba(255, 255, 255, .92);
  box-shadow: 0 1px 0 rgba(255, 255, 255, .9) inset, 0 0 0 1px rgba(20, 30, 70, .08), 0 20px 40px rgba(20, 30, 70, .10), 0 50px 100px rgba(20, 30, 70, .16);
  font-size: 12px; color: var(--text);
}
.ed-bar { display: flex; align-items: center; gap: 14px; height: 46px; padding: 0 14px; background: linear-gradient(#fbfcfe, #f3f5fa); border-bottom: 1px solid #e8ebf3; }
.dots { display: flex; gap: 7px; }
.dots i { width: 11px; height: 11px; border-radius: 50%; background: #ff6a5a; box-shadow: inset 0 0 0 .5px rgba(0, 0, 0, .12); }
.dots i:nth-child(2) { background: #ffc03a; } .dots i:nth-child(3) { background: #3ccf6a; }
.ed-name { display: flex; align-items: center; gap: 6px; font-weight: 600; color: var(--ink); font-size: 13px; }
.ed-name svg { width: 15px; height: 15px; color: var(--blue); }
.seg { margin-left: auto; display: flex; padding: 3px; border-radius: 8px; background: #e9ecf4; }
.seg > * { padding: 4px 12px; border-radius: 6px; font-size: 12px; }
.seg b { background: #fff; color: var(--ink); font-weight: 600; box-shadow: 0 1px 2px rgba(20, 30, 70, .12); }
.ed-icons { display: flex; gap: 10px; color: var(--muted); }
.ed-icons svg { width: 16px; height: 16px; }
.ed-export { display: flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 600; color: #fff; padding: 7px 14px; border-radius: 8px;
  background: linear-gradient(180deg, #f58a43, #ea6c1c); box-shadow: 0 1px 0 rgba(255, 255, 255, .35) inset, 0 4px 12px rgba(240, 122, 44, .35); transition: .2s; }
.ed-export svg { width: 14px; height: 14px; }
.ed-export.busy { background: #c4cad8; box-shadow: none; }
.ed-body { display: grid; grid-template-columns: 13% 1fr 17%; background: #eef1f7; }
.ed-rail { display: flex; flex-direction: column; gap: 10px; padding: 14px 8px 14px 10px; background: #f7f8fb; border-right: 1px solid #e8ebf3; }
.ed-thumb { display: flex; gap: 6px; align-items: flex-start; }
.ed-thumb em { font-style: normal; font-size: 10px; color: var(--muted); width: 8px; padding-top: 2px; }
.ed-thumb .tv { flex: 1; aspect-ratio: 16 / 9; border-radius: 4px; overflow: hidden; background: #fff; box-shadow: 0 0 0 1px #e1e5ee; opacity: .8; }
.ed-thumb.on .tv { box-shadow: 0 0 0 2px var(--blue), 0 3px 8px rgba(31, 68, 196, .2); opacity: 1; }
.ed-thumb.on em { color: var(--blue); font-weight: 700; }
.ed-thumb img { width: 100%; height: 100%; object-fit: cover; }
.mini { position: relative; height: 100%; padding: 22% 0 0 8%; box-sizing: border-box; }
.mini b, .mini s { display: block; height: 8%; width: 34%; background: var(--ink); margin-bottom: 7%; border-radius: 2px; transition: background .3s; }
.mini b.hl { background: linear-gradient(90deg, var(--ink) 30%, var(--orange) 30% 70%, var(--ink) 70%); }
.mini s { width: 26%; height: 4%; background: #c9cfdd; }
.mini i { position: absolute; right: 0; top: 0; width: 42%; height: 100%; clip-path: polygon(18% 0, 100% 0, 100% 100%, 0 100%); }
.ed-canvas { padding: 22px 20px; display: flex; align-items: center;
  background-image: radial-gradient(circle, #dfe3ec 1px, transparent 1.2px); background-size: 14px 14px; }
.ed-slide {
  container-type: inline-size; position: relative; width: 100%; aspect-ratio: 16 / 9; overflow: hidden; border-radius: 3px;
  background: linear-gradient(120deg, #fff 45%, #f3f6ff); box-shadow: 0 0 0 1px rgba(20, 30, 70, .06), 0 10px 30px rgba(20, 30, 70, .14);
}
.es-kicker { position: absolute; left: 7%; top: 14%; margin: 0; font-size: 1.5cqw; font-weight: 700; letter-spacing: .25em; color: var(--orange); }
.es-title { position: absolute; left: 6%; top: 24%; margin: 0; padding: .4cqw 1cqw; font-size: 5.4cqw; font-weight: 800; color: var(--ink); white-space: nowrap; outline: 1.5px solid transparent; border-radius: 2px; transition: outline-color .2s; }
.es-title.sel { outline-color: var(--blue); }
.es-title.all { background: rgba(31, 68, 196, .16); }
.es-title em { font-style: normal; color: var(--orange); transition: color .3s; }
.hd { position: absolute; width: .9cqw; height: .9cqw; background: #fff; border: 1.5px solid var(--blue); border-radius: 2px; opacity: 0; transition: opacity .2s; }
.es-title.sel .hd { opacity: 1; }
.hd.tl { left: -.5cqw; top: -.5cqw; } .hd.tr { right: -.5cqw; top: -.5cqw; } .hd.bl { left: -.5cqw; bottom: -.5cqw; } .hd.br { right: -.5cqw; bottom: -.5cqw; }
.caret { display: inline-block; width: 2px; height: 1em; margin-left: 2px; vertical-align: -.12em; background: var(--blue); animation: caret 1s steps(1) infinite; }
@keyframes caret { 50% { opacity: 0 } }
.es-sub { position: absolute; left: 7%; top: 45%; margin: 0; font-size: 1.8cqw; color: var(--text); }
.es-sub::before { content: ''; display: inline-block; width: 3cqw; height: 2px; margin-right: 1cqw; vertical-align: middle; background: var(--orange); }
.es-metrics { position: absolute; left: 7%; bottom: 13%; display: flex; gap: 5cqw; }
.es-metrics > div { padding-left: 1.4cqw; border-left: 1px solid #e1e5ee; }
.es-metrics > div:first-child { padding-left: 0; border: 0; }
.es-metrics b { display: block; font-size: 4.2cqw; font-weight: 800; color: var(--blue); letter-spacing: -.02em; }
.es-metrics span { font-size: 1.4cqw; color: var(--muted); }
/* 素材是一整页幻灯片，只取里面那张人物照片（原图 813×462 里 x 421-729 / y 43-416） */
.es-photo, .mini i { background-size: 300% auto; background-position: 81% 48%; background-repeat: no-repeat; }
.es-photo { position: absolute; right: 0; top: 0; width: 42%; height: 100%; clip-path: polygon(18% 0, 100% 0, 100% 100%, 0 100%); }
.ed-tools {
  position: absolute; left: 7%; top: 3%; display: flex; align-items: center; gap: .3cqw; padding: .5cqw; border-radius: 1cqw; background: #fff;
  box-shadow: 0 0 0 1px rgba(20, 30, 70, .06), 0 10px 26px rgba(20, 30, 70, .2); font-size: 1.5cqw; opacity: 0; transform: translateY(6px) scale(.97); transition: .25s; pointer-events: none;
}
.ed-tools.show { opacity: 1; transform: none; }
.ed-tools span { min-width: 3cqw; height: 3cqw; display: grid; place-items: center; border-radius: .6cqw; color: var(--ink); }
.ed-tools span:first-child { background: #eef2ff; color: var(--blue); }
.ed-tools .del { color: #d4453a; }
.ed-tools .div { width: 1px; height: 2cqw; background: #e4e8f2; }
.ed-tools .sw { width: 1.9cqw; min-width: 1.9cqw; height: 1.9cqw; margin: 0 .4cqw; border-radius: 50%; box-shadow: 0 0 0 2px #fff, 0 0 0 3px #e4e8f2; }
.sw.k { background: var(--ink); }
.ed-inspect { padding: 14px 12px; background: #fff; border-left: 1px solid #e8ebf3; display: flex; flex-direction: column; gap: 10px; }
.ins-h { margin: 0 0 4px; font-size: 12px; font-weight: 700; color: var(--ink); }
.ed-inspect label { display: flex; flex-direction: column; gap: 5px; font-size: 10.5px; color: var(--muted); }
.ed-inspect .val { display: flex; align-items: center; gap: 6px; padding: 6px 8px; border-radius: 6px; background: #f4f6fa; color: var(--ink); font-size: 11.5px; font-variant-numeric: tabular-nums; }
.chip { width: 12px; height: 12px; border-radius: 3px; background: var(--ink); transition: background .3s; }
.chip.o { background: var(--orange); } .chip.b { background: var(--blue); }
.val.al { gap: 2px; padding: 3px; }
.val.al > * { flex: 1; text-align: center; padding: 2px 0; border-radius: 4px; font-weight: 400; color: var(--muted); }
.val.al b { background: #fff; color: var(--blue); box-shadow: 0 1px 2px rgba(20, 30, 70, .12); }
.ins-tip { margin: auto 0 0; padding: 8px; border-radius: 6px; background: #fff6ef; color: #b95a1c; font-size: 10.5px; line-height: 1.5; }
.ed-status { display: flex; justify-content: space-between; padding: 8px 16px; font-size: 11px; color: var(--muted); background: #fbfcfe; border-top: 1px solid #e8ebf3; }
.ed-status .ok { display: inline-block; width: 6px; height: 6px; margin-right: 6px; border-radius: 50%; background: #3ccf6a; vertical-align: 1px; }
.ed-toast {
  position: absolute; left: 50%; bottom: 46px; display: flex; align-items: center; gap: 10px; transform: translate(-50%, 12px); opacity: 0; transition: .35s cubic-bezier(.2, .7, .1, 1);
  background: rgba(20, 26, 46, .94); backdrop-filter: blur(8px); color: #fff; font-size: 13px; font-weight: 600; padding: 11px 18px 11px 12px; border-radius: 12px; white-space: nowrap; box-shadow: 0 16px 36px rgba(0, 0, 0, .28);
}
.ed-toast i { font-style: normal; width: 22px; height: 22px; display: grid; place-items: center; border-radius: 50%; background: #3ccf6a; font-size: 12px; }
.ed-toast span { font-weight: 400; color: rgba(255, 255, 255, .65); font-size: 12px; }
.ed-toast.show { opacity: 1; transform: translate(-50%, 0); }
.ed-cursor { position: absolute; left: 0; top: 0; width: 24px; height: 24px; margin: -3px 0 0 -3px; z-index: 5; transition: transform .85s cubic-bezier(.45, .05, .25, 1); filter: drop-shadow(0 3px 4px rgba(0, 0, 0, .28)); }
.ed-cursor path { transition: fill .1s; }
.ed-cursor.click { transform-origin: 3px 3px; }
.ed-cursor.click path { fill: var(--blue); }
@keyframes up { from { opacity: 0; transform: translateY(24px) } to { opacity: 1; transform: none } }
@keyframes enter { from { opacity: 0; transform: translateY(40px) scale(.96) } to { opacity: 1; transform: none } }

/* 胶片带 */
.reel { overflow: hidden; padding: 16px 0; background: var(--blue-deep); mask-image: linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent); }
.reel-track { display: flex; gap: 14px; width: max-content; animation: reel 60s linear infinite; }
.reel-track img { height: 110px; aspect-ratio: 16 / 9; object-fit: cover; border-radius: 4px; opacity: .92; }
.reel:hover .reel-track { animation-play-state: paused; }
@keyframes reel { to { transform: translateX(calc(-50% - 7px)) } }

/* 章节通用 */
section { position: relative; }
.sec-head { text-align: center; margin: 0 auto 64px; max-width: 760px; }
.chapter { display: inline-block; font-size: 12px; font-weight: 700; letter-spacing: .35em; color: var(--orange); margin-bottom: 16px; }
h2 { margin: 0; font-size: clamp(26px, 3vw, 42px); line-height: 1.35; font-weight: 800; }
h2 .hl { color: var(--blue); }
.sec-sub { margin: 16px 0 0; color: var(--text); font-size: 15px; }
.reveal { opacity: 0; transform: translateY(36px); transition: opacity .9s ease, transform .9s cubic-bezier(.2, .7, .1, 1); }
.reveal.in { opacity: 1; transform: none; }

/* 使用方法 */
.how { padding: 130px 5vw 60px; max-width: 1240px; margin: 0 auto; }
.steps { list-style: none; margin: 0 0 90px; padding: 0; display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; counter-reset: s; }
.steps li { position: relative; background: #fff; border: 1px solid var(--line); border-radius: 14px; padding: 28px 26px 30px; }
.steps li:not(:last-child)::after { content: '→'; position: absolute; right: -17px; top: 34px; color: #b9c1d8; font-size: 16px; z-index: 1; }
.step-no { font: 700 13px ui-monospace, Menlo, monospace; color: var(--muted); letter-spacing: .1em; }
.steps h3 { margin: 12px 0 10px; font-size: 20px; }
.steps p { margin: 0; font-size: 14px; line-height: 1.85; color: var(--text); }

.spot { display: grid; grid-template-columns: minmax(0, .9fr) minmax(0, 1.1fr); gap: 5vw; align-items: center; margin-bottom: 120px; }
.spot.flip .spot-text { order: 2; }
.spot-no { display: inline-block; font: 800 14px ui-monospace, Menlo, monospace; color: #fff; background: var(--orange); padding: 5px 11px; border-radius: 6px; letter-spacing: .1em; }
.spot h3 { margin: 18px 0 18px; font-size: clamp(26px, 2.6vw, 38px); line-height: 1.3; font-weight: 800; }
.spot-lead { margin: 0 0 26px; font-size: 15px; line-height: 1.95; color: var(--text); }
.spot-lead b { color: var(--blue); }
.edit-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.edit-list li { display: flex; gap: 14px; align-items: baseline; padding: 12px 16px; background: #fff; border: 1px solid var(--line); border-radius: 10px; font-size: 14px; }
.edit-list b { flex: 0 0 88px; color: var(--ink); }
.edit-list span { color: var(--text); }

.formats { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.fmt { padding: 16px 18px; border-radius: 12px; background: #fff; border: 1px solid var(--line); }
.fmt b { display: block; font: 800 20px ui-monospace, Menlo, monospace; margin-bottom: 6px; color: var(--ink); }
.fmt span { font-size: 13px; color: var(--text); line-height: 1.6; }
.fmt.main { background: linear-gradient(135deg, #fff4ec, #fff); border-color: rgba(240, 122, 44, .45); }
.fmt.main b { color: var(--orange); }
.fine { margin: 16px 0 0; font-size: 12px; color: var(--muted); line-height: 1.7; }

/* 示意窗口 */
.win { border-radius: 12px; overflow: hidden; background: #fff; box-shadow: 0 30px 70px rgba(20, 30, 70, .16), 0 0 0 1px var(--line); }
.win-bar { display: flex; align-items: center; gap: 7px; padding: 11px 14px; background: #f1f3f9; border-bottom: 1px solid var(--line); }
.win-bar i { width: 10px; height: 10px; border-radius: 50%; background: #d7dbe6; }
.win-bar i:first-child { background: #ff6a5a; } .win-bar i:nth-child(2) { background: #ffc03a; } .win-bar i:nth-child(3) { background: #3ccf6a; }
.win-bar span { margin-left: 10px; font-size: 12px; color: var(--muted); }
.win-body { position: relative; }
.win-body img { width: 100%; aspect-ratio: 16 / 9; object-fit: cover; }
.toolbar {
  position: absolute; left: 6%; top: 8%; display: flex; gap: 2px; padding: 5px; border-radius: 9px;
  background: #fff; box-shadow: 0 10px 26px rgba(20, 30, 70, .22); font-size: 13px; animation: float 4s ease-in-out infinite;
}
.toolbar span { min-width: 26px; height: 26px; display: grid; place-items: center; border-radius: 6px; color: var(--ink); }
.toolbar span:first-child { background: #eef2ff; color: var(--blue); }
.toolbar .sw { width: 14px; min-width: 14px; height: 14px; margin: 6px; border-radius: 50%; }
.sw.o { background: var(--orange); } .sw.b { background: var(--blue); }
@keyframes float { 50% { transform: translateY(-6px) } }

.ppt-body { display: grid; grid-template-columns: 1fr 170px; background: #e9ebf0; }
.ppt-slide { position: relative; margin: 18px; align-self: center; box-shadow: 0 6px 18px rgba(0, 0, 0, .12); }
.ppt-slide img { width: 100%; aspect-ratio: 16 / 9; object-fit: cover; }
.box { position: absolute; border: 1.5px dashed var(--blue); border-radius: 2px; }
.box.b1 { left: 6%; top: 29%; width: 42%; height: 28%; border-style: solid; box-shadow: 0 0 0 3px rgba(31, 68, 196, .15); }
.box.b2 { left: 6%; top: 62%; width: 46%; height: 8%; }
.box.b3 { left: 60%; top: 0; width: 40%; height: 70%; border-color: var(--orange); }
.pane { background: #fff; border-left: 1px solid var(--line); padding: 12px 0; font-size: 12px; }
.pane p { margin: 0 12px 8px; font-weight: 700; color: var(--ink); }
.pane ul { list-style: none; margin: 0; padding: 0; }
.pane li { display: flex; justify-content: space-between; gap: 6px; padding: 7px 12px; color: var(--text); }
.pane li em { font-style: normal; color: var(--muted); font-size: 11px; }
.pane li.on { background: #eef2ff; color: var(--blue); }

/* 案例 */
.cases { padding: 60px 5vw 130px; max-width: 1240px; margin: 0 auto; }
.grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 26px; }
.card { border: 0; padding: 0; background: none; cursor: zoom-in; text-align: left; }
.thumb { border-radius: 10px; overflow: hidden; box-shadow: 0 14px 34px rgba(20, 30, 70, .12), 0 0 0 1px var(--line); }
.thumb img { width: 100%; aspect-ratio: 16 / 9; object-fit: cover; transition: transform .7s cubic-bezier(.2, .7, .1, 1); }
.card:hover .thumb img { transform: scale(1.05); }
.card-meta { display: flex; justify-content: space-between; align-items: baseline; margin-top: 12px; font-size: 14px; }
.card-meta span { font-size: 12px; color: var(--muted); }

/* 收尾 */
.finale { position: relative; overflow: hidden; padding: 140px 24px; text-align: center; color: #fff; }
.finale-bg { position: absolute; inset: 0; }
/* 背景那张自己也有一行大标题，不糊掉的话和上面的标题叠成两层字 */
.finale-bg img { width: 100%; height: 100%; object-fit: cover; object-position: right center; filter: blur(10px); transform: scale(1.12); }
.finale-bg::after { content: ''; position: absolute; inset: 0; background: linear-gradient(90deg, rgba(15, 42, 122, .8), rgba(15, 42, 122, .35)); }
.finale-inner { position: relative; }
.finale h2 { color: #fff; margin-bottom: 40px; }

/* 看大图 */
.lightbox { position: fixed; inset: 0; z-index: 2000; display: flex; align-items: center; justify-content: center; gap: 18px; background: rgba(12, 18, 40, .82); backdrop-filter: blur(6px); padding: 24px; }
.lightbox figure { margin: 0; max-width: min(1200px, 86vw); }
.lightbox img { width: 100%; border-radius: 8px; box-shadow: 0 30px 80px rgba(0, 0, 0, .5); }
.lightbox figcaption { margin-top: 14px; text-align: center; color: rgba(255, 255, 255, .8); font-size: 14px; }
.lb-nav, .lb-close { border: 0; background: rgba(255, 255, 255, .12); color: #fff; cursor: pointer; border-radius: 50%; width: 44px; height: 44px; font-size: 26px; line-height: 1; flex: none; }
.lb-nav:hover, .lb-close:hover { background: rgba(255, 255, 255, .24); }
.lb-close { position: absolute; top: 20px; right: 20px; }
.zoom-enter-active, .zoom-leave-active { transition: opacity .3s; }
.zoom-enter-from, .zoom-leave-to { opacity: 0; }

@media (max-width: 900px) {
  .hero { grid-template-columns: 1fr; padding-top: 96px; }
  .ed-wrap { margin-top: 10px; }
  .ed-body { grid-template-columns: 15% 1fr; }
  .ed-inspect, .seg, .ed-icons { display: none; }
  .ed-export { margin-left: auto; }
  .ed-toast span { display: none; }
  .steps, .grid { grid-template-columns: 1fr; }
  .steps li:not(:last-child)::after { content: none; }
  .spot { grid-template-columns: 1fr; gap: 30px; }
  .spot.flip .spot-text { order: 0; }
  .stats { gap: 26px; }
  .ppt-body { grid-template-columns: 1fr; }
  .pane { display: none; }
  .formats { grid-template-columns: 1fr; }
}
@media (prefers-reduced-motion: reduce) {
  .reel-track, .toolbar, .hero-copy, .ed-wrap, .caret { animation: none; }
  .reveal { opacity: 1; transform: none; transition: none; }
}
</style>
