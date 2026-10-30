<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import SiteHeader from '../../components/common/SiteHeader.vue'
import AppKeyModal from '../../components/common/AppKeyModal.vue'
import ExplainerPlayer from '../../components/explainer/ExplainerPlayer.vue'
import { FIXTURES } from '../../components/explainer/fixtures'

const route = useRoute()
const router = useRouter()

// 同 BrollCover：「开始使用」只管跳编辑器，有没有 key / 账号交给守卫判（没有时它送到 /explainer/key，
// 那条路由带着 ?key=1 回到这里把弹窗打开）。
const keyOpen = ref(false)
watch(() => route.query.key, (v) => { keyOpen.value = !!v }, { immediate: true })
const q = (k: string) => (typeof route.query[k] === 'string' ? (route.query[k] as string) : undefined)
function onKeyModal(open: boolean) {
  keyOpen.value = open
  if (!open && route.query.key) router.replace({ path: '/explainer' })
}
const go = () => router.push('/explainer/studio')

// 样片就是真引擎实时画的（调试台的测试场景），引擎改了这里跟着变
const demoWb = FIXTURES.find((f) => f.id === 'gps')!.scene
const demoBp = FIXTURES.find((f) => f.id === 'make10')!.scene
const STEPS = [
  { n: '1', t: '写内容、选风格和时长', d: '一段要讲清楚的原理、知识点或流程，15 到 60 秒。' },
  { n: '2', t: 'AI 出剧本，你来改', d: '分镜、标题、要画的东西、时间线一目了然，每一项都能直接改。' },
  { n: '3', t: '生成画面，导出 MP4', d: '图标和图示一笔一笔画出来，满意了导出 1080p 视频。' },
]
</script>

<template>
  <div class="xc">
    <SiteHeader />
    <section class="xc-hero">
      <div class="xc-copy">
        <h1>写一段话，<br />画成一条讲解视频</h1>
        <p>白板上马克笔一笔一笔写画，或者蓝晒纸上按制图顺序出图。AI 先给你剧本，确认了再画。</p>
        <div class="xc-cta">
          <button class="xc-go" @click="go">开始使用</button>
          <span>账号或 EXP- 开头的 key 都能用</span>
        </div>
      </div>
      <div class="xc-demos">
        <figure>
          <ExplainerPlayer :scene="demoWb" style-id="whiteboard" autoplay loop :controls="false" />
          <figcaption>白板讲解 · 手机怎么知道你在哪</figcaption>
        </figure>
        <figure>
          <ExplainerPlayer :scene="demoBp" style-id="blueprint" autoplay loop :controls="false" />
          <figcaption>蓝图 / 工程制图 · 凑十法</figcaption>
        </figure>
      </div>
    </section>
    <section class="xc-steps">
      <article v-for="s in STEPS" :key="s.n">
        <b>{{ s.n }}</b>
        <h3>{{ s.t }}</h3>
        <p>{{ s.d }}</p>
      </article>
    </section>
    <AppKeyModal :model-value="keyOpen" app="explainer" :next="q('next')" :reason="q('reason')" @update:model-value="onKeyModal" />
  </div>
</template>

<style scoped>
.xc { min-height: 100vh; background: #f6f5f1; color: #1d2230; }
.xc-hero { max-width: 1240px; margin: 0 auto; padding: 56px 28px 32px; display: grid; grid-template-columns: 0.8fr 1.2fr; gap: 40px; align-items: center; }
.xc-copy h1 { font-size: 44px; line-height: 1.2; margin: 0 0 18px; letter-spacing: -0.5px; }
.xc-copy p { font-size: 16px; line-height: 1.8; color: #555b66; margin: 0 0 28px; }
.xc-cta { display: flex; align-items: center; gap: 16px; }
.xc-cta span { color: #8a8f99; font-size: 13px; }
.xc-go { background: #1f3f7a; color: #fff; border: none; border-radius: 10px; padding: 13px 30px; font-size: 16px; cursor: pointer; }
.xc-go:hover { background: #2a52a0; }
.xc-demos { display: grid; gap: 16px; }
.xc-demos figure { margin: 0; background: #fff; border-radius: 12px; padding: 8px; box-shadow: 0 6px 24px rgba(20, 30, 60, 0.08); }
.xc-demos figcaption { font-size: 12px; color: #7a808b; padding: 8px 4px 2px; }
.xc-steps { max-width: 1240px; margin: 0 auto; padding: 16px 28px 72px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; }
.xc-steps article { background: #fff; border-radius: 12px; padding: 22px; border: 1px solid #e8e6df; }
.xc-steps b { display: inline-flex; width: 28px; height: 28px; border-radius: 50%; background: #d97757; color: #fff; align-items: center; justify-content: center; font-size: 14px; }
.xc-steps h3 { margin: 12px 0 6px; font-size: 17px; }
.xc-steps p { margin: 0; color: #666c76; font-size: 14px; line-height: 1.7; }
@media (max-width: 900px) { .xc-hero, .xc-steps { grid-template-columns: 1fr; } .xc-copy h1 { font-size: 32px; } }
</style>
