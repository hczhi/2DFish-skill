import { computed } from 'vue'
import { progress, easeInCubic } from './timeline'
import { useCardSize } from './cardSize'
import { useThemeMotion } from './themeContext'

// 卡片共用的那一套：量尺寸、出场（淡出 + 模糊 + 往某个方向退）、强调色覆盖、按主题选的入场手法。
// 新卡用这个，不再各写一遍 —— 各写一遍的话改了出场手法只改到一半的卡。
export function useCardBase(
  props: { data: { duration: number; accent?: string }; t: number },
  emit: (e: 'size', v: { w: number; h: number }) => void,
  opts: { out?: number; exit?: 'up' | 'left' | 'none' } = {},
) {
  const root = useCardSize(emit)
  const { enter, depth } = useThemeMotion()
  const OUT = opts.out ?? 0.5
  const outP = computed(() => easeInCubic(progress(props.t, props.data.duration - OUT, props.data.duration)))
  const rootStyle = computed(() => ({
    opacity: 1 - outP.value,
    filter: `blur(${outP.value * 8}px)`,
    transform: opts.exit === 'left' ? `translateX(${-40 * outP.value}px)` : opts.exit === 'none' ? undefined : `translateY(${-30 * outP.value}px)`,
    ...(props.data.accent ? { '--accent': props.data.accent } : {}),
  }))
  return { root, rootStyle, outP, enter, depth }
}
