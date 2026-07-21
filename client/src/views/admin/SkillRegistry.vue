<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { apiGet, apiPut, apiDelete } from '../../lib/api'

interface Skill {
  id: string
  key: string
  name: string
  description: string
  body: string
  enabled: boolean
  updated_at: string
}
interface Binding { slot: string; label: string; skill_id: string | null }

const router = useRouter()
const skills = ref<Skill[]>([])
const bindings = ref<Binding[]>([])
const loading = ref(false)
const error = ref('')

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [sr, br] = await Promise.all([
      apiGet<{ skills: Skill[] }>('/api/admin/skill-registry/skills'),
      apiGet<{ bindings: Binding[] }>('/api/admin/skill-registry/bindings'),
    ])
    skills.value = sr.skills
    bindings.value = br.bindings
  } catch (e: any) {
    error.value = e?.message || '加载失败'
  } finally {
    loading.value = false
  }
}

function openNew() {
  router.push({ name: 'admin-skill-create' })
}
function openEdit(s: Skill) {
  router.push({ name: 'admin-skill-edit', params: { id: s.id } })
}

async function removeSkill(s: Skill) {
  if (!confirm(`确定删除 skill「${s.name}」？绑定它的功能位会自动解绑。`)) return
  try {
    await apiDelete(`/api/admin/skill-registry/skills/${s.id}`)
    await load()
  } catch (e: any) {
    error.value = e?.message || '删除失败'
  }
}

async function changeBinding(b: Binding, skillId: string) {
  try {
    await apiPut(`/api/admin/skill-registry/bindings/${b.slot}`, { skill_id: skillId || null })
    b.skill_id = skillId || null
  } catch (e: any) {
    error.value = e?.message || '绑定失败'
    await load()
  }
}

onMounted(load)
</script>

<template>
  <div>
    <div class="page-header">
      <h1>Skill 管理</h1>
      <button class="btn-primary" @click="openNew">+ 新建 Skill</button>
    </div>

    <p class="intro">
      Skill 是可复用的提示词知识，可由「主文件 + 多个引用文件」组成。在主文件里用
      <code v-pre>{{ref:文件名}}</code> 引用某个引用文件，调用时会自动把该文件内容展开注入。
      功能位（slot）是前台 AI 功能点的锚点，绑定 skill 后无需改代码即可生效。
    </p>

    <div v-if="error" class="err">{{ error }}</div>

    <!-- 功能位绑定 -->
    <section class="card">
      <h2>功能位绑定</h2>
      <table class="hc-table" v-if="bindings.length">
        <thead>
          <tr><th>功能位</th><th>标识</th><th>绑定的 Skill</th></tr>
        </thead>
        <tbody>
          <tr v-for="b in bindings" :key="b.slot">
            <td>{{ b.label }}</td>
            <td><code>{{ b.slot }}</code></td>
            <td>
              <select :value="b.skill_id || ''" @change="changeBinding(b, ($event.target as HTMLSelectElement).value)">
                <option value="">（不使用 skill）</option>
                <option v-for="s in skills" :key="s.id" :value="s.id" :disabled="!s.enabled">
                  {{ s.name }}{{ s.enabled ? '' : '（已禁用）' }}
                </option>
              </select>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- Skill 列表 -->
    <section class="card">
      <h2>所有 Skill</h2>
      <div v-if="loading">加载中…</div>
      <table class="hc-table" v-else-if="skills.length">
        <thead>
          <tr><th>名称</th><th>标识 key</th><th>状态</th><th>更新时间</th><th>操作</th></tr>
        </thead>
        <tbody>
          <tr v-for="s in skills" :key="s.id">
            <td><strong>{{ s.name }}</strong><br /><span class="desc">{{ s.description }}</span></td>
            <td><code>{{ s.key }}</code></td>
            <td>
              <span class="hc-badge" :class="s.enabled ? 'hc-badge-green' : 'hc-badge-gray'">
                {{ s.enabled ? '启用' : '禁用' }}
              </span>
            </td>
            <td>{{ s.updated_at?.slice(0, 10) }}</td>
            <td class="table-actions">
              <button class="btn-sm" @click="openEdit(s)">编辑</button>
              <button class="btn-danger" @click="removeSkill(s)">删除</button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else class="desc">还没有 skill，点右上角新建一个。</p>
    </section>
  </div>
</template>

<style scoped>
.intro { color: #6b7280; font-size: 14px; line-height: 1.7; max-width: 760px; margin-bottom: 24px; }
.intro code { background: #f3f4f6; padding: 1px 6px; border-radius: 4px; font-size: 13px; }
.err { background: #fef2f2; color: #dc2626; padding: 12px 16px; border-radius: 8px; margin-bottom: 16px; }
.card { background: #fff; border: 1px solid rgba(0,0,0,0.06); border-radius: 12px; padding: 24px; margin-bottom: 32px; }
.card h2 { font-size: 20px; font-weight: 700; margin: 0 0 16px; }
.desc { color: #9ca3af; font-size: 13px; }
select { border: 1px solid #e5e7eb; border-radius: 8px; padding: 8px 12px; font-size: 14px; min-width: 220px; background: #fff; }
</style>
