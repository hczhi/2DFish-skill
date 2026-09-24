<template>
  <div class="hm">
    <SiteHeader />

    <!-- 首屏 -->
    <section class="hero">
      <div class="hero-bg" aria-hidden="true"><i class="blob b1"></i><i class="blob b2"></i></div>
      <div class="hero-text">
        <p class="kicker"><i class="mark"></i>QiaoNx<span>下一代 AI 生产力平台</span></p>
        <h1>构想即现实<br /><em>AI 交付成品</em></h1>
        <p class="lead">告别繁琐的对话框，用 AI 直接构建可交付的专业资产。</p>
        <div class="hero-cta">
          <router-link to="/ppt" class="btn btn-blue">创建演示文稿 <span>→</span></router-link>
          <router-link to="/consult" class="btn btn-ghost">开启品牌咨询 <span>→</span></router-link>
        </div>
        <ul class="facts">
          <li><b>1 点</b>单次文本操作</li>
          <li><b>5 点</b>生成一张插图</li>
          <li><b>0 元</b>无基础订阅费</li>
        </ul>
      </div>

      <div class="wall" aria-hidden="true">
        <div class="wall-in">
          <div v-for="(col, ci) in WALL" :key="ci" class="col" :class="'c' + ci">
            <div class="track">
              <img v-for="(src, k) in [...col, ...col]" :key="k" :src="src" alt="" />
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- 应用 01：展示稿 -->
    <section class="app app-ppt">
      <div class="app-inner">
        <div class="app-text">
          <span class="num">01</span>
          <p class="tag">HTML 演示文稿</p>
          <h2>从一个灵感，<br />到一份专业的演示。</h2>
          <ul class="pts">
            <li><b>智能规划</b>对话生成提纲，或上传现有文档解析</li>
            <li><b>全局掌控</b>一键切换全局版式，保持设计语言高度统一</li>
            <li><b>所见即所得</b>双击修改文本，拖拽替换图片，修改免扣点数</li>
          </ul>
          <router-link to="/ppt" class="btn btn-blue">立即体验 <span>→</span></router-link>
        </div>
        <router-link to="/ppt" class="shot">
          <div class="chrome"><i></i><i></i><i></i><span>演示文稿 · 实时编辑</span></div>
          <img :src="IMG.editing" alt="HTML 演示文稿编辑界面" loading="lazy" />
          <span class="chip chip-a">✓ 云端实时保存</span>
          <span class="chip chip-b">双击文本直接编辑</span>
        </router-link>
      </div>
    </section>

    <!-- 应用 02：品牌咨询 -->
    <section class="app app-cst">
      <div class="app-inner">
        <div class="board" aria-hidden="true">
          <div class="bd-head">
            <span class="bd-title"><i></i>品牌咨询 · 某精品咖啡</span>
            <span class="bd-looks">
              <em v-for="l in ['自己', '行业', '竞品', '用户']" :key="l">✓ {{ l }}</em>
            </span>
          </div>
          <div class="bd-grid">
            <div v-for="c in BOARD" :key="c.k" class="bd-card" :class="{ hot: c.hot, warn: !c.hot }">
              <div class="bd-k"><b>{{ c.k }}</b><span>{{ c.tip }}</span></div>
              <p>{{ c.v }}</p>
              <div class="bd-meta"><span>依据 {{ c.refs }} 条</span><i><s :style="{ width: c.conf + '%' }"></s></i></div>
            </div>
            <span class="bd-core">品牌</span>
          </div>
          <div class="bd-toast">
            <b>!</b>
            <div>你改了「定位」<span>请同步核对 价值 · 信任 · 关系</span></div>
          </div>
        </div>
        <div class="app-text">
          <span class="num">02</span>
          <p class="tag">AI 品牌咨询</p>
          <h2>将抽象的战略，<br />转化为可落地的决策。</h2>
          <ul class="pts">
            <li><b>全局视野</b>洞察自身、行业、竞品与用户，建立客观基线</li>
            <li><b>四维构建</b>联动定位、价值、信任与关系，牵一发而动全身</li>
            <li><b>知识沉淀</b>决策过程与逻辑自动留痕，构建企业专属知识库</li>
          </ul>
          <router-link to="/consult" class="btn btn-orange">开始咨询 <span>→</span></router-link>
        </div>
      </div>
    </section>

    <!-- 怎么用 -->
    <section class="how">
      <h2 class="sec">即刻开启创造</h2>
      <ol class="steps">
        <li v-for="(s, i) in STEPS" :key="s.no">
          <div class="st-art" aria-hidden="true">
            <div v-if="i === 0" class="art-key">
              <span class="ak-app"><i></i>HTML 展示稿</span>
              <code>PPT-7K2M-····-H8WB</code>
              <span class="ak-pts">200 <small>点</small></span>
            </div>
            <div v-else-if="i === 1" class="art-input">
              <label>输入你的 Key</label>
              <div class="ai-row"><code>PPT-7K2M-····</code><span>进入 →</span></div>
            </div>
            <div v-else class="art-topup">
              <code>PPTCZ-····-Q4XN</code>
              <span class="at-ok">✓ 已充入 100 点</span>
              <span class="at-bal">现在可用 <b>268</b> 点</span>
            </div>
          </div>
          <div class="st-text">
            <span class="st-no">STEP {{ s.no }}</span>
            <h3>{{ s.name }}</h3>
            <p>{{ s.desc }}</p>
          </div>
        </li>
      </ol>
      <div class="price">
        <div><b>1</b><span>点 / 单次文本操作</span></div>
        <div><b>5</b><span>点 / 生成一张插图</span></div>
        <div><b>0</b><span>调用失败不扣费</span></div>
      </div>
    </section>

    <!-- 购买 / 合作 -->
    <section class="buy">
      <div class="buy-in">
        <p class="buy-k">点数充值 · 企业级合作 · 私有化部署</p>
        <h2>小红书搜 <em>小智同学Hc</em></h2>
        <p class="buy-sub">发送私信即可。如需团队账号管理、定制专属模型，或集成至您的内部系统，也请通过此渠道联系。</p>
        <button class="btn btn-white" @click="copyName">{{ copied ? '已复制 ✓' : '复制小红书号' }}</button>
        <p v-if="copyErr" class="copy-err">{{ copyErr }}</p>
      </div>
    </section>

    <!-- 文章 -->
    <section v-if="articles.length" class="posts">
      <div class="posts-head">
        <h2 class="sec">文章</h2>
        <router-link :to="locale === 'en' ? '/en/discover' : '/discover'" class="more">全部文章 →</router-link>
      </div>
      <div class="post-grid">
        <router-link :to="link(lead)" class="post-lead">
          <div class="cover">
            <img v-if="lead.cover_image" :src="lead.cover_image" alt="" loading="lazy" referrerpolicy="no-referrer" />
            <span v-else class="ph"><i class="mark"></i></span>
          </div>
          <h3>{{ lead.title }}</h3>
          <p v-if="lead.summary">{{ lead.summary }}</p>
        </router-link>
        <div class="post-list">
          <router-link v-for="(a, i) in rest" :key="a.slug" :to="link(a)" class="post-row">
            <span class="idx">{{ String(i + 2).padStart(2, '0') }}</span>
            <div>
              <h3>{{ a.title }}</h3>
              <p v-if="a.summary">{{ a.summary }}</p>
            </div>
            <span class="arr">→</span>
          </router-link>
        </div>
      </div>
    </section>

    <footer class="foot">
      <div class="foot-row">
        <nav>
          <router-link to="/privacy">隐私政策</router-link>
          <router-link to="/terms">服务条款</router-link>
          <span>联系：小红书 小智同学Hc</span>
          <a href="/sitemap.xml">网站地图</a>
        </nav>
        <span class="copy">© {{ year }} QiaoNx</span>
      </div>
      <div class="wordmark" aria-hidden="true">QiaoNx</div>
    </footer>
  </div>
