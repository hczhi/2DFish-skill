<template>
  <div class="file-view">
    <div class="file-sidebar">
      <h3>文件管理</h3>
      <div class="file-tree">
        <div v-for="item in files" :key="item.path" class="file-item" @click="openFile(item)">
          <span class="file-icon">{{ item.type === 'dir' ? '📁' : '📄' }}</span>
          <span>{{ item.name }}</span>
        </div>
        <p v-if="files.length === 0" class="empty">暂无文件</p>
      </div>
    </div>
    <div class="file-editor">
      <div v-if="currentFile" class="editor-header">
        <span>{{ currentPath }}</span>
        <button @click="saveFile" :disabled="!dirty">保存</button>
      </div>
      <textarea v-if="currentFile" v-model="currentFile" class="editor-content" @input="dirty = true"></textarea>
      <div v-else class="editor-placeholder">选择文件查看内容</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { apiGet, apiPost } from '../../lib/api'

interface FileItem {
  name: string
  type: 'file' | 'dir'
  path: string
}

const files = ref<FileItem[]>([])
const currentFile = ref('')
const currentPath = ref('')
const dirty = ref(false)

onMounted(async () => {
  try {
    const data = await apiGet<{ files: FileItem[] }>('/api/files/list?path=')
    files.value = data.files
  } catch {}
})

async function openFile(item: FileItem) {
  if (item.type === 'dir') {
    const data = await apiGet<{ files: FileItem[] }>(`/api/files/list?path=${encodeURIComponent(item.path)}`)
    files.value = data.files
    return
  }
  try {
    const data = await apiGet<{ content: string }>(`/api/files/read?path=${encodeURIComponent(item.path)}`)
    currentFile.value = data.content
    currentPath.value = item.path
    dirty.value = false
  } catch {}
}

async function saveFile() {
  if (!currentPath.value) return
  await apiPost('/api/files/write', { path: currentPath.value, content: currentFile.value })
  dirty.value = false
}
</script>

<style scoped>
.file-view { height: 100%; display: flex; }
.file-sidebar { width: 240px; border-right: 1px solid var(--border); padding: 16px; overflow-y: auto; }
.file-sidebar h3 { font-size: 14px; color: var(--text-muted); margin-bottom: 12px; }
.file-tree { display: flex; flex-direction: column; gap: 4px; }
.file-item { display: flex; align-items: center; gap: 8px; padding: 8px; border-radius: 6px; cursor: pointer; font-size: 13px; }
.file-item:hover { background: var(--bg-secondary); }
.file-icon { font-size: 14px; }
.empty { color: var(--text-muted); font-size: 13px; font-style: italic; }

.file-editor { flex: 1; display: flex; flex-direction: column; }
.editor-header { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; border-bottom: 1px solid var(--border); font-size: 13px; color: var(--text-muted); }
.editor-header button { padding: 4px 12px; background: var(--primary); color: white; border: none; border-radius: 4px; font-size: 12px; cursor: pointer; }
.editor-header button:disabled { opacity: 0.4; }
.editor-content { flex: 1; padding: 16px; background: var(--bg); color: var(--text); border: none; resize: none; font-family: 'JetBrains Mono', monospace; font-size: 13px; line-height: 1.6; outline: none; }
.editor-placeholder { flex: 1; display: flex; align-items: center; justify-content: center; color: var(--text-muted); }
</style>
