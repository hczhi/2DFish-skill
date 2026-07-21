<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { apiGet, apiPost, apiPut, apiDelete } from '../../lib/api'

interface Skill {
  id: string
  key: string
  name: string
  description: string
  body: string
  enabled: boolean
  updated_at: string
}
interface SkillFile {
  id: string
  skill_id: string
  kind: 'main' | 'reference'
  filename: string
  body: string
  sort_order: number
}

const route = useRoute()
const router = useRouter()

const isNew = computed(() => !route.params.id)
const skillId = ref<string>((route.params.id as string) || '')

const skill = ref<Skill>({ id: '', key: '', name: '', description: '', body: '', enabled: true, updated_at: '' })
const files = ref<SkillFile[]>([])
const activeFileId = ref<string>('')
const preview = ref('')
const showPreview = ref(false)
const loading = ref(false)
const saving = ref(false)
const error = ref('')

const activeFile = computed(() => files.value.find(f => f.id === activeFileId.value))

async function loadFiles() {
  const r = await apiGet<{ files: SkillFile[] }>(`/api/admin/skill-registry/skills/${skillId.value}/files`)
  files.value = r.files
  const main = files.value.find(f => f.kind === 'main')
  activeFileId.value = main?.id || files.value[0]?.id || ''
}

async function load() {
  if (isNew.value) return
  loading.value = true
  error.value = ''
  try {
    const r = await apiGet<{ skill: Skill }>(`/api/admin/skill-registry/skills/${skillId.value}`)
    skill.value = r.skill
    await loadFiles()
  } catch (e: any) {
    error.value = e?.message || '加载失败'
  } finally {
    loading.value = false
  }
}

// 新建：创建外壳后转到编辑态（带上 id）
async function createShell() {
  if (!skill.value.name.trim()) { error.value = '名称必填'; return }
  if (!/^[a-z0-9-]+$/.test(skill.value.key)) { error.value = 'key 只能含小写字母、数字、连字符'; return }
  saving.value = true
  error.value = ''
  try {
    const r = await apiPost<{ skill: Skill }>('/api/admin/skill-registry/skills', {
      key: skill.value.key, name: skill.value.name, description: skill.value.description, body: '', enabled: skill.value.enabled,
    })
    router.replace({ name: 'admin-skill-edit', params: { id: r.skill.id } })
    skillId.value = r.skill.id
    skill.value = r.skill
    await loadFiles()
  } catch (err: any) {
    error.value = err?.message || '创建失败'
  } finally {
    saving.value = false
  }
}

async function saveMeta() {
  saving.value = true
  error.value = ''
  try {
    await apiPut(`/api/admin/skill-registry/skills/${skillId.value}`, {
      name: skill.value.name, description: skill.value.description, enabled: skill.value.enabled,
    })
  } catch (err: any) {
    error.value = err?.message || '保存失败'
  } finally {
    saving.value = false
  }
}

async function saveFile() {
  const f = activeFile.value
  if (!f) return
  saving.value = true
  error.value = ''
  try {
    await apiPut(`/api/admin/skill-registry/files/${f.id}`, { filename: f.filename, body: f.body })
  } catch (err: any) {
    error.value = err?.message || '文件保存失败'
  } finally {
    saving.value = false
  }
}

async function addReference() {
  const name = prompt('引用文件名（如 note_templates.md）')
  if (!name) return
  try {
    const r = await apiPost<{ file: SkillFile }>(`/api/admin/skill-registry/skills/${skillId.value}/files`, { filename: name, body: '' })
    files.value.push(r.file)
    activeFileId.value = r.file.id
  } catch (e: any) {
    error.value = e?.message || '新增文件失败'
  }
}

async function removeReference(f: SkillFile) {
  if (f.kind === 'main') return
  if (!confirm(`删除引用文件「${f.filename}」？`)) return
  try {
    await apiDelete(`/api/admin/skill-registry/files/${f.id}`)
    files.value = files.value.filter(x => x.id !== f.id)
    if (activeFileId.value === f.id) activeFileId.value = files.value[0]?.id || ''
  } catch (e: any) {
    error.value = e?.message || '删除失败'
  }
}