</template>

<script setup lang="ts">
// 首页文案改了要同步改 server/src/services/ssgService.ts 的 renderHomepageContent：
// 那份是搜索引擎收录和首屏先看到的，只改这里的话线上先闪一下旧文案，收录的一直是旧版。
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { apiGet } from '../lib/api'
import SiteHeader from '../components/common/SiteHeader.vue'

interface Article {
  slug: string
  title: string
  summary?: string
  cover_image?: string
}

const route = useRoute()
const locale = computed(() => (route.path === '/en' ? 'en' : 'zh'))
const year = new Date().getFullYear()

const P = (p: string) => `https://file.qiaonan.vip/uploads/2026/09/24/${p}`
const IMG = {
  cover: P('fd43e5a2-2184-42d2-87b6-00e99ed4dc25.png'),
  pipeline: P('24504225-e46d-4699-b1ea-925dadfd76ce.png'),
  five: P('95fe2ffd-e92f-4f91-b3cc-ea0c818377a1.png'),
  cards: P('5e20f20f-88e8-4d78-ad0f-651e058bd230.png'),
  photo: P('1720da8f-a8e8-4927-ac49-cd27473fe89c.png'),
  party: P('b6cfa510-fc0f-48bf-9e0d-afb7a5126ce3.png'),
  agenda: P('91a0cf75-a3a0-44b8-92a1-0a5a599aef14.png'),
  resume: P('4dffcbe3-16a8-42b9-b9bb-4453d6cc01f0.png'),
  editing: P('497758e1-3b72-4147-9233-23a79ebbf6fc.jpg'),
  consult: 'http://file.qiaonan.vip/uploads/2026/09/01/90892237-f079-493e-b2e4-13c15d0106e5.jpg',
}

