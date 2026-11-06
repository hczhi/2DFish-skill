<script setup lang="ts">
// 交叉验证标记：这个数在几个不同来源（域名）的资料正文里出现过。服务端 sources.corroboration 算的。
// 0 = 没有可比数字或一个来源都没对上（后者已经由「出处里没有」标出来），不显示。
defineProps<{ n?: number }>()
</script>

<template>
  <span v-if="n && n >= 2" class="xs ok" :title="`这个数在 ${n} 个不同来源里都出现过`">{{ n }} 源印证</span>
  <span v-else-if="n === 1" class="xs one" title="只在一个来源里找到这个数，用之前再核一下">单一来源</span>
</template>
