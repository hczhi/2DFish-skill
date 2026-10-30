<script setup lang="ts">
import { computed } from 'vue'
import { findIcon } from './iconLibrary'

// 按关键词画一个 Lucide 图标（线条图标，颜色用 currentColor）。关键词对不上时画一个虚线问号，不画空白 ——
// 空白读起来像本来就这样设计的（check 那边也会报「xx 没有对应的图标」）。
const props = defineProps<{ name: string; size?: number; stroke?: number }>()
const icon = computed(() => findIcon(props.name))
</script>

<template>
  <svg :width="size || 64" :height="size || 64" viewBox="0 0 24 24" fill="none" stroke="currentColor" :stroke-width="stroke || 1.8" stroke-linecap="round" stroke-linejoin="round">
    <template v-if="icon">
      <component :is="tag" v-for="([tag, attrs], i) in icon.node" :key="i" v-bind="attrs" />
    </template>
    <template v-else>
      <rect x="2" y="2" width="20" height="20" rx="5" stroke-dasharray="3 3" />
      <path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17.5v.01" />
    </template>
  </svg>
</template>
