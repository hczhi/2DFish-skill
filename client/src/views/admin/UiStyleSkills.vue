<template>
  <div class="page">
    <div class="page-header">
      <h1>风格 Skill 管理</h1>
      <router-link to="/admin/ui-style-skills/create" class="btn-primary">+ 新建 Skill</router-link>
    </div>

    <div class="hc-table-container">
      <table class="hc-table">
        <thead>
          <tr>
            <th>缩略图</th>
            <th>名称</th>
            <th>描述</th>
            <th>行业</th>
            <th>使用次数</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="skill in skills" :key="skill.id">
            <td>
              <img v-if="skill.thumbnail_url" :src="skill.thumbnail_url" class="skill-thumb" />
              <span v-else class="no-thumb">-</span>
            </td>
            <td>{{ skill.name }}</td>
            <td class="desc-cell">{{ skill.description }}</td>
            <td>{{ skill.industry_type || '通用' }}</td>
            <td>{{ skill.usage_count }}</td>
            <td>
              <span :class="['hc-badge', skill.enabled ? 'hc-badge-green' : 'hc-badge-gray']">
                {{ skill.enabled ? '启用' : '禁用' }}
              </span>
            </td>
            <td class="table-actions">
              <router-link :to="`/admin/ui-style-skills/${skill.id}/edit`" class="btn-sm">编辑</router-link>
              <button class="btn-sm btn-danger" @click="deleteSkill(skill.id)">删除</button>
            </td>
          </tr>
          <tr v-if="skills.length === 0">
            <td colspan="7" style="text-align:center; color: #999;">暂无风格 Skill</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { apiGet, apiDelete } from '../../lib/api'

interface StyleSkill {
  id: string
  name: string
  description: string
  design_features: string
  thumbnail_url: string
  industry_type: string
  skill_template: string
  enabled: number
  usage_count: number
}

const skills = ref<StyleSkill[]>([])

async function loadSkills() {
  skills.value = await apiGet('/api/ui-review/admin/skills')
}

async function deleteSkill(id: string) {
  if (!confirm('确定删除此 Skill？')) return
  await apiDelete(`/api/ui-review/admin/skills/${id}`)
  loadSkills()
}

onMounted(loadSkills)
</script>

<style scoped>
.skill-thumb {
  width: 48px;
  height: 48px;
  object-fit: cover;
  border-radius: 6px;
  border: 1px solid #e5e7eb;
}
.no-thumb {
  color: #999;
}
.desc-cell {
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
