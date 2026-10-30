<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { type Scene, type StyleId, compile, prepare } from '../../components/explainer/scene'
import { createRenderer } from '../../components/explainer/renderers'

// 只给服务端导出用的渲染页：按 window.__EXPLAINER_SPEC__ 画，暴露 __explainerSeek(t) 让无头浏览器逐帧跳。
// 和播放器走同一套 prepare → compile → 渲染器，导出和预览是同一帧。
// 准备阶段的问题（字体没加载上、没有笔顺的字…）放进 __explainerNotes 回给前端显示；画不出来报 __explainerFail，不截空白当成功。
const canvas = ref<HTMLCanvasElement | null>(null)

onMounted(async () => {
  const w = window as any
  try {
    const spec = w.__EXPLAINER_SPEC__ as { scene: Scene; style: StyleId } | undefined
    if (!spec?.scene) throw new Error('渲染页没收到场景数据')
    const ready = await prepare(spec.scene)
    const plan = compile(spec.scene, spec.style)
    const r = createRenderer(spec.style, canvas.value!, plan)
    w.__explainerSeek = (t: number) => { r.render(t) }
    w.__explainerNotes = [...ready, ...plan.notes]
    r.render(0)
    w.__explainerReady = true
  } catch (e: any) {
    w.__explainerFail = e?.message || String(e)
  }
})
</script>

<template>
  <canvas ref="canvas" class="xr" width="1920" height="1080" />
</template>

<style scoped>
.xr { position: fixed; left: 0; top: 0; width: 1920px; height: 1080px; display: block; }
</style>
