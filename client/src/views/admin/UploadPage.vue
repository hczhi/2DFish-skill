<template>
  <div class="page">
    <div class="page-header">
      <h1>图片上传</h1>
    </div>
    <p class="desc">上传图片到腾讯云 COS，获取公开访问 URL。</p>

    <div class="upload-card">
      <div class="upload-area" @click="triggerInput" @dragover.prevent @drop.prevent="handleDrop">
        <span class="upload-icon">+</span>
        <span class="upload-text">{{ uploading ? '上传中...' : '点击或拖拽上传图片' }}</span>
        <span class="upload-hint">支持 JPG / PNG / GIF / WebP / SVG，最大 5MB</span>
      </div>
      <input ref="fileInput" type="file" accept="image/*" hidden @change="handleFileChange" />
      <p class="error" v-if="error">{{ error }}</p>
    </div>

    <div class="result-card" v-if="lastUrl">
      <h3>上传成功</h3>
      <div class="preview">
        <img :src="lastUrl" alt="uploaded" />
      </div>
      <div class="url-row">
        <input class="url-input" :value="lastUrl" readonly @click="($event.target as HTMLInputElement).select()" />
        <button class="btn-primary" @click="copyUrl">{{ copied ? '已复制' : '复制' }}</button>
      </div>
    </div>

    <div class="history" v-if="history.length > 1">
      <h3>历史记录 <small>(本次会话)</small></h3>
      <div class="history-list">
        <div class="history-item" v-for="item in history" :key="item.url">
          <img :src="item.url" alt="history" class="history-thumb" />
          <div class="history-info">
            <input class="url-input small" :value="item.url" readonly @click="($event.target as HTMLInputElement).select()" />
            <span class="history-time">{{ item.time }}</span>
          </div>
          <button class="btn-copy-sm" @click="copyText(item.url)">复制</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { authFetch } from '../../lib/auth'

const fileInput = ref<HTMLInputElement>()
const uploading = ref(false)
const error = ref('')
const lastUrl = ref('')
const copied = ref(false)
const history = ref<Array<{ url: string; time: string }>>([])

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
    lastUrl.value = data.url
    copied.value = false
    history.value.unshift({
      url: data.url,
      time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    })
  } catch (e: any) {
    error.value = e.message || '上传失败'
  } finally {
    uploading.value = false
  }
}

function copyUrl() {
  navigator.clipboard.writeText(lastUrl.value)
  copied.value = true
  setTimeout(() => copied.value = false, 2000)
}

function copyText(text: string) {
  navigator.clipboard.writeText(text)
}
</script>

<style scoped>
.page { max-width: 800px; }
.desc {
  color: var(--c-text-sub);
  font-size: 13px;
  margin-bottom: 32px;
  line-height: 1.6;
  border-left: 4px solid #3B5BDB;
  padding-left: 16px;
}

.upload-card {
  background: #fff;
  padding: 32px;
  border-radius: 10px;
  border: 1px solid rgba(0, 0, 0, 0.05);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.04);
}

.upload-area {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 48px 24px;
  border: 2px dashed var(--c-border, #e5e7eb);
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.2s;
  background: #f9fafb;
}
.upload-area:hover {
  border-color: #3B5BDB;
  background: #f0f4ff;
}
.upload-icon { font-size: 36px; color: var(--c-text-sub); font-weight: 300; }
.upload-text { font-size: 14px; font-weight: 600; color: var(--c-text-main); }
.upload-hint { font-size: 12px; color: var(--c-text-sub); }

.error { color: #dc2626; font-size: 13px; margin-top: 12px; font-weight: 600; }

.result-card {
  margin-top: 24px;
  background: #ecfdf5;
  border: 1px solid #a7f3d0;
  border-radius: 10px;
  padding: 24px;
}
.result-card h3 { margin: 0 0 16px; font-size: 16px; color: #065f46; }

.preview {
  margin-bottom: 16px;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid #d1fae5;
  display: inline-block;
}
.preview img { display: block; max-width: 100%; max-height: 200px; object-fit: contain; }

.url-row { display: flex; gap: 12px; }
.url-input {
  flex: 1;
  padding: 10px 14px;
  border: 1px solid #d1fae5;
  border-radius: 8px;
  font-size: 13px;
  font-family: monospace;
  background: #fff;
  color: var(--c-text-main);
}
.url-input:focus { outline: none; border-color: #3B5BDB; }

.history { margin-top: 32px; }
.history h3 { font-size: 16px; margin: 0 0 16px; }
.history h3 small { font-weight: normal; color: var(--c-text-sub); }

.history-list { display: flex; flex-direction: column; gap: 12px; }
.history-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  background: #fff;
  border: 1px solid rgba(0, 0, 0, 0.05);
  border-radius: 8px;
}
.history-thumb { width: 48px; height: 48px; object-fit: cover; border-radius: 6px; border: 1px solid var(--c-border); }
.history-info { flex: 1; display: flex; flex-direction: column; gap: 4px; }
.url-input.small { padding: 6px 10px; font-size: 11px; }
.history-time { font-size: 11px; color: var(--c-text-sub); }
.btn-copy-sm {
  padding: 6px 12px;
  border: 1px solid var(--c-border);
  border-radius: 6px;
  background: #fff;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.btn-copy-sm:hover { border-color: #3B5BDB; color: #3B5BDB; }
</style>