// 首屏右侧的「稿子墙」：三列真实生成的页面，上下错向滚动。
const WALL = [
  [IMG.cover, IMG.five, IMG.party],
  [IMG.cards, IMG.agenda, IMG.photo],
  [IMG.pipeline, IMG.resume, IMG.cover],
]

// 咨询面板里的示例内容，只做展示。
const BOARD = [
  { k: '定位', tip: '刚改过', v: '城市通勤人群的第一杯精品咖啡', refs: 6, conf: 86, hot: true },
  { k: '价值', tip: '待核对', v: '3 分钟取杯，口味不打折', refs: 4, conf: 72 },
  { k: '信任', tip: '待核对', v: '自有烘焙厂，每批次公开检测', refs: 5, conf: 78 },
  { k: '关系', tip: '待核对', v: '按月订杯，周末门店品鉴', refs: 3, conf: 64 },
]

const STEPS = [
  { no: '01', name: '获取密钥', desc: '购买专属 Key，内置初始点数额度。' },
  { no: '02', name: '即开即用', desc: '无需繁琐注册，输入 Key 即可进入工作台。' },
  { no: '03', name: '按需充值', desc: '点数用尽随时充值，资产安全永久保留。' },
]

const articles = ref<Article[]>([])
const lead = computed(() => articles.value[0])
const rest = computed(() => articles.value.slice(1, 5))
const link = (a: Article) => (locale.value === 'en' ? `/en/discover/${a.slug}` : `/discover/${a.slug}`)

// 文章只是首页底部的一块，接口挂了就不显示这一块，不影响上面的应用入口。
async function loadArticles() {
  try {
    const data = await apiGet<any>('/api/discover/articles', { locale: locale.value, limit: 8 })
    const list = ((data.items || data) as Article[]).filter(a => a.title)
    // 有封面的排第一篇，大图位不放占位块。
    const i = list.findIndex(a => a.cover_image)
    if (i > 0) list.unshift(...list.splice(i, 1))
    articles.value = list.slice(0, 5)
  } catch { /* 同上 */ }
}

const copied = ref(false)
const copyErr = ref('')
// 复制失败要说出来：静默的话他会拿着剪贴板里别的东西去小红书搜。
async function copyName() {
  copyErr.value = ''
  try {
    await navigator.clipboard.writeText('小智同学Hc')
    copied.value = true
    setTimeout(() => (copied.value = false), 2000)
  } catch {
    copyErr.value = '浏览器不允许复制，请手动输入：小智同学Hc'
  }
}

onMounted(() => {
  // SSG 预渲染的首页带了一段内联样式，挂载后移掉，免得串到本页上。
  document.getElementById('ssg-critical-css')?.remove()
  loadArticles()
})
</script>

<style scoped>
.hm {
  --blue: #1f44c4;
  --blue-deep: #0f2a7a;
  --navy: #0b1638;
  --orange: #f07a2c;
  --ink: #141a2e;
  --text: #4a5270;
  --muted: #8a91a8;
  --line: #e4e8f2;
  --bg: #f6f8fd;
  min-height: 100vh;
  background: var(--bg);
  color: var(--ink);
  font-family: "PingFang SC", "Noto Sans SC", "Helvetica Neue", sans-serif;
  overflow-x: hidden;
}
h1, h2, h3 { font-family: inherit; margin: 0; }
a { color: inherit; text-decoration: none; }
.mark {
  display: inline-block; width: 22px; height: 14px; border-radius: 3px;
  background: linear-gradient(120deg, var(--blue) 60%, var(--orange) 60%);
}

