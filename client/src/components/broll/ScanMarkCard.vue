<script setup lang="ts">
import { computed, toRef } from 'vue'
import { easeOutBack, easeOutCubic, lerp, progress } from './timeline'
import { useCardBase } from './cardBase'
import { useImageAspect, pointsOf } from './imageSize'
import { SC_AT, SC_DUR, scEnd, scHitAt } from './scanTimes'

// 「扫描标注」：一条强调色扫描线匀速从上往下扫过截图，扫过每个标注点的那一刻，取景框从 1.75 倍收拢对准它（带一下过冲 + 闪一下），
// 稍后旁边贴出标签；右上角状态行实时数 0/N → N/N → 「分析完成」。「AI 正在读这一页」的感觉，一次点出 N 处。
// 点位在截图上点（data.points，按从上到下排序，标签按排好的顺序对应 —— 和长截图慢滚一致）。截图必须上传。

export interface ScanMarkData { img: string; points: { x: number; y: number }[]; labels: string[]; done: string; accent: string; panel: boolean; duration: number }
const props = defineProps<{ data: ScanMarkData; t: number }>()
const emit = defineEmits<{ size: [{ w: number; h: number }] }>()
const { root, rootStyle } = useCardBase(props, emit)
const { el: imgEl, aspect, onLoad } = useImageAspect(toRef(() => props.data.img))

const BOX_W = 1200, BOX_H = 740
const size = computed(() => {
  const a = aspect.value || BOX_W / BOX_H
  return a >= BOX_W / BOX_H ? { w: BOX_W, h: BOX_W / a } : { w: BOX_H * a, h: BOX_H }
})
const pts = computed(() => [...pointsOf(props.data.points)].slice(0, 4).sort((a, b) => a.y - b.y))
const labels = computed(() => (props.data.labels || []).filter((s) => s?.trim()))
const scanY = computed(() => progress(props.t, SC_AT, SC_AT + SC_DUR) * size.value.h)
const scanOn = computed(() => props.t >= SC_AT && props.t <= SC_AT + SC_DUR + 0.15)
// 框的大小：占图宽 20%、图高 14%，夹在图里
const FW = 0.2, FH = 0.14
const marks = computed(() => pts.value.map((p, i) => {
  const { w, h } = size.value
  const bw = FW * w, bh = FH * h
  const cx = Math.min(w - bw / 2 - 6, Math.max(bw / 2 + 6, (p.x / 100) * w))
  const cy = Math.min(h - bh / 2 - 6, Math.max(bh / 2 + 6, (p.y / 100) * h))
  const hit = scHitAt(p.y)
  const k = progress(props.t, hit, hit + 0.35)
  const s = lerp(1.75, 1, easeOutBack(k))
  const flash = Math.sin(progress(props.t, hit + 0.25, hit + 0.45) * Math.PI)
  const lp = easeOutCubic(progress(props.t, hit + 0.17, hit + 0.5))
  const right = cx < w * 0.62
  return {
    frame: { left: `${cx - bw / 2}px`, top: `${cy - bh / 2}px`, width: `${bw}px`, height: `${bh}px`, opacity: k > 0 ? Math.min(1, k * 3) : 0, transform: `scale(${s})`, '--flash': flash },
    label: { left: right ? `${cx + bw / 2 + 18}px` : 'auto', right: right ? 'auto' : `${w - (cx - bw / 2) + 18}px`, top: `${cy}px`, opacity: lp, transform: `translate(${lerp(right ? -14 : 14, 0, lp)}px, -50%)` },
    text: labels.value[i] || '',
  }
}))
const hits = computed(() => pts.value.filter((p) => props.t >= scHitAt(p.y) + 0.2).length)
const status = computed(() => (props.t >= scEnd + 0.3 ? props.data.done || '分析完成' : `扫描中 ${hits.value}/${pts.value.length}`))
const winStyle = computed(() => {
  const p = easeOutCubic(progress(props.t, 0, 0.5))
  return { width: `${size.value.w}px`, height: `${size.value.h}px`, opacity: p, transform: `scale(${lerp(0.95, 1, p)})` }
})
</script>

