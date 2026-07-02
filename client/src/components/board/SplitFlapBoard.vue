<template>
  <div class="board-container">
    <canvas ref="canvasRef"></canvas>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { BoardRenderer } from './BoardRenderer'
import { layoutToInstructions, textToInstructions, buildWisdomSequence } from './LayoutEngine'
import type { WisdomLayout, WisdomData } from './LayoutEngine'
import { WaitingAnimation } from './WaitingAnimation'
import type { BoardLayout, CellInstruction } from './types'

const canvasRef = ref<HTMLCanvasElement>()
let renderer: BoardRenderer | null = null
let waitingAnim: WaitingAnimation | null = null

onMounted(() => {
  if (canvasRef.value) {
    renderer = new BoardRenderer(canvasRef.value)
    renderer.start()

    waitingAnim = new WaitingAnimation((instructions) => {
      renderer?.applyInstructions(instructions)
    }, renderer.getConfig())
  }
})

onUnmounted(() => {
  waitingAnim?.stop()
  renderer?.stop()
})

function displayLayout(layout: BoardLayout) {
  if (!renderer) return
  waitingAnim?.stop()
  const instructions = layoutToInstructions(layout, renderer.getConfig())
  renderer.applyInstructions(instructions)
}

async function displayWisdomSequence(data: WisdomData, layout: WisdomLayout) {
  if (!renderer) return

  const config = renderer.getConfig()
  const { occupied, keywordInst, sentenceInst, interpInst } = buildWisdomSequence(data, layout, config)

  // 1. 接口返回后，继续loading翻板3秒，让满屏翻板效果持续
  await new Promise(r => setTimeout(r, 3000))

  // 2. 进入fading模式，避开即将展示文字的区域，背景开始减速变淡
  waitingAnim?.fadeout(occupied)

  // 3. 展示 Keyword
  renderer.applyInstructions(keywordInst)
  await new Promise(r => setTimeout(r, 3000))

  // 4. 过3秒，展示 Key Sentence
  renderer.applyInstructions(sentenceInst)
  await new Promise(r => setTimeout(r, 3000))

  // 5. 再过3秒，展示 Interpretation
  renderer.applyInstructions(interpInst)
  await new Promise(r => setTimeout(r, 3000))

  // 6. 停止背景动画
  waitingAnim?.stop()

  // 7. 清理残留的背景字符，只留下核心内容
  const clearInst: CellInstruction[] = []
  for (let r = 0; r < config.rows; r++) {
    for (let c = 0; c < config.cols; c++) {
      if (!occupied.has(`${r},${c}`)) {
        clearInst.push({ row: r, col: c, char: ' ', delay: Math.floor(Math.random() * 10) })
      }
    }
  }
  renderer.applyInstructions(clearInst)
}

function displayText(text: string) {
  if (!renderer) return
  waitingAnim?.stop()
  const instructions = textToInstructions(text, renderer.getConfig())
  renderer.applyInstructions(instructions)
}

function clear() {
  renderer?.clear()
}

function startWelcome(text: string) {
  waitingAnim?.startWelcome(text)
}

function startLoading() {
  waitingAnim?.startLoading()
}

function stopWaiting() {
  waitingAnim?.stop()
}

defineExpose({ displayLayout, displayWisdomSequence, displayText, clear, startWelcome, startLoading, stopWaiting })
</script>

<style scoped>
.board-container {
  position: relative;
  padding: 24px 20px;
  /* 移除原本生硬的背景框，完全融入页面 */
  background: transparent;
  border-radius: 0;
  box-shadow: none;
  border: none;
}

canvas {
  display: block;
}
</style>
