<template>
  <div class="page">
    <div class="head">
      <div>
        <h1>版式案例库</h1>
        <p class="sub">
          生成每一页时，AI 从这里挑一个版式照着排。案例<b>只关注排版结构</b> ——
          颜色一律走 <code>var(--c-*)</code> 变量、内容不绑死，所以同一个版式在橙/蓝/双色系的 deck 里都成立。
          卡片上是<b>我们的骨架跑出来的效果</b>（同一份 <code>template.html</code>，图是占位图）。
          不想要哪一条就把卡片右上角的开关关掉：<b>规划下一份稿子时 AI 就挑不到它了</b>。
          停用是<b>全站共用一份</b>（不分稿子），而且<b>只影响往后的规划</b> ——
          已经规划好的稿子里用到它的那几页照样能重新生成。
        </p>
      </div>
      <div class="head-right" v-if="!loading && !error">
        <div class="head-btns">
          <router-link class="btn-ghost" to="/ppt/decks">贴提纲试试排版规划 →</router-link>
          <a class="btn-ghost" :href="deckUrl" target="_blank">看整份 demo（{{ layouts.length }} 页）↗</a>
        </div>
        <div class="stat">
          可用 {{ layouts.length - disabledCount }} 个 · 停用 {{ disabledCount }} 个 · 带完整 CSS 骨架 {{ detailCount }} 个 · 全幅 {{ fullbleedCount }} 个
        </div>
      </div>
    </div>

    <!-- 开关存不上、或者停用之后少了一整种形状，都必须写在页面上：静默的话他以为关掉了，
         而下一份稿子里那一条照旧出现（或者出现一条形状不对的版式，每页看着都正常）。
         **不能夹在下面那条 v-if / v-else-if / v-else 链里** —— 中间插一个元素，
         `.grid` 上那个 v-else 就不认了，整页只剩标题。 -->
    <p v-if="switchErr" class="err">{{ switchErr }}</p>
    <p v-for="(w, i) in switchWarnings" :key="i" class="warn-line">{{ w }}</p>

    <p v-if="loading" class="hint">加载中…</p>
    <!-- 案例库读不到时必须整页报错，不能显示成一个空列表：空列表读起来像
         「案例库还没建」，而真实成因是服务器上那几个 md 文件不在。 -->
    <p v-else-if="error" class="err">{{ error }}</p>

    <div v-else class="grid">
      <div
        v-for="l in layouts" :key="l.id" class="card" :class="{ off: l.disabled }"
        role="button" tabindex="0" @click="open(l)" @keydown.enter.prevent="open(l)"
      >
        <!-- 缩略图放 demo 而不是原始截图：截图是别人家 deck 的（颜色和内容都不是我们的
             产出，案例库的铁律是「只关注排版结构」），用户照着它去期待，拿到自己品牌色的
             那一版会以为生成质量不行 —— 而那正是设计意图。demo 是同一份 template.html 跑
             出来的，所见即所得。截图降级到抽屉里，标着「原图参考」。
             iframe 要 pointer-events:none：deck 自己在 document 上挂了「点一下翻页」，
             不掐掉的话点卡片打不开抽屉（点击被 iframe 吃掉，页面毫无反应）。 -->
        <div class="thumb">
          <iframe :src="l.demoUrl" loading="lazy" scrolling="no" :title="`${l.id} 效果 demo`"></iframe>
          <span class="thumb-badge demo">效果 demo</span>
          <span v-if="l.refImage" class="thumb-badge ref">有原图</span>
        </div>
        <div class="meta">
          <div class="row">
            <span class="id">{{ l.id }}</span>
            <span class="tag full" v-if="l.fullbleed">全幅</span>
            <span class="tag card-tag" v-if="l.hasCard">出血卡</span>
            <span class="tag detail" v-if="l.hasDetail">骨架 {{ l.buildLines }} 行</span>
            <!-- 开关必须**显示服务端那份状态**、点完再按返回值重画：本地取反的话
                 「某个页型最后一条不能停用」那种拒绝会变成「开关动了、下次刷新又弹回去」，
                 而拒绝的理由一个字都看不到。 -->
            <button
              class="sw" :class="{ on: !l.disabled }" :disabled="savingId === l.id"
              @click.stop="toggle(l)"
              :title="l.disabled ? '已停用：规划时 AI 挑不到它' : '启用中：规划时 AI 可以挑它'"
            >{{ savingId === l.id ? '…' : (l.disabled ? '已停用' : '启用中') }}</button>
          </div>
          <div class="name">{{ l.name }}</div>
          <div class="title">{{ l.title }}</div>
          <div class="applicable">{{ l.applicable }}</div>
        </div>
      </div>
    </div>

    <!-- 详情抽屉 -->
    <div v-if="active" class="drawer-mask" @click.self="active = null">
      <div class="drawer">
        <div class="drawer-head">
          <div>
            <h2>{{ active.id }} · {{ active.name }}</h2>
            <p class="title">{{ active.title }}</p>
          </div>
          <div class="drawer-actions">
            <a :href="active.demoUrl" target="_blank" class="btn-ghost">单开这一页 ↗</a>
            <a :href="`${deckUrl}#n${active.num}`" target="_blank" class="btn-ghost">在整份 deck 里看 ↗</a>
            <a v-if="active.refImage" :href="active.refImage" target="_blank" class="btn-ghost">看原图 ↗</a>
            <button class="btn-ghost" @click="active = null">关闭</button>
          </div>
        </div>
        <div class="drawer-body">
          <!-- demo 排在截图**上面**：它是我们的骨架跑出来的效果，颜色走 var(--c-*)、
               图是占位图，跟生成产出是同一条路径。截图只是当初启发这个版式的原件。
               iframe 不做手动缩放：deck 自己的 fit() 按 iframe 视口等比缩放，
               再叠一层 transform 会缩两遍（页面上是一小块贴在左上角）。 -->
          <h3>效果 demo（我们的骨架跑出来的样子，颜色随 deck 配色变）</h3>
          <div class="demo-frame">
            <iframe :src="active.demoUrl" :title="`${active.id} 效果 demo`"></iframe>
          </div>

          <template v-if="active.refImage">
            <h3>原图参考<span class="warn">（别人家 deck 的截图，颜色和内容都不作为产出预期）</span></h3>
            <p v-if="imgErrors[active.id]" class="err">参考图打不开（client/public/ppt-cases 没跟着部署上去）。</p>
            <img class="ref" :src="active.refImage" :alt="active.id" @error="onImgError(active.id)" />
          </template>

          <h3>AI 选版式时读到的（短）</h3>
          <pre class="select-text">{{ active.selectText }}</pre>

          <h3>AI 生成这一页时读到的（长）</h3>
          <p v-if="detailLoading" class="hint">加载中…</p>
          <p v-else-if="detailError" class="err">{{ detailError }}</p>
          <div v-else class="md" v-html="detailHtml"></div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { apiGet, apiPut } from '../../lib/api'
