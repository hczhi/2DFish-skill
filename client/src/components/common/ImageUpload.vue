<template>
  <div class="image-upload">
    <div class="preview" v-if="modelValue" @click="triggerInput">
      <img :src="modelValue" alt="preview" />
      <button class="remove-btn" @click.stop="$emit('update:modelValue', '')" title="移除">&times;</button>
    </div>
    <div class="upload-area" v-else @click="triggerInput" @dragover.prevent @drop.prevent="handleDrop">
      <span class="upload-icon">+</span>
      <span class="upload-text">{{ uploading ? '上传中...' : '点击或拖拽上传图片' }}</span>
      <span class="upload-hint">支持 JPG/PNG/GIF/WebP，最大 5MB</span>
    </div>
    <input ref="fileInput" type="file" accept="image/*" hidden @change="handleFileChange" />
    <p class="upload-error" v-if="error">{{ error }}</p>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { authFetch } from '../../lib/auth'

defineProps<{
  modelValue: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const fileInput = ref<HTMLInputElement>()
const uploading = ref(false)
const error = ref('')

function triggerInput() {
  fileInput.value?.click()
}

function handleFileChange(e: Event) {
  const target = e.target as HTMLInputElement
  const file = target.files?.[0]
  if (file) uploadFile(file)
  target.value = ''
}

function handleDrop(e: DragEvent) {
  const file = e.dataTransfer?.files[0]
  if (file && file.type.startsWith('image/')) {
    uploadFile(file)
  }
}

async function uploadFile(file: File) {
  if (file.size > 5 * 1024 * 1024) {
    error.value = '文件大小超过 5MB 限制'
    return
  }

  error.value = ''
  uploading.value = true

  try {
    const formData = new FormData()
    formData.append('file', file)

    const res = await authFetch('/api/upload/image', {
      method: 'POST',
      body: formData,
    })

    if (!res.ok) {
      const data = await res.json()
      throw new Error(data.error || '上传失败')
    }

    const data = await res.json()
    emit('update:modelValue', data.url)
  } catch (e: any) {
    error.value = e.message || '上传失败'
  } finally {
    uploading.value = false
  }
}
</script>

<style scoped>
.image-upload {
  width: 100%;
}

.upload-area {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 32px 24px;
  border: 2px dashed var(--c-border, #e5e7eb);
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.2s;
  background: #f9fafb;
}
.upload-area:hover {
  border-color: var(--c-blue-primary, #3B5BDB);
  background: #f0f4ff;
}

.upload-icon {
  font-size: 28px;
  color: var(--c-text-sub);
  font-weight: 300;
}
.upload-text {
  font-size: 13px;
  font-weight: 600;
  color: var(--c-text-main);
}
.upload-hint {
  font-size: 12px;
  color: var(--c-text-sub);
}

.preview {
  position: relative;
  display: inline-block;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--c-border, #e5e7eb);
  cursor: pointer;
}
.preview img {
  display: block;
  max-width: 100%;
  max-height: 200px;
  object-fit: contain;
}
.remove-btn {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  border: none;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.remove-btn:hover {
  background: #dc2626;
}

.upload-error {
  color: #dc2626;
  font-size: 12px;
  margin-top: 8px;
  font-weight: 600;
}
</style>
