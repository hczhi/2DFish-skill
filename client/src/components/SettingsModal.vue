<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal">
      <div class="modal-header">
        <h2>设置</h2>
        <button class="close-btn" @click="$emit('close')">&times;</button>
      </div>
      <div class="modal-body">
        <div class="section-title">AI 模型</div>
        <div class="form-group">
          <label>API 地址</label>
          <input
            v-model="form.apiUrl"
            type="text"
            placeholder="https://api.openai.com/v1"
          />
          <span class="hint">兼容OpenAI格式的API地址</span>
        </div>
        <div class="form-group">
          <label>API Key</label>
          <input
            v-model="form.apiKey"
            type="password"
            placeholder="sk-..."
          />
        </div>
        <div class="form-group">
          <label>模型名称</label>
          <input
            v-model="form.model"
            type="text"
            placeholder="gpt-4o / claude-sonnet-4-5-20250514 / ..."
          />
        </div>

      </div>
      <div class="modal-footer">
        <button class="btn-cancel" @click="$emit('close')">取消</button>
        <button class="btn-save" @click="handleSave">保存</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive } from 'vue'
import type { AIConfig } from '../game/types'

const props = defineProps<{ config: AIConfig }>()
const emit = defineEmits<{
  close: []
  save: [config: AIConfig]
}>()

const form = reactive({
  apiUrl: props.config.apiUrl,
  apiKey: props.config.apiKey,
  model: props.config.model,
})

function handleSave() {
  emit('save', { apiUrl: form.apiUrl, apiKey: form.apiKey, model: form.model })
}
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  backdrop-filter: blur(4px);
}

.modal {
  background: #1e293b;
  border-radius: 16px;
  width: 420px;
  max-width: 90vw;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  overflow: hidden;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.modal-header h2 {
  color: #f1f5f9;
  font-size: 18px;
  font-weight: 600;
}

.close-btn {
  background: none;
  border: none;
  color: #94a3b8;
  font-size: 24px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 6px;
}

.close-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #f1f5f9;
}

.modal-body {
  padding: 24px;
}

.form-group {
  margin-bottom: 20px;
}

.form-group label {
  display: block;
  color: #94a3b8;
  font-size: 13px;
  font-weight: 500;
  margin-bottom: 8px;
}

.form-group input {
  width: 100%;
  padding: 10px 14px;
  background: #0f172a;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 8px;
  color: #f1f5f9;
  font-size: 14px;
  outline: none;
  transition: border-color 0.2s;
}

.form-group input:focus {
  border-color: #3b82f6;
}

.form-group input::placeholder {
  color: #475569;
}

.hint {
  display: block;
  margin-top: 6px;
  font-size: 12px;
  color: #64748b;
}

.modal-footer {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
  padding: 16px 24px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}

.modal-footer button {
  padding: 8px 20px;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  cursor: pointer;
  font-weight: 500;
}

.btn-cancel {
  background: rgba(255, 255, 255, 0.1);
  color: #94a3b8;
}

.btn-cancel:hover {
  background: rgba(255, 255, 255, 0.15);
}

.btn-save {
  background: #3b82f6;
  color: white;
}

.btn-save:hover {
  background: #2563eb;
}

.section-title {
  color: #64748b;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 12px;
  margin-top: 8px;
}

.section-title:first-child {
  margin-top: 0;
}

</style>
