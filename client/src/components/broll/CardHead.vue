<script setup lang="ts">
import { computed } from 'vue'
import { pulse } from './timeline'
import { useThemeMotion } from './themeContext'

// 卡片顶上那一块：英文小标签（呼吸圆点）+ 标题。两个都可留空。
const props = defineProps<{ t: number; label?: string; title?: string; at?: number }>()
const { enter } = useThemeMotion()
const titleStyle = computed(() => enter(props.t, props.at ?? 0.1))
</script>

<template>
  <div v-if="label" class="ch-label"><i class="bx-dot" :style="{ '--pulse': pulse(t) }" />{{ label }}</div>
  <div v-if="title" class="ch-title" :style="titleStyle">{{ title }}</div>
</template>

<style scoped>
.ch-label {
  position: relative; display: flex; align-items: center; gap: 18px; margin-bottom: 14px; white-space: nowrap;
  font-family: var(--font-mono); font-size: 38px; font-weight: 600; letter-spacing: 0.3em; text-transform: uppercase; color: var(--accent);
}
.ch-title { position: relative; font-size: 78px; font-weight: 700; white-space: nowrap; margin-bottom: 32px; }
</style>