.btn {
  display: inline-flex; align-items: center; gap: 10px; height: 52px; padding: 0 28px;
  border-radius: 999px; font-size: 15px; font-weight: 600; border: 0; cursor: pointer;
  transition: transform .25s, box-shadow .25s, background .25s, color .25s;
}
.btn span { transition: transform .25s; }
.btn:hover span { transform: translateX(4px); }
.btn:hover { transform: translateY(-2px); }
.btn-blue { background: var(--blue); color: #fff; box-shadow: 0 14px 30px -12px rgba(31, 68, 196, .8); }
.btn-orange { background: var(--orange); color: #fff; box-shadow: 0 14px 30px -12px rgba(240, 122, 44, .8); }
.btn-ghost { background: rgba(255, 255, 255, .7); color: var(--ink); box-shadow: inset 0 0 0 1.5px var(--line); backdrop-filter: blur(6px); }
.btn-ghost:hover { box-shadow: inset 0 0 0 1.5px var(--blue); color: var(--blue); }
.btn-white { background: #fff; color: var(--blue-deep); }

/* ── 首屏 ── */
.hero {
  position: relative; min-height: 100vh; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  align-items: center; padding: 90px 0 40px 7vw; overflow: hidden;
}
/* 网格往下渐隐，和下一段之间不留硬边 */
.hero::before {
  content: ''; position: absolute; inset: 0; pointer-events: none;
  background:
    linear-gradient(rgba(31, 68, 196, .06) 1px, transparent 1px) 0 0 / 56px 56px,
    linear-gradient(90deg, rgba(31, 68, 196, .06) 1px, transparent 1px) 0 0 / 56px 56px;
  -webkit-mask-image: linear-gradient(#000 55%, transparent);
  mask-image: linear-gradient(#000 55%, transparent);
}
.hero-bg { position: absolute; inset: 0; pointer-events: none; }
.blob { position: absolute; border-radius: 50%; filter: blur(80px); }
.b1 { width: 520px; height: 520px; left: -160px; top: -120px; background: rgba(31, 68, 196, .18); }
.b2 { width: 420px; height: 420px; left: 30%; bottom: -120px; background: rgba(240, 122, 44, .18); }
.hero-text { position: relative; z-index: 2; }
.kicker { display: flex; align-items: center; gap: 10px; margin: 0 0 30px; font-weight: 800; font-size: 15px; letter-spacing: .02em; }
.kicker span { font-weight: 500; color: var(--muted); padding-left: 10px; border-left: 1px solid var(--line); }
.hero h1 { font-size: clamp(42px, 5.6vw, 92px); line-height: 1.08; font-weight: 900; letter-spacing: -.02em; }
.hero h1 em {
  font-style: normal; background: linear-gradient(100deg, var(--blue) 30%, #5b3fd6 70%, var(--orange));
  -webkit-background-clip: text; background-clip: text; color: transparent;
}
.lead { margin: 26px 0 40px; font-size: 18px; color: var(--text); }
.hero-cta { display: flex; gap: 14px; flex-wrap: wrap; }
.facts { list-style: none; display: flex; gap: 34px; padding: 0; margin: 56px 0 0; }
.facts li { font-size: 13px; color: var(--muted); }
.facts b { display: block; font-size: 22px; color: var(--ink); font-weight: 800; margin-bottom: 2px; }

.wall {
  position: relative; height: 100vh; margin: -90px 0 -40px; perspective: 1400px;
  -webkit-mask-image: linear-gradient(transparent, #000 16%, #000 80%, transparent);
  mask-image: linear-gradient(transparent, #000 16%, #000 80%, transparent);
}
.wall-in {
  position: absolute; inset: -20% -30% -20% 4%; display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px;
  transform: rotateX(18deg) rotateY(-16deg) rotateZ(8deg); transform-style: preserve-3d;
}
.col { overflow: hidden; }
.track { display: flex; flex-direction: column; gap: 20px; transform: translateY(-10%); }
.c1 .track { transform: translateY(-15%); }
.c2 .track { transform: translateY(-5%); }
.track img {
  width: 100%; aspect-ratio: 16 / 9; object-fit: cover; border-radius: 12px; background: #fff;
  box-shadow: 0 24px 50px -20px rgba(15, 42, 122, .45);
}

/* ── 应用 ── */
.app { padding: 130px 7vw; }
.app-inner { max-width: 1280px; margin: 0 auto; display: grid; grid-template-columns: minmax(0, .85fr) minmax(0, 1.15fr); gap: 7vw; align-items: center; }
.app-cst .app-inner { grid-template-columns: minmax(0, 1.05fr) minmax(0, .95fr); }
.app-text { position: relative; }
.num {
  position: absolute; top: -90px; left: -8px; font-size: 150px; font-weight: 900; line-height: 1;
  color: transparent; -webkit-text-stroke: 1.5px rgba(31, 68, 196, .16); z-index: 0; pointer-events: none;
}
.tag {
  position: relative; display: inline-block; margin: 0 0 18px; padding: 6px 14px; border-radius: 999px;
  font-size: 13px; font-weight: 700; color: var(--blue); background: rgba(31, 68, 196, .08);
}
.app h2 { position: relative; font-size: clamp(30px, 3.2vw, 50px); line-height: 1.2; font-weight: 900; letter-spacing: -.01em; }
.pts { list-style: none; padding: 0; margin: 36px 0 40px; display: flex; flex-direction: column; }
.pts li { display: flex; gap: 18px; padding: 16px 0; border-top: 1px solid var(--line); font-size: 15px; color: var(--text); line-height: 1.6; }
.pts li:last-child { border-bottom: 1px solid var(--line); }
.pts b { flex: none; width: 5.5em; color: var(--ink); font-weight: 700; }

.shot {
  position: relative; display: block; border-radius: 16px; background: #fff; padding: 0 0 0;
  box-shadow: 0 50px 90px -40px rgba(15, 42, 122, .5), 0 0 0 1px rgba(20, 26, 46, .06);
  transition: transform .5s cubic-bezier(.2, .7, .1, 1);
}
.shot:hover { transform: translateY(-6px); }
.chrome { display: flex; align-items: center; gap: 7px; height: 38px; padding: 0 16px; border-bottom: 1px solid var(--line); }
.chrome i { width: 10px; height: 10px; border-radius: 50%; background: #e3e6ef; }
.chrome i:first-child { background: #ff6159; } .chrome i:nth-child(2) { background: #ffbd2e; } .chrome i:nth-child(3) { background: #28c940; }
.chrome span { margin-left: 12px; font-size: 12px; color: var(--muted); }
.shot img { display: block; width: 100%; aspect-ratio: 16 / 10; object-fit: cover; border-radius: 0 0 16px 16px; }
.chip {
  position: absolute; padding: 10px 16px; border-radius: 12px; background: #fff; font-size: 13px; font-weight: 600;
  box-shadow: 0 18px 40px -16px rgba(15, 42, 122, .45);
}
.chip-a { left: -28px; bottom: 16%; color: #16833a; }
.chip-b { right: -22px; top: 22%; color: var(--blue); }

.app-cst {
  background: var(--ink); color: #fff; position: relative; overflow: hidden;
  border-radius: 32px; margin: 40px 4vw; padding: 100px 5vw;
}
.app-cst::before {
  content: ''; position: absolute; inset: 0;
  background-image: url('https://file.qiaonan.vip/uploads/2026/09/03/01bf04c8-8d07-4af2-b94a-4261ee342576.png');
  background-size: cover; background-position: center; opacity: 0.3; pointer-events: none;
}
.app-cst::after {
  content: ''; position: absolute; inset: 0;
  background: rgba(20, 26, 46, 0.6); backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px); pointer-events: none;
}
.app-cst .app-inner { position: relative; z-index: 1; }
.app-cst .num { -webkit-text-stroke-color: rgba(255, 255, 255, .1); }
.app-cst .tag { color: var(--orange); background: rgba(240, 122, 44, .15); }
.app-cst .pts li { border-color: rgba(255, 255, 255, .1); color: rgba(255, 255, 255, .7); }
.app-cst .pts b { color: #fff; }

.board {
  position: relative; border-radius: 22px; padding: 22px;
  background: linear-gradient(160deg, rgba(255, 255, 255, .1), rgba(255, 255, 255, .03));
  border: 1px solid rgba(255, 255, 255, .12);
  box-shadow: 0 50px 100px -40px rgba(0, 0, 0, .8), inset 0 1px 0 rgba(255, 255, 255, .1);
}
.bd-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 18px; }
.bd-title { display: flex; align-items: center; gap: 10px; font-size: 14px; font-weight: 700; }
.bd-title i { width: 8px; height: 8px; border-radius: 50%; background: #3ddc84; box-shadow: 0 0 0 4px rgba(61, 220, 132, .15); }
.bd-looks { display: flex; gap: 6px; }
.bd-looks em { font-style: normal; font-size: 12px; padding: 4px 10px; border-radius: 999px; background: rgba(61, 220, 132, .12); color: #7ee8ae; }
.bd-grid { position: relative; display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.bd-card { border-radius: 14px; padding: 18px 18px 16px; background: rgba(10, 16, 36, .72); border: 1px solid rgba(255, 255, 255, .08); }
.bd-card.hot { border-color: rgba(240, 122, 44, .75); background: linear-gradient(160deg, rgba(240, 122, 44, .22), rgba(10, 16, 36, .72) 70%); }
.bd-k { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
.bd-k b { font-size: 16px; }
.bd-k span { font-size: 11px; padding: 2px 8px; border-radius: 6px; }
.bd-card.hot .bd-k span { background: var(--orange); color: #fff; }
.bd-card.warn .bd-k span { background: rgba(255, 197, 92, .14); color: #ffc55c; }
.bd-card p { margin: 0 0 16px; min-height: 3.2em; font-size: 14px; line-height: 1.6; color: rgba(255, 255, 255, .82); }
.bd-meta { display: flex; align-items: center; gap: 10px; font-size: 11px; color: rgba(255, 255, 255, .45); }
.bd-meta i { flex: 1; height: 4px; border-radius: 2px; background: rgba(255, 255, 255, .08); overflow: hidden; }
.bd-meta s { display: block; height: 100%; border-radius: 2px; background: linear-gradient(90deg, #5b7cff, #9db2ff); }
.bd-card.hot .bd-meta s { background: linear-gradient(90deg, var(--orange), #ffb27d); }
.bd-core {
  position: absolute; left: 50%; top: 50%; width: 58px; height: 58px; margin: -29px 0 0 -29px; border-radius: 50%;
  display: grid; place-items: center; font-size: 13px; font-weight: 800;
  background: linear-gradient(135deg, var(--orange), #d9531b);
  box-shadow: 0 0 0 7px #1a2036, 0 0 0 8px rgba(255, 255, 255, .14);
}
.bd-toast {
  position: absolute; right: -26px; bottom: -30px; display: flex; align-items: center; gap: 12px;
  padding: 14px 18px; border-radius: 14px; background: #fff; color: var(--ink); font-size: 13px; font-weight: 700;
  box-shadow: 0 24px 50px -16px rgba(0, 0, 0, .6);
}
.bd-toast b { width: 24px; height: 24px; flex: none; border-radius: 50%; display: grid; place-items: center; background: var(--orange); color: #fff; font-size: 13px; }
.bd-toast span { display: block; margin-top: 2px; font-size: 12px; font-weight: 500; color: var(--muted); }

/* ── 三步 ── */
.how, .posts { max-width: 1280px; margin: 0 auto; padding: 130px 7vw 0; box-sizing: content-box; }
.sec { font-size: clamp(28px, 2.8vw, 42px); font-weight: 900; letter-spacing: -.01em; }
.steps { list-style: none; padding: 0; margin: 50px 0 0; display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; }
.steps li {
  position: relative; display: flex; flex-direction: column; border-radius: 22px; background: #fff;
  border: 1px solid var(--line); box-shadow: 0 30px 60px -44px rgba(15, 42, 122, .45);
  transition: transform .35s cubic-bezier(.2, .7, .1, 1), box-shadow .35s;
}
.steps li:hover { transform: translateY(-4px); box-shadow: 0 40px 70px -40px rgba(15, 42, 122, .5); }
.steps li:not(:last-child)::after {
  content: '→'; position: absolute; right: -20px; top: 86px; z-index: 2; width: 16px; text-align: center; font-size: 14px; color: var(--muted);
}
.st-art {
  height: 190px; display: grid; place-items: center; padding: 0 26px; border-radius: 22px 22px 0 0; border-bottom: 1px solid var(--line);
  background:
    radial-gradient(80% 90% at 50% 100%, rgba(31, 68, 196, .1), transparent 70%),
    linear-gradient(rgba(31, 68, 196, .05) 1px, transparent 1px) 0 0 / 22px 22px,
    linear-gradient(90deg, rgba(31, 68, 196, .05) 1px, transparent 1px) 0 0 / 22px 22px, #f8faff;
}
.steps li:last-child .st-art { background-color: #fffaf6; }
.st-art code { font-family: "SF Mono", "JetBrains Mono", Menlo, monospace; letter-spacing: .04em; }
.art-key {
  width: 100%; max-width: 240px; aspect-ratio: 1.6; box-sizing: border-box; border-radius: 14px; padding: 16px 18px; color: #fff;
  display: flex; flex-direction: column; justify-content: space-between; position: relative; overflow: hidden;
  background: linear-gradient(135deg, #3b63ea, var(--blue-deep));
  box-shadow: 0 20px 36px -16px rgba(15, 42, 122, .7); transform: rotate(-4deg);
}
.art-key::after { content: ''; position: absolute; right: -30px; top: -40px; width: 120px; height: 120px; border-radius: 50%; background: radial-gradient(closest-side, rgba(240, 122, 44, .7), transparent); }
.ak-app { display: flex; align-items: center; gap: 7px; font-size: 11px; opacity: .8; }
.ak-app i { width: 14px; height: 9px; border-radius: 2px; background: linear-gradient(120deg, #fff 60%, var(--orange) 60%); }
.art-key code { font-size: 13px; }
.ak-pts { font-size: 24px; font-weight: 800; line-height: 1; }
.ak-pts small { font-size: 12px; font-weight: 500; opacity: .7; }
.art-input { width: 100%; max-width: 270px; box-sizing: border-box; border-radius: 14px; background: #fff; padding: 16px; box-shadow: 0 20px 40px -20px rgba(15, 42, 122, .4), 0 0 0 1px var(--line); }
.art-input label { display: block; font-size: 12px; font-weight: 700; margin-bottom: 10px; color: var(--ink); }
.ai-row { display: flex; gap: 8px; }
.ai-row code { flex: 1; min-width: 0; font-size: 12px; padding: 9px 10px; border-radius: 8px; color: var(--ink); box-shadow: inset 0 0 0 1.5px var(--blue); background: #f5f7ff; }
.ai-row span { flex: none; padding: 9px 12px; border-radius: 8px; background: var(--blue); color: #fff; font-size: 12px; font-weight: 700; }
.art-topup {
  width: 100%; max-width: 240px; box-sizing: border-box; border-radius: 14px; background: #fff; padding: 16px 18px;
  display: flex; flex-direction: column; gap: 8px; box-shadow: 0 20px 40px -20px rgba(240, 122, 44, .45), 0 0 0 1px #f6e2d4;
}
.art-topup code { font-size: 12px; color: var(--muted); text-decoration: line-through; }
.at-ok { font-size: 14px; font-weight: 800; color: #16833a; }
.at-bal { font-size: 12px; color: var(--muted); }
.at-bal b { color: var(--orange); font-size: 16px; }
.st-text { padding: 24px 28px 30px; }
.st-no { font-size: 11px; font-weight: 800; letter-spacing: .16em; color: var(--blue); }
.steps li:last-child .st-no { color: var(--orange); }
.steps h3 { font-size: 21px; font-weight: 800; margin: 8px 0; color: var(--ink); }
.steps p { margin: 0; font-size: 14px; color: var(--text); line-height: 1.7; }
.price { display: grid; grid-template-columns: repeat(3, 1fr); margin-top: 24px; border-radius: 18px; background: var(--ink); color: #fff; overflow: hidden; }
.price div { display: flex; align-items: baseline; gap: 10px; padding: 22px 28px; }
.price div + div { border-left: 1px solid rgba(255, 255, 255, .1); }
.price b { font-size: 30px; font-weight: 900; color: #ffb27d; line-height: 1; }
.price span { font-size: 14px; color: rgba(255, 255, 255, .7); }

/* ── 购买 ── */
.buy { padding: 130px 7vw 0; }
.buy-in {
  max-width: 1280px; margin: 0 auto; box-sizing: border-box; position: relative; overflow: hidden;
  padding: 90px 7%; border-radius: 32px; color: #fff; text-align: center;
  background: radial-gradient(120% 140% at 100% 0%, #3b63ea 0%, var(--blue) 35%, var(--blue-deep) 100%);
}
.buy-in::before, .buy-in::after { content: ''; position: absolute; border-radius: 50%; pointer-events: none; }
.buy-in::before { width: 420px; height: 420px; left: -140px; bottom: -220px; background: radial-gradient(closest-side, rgba(240, 122, 44, .6), transparent); }
.buy-in::after { inset: 0; border-radius: 0; background: linear-gradient(rgba(255, 255, 255, .06) 1px, transparent 1px) 0 0 / 40px 40px, linear-gradient(90deg, rgba(255, 255, 255, .06) 1px, transparent 1px) 0 0 / 40px 40px; mask: radial-gradient(60% 80% at 50% 50%, #000, transparent); }
.buy-in > * { position: relative; z-index: 1; }
.buy-k { margin: 0 0 18px; font-size: 13px; letter-spacing: .2em; color: rgba(255, 255, 255, .6); }
.buy h2 { font-size: clamp(32px, 4.4vw, 64px); font-weight: 900; letter-spacing: -.01em; }
.buy h2 em { font-style: normal; color: #ffc59b; }
.buy-sub { margin: 20px auto 36px; max-width: 34em; font-size: 16px; line-height: 1.8; color: rgba(255, 255, 255, .75); }
.copy-err { margin: 14px 0 0; font-size: 13px; color: #ffd2b0; }

/* ── 文章 ── */
.posts-head { display: flex; align-items: baseline; justify-content: space-between; }
.more { font-size: 14px; color: var(--blue); font-weight: 700; }
.post-grid { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); gap: 56px; margin-top: 44px; }
.cover { aspect-ratio: 16 / 9; border-radius: 18px; overflow: hidden; margin-bottom: 22px; display: grid; place-items: center; background: linear-gradient(135deg, #e6ecfb, #fbeee4); }
.cover img { width: 100%; height: 100%; object-fit: cover; transition: transform .6s; }
.post-lead:hover .cover img { transform: scale(1.04); }
.ph .mark { width: 44px; height: 28px; opacity: .35; }
.post-lead h3 { font-size: 24px; font-weight: 800; line-height: 1.4; }
.post-lead p { margin: 10px 0 0; font-size: 15px; line-height: 1.8; color: var(--text); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.post-lead:hover h3, .post-row:hover h3 { color: var(--blue); }
.post-list { display: flex; flex-direction: column; }
.post-row { display: grid; grid-template-columns: 44px 1fr 20px; gap: 14px; padding: 26px 0; border-top: 1px solid var(--line); align-items: start; }
.post-row:last-child { border-bottom: 1px solid var(--line); }
.idx { font-size: 14px; font-weight: 800; color: var(--orange); padding-top: 3px; }
.post-row h3 { font-size: 17px; font-weight: 700; line-height: 1.5; }
.post-row p { margin: 6px 0 0; font-size: 13px; line-height: 1.7; color: var(--muted); display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden; }
.arr { color: var(--muted); transition: transform .25s, color .25s; padding-top: 2px; }
.post-row:hover .arr { transform: translateX(4px); color: var(--blue); }

/* ── 页脚 ── */
.foot { margin-top: 140px; padding: 0 7vw; overflow: hidden; }
.foot-row { max-width: 1280px; margin: 0 auto; display: flex; justify-content: space-between; gap: 20px; flex-wrap: wrap; padding: 28px 0; border-top: 1px solid var(--line); font-size: 13px; color: var(--muted); position: relative; z-index: 10; }
.foot nav { display: flex; gap: 26px; flex-wrap: wrap; }
.foot nav a:hover { color: var(--blue); }
.wordmark {
  text-align: center; font-size: 22vw; font-weight: 900; line-height: .8; letter-spacing: -.05em; margin-bottom: -3vw;
  background: linear-gradient(180deg, rgba(31, 68, 196, .14), rgba(31, 68, 196, 0) 85%);
  -webkit-background-clip: text; background-clip: text; color: transparent; user-select: none;
  pointer-events: none; /* 行高 .8，字形往上溢出会盖住链接那一行 */
}

/* ── 响应式 ── */
@media (max-width: 1000px) {
  .hero { grid-template-columns: 1fr; min-height: 0; padding: 120px 24px 0; }
  .wall { height: 380px; margin: 40px -24px 0 -24px; overflow: hidden; }
  .wall-in { inset: -30% -20% -30% -10%; }
  .facts { margin-top: 40px; }
  .app { padding: 90px 24px; }
  .app-inner, .app-cst .app-inner { grid-template-columns: 1fr; gap: 56px; }
  .app-ppt .shot { order: -1; }
  .chip-a { left: 10px; } .chip-b { right: 10px; }
  .num { font-size: 110px; top: -64px; }
  .how, .posts { padding: 90px 24px 0; }
  .steps { grid-template-columns: 1fr; gap: 16px; }
  .steps li:not(:last-child)::after { display: none; }
  .st-art { height: 180px; }
  .art-key { max-width: 210px; }
  .app-cst .app-inner { gap: 100px; }
  .price { grid-template-columns: 1fr; }
  .price div + div { border-left: 0; border-top: 1px solid rgba(255, 255, 255, .1); }
  .price div { padding: 16px 22px; }
  .bd-toast { right: 10px; bottom: -34px; }
  .buy { padding: 90px 16px 0; }
  .buy-in { padding: 64px 26px; border-radius: 24px; }
  .post-grid { grid-template-columns: 1fr; gap: 20px; }
  .foot { margin-top: 90px; padding: 0 24px; }
}
@media (max-width: 520px) {
  .hero h1 { font-size: 44px; }
  .facts { gap: 24px; }
  .pts li { flex-direction: column; gap: 4px; }
  .facts li { font-size: 12px; }
  .facts b { font-size: 18px; }
  .board { padding: 14px; }
  .bd-grid { gap: 10px; }
  .bd-card { padding: 14px 12px 12px; }
  .bd-card p { font-size: 12px; }
  .bd-looks { display: none; }
  .bd-core { width: 44px; height: 44px; margin: -22px 0 0 -22px; font-size: 11px; }
}
@media (prefers-reduced-motion: reduce) {
  .chip { animation: none; }
}
</style>
