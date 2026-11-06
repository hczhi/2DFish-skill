<script setup lang="ts">
// 章内模块卡（03.1 / 11.2 这种，编号由报告页按章节位置给）：编号 + 标题 + 一句说明，右上角留给「重跑」按钮。
defineProps<{ no: string; title: string; desc?: string; tone?: 'risk' | 'action' }>()
</script>

<template>
  <div :class="['report-module', tone ? `tone-${tone}` : '']">
    <div class="module-head">
      <div class="module-title">
        <span class="module-no">{{ no }}</span>
        <h3>{{ title }}</h3>
        <slot name="act" />
      </div>
      <p v-if="desc" class="module-desc">{{ desc }}</p>
    </div>
    <slot />
  </div>
</template>