import { renderMarkdown } from '../../lib/markdown'

interface Layout {
  id: string; num: number; name: string; title: string;
  applicable: string; structure: string; imageSlots: string;
  designHint: string; variants: string;
  fullbleed: boolean; hasCard: boolean; hasDetail: boolean;
  refImage?: string; demoUrl: string;
  selectText: string; buildLines: number;
  /** 停用了（规划时给模型的清单里没有它，但老稿子里那几页照旧能重新生成）。 */
  disabled?: boolean;
}

/** 整份 demo deck（22 页）。单页是它加上 ?only=Lk。 */
const deckUrl = '/api/ppt/demo-deck.html'

const layouts = ref<Layout[]>([])
const loading = ref(true)
const error = ref('')
const imgErrors = ref<Record<string, boolean>>({})

const active = ref<Layout | null>(null)
const detailHtml = ref('')
const detailLoading = ref(false)
const detailError = ref('')

const savingId = ref('')
const switchErr = ref('')
const switchWarnings = ref<string[]>([])

const disabledCount = computed(() => layouts.value.filter(l => l.disabled).length)
const detailCount = computed(() => layouts.value.filter(l => l.hasDetail).length)
const fullbleedCount = computed(() => layouts.value.filter(l => l.fullbleed).length)

async function load() {
  try {
    const data = await apiGet<{ layouts: Layout[] }>('/api/ppt/layouts')
    layouts.value = data.layouts || []
    if (!layouts.value.length) error.value = '案例库返回了 0 个版式 —— 服务端读不到 layout-library.md。'
  } catch (e: any) {
    error.value = e.message || '案例库加载失败'
  }
  loading.value = false
}

