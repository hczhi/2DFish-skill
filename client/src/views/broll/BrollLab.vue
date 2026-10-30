<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import CardStage from '../../components/broll/CardStage.vue'
import LabTile from '../../components/broll/LabTile.vue'
import { TEMPLATES, SUBTITLE_ZONE, LIB_CATEGORIES, categoryOf, defaultBox, type TemplateDef } from '../../components/broll/templates'
import { THEMES, themeById, hasFont } from '../../components/broll/theme'
import { statusOf, loadTemplateStatus, setTemplateStatus, statusError } from '../../components/broll/templateStatus'

// 动效卡调试台（画廊式）：上面一块主预览（可暂停 / 拖进度 / ←→ 换卡），下面是这张卡所有测试数据的
// 入场中 / 停住 / 出场中三个关键帧 + 自动体检（出画面 / 压字幕区 / 主题字体本机有没有）；再往下是按分类排的卡片墙，
// 滚进视口的格子才循环播放。作者在这里看过没问题，模版才改成 live。

const GAP = 0.6
// 调试台里每张卡停留 = 它的最短停留 + 1 秒
const durOf = (tpl: TemplateDef, d: Record<string, any>) => tpl.minDuration(d) + 1

const route = useRoute()
const router = useRouter()

const aspect = ref<'16:9' | '9:16'>('16:9')
const theme = ref(THEMES[0].id)
const bg = ref<'dark' | 'light' | 'grid' | 'image'>('dark')
const bgImage = ref('')

function onPickBg(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (!f) return
  if (bgImage.value) URL.revokeObjectURL(bgImage.value)
  bgImage.value = URL.createObjectURL(f)
  bg.value = 'image'
}

// ── 筛选 ──
const cat = ref<string>('全部')
const q = ref('')
const matches = (tpl: TemplateDef) => {
  if (cat.value !== '全部' && categoryOf(tpl.id) !== cat.value) return false
  const k = q.value.trim().toLowerCase()
  if (!k) return true
  return [tpl.id, tpl.name, categoryOf(tpl.id), ...tpl.fields.map((f) => f.label), ...tpl.fixtures.map((f) => f.name)]
    .join(' ').toLowerCase().includes(k)
}
const sections = computed(() =>
  LIB_CATEGORIES.map((c) => ({ cat: c, list: TEMPLATES.filter((t) => categoryOf(t.id) === c && matches(t)) })).filter((s) => s.list.length),
)
// ←→ 按卡片墙上的顺序走
const ordered = computed(() => sections.value.flatMap((s) => s.list))

// ── 主预览 ──
const heroId = ref<string>(String(route.query.card || '') || TEMPLATES[0].id)
const heroFx = ref(0)
const hero = computed(() => TEMPLATES.find((t) => t.id === heroId.value) || TEMPLATES[0])
const heroFixture = computed(() => hero.value.fixtures[Math.min(heroFx.value, hero.value.fixtures.length - 1)])
const heroDur = computed(() => durOf(hero.value, heroFixture.value.data))
const heroT = ref(0)
const playing = ref(true)
const heroEl = ref<HTMLElement>()

function pick(tpl: TemplateDef, scroll = true) {
  heroId.value = tpl.id
  heroFx.value = 0
  heroT.value = 0
  playing.value = true
  router.replace({ query: { ...route.query, card: tpl.id } })
  if (scroll) heroEl.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
function step(dir: number) {
  const list = ordered.value
  if (!list.length) return
  const i = list.findIndex((t) => t.id === heroId.value)
  pick(list[(i + dir + list.length) % list.length], false)
}
function pickFx(i: number) { heroFx.value = i; heroT.value = 0; playing.value = true }
function onScrub(e: Event) { heroT.value = Number((e.target as HTMLInputElement).value); playing.value = false }

// 一个时钟：卡片墙按 now 循环，主预览按 heroT（能暂停 / 拖）
const now = ref(0)
let raf = 0
let last = 0
function tick(ts: number) {
  const dt = last ? (ts - last) / 1000 : 0
  last = ts
  now.value += dt
  if (playing.value) {
    heroT.value += dt
    if (heroT.value > heroDur.value + GAP) heroT.value = 0
  }
  raf = requestAnimationFrame(tick)
}
function onKey(e: KeyboardEvent) {
  const tag = (e.target as HTMLElement)?.tagName
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
  if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1) }
  else if (e.key === 'ArrowRight') { e.preventDefault(); step(1) }
  else if (e.key === ' ') { e.preventDefault(); playing.value = !playing.value }
}
onMounted(() => { raf = requestAnimationFrame(tick); loadTemplateStatus(); window.addEventListener('keydown', onKey) })
onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  window.removeEventListener('keydown', onKey)
  if (bgImage.value) URL.revokeObjectURL(bgImage.value)
})
// 筛选把当前主预览筛掉了，就换成筛选结果的第一张（不然主预览和下面的墙对不上）
watch(ordered, (list) => { if (list.length && !list.some((t) => t.id === heroId.value)) pick(list[0], false) })

