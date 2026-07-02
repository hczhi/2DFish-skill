import { ref, watchEffect } from 'vue'

export type Theme = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'mmPla_theme'

export const currentTheme = ref<Theme>(
  (localStorage.getItem(STORAGE_KEY) as Theme) || 'system'
)

export function setTheme(theme: Theme) {
  currentTheme.value = theme
  localStorage.setItem(STORAGE_KEY, theme)
}

function applyTheme(theme: Theme) {
  const isDark = theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)

  document.documentElement.classList.toggle('dark', isDark)
}

watchEffect(() => applyTheme(currentTheme.value))

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (currentTheme.value === 'system') {
    applyTheme('system')
  }
})
