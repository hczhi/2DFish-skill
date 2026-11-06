<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'

// 数字滚动计数：取字符串里第一个数字从 0 滚到它，前后文字原样保留（「3,126 万」「45%」「1.2 亿–1.8 亿」只滚第一个）。
// `still`（总览缩略图）直接显示终值。
const props = defineProps<{ v: string | number; delay?: number; still?: boolean }>()
const text = computed(() => String(props.v ?? ''))
const m = computed(() => text.value.match(/^(\D*?)(\d[\d,]*(?:\.\d+)?)([\s\S]*)$/))
const shown = ref(props.still || !m.value ? text.value : `${m.value[1]}0${m.value[3]}`)
let raf = 0
let t0 = 0
onMounted(() => {
  if (props.still || !m.value) return
  const [, pre, num, post] = m.value
  const target = Number(num.replace(/,/g, ''))
  const dec = (num.split('.')[1] || '').length
  const comma = num.includes(',')
  const fmt = (x: number) => {
    const s = x.toFixed(dec)
    return comma ? Number(s).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }) : s
  }
  const step = (now: number) => {
    if (!t0) t0 = now + (props.delay ?? 0)
    const p = Math.min(1, Math.max(0, (now - t0) / 900))
    const e = 1 - Math.pow(1 - p, 3)
    shown.value = `${pre}${fmt(target * e)}${post}`
    if (p < 1) raf = requestAnimationFrame(step)
    else shown.value = text.value
  }
  raf = requestAnimationFrame(step)
})
onUnmounted(() => cancelAnimationFrame(raf))
</script>

<template><span class="dk-num">{{ shown }}</span></template>
