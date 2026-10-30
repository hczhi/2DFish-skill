<script setup lang="ts">
import { ref, computed } from 'vue'
import ExplainerPlayer from '../../components/explainer/ExplainerPlayer.vue'
import { FIXTURES } from '../../components/explainer/fixtures'
import { STYLES, type StyleId } from '../../components/explainer/scene'

// 代码动画调试台：同一份场景 JSON 切两种风格看。编译时发现的问题（缺图标、缩字号、没有笔顺的字）列在右边。
const fixtureId = ref(FIXTURES[0].id)
const styleId = ref<StyleId>('whiteboard')
const notes = ref<string[]>([])
const scene = computed(() => FIXTURES.find((f) => f.id === fixtureId.value)!.scene)
const json = computed(() => JSON.stringify(scene.value, null, 2))
</script>

<template>
  <div class="lab">
    <header class="lab-top">
      <h1>代码动画 · 调试台</h1>
      <label>场景
        <select v-model="fixtureId"><option v-for="f in FIXTURES" :key="f.id" :value="f.id">{{ f.name }}</option></select>
      </label>
      <div class="lab-styles">
        <button v-for="s in STYLES" :key="s.id" :class="{ on: styleId === s.id }" @click="styleId = s.id">{{ s.name }}</button>
      </div>
    </header>
    <div class="lab-body">
      <ExplainerPlayer class="lab-player" :scene="scene" :style-id="styleId" @notes="notes = $event" />
      <aside class="lab-side">
        <h3>编译提示（{{ notes.length }}）</h3>
        <p v-if="!notes.length" class="ok">没有问题</p>
        <ul v-else><li v-for="(n, i) in notes" :key="i">{{ n }}</li></ul>
        <h3>场景 JSON</h3>
        <pre>{{ json }}</pre>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.lab { padding: 20px 28px; max-width: 1600px; margin: 0 auto; }
.lab-top { display: flex; align-items: center; gap: 20px; margin-bottom: 16px; flex-wrap: wrap; }
.lab-top h1 { font-size: 20px; margin: 0; }
.lab-top select { margin-left: 6px; padding: 4px 8px; }
.lab-styles { display: flex; gap: 6px; }
.lab-styles button { padding: 6px 14px; border: 1px solid #ccc; border-radius: 6px; background: #fff; cursor: pointer; }
.lab-styles button.on { background: #1f3f7a; color: #fff; border-color: #1f3f7a; }
.lab-body { display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 20px; align-items: start; }
.lab-side { font-size: 13px; }
.lab-side h3 { font-size: 14px; margin: 0 0 8px; }
.lab-side ul { margin: 0 0 16px; padding-left: 18px; color: #b4441c; }
.lab-side li { margin-bottom: 4px; }
.lab-side .ok { color: #2e7d32; margin: 0 0 16px; }
.lab-side pre { background: #f6f7f9; padding: 10px; border-radius: 6px; max-height: 520px; overflow: auto; font-size: 12px; }
</style>
