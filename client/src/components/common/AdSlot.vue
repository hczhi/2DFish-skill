<template>
  <div
    v-if="slotData"
    class="ad-slot-managed"
    :class="`ad-pos-${position}`"
    :style="{ minHeight: slotData.height ? slotData.height + 'px' : undefined }"
    v-html="slotData.slot_code"
  ></div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'

const props = defineProps<{
  position: string
  page?: string
}>()

interface AdSlotItem {
  id: string
  page_pattern: string
  position: string
  slot_code: string
  label: string
  height: number | null
}

const slots = ref<AdSlotItem[]>([])

const slotData = computed(() => {
  return slots.value.find(s => s.position === props.position) || null
})

onMounted(async () => {
  const page = props.page || window.location.pathname
  try {
    const res = await fetch(`/api/ad-slots?page=${encodeURIComponent(page)}`)
    if (res.ok) {
      slots.value = await res.json()
    }
  } catch { /* silent */ }
})
</script>

<style scoped>
.ad-slot-managed {
  width: 100%;
  max-width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  box-sizing: border-box;
  margin: 24px 0; /* 增加合理的上下间距，确保不遮挡或紧贴其他区域 */
}

/* 移除 sidebar 顶部的额外间距，因为 sidebar 通常空间紧凑 */
.ad-pos-sidebar {
  margin: 0 0 24px 0;
}

/* 深度选择器控制注入的图片、iframe、视频，限制其最大尺寸并赋予 HC Design 圆角 */
.ad-slot-managed :deep(img),
.ad-slot-managed :deep(iframe),
.ad-slot-managed :deep(video) {
  max-width: 100%;
  height: auto;
  border-radius: 10px; /* 对齐 HC Design 的圆角规范 */
  object-fit: contain;
  max-height: 240px; /* 限制全局最大高度，防止图片过大 */
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.04); /* 轻微弥散阴影提升质感 */
}

/* 侧边栏广告高度限制稍微宽松一点或更严格，这里保持 240px 或 250px 均可 */
.ad-pos-sidebar :deep(img) {
  max-height: 250px; 
}
</style>
