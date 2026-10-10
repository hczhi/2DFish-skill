<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { MechStage, VIEWS, type ViewName, type StageLabel } from './MechStage'
import type { MechCase } from './mechCases'

// 舞台 + 视角按钮 + 播放/暂停 + 标签。颜色变量（--ink / --yellow …）由外层页面给。
const props = defineProps<{
  mech: MechCase
  /** 按轴 id 配标签文案；没配的轴不显示。sub 里的 {v} 换成舞台给的读数（取整）。 */
  tags?: Record<string, { title: string; sub: string }>
  caption?: string
  /** 显示「拆开」按钮。 */
  explode?: boolean
}>()

// 舞台实例放普通变量，不放 ref：进了响应式的 three 对象每帧都走 Proxy（见 MechStage 文件头）。
let stage: MechStage | null = null
const host = ref<HTMLElement | null>(null)
const status = ref<'loading' | 'ready' | 'error'>('loading')
const error = ref('')
const labels = ref<StageLabel[]>([])
const view = ref<ViewName>('iso')
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
const playing = ref(!reduced)
// exploded 是按钮要的状态；moving 是动画还在走 —— 走的过程中标签指的是装好时的位置，先藏起来。
const exploded = ref(false)
const moving = ref(false)

// 侧面 / 顶部看不出哪根轴是哪根，标签会叠成一摞，只在这几个视角显示。
const TAG_VIEWS: ViewName[] = ['iso', 'front', 'back']

async function boot() {
  stage?.dispose()
  status.value = 'loading'
  error.value = ''
  labels.value = []
  if (!host.value) return
  const s = new MechStage(host.value, props.mech)
  stage = s
  s.onLabels = (l) => { labels.value = l }
  s.onError = (msg) => { status.value = 'error'; error.value = msg }
  s.onSettle = () => { moving.value = false }
  exploded.value = false
  moving.value = false
  s.setPlaying(playing.value)
  try {
    await s.load()
    // onError（显卡上下文丢失）可能在 load 期间先置了 error，不能被这里覆盖回 ready。
    if (stage === s && (status.value as string) !== 'error') status.value = 'ready'
  } catch (e) {
    if (stage !== s) return
    status.value = 'error'
    error.value = e instanceof Error ? e.message : String(e)
  }
}

function pick(v: ViewName) {
  view.value = v
  stage?.setView(v)
}
function toggleExplode() {
  exploded.value = !exploded.value
  moving.value = true
  stage?.setExploded(exploded.value)
}
function toggle() {
  playing.value = !playing.value
  stage?.setPlaying(playing.value)
}

onMounted(boot)
onBeforeUnmount(() => { stage?.dispose(); stage = null })
</script>

<template>
  <div class="stage-wrap">
    <div ref="host" class="stage" :class="{ dim: status !== 'ready' }"></div>

    <div v-if="status === 'ready' && tags && TAG_VIEWS.includes(view) && !exploded && !moving" class="labels" aria-hidden="true">
      <template v-for="l in labels" :key="l.id">
        <span v-if="tags[l.id]" class="tag" :style="{ transform: `translate(${l.x}px, ${l.y}px)` }">
          <b>{{ tags[l.id].title }}</b>{{ l.value === undefined ? tags[l.id].sub : tags[l.id].sub.replace('{v}', String(Math.round(l.value))) }}
        </span>
      </template>
    </div>

    <p v-if="status === 'loading'" class="state">正在加载真零件…</p>
    <div v-else-if="status === 'error'" class="state err">
      <p>{{ error }}</p>
      <button @click="boot">重新加载</button>
    </div>

    <div class="controls">
      <div class="views" role="group" aria-label="观察角度">
        <button v-for="(v, k) in VIEWS" :key="k" :class="{ on: view === k }" @click="pick(k)">{{ v.label }}</button>
      </div>
      <button v-if="explode" class="explode" :class="{ on: exploded }" :disabled="status !== 'ready'" @click="toggleExplode">
        {{ exploded ? '合上' : '拆开' }}
      </button>
      <!-- 拆开时不转（零件都离开轴了），按钮也跟着禁掉，免得点了没反应以为坏了。 -->
      <button class="play" :aria-label="playing ? '暂停' : '播放'" :disabled="exploded" :title="exploded ? '合上之后才能转' : ''" @click="toggle">
        <svg v-if="playing" viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
        <svg v-else viewBox="0 0 24 24"><path d="M8 5l11 7-11 7z" /></svg>
      </button>
    </div>
    <p v-if="caption" class="caption">{{ caption }}</p>
  </div>
