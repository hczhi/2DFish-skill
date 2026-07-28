<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import type { MindNode } from './MindTree.vue'

const props = defineProps<{
  node: MindNode
  nodes: MindNode[]
  selectedId: string | null
  collapsed: Set<string>
  typeLabel: Record<MindNode['type'], string>
  issues?: Array<{ nodeId: string | null; problem: string; fix: string }>
  readonly?: boolean
}>()

const emit = defineEmits<{
  (e: 'toggle', id: string): void
  (e: 'select', node: MindNode): void
  (e: 'edit', node: MindNode, text: string): void
  (e: 'add-child', node: MindNode): void
  (e: 'add-sibling', node: MindNode): void
  (e: 'remove', node: MindNode): void
}>()

const children = computed(() => props.nodes.filter(n => n.parentId === props.node.id).sort((a, b) => (a.order || 0) - (b.order || 0)))
const hasChildren = computed(() => children.value.length > 0)
const isCollapsed = computed(() => props.collapsed.has(props.node.id))
const isSelected = computed(() => props.selectedId === props.node.id)
const nodeIssues = computed(() => props.issues?.filter(i => i.nodeId === props.node.id) || [])

const textareaRef = ref<HTMLTextAreaElement | null>(null)

function onTextareaMounted(el: any) {
  if (el instanceof HTMLTextAreaElement) {
    textareaRef.value = el
    autoResize()
  }
}

function autoResize() {
  const el = textareaRef.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = Math.max(24, el.scrollHeight) + 'px'
}

function onInput(e: Event) {
  const target = e.target as HTMLTextAreaElement
  emit('edit', props.node, target.value)
  nextTick(() => {
    autoResize()
  })
}
</script>

<template>
  <li class="mt-node" :class="`mt-${node.type}`">
    <div class="mt-row" :class="{ 'mt-selected': isSelected }">
      <button v-if="hasChildren" class="mt-toggle" @click="emit('toggle', node.id)">
        {{ isCollapsed ? '▸' : '▾' }}
      </button>
      <span v-else class="mt-toggle mt-dot">·</span>

      <span class="mt-type" :class="`tag-${node.type}`">{{ typeLabel[node.type] }}</span>

      <!-- 文本区 -->
        <textarea
          v-if="!readonly"
          :ref="onTextareaMounted"
          class="mt-text"
          :value="node.content || node.text"
          :placeholder="node.type === 'theme' ? '一句话的核心判断…' : node.type === 'point' ? '一个论点…' : node.type === 'evidence' ? '一条真实论据/例子…' : '细节…'"
          rows="1"
          @input="onInput"
          @focus="emit('select', node)"
        />
        <div v-else class="mt-readonly-wrapper">
          <div class="mt-text mt-readonly">{{ node.content || node.text || '未输入内容' }}</div>
          <div class="mt-custom-tooltip">{{ node.content || node.text || '未输入内容' }}</div>
        </div>

      <span v-if="!readonly" class="mt-actions">
        <button class="mt-act" title="选中，和 AI 讨论这个节点" @click="emit('select', node)">💬</button>
        <button class="mt-act" title="加子节点" @click="emit('add-child', node)">＋子</button>
        <button v-if="node.type !== 'theme'" class="mt-act" title="加同级节点" @click="emit('add-sibling', node)">＋同级</button>
        <button v-if="node.type !== 'theme'" class="mt-act mt-del" title="删除（含子节点）" @click="emit('remove', node)">✕</button>
      </span>

      <div v-if="nodeIssues.length > 0" class="mt-warning-badge">
        <span class="mt-badge-icon">⚠</span>
        <div class="mt-warning-popover">
          <div v-for="(is, i) in nodeIssues" :key="i" class="mt-issue">
            <div class="mt-issue-p">{{ is.problem }}</div>
            <div class="mt-issue-f">↳ {{ is.fix }}</div>
          </div>
        </div>
      </div>
    </div>

    <ul v-if="hasChildren && !isCollapsed" class="mt-level">
      <MindTreeNode
        v-for="child in children" :key="child.id"
        :node="child" :nodes="nodes" :selectedId="selectedId" :collapsed="collapsed" :typeLabel="typeLabel" :issues="issues"
        :readonly="readonly"
        @toggle="(id) => emit('toggle', id)"
        @select="(n) => emit('select', n)"
        @edit="(n, t) => emit('edit', n, t)"
        @add-child="(n) => emit('add-child', n)"
        @add-sibling="(n) => emit('add-sibling', n)"
        @remove="(n) => emit('remove', n)"
      />
    </ul>
  </li>
