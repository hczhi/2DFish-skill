<template>
  <div class="page">
    <div class="page-header">
      <h1>评分规则管理</h1>
      <router-link to="/admin/ui-review-rules/create" class="btn-primary">+ 新建规则</router-link>
    </div>

    <div class="hc-table-container">
      <table class="hc-table">
        <thead>
          <tr>
            <th>名称</th>
            <th>维度</th>
            <th>检测类型</th>
            <th>严重程度</th>
            <th>权重</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="rule in rules" :key="rule.id">
            <td>{{ rule.name }}</td>
            <td><span class="hc-badge hc-badge-blue">{{ rule.dimension }}</span></td>
            <td>{{ rule.detection_type }}</td>
            <td>
              <span :class="['hc-badge', severityClass(rule.severity)]">{{ rule.severity }}</span>
            </td>
            <td>{{ rule.weight }}</td>
            <td>
              <span :class="['hc-badge', rule.enabled ? 'hc-badge-green' : 'hc-badge-gray']">
                {{ rule.enabled ? '启用' : '禁用' }}
              </span>
            </td>
            <td class="table-actions">
              <router-link :to="`/admin/ui-review-rules/${rule.id}/edit`" class="btn-sm">编辑</router-link>
              <button class="btn-sm" @click="toggleRule(rule)">{{ rule.enabled ? '禁用' : '启用' }}</button>
              <button class="btn-sm btn-danger" @click="deleteRule(rule.id)">删除</button>
            </td>
          </tr>
          <tr v-if="rules.length === 0">
            <td colspan="7" style="text-align:center; color: #999;">暂无评分规则</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { api, apiGet, apiDelete } from '../../lib/api'

interface Rule {
  id: string
  name: string
  dimension: string
  description: string
  detection_type: string
  detection_config: string
  weight: number
  severity: string
  industry_weights: string
  enabled: number
  sort_order: number
}

const rules = ref<Rule[]>([])

function severityClass(severity: string) {
  if (severity === 'critical') return 'hc-badge-red'
  if (severity === 'error') return 'hc-badge-red'
  if (severity === 'warning') return 'hc-badge-blue'
  return 'hc-badge-gray'
}

async function loadRules() {
  rules.value = await apiGet('/api/ui-review/admin/rules')
}

async function toggleRule(rule: Rule) {
  await api(`/api/ui-review/admin/rules/${rule.id}/toggle`, { method: 'PATCH' })
  loadRules()
}

async function deleteRule(id: string) {
  if (!confirm('确定删除此规则？')) return
  await apiDelete(`/api/ui-review/admin/rules/${id}`)
  loadRules()
}

onMounted(loadRules)
</script>
