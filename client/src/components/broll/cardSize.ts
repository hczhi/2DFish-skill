import { ref, onMounted, onBeforeUnmount } from 'vue'

// 卡片把自己的自然尺寸（画布坐标、未缩放）报给外面，外面拿它判断「有没有出画面 / 压字幕区」。
// offsetWidth 不受外层 transform 缩放影响，量到的就是画布坐标下的尺寸。
export function useCardSize(emit: (e: 'size', v: { w: number; h: number }) => void) {
  const root = ref<HTMLElement>()
  let ro: ResizeObserver | null = null
  onMounted(() => {
    ro = new ResizeObserver(() => root.value && emit('size', { w: root.value.offsetWidth, h: root.value.offsetHeight }))
    if (root.value) ro.observe(root.value)
  })
  onBeforeUnmount(() => ro?.disconnect())
  return root
}
