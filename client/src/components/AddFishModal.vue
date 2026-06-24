<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal">
      <div class="modal-header">
        <h2>添加新鱼</h2>
        <button class="close-btn" @click="$emit('close')">&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label>名字</label>
          <input
            v-model="name"
            type="text"
            placeholder="给鱼起个名字"
            maxlength="10"
            @keyup.enter="handleAdd"
          />
        </div>
        <p class="hint">种类将随机分配</p>
      </div>
      <div class="modal-footer">
        <button class="btn-cancel" @click="$emit('close')">取消</button>
        <button class="btn-add" :disabled="!name.trim()" @click="handleAdd">
          放入鱼缸
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { getSpeciesList } from '../game/FishFactory'

const emit = defineEmits<{
  close: []
  add: [data: { name: string; species: string }]
}>()

const name = ref('')
const speciesList = getSpeciesList()

function handleAdd() {
  if (!name.value.trim()) return
  const randomSpecies = speciesList[Math.floor(Math.random() * speciesList.length)].id
  emit('add', { name: name.value.trim(), species: randomSpecies })
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
  width: 360px;
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
  margin-bottom: 12px;
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

.btn-add {
  background: #3b82f6;
  color: white;
}

.btn-add:hover:not(:disabled) {
  background: #2563eb;
}

.btn-add:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
