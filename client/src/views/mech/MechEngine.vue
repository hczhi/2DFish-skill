<script setup lang="ts">
import SiteHeader from '../../components/common/SiteHeader.vue'
import MechViewer from '../../components/mech/MechViewer.vue'
import { ENGINE_CASE, billOfMaterials } from '../../components/mech/mechCases'
import { CRANK_THROW, LDU, ROD_LENGTH } from '../../components/mech/mechParts'

// 尺寸全按零件实测常量算（1 格 = LDU），不在文案里手写。
const grid = (n: number) => +(n / LDU).toFixed(2)
const throwGrid = grid(CRANK_THROW)
const stroke = grid(CRANK_THROW * 2)
const rodGrid = grid(ROD_LENGTH)
const cylinders = ENGINE_CASE.cranks?.length ?? 0

const tags = { crank: { title: '飞轮', sub: '存着转动的劲' } }

const bom = billOfMaterials(ENGINE_CASE).sort((a, b) => b.count - a.count)
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
        <p class="kicker">CASE 02 · 曲柄连杆</p>
        <h1>直列四缸<br />发动机</h1>
        <p class="lead">
          活塞只能<b>上下走</b>，曲轴却在<b>转圈</b>。中间靠连杆：一头跟着曲柄销画圆，一头推着活塞走直线。<br />
          四个曲拐错开 <b>180°</b>：1、4 缸往下的时候，2、3 缸正往上。
        </p>
        <dl class="stats">
          <div><dt>气缸</dt><dd>{{ cylinders }}<small>个</small></dd></div>
          <div><dt>活塞行程</dt><dd>{{ stroke }}<small>格</small></dd></div>
          <div><dt>真零件</dt><dd>{{ partCount }}<small>个</small></dd></div>
        </dl>
      </div>
      <MechViewer
        class="viewer" :mech="ENGINE_CASE" :tags="tags" explode
        caption="气缸画成了半透明，好看见里面的活塞（实物是不透明的灰色）· 「侧面」看四个活塞轮流上下，「背面」看飞轮"
      />
    </section>

    <section class="block">
      <h2>直线怎么变成转圈</h2>
      <ol class="stages">
        <li>
          <span class="no">1</span>
          <p class="pair"><b>偏心 {{ throwGrid }} 格</b></p>
          <p>曲柄销离曲轴中心 {{ throwGrid }} 格，转一圈，活塞就上下走 {{ stroke }} 格（行程 = 偏心 × 2）</p>
        </li>
        <li>
          <span class="no">2</span>
          <p class="pair"><b>连杆 {{ rodGrid }} 格</b></p>
          <p>连杆比偏心长得多，曲柄销转到侧面时也够得着活塞，活塞走得顺、不会卡住</p>
        </li>
        <li class="sum">
          <span class="no">3</span>
          <p class="pair"><b>错开 180°</b></p>
          <p>两组活塞总是反着走：总有一个在往下推，曲轴转得稳，整台机器也不会上下乱晃</p>
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