/**
 * 开 / 关一条。**照服务端返回的那份清单重画**，不在本地取反 —— 取反的话
 * 「某个页型最后一条不能停用」那种拒绝会表现成「开关动了一下、刷新又弹回去」，
 * 而拒绝的理由他一个字都看不到。
 */
async function toggle(l: Layout) {
  if (savingId.value) return
  savingId.value = l.id
  switchErr.value = ''
  switchWarnings.value = []
  try {
    const r = await apiPut<{ disabled: string[]; warnings: string[] }>(
      `/api/ppt/layouts/${l.id}/enabled`, { enabled: !!l.disabled }
    )
    const off = new Set(r.disabled || [])
    layouts.value = layouts.value.map(x => ({ ...x, disabled: off.has(x.id) }))
    switchWarnings.value = r.warnings || []
  } catch (e: any) {
    switchErr.value = e?.message || '没改上（这一条的状态没变）'
  }
  savingId.value = ''
}

// 参考图 404 要写在抽屉里：破图图标和「这条案例本来就没有图」长得一样，
// 而前者说明 client/public/ppt-cases 没跟着部署上去。
function onImgError(id: string) { imgErrors.value[id] = true }

async function open(l: Layout) {
  active.value = l
  detailHtml.value = ''
  detailError.value = ''
  detailLoading.value = true
  try {
    const data = await apiGet<{ layout: Layout & { buildText: string } }>(`/api/ppt/layouts/${l.id}`)
    detailHtml.value = renderMarkdown(data.layout.buildText || '')
  } catch (e: any) {
    detailError.value = e.message || '详情加载失败'
  }
  detailLoading.value = false
}

onMounted(load)
</script>

