<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { type Scene, type StyleId, type Plan, compile, prepare } from './scene'
import { createRenderer } from './renderers'

// 播放器：场景 JSON → 取笔顺 → 编译成 Plan → 按 t 画。画面只由 t 决定，拖进度条和逐帧导出看到的是同一帧。
const props = withDefaults(defineProps<{ scene: Scene; styleId: StyleId; autoplay?: boolean; loop?: boolean; controls?: boolean }>(), { autoplay: false, loop: false, controls: true })
const emit = defineEmits<{ (e: 'notes', notes: string[]): void }>()

const canvas = ref<HTMLCanvasElement | null>(null)
const t = ref(0)
const playing = ref(false)
const error = ref('')
const loading = ref(false)
const canvasKey = ref(0)
let plan: Plan | null = null
let renderer: { render: (t: number) => void; dispose: () => void } | null = null
let raf = 0, last = 0

async function build() {
  error.value = ''; loading.value = true
  stop(); renderer?.dispose(); renderer = null
  try {
    const ready = await prepare(props.scene)
    plan = compile(props.scene, props.styleId)
    emit('notes', [...ready, ...plan.notes])
    // 一块 canvas 只能拿一种 context（2D / WebGL2），换风格就换一块
    canvasKey.value++
    await nextTick()
    renderer = createRenderer(props.styleId, canvas.value!, plan)
    t.value = Math.min(t.value, plan.duration)
    renderer.render(t.value)
    if (props.autoplay) play()
  } catch (e: any) {
    error.value = e?.message || String(e)
  } finally {
    loading.value = false
  }
}

function frame(now: number) {
  if (!plan || !renderer) return
  t.value = Math.min(plan.duration, t.value + (now - last) / 1000)
  last = now
  renderer.render(t.value)
  if (t.value >= plan.duration) {
    if (props.loop) { t.value = 0; raf = requestAnimationFrame(frame); return }
    playing.value = false; return
  }
  raf = requestAnimationFrame(frame)
}
function play() {
  if (!plan) return
  if (t.value >= plan.duration) t.value = 0
  playing.value = true; last = performance.now(); raf = requestAnimationFrame(frame)
}
function stop() { playing.value = false; cancelAnimationFrame(raf) }
function seek(v: number) { t.value = v; renderer?.render(v) }

watch(() => [props.scene, props.styleId], build, { deep: true })
onMounted(build)
onBeforeUnmount(() => { stop(); renderer?.dispose() })
defineExpose({ seek, duration: () => plan?.duration ?? 0 })
</script>

<template>
  <div class="xp">
    <div class="xp-stage">
      <canvas :key="canvasKey" ref="canvas" width="1920" height="1080" />
      <div v-if="loading" class="xp-mask">准备笔顺数据…</div>
      <div v-if="error" class="xp-mask xp-err">画不出来：{{ error }}</div>
    </div>
    <div v-if="controls" class="xp-bar">
      <button v-if="!playing" @click="play">▶ 播放</button>
      <button v-else @click="stop">❚❚ 暂停</button>
      <input type="range" min="0" :max="scene.duration" step="0.01" :value="t" @input="stop(); seek(Number(($event.target as HTMLInputElement).value))" />
      <span class="xp-time">{{ t.toFixed(1) }} / {{ scene.duration.toFixed(1) }} 秒</span>
    </div>
  </div>
</template>

<style scoped>
.xp { display: flex; flex-direction: column; gap: 10px; }
.xp-stage { position: relative; width: 100%; aspect-ratio: 16 / 9; background: #111; border-radius: 8px; overflow: hidden; }
.xp-stage canvas { width: 100%; height: 100%; display: block; }
.xp-mask { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: #ddd; background: rgba(0, 0, 0, 0.45); font-size: 15px; }
.xp-err { color: #ffb4a8; padding: 24px; text-align: center; }
.xp-bar { display: flex; align-items: center; gap: 12px; }
.xp-bar input { flex: 1; }
.xp-bar button { padding: 6px 14px; border-radius: 6px; border: 1px solid #ccc; background: #fff; cursor: pointer; }
.xp-time { font-variant-numeric: tabular-nums; color: #555; font-size: 13px; min-width: 110px; text-align: right; }
</style>