function insertRef(f: SkillFile) {
  const main = files.value.find(x => x.kind === 'main')
  if (!main) return
  const token = `{{ref:${f.filename.replace(/\.md$/i, '')}}}`
  main.body += (main.body.endsWith('\n') ? '' : '\n') + token + '\n'
  activeFileId.value = main.id
}

async function doPreview() {
  await saveFile()
  const r = await apiGet<{ assembled: string }>(`/api/admin/skill-registry/skills/${skillId.value}/preview`)
  preview.value = r.assembled
  showPreview.value = true
}

function goBack() {
  router.push({ name: 'admin-skills' })
}

onMounted(load)
</script>

<template>
  <div class="skill-editor">
    <div class="page-header">
      <div>
        <button class="back-btn" @click="goBack">&larr; 返回 Skill 列表</button>
        <h1>{{ isNew ? '新建 Skill' : `编辑：${skill.name}` }}</h1>
      </div>
    </div>

    <div v-if="error" class="err">{{ error }}</div>
    <div v-if="loading">加载中…</div>

    <!-- 新建：先建外壳 -->
    <div v-else-if="isNew" class="card new-shell">
      <div class="form-group">
        <label>标识 key（唯一，小写字母/数字/连字符，创建后不可改）</label>
        <input v-model="skill.key" placeholder="如 xiaohongshu-makeup" />
      </div>
      <div class="form-group">
        <label>名称</label>
        <input v-model="skill.name" placeholder="如 小红书美妆内容创作" />
      </div>
      <div class="form-group">
        <label>简介</label>
        <input v-model="skill.description" placeholder="一句话说明这个 skill 干什么" />
      </div>
      <div class="actions">
        <button class="btn-cancel" @click="goBack">取消</button>
        <button class="btn-primary" :disabled="saving" @click="createShell">
          {{ saving ? '创建中…' : '创建并编辑文件' }}
        </button>
      </div>
    </div>

    <!-- 编辑：元信息 + 多文件全屏 -->
    <template v-else>
      <div class="card meta-card">
        <div class="meta-row">
          <div class="form-group grow">
            <label>名称</label>
            <input v-model="skill.name" />
          </div>
          <div class="form-group grow">
            <label>简介</label>
            <input v-model="skill.description" />
          </div>
          <div class="form-group">
            <label>状态</label>
            <label class="chk"><input type="checkbox" v-model="skill.enabled" /> 启用</label>
          </div>
          <div class="form-group">
            <label>&nbsp;</label>
            <button class="btn-sm" :disabled="saving" @click="saveMeta">保存信息</button>
          </div>
        </div>
      </div>

      <div class="card files-card">
        <div class="files-layout">
          <!-- 文件侧栏 -->
          <div class="file-tabs">
            <div
              v-for="f in files" :key="f.id"
              class="file-tab" :class="{ active: f.id === activeFileId }"
              @click="activeFileId = f.id"
            >
              <span class="file-icon">{{ f.kind === 'main' ? '📄' : '📎' }}</span>
              <span class="file-name">{{ f.filename }}</span>
              <button v-if="f.kind === 'reference'" class="file-x" @click.stop="removeReference(f)">×</button>
            </div>
            <button class="add-ref" @click="addReference">+ 引用文件</button>
          </div>

          <!-- 文件内容 -->
          <div class="file-editor" v-if="activeFile">
            <div class="file-editor-head">
              <input
                v-if="activeFile.kind === 'reference'"
                v-model="activeFile.filename"
                class="fname-input"
              />
              <span v-else class="fname-static">SKILL.md（主文件）</span>
              <div class="head-actions">
                <button
                  v-if="activeFile.kind === 'reference'"
                  class="btn-sm" @click="insertRef(activeFile)"
                  title="在主文件里插入引用占位符"
                >插入到主文件</button>
                <button class="btn-primary btn-sm" :disabled="saving" @click="saveFile">保存此文件</button>
              </div>
            </div>
            <textarea v-model="activeFile.body" class="body-area"></textarea>
            <p class="hint" v-if="activeFile.kind === 'main'">
              提示：用 <code v-pre>{{ref:文件名}}</code> 引用左侧的引用文件，调用时会自动展开注入。
            </p>
          </div>
        </div>
      </div>

      <div class="bottom-actions">
        <button class="btn-secondary" @click="doPreview">预览最终 Prompt</button>
        <button class="btn-cancel" @click="goBack">返回列表</button>
      </div>

      <!-- 预览 -->
      <div v-if="showPreview" class="card preview-box">
        <div class="preview-head">
          <strong>展开后的最终 Prompt（发给 AI 的实际内容）</strong>
          <button class="file-x" @click="showPreview = false">×</button>
        </div>
        <pre>{{ preview }}</pre>
      </div>
    </template>
  </div>