</template>

<style scoped>
.mt-level { list-style: none; margin: 0; padding-left: 18px; }
.mt-node { position: relative; }
.mt-row {
  display: flex; align-items: flex-start; gap: 6px;
  padding: 4px 6px; border-radius: 8px; margin: 2px 0;
}
.mt-row.mt-selected { background: #fff3e6; box-shadow: inset 0 0 0 1px #ff9a3d; }
.mt-toggle {
  border: none; background: none; cursor: pointer; color: #888;
  width: 18px; flex: none; padding: 2px 0; font-size: 12px; line-height: 1.4;
}
.mt-dot { cursor: default; color: #ccc; }
.mt-type {
  flex: none; font-size: 11px; padding: 2px 6px; border-radius: 6px;
  margin-top: 2px; white-space: nowrap;
}
.tag-theme { background: #ffe0e0; color: #c0392b; }
.tag-point { background: #e0ecff; color: #2b6cb0; }
.tag-evidence { background: #e6f7e6; color: #2e7d32; }
.tag-detail { background: #f0f0f0; color: #666; }
.mt-text {
  flex: 1; border: 1px solid transparent; border-radius: 6px;
  padding: 3px 6px; font: inherit; resize: none; min-height: 26px;
  background: transparent; line-height: 1.5; overflow: hidden; word-break: break-all;
}

.mt-readonly-wrapper {
  position: relative;
  flex: 1;
  display: flex;
}

.mt-custom-tooltip {
  position: absolute;
  top: 100%;
  left: 0;
  background: rgba(31, 41, 55, 0.95);
  backdrop-filter: blur(8px);
  color: #fff;
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  width: max-content;
  max-width: 280px;
  z-index: 9999;
  box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
  opacity: 0;
  visibility: hidden;
  transform: translateY(4px) scale(0.96);
  transition: opacity 0.2s ease, transform 0.2s ease, visibility 0.2s;
  pointer-events: none;
  /* 解决被父容器 overflow: hidden 截断的问题 */
  margin-top: 4px;
}

.mt-readonly-wrapper:hover .mt-custom-tooltip {
  opacity: 1;
  visibility: visible;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  transform: translateY(0) scale(1);
}
.mt-text.mt-readonly {
  padding: 4px 8px;
  white-space: pre-wrap;
  word-break: break-word;
  color: #4B5563;
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  margin-right: 8px;
  cursor: default;
}
.mt-text:hover { border-color: #eee; }
.mt-text:focus { border-color: #ff9a3d; background: #fff; outline: none; }
.mt-actions { flex: none; display: flex; gap: 2px; align-items: center; opacity: 0; transition: opacity .15s; }
.mt-row:hover .mt-actions, .mt-row.mt-selected .mt-actions { opacity: 1; }
.mt-act {
  transition: all 0.3s ease;
  border: 1px solid #eee; background: #fff; cursor: pointer;
  font-size: 11px; padding: 2px 5px; border-radius: 5px; color: #555; white-space: nowrap;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}
.mt-act:hover { background: #f7f7f7; transform: translateY(-1px); box-shadow: 0 2px 6px rgba(0,0,0,0.05); }
.mt-del:hover { background: #ffecec; color: #c0392b; border-color: #ffcaca; }

.mt-warning-badge {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: help;
  margin-left: 4px;
}
.mt-badge-icon {
  background: #ffb74d; color: #fff; border-radius: 50%;
  width: 16px; height: 16px; font-size: 10px;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 2px 4px rgba(255, 183, 77, 0.3);
}
.mt-warning-popover {
  position: absolute;
  top: 100%; left: 50%; transform: translateX(-50%) translateY(10px) scale(0.95);
  background: #fff; border: 1px solid #eee; border-radius: 10px;
  padding: 10px; width: 240px; z-index: 100;
  box-shadow: 0 16px 32px rgba(0,0,0,0.08);
  opacity: 0; visibility: hidden; pointer-events: none;
  transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.mt-warning-badge:hover .mt-warning-popover {
  opacity: 1; visibility: visible; pointer-events: auto;
  transform: translateX(-50%) translateY(8px) scale(1);
}
.mt-issue { margin-bottom: 8px; }
.mt-issue:last-child { margin-bottom: 0; }
.mt-issue-p { font-size: 13px; color: #c0392b; font-weight: 600; line-height: 1.4; }
.mt-issue-f { font-size: 12px; color: #666; margin-top: 4px; line-height: 1.4; }
</style>