// ── 上线 / 下线 ──
const toggling = ref('')
const toggleError = ref('')
async function toggle(tpl: TemplateDef) {
  toggling.value = tpl.id
  toggleError.value = ''
  try {
    await setTemplateStatus(tpl.id, statusOf(tpl.id) === 'live' ? 'draft' : 'live')
  } catch (e: any) {
    toggleError.value = `「${tpl.name}」${statusOf(tpl.id) === 'live' ? '下线' : '上线'}失败：${e?.message || e}`
  } finally {
    toggling.value = ''
  }
}

const box = computed(() => defaultBox(aspect.value))
const W = computed(() => (aspect.value === '16:9' ? 1920 : 1080))
const H = computed(() => (aspect.value === '16:9' ? 1080 : 1920))

const keyT = (tpl: TemplateDef, d: Record<string, any>, i: number) => {
  const k = tpl.keyframes(d)[i]
  return Math.round((k < 0 ? durOf(tpl, d) + k : k) * 100) / 100
}
// phase：卡片墙每格错开一点起播，不然整面墙同时出场、同时空着
const loopT = (tpl: TemplateDef, d: Record<string, any>, phase = 0) => Math.min((now.value + phase) % (durOf(tpl, d) + GAP), durOf(tpl, d))
// 「全屏看」：把所有测试数据都按全屏卡渲染一遍（每张卡都可能被切成全屏，要都看过）
const fullAll = ref(false)
const withDuration = (tpl: TemplateDef, d: Record<string, any>) => ({ ...d, duration: durOf(tpl, d), fullscreen: !d.scene && (fullAll.value || d.fullscreen) })

// ── 体检 ──
// 尺寸只在主预览下面那排「停住」帧上量 —— 没当过主预览的卡不能报「0 组有问题」，那是没检查，不是没问题
const sizes = reactive<Record<string, { w: number; h: number }>>({})
const measured = (tpl: TemplateDef) => tpl.fixtures.every((f) => sizes[`${tpl.id}:${f.name}`])
function problems(tpl: TemplateDef, f: { name: string; data: Record<string, any> }): string[] {
  const sz = sizes[`${tpl.id}:${f.name}`]
  if (!sz) return []
  // 全屏卡会自动缩放居中，不存在出画面 / 压字幕区
  if (f.data.fullscreen || f.data.scene || fullAll.value) return tpl.check?.(f.data) || []
  const b = box.value
  const x = b.x * W.value, y = b.y * H.value, w = sz.w * b.s, h = sz.h * b.s
  const out: string[] = []
  // 编辑页放卡时会自动缩到放得下（BrollPage 的 fitCard）。所以这里只在「要缩得太小」时才算问题，
  // 缩一点点的写成提示 —— 全标红的话真正要改文案的那几组淹没在一堆红里
  const fit = Math.min(b.s, (W.value - x - 40) / sz.w, (H.value * (1 - SUBTITLE_ZONE) - y - 10) / sz.h)
  if (fit < 0.6) out.push(`放进画面要缩到 ${Math.round(fit * 100)}%，字会偏小（卡片 ${Math.round(w)}×${Math.round(h)}）`)
  return [...out, ...(tpl.check?.(f.data) || [])]
}
function fitHint(tpl: TemplateDef, f: { name: string; data: Record<string, any> }) {
  const sz = sizes[`${tpl.id}:${f.name}`]
  if (!sz || f.data.fullscreen || f.data.scene || fullAll.value) return ''
  const b = box.value
  const fit = Math.min(b.s, (W.value - b.x * W.value - 40) / sz.w, (H.value * (1 - SUBTITLE_ZONE) - b.y * H.value - 10) / sz.h)
  return fit < b.s - 0.005 && fit >= 0.6 ? `放上去会自动缩到 ${Math.round(fit * 100)}%` : ''
}
const badCount = (tpl: TemplateDef) => tpl.fixtures.filter((f) => problems(tpl, f).length).length

