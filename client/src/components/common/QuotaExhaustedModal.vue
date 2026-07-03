<template>
  <HcModal v-model="showQuotaModal" max-width="400px" :show-close="false">
    <div class="modal-content-center">
      <div class="modal-icon">⚡</div>
      <h3 class="modal-title">今日 AI 额度已用完</h3>
      <p class="modal-desc">
        每日免费额度为 {{ quotaState?.limit || 10 }} 次 AI 调用，今日已全部使用。
      </p>
      <p class="modal-hint">
        你可以在「设置」中配置自己的 API Key 来解除限制。
      </p>
    </div>
    <template #footer>
      <div class="modal-actions">
        <button class="btn-secondary" @click="dismiss">知道了</button>
        <router-link to="/settings" class="btn-primary" @click="dismiss">去设置</router-link>
      </div>
    </template>
  </HcModal>
</template>

<script setup lang="ts">
import { showQuotaModal, quotaState, dismissQuotaModal } from '../../lib/quota'
import HcModal from './HcModal.vue'

function dismiss() {
  dismissQuotaModal()
}
</script>

<style scoped>
.modal-content-center {
  text-align: center;
}
.modal-icon {
  font-size: 48px;
  margin-bottom: 16px;
}
.modal-title {
  font-family: var(--font-sans, sans-serif);
  font-size: 20px;
  font-weight: 700;
  margin: 0 0 12px 0;
}
.modal-desc {
  color: var(--c-text-main, #111827);
  font-size: 14px;
  line-height: 1.6;
  margin: 0 0 8px 0;
}
.modal-hint {
  color: var(--c-text-sub, #6b7280);
  font-size: 13px;
  margin: 0 0 24px 0;
}
.modal-actions {
  display: flex;
  gap: 12px;
  justify-content: center;
  width: 100%;
}
.btn-secondary {
  padding: 8px 20px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #fff;
  color: #374151;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  text-decoration: none;
  transition: all 0.2s;
}
.btn-secondary:hover {
  background: #f9fafb;
}
.btn-primary {
  padding: 8px 20px;
  border: none;
  border-radius: 8px;
  background: #3B5BDB;
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  text-decoration: none;
  transition: all 0.2s;
}
.btn-primary:hover {
  background: #2b45a8;
}
</style>