<template>
  <div ref="root" class="sm" :style="rootStyle">
    <!-- 状态条在截图窗外面：放在窗里右上角的话会压住贴右上角的那个框 -->
    <div class="sm-status" :class="{ done: t >= SC_AT + SC_DUR + 0.3 }">{{ status }}</div>
    <div class="sm-win" :class="{ empty: !data.img }" :style="winStyle">
      <img v-if="data.img" ref="imgEl" class="sm-img" :src="data.img" alt="" @load="onLoad" />
      <span v-else class="sm-empty">待上传截图</span>
      <div v-if="scanOn" class="sm-scan" :style="{ top: `${scanY}px` }" />
      <div v-for="(m, i) in marks" :key="i" class="sm-frame" :style="m.frame"><i /><i /><i /><i /></div>
      <div v-for="(m, i) in marks" :key="`l${i}`" class="sm-label" :style="m.label"><b>{{ String(i + 1).padStart(2, '0') }}</b>{{ m.text }}</div>
    </div>
  </div>
</template>

<style scoped>
.sm { position: relative; display: flex; flex-direction: column; align-items: flex-end; gap: 14px; color: var(--fg); font-family: var(--font-cn); }
.sm-win { position: relative; border-radius: 18px; overflow: hidden; background: var(--tile); box-shadow: 0 40px 90px -20px var(--shadow-c), inset 0 0 0 1.5px var(--track); }
.sm-win.empty { display: grid; place-items: center; background: transparent; border: 4px dashed color-mix(in srgb, var(--accent) 70%, transparent); box-sizing: border-box; }
.sm-empty { font-size: 40px; color: var(--accent); }
.sm-img { position: absolute; inset: 0; display: block; width: 100%; height: 100%; }
.sm-scan {
  position: absolute; left: 0; right: 0; height: 4px; background: var(--accent); box-shadow: 0 0 18px var(--accent);
}
.sm-scan::after { content: ''; position: absolute; left: 0; right: 0; bottom: 4px; height: 90px; background: linear-gradient(0deg, color-mix(in srgb, var(--accent) 28%, transparent), transparent); }
.sm-frame { position: absolute; transform-origin: center; background: color-mix(in srgb, var(--accent) calc(var(--flash) * 22%), transparent); }
.sm-frame i { position: absolute; width: 26px; height: 26px; border: 0 solid var(--accent); filter: drop-shadow(0 0 6px var(--accent)); }
.sm-frame i:nth-child(1) { left: 0; top: 0; border-left-width: 5px; border-top-width: 5px; }
.sm-frame i:nth-child(2) { right: 0; top: 0; border-right-width: 5px; border-top-width: 5px; }
.sm-frame i:nth-child(3) { left: 0; bottom: 0; border-left-width: 5px; border-bottom-width: 5px; }
.sm-frame i:nth-child(4) { right: 0; bottom: 0; border-right-width: 5px; border-bottom-width: 5px; }
.sm-label {
  position: absolute; display: flex; align-items: center; gap: 12px; padding: 10px 20px; border-radius: 12px; white-space: nowrap;
  background: var(--panel); font-size: 34px; font-weight: 700; box-shadow: 0 16px 34px -12px var(--shadow-c), inset 0 0 0 2px var(--accent);
}
.sm-label b { font-family: var(--font-mono); font-size: 26px; color: var(--accent); }
.sm-status {
  padding: 8px 18px; border-radius: 10px; font-family: var(--font-mono), var(--font-cn); font-size: 28px; font-weight: 700;
  background: var(--panel); color: var(--accent); box-shadow: inset 0 0 0 2px var(--line);
}
.sm-status.done { background: var(--accent); color: var(--ink-on-accent); }
</style>
