<template>
  <div
    class="before-after-slider"
    :class="{ 'is-spotlight': isSpotlight }"
    ref="sliderRef"
    @mousemove="handleMove"
    @touchmove="handleMove"
    @mouseenter="isHovering = true"
    @mouseleave="handleLeave"
  >
    <!-- Base Layer -->
    <!-- In spotlight mode, base layer is 'before' (blurred), clipped layer is 'after' -->
    <template v-if="isSpotlight">
      <template v-if="isIframe">
        <iframe :src="before" class="img-base iframe-layer base-blur" frameborder="0" scrolling="no"></iframe>
      </template>
      <template v-else>
        <img :src="before" alt="Before Optimization" class="img-base base-blur" />
      </template>
    </template>
    <template v-else>
      <template v-if="isIframe">
        <iframe :src="after" class="img-base iframe-layer" frameborder="0" scrolling="no"></iframe>
      </template>
      <template v-else>
        <img :src="after" alt="After Optimization" class="img-base" />
      </template>
    </template>

    <!-- Clipped Layer -->
    <div
      class="img-clipped-wrapper"
      :style="clippedStyle"
    >
      <template v-if="isSpotlight">
        <template v-if="isIframe">
          <iframe :src="after" class="img-clipped iframe-layer" frameborder="0" scrolling="no"></iframe>
        </template>
        <template v-else>
          <img :src="after" alt="After Optimization" class="img-clipped" />
        </template>
      </template>
      <template v-else>
        <template v-if="isIframe">
          <iframe :src="before" class="img-clipped iframe-layer" frameborder="0" scrolling="no"></iframe>
        </template>
        <template v-else>
          <img :src="before" alt="Before Optimization" class="img-clipped" />
        </template>
      </template>
    </div>

    <!-- Overlay to catch mouse events for iframes -->
    <div v-if="isIframe" class="mouse-event-overlay"></div>

    <!-- Interactive Handle (Only for slider mode) -->
    <div v-if="!isSpotlight" class="slider-handle" :style="{ left: `${position}%` }">
      <div class="handle-line"></div>
    </div>
    
    <!-- Status Labels (Only for slider mode) -->
    <template v-if="!isSpotlight">
      <div class="label label-before" :style="{ opacity: position > 20 ? 1 : 0 }">优化前</div>
      <div class="label label-after" :style="{ opacity: position < 80 ? 1 : 0 }">优化后</div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'

const props = defineProps<{
  before: string
  after: string
  isIframe?: boolean
  mode?: 'slider' | 'spotlight'
}>()

const sliderRef = ref<HTMLElement | null>(null)
const position = ref(50) // Initial position at 50%
const mouseX = ref(50) // For spotlight mode
const mouseY = ref(50) // For spotlight mode
const isHovering = ref(false)
let rafId: number | null = null

const handleMove = (e: MouseEvent | TouchEvent) => {
  if (!sliderRef.value) return

  const rect = sliderRef.value.getBoundingClientRect()
  const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
  const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY
  
  let x = clientX - rect.left
  let y = clientY - rect.top
  
  x = Math.max(0, Math.min(x, rect.width))
  y = Math.max(0, Math.min(y, rect.height))
  
  if (rafId) cancelAnimationFrame(rafId)
  rafId = requestAnimationFrame(() => {
    position.value = (x / rect.width) * 100
    mouseX.value = x
    mouseY.value = y
  })
}

const handleLeave = () => {
  isHovering.value = false
}

const isSpotlight = computed(() => props.mode === 'spotlight')

const clippedStyle = computed(() => {
  if (isSpotlight.value) {
    return {
      maskImage: `radial-gradient(circle 350px at ${mouseX.value}px ${mouseY.value}px, black 20%, transparent 100%)`,
      WebkitMaskImage: `radial-gradient(circle 350px at ${mouseX.value}px ${mouseY.value}px, black 20%, transparent 100%)`,
      opacity: isHovering.value ? 1 : 0,
      transition: 'opacity 0.5s ease'
    }
  }
  return {
    clipPath: `inset(0 ${100 - position.value}% 0 0)`
  }
})
</script>

<style scoped>
.before-after-slider {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  cursor: ew-resize; /* Restore ew-resize cursor */
  border-radius: inherit; /* Inherit border-radius from parent container */
}

.img-base, .img-clipped {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  pointer-events: none;
  user-select: none;
  background: transparent;
}

.img-clipped-wrapper {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  /* Use inset for hardware-accelerated clipping */
  will-change: clip-path;
}

.is-spotlight {
  cursor: crosshair;
}

.base-blur {
  filter: none; /* Removed blur and brightness filter */
  opacity: 1; /* Removed transparency */
}

.iframe-layer {
  /* Expand the virtual viewport size to show more content */
  width: 125% !important;
  height: 125% !important;
  /* Decrease the scale factor to zoom out on the content */
  transform: scale(0.8);
  /* CRITICAL: Must use top left origin so it scales perfectly into the 100% container without shifting right */
  transform-origin: top left; 
  background: white;
  pointer-events: none; /* Prevent iframe from stealing mouse events */
  border: none;
  opacity: 1; /* Fully opaque, no transparency */
}

.mouse-event-overlay {
  position: absolute;
  inset: 0;
  z-index: 5;
  cursor: ew-resize; /* Restore ew-resize cursor */
}

.slider-handle {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  transform: translateX(-50%);
  pointer-events: none;
  z-index: 10;
  will-change: left;
}

.handle-line {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 50%;
  width: 2px;
  background: rgba(255, 255, 255, 0.9);
  transform: translateX(-50%);
  box-shadow: 0 0 12px rgba(0,0,0,0.3);
}

.handle-btn {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 48px;
  height: 48px;
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(12px);
  border-radius: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 8px 24px rgba(59, 91, 219, 0.15), 0 2px 8px rgba(59, 91, 219, 0.08), inset 0 0 0 1px rgba(255, 255, 255, 0.5);
  color: #111827;
  transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.2s;
}

.handle-btn.is-hovering {
  transform: translate(-50%, -50%) scale(1.05);
  box-shadow: 0 12px 32px rgba(59, 91, 219, 0.2), 0 4px 12px rgba(59, 91, 219, 0.1), inset 0 0 0 1px rgba(255, 255, 255, 0.8);
}

.handle-btn svg {
  width: 24px;
  height: 24px;
}

.label {
  position: absolute;
  top: 24px;
  padding: 6px 16px;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(8px);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  border-radius: 9999px;
  pointer-events: none;
  transition: opacity 0.3s ease;
  z-index: 5;
  letter-spacing: 0.5px;
}

.label-before {
  left: 24px;
}

.label-after {
  right: 24px;
}
</style>