<style scoped>
.page { max-width: 1240px; margin: 0 auto; padding: 32px 24px 64px; }
.head { display: flex; justify-content: space-between; align-items: flex-end; gap: 24px; margin-bottom: 28px; flex-wrap: wrap; }
h1 { font-size: 26px; margin: 0 0 8px; }
.sub { color: #6b7280; font-size: 13px; line-height: 1.7; max-width: 760px; margin: 0; }
.sub code { background: #f3f4f6; padding: 1px 5px; border-radius: 4px; font-size: 12px; }
.head-right { display: flex; flex-direction: column; align-items: flex-end; gap: 8px; }
.head-btns { display: flex; gap: 8px; }
.stat { font-size: 12px; color: #6b7280; white-space: nowrap; }
.warn-line { color: #92400e; background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 8px 12px; font-size: 13px; line-height: 1.7; margin: 0 0 8px; }
/* 停用的卡片压暗但**留在页面上**：藏起来的话他再也没有地方把它开回来。 */
.card.off { opacity: .48; }
.card.off .thumb { filter: grayscale(1); }
.sw { margin-left: auto; border: 1px solid #d1d5db; background: #fff; color: #6b7280; font-size: 11px; padding: 2px 9px; border-radius: 99px; cursor: pointer; }
.sw.on { border-color: #86efac; background: #f0fdf4; color: #15803d; }
.sw:disabled { opacity: .5; cursor: default; }
.hint { color: #6b7280; font-size: 13px; }
.err { color: #dc2626; font-size: 13px; }

.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 20px; }
.card {
  text-align: left; background: #fff; border: 1px solid #e5e7eb; border-radius: 12px;
  padding: 0; overflow: hidden; cursor: pointer; transition: box-shadow .2s, transform .2s;
  display: flex; flex-direction: column;
}
.card:hover { box-shadow: 0 10px 28px rgba(0,0,0,.08); transform: translateY(-2px); }
.thumb {
  position: relative; aspect-ratio: 16 / 9; background: #fff; overflow: hidden;
  border-bottom: 1px solid #eef0f3;
}
/* deck 自己的 fit() 会按 iframe 视口等比缩放，所以这里给满宽满高就行；
   pointer-events:none 见模板里的注释（deck 在 document 上挂了「点一下翻页」）。 */
.thumb iframe { width: 100%; height: 100%; border: 0; pointer-events: none; }
.thumb-badge {
  position: absolute; left: 8px; top: 8px; font-size: 10px; padding: 2px 6px;
  border-radius: 3px; backdrop-filter: blur(4px);
}
.thumb-badge.ref { background: rgba(17,24,39,.62); color: #fff; left: auto; right: 8px; }
.thumb-badge.demo { background: rgba(22,163,74,.9); color: #fff; }
.meta { padding: 12px 14px 16px; }
.row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 6px; }
.id { font-weight: 700; font-size: 13px; }
.tag { font-size: 10px; padding: 1px 6px; border-radius: 3px; border: 1px solid currentColor; }
.tag.full { color: #b45309; }
.tag.card-tag { color: #7c3aed; }
.tag.detail { color: #2563eb; }
.name { font-family: var(--font-mono, monospace); font-size: 12px; color: #374151; }
.title { font-size: 13px; font-weight: 600; margin-top: 2px; }
.applicable {
  font-size: 12px; color: #6b7280; line-height: 1.6; margin-top: 6px;
  display: -webkit-box; -webkit-line-clamp: 3; line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
}

.drawer-mask { position: fixed; inset: 0; background: rgba(15,23,42,.45); display: flex; justify-content: flex-end; z-index: 50; }
.drawer { width: min(860px, 92vw); background: #fff; display: flex; flex-direction: column; }
.drawer-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; padding: 20px 24px; border-bottom: 1px solid #eef0f3; }
.drawer-head h2 { font-size: 17px; margin: 0; }
.drawer-head .title { font-size: 13px; color: #6b7280; margin: 4px 0 0; }
.drawer-actions { display: flex; gap: 10px; align-items: center; }
.btn-ghost { border: 1px solid #d1d5db; background: #fff; border-radius: 8px; padding: 5px 12px; font-size: 12px; cursor: pointer; color: #374151; text-decoration: none; }
.drawer-body { overflow: auto; padding: 20px 24px 48px; }
.ref { width: 100%; border-radius: 10px; border: 1px solid #e5e7eb; margin-bottom: 20px; }
.demo-frame {
  position: relative; width: 100%; aspect-ratio: 16 / 9; overflow: hidden;
  border-radius: 10px; border: 1px solid #e5e7eb; background: #fff;
}
.demo-frame iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
h3 { font-size: 13px; margin: 20px 0 8px; color: #374151; }
h3 .warn { font-weight: 400; color: #b45309; margin-left: 4px; }
.select-text { background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px 14px; font-size: 12px; line-height: 1.7; white-space: pre-wrap; margin: 0; }
.md { font-size: 13px; line-height: 1.8; color: #1f2937; }
.md :deep(code) { background: #f3f4f6; padding: 1px 5px; border-radius: 4px; font-size: 12px; }
.md :deep(pre) { background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; overflow: auto; }
/* .md-table 这层 wrapper 和 lib/markdown.ts 是一对：少了它横向溢出的是抽屉本身，
   标题和按钮会一起滚出可视区；td 的 min-width 少了这层滚动永远不会真的滚。 */
.md :deep(.md-table) { overflow-x: auto; margin: 12px 0; }
.md :deep(table) { border-collapse: collapse; font-size: 12px; }
.md :deep(td), .md :deep(th) { border: 1px solid #e5e7eb; padding: 6px 10px; min-width: 90px; text-align: left; }
</style>
