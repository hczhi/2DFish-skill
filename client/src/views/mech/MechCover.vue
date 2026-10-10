<script setup lang="ts">
import SiteHeader from '../../components/common/SiteHeader.vue'
import MechViewer from '../../components/mech/MechViewer.vue'
import { VIEWS } from '../../components/mech/MechStage'
import { COVER_CASE, GEARBOX_CASE, billOfMaterials, shaftRatios } from '../../components/mech/mechCases'
import { PARTS } from '../../components/mech/mechParts'

// 「最大的齿轮转 1 圈时各自转几圈」—— 按咬合的齿数比算，不写死。
const ratios = shaftRatios(COVER_CASE)
const slowest = Math.min(...ratios.values())
const teethOf = (id: string) => {
  const g = COVER_CASE.shafts.find((s) => s.id === id)!.parts.find((p) => 'teeth' in PARTS[p.part])!
  return (PARTS[g.part] as { teeth: number }).teeth
}
const tags = Object.fromEntries(
  [...ratios].map(([id, r]) => [id, { title: `${teethOf(id)} 齿`, sub: `转 ${+(r / slowest).toFixed(1)} 圈` }]),
)
const ratio = `${Math.max(...ratios.values()) / slowest} : 1`
const partIds = billOfMaterials(COVER_CASE).map((r) => r.id)

const boxRatio = Math.round(1 / Math.min(...shaftRatios(GEARBOX_CASE).values()))
// 有 to 的是已经做好的案例页，卡片整张可点；没有的显示「制作中」。
const CASES: { name: string; idea: string; tag: string; to?: string }[] = [
  { name: '齿轮传动', idea: `三级减速齿轮箱：摇 ${boxRatio} 圈手柄，输出轴才转 1 圈。`, tag: '传动比', to: '/mech/gearbox' },
  { name: '蜗轮蜗杆', idea: '转很多圈只推一格，还能自己卡住不倒转。', tag: '减速 · 自锁' },
  { name: '齿条齿轮', idea: '汽车转向器：方向盘一转，齿条推着两个前轮拐弯。', tag: '旋转变直线', to: '/mech/steering' },
  { name: '曲柄连杆', idea: '直列四缸发动机：活塞上下跑，曲轴跟着转。', tag: '往复运动', to: '/mech/engine' },
  { name: '凸轮', idea: '一个不圆的轮子，让杆子一下一下跳起来。', tag: '间歇运动' },
  { name: '差速器', idea: '转弯时外侧轮子为什么要转得更快？', tag: '转速分配' },
]
</script>

<template>
  <div class="mc">
    <SiteHeader />
    <nav class="nav">
      <span class="brand"><i></i>机械积木课堂</span>
    </nav>

    <section class="hero">
      <div class="hero-bg" aria-hidden="true"><span class="sun"></span></div>

      <div class="hero-copy">
        <p class="kicker">MECHANICS · 用真积木讲机械</p>
        <h1><span><mark>转一转</mark>，</span><span>就看懂机械。</span></h1>
        <p class="lead">
          画面里的每一个零件都是<b>真实的积木零件</b>，照着屏幕就能拼出实物。<br />
          齿轮、连杆、凸轮……让孩子自己摇一摇，看懂力是怎么一格一格传过去的。
        </p>
        <div class="actions">
          <a href="#cases" class="cta">
            看看有哪些机构
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 5v14M6 13l6 6 6-6" /></svg>
          </a>
        </div>
        <dl class="stats">
          <div><dt>右边这组的传动比</dt><dd>{{ ratio }}</dd></div>
          <div><dt>用到的真零件</dt><dd>{{ partIds.length }}<small>种</small></dd></div>
          <div><dt>固定观察角度</dt><dd>{{ Object.keys(VIEWS).length }}<small>个</small></dd></div>
        </dl>
      </div>

      <MechViewer :mech="COVER_CASE" :tags="tags" :caption="`最大的齿轮转 1 圈时，每个齿轮各转几圈 · 零件 ${partIds.join(' / ')}`" />
    </section>

    <section id="cases" class="cases">
      <header>
        <span class="chapter">MECHANISMS</span>
        <h2>机构案例</h2>
        <p>每个机构都用真零件搭好，能换角度看，也能一键拆开看里面。</p>
      </header>
      <ul class="grid">
        <li v-for="(c, i) in CASES" :key="c.name" :class="{ ready: c.to }">
          <component :is="c.to ? 'router-link' : 'div'" :to="c.to" class="card">
            <span class="no">{{ String(i + 1).padStart(2, '0') }}</span>
            <h3>{{ c.name }}</h3>
            <p>{{ c.idea }}</p>
            <footer><em>{{ c.tag }}</em><span>{{ c.to ? '去看看 →' : '制作中' }}</span></footer>
          </component>
        </li>
      </ul>
    </section>

    <footer class="credit">
      零件几何数据来自 <a href="https://www.ldraw.org" target="_blank" rel="noopener">LDraw.org</a> 零件库，按 CC BY 2.0 / 4.0 授权使用。
      LEGO® 是乐高集团的商标，本站与乐高集团无关。
    </footer>
  </div>
</template>

<style scoped>
.mc {
  --yellow: #ffc928;
  --yellow-deep: #f2a900;
  --yellow-soft: #fff1bf;
  --cream: #fffaf0;
  --ink: #1d1d1f;
  --text: #55524a;
  --muted: #9a958a;
  --line: #eee6d3;
  --blue: #2f6bff;
  min-height: 100vh;
  background: var(--cream);
  color: var(--ink);
  overflow-x: hidden;
  font-family: "PingFang SC", "Noto Sans SC", "Helvetica Neue", sans-serif;
}

