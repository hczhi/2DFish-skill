<template>
  <Teleport to="body">
    <Transition name="hc-modal">
      <div v-if="modelValue" class="hc-modal-overlay" @click.self="close">
        <div class="hc-modal-container" :style="{ maxWidth: maxWidth }">
          <button v-if="showClose" class="hc-modal-close" @click="close">&times;</button>
          
          <div class="hc-modal-header" v-if="title || $slots.header">
            <slot name="header">
              <h3>{{ title }}</h3>
            </slot>
          </div>

          <div class="hc-modal-body">
            <slot></slot>
          </div>

          <div class="hc-modal-footer" v-if="$slots.footer">
            <slot name="footer"></slot>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
const props = defineProps({
  modelValue: {
    type: Boolean,
    required: true
  },
  title: {
    type: String,
    default: ''
  },
  maxWidth: {
    type: String,
    default: '500px'
  },
  showClose: {
    type: Boolean,
    default: true
  }
})

const emit = defineEmits(['update:modelValue', 'close'])

function close() {
  emit('update:modelValue', false)
  emit('close')
}
</script>

<style scoped>
.hc-modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
  padding: 24px;
}

.hc-modal-container {
  background: #ffffff;
  width: 100%;
  border-radius: 10px;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.12), 0 8px 16px rgba(0, 0, 0, 0.04);
  position: relative;
  display: flex;
  flex-direction: column;
  max-height: 90vh;
}

.hc-modal-close {
  position: absolute;
  top: 20px;
  right: 20px;
  background: rgba(0, 0, 0, 0.04);
  border: none;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  color: #6b7280;
  font-size: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  z-index: 10;
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

.hc-modal-close:hover {
  background: rgba(0, 0, 0, 0.08);
  color: #111827;
  transform: rotate(90deg);
}

.hc-modal-header {
  padding: 24px 32px 16px;
  border-bottom: 1px solid rgba(0,0,0,0.05);
}

.hc-modal-header h3 {
  margin: 0;
  font-family: var(--font-sans, sans-serif);
  font-size: 20px;
  font-weight: 700;
  color: #111827;
  letter-spacing: -0.5px;
}

.hc-modal-body {
  padding: 24px 32px;
  overflow-y: auto;
  flex: 1;
}

.hc-modal-footer {
  padding: 16px 32px 24px;
  border-top: 1px solid rgba(0,0,0,0.05);
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

/* Transitions */
.hc-modal-enter-active,
.hc-modal-leave-active {
  transition: opacity 0.3s ease;
}
.hc-modal-enter-from,
.hc-modal-leave-to {
  opacity: 0;
}

.hc-modal-enter-active .hc-modal-container {
  transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.hc-modal-leave-active .hc-modal-container {
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

.hc-modal-enter-from .hc-modal-container {
  opacity: 0;
  transform: translateY(20px) scale(0.95);
}
.hc-modal-leave-to .hc-modal-container {
  opacity: 0;
  transform: translateY(20px) scale(0.95);
}
</style>
