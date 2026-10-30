import { ref, onMounted, onBeforeUnmount, type Ref } from 'vue'
import { progress, easeInOutCubic, lerp } from './timeline'

// B-roll 场景共用：场景铺满整个画布（宽高用画布的 --cw / --ch），布局要知道实际宽高（横屏 / 竖屏排法不同）。
export function useSceneBox(root: Ref<HTMLElement | undefined>) {
  const w = ref(1920)
  const h = ref(1080)
  let ro: ResizeObserver | null = null
  onMounted(() => {
    ro = new ResizeObserver(() => { if (root.value) { w.value = root.value.offsetWidth; h.value = root.value.offsetHeight } })
    if (root.value) ro.observe(root.value)
  })
  onBeforeUnmount(() => ro?.disconnect())
  return { w, h }
}

/**
 * 镜头：整段时长里缓慢推近（像摄影机慢推），越靠前的层（depth 越大）推得越多 → 层与层之间有视差、有纵深。
 * 全部按 t 算（导出逐帧截图要一致）。
 */
export function sceneCam(t: number, duration: number, depth: number, push = 0.07) {
  const p = easeInOutCubic(progress(t, 0, duration))
  const s = 1 + push * p * (0.35 + depth)
  const dx = Math.sin(t * 0.35) * 10 * depth
  const dy = lerp(14, -14, p) * depth
  return { transform: `translate(${dx}px, ${dy}px) scale(${s})` }
}
