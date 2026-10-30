import { ref, onMounted, watch, type Ref } from 'vue'

// 读一张图的原始宽高比（放大镜、长截图慢滚要按它算坐标）。<img> 一直挂在 DOM 里（导出渲染页靠
// querySelectorAll('img') 等每张图加载完），这里只在 load 后记下比例。缓存命中时 load 可能在绑上监听之前就触发了，
// 所以挂载时再看一眼 complete。没加载出来之前 aspect 是 null，卡片画「加载中」占位，不按猜的比例画（猜错的话停靠点全偏）。
export function useImageAspect(src: Ref<string>) {
  const el = ref<HTMLImageElement>()
  const aspect = ref<number | null>(null)
  const read = () => {
    const img = el.value
    aspect.value = img && img.complete && img.naturalWidth ? img.naturalWidth / img.naturalHeight : null
  }
  onMounted(read)
  watch(src, () => { aspect.value = null })
  return { el, aspect, onLoad: read }
}

/** points 字段的一项：在图上的位置，占图宽高的百分比（0–100） */
export interface ImgPoint { x: number; y: number }
export const pointsOf = (v: unknown): ImgPoint[] =>
  (Array.isArray(v) ? v : []).filter((p) => p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y))).map((p) => ({ x: Number(p.x), y: Number(p.y) }))
