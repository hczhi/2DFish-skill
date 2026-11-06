<script setup lang="ts">
// [1][2] 角标，跳到本章资料来源里的那一条（锚点带章节前缀，见 SourcesList）。
defineProps<{ prefix: string; src: number[] }>()
</script>

<template>
  <span v-if="src.length" class="refs"><a v-for="n in src" :key="n" :href="`#src-${prefix}-${n}`">[{{ n }}]</a></span>
</template>
