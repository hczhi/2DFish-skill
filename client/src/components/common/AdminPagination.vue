<template>
  <div class="admin-pagination" v-if="totalPages > 1">
    <button class="page-btn" :disabled="modelValue <= 1" @click="$emit('update:modelValue', modelValue - 1)">&lt; 上一页</button>
    <span class="page-info">{{ modelValue }} / {{ totalPages }}</span>
    <button class="page-btn" :disabled="modelValue >= totalPages" @click="$emit('update:modelValue', modelValue + 1)">下一页 &gt;</button>
    <span class="page-total">共 {{ total }} 条</span>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  modelValue: number
  total: number
  totalPages: number
}>()

defineEmits<{
  'update:modelValue': [value: number]
}>()
</script>

<style scoped>
.admin-pagination {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 20px;
  padding: 12px 0;
}
.page-btn {
  padding: 6px 14px;
  border: 1px solid var(--c-border, #e5e7eb);
  border-radius: 6px;
  background: #fff;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}
.page-btn:hover:not(:disabled) {
  border-color: var(--c-blue-primary, #3B5BDB);
  color: var(--c-blue-primary, #3B5BDB);
}
.page-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.page-info {
  font-size: 13px;
  font-weight: 600;
  color: var(--c-text-main);
}
.page-total {
  font-size: 12px;
  color: var(--c-text-sub);
  margin-left: auto;
}
</style>
