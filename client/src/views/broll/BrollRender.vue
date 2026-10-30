<script setup lang="ts">
import { ref, computed, reactive, provide, nextTick, onMounted } from 'vue'
import { templateById, fullscreenScale } from '../../components/broll/templates'
import { themeById, hasFont } from '../../components/broll/theme'
import { THEME_KEY } from '../../components/broll/themeContext'
import FullFrame from '../../components/broll/FullFrame.vue'
import ChapterNav, { type NavChapter } from '../../components/broll/ChapterNav.vue'

// 只给服务端导出用的渲染页：透明底，按 window.__BROLL_SPEC__ 画卡片，暴露 __brollSeek(t) 让无头浏览器逐帧跳。
// 和编辑页画卡片的规则必须一致（位置 / 缩放 / 全屏 / 叠放顺序）—— 不一致的话导出来和预览不一样，而导出照样「成功」。
// 准备好之前要等字体和每一张图都加载完；**有图加载失败要报出来**（window.__brollFail），不能截出一个空位当成功。

interface SpecCard { id: number; template: string; track: number; start: number; end: number; x: number; y: number; s: number; data: Record<string, any> }
interface Spec { aspect: '16:9' | '9:16'; theme: string; cards: SpecCard[]; total?: number; nav?: { chapters: NavChapter[] } | null }

const spec: Spec = (window as any).__BROLL_SPEC__ || { aspect: '16:9', theme: 'ember', cards: [] }
const W = spec.aspect === '16:9' ? 1920 : 1080
const H = spec.aspect === '16:9' ? 1080 : 1920
const theme = ref(spec.theme)
provide(THEME_KEY, theme)

const t = ref(0)
const sizes = reactive<Record<number, { w: number; h: number }>>({})
const cards = computed(() => [...spec.cards].sort((a, b) => a.track - b.track))
const isOn = (c: SpecCard) => t.value >= c.start && t.value < c.end
const cardT = (c: SpecCard) => Math.min(Math.max(t.value - c.start, 0), c.end - c.start)
const cardData = (c: SpecCard) => ({ ...c.data, duration: c.end - c.start })

const raf = () => new Promise((r) => requestAnimationFrame(() => r(null)))
;(window as any).__brollSeek = async (s: number) => {
  t.value = s
  await nextTick()
  await raf()
  await raf()
}

onMounted(async () => {
  for (const el of [document.documentElement, document.body, document.getElementById('app')]) {
    if (el) el.style.background = 'transparent'
  }
  try {
    const missing = spec.cards.map((c) => c.template).filter((id) => !templateById(id))
    if (missing.length) throw new Error(`渲染页不认识这些卡片：${missing.join('、')}（前端和服务器版本对不上，重新构建前端）`)
    await document.fonts.ready
    await nextTick()
    // 所有图片都要真的加载出来
    const imgs = [...document.querySelectorAll('img')]
    const broken: string[] = []
    await Promise.all(imgs.map((img) => (img.complete ? Promise.resolve() : new Promise((r) => { img.onload = r; img.onerror = r }))))
    for (const img of imgs) if (!img.naturalWidth) broken.push(img.src.slice(0, 120))
    if (broken.length) throw new Error(`有 ${broken.length} 张图片服务器上加载不出来：${broken.join('，')}`)
    // 全屏卡的缩放要等尺寸量出来
    for (let k = 0; k < 50 && spec.cards.some((c) => !sizes[c.id]); k++) await raf()
    // 主题字体：本机（服务器）一个都没有就换成了默认字体，报给服务端写进提示
    const vars = themeById(spec.theme).vars
    const chain = (v: string) => v.split(',').map((x) => x.trim().replace(/"/g, '')).filter((x) => !['sans-serif', 'monospace', 'serif'].includes(x))
    const fontNotes: string[] = []
    for (const key of ['--font-cn', '--font-mono']) {
      const list = chain(vars[key] || '')
      const used = list.find(hasFont)
      if (!used) fontNotes.push(`服务器上没有主题字体（${list.join(' / ')}），用的是浏览器默认字体，导出的字和预览会不一样`)
      else if (used !== list[0]) fontNotes.push(`服务器上没有「${list[0]}」，用的是「${used}」`)
    }
    ;(window as any).__brollFontNotes = fontNotes
    ;(window as any).__brollReady = true
  } catch (e: any) {
    ;(window as any).__brollFail = e?.message || String(e)
  }
})
</script>

<template>
  <div class="rd" :style="{ width: `${W}px`, height: `${H}px`, '--cw': `${W}px`, '--ch': `${H}px`, ...themeById(theme).vars }">
    <div
      v-for="c in cards" :key="c.id" class="rd-layer"
      :style="{
        ...(c.data.fullscreen || c.data.scene ? { left: 0, top: 0, width: `${W}px`, height: `${H}px` } : { left: `${c.x * W}px`, top: `${c.y * H}px`, transform: `scale(${c.s})` }),
        visibility: isOn(c) ? 'visible' : 'hidden',
      }"
    >
      <component :is="templateById(c.template)!.component" v-if="c.data.scene" :data="cardData(c)" :t="cardT(c)" @size="sizes[c.id] = $event" />
      <template v-else-if="c.data.fullscreen">
        <FullFrame :t="cardT(c)" :duration="c.end - c.start" />
        <div class="rd-full">
          <div :style="{ transform: `scale(${fullscreenScale(sizes[c.id], W, H)})` }">
            <component :is="templateById(c.template)!.component" :data="cardData(c)" :t="cardT(c)" @size="sizes[c.id] = $event" />
          </div>
        </div>
      </template>
      <component :is="templateById(c.template)!.component" v-else :data="cardData(c)" :t="cardT(c)" @size="sizes[c.id] = $event" />
    </div>
    <ChapterNav v-if="spec.nav?.chapters.length" class="rd-nav" :chapters="spec.nav.chapters" :t="t" :total="spec.total || 0" :W="W" />
  </div>
</template>

<style scoped>
.rd { position: relative; overflow: hidden; background: transparent; }
.rd-layer { position: absolute; transform-origin: 0 0; }
.rd-nav { z-index: 900; }
.rd-full { position: absolute; inset: 0; display: grid; place-items: center; }
</style>