const themeFonts = computed(() => themeById(theme.value).fonts.map((f) => ({ name: f, ok: hasFont(f) })))
const firstFontOk = computed(() => {
  // 主题的中文、等宽字体各自至少要有一个在本机生效，否则全部落到浏览器默认字体
  const vars = themeById(theme.value).vars
  const chain = (v: string) => v.split(',').map((s) => s.trim().replace(/"/g, '')).filter((s) => !['sans-serif', 'monospace', 'serif'].includes(s))
  return {
    cn: chain(vars['--font-cn']).find(hasFont) || null,
    mono: chain(vars['--font-mono']).find(hasFont) || null,
  }
})
const liveCount = computed(() => TEMPLATES.filter((t) => statusOf(t.id) === 'live').length)
</script>

<template>
  <div class="lab">
    <header class="topbar">
      <h1>动效卡调试台</h1>
      <span class="sub">{{ TEMPLATES.length }} 张卡 · 已上线 {{ liveCount }}</span>
      <span class="spacer" />
      <div class="seg">
        <button :class="{ on: aspect === '16:9' }" @click="aspect = '16:9'">横屏</button>
        <button :class="{ on: aspect === '9:16' }" @click="aspect = '9:16'">竖屏</button>
      </div>
      <select v-model="theme" title="主题"><option v-for="th in THEMES" :key="th.id" :value="th.id">{{ th.name }}</option></select>
      <div class="seg">
        <button :class="{ on: bg === 'dark' }" @click="bg = 'dark'">深色</button>
        <button :class="{ on: bg === 'light' }" @click="bg = 'light'">浅色</button>
        <button :class="{ on: bg === 'grid' }" @click="bg = 'grid'">透明</button>
        <button v-if="bgImage" :class="{ on: bg === 'image' }" @click="bg = 'image'">口播截图</button>
      </div>
      <label class="chk"><input v-model="fullAll" type="checkbox" />全屏看</label>
      <label class="tbtn">换成我的口播截图<input type="file" accept="image/*" hidden @change="onPickBg" /></label>
    </header>

    <nav class="tabs">
      <div class="cats">
        <span v-for="c in ['全部', ...LIB_CATEGORIES]" :key="c" class="tab" :class="{ on: cat === c }" @click="cat = c">{{ c }}</span>
      </div>
      <span class="spacer" />
      <input v-model="q" class="search" placeholder="搜卡名 / 字段 / 测试数据" />
    </nav>

    <div class="notes">
      <div class="note" :class="{ bad: !firstFontOk.cn || !firstFontOk.mono }">
        字体：中文 <b>{{ firstFontOk.cn || '浏览器默认（主题字体本机一个都没有）' }}</b> ·
        等宽 <b>{{ firstFontOk.mono || '浏览器默认（主题字体本机一个都没有）' }}</b>
        <span class="dim">（{{ themeFonts.map((f) => `${f.name} ${f.ok ? '✓' : '✗'}`).join(' · ') }}）导出在服务器上渲染，服务器上得装同样的字体，否则导出的字和这里不一样。</span>
      </div>
      <div v-if="statusError" class="note bad">{{ statusError }}</div>
      <div v-if="toggleError" class="note bad">{{ toggleError }}</div>
    </div>

    <div v-if="!ordered.length" class="empty">没有符合「{{ q }}」的卡</div>

    <template v-else>
      <!-- 主预览 -->
      <section ref="heroEl" class="hero" :class="{ portrait: aspect === '9:16' }">
        <div class="hero-player">
          <CardStage
            :component="hero.component" :data="withDuration(hero, heroFixture.data)" :t="Math.min(heroT, heroDur)"
            :aspect="aspect" :box="box" :theme="theme" :bg="bg" :bg-image="bgImage"
          />
          <button class="nav prev" title="上一张（←）" @click="step(-1)">‹</button>
          <button class="nav next" title="下一张（→）" @click="step(1)">›</button>
          <span class="pos">{{ ordered.findIndex((t) => t.id === hero.id) + 1 }} / {{ ordered.length }}</span>
          <div class="hud">
            <button class="pp" @click="playing = !playing">{{ playing ? '❚❚' : '▶' }}</button>
            <input type="range" min="0" :max="heroDur" step="0.01" :value="Math.min(heroT, heroDur)" @input="onScrub" />
            <span class="tc">{{ Math.min(heroT, heroDur).toFixed(2) }} / {{ heroDur.toFixed(1) }}s</span>
          </div>
        </div>

        <div class="hero-info">
          <h2>{{ hero.name }}<code>{{ hero.id }}</code></h2>
          <div class="chips">
            <span class="hchip">{{ categoryOf(hero.id) }}</span>
            <span class="hchip" :class="statusOf(hero.id)">{{ statusOf(hero.id) === 'live' ? '已上线' : '草稿' }}</span>
            <span class="hchip">最短停留 {{ hero.minDuration(heroFixture.data).toFixed(1) }}s</span>
            <span v-if="hero.cueTargets" class="hchip">可逐条定时</span>
          </div>
          <div v-if="hero.blurb" class="blurb">{{ hero.blurb }}</div>
          <div class="block">
            <b>测试数据</b>
            <div class="fx-chips">
              <span
                v-for="(f, i) in hero.fixtures" :key="f.name" class="fx-chip"
                :class="{ on: i === heroFx, bad: problems(hero, f).length }" @click="pickFx(i)"
              >{{ f.name }}</span>
            </div>
          </div>
          <div class="block">
            <b>可改字段</b>
            <span class="dim">{{ hero.fields.map((f) => f.label).join(' · ') || '（无）' }}</span>
          </div>
          <div class="block">
            <b>体检</b>
            <span v-if="!measured(hero)" class="dim">量尺寸中…</span>
            <span v-else-if="!badCount(hero)" class="ok">✓ {{ hero.fixtures.length }} 组全部通过</span>
            <span v-else class="badtxt">{{ badCount(hero) }} / {{ hero.fixtures.length }} 组有问题（见下方红字）</span>
          </div>
          <div class="act">
            <button class="btn primary" :disabled="toggling === hero.id || !!statusError" @click="toggle(hero)">
              {{ statusOf(hero.id) === 'live' ? '下线' : '上线' }}
            </button>
          </div>
          <div class="hint"><kbd>←</kbd> <kbd>→</kbd> 换卡　<kbd>空格</kbd> 暂停 / 播放　拖进度条逐帧看</div>
        </div>
      </section>

      <!-- 这张卡所有测试数据的关键帧 + 体检 -->
      <section class="frames">
        <div class="cols" :class="{ portrait: aspect === '9:16' }">
          <span /><span class="col-h">入场中</span><span class="col-h">停住</span><span class="col-h">出场中</span>
        </div>
        <div v-for="f in hero.fixtures" :key="`${hero.id}:${f.name}`" class="cols" :class="{ portrait: aspect === '9:16' }">
          <div class="fx">
            <b>{{ f.name }}</b>
            <span class="dim"> · 停 {{ durOf(hero, f.data).toFixed(1) }}s，关键帧 {{ [0, 1, 2].map((i) => keyT(hero, f.data, i)).join(' / ') }}s</span>
            <ul v-if="problems(hero, f).length" class="bad-list">
              <li v-for="p in problems(hero, f)" :key="p">{{ p }}</li>
            </ul>
            <span v-else-if="sizes[`${hero.id}:${f.name}`]" class="ok">✓ 体检通过</span>
            <span v-if="fitHint(hero, f)" class="dim fit">{{ fitHint(hero, f) }}</span>
          </div>
          <CardStage
            v-for="i in [0, 1, 2]" :key="i"
            :component="hero.component" :data="withDuration(hero, f.data)" :t="keyT(hero, f.data, i)"
            :aspect="aspect" :box="box" :theme="theme" :bg="bg" :bg-image="bgImage"
            @size="i === 1 && (sizes[`${hero.id}:${f.name}`] = $event)"
          />
        </div>
      </section>

      <!-- 卡片墙 -->
      <section v-for="s in sections" :key="s.cat" class="section">
        <div class="sec-head"><h3>{{ s.cat }}</h3><span class="cnt">{{ s.list.length }}</span><span class="rule" /></div>
        <div class="grid" :class="{ portrait: aspect === '9:16' }">
          <div v-for="tpl in s.list" :key="tpl.id" class="tile" :class="{ picked: tpl.id === hero.id }" @click="pick(tpl)">
            <div class="thumb">
              <LabTile
                :component="tpl.component" :data="withDuration(tpl, tpl.fixtures[0].data)" :t="loopT(tpl, tpl.fixtures[0].data, TEMPLATES.indexOf(tpl) * 0.37)"
                :aspect="aspect" :box="box" :theme="theme" :bg="bg" :bg-image="bgImage"
              />
              <span class="nm">{{ tpl.name }}</span>
            </div>
            <div class="bar">
              <code>{{ tpl.id }}</code>
              <span class="tag" :class="statusOf(tpl.id)">{{ statusOf(tpl.id) === 'live' ? '已上线' : '草稿' }}</span>
              <span class="sp" />
              <span v-if="measured(tpl) && badCount(tpl)" class="badtxt">{{ badCount(tpl) }} 组有问题</span>
              <span v-else-if="measured(tpl)" class="ok">✓</span>
              <span v-else class="dim">{{ tpl.fixtures.length }} 组</span>
            </div>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.lab {
  --bg: #0b0b0e; --panel: #131317; --line: #232329; --txt: #ececf1; --txt2: #c9c9d4; --dim: #8a8a96; --acc: #7a5af8; --acc2: #9a82ff;
  min-height: 100vh; background: var(--bg); color: var(--txt); padding-bottom: 60px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", sans-serif;
}
.dim { color: var(--dim); font-size: 13px; }
.ok { color: #3ddc97; font-size: 12px; }
.badtxt { color: #ff6b6b; font-size: 12px; }
.spacer, .sp { flex: 1; }

.topbar {
  position: sticky; top: 0; z-index: 40; display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 12px 32px; background: #050507f0; border-bottom: 1px solid #1a1a20; font-size: 13px;
}
.topbar h1 { margin: 0; font-size: 20px; font-weight: 800; }
.sub { color: var(--dim); }
.seg { display: flex; gap: 2px; background: #17171d; border: 1px solid #26262e; border-radius: 10px; padding: 2px; }
.seg button { border: 0; background: transparent; color: var(--txt2); border-radius: 8px; padding: 5px 11px; cursor: pointer; font: inherit; }
.seg button.on { background: var(--acc); color: #fff; }
.topbar select, .tbtn, .search {
  background: #17171d; border: 1px solid #26262e; color: var(--txt); border-radius: 10px; padding: 6px 12px; font: inherit; cursor: pointer;
}
.tbtn:hover { border-color: var(--acc); }
.chk { display: flex; align-items: center; gap: 6px; color: var(--txt2); }
.chk input { accent-color: var(--acc); }

.tabs {
  position: sticky; top: 58px; z-index: 39; display: flex; align-items: center; gap: 16px;
  padding: 0 32px; background: #0b0b0ef0; border-bottom: 1px solid #1a1a20;
}
.cats { display: flex; gap: 26px; overflow-x: auto; }
.tab { padding: 13px 2px 11px; font-size: 15px; color: var(--dim); cursor: pointer; user-select: none; border-bottom: 2.5px solid transparent; white-space: nowrap; }
.tab.on { color: var(--txt); border-color: var(--acc); font-weight: 600; }
.search { width: min(300px, 30vw); border-radius: 999px; cursor: text; outline: none; margin: 7px 0; }
.search:focus { border-color: var(--acc); }

.notes { padding: 14px 32px 0; display: grid; gap: 8px; }
.note { font-size: 13px; padding: 8px 14px; border-radius: 10px; background: var(--panel); border: 1px solid var(--line); color: var(--txt2); }
.note.bad { background: #3a1416; border-color: #ff6b6b; color: #ff9b9b; }
.empty { color: var(--dim); text-align: center; padding: 80px 0; }

.hero { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(300px, 1fr); gap: 22px; padding: 22px 32px 8px; align-items: start; scroll-margin-top: 110px; }
.hero.portrait { grid-template-columns: minmax(0, 420px) minmax(300px, 1fr); }
.hero-player { position: relative; border: 1px solid var(--line); border-radius: 16px; overflow: hidden; }
.hero-player :deep(.cs) { border-radius: 0; }
.nav {
  position: absolute; top: 45%; transform: translateY(-50%); width: 40px; height: 64px; font-size: 26px; color: #fff;
  background: rgba(5, 5, 8, 0.55); border: 0; border-radius: 12px; cursor: pointer; opacity: 0; transition: opacity 0.15s;
}
.hero-player:hover .nav { opacity: 1; }
.nav:hover { background: rgba(122, 90, 248, 0.75); }
.nav.prev { left: 12px; }
.nav.next { right: 12px; }
.pos { position: absolute; right: 14px; top: 12px; font: 12px Menlo, monospace; color: #fff; background: rgba(5, 5, 8, 0.62); padding: 4px 12px; border-radius: 999px; }
.hud { display: flex; align-items: center; gap: 10px; padding: 8px 12px; background: #0e0e12; border-top: 1px solid var(--line); }
.hud .pp { width: 30px; height: 26px; border: 0; border-radius: 6px; background: #1b1b22; color: #fff; cursor: pointer; font-size: 12px; }
.hud input { flex: 1; accent-color: var(--acc); }
.tc { font: 12px Menlo, monospace; color: var(--dim); min-width: 92px; text-align: right; }

.hero-info { display: flex; flex-direction: column; gap: 14px; padding: 6px 2px; min-width: 0; }
.hero-info h2 { margin: 0; font-size: 28px; font-weight: 800; }
.hero-info h2 code { font-size: 13px; color: var(--dim); font-weight: 400; margin-left: 10px; }
.chips { display: flex; gap: 8px; flex-wrap: wrap; }
.hchip { font-size: 12px; color: #b9b9c6; background: #1b1b22; border-radius: 999px; padding: 4px 12px; }
.hchip.live, .tag.live { background: #3ddc9722; color: #3ddc97; }
.blurb { font-size: 14px; line-height: 1.75; color: var(--txt2); }
.block { display: flex; flex-direction: column; gap: 6px; font-size: 13px; }
.block > b { color: var(--txt2); font-weight: 600; }
.fx-chips { display: flex; gap: 6px; flex-wrap: wrap; }
.fx-chip { font-size: 12px; padding: 4px 10px; border-radius: 8px; background: #17171d; border: 1px solid #26262e; color: var(--txt2); cursor: pointer; }
.fx-chip.on { border-color: var(--acc); color: var(--acc2); }
.fx-chip.bad { box-shadow: inset 0 -2px 0 #ff6b6b; }
.act .btn { font: inherit; font-size: 14px; padding: 7px 20px; border-radius: 10px; border: 1px solid var(--acc); background: var(--acc); color: #fff; cursor: pointer; font-weight: 600; }
.act .btn:disabled { opacity: 0.5; cursor: not-allowed; }
.hint { font-size: 12px; color: #5c5c68; }
kbd { background: #1b1b22; border: 1px solid #2a2a33; border-radius: 5px; padding: 1px 7px; font: 11px Menlo, monospace; color: #9d9dab; }

.frames { margin: 12px 32px 0; padding: 12px 18px; background: var(--panel); border: 1px solid var(--line); border-radius: 12px; }
.cols { display: grid; grid-template-columns: 200px repeat(3, 1fr); gap: 10px; align-items: start; padding: 8px 0; border-top: 1px solid #1c1c22; }
.cols:first-child { border-top: 0; padding-top: 0; }
.cols.portrait { grid-template-columns: 200px repeat(3, minmax(0, 200px)); }
.col-h { font-size: 12px; color: var(--dim); }
.fx { font-size: 13px; }
.fit { display: block; margin-top: 4px; font-size: 12px; }
.fx .ok { display: block; margin-top: 6px; }
.bad-list { margin: 6px 0 0; padding-left: 16px; color: #ff6b6b; font-size: 12px; }

.section { padding: 26px 32px 4px; }
.sec-head { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
.sec-head h3 { margin: 0; font-size: 17px; font-weight: 700; }
.sec-head .cnt { font-size: 12px; color: var(--dim); }
.sec-head .rule { flex: 1; height: 1px; background: #1c1c22; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px; }
.grid.portrait { grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); }
.tile { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; cursor: pointer; }
.tile:hover { border-color: #3d3d4a; }
.tile.picked { border-color: var(--acc); box-shadow: 0 0 0 1px #7a5af855; }
.thumb { position: relative; }
.thumb :deep(.cs) { border-radius: 0; }
.nm { position: absolute; left: 10px; bottom: 10px; font-size: 14px; font-weight: 800; color: #fff; background: rgba(5, 5, 8, 0.74); border-radius: 7px; padding: 4px 12px; pointer-events: none; }
.bar { display: flex; align-items: center; gap: 8px; padding: 9px 12px; font-size: 12px; color: var(--dim); }
.bar code { font-size: 11.5px; }
.tag { font-size: 10.5px; padding: 2px 8px; border-radius: 999px; background: #1e1e26; color: #9d9dab; }
</style>
