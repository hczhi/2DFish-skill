<script setup lang="ts">
// 极简可折叠思维导图树编辑器。
// 数据是 MindNode[]（扁平数组，靠 parentId 组树），不是 Markdown——
// 这样 AI 才能靠稳定 id 做局部更新，不重画整棵树、不冲掉用户手改。
import { computed, ref } from 'vue'
import MindTreeNode from './MindTreeNode.vue'

export interface MindNode {
  id: string
  parentId: string | null
  type: 'theme' | 'point' | 'evidence' | 'detail'
  // 文本统一存 text；content 仅为兼容旧数据/AI 返回的字段，读取时 content || text
  content?: string
  text?: string
  order?: number
}

const props = defineProps<{
  nodes: MindNode[]
  selectedId: string | null
  issues?: Array<{ nodeId: string | null; problem: string; fix: string }>
  readonly?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:nodes', nodes: MindNode[]): void
  (e: 'select', node: MindNode): void
}>()

const collapsed = ref<Set<string>>(new Set())

const typeLabel: Record<MindNode['type'], string> = {
  theme: '主题', point: '论点', evidence: '论据', detail: '细节',
}
// 子节点默认类型：主题下加论点、论点下加论据、论据下加细节、细节下还是细节
const childType: Record<MindNode['type'], MindNode['type']> = {
  theme: 'point', point: 'evidence', evidence: 'detail', detail: 'detail',
}

const roots = computed(() =>
  props.nodes.filter(n => n.parentId === null).sort((a, b) => (a.order || 0) - (b.order || 0))
)
function childrenOf(id: string): MindNode[] {
  return props.nodes.filter(n => n.parentId === id).sort((a, b) => (a.order || 0) - (b.order || 0))
}

function toggle(id: string) {
  const s = new Set(collapsed.value)
  s.has(id) ? s.delete(id) : s.add(id)
  collapsed.value = s
}

function genId(): string {
  return 'u' + Math.random().toString(36).slice(2, 9)
}

function editText(node: MindNode, text: string) {
  emit('update:nodes', props.nodes.map(n => (n.id === node.id ? { ...n, text } : n)))
}

function addChild(parent: MindNode) {
  const siblings = childrenOf(parent.id)
  const node: MindNode = {
    id: genId(), parentId: parent.id, type: childType[parent.type],
    text: '', order: siblings.length,
  }
  emit('update:nodes', [...props.nodes, node])
}

function addRootSibling(node: MindNode) {
  // 给 point 同级加一个 point（最常用的操作：多加一个论点角度）
  const parentId = node.parentId
  const siblings = props.nodes.filter(n => n.parentId === parentId)
  const created: MindNode = {
    id: genId(), parentId, type: node.type, text: '', order: siblings.length,
  }
  emit('update:nodes', [...props.nodes, created])
}

function removeNode(node: MindNode) {
  // 连子孙一起删
  const toDelete = new Set<string>([node.id])
  let changed = true
  while (changed) {
    changed = false
    for (const n of props.nodes) {
      if (n.parentId && toDelete.has(n.parentId) && !toDelete.has(n.id)) {
        toDelete.add(n.id); changed = true
      }
    }
  }
  emit('update:nodes', props.nodes.filter(n => !toDelete.has(n.id)))
}
</script>

<template>
  <div class="mind-tree">
    <div class="xw-tree-children" v-if="roots.length">
      <MindTreeNode
        v-for="node in roots" :key="node.id"
        :node="node" :nodes="nodes" :selectedId="selectedId" :collapsed="collapsed"
        :typeLabel="typeLabel" :issues="issues" :readonly="readonly"
        @toggle="toggle" @select="(n) => emit('select', n)"
        @edit="editText" @add-child="addChild" @add-sibling="addRootSibling" @remove="removeNode"
      />
    </div>
    <p v-if="!roots.length" class="mt-empty">结构还是空的——从 brief 生成，或手动加一个主题节点。</p>
  </div>
</template>

<style scoped>
.mind-tree { padding: 12px 0; }
.xw-tree-children { display: flex; flex-direction: column; gap: 8px; }
.mt-empty { font-size: 13px; color: #9CA3AF; font-style: italic; padding-left: 12px; }
</style>
