<script setup lang="ts">
import SiteHeader from '../../components/common/SiteHeader.vue'
import MechViewer from '../../components/mech/MechViewer.vue'
import { GEARBOX_CASE, billOfMaterials, resolveMeshes, shaftRatios } from '../../components/mech/mechCases'

// 圈数、级数、零件数全按案例数据算 —— 改了案例，页面上的数字跟着变，不会一边写 27 一边实际是 9。
const ratios = shaftRatios(GEARBOX_CASE)
const slowest = Math.min(...ratios.values())
const turns = (id: string) => +(ratios.get(id)! / slowest).toFixed(1)
const total = turns(GEARBOX_CASE.shafts[0].id)

const NAMES: Record<string, string> = { in: '手柄轴', mid1: '中间轴 1', mid2: '中间轴 2', out: '输出轴' }
const tags = Object.fromEntries(GEARBOX_CASE.shafts.map((s) => [s.id, { title: NAMES[s.id] ?? s.id, sub: `转 ${turns(s.id)} 圈` }]))

const stages = resolveMeshes(GEARBOX_CASE).map((m, i) => ({
  no: i + 1,
  from: NAMES[m.from.id],
  to: NAMES[m.to.id],
  ta: m.ta,
  tb: m.tb,
  slow: +(m.tb / m.ta).toFixed(2),
}))

const bom = billOfMaterials(GEARBOX_CASE).sort((a, b) => b.count - a.count)
const partCount = bom.reduce((n, r) => n + r.count, 0)
</script>

<template>
  <div class="mc">
    <SiteHeader />
    <nav class="nav">
      <router-link to="/mech" class="brand"><i></i>机械积木课堂</router-link>
      <router-link to="/mech#cases" class="back">← 所有机构</router-link>
    </nav>

    <section class="hero">
      <div class="hero-bg" aria-hidden="true"></div>
      <div class="hero-copy">
        <p class="kicker">CASE 01 · 齿轮传动</p>
        <h1>三级减速<br />齿轮箱</h1>
        <p class="lead">
          摇 <b>{{ total }} 圈</b>手柄，后面的大圆盘才转 <b>1 圈</b>。<br />
          每一级都是小齿轮带大齿轮：转得慢了，力气就大了。三级连起来，慢的倍数要<b>乘起来</b>。
        </p>
        <dl class="stats">
          <div><dt>总传动比</dt><dd>{{ total }} : 1</dd></div>
          <div><dt>真零件</dt><dd>{{ partCount }}<small>个</small></dd></div>
          <div><dt>零件种类</dt><dd>{{ bom.length }}<small>种</small></dd></div>
        </dl>
      </div>
      <MechViewer class="viewer" :mech="GEARBOX_CASE" :tags="tags" explode caption="红色的是轴套，卡住齿轮不让它前后滑 · 切到「侧面」能看清三层齿轮" />
    </section>

    <section class="block">
      <h2>一级一级慢下来</h2>
      <ol class="stages">
        <li v-for="s in stages" :key="s.no">
          <span class="no">{{ s.no }}</span>
          <p class="pair"><b>{{ s.ta }} 齿</b><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M5 12h14M13 6l6 6-6 6" /></svg><b>{{ s.tb }} 齿</b></p>
          <p>{{ s.from }} 带动 {{ s.to }}，慢 {{ s.slow }} 倍</p>
        </li>
        <li class="sum">
          <span class="no">=</span>
          <p class="pair"><b>{{ stages.map((s) => s.slow).join(' × ') }}</b></p>
          <p>一共慢 {{ total }} 倍</p>
        </li>
      </ol>
    </section>

    <section class="block">
      <h2>零件清单</h2>
      <p class="hint">按零件编号就能买到同样的零件。</p>
      <ul class="bom">
        <li v-for="r in bom" :key="r.id + r.color">
          <i :style="{ background: r.hex }"></i>
          <span class="name">{{ r.name }}<small>{{ r.colorName }} · {{ r.id }}</small></span>
          <b>× {{ r.count }}</b>
        </li>
      </ul>
    </section>

    <footer class="credit">
      零件几何数据来自 <a href="https://www.ldraw.org" target="_blank" rel="noopener">LDraw.org</a> 零件库，按 CC BY 2.0 / 4.0 授权使用。
      LEGO® 是乐高集团的商标，本站与乐高集团无关。
    </footer>
  </div>
</template>

<style scoped src="../../components/mech/casePage.css"></style>