</template>

<style scoped>
.skill-editor { display: flex; flex-direction: column; min-height: 0; }
.page-header { align-items: flex-start; }
.back-btn { border: none; background: transparent; color: #6b7280; cursor: pointer; font-size: 13px; padding: 0 0 8px; }
.back-btn:hover { color: #3B5BDB; }
.err { background: #fef2f2; color: #dc2626; padding: 12px 16px; border-radius: 8px; margin-bottom: 16px; }
.card { background: #fff; border: 1px solid rgba(0,0,0,0.06); border-radius: 12px; padding: 24px; margin-bottom: 20px; }
.new-shell { max-width: 640px; }
.form-group { margin-bottom: 20px; }
.form-group.grow { flex: 1; margin-bottom: 0; }
.meta-card { margin-bottom: 20px; }
.meta-row { display: flex; gap: 16px; align-items: flex-end; }
.chk { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
.actions, .bottom-actions { display: flex; justify-content: flex-end; gap: 12px; }
.bottom-actions { margin-bottom: 20px; }

.files-card { flex: 1; display: flex; }
.files-layout { display: flex; gap: 20px; width: 100%; }
.file-tabs { width: 220px; flex-shrink: 0; display: flex; flex-direction: column; gap: 4px; }
.file-tab { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-radius: 8px; cursor: pointer; font-size: 13px; color: #374151; }
.file-tab:hover { background: #f3f4f6; }
.file-tab.active { background: #e0e7ff; color: #3B5BDB; font-weight: 600; }
.file-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.file-x { border: none; background: transparent; color: #9ca3af; cursor: pointer; font-size: 16px; line-height: 1; }
.file-x:hover { color: #dc2626; }
.add-ref { margin-top: 8px; border: 1px dashed #d1d5db; background: transparent; border-radius: 8px; padding: 10px; cursor: pointer; font-size: 13px; color: #6b7280; }
.add-ref:hover { border-color: #3B5BDB; color: #3B5BDB; }
.file-editor { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.file-editor-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
.fname-input { flex: 1; border: 1px solid #e5e7eb; border-radius: 8px; padding: 8px 12px; font-family: var(--font-mono, monospace); font-size: 13px; }
.fname-static { font-weight: 600; color: #374151; font-size: 15px; }
.head-actions { display: flex; gap: 8px; }
.body-area {
  width: 100%; box-sizing: border-box; min-height: 60vh; resize: vertical;
  font-family: var(--font-mono, monospace); line-height: 1.7; font-size: 14px;
  border: 1px solid #e5e7eb; border-radius: 10px; padding: 16px;
}
.hint { color: #9ca3af; font-size: 12px; margin: 8px 0 0; }
.hint code { background: #f3f4f6; padding: 1px 6px; border-radius: 4px; }
.preview-box { padding: 0; overflow: hidden; }
.preview-head { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; background: #f9fafb; border-bottom: 1px solid #e5e7eb; }
.preview-box pre { margin: 0; padding: 20px; max-height: 50vh; overflow: auto; font-size: 13px; line-height: 1.7; white-space: pre-wrap; word-break: break-word; }
</style>
