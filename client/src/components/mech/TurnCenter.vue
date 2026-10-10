<script setup lang="ts">
import { computed } from 'vue'
import { TIE_ROD_LENGTH } from './mechParts'
import { knucklePose, rackTravel, turningCenter, type MechCase } from './mechCases'

// 方向盘往左打到头时的俯视示意图：两个前轮的轮轴线延长到后轴线上，落在哪、差多少。
// 全部从 turningCenter 算（和 3D 里的转角是同一份几何），图上不写任何手填的数。
// 朝向和 3D 的「顶部」视角一致（车头朝下）：画面 x = LDraw x、画面 y = -LDraw z。
// 两个轴一起翻等于转 180°，所以绕 Y 转 δ 在画面里还是 rotate(δ)。
const props = defineProps<{ mech: MechCase }>()

const D = 180 / Math.PI
const view = computed(() => {
  const c = props.mech
  const rack = c.racks![0]
  const shift = -Math.abs(rackTravel(c, rack, c.swing ?? 0)) // 往左打：左轮（+x）是内侧
  const t = turningCenter(c, shift)
  const rz = -t.rearAxle
  const front = rack.knuckles!.map((k) => {
    const pose = knucklePose(k, shift)!
    const w = t.inner.k === k ? t.inner : t.outer
    const tip = [pose.rodAt[0] + TIE_ROD_LENGTH * Math.sin(pose.rodYaw), pose.rodAt[2] + TIE_ROD_LENGTH * Math.cos(pose.rodYaw)]
    return {
      id: k.id,
      at: [w.center[0], -w.center[1]],
      deg: pose.delta * D,
      hit: w.x ?? 0,
      pin: [k.pivot[0], -k.pivot[2]],
      rod: [pose.rodAt[0], -pose.rodAt[2], tip[0], -tip[1]],
    }
  })
  const K = Math.abs(rack.knuckles![0].pivot[0])
  const wx = Math.abs(rack.knuckles![0].wheel[0])
  const zk = -rack.knuckles![0].pivot[2]
  const hits = front.map((f) => f.hit)
  const far = Math.max(...hits)
  const left = -(K + wx + 60)
  const top = rz - 180
  return {
    front,
    rear: [-1, 1].map((s) => s * (K + wx)),
    rz,
    zk,
    K,
    rack: [-100 + shift, 100 + shift],
    far,
    box: `${left} ${top} ${far + 140 - left} ${zk + 150 - top}`,
    inner: Math.abs(t.inner.delta * D),
    outer: Math.abs(t.outer.delta * D),
    ideal: Math.abs(t.ideal * D),
    // 1 LDU = 0.4 毫米。
    gapMm: Math.round(Math.abs(hits[0] - hits[1]) * 0.4),
    radiusCm: Math.round((far * 0.4) / 10),
  }
})
const f1 = (n: number) => n.toFixed(1)
</script>

<template>
  <figure class="turn">
    <svg :viewBox="view.box" role="img" aria-label="转弯中心俯视示意图">
      <!-- 后轴线延长出去 -->
      <line class="guide rear" :x1="view.rear[0] - 40" :y1="view.rz" :x2="view.far + 80" :y2="view.rz" />
      <!-- 两个前轮的轮轴线 -->
      <line v-for="f in view.front" :key="'l' + f.id" class="guide" :class="f.id" :x1="f.at[0]" :y1="f.at[1]" :x2="f.hit" :y2="view.rz" />
      <!-- 底盘 -->
      <g class="frame">
        <line :x1="-view.K" :y1="view.zk" :x2="view.K" :y2="view.zk" />
        <line :x1="-view.K" :y1="view.rz + 20" :x2="view.K" :y2="view.rz + 20" />
        <line v-for="s in [-80, 80]" :key="s" :x1="s" :y1="view.zk" :x2="s" :y2="view.rz + 20" />
      </g>
      <line class="rack" :x1="view.rack[0]" y1="0" :x2="view.rack[1]" y2="0" />
      <line v-for="f in view.front" :key="'r' + f.id" class="rod" :x1="f.rod[0]" :y1="f.rod[1]" :x2="f.rod[2]" :y2="f.rod[3]" />
      <line v-for="f in view.front" :key="'a' + f.id" class="arm" :x1="f.pin[0]" :y1="f.pin[1]" :x2="f.rod[2]" :y2="f.rod[3]" />
      <circle v-for="f in view.front" :key="'p' + f.id" class="pin" :cx="f.pin[0]" :cy="f.pin[1]" r="9" />
      <!-- 轮子：前轮按实际转角转过去 -->
      <rect v-for="f in view.front" :key="'w' + f.id" class="wheel" x="-22" y="-46" width="44" height="92" rx="10"
        :transform="`translate(${f.at[0]} ${f.at[1]}) rotate(${f.deg})`" />
      <rect v-for="x in view.rear" :key="'b' + x" class="wheel" x="-22" y="-46" width="44" height="92" rx="10"
        :transform="`translate(${x} ${view.rz})`" />
      <!-- 两条线落在后轴线上的点 -->
      <circle v-for="f in view.front" :key="'h' + f.id" class="hit" :class="f.id" :cx="f.hit" :cy="view.rz" r="12" />
      <text class="note" :x="view.far + 40" :y="view.rz - 110" text-anchor="end">这两个点离得越近，四个轮子越像绕着同一个圆心转</text>
      <text class="note" :x="view.far + 40" :y="view.rz - 66" text-anchor="end">现在差 {{ view.gapMm }} 毫米（转弯半径约 {{ view.radiusCm }} 厘米）</text>
      <text class="tag" x="0" :y="view.zk + 120" text-anchor="middle">车头</text>
    </svg>
    <figcaption>
      方向盘往左打到头：外侧轮转 <b>{{ f1(view.outer) }}°</b>。要让四个轮子绕同一个圆心转，内侧轮应该转
      <b>{{ f1(view.ideal) }}°</b>，这套拉杆实际转了 <b>{{ f1(view.inner) }}°</b>，只差 {{ f1(Math.abs(view.inner - view.ideal)) }}°。
      朝向和上面「顶部」视角一样，车头朝下。
    </figcaption>
  </figure>
</template>

<style scoped>
.turn { margin: 0; background: #fff; border: 2.5px solid var(--ink); border-radius: 20px; padding: 18px; box-shadow: 5px 5px 0 var(--ink); }
svg { width: 100%; height: auto; display: block; }
.guide { stroke-width: 5; stroke-dasharray: 16 10; stroke-linecap: round; }
.guide.rear { stroke: var(--muted); }
.guide.left, .hit.left { stroke: #e2503a; }
.guide.right, .hit.right { stroke: #2f7de1; }
.hit { fill: #fff; stroke-width: 6; }
.frame line { stroke: var(--yellow-deep); stroke-width: 20; stroke-linecap: round; }
.rack { stroke: #a0a5a9; stroke-width: 16; stroke-linecap: round; }
.rod { stroke: var(--ink); stroke-width: 9; stroke-linecap: round; }
.arm { stroke: #6c6e68; stroke-width: 9; stroke-linecap: round; }
.pin { fill: #fff; stroke: var(--ink); stroke-width: 4; }
.wheel { fill: #2b3640; stroke: var(--ink); stroke-width: 4; }
.note { font-size: 30px; fill: var(--text); font-weight: 700; }
.tag { font-size: 30px; fill: var(--ink); font-weight: 900; }
figcaption { margin-top: 12px; color: var(--text); line-height: 1.8; }
figcaption b { color: var(--ink); }
</style>
