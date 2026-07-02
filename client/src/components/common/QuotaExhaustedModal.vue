<template>
  <Teleport to="body">
    <div class="modal-overlay" v-if="showQuotaModal" @click.self="dismiss">
      <div class="modal-card">
        <div class="modal-icon">⚡</div>
        <h3 class="modal-title">今日 AI 额度已用完</h3>
        <p class="modal-desc">
          每日免费额度为 {{ quotaState?.limit || 10 }} 次 AI 调用，今日已全部使用。
        </p>
        <p class="modal-hint">
          你可以在「设置」中配置自己的 API Key 来解除限制。
        </p>
        <div class="modal-actions">
          <button class="btn-secondary" @click="dismiss">知道了</button>
          <router-link to="/settings" class="btn-primary" @click="dismiss">去设置</router-link>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { showQuotaModal, quotaState, dismissQuotaModal } from '../../lib/quota'

function dismiss() {
  dismissQuotaModal()
}
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  backdrop-filter: blur(2px);
}
.modal-card {
  background: #fff;
  border-radius: 12px;
  padding: 32px;
  max-width: 400px;
  width: 90%;
  text-align: center;
  box-shadow: 0 24px 48px rgba(0, 0, 0, 0.15);
}
.modal-icon {
  font-size: 48px;
  margin-bottom: 16px;
}
.modal-title {
  font-family: -apple-system, sans-serif;
  font-size: 20px;
  font-weight: 600;
  margin: 0 0 12px 0;
}
.modal-desc {
  color: #555;
  font-size: 14px;
  line-height: 1.6;
  margin: 0 0 8px 0;
}
.modal-hint {
  color: #888;
  font-size: 13px;
  margin: 0 0 24px 0;
}
.modal-actions {
  display: flex;
  gap: 12px;
  justify-content: center;
}
.btn-secondary {
  padding: 8px 20px;
  border: 1px solid #ddd;
  border-radius: 6px;
  background: #fff;
  color: #333;
  font-size: 14px;
  cursor: pointer;
  text-decoration: none;
}
.btn-secondary:hover {
  background: #f5f5f5;
}
.btn-primary {
  padding: 8px 20px;
  border: none;
  border-radius: 6px;
  background: #0052FF;
  color: #fff;
  font-size: 14px;
  cursor: pointer;
  text-decoration: none;
}
.btn-primary:hover {
  background: #003ecc;
}
</style>
