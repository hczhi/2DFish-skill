<template>
  <div class="quota-indicator" v-if="quotaState" :class="{ warning: isLow, exhausted: isExhausted }">
    <span class="quota-icon">⚡</span>
    <span class="quota-text">{{ quotaState.remaining }}/{{ quotaState.limit }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { quotaState } from '../../lib/quota'

const isLow = computed(() => quotaState.value !== null && quotaState.value.remaining <= 2 && quotaState.value.remaining > 0)
const isExhausted = computed(() => quotaState.value !== null && quotaState.value.remaining <= 0)
</script>

<style scoped>
.quota-indicator {
  display: flex;
  align-items: center;
  gap: 4px;
  font-family: var(--font-mono, monospace);
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 4px;
  background: rgba(0, 119, 255, 0.08);
  color: #333;
  letter-spacing: 0.5px;
}
.quota-indicator.warning {
  background: rgba(255, 160, 0, 0.12);
  color: #b36b00;
}
.quota-indicator.exhausted {
  background: rgba(255, 50, 50, 0.1);
  color: #c00;
}
.quota-icon {
  font-size: 14px;
}
</style>
