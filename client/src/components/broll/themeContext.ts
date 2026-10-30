import { computed, inject, ref, type InjectionKey, type Ref } from 'vue'
import { themeById } from './theme'
import { focusIn, depthIn } from './timeline'

// 当前主题从舞台（编辑页 / 调试台的 CardStage）provide 下来。卡片拿它决定文字用哪种入场手法 ——
// 颜色走 CSS 变量就够了，但「怎么动」得在 JS 里分岔。没 provide 的地方按默认主题走。
export const THEME_KEY: InjectionKey<Ref<string>> = Symbol('broll-theme')

export function useThemeMotion() {
  const theme = inject(THEME_KEY, ref('ember'))
  const depth = computed(() => themeById(theme.value).motion === 'depth')
  /** 整块元素的入场（标题、引子）：默认模糊到清晰，景深主题下从镜头前落位（放大倍数小一点，整行字放 1.9 倍太夸张） */
  const enter = (t: number, a: number, d = 0.5, dy = 24) => (depth.value ? depthIn(t, a, d + 0.1, 1.35) : focusIn(t, a, d, dy))
  return { depth, enter }
}
