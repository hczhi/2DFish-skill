<script setup lang="ts">
import SiteHeader from '../../components/common/SiteHeader.vue'
import MechViewer from '../../components/mech/MechViewer.vue'
import TurnCenter from '../../components/mech/TurnCenter.vue'
import { STEERING_CASE, billOfMaterials, rackPinion, rackTravel, shaftRatios, turningCenter } from '../../components/mech/mechCases'

// 行程、转角全按案例算：方向盘摆 ±swing，经过减速齿轮和万向节到小齿轮，齿条走多远由舞台同一份
// shaftAngles 算（rackTravel），前轮转角由拉杆几何反算。1 格 = 20 LDU ≈ 8 毫米。
const rack = STEERING_CASE.racks![0]
const pinion = rackPinion(STEERING_CASE, rack).shaft.id
const swing = STEERING_CASE.swing ?? 0
const stroke = Math.abs(rackTravel(STEERING_CASE, rack, swing))
const travelMm = +((stroke * 8) / 20).toFixed(1)
const reduction = Math.round(1 / shaftRatios(STEERING_CASE).get(pinion)!)
// 方向盘转几圈：能写成几分之几就写分数（孩子读「3/4 圈」比「0.75 圈」直观）。
const turns = (() => {
  const t = swing / (Math.PI * 2)
  const q = Math.round(t * 4)
  if (Math.abs(t * 4 - q) > 1e-6) return t.toFixed(2)
  const g = q % 4 === 0 ? 4 : q % 2 === 0 ? 2 : 1
  return q % 4 === 0 ? String(q / 4) : `${q / g}/${4 / g}`
})()
// 齿条往一边走到头时，两个轮子各转多少：转得多的那个是内侧轮。
const lock = turningCenter(STEERING_CASE, stroke)
const [inner, outer] = [lock.inner, lock.outer].map((w) => Math.round(Math.abs((w.delta * 180) / Math.PI)))

const tags = {
  column: { title: '方向盘', sub: `左右各 ${turns} 圈` },
  left: { title: '左前轮', sub: '转了 {v}°' },
  right: { title: '右前轮', sub: '转了 {v}°' },
}
const bom = billOfMaterials(STEERING_CASE).sort((a, b) => b.count - a.count)
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
        <p class="kicker">CASE 03 · 齿轮齿条</p>
        <h1>汽车<br />转向器</h1>
        <p class="lead">
          方向盘往一边打 <b>{{ turns }} 圈</b>，经过<b>万向节</b>和一组减速齿轮，下面那根<b>齿条</b>往一边走 <b>{{ travelMm }} 毫米</b>，
          两头的<b>拉杆</b>推着前轮绕着竖的<b>主销</b>拐过去。<br />
          仔细看两个轮子的读数：拐弯时里面那个轮子转得更多 —— 它走的是一个更小的圈。
          点「拆开」看底盘是怎么搭起来的。
        </p>
        <dl class="stats">
          <div><dt>方向盘 → 轮子</dt><dd>{{ turns }}<small>圈</small> → {{ inner }}°</dd></div>
          <div><dt>减速</dt><dd>{{ reduction }} : 1</dd></div>
          <div><dt>内侧 / 外侧轮</dt><dd>{{ inner }}° / {{ outer }}°</dd></div>
          <div><dt>真零件</dt><dd>{{ partCount }}<small>个</small></dd></div>
        </dl>
      </div>
      <MechViewer class="viewer" :mech="STEERING_CASE" :tags="tags" explode caption="切到「顶部」看拉杆怎么推着两个轮子拐，拐弯时里面那个轮子转得更多" />
    </section>

    <section class="block">
      <h2>为什么里面的轮子要多转一点</h2>
      <p class="hint">
        拐弯时四个轮子都在画圆，圆心得是同一个点，轮子才不会被拖着蹭地。从上往下看，把每个轮子的轮轴延长，
        它们应该交在后轴那条线上的同一点 —— 这就是「阿克曼转向」。
      </p>
      <TurnCenter :mech="STEERING_CASE" />
    </section>

    <section class="block">
      <h2>方向盘为什么要转那么多</h2>
      <p class="hint">
        方向盘先带着一个 8 齿小齿轮，它去转一个 24 齿大齿轮：方向盘转 {{ reduction }} 圈，下面的小齿轮才转 1 圈。
        转得多、推得轻 —— 真车打方向盘也是这样，不然停着车根本拧不动。<br />
        中间那个 8 齿是<b>惰轮</b>，它不改变快慢，只把转的方向翻回来：少了它，方向盘往左打、车会往右拐。<br />
        方向盘那根轴是斜着的，底下的轴是平的，中间靠<b>万向节</b>拐这个弯。万向节其实转得一会儿快一会儿慢：这里只斜了 25°，
        快慢差不到 3°，看不出来；斜得越厉害差得越多，所以真车的转向柱尽量不斜太多。
      </p>
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