.nav { position: absolute; top: 50px; left: 0; right: 0; z-index: 5; padding: 22px 5vw; }
.brand { display: inline-flex; align-items: center; gap: 10px; font-weight: 800; font-size: 16px; letter-spacing: .04em; }
.brand i {
  width: 24px; height: 16px; border-radius: 4px; background: var(--yellow); border: 2px solid var(--ink);
  box-shadow: inset 5px 0 0 -3px var(--ink);
}

/* 首屏：整块背景，右半边是演示 */
.hero {
  position: relative; min-height: 100vh; box-sizing: border-box;
  display: grid; grid-template-columns: minmax(0, .85fr) minmax(0, 1.25fr); align-items: center; gap: 2vw;
  padding: 140px 5vw 60px; max-width: 1640px; margin: 0 auto;
}
.hero-bg {
  position: absolute; inset: 0 -30vw; z-index: 0; pointer-events: none; overflow: hidden;
  /* 积木凸点那种圆点网格，很淡 */
  background-image: radial-gradient(circle, rgba(29, 29, 31, .07) 1.6px, transparent 1.8px);
  background-size: 28px 28px;
}
.sun {
  position: absolute; right: 26vw; top: 50%; width: min(78vh, 60vw); aspect-ratio: 1; transform: translate(35%, -50%);
  border-radius: 50%; background: var(--yellow); border: 3px solid var(--ink);
  box-shadow: 14px 14px 0 var(--ink);
}

.hero-copy { position: relative; z-index: 2; }
.kicker { margin: 0 0 20px; font-size: 12px; font-weight: 800; letter-spacing: .3em; color: var(--yellow-deep); }
h1 { margin: 0; font-size: clamp(36px, 4.4vw, 68px); line-height: 1.22; font-weight: 900; letter-spacing: .02em; }
h1 span { display: block; white-space: nowrap; }
h1 mark { background: linear-gradient(transparent 58%, var(--yellow) 58%); color: inherit; padding: 0 .06em; }
.lead { margin: 26px 0 34px; font-size: 16px; line-height: 1.95; color: var(--text); max-width: 34em; }
.lead b { color: var(--ink); }

.cta {
  display: inline-flex; align-items: center; gap: 10px; text-decoration: none;
  padding: 15px 28px; border-radius: 16px; font-size: 16px; font-weight: 800;
  background: var(--yellow); color: var(--ink); border: 2.5px solid var(--ink); box-shadow: 4px 4px 0 var(--ink);
  transition: transform .15s, box-shadow .15s;
}
.cta svg { width: 18px; height: 18px; }
.cta:hover { transform: translate(-2px, -2px); box-shadow: 6px 6px 0 var(--ink); }
.cta:active { transform: translate(3px, 3px); box-shadow: 1px 1px 0 var(--ink); }

.stats { display: flex; gap: 14px; margin: 44px 0 0; flex-wrap: wrap; }
.stats div { background: #fff; border: 2px solid var(--ink); border-radius: 14px; padding: 12px 18px; min-width: 112px; }
.stats dt { font-size: 12px; color: var(--muted); }
.stats dd { margin: 4px 0 0; font-size: 26px; font-weight: 900; }
.stats small { font-size: 13px; font-weight: 600; margin-left: 2px; color: var(--text); }

/* 机构列表 */
.cases { max-width: 1240px; margin: 0 auto; padding: 90px 5vw 70px; }
.cases header { text-align: center; margin-bottom: 44px; }
.chapter { font-size: 12px; font-weight: 800; letter-spacing: .3em; color: var(--yellow-deep); }
.cases h2 { margin: 12px 0 10px; font-size: clamp(26px, 2.6vw, 38px); font-weight: 900; }
.cases header p { margin: 0; color: var(--text); }
.grid { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 22px; }
.grid li { display: flex; }
.card { flex: 1; background: #fff; border: 2.5px solid var(--ink); border-radius: 20px; padding: 24px 24px 20px; box-shadow: 5px 5px 0 var(--ink); display: flex; flex-direction: column; color: inherit; text-decoration: none; }
.grid li:not(.ready) .card { opacity: .6; }
.ready .card { transition: transform .15s, box-shadow .15s; }
.ready .card:hover { transform: translate(-2px, -2px); box-shadow: 7px 7px 0 var(--ink); }
.ready .no { background: var(--yellow); }
.no { width: 38px; height: 38px; border-radius: 50%; background: var(--yellow); border: 2px solid var(--ink); display: grid; place-items: center; font-weight: 900; font-size: 14px; }
.grid h3 { margin: 16px 0 8px; font-size: 20px; font-weight: 900; }
.grid p { margin: 0 0 18px; color: var(--text); line-height: 1.75; font-size: 14px; flex: 1; }
.grid footer { display: flex; justify-content: space-between; align-items: center; font-size: 12px; }
.grid em { font-style: normal; background: var(--yellow-soft); padding: 4px 10px; border-radius: 999px; font-weight: 700; }
.grid footer span { color: var(--muted); }
.ready footer span { color: var(--ink); font-weight: 800; }

.credit { text-align: center; font-size: 12px; color: var(--muted); padding: 24px 5vw 40px; line-height: 1.8; border-top: 1px solid var(--line); }
.credit a { color: inherit; }

@media (max-width: 960px) {
  .hero { grid-template-columns: 1fr; padding-top: 130px; }
  .sun { right: 50%; top: 72%; transform: translate(50%, -50%); width: 90vw; }
  .grid { grid-template-columns: 1fr; }
}
</style>