</template>

<style scoped>
.stage-wrap { position: relative; z-index: 1; height: min(76vh, 720px); min-height: 420px; }
.stage { position: absolute; inset: 0; transition: opacity .4s; }
.stage.dim { opacity: .25; }
.stage :deep(canvas) { width: 100% !important; height: 100% !important; display: block; }

.labels { position: absolute; inset: 0; pointer-events: none; }
.tag {
  position: absolute; left: 0; top: 0; margin: -46px 0 0 -48px; width: 96px; box-sizing: border-box;
  display: flex; flex-direction: column; align-items: center; padding: 6px 0 7px;
  background: #fff; border: 2px solid var(--ink); border-radius: 12px; font-size: 12px; color: var(--text);
  box-shadow: 3px 3px 0 var(--ink); transition: transform .08s linear; white-space: nowrap;
}
.tag b { font-size: 15px; color: var(--ink); }
.tag::after {
  content: ''; position: absolute; bottom: -8px; left: 50%; width: 10px; height: 10px; margin-left: -6px;
  background: #fff; border: solid var(--ink); border-width: 0 2px 2px 0; transform: rotate(45deg);
}

.state { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; margin: 0; font-weight: 700; color: var(--ink); }
.state.err { gap: 14px; padding: 0 12%; text-align: center; }
.state.err p { margin: 0; background: #fff; border: 2px solid #d9480f; border-radius: 12px; padding: 12px 16px; color: #b3380a; line-height: 1.7; font-weight: 600; }
.state.err button { padding: 9px 22px; border-radius: 12px; border: 2px solid var(--ink); background: var(--yellow); font-weight: 800; cursor: pointer; }

.controls { position: absolute; left: 50%; bottom: 34px; transform: translateX(-50%); display: flex; align-items: center; gap: 12px; }
.views { display: flex; background: #fff; border: 2.5px solid var(--ink); border-radius: 16px; padding: 4px; box-shadow: 4px 4px 0 var(--ink); }
.views button {
  border: 0; background: transparent; padding: 9px 15px; border-radius: 11px; font-size: 15px; font-weight: 800; white-space: nowrap;
  color: var(--text); cursor: pointer; font-family: inherit;
}
.views button.on { background: var(--yellow); color: var(--ink); }
.play {
  width: 48px; height: 48px; border-radius: 50%; border: 2.5px solid var(--ink); background: #fff; cursor: pointer;
  display: grid; place-items: center; box-shadow: 4px 4px 0 var(--ink);
}
.play svg { width: 20px; height: 20px; fill: var(--ink); }
.play:disabled { opacity: .35; cursor: not-allowed; }
.explode {
  height: 48px; padding: 0 20px; border-radius: 16px; border: 2.5px solid var(--ink); background: #fff; cursor: pointer;
  font-size: 15px; font-weight: 900; font-family: inherit; color: var(--ink); box-shadow: 4px 4px 0 var(--ink); white-space: nowrap;
}
.explode.on { background: var(--yellow); }
.explode:disabled { opacity: .35; cursor: default; }
.caption { position: absolute; left: 0; right: 0; bottom: 0; margin: 0; text-align: center; font-size: 12px; color: var(--muted); }

@media (max-width: 960px) {
  .stage-wrap { height: 62vh; }
}
</style>
