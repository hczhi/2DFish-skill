<template>
  <div class="skill-builder">
    <div class="page-header">
      <h2>技能管理</h2>
      <p class="desc">查看和管理 AI 技能模块</p>
    </div>
    <div class="skills-list">
      <div v-for="skill in skills" :key="skill.name" class="skill-card">
        <h3>{{ skill.name }}</h3>
        <p>{{ skill.description }}</p>
        <span class="skill-category" v-if="skill.category">{{ skill.category }}</span>
      </div>
      <p v-if="skills.length === 0" class="empty">暂无技能，在 workspaces/default/skills/ 目录下添加 SKILL.md</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { apiGet } from '../../lib/api'

interface Skill { name: string; description: string; category?: string; path: string }
const skills = ref<Skill[]>([])

onMounted(async () => {
  try {
    const data = await apiGet<{ skills: Skill[] }>('/api/skills')
    skills.value = data.skills
  } catch {}
})
</script>

<style scoped>
.skill-builder { padding: 32px; }
.page-header h2 { font-size: 20px; margin-bottom: 4px; }
.desc { color: var(--text-muted); font-size: 14px; margin-bottom: 24px; }
.skills-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
.skill-card { padding: 16px; background: var(--bg); border: 1px solid var(--border-light); border-radius: 8px; box-shadow: var(--shadow-sm); }
.skill-card h3 { font-size: 15px; margin-bottom: 6px; }
.skill-card p { font-size: 13px; color: var(--text-muted); line-height: 1.4; }
.skill-category { display: inline-block; margin-top: 8px; font-size: 11px; padding: 2px 8px; background: var(--bg-secondary); border-radius: 4px; }
.empty { color: var(--text-muted); font-size: 13px; }
</style>
