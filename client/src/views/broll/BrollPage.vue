<script setup lang="ts">
import { ref, reactive, computed, onMounted, onBeforeUnmount, provide, watch, nextTick } from 'vue'
import { parseSrt, fmtTime, type SubLine } from '../../components/broll/srt'
import { apiPost, api } from '../../lib/api'
import { defaultBox as boxFor, TEMPLATES, templateById, fullscreenScale, SUBTITLE_ZONE, LIB_CATEGORIES, categoryOf, type TemplateDef } from '../../components/broll/templates'
import CardStage from '../../components/broll/CardStage.vue'
import { cueAt } from '../../components/broll/cues'
import { THEMES, themeById } from '../../components/broll/theme'
import { THEME_KEY } from '../../components/broll/themeContext'
import FullFrame from '../../components/broll/FullFrame.vue'
import ChapterNav, { type NavChapter } from '../../components/broll/ChapterNav.vue'
import { statusOf, loadTemplateStatus, statusLoaded, statusError } from '../../components/broll/templateStatus'
import { fetchMe, isAdmin } from '../../lib/auth'
import { activeAppKey, keyInfo, refreshKeyInfo } from '../../lib/appKey'
import { uploadImage } from '../../components/broll/upload'

// 口播动效卡（B-roll）：本地口播视频 + SRT → 在字幕上挂卡片（手动 / AI 配卡）→ 按时间叠加预览。
// 口播视频不上传：用 objectURL 在本地播。播放头 t 是唯一的状态 —— 有视频时 t 就是
// video.currentTime（每帧读一次），没视频时自己走；卡片一律按 t 画，拖进度条和播放走同一条路。

// x / y 是卡片左上角在画布上的位置（占画布宽 / 高的比例，横竖屏切换时跟着走），s 是缩放倍数
// aiSummary：AI 概括（不是原话）的字段，面板上标出来；他改过那一栏就去掉标记
// track：时间轴上第几条轨道（0 = 最下面）。上面的轨道在画面里盖住下面的，和剪映一样；同一条轨道上的卡时间不重叠
// fitNote：放上来 / 换画幅时自动缩小过，说一声缩到了多少（不说的话他会奇怪字怎么变小了）
interface Card { fitNote?: string; id: number; template: string; track: number; start: number; end: number; x: number; y: number; s: number; data: Record<string, any>; aiSummary?: string[] }

const tplOf = (c: Card) => templateById(c.template) as TemplateDef

let nextId = 1
const DEMO_ID = nextId // 打开页面时那张示例卡，导入字幕时撤掉
// ── 画幅 ──
const aspect = ref<'16:9' | '9:16'>('16:9')
const W = computed(() => (aspect.value === '16:9' ? 1920 : 1080))
const H = computed(() => (aspect.value === '16:9' ? 1080 : 1920))
const defaultBox = () => boxFor(aspect.value)
const theme = ref(THEMES[0].id)
provide(THEME_KEY, theme)
const themeAccent = computed(() => themeById(theme.value).vars['--accent'])

const cards = ref<Card[]>([{ id: nextId++, template: 'number', track: 0, start: 0, end: 4, ...defaultBox(), data: defaultData('number', { label: 'GROWTH', prefix: '+', value: '300', unit: '%', title: '去年营收增长' }) }])
const selectedId = ref<number | null>(cards.value[0].id)
const selected = computed(() => cards.value.find((c) => c.id === selectedId.value) || null)

// 卡片自然尺寸（画布坐标，未缩放），由卡片组件量好报上来。
// 出画面的部分导出时被裁掉，而导出照样「成功」—— 所以按实际位置 × 大小判断，标红出来。
const sizes = reactive<Record<number, { w: number; h: number }>>({})
function isOverflow(c: Card) {
  const sz = sizes[c.id]
  if (!sz) return false
  if (c.data.fullscreen || c.data.scene) return false // 全屏卡自动缩放居中；B-roll 场景本来就铺满
  const x = c.x * W.value, y = c.y * H.value
  return x < -1 || y < -1 || x + sz.w * c.s > W.value + 1 || y + sz.h * c.s > H.value + 1
}

function defaultData(template: string, over: Record<string, any> = {}) {
  return structuredClone({ ...templateById(template)!.defaults, ...over })
}
// 停留比模版的最短时长还短时，动画没走完就被切掉 —— 画面上只是「怎么一闪就没了」，要说出来
function dataProblems(c: Card) {
  const need = tplOf(c).minDuration(c.data)
  const dur = c.end - c.start
  // 被上面一层的全屏画面（全屏卡 / B-roll 场景）整段盖住：画面里完全看不见，时间轴上却一切正常。
  // seeThrough 的铺满画布卡（标题降格成标签、透明底的叙事转折）除了字是透明的，不算盖住；按数据决定的走模板的 seeThrough(data)
  const cover = cards.value.find((o) => o.id !== c.id && o.track > c.track && (o.data.fullscreen || (o.data.scene && !(tplOf(o).seeThrough?.(o.data) ?? o.data.seeThrough))) && o.start <= c.start && o.end >= c.end)
  return [
    ...lateCues(c).map((x) => `第 ${x.i + 1} 条「${x.tg}」在 ${(c.start + x.at).toFixed(1)} 秒才出现，卡片 ${c.end.toFixed(1)} 秒就结束了，这一条出不来`),
    ...(cover ? [`整段被第 ${cover.track + 1} 层的全屏画面「${tplOf(cover).name}」盖住了，画面里看不见 —— 上移一层或挪开时间`] : []),
    ...(tplOf(c).check?.(c.data) || []),
    ...(dur < need - 0.05 ? [`只停 ${dur.toFixed(1)} 秒，这张卡完整播完要 ${need.toFixed(1)} 秒，后面的动画会被截掉`] : []),
  ]
}

// ── 素材 ──
const videoUrl = ref('')
const videoName = ref('')
const videoEl = ref<HTMLVideoElement>()
const videoDuration = ref(0)
const subs = ref<SubLine[]>([])
const srtName = ref('')
const srtSkipped = ref(0)
const srtError = ref('')
const showSubs = ref(true)

function onPickVideo(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (!f) return
  if (videoUrl.value) URL.revokeObjectURL(videoUrl.value)
  videoUrl.value = URL.createObjectURL(f)
  videoName.value = f.name
  playing.value = false
  seek(0)
}
onBeforeUnmount(() => { if (videoUrl.value) URL.revokeObjectURL(videoUrl.value) })

async function onPickSrt(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (!f) return
  const r = parseSrt(await f.text())
  srtName.value = f.name
  srtSkipped.value = r.skipped
  srtError.value = r.lines.length ? '' : `「${f.name}」里没读到任何一句带时间的字幕，确认导出的是 SRT 格式`
  subs.value = r.lines
  if (r.lines.length) removeCard(DEMO_ID)
}

// 在任意时间放一张卡：停留默认是模版的最短时长（入场 + 出场看得全），想放哪条轨道就从那条往上找第一条空着的
function placeCardAt(template: string, start: number, opts: { end?: number; track?: number; over?: Record<string, any> } = {}): Card {
  const data = defaultData(template, opts.over || {})
  const r2 = (v: number) => Math.round(v * 100) / 100
  const s0 = r2(Math.max(0, start))
  const end = r2(Math.max(opts.end ?? 0, s0 + templateById(template)!.minDuration(data)))
  const c: Card = { id: nextId++, template, track: 0, start: s0, end, ...defaultBox(), data }
  c.track = freeTrack(c, opts.track ?? 0)
  cards.value.push(c)
  pendingFit.add(c.id)
  cards.value.sort((a, b) => a.start - b.start)
  return c
}
// 挂在字幕上的卡：入点出点一律按那句字幕的时间算，不从别处拿（AI 只回字幕编号）；
// 停留至少是模版的最短时长 —— 字幕一句常常不到 2 秒，入场 + 出场都看不全
function placeCard(l: SubLine, template: string, over: Record<string, any>, last: SubLine = l): Card {
  return placeCardAt(template, l.start, { end: last.end, over })
}

// ── 卡片库 ── 点一下 = 加在播放头那一刻；拖到时间轴上 = 放在落下的那个时间点、那条轨道。
// 内容先用这张卡的第一组测试数据占位（空卡什么都看不见，他不知道放上去的是什么）；
// 播放头正好在某句字幕上时，再用那句字幕预填（fromLine），和「在字幕上加卡」一样。
const libTab = ref<(typeof LIB_CATEGORIES)[number]>(LIB_CATEGORIES[0])
const libSearch = ref('')
const libItems = computed(() => {
  const q = libSearch.value.trim()
  const isScene = (tp: TemplateDef) => categoryOf(tp.id) === 'B-roll 场景'
  if (leftTab.value === 'scene') return addable.value.filter((tp) => isScene(tp) && (!q || tp.name.includes(q)))
  return addable.value.filter((tp) => !isScene(tp) && (q ? tp.name.includes(q) || tp.id.includes(q) : categoryOf(tp.id) === libTab.value))
})
const libThumb = (tp: TemplateDef) => {
  const d = tp.fixtures[0]?.data || tp.defaults
  const dur = tp.minDuration(d) + 1
  const k = tp.keyframes(d)[1]
  return { data: { ...d, duration: dur }, t: k < 0 ? dur + k : k }
}
function contentFor(tp: TemplateDef, at: number) {
  const sub = subs.value.find((l) => at >= l.start && at < l.end)
  const over: Record<string, any> = structuredClone(tp.fixtures[0]?.data || {})
  if (sub) {
    Object.assign(over, tp.fromLine(sub.text))
    if (NUMBERED.has(tp.id)) over.index = chapterIndexFor(sub, tp.id)
  }
  return over
}
function addAt(tp: TemplateDef, at: number, track?: number) {
  const c = placeCardAt(tp.id, at, { track, over: contentFor(tp, at) })
  selectCard(c)
  lastTemplate.value = tp.id
}
const lastTemplate = ref('')
const leftTab = ref<'lib' | 'scene' | 'subs'>('lib')
// 包装卡和 B-roll 场景分两个标签页（场景是全屏、盖住人像的，和叠加卡用途不同）
const CARD_CATS = LIB_CATEGORIES.filter((c) => c !== 'B-roll 场景')
const bannerOpen = ref(true)
const dragTpl = ref('')
const dropAt = ref<{ t: number; track: number } | null>(null)
function onLibDragStart(e: DragEvent, tp: TemplateDef) {
  dragTpl.value = tp.id
  e.dataTransfer?.setData('text/plain', tp.id)
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy'
}
function dropPos(e: DragEvent) {
  const el = tlIn.value
  if (!el) return null
  const r = el.getBoundingClientRect()
  const t0 = Math.max(0, (e.clientX - r.left) / pps.value)
  // 时间轴从上到下是：刻度尺 → 字幕行 → 轨道（最上面那条是最高层）
  const rowFromTop = Math.floor((e.clientY - r.top - RULER_H - SUB_ROW_H) / ROW_H)
  const track = Math.max(0, trackCount.value - 1 - rowFromTop)
  return { t: t0, track }
}
function onTrackDragOver(e: DragEvent) { if (dragTpl.value) { e.preventDefault(); dropAt.value = dropPos(e) } }
function onTrackDrop(e: DragEvent) {
  e.preventDefault()
  const id = dragTpl.value || e.dataTransfer?.getData('text/plain') || ''
  const tp = templateById(id)
  const pos = dropPos(e)
  dragTpl.value = ''
  dropAt.value = null
  if (tp && pos) addAt(tp, pos.t, pos.track)
}
function onLibDragEnd() { dragTpl.value = ''; dropAt.value = null }

// 加卡下拉框只列已上线的；管理员另外看得到草稿（标「草稿」），方便在真实视频上试
const admin = ref(false)
const addable = computed(() => TEMPLATES.filter((tp) => statusOf(tp.id) === 'live' || admin.value))
const addTemplate = ref('')
// key 用户（售卖型 key）：编辑页没有站点顶栏，余额显示在自己的顶栏上；也不调 /api/auth/me（影子用户会被 scopeGuard 403）
const keyMode = !!activeAppKey()
// 充值码充进的是当前这把 key（弹窗里写出是哪一把）；服务端的话术已按成因分好，原样显示
const topupOpen = ref(false)
const topupCode = ref('')
const topupBusy = ref(false)
const topupMsg = ref('')
const topupErr = ref('')
async function redeem() {
  if (topupBusy.value || !topupCode.value.trim()) return
  topupBusy.value = true
  topupErr.value = ''
  topupMsg.value = ''
  try {
    const r = await apiPost<{ points: number; balance: number }>('/api/app-keys/redeem', { code: topupCode.value })
    topupMsg.value = `已充入 ${r.points} 点，现在可用 ${r.balance} 点`
    topupCode.value = ''
    await refreshKeyInfo()
  } catch (e: any) {
    topupErr.value = e.message || '充值失败'
  } finally {
    topupBusy.value = false
  }
}
onMounted(async () => {
  await loadTemplateStatus()
  if (keyMode) refreshKeyInfo()
  else admin.value = isAdmin(await fetchMe())
  if (!addable.value.some((tp) => tp.id === addTemplate.value)) addTemplate.value = addable.value[0]?.id || ''
})
// 手动加章节卡时编号也由代码给：原话里说了「第三招」用 03，否则接着前面的章节卡数（不然每张都是默认的 01，导航条上一排 01）
const CN_ORD: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }
// points 字段：在图上点一下记一处（占图宽高的百分比）；点满了再点替换最后一处
function addPoint(e: MouseEvent, c: Card, f: { key: string; max?: number }) {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const pt = { x: Math.round(((e.clientX - r.left) / r.width) * 1000) / 10, y: Math.round(((e.clientY - r.top) / r.height) * 1000) / 10 }
  const arr = [...(c.data[f.key] || [])]
  if (arr.length >= (f.max ?? 1)) arr[arr.length - 1] = pt
  else arr.push(pt)
  c.data[f.key] = arr
}
// 章节标题、标题降格成标签各自按自己那一类往下数
const NUMBERED = new Set(['chapter', 'titledemote'])
function chapterIndexFor(l: SubLine, template: string) {
  const m = l.text.match(/第\s*(\d{1,2}|[一二两三四五六七八九十])\s*[招步个点条章部分类种]/)
  const said = m ? (/^\d+$/.test(m[1]) ? Number(m[1]) : CN_ORD[m[1]]) : null
  const before = cards.value.filter((c) => c.template === template && c.start < l.start).length
  return String(said ?? before + 1).padStart(2, '0')
}
function addCardFromLine(l: SubLine) {
  if (!addTemplate.value) return
  const over = templateById(addTemplate.value)!.fromLine(l.text)
  if (NUMBERED.has(addTemplate.value)) over.index = chapterIndexFor(l, addTemplate.value)
  const c = placeCard(l, addTemplate.value, over)
  selectCard(c)
}

// ── AI 配卡 ──
interface Planned { template: string; line: number; endLine: number; data: Record<string, any>; summarized: string[] }
interface Rejected { line: number | null; template: string; text: string; why: string }
const planning = ref(false)
const planError = ref('')
const planReport = ref<{ added: number; skipped: string[]; rejected: Rejected[]; notes: string[]; timing?: { pickMs: number; fillMs: number; groups: number } } | null>(null)

async function aiPlan() {
  planning.value = true
  planError.value = ''
  planReport.value = null
  try {
    const r = await apiPost<{ cards: Planned[]; rejected: Rejected[]; notes: string[]; timing?: { pickMs: number; fillMs: number; groups: number } }>('/api/broll/plan', {
      lines: subs.value.map((l) => ({ id: l.id, text: l.text })),
    })
    const byId = new Map(subs.value.map((l) => [l.id, l]))
    const skipped: string[] = []
    let added = 0
    let aligned = 0
    for (const p of r.cards) {
      const l = byId.get(p.line)
      const last = byId.get(p.endLine) || l
      const tpl = templateById(p.template)
      if (!l || !last) { skipped.push(`第 ${p.line} 句：字幕里找不到这一句（是不是中途换了字幕文件）`); continue }
      if (!tpl) { skipped.push(`${fmtTime(l.start)}「${l.text}」：页面不认识「${p.template}」这种卡（刷新一下页面）`); continue }
      // 已经挂了卡的时间段不覆盖 —— 覆盖掉的话他改过的文字悄悄没了，两张叠在一起也看不清
      if (cards.value.some((c) => c.start < last.end && l.start < c.end)) {
        skipped.push(`${fmtTime(l.start)}「${l.text}」（${tpl.name}）：这段已经有卡了，没覆盖`)
        continue
      }
      const c = placeCard(l, p.template, p.data, last)
      c.aiSummary = p.summarized
      // 逐条出现的卡：条目本来就摘自原话，直接按字幕把每一条对到它开始说的那一刻
      if (tpl.cueTargets) aligned += alignCues(c).hit
      added++
    }
    const notes = aligned ? [...r.notes, `清单类的卡已按字幕把 ${aligned} 条对到了各自开始说的那一刻（可以在右边「逐条出现时间」里改）`] : r.notes
    planReport.value = { added, skipped, rejected: r.rejected, notes, timing: r.timing }
  } catch (e: any) {
    planError.value = e?.message || String(e)
  } finally {
    planning.value = false
  }
}
const lineLabel = (id: number | null) => {
  const l = id == null ? null : subs.value.find((x) => x.id === id)
  return l ? `${fmtTime(l.start)}「${l.text}」` : '（编号对不上）'
}

function removeCard(id: number) {
  cards.value = cards.value.filter((c) => c.id !== id)
  compactTracks()
  delete sizes[id]
  if (selectedId.value === id) selectedId.value = null
}

// ── 播放头 ──
const t = ref(0)
const playing = ref(false)
const total = computed(() => Math.max(
  videoDuration.value,
  subs.value.at(-1)?.end || 0,
  ...cards.value.map((c) => c.end),
  5,
))

let raf = 0
let last = 0
function tick(now: number) {
  if (videoUrl.value && videoEl.value) {
    t.value = videoEl.value.currentTime
  } else if (playing.value && last) {
    t.value += (now - last) / 1000
    if (t.value > total.value) t.value = 0
  }
  last = now
  raf = requestAnimationFrame(tick)
}
onMounted(() => { raf = requestAnimationFrame(tick) })
onBeforeUnmount(() => cancelAnimationFrame(raf))

function togglePlay() {
  playing.value = !playing.value
  if (videoEl.value && videoUrl.value) playing.value ? videoEl.value.play() : videoEl.value.pause()
}
function seek(s: number) {
  t.value = Math.min(Math.max(s, 0), total.value)
  if (videoEl.value && videoUrl.value) videoEl.value.currentTime = t.value
}
function onScrub(e: Event) { seek(Number((e.target as HTMLInputElement).value)) }

const isOn = (c: Card) => t.value >= c.start && t.value < c.end
const cardT = (c: Card) => Math.min(Math.max(t.value - c.start, 0), c.end - c.start)
const cardData = (c: Card) => ({ ...c.data, duration: c.end - c.start })
const currentSub = computed(() => subs.value.find((l) => t.value >= l.start && t.value < l.end) || null)

// ── 时间轴 ── 横向按「每秒多少像素」排（pps）：缩放 = 改 pps，超出就横向滚动。
// 默认是「刚好铺满」，缩放滑块在这个基础上放大
const tlWrap = ref<HTMLElement>()
const tlWrapW = ref(900)
const tlZoom = ref(1)
const pps = computed(() => Math.max(2, (tlWrapW.value - 30) / total.value) * tlZoom.value)
const pct = (s: number) => `${s * pps.value}px`
const SUB_ROW_H = 28
const RULER_H = 24
// 刻度：挑一个让两条刻度线至少隔 70px 的步长
const ticks = computed(() => {
  const step = [0.5, 1, 2, 5, 10, 15, 30, 60, 120].find((st) => st * pps.value >= 70) || 300
  const out: { t: number; label: string }[] = []
  for (let x = 0; x <= total.value + 0.001; x += step) out.push({ t: x, label: fmtTime(x).replace(/\.0$/, '') })
  return out
})
let tlRo: ResizeObserver | null = null
onMounted(() => {
  tlRo = new ResizeObserver(([e]) => { tlWrapW.value = e.contentRect.width })
  if (tlWrap.value) tlRo.observe(tlWrap.value)
})
onBeforeUnmount(() => tlRo?.disconnect())
// ── 轨道 ──
const ROW_H = 34
const overlaps = (a: Card, b: Card) => a.start < b.end && b.start < a.end
const clashOn = (c: Card, track: number) => cards.value.some((o) => o.id !== c.id && o.track === track && overlaps(o, c))
/** 从 from 往 dir 方向找第一条这段时间空着的轨道；往下找到底都没有返回 -1 */
function freeTrack(c: Card, from: number, dir: 1 | -1 = 1) {
  for (let k = Math.max(0, from); dir === 1 || k >= 0; k += dir) if (!clashOn(c, k)) return k
  return -1
}
// 删卡 / 挪卡之后去掉空轨道，编号压实成 0..n-1（不压的话时间轴上留一堆空行）
function compactTracks() {
  const used = [...new Set(cards.value.map((c) => c.track))].sort((a, b) => a - b)
  const map = new Map(used.map((k, i) => [k, i]))
  for (const c of cards.value) c.track = map.get(c.track)!
}
const trackCount = computed(() => Math.max(1, ...cards.value.map((c) => c.track + 1)))
// 画面里的叠放顺序：轨道高的在上；同一轨道不会同时出现，不用再排
const zOf = (c: Card) => c.track + 1
// 上移 / 下移一层：相邻那层这段时间空着就直接挪过去；被挡住时和挡住的那几张对调（它们挪到这张原来的层上不冲突才行），
// 否则上移就往上顺延到空着的那层。只会「往上顺延」不会对调的话，两张叠着的卡没法直接换上下顺序。
function swapTargets(c: Card, target: number) {
  if (target < 0) return null
  const blockers = cards.value.filter((o) => o.id !== c.id && o.track === target && overlaps(o, c))
  const fits = blockers.every((b) => !cards.value.some((o) => o.id !== b.id && o.id !== c.id && o.track === c.track && overlaps(o, b)))
  return fits ? blockers : null
}
function moveLayer(c: Card, dir: 1 | -1) {
  const target = c.track + dir
  const blockers = swapTargets(c, target)
  if (blockers) {
    blockers.forEach((b) => { b.track = c.track })
    c.track = target
  } else if (dir === 1) {
    c.track = freeTrack(c, target)
  } else return
  compactTracks()
}
const canLayerDown = (c: Card) => c.track > 0 && swapTargets(c, c.track - 1) !== null

const tlIn = ref<HTMLElement>()
function onTimelineClick(e: MouseEvent) {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  seek((e.clientX - r.left) / pps.value)
}

// 时间轴上拖卡片：拖中间 = 整体挪，拖左 / 右边缘 = 改开始 / 结束。没怎么动就松手 = 点击选中。
// 靠近字幕句子的边界时吸附过去（卡片通常要和某句话对齐），按住 Alt 不吸附。
const SNAP_PX = 6
const MIN_LEN = 0.5
function tlDrag(e: PointerEvent, c: Card, mode: 'move' | 'start' | 'end') {
  e.preventDefault()
  const el = tlIn.value
  if (!el) return
  const secPerPx = 1 / pps.value
  const px = e.clientX, py = e.clientY
  const s0 = c.start, e0 = c.end, k0 = c.track
  let moved = false
  const snap = (v: number, alt: boolean) => {
    if (alt) return v
    let best = v, dist = SNAP_PX * secPerPx
    for (const l of subs.value) for (const edge of [l.start, l.end]) {
      if (Math.abs(edge - v) < dist) { best = edge; dist = Math.abs(edge - v) }
    }
    return best
  }
  const r1 = (v: number) => Math.round(v * 100) / 100
  selectedId.value = c.id
  const onMove = (ev: PointerEvent) => {
    if (!moved && Math.abs(ev.clientX - px) < 3 && Math.abs(ev.clientY - py) < 3) return
    moved = true
    const d = (ev.clientX - px) * secPerPx
    if (mode === 'move') {
      // 上下拖换轨道（往上 = 轨道号变大 = 画面里在更上层）
      c.track = Math.max(0, k0 - Math.round((ev.clientY - py) / ROW_H))
      const len = e0 - s0
      const ns = Math.min(Math.max(0, snap(s0 + d, ev.altKey)), total.value - len)
      c.start = r1(ns); c.end = r1(ns + len)
      seek(c.start + Math.min(1.5, len / 2))
    } else if (mode === 'start') {
      c.start = r1(Math.min(Math.max(0, snap(s0 + d, ev.altKey)), c.end - MIN_LEN))
      seek(c.start + 0.01)
    } else {
      c.end = r1(Math.max(Math.min(total.value, snap(e0 + d, ev.altKey)), c.start + MIN_LEN))
      seek(c.end - 0.3)
    }
  }
  const onUp = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    if (moved) {
      // 落到的轨道这段时间已经有卡了：往上顺延到第一条空着的（新开一条也行），不叠在同一条上
      if (clashOn(c, c.track)) c.track = freeTrack(c, c.track)
      compactTracks()
      cards.value.sort((a, b) => a.start - b.start)
    } else selectCard(c)
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}
// 跳到卡片已经完全出来的那一刻（第 0 秒它还是透明的，选中了也看不见、没法拖）
function selectCard(c: Card) { selectedId.value = c.id; seek(c.start + Math.min(1.5, (c.end - c.start) / 2)) }

function setTime(c: Card, key: 'start' | 'end', v: number) {
  if (!Number.isFinite(v)) return
  if (key === 'start') {
    // 改开始时间 = 整体挪（时长不变），和剪映一样；只想改入点就拖时间轴上的左边缘
    const len = c.end - c.start
    c.start = Math.max(0, Math.round(v * 100) / 100)
    c.end = Math.round((c.start + len) * 100) / 100
  } else c.end = Math.max(c.start + MIN_LEN, Math.round(v * 100) / 100)
  if (clashOn(c, c.track)) c.track = freeTrack(c, c.track)
  compactTracks()
  cards.value.sort((a, b) => a.start - b.start)
}
// 播放时长：改的是结束时间，开始不动；比模版的最短时长短时照样允许，但面板上会标红「动画会被截掉」
function setDuration(c: Card, v: number) {
  if (!Number.isFinite(v) || v <= 0) return
  setTime(c, 'end', c.start + Math.max(MIN_LEN, v))
}
const needFor = (c: Card) => tplOf(c).minDuration(c.data)

// ── 逐条出现时间 ── data.cues[i] = 第 i 条相对卡片开始的秒数（null = 按默认节奏）。时间一律由代码定：
// 字幕对齐 / 播放头 / 在时间轴上拖，不交给模型（编一个时间的话那一条出现在错的那句话上，看起来完全正常）。
const cueTargets = (c: Card) => tplOf(c).cueTargets?.(c.data) || []
const cueEff = (c: Card, i: number) => cueAt(c.data.cues, i, tplOf(c).defaultCue?.(c.data, i) ?? 0)
const isCueSet = (c: Card, i: number) => Array.isArray(c.data.cues) && c.data.cues[i] != null
function setCue(c: Card, i: number, rel: number | null) {
  const n = cueTargets(c).length
  const arr: (number | null)[] = Array.from({ length: n }, (_, k) => (Array.isArray(c.data.cues) ? c.data.cues[k] ?? null : null))
  arr[i] = rel == null ? null : Math.max(0, Math.round(rel * 100) / 100)
  c.data.cues = arr.some((v) => v != null) ? arr : undefined
}
const normTxt = (x: string) => x.replace(/^✓\s*/, '').replace(/[\s，。、！？；：“”‘’（）《》「」…—,.!?;:'"()\-]/g, '').toLowerCase()
// 按字幕对齐：每一条去字幕里找「这句话里有它」（或它跨了这句）的那一句，出现时间 = 那句开始说的时刻。
// 按顺序往后找（第 2 条不会对到第 1 条前面去）；找不到的那几条保持默认节奏，并且说出来。
function alignCues(c: Card) {
  const targets = cueTargets(c)
  let from = c.start - 0.5
  let hit = 0
  const miss: string[] = []
  targets.forEach((tg, i) => {
    const key = normTxt(tg)
    const line = key ? subs.value.find((l) => l.start >= from && l.start <= c.start + 40 && (normTxt(l.text).includes(key) || key.includes(normTxt(l.text)))) : null
    if (line) { setCue(c, i, line.start - c.start); from = line.start; hit++ } else miss.push(tg)
  })
  // 最晚那条出现之后还要留 1.6 秒看清，不够就把卡片延长（并说出来）
  const need = needFor(c)
  let extended = 0
  if (c.end - c.start < need - 0.05) { extended = need - (c.end - c.start); setDuration(c, need) }
  return { hit, miss, extended }
}
const alignMsg = ref('')
function onAlign(c: Card) {
  if (!subs.value.length) { alignMsg.value = '还没有字幕，没法按字幕对齐'; return }
  const r = alignCues(c)
  alignMsg.value = `按字幕对齐了 ${r.hit} 条` + (r.miss.length ? `；没在字幕里找到：${r.miss.join('、')}（保持默认节奏）` : '') + (r.extended ? `；卡片延长了 ${r.extended.toFixed(1)} 秒才放得下最后一条` : '')
}
// 有一条在卡片结束之后才出现 = 那一条根本出不来，而画面看起来一切正常
const lateCues = (c: Card) => cueTargets(c).map((tg, i) => ({ tg, i, at: cueEff(c, i) })).filter((x) => x.at + 0.4 > c.end - c.start)
function fitToCues(c: Card) { setDuration(c, Math.max(c.end - c.start, needFor(c))) }
// 时间轴上拖逐条标记
function cueDrag(e: PointerEvent, c: Card, i: number) {
  e.preventDefault()
  const px = e.clientX
  const r0 = cueEff(c, i)
  const onMove = (ev: PointerEvent) => {
    let abs = c.start + r0 + (ev.clientX - px) / pps.value
    if (!ev.altKey) for (const l of subs.value) if (Math.abs(l.start - abs) * pps.value < SNAP_PX) { abs = l.start; break }
    setCue(c, i, Math.max(0, abs - c.start))
    seek(abs + 0.3)
  }
  const onUp = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp) }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}

// 预览区：舞台按画幅等比放进中间那块（宽高都不超）
const previewEl = ref<HTMLElement>()
const previewSize = ref({ w: 900, h: 500 })
const stageFitW = computed(() => Math.max(160, Math.min(previewSize.value.w - 48, ((previewSize.value.h - 24) * W.value) / H.value)))
let pvRo: ResizeObserver | null = null
onMounted(() => {
  pvRo = new ResizeObserver(([e]) => { previewSize.value = { w: e.contentRect.width, h: e.contentRect.height } })
  if (previewEl.value) pvRo.observe(previewEl.value)
})
onBeforeUnmount(() => pvRo?.disconnect())

// 画布固定 1920×1080（竖屏 1080×1920），按舞台实际宽度缩放
const stage = ref<HTMLElement>()
const stageW = ref(960)
const scale = computed(() => stageW.value / W.value)
let ro: ResizeObserver | null = null
onMounted(() => {
  ro = new ResizeObserver(([e]) => { stageW.value = e.contentRect.width })
  if (stage.value) ro.observe(stage.value)
})
onBeforeUnmount(() => ro?.disconnect())

// ── 拖动 / 缩放 ──
// 屏幕上移动的像素 ÷ 舞台缩放 = 画布上移动的像素。缩放按右下角把手拖出的宽度算，等比。
function startDrag(e: PointerEvent, c: Card, mode: 'move' | 'resize') {
  e.preventDefault()
  selectedId.value = c.id
  const k = scale.value, px = e.clientX, py = e.clientY
  const x0 = c.x, y0 = c.y, s0 = c.s
  const w0 = sizes[c.id]?.w || 600
  const onMove = (ev: PointerEvent) => {
    const dx = (ev.clientX - px) / k, dy = (ev.clientY - py) / k
    if (mode === 'move') {
      const sz = sizes[c.id]
      let nx = x0 * W.value + dx, ny = y0 * H.value + dy
      guides.value = {}
      if (sz && !ev.altKey) {
        const w = sz.w * c.s, h = sz.h * c.s
        const sx = snapAxis(nx, w, snapLinesX(c)), sy = snapAxis(ny, h, snapLinesY(c))
        if (sx) { nx = sx.pos; guides.value.x = sx.line }
        if (sy) { ny = sy.pos; guides.value.y = sy.line }
      }
      c.x = nx / W.value
      c.y = ny / H.value
    } else {
      c.s = Math.min(3, Math.max(0.2, (w0 * s0 + dx) / w0))
    }
  }
  const onUp = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    guides.value = {}
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}

// ── 吸附对齐 ── 卡片的左边 / 中线 / 右边（上 / 中 / 下）靠近这些线时吸过去：画面边距、画面中线、
// 字幕区上沿，以及此刻同屏其他卡片的边和中线。阈值按画布像素算（屏幕上约 6px），按住 Alt 不吸。
const SNAP_CANVAS = computed(() => 6 / scale.value)
const guides = ref<{ x?: number; y?: number }>({})
const others = (c: Card) => cards.value.filter((o) => o.id !== c.id && isOn(o) && !o.data.fullscreen && sizes[o.id])
function snapLinesX(c: Card) {
  const lines = [FIT_MARGIN, W.value / 2, W.value - FIT_MARGIN]
  for (const o of others(c)) { const x = o.x * W.value, w = sizes[o.id].w * o.s; lines.push(x, x + w / 2, x + w) }
  return lines
}
function snapLinesY(c: Card) {
  const lines = [FIT_MARGIN, H.value / 2, H.value * (1 - SUBTITLE_ZONE)]
  for (const o of others(c)) { const y = o.y * H.value, h = sizes[o.id].h * o.s; lines.push(y, y + h / 2, y + h) }
  return lines
}
// 起点 / 中点 / 终点三处里离某条线最近的那一处吸过去
function snapAxis(pos: number, len: number, lines: number[]) {
  let best: { pos: number; line: number; d: number } | null = null
  for (const line of lines) for (const off of [0, len / 2, len]) {
    const d = Math.abs(pos + off - line)
    if (d < SNAP_CANVAS.value && (!best || d < best.d)) best = { pos: line - off, line, d }
  }
  return best
}

// ── 顶部章节导航条 ── 按时间轴上的章节卡自动分段（不单独维护一份章节表：两份的话改了章节卡导航条照旧）
const navOn = ref(false)
const navChapters = computed<NavChapter[]>(() =>
  cards.value
    .filter((c) => c.template === 'chapter' && c.data.title)
    .map((c) => ({ index: c.data.index || '', label: [...c.data.title].slice(0, 10).join(''), start: c.start })),
)

// ── 撤销 / 重做 ── 卡片有变动、停半秒记一步（拖动过程中不会每一帧记一步）；最多 50 步
const history: string[] = []
const future: string[] = []
let restoring = false
let snapTimer: ReturnType<typeof setTimeout> | null = null
const snapshot = () => JSON.stringify({ cards: cards.value, nextId })
history.push(snapshot())
watch(cards, () => {
  if (restoring) return
  if (snapTimer) clearTimeout(snapTimer)
  snapTimer = setTimeout(() => {
    const now = snapshot()
    if (history[history.length - 1] !== now) { history.push(now); if (history.length > 50) history.shift(); future.length = 0; histTick.value++ }
  }, 500)
}, { deep: true })
const histTick = ref(0)
const canUndo = computed(() => (histTick.value, history.length > 1))
const canRedo = computed(() => (histTick.value, future.length > 0))
function restore(raw: string) {
  restoring = true
  const s = JSON.parse(raw)
  cards.value = s.cards
  nextId = Math.max(nextId, s.nextId)
  if (selectedId.value !== null && !cards.value.some((c) => c.id === selectedId.value)) selectedId.value = null
  nextTick(() => { restoring = false })
  histTick.value++
}
function undo() { if (history.length > 1) { future.push(history.pop()!); restore(history[history.length - 1]) } }
function redo() { const f = future.pop(); if (f) { history.push(f); restore(f) } }
function onKey(e: KeyboardEvent) {
  const tag = (e.target as HTMLElement)?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return // 输入框里的 ⌘Z 留给输入框自己
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo() }
  if (e.code === 'Space' && tag !== 'BUTTON') { e.preventDefault(); togglePlay() }
  if ((e.key === 'Delete' || e.key === 'Backspace') && selected.value) { e.preventDefault(); removeCard(selected.value.id) }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
// ── 图片上传 ── 传到服务器再用（导出在服务器上渲染，读不到本机文件）；失败要说原因，不留一个看似成功的空位
const uploading = ref('')
const uploadError = ref('')
async function onUpload(e: Event, tag: string, set: (url: string) => void) {
  const input = e.target as HTMLInputElement
  const f = input.files?.[0]
  if (!f) return
  uploading.value = tag
  uploadError.value = ''
  try {
    set(await uploadImage(f))
  } catch (err: any) {
    uploadError.value = `「${f.name}」上传失败：${err?.message || err}`
  } finally {
    uploading.value = ''
    input.value = ''
  }
}

// ── 导出 ── 服务器逐帧渲染成透明 .mov（ProRes 4444）。约每秒视频 3–5 秒渲染时间，一次只导一张。
const exporting = ref<number | null>(null)
const exportMsg = ref('')
const exportErr = ref('')
const exportFormat = ref<'png' | 'hevc'>('png')
async function runExport(url: string, body: unknown, name: string, hint: string, key: number) {
  exporting.value = key
  exportMsg.value = ''
  exportErr.value = ''
  try {
    const res = await api(url, { method: 'POST', body: JSON.stringify(body) })
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      throw new Error(d.error || `HTTP ${res.status}`)
    }
    const notes: string[] = JSON.parse(decodeURIComponent(res.headers.get('X-Broll-Notes') || '%5B%5D'))
    const blob = await res.blob()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = name
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
    exportMsg.value = `已导出「${name}」（${(blob.size / 1024 / 1024).toFixed(1)} MB，透明底）。${hint}` + (notes.length ? `\n注意：${notes.join('；')}` : '')
  } catch (e: any) {
    exportErr.value = `导出失败：${e?.message || e}`
  } finally {
    exporting.value = null
  }
}
function exportOne(c: Card) {
  // 文件名带开始时间，拖进剪映时知道放哪：「00m12.3s_章节标题.mov」
  const m = Math.floor(c.start / 60)
  const name = `${String(m).padStart(2, '0')}m${(c.start - m * 60).toFixed(1).padStart(4, '0')}s_${tplOf(c).name}_${exportFormat.value}.mov`
  return runExport('/api/broll/export', {
    aspect: aspect.value, theme: theme.value, format: exportFormat.value,
    card: { template: c.template, data: c.data, duration: c.end - c.start, x: c.x, y: c.y, s: c.s },
  }, name, `拖进剪映时放在口播上面一轨，从 ${fmtTime(c.start)} 开始。`, c.id)
}
// 整条叠加层：和口播等长，从 0 秒对齐即可。渲染时间只跟「有卡的那几秒」有关
const ALL = -1
const activeSeconds = computed(() => {
  const segs = [...cards.value].sort((a, b) => a.start - b.start)
  let sum = 0, end = 0
  for (const c of segs) { sum += Math.max(0, c.end - Math.max(c.start, end)); end = Math.max(end, c.end) }
  return sum
})
function exportAll() {
  return runExport('/api/broll/export-all', {
    aspect: aspect.value, theme: theme.value, format: exportFormat.value, total: total.value,
    nav: navOn.value && navChapters.value.length ? { chapters: navChapters.value } : null,
    cards: cards.value.map((c) => ({ template: c.template, data: c.data, start: c.start, end: c.end, x: c.x, y: c.y, s: c.s, track: c.track })),
  }, `整条叠加层_${Math.round(total.value)}s_${exportFormat.value}.mov`, '拖进剪映放在口播上面一轨，从 0 秒对齐。', ALL)
}

function unmarkAi(c: Card, key: string) { if (c.aiSummary?.includes(key)) c.aiSummary = c.aiSummary.filter((k) => k !== key) }
function resetBox(c: Card) { Object.assign(c, defaultBox()); c.fitNote = ''; fitCard(c) }

// ── 自动缩到放得下 ──
// 放卡 / 换画幅时，卡片超出画面或压到底部字幕区就按比例缩小（不超过原来的大小）；缩到 60% 还放不下时
// 先挪回左边距再算一次。缩完写进 fitNote，面板上显示一句 —— 静默缩小的话他只会觉得「字怎么这么小」。
const FIT_MARGIN = 40
function fitCard(c: Card) {
  const sz = sizes[c.id]
  if (!sz || c.data.fullscreen || c.data.scene) return
  const room = () => Math.min(
    (W.value - c.x * W.value - FIT_MARGIN) / sz.w,
    (H.value * (1 - SUBTITLE_ZONE) - c.y * H.value - 10) / sz.h,
  )
  let s = Math.min(c.s, room())
  if (s < 0.6 && c.x > 0.05) { c.x = 0.04; s = Math.min(c.s, room()) }
  if (s < c.s - 0.005) {
    c.fitNote = `为了放得下，自动缩到了 ${Math.round(s * 100)}%${s < 0.45 ? '（字会偏小，建议缩短文案）' : ''}`
    c.s = Math.max(0.2, Math.round(s * 100) / 100)
  }
}
// 新卡等它量出尺寸再缩（尺寸是渲染后才报上来的）
const pendingFit = new Set<number>()
watch(sizes, () => {
  for (const id of [...pendingFit]) {
    const c = cards.value.find((x) => x.id === id)
    if (!c) { pendingFit.delete(id); continue }
    if (sizes[id]) { fitCard(c); pendingFit.delete(id) }
  }
}, { deep: true })
// 换画幅：位置按比例保留，超出的那些自动缩
watch(aspect, async () => { await nextTick(); cards.value.forEach(fitCard) })
</script>

<template>
  <div class="ed" @dragend="onLibDragEnd">
    <!-- ── 顶栏 ── -->
    <header class="ed-top">
      <div class="ed-brand"><i class="ed-logo" />口播动效</div>
      <div class="seg">
        <button :class="{ on: aspect === '16:9' }" @click="aspect = '16:9'">16:9</button>
        <button :class="{ on: aspect === '9:16' }" @click="aspect = '9:16'">9:16</button>
      </div>
      <label class="ed-sel">主题
        <select v-model="theme"><option v-for="th in THEMES" :key="th.id" :value="th.id">{{ th.name }}</option></select>
      </label>
      <div class="seg">
        <button :disabled="!canUndo" title="撤销（⌘Z）" @click="undo">↶</button>
        <button :disabled="!canRedo" title="重做（⌘⇧Z）" @click="redo">↷</button>
      </div>
      <span class="ed-gap" />
      <label class="btn">导入视频<input type="file" accept="video/*" hidden @change="onPickVideo" /></label>
      <label class="btn">导入字幕<input type="file" accept=".srt,text/plain" hidden @change="onPickSrt" /></label>
      <button class="btn primary" :disabled="!subs.length || planning" :title="subs.length ? '' : '先导入字幕'" @click="aiPlan">
        {{ planning ? 'AI 配卡中…' : '✦ AI 配卡' }}
      </button>
      <span class="ed-div" />
      <select v-model="exportFormat" class="ed-fmt" title="导出格式">
        <option value="png">PNG 透明 MOV（兼容最好，适合单张卡）</option>
        <option value="hevc">HEVC 透明 MOV（小、剪映预览流畅，整条推荐；只有 Mac 服务器能导）</option>
      </select>
      <button class="btn dark" :disabled="exporting !== null || !cards.length" @click="exportAll">
        {{ exporting === ALL ? `导出中 约 ${Math.ceil(activeSeconds * 6 + total * 0.3)} 秒…` : '导出整条' }}
      </button>
      <div v-if="keyMode" class="ed-keywrap">
        <button class="ed-key" title="AI 配卡每次 1 点，导出每次 5 点" @click="topupOpen = !topupOpen; topupMsg = ''; topupErr = ''">
          余额 {{ keyInfo ? keyInfo.balance : '…' }} 点 · 充值
        </button>
        <div v-if="topupOpen" class="ed-topup">
          <p>充进 KEY <code>{{ keyInfo?.keyPrefix || '…' }}</code>，当前 {{ keyInfo ? keyInfo.balance : '…' }} 点</p>
          <p class="ed-topup-price">AI 配卡每次 1 点 · 导出每次 5 点</p>
          <input v-model="topupCode" placeholder="粘贴充值码，如 BRLCZ-XXXX-XXXX-XXXX-XXXX" :disabled="topupBusy" @keydown.enter="redeem" />
          <div class="ed-topup-row">
            <button class="btn" @click="topupOpen = false">关闭</button>
            <button class="btn primary" :disabled="topupBusy || !topupCode.trim()" @click="redeem">{{ topupBusy ? '充值中…' : '充值' }}</button>
          </div>
          <p v-if="topupMsg" class="ed-topup-ok">{{ topupMsg }}</p>
          <p v-if="topupErr" class="ed-topup-err">{{ topupErr }}</p>
        </div>
      </div>
      <a v-if="admin" class="ed-lab" href="/broll/lab" target="_blank" title="动效卡调试台（管理员）">调试台</a>
    </header>

    <!-- ── 提示条（AI 配卡结果 / 导出结果 / 出错）── -->
    <div v-if="bannerOpen && (planError || planReport || exportErr || exportMsg || srtError || srtSkipped || uploadError)" class="ed-banner">
      <div v-if="srtError" class="bn err">{{ srtError }}</div>
      <div v-else-if="srtSkipped" class="bn err">字幕里有 {{ srtSkipped }} 段读不出时间或没有文字，已跳过 —— 这几句不会出现在字幕列表里。</div>
      <div v-if="planError" class="bn err">AI 配卡失败：{{ planError }}</div>
      <div v-if="planReport" class="bn">
        <b>AI 加了 {{ planReport.added }} 张卡。</b>
        <span v-if="planReport.timing" class="muted">
          用时 {{ ((planReport.timing.pickMs + planReport.timing.fillMs) / 1000).toFixed(1) }} 秒（挑卡 {{ (planReport.timing.pickMs / 1000).toFixed(1) }} 秒，填写 {{ (planReport.timing.fillMs / 1000).toFixed(1) }} 秒{{ planReport.timing.groups > 1 ? `，分 ${planReport.timing.groups} 组同时填` : '' }}）
        </span>
        <template v-if="!planReport.added && !planReport.rejected.length && !planReport.skipped.length">它没在字幕里找到值得配卡的句子。</template>
        <ul v-if="planReport.rejected.length || planReport.skipped.length || planReport.notes.length">
          <li v-for="(x, i) in planReport.rejected" :key="'r' + i">拦下（{{ x.template }}）：{{ lineLabel(x.line) }} → {{ x.text }} —— {{ x.why }}</li>
          <li v-for="(x, i) in planReport.notes" :key="'n' + i">注意：{{ x }}</li>
          <li v-for="(x, i) in planReport.skipped" :key="'s' + i">没放：{{ x }}</li>
        </ul>
      </div>
      <div v-if="exportErr" class="bn err">{{ exportErr }}</div>
      <div v-else-if="exportMsg" class="bn ok pre">{{ exportMsg }}</div>
      <div v-if="uploadError" class="bn err">{{ uploadError }}</div>
      <button class="bn-x" title="收起" @click="bannerOpen = false; planReport = null; exportMsg = ''">✕</button>
    </div>

    <div class="ed-mid">
      <!-- ── 左：卡片库 / 字幕 ── -->
      <aside class="ed-left">
        <div class="tabs">
          <button :class="{ on: leftTab === 'lib' }" @click="leftTab = 'lib'">包装卡</button>
          <button :class="{ on: leftTab === 'scene' }" @click="leftTab = 'scene'">B-roll 场景</button>
          <button :class="{ on: leftTab === 'subs' }" @click="leftTab = 'subs'">字幕 <small v-if="subs.length">{{ subs.length }}</small></button>
        </div>
        <template v-if="leftTab === 'lib' || leftTab === 'scene'">
          <div class="lib-tools">
            <input v-model="libSearch" class="lib-search" placeholder="搜索卡片，如 数字 / 清单" />
            <div v-if="!libSearch && leftTab === 'lib'" class="lib-cats">
              <button v-for="c in CARD_CATS" :key="c" :class="{ on: libTab === c }" @click="libTab = c">{{ c }}</button>
            </div>
          </div>
          <div v-if="statusError" class="lib-empty err">{{ statusError }}</div>
          <div v-else-if="statusLoaded && !addable.length" class="lib-empty err">还没有上线的卡片，管理员在动效卡调试台上线后才能加</div>
          <div v-else class="lib-grid">
            <div
              v-for="tp in libItems" :key="tp.id" class="lib-item" draggable="true" :title="`点一下加在 ${fmtTime(t)}；也可以拖到时间轴上`"
              @click="addAt(tp, t)" @dragstart="onLibDragStart($event, tp)"
            >
              <div class="lib-thumb">
                <CardStage
                  :component="tp.component" :data="libThumb(tp).data" :t="libThumb(tp).t"
                  aspect="16:9" :box="{ x: 0.06, y: 0.14, s: 1.25 }" :theme="theme" bg="dark"
                />
              </div>
              <div class="lib-name">{{ tp.name }}<em v-if="statusOf(tp.id) === 'draft'">草稿</em></div>
            </div>
            <div v-if="!libItems.length" class="lib-empty">{{ leftTab === 'scene' && !libSearch ? 'B-roll 场景还在重新设计，暂时没有可用的场景' : '没有匹配的卡片' }}</div>
          </div>
          <div class="lib-tip">点卡片 = 加在播放头（{{ fmtTime(t) }}）· 拖到时间轴 = 放在落下的位置</div>
        </template>
        <template v-else>
          <div v-if="!subs.length" class="lib-empty">还没有字幕。顶栏「导入字幕」导入剪映导出的 SRT（剪映：导出 → 字幕 → SRT）</div>
          <template v-else>
            <div class="sub-tools">
              <span class="muted">{{ srtName }}</span>
              <label class="ed-sel sm">「+」加的卡
                <select v-model="addTemplate"><option v-for="tp in addable" :key="tp.id" :value="tp.id">{{ tp.name }}{{ statusOf(tp.id) === 'draft' ? '（草稿）' : '' }}</option></select>
              </label>
            </div>
            <div class="sub-list">
              <div v-for="l in subs" :key="l.id" class="sub-row" :class="{ on: currentSub?.id === l.id }" @click="seek(l.start)">
                <span class="sub-t">{{ fmtTime(l.start) }}</span>
                <span class="sub-x">{{ l.text }}</span>
                <button class="icon-btn" :disabled="!addTemplate" title="在这句上加卡" @click.stop="addCardFromLine(l)">＋</button>
              </div>
            </div>
          </template>
        </template>
      </aside>

      <!-- ── 中：预览 ── -->
      <section class="ed-center">
        <div ref="previewEl" class="pv">
          <div ref="stage" class="br-stage" :style="{ width: `${stageFitW}px`, aspectRatio: `${W} / ${H}` }">
            <video
              v-if="videoUrl" ref="videoEl" class="br-video" :src="videoUrl" playsinline
              @loadedmetadata="videoDuration = videoEl?.duration || 0" @ended="playing = false"
            />
            <div v-else class="pv-empty">导入口播视频后在这里预览（视频只在本机播放，不上传）</div>
            <div class="br-canvas" :style="{ width: `${W}px`, height: `${H}px`, transform: `scale(${scale})`, '--cw': `${W}px`, '--ch': `${H}px`, ...themeById(theme).vars }">
              <!-- 不在当前时间的卡用 visibility 藏（不是 v-if / display:none）：藏起来照样排版，尺寸才量得到 -->
              <div
                v-for="c in cards" :key="c.id" class="br-layer"
                :style="{
                  // 全屏卡铺满画布，不能拖 / 缩放
                  ...(c.data.fullscreen || c.data.scene ? { left: 0, top: 0, width: `${W}px`, height: `${H}px` } : { left: `${c.x * W}px`, top: `${c.y * H}px`, transform: `scale(${c.s})` }),
                  visibility: isOn(c) ? 'visible' : 'hidden', pointerEvents: isOn(c) ? 'auto' : 'none', zIndex: zOf(c),
                  outline: c.id === selectedId ? `${2 / (c.s * scale)}px dashed ${isOverflow(c) ? '#F53F3F' : '#3370FF'}` : 'none',
                }"
                @pointerdown="!c.data.fullscreen && !c.data.scene && startDrag($event, c, 'move')"
              >
                <component :is="tplOf(c).component" v-if="c.data.scene" :data="cardData(c)" :t="cardT(c)" @size="sizes[c.id] = $event" />
                <template v-else-if="c.data.fullscreen">
                  <FullFrame :t="cardT(c)" :duration="c.end - c.start" />
                  <div class="br-full">
                    <div :style="{ transform: `scale(${fullscreenScale(sizes[c.id], W, H)})` }">
                      <component :is="tplOf(c).component" :data="cardData(c)" :t="cardT(c)" @size="sizes[c.id] = $event" />
                    </div>
                  </div>
                </template>
                <component :is="tplOf(c).component" v-else :data="cardData(c)" :t="cardT(c)" @size="sizes[c.id] = $event" />
                <div
                  v-if="c.id === selectedId && !c.data.fullscreen && !c.data.scene" class="br-handle" :style="{ transform: `scale(${1 / (c.s * scale)})` }"
                  @pointerdown.stop="startDrag($event, c, 'resize')"
                />
              </div>
              <div v-if="showSubs && currentSub" class="br-sub">{{ currentSub.text }}</div>
              <ChapterNav v-if="navOn && navChapters.length" class="br-nav" :chapters="navChapters" :t="t" :total="total" :W="W" />
              <i v-if="guides.x !== undefined" class="br-guide v" :style="{ left: `${guides.x}px`, width: `${2 / scale}px` }" />
              <i v-if="guides.y !== undefined" class="br-guide h" :style="{ top: `${guides.y}px`, height: `${2 / scale}px` }" />
            </div>
          </div>
        </div>
        <div class="pv-ctrl">
          <span class="pv-time"><b>{{ fmtTime(t) }}</b> / {{ fmtTime(total) }}</span>
          <button class="play" :title="playing ? '暂停（空格）' : '播放（空格）'" @click="togglePlay">{{ playing ? '❚❚' : '▶' }}</button>
          <span class="pv-opts">
            <label class="check"><input v-model="showSubs" type="checkbox" />字幕</label>
            <label class="check" :title="navChapters.length ? '' : '按时间轴上的章节标题卡自动分段'"><input v-model="navOn" type="checkbox" />章节导航条</label>
          </span>
        </div>
        <div v-if="navOn && !navChapters.length" class="pv-warn">时间轴上还没有章节标题卡，导航条按章节卡自动分段</div>
      </section>

      <!-- ── 右：属性 ── -->
      <aside class="ed-right">
        <template v-if="selected">
          <div class="ins-head">
            <span class="ins-cat">{{ categoryOf(selected.template) }}</span>
            <h2>{{ tplOf(selected).name }}</h2>
            <button class="icon-btn danger" title="删除这张卡" @click="removeCard(selected.id)">🗑</button>
          </div>
          <div class="ins-body">
            <div v-if="isOverflow(selected)" class="warn">
              卡片有一部分在画面外，导出时会被裁掉。
              <button class="btn sm" @click="fitCard(selected)">缩到放得下</button>
            </div>
            <div v-for="p in dataProblems(selected)" :key="p" class="warn">{{ p }}</div>

            <section class="ins-sec">
              <h3>时间</h3>
              <div class="row3">
                <label>开始<input type="number" step="0.1" min="0" :value="selected.start" @change="setTime(selected, 'start', Number(($event.target as HTMLInputElement).value))" /></label>
                <label>时长<input type="number" step="0.1" min="0.5" :value="Number((selected.end - selected.start).toFixed(2))" @change="setDuration(selected, Number(($event.target as HTMLInputElement).value))" /></label>
                <label>结束<input type="number" step="0.1" min="0" :value="selected.end" @change="setTime(selected, 'end', Number(($event.target as HTMLInputElement).value))" /></label>
              </div>
              <div class="hint">
                这张卡完整播完要 {{ needFor(selected).toFixed(1) }} 秒
                <button v-if="Math.abs(selected.end - selected.start - needFor(selected)) > 0.05" class="link" @click="setDuration(selected, needFor(selected))">设成 {{ needFor(selected).toFixed(1) }} 秒</button>
                <button class="link" @click="seek(selected.start)">跳到开头</button>
              </div>
            </section>

            <section v-if="cueTargets(selected).length" class="ins-sec">
              <h3>逐条出现时间</h3>
              <div v-for="(tg, i) in cueTargets(selected)" :key="i" class="cue-row">
                <span class="cue-no">{{ i + 1 }}</span>
                <span class="cue-tg" :title="tg">{{ tg }}</span>
                <input
                  type="number" step="0.1" :value="isCueSet(selected, i) ? Number((selected.start + cueEff(selected, i)).toFixed(2)) : ''"
                  :placeholder="`自动 ${(selected.start + cueEff(selected, i)).toFixed(1)}`"
                  @change="(e) => { const v = (e.target as HTMLInputElement).value; setCue(selected!, i, v === '' ? null : Number(v) - selected!.start) }"
                />
                <button class="btn sm" title="设成播放头现在的时间" @click="setCue(selected, i, t - selected.start)">当前</button>
                <button class="icon-btn" :disabled="!isCueSet(selected, i)" title="恢复默认节奏" @click="setCue(selected, i, null)">↺</button>
              </div>
              <div class="row2">
                <button class="btn sm" :disabled="!subs.length" :title="subs.length ? '' : '先导入字幕'" @click="onAlign(selected)">按字幕对齐</button>
                <button class="btn sm" :disabled="!selected.data.cues" @click="selected.data.cues = undefined; alignMsg = ''">全部恢复默认</button>
              </div>
              <div v-if="alignMsg" class="hint">{{ alignMsg }}</div>
              <div v-if="lateCues(selected).length" class="warn">
                有 {{ lateCues(selected).length }} 条在卡片结束之后才出现。
                <button class="btn sm" @click="fitToCues(selected)">把卡片延长到够用</button>
              </div>
              <div class="hint">播放到说这一条的时候点「当前」；或者在时间轴上拖卡片里的小菱形。</div>
            </section>

            <section class="ins-sec">
              <h3>内容</h3>
              <!-- 图片字段不能包在 <label> 里：label 里有好几个控件时，点哪儿都会触发第一个（文件选择框） -->
              <component
                :is="f.type === 'image' || f.type === 'imageList' || f.type === 'points' ? 'div' : 'label'"
                v-for="f in tplOf(selected).fields" :key="f.key" class="fld" @input="unmarkAi(selected, f.key)"
              >
                <span>{{ f.label }} <em v-if="selected.aiSummary?.includes(f.key)" class="ai-tag" title="这一栏是 AI 概括的，不是原话，看一眼再用">AI 概括</em></span>
                <input v-if="f.type === 'bool'" v-model="selected.data[f.key]" type="checkbox" class="bool" />
                <select v-else-if="f.type === 'select'" v-model="selected.data[f.key]">
                  <option v-for="o in f.options" :key="o.value" :value="o.value">{{ o.label }}</option>
                </select>
                <textarea
                  v-else-if="f.type === 'list'" rows="4" :value="selected.data[f.key].join('\n')"
                  @input="selected.data[f.key] = ($event.target as HTMLTextAreaElement).value.split('\n')"
                />
                <div v-else-if="f.type === 'image'" class="img-row">
                  <img v-if="selected.data[f.key]" :src="selected.data[f.key]" class="img-thumb" alt="" />
                  <span v-else class="img-thumb empty" />
                  <label class="btn sm">
                    {{ uploading === `${selected.id}:${f.key}` ? '上传中…' : selected.data[f.key] ? '换一张' : '上传' }}
                    <input type="file" accept="image/*" hidden @change="onUpload($event, `${selected.id}:${f.key}`, (u) => (selected!.data[f.key] = u))" />
                  </label>
                  <button v-if="selected.data[f.key]" class="btn sm" @click="selected.data[f.key] = ''">移除</button>
                </div>
                <template v-else-if="f.type === 'imageList'">
                  <div v-for="(it, i) in selected.data[f.key]" :key="i" class="img-row">
                    <img v-if="it.img" :src="it.img" class="img-thumb" alt="" />
                    <span v-else class="img-thumb empty" title="还没上传" />
                    <label class="btn sm">
                      {{ uploading === `${selected.id}:${f.key}:${i}` ? '上传中…' : it.img ? '换' : '上传' }}
                      <input type="file" accept="image/*" hidden @change="onUpload($event, `${selected.id}:${f.key}:${i}`, (u) => (it.img = u))" />
                    </label>
                    <input v-model="it.name" placeholder="名字" />
                    <button class="icon-btn" title="删掉这一项" @click="selected.data[f.key].splice(i, 1)">✕</button>
                  </div>
                  <button v-if="selected.data[f.key].length < (f.max ?? 99)" class="btn sm" @click="selected.data[f.key].push({ img: '', name: '' })">+ 加一项</button>
                </template>
                <div v-else-if="f.type === 'points'" class="pts">
                  <!-- 外层可滚（长截图），点和圆点都按里面那层（和图一样大）算，不按可见区域算 -->
                  <div v-if="selected.data[f.of!]" class="pts-img">
                    <div class="pts-in" @click="addPoint($event, selected, f)">
                      <img :src="selected.data[f.of!]" alt="" draggable="false" />
                      <i v-for="(p, i) in selected.data[f.key] || []" :key="i" class="pts-dot" :style="{ left: `${p.x}%`, top: `${p.y}%` }">{{ i + 1 }}</i>
                    </div>
                  </div>
                  <div v-else class="hint">先上传上面的图片，再在图上点</div>
                  <div class="row2">
                    <span class="hint">已点 {{ (selected.data[f.key] || []).length }} / {{ f.max ?? 1 }} 处{{ (selected.data[f.key] || []).length >= (f.max ?? 1) ? '，再点会替换最后一处' : '' }}</span>
                    <button v-if="(selected.data[f.key] || []).length" class="btn sm" @click="selected.data[f.key] = []">清空</button>
                  </div>
                </div>
                <input v-else v-model="selected.data[f.key]" :placeholder="f.placeholder" />
              </component>
            </section>

            <section class="ins-sec">
              <h3>样式与位置</h3>
              <label class="fld">强调色
                <div class="row2">
                  <input type="color" :value="selected.data.accent || themeAccent" @input="selected.data.accent = ($event.target as HTMLInputElement).value" />
                  <button class="btn sm" :disabled="!selected.data.accent" @click="selected.data.accent = ''">{{ selected.data.accent ? '恢复主题色' : '跟随主题' }}</button>
                </div>
              </label>
              <label class="check"><input v-model="selected.data.panel" type="checkbox" />底板</label>
              <label class="check"><input v-model="selected.data.fullscreen" type="checkbox" />全屏（盖住口播画面，自动放大居中）</label>
              <label class="fld">大小 {{ Math.round(selected.s * 100) }}%
                <input v-model.number="selected.s" type="range" min="0.2" max="3" step="0.05" />
              </label>
              <div v-if="selected.fitNote" class="hint">{{ selected.fitNote }}</div>
              <div class="row2">
                <button class="btn sm" @click="resetBox(selected)">复位位置和大小</button>
                <span class="muted">第 {{ selected.track + 1 }} / {{ trackCount }} 层</span>
              </div>
              <div class="row2">
                <button class="btn sm" @click="moveLayer(selected, 1)">上移一层</button>
                <button class="btn sm" :disabled="!canLayerDown(selected)" @click="moveLayer(selected, -1)">下移一层</button>
              </div>
            </section>

            <button class="btn primary block" :disabled="exporting !== null" @click="exportOne(selected)">
              {{ exporting === selected.id ? `渲染中，约 ${Math.ceil((selected.end - selected.start) * 6)} 秒…` : exporting !== null ? '另一个在导出…' : `导出这张（${exportFormat === 'png' ? 'PNG' : 'HEVC'} 透明 MOV）` }}
            </button>
          </div>
        </template>
        <div v-else class="ins-empty">
          <h2>项目</h2>
          <p class="muted">视频：{{ videoName || '未导入' }}</p>
          <p class="muted">字幕：{{ srtName ? `${srtName} · ${subs.length} 句` : '未导入' }}</p>
          <p class="muted">卡片：{{ cards.length }} 张 · {{ trackCount }} 层</p>
          <p class="hint">在时间轴上点一张卡编辑；从左边卡片库点一下或拖到时间轴上加卡。</p>
        </div>
      </aside>
    </div>

    <!-- ── 底：时间轴 ── -->
    <footer class="ed-tl">
      <div class="tl-bar">
        <button class="btn sm" :disabled="!lastTemplate" :title="lastTemplate ? '' : '先从卡片库加一张'" @click="lastTemplate && addAt(templateById(lastTemplate)!, t)">＋ 在播放头再加一张{{ lastTemplate ? `「${templateById(lastTemplate)?.name}」` : '' }}</button>
        <button class="btn sm" :disabled="!selected" @click="selected && removeCard(selected.id)">删除选中</button>
        <span class="ed-gap" />
        <span class="muted">缩放</span>
        <button class="icon-btn" title="缩小" @click="tlZoom = Math.max(1, tlZoom / 1.5)">－</button>
        <input v-model.number="tlZoom" class="tl-zoom" type="range" min="1" max="12" step="0.1" />
        <button class="icon-btn" title="放大" @click="tlZoom = Math.min(12, tlZoom * 1.5)">＋</button>
        <button class="btn sm" @click="tlZoom = 1">铺满</button>
      </div>
      <div class="tl-body">
        <div class="tl-heads">
          <div class="tl-h ruler" />
          <div class="tl-h sub" :style="{ height: `${SUB_ROW_H}px` }">字幕</div>
          <div v-for="k in trackCount" :key="k" class="tl-h" :style="{ height: `${ROW_H}px` }">轨道 {{ trackCount - k + 1 }}</div>
        </div>
        <div ref="tlWrap" class="tl-scroll">
          <div ref="tlIn" class="br-tl-in" :style="{ width: `${total * pps + 30}px` }" @click="onTimelineClick" @dragover="onTrackDragOver" @drop="onTrackDrop" @dragleave="dropAt = null">
            <div class="tl-ruler">
              <span v-for="tk in ticks" :key="tk.t" class="tick" :style="{ left: pct(tk.t) }">{{ tk.label }}</span>
            </div>
            <div class="br-tl-row subs" :style="{ height: `${SUB_ROW_H}px` }">
              <div v-for="l in subs" :key="l.id" class="br-tl-sub" :style="{ left: pct(l.start), width: pct(l.end - l.start) }" :title="l.text">{{ l.text }}</div>
            </div>
            <div class="br-tl-tracks" :style="{ height: `${trackCount * ROW_H}px` }">
              <div v-for="k in trackCount" :key="k" class="br-tl-lane" :style="{ top: `${(k - 1) * ROW_H}px`, height: `${ROW_H}px` }" />
              <div
                v-for="c in cards" :key="c.id" class="br-tl-card" :class="[`cat-${LIB_CATEGORIES.indexOf(categoryOf(c.template))}`, { on: c.id === selectedId, bad: isOverflow(c) || dataProblems(c).length }]"
                :style="{ left: pct(c.start), width: pct(c.end - c.start), top: `${(trackCount - 1 - c.track) * ROW_H + 3}px`, height: `${ROW_H - 6}px` }"
                :title="[tplOf(c).name, `${c.start.toFixed(1)}–${c.end.toFixed(1)}s`, ...(isOverflow(c) ? ['卡片有一部分在画面外'] : []), ...dataProblems(c)].join(' · ')"
                @click.stop
                @pointerdown="tlDrag($event, c, 'move')"
              >
                <i class="br-tl-edge l" @pointerdown.stop="tlDrag($event, c, 'start')" />
                <span class="tl-card-name">{{ tplOf(c).name }}</span><span class="tl-card-sum">{{ tplOf(c).summary(c.data) }}</span>
                <template v-if="c.id === selectedId">
                  <i
                    v-for="(tg, i) in cueTargets(c)" :key="'cue' + i" class="tl-cue" :class="{ set: isCueSet(c, i), late: cueEff(c, i) + 0.4 > c.end - c.start }"
                    :style="{ left: `${cueEff(c, i) * pps}px` }" :title="`${i + 1}. ${tg} · ${(c.start + cueEff(c, i)).toFixed(1)}s`"
                    @pointerdown.stop="cueDrag($event, c, i)"
                  />
                </template>
                <i class="br-tl-edge r" @pointerdown.stop="tlDrag($event, c, 'end')" />
              </div>
              <div v-if="dropAt" class="tl-drop" :style="{ left: pct(dropAt.t), top: `${Math.max(0, trackCount - 1 - dropAt.track) * ROW_H}px`, height: `${ROW_H}px` }" />
            </div>
            <div class="br-tl-head" :style="{ left: pct(t) }"><i /></div>
          </div>
        </div>
      </div>
    </footer>
  </div>
</template>

<style scoped>
/* 白底、剪映式分区：顶栏 / 左卡片库 / 中预览 / 右属性 / 底时间轴 */
.ed {
  --bd: #E5E6EB; --bg: #F5F6F8; --panel: #FFFFFF; --ink: #1D2129; --sub: #4E5969; --mute2: #86909C; --pri: #FF6B1A; --blue: #3370FF;
  height: 100vh; display: grid; grid-template-rows: 52px auto minmax(0, 1fr) 300px; background: var(--bg); color: var(--ink);
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Segoe UI", Roboto, sans-serif; font-size: 13px; overflow: hidden;
}
/* 每块固定在自己那一行：提示条是 v-if 的，不固定的话它不在时后面几块整体上移一行，时间轴跑进 1fr 那行、被盖住拖不进去 */
.ed-top { grid-row: 1; }
.ed-banner { grid-row: 2; }
.ed-mid { grid-row: 3; }
.ed-tl { grid-row: 4; }
.muted { color: var(--mute2); font-size: 12px; }
button { font: inherit; }
.btn { display: inline-flex; align-items: center; gap: 4px; height: 30px; padding: 0 12px; border: 1px solid var(--bd); background: #fff; border-radius: 6px; cursor: pointer; color: var(--ink); white-space: nowrap; font-size: 13px; }
.btn:hover:not(:disabled) { border-color: #C9CDD4; background: #FAFAFB; }
.btn.sm { height: 26px; padding: 0 10px; font-size: 12px; }
.btn.primary { background: var(--pri); border-color: var(--pri); color: #fff; font-weight: 600; }
.btn.primary:hover:not(:disabled) { background: #F25D0C; }
.btn.dark { background: var(--ink); border-color: var(--ink); color: #fff; }
.btn.block { width: 100%; justify-content: center; height: 36px; }
.btn:disabled { opacity: 0.45; cursor: not-allowed; }
.icon-btn { width: 26px; height: 26px; border: 1px solid transparent; background: transparent; border-radius: 6px; cursor: pointer; color: var(--sub); flex: none; }
.icon-btn:hover:not(:disabled) { background: #F2F3F5; }
.icon-btn.danger:hover { background: #FFECE8; }
.icon-btn:disabled { opacity: 0.35; }
.link { border: 0; background: none; color: var(--blue); cursor: pointer; padding: 0 0 0 8px; font-size: 12px; }
.seg { display: inline-flex; padding: 2px; border-radius: 7px; background: #F2F3F5; }
.seg button { height: 26px; min-width: 34px; padding: 0 10px; border: 0; background: transparent; border-radius: 5px; cursor: pointer; color: var(--sub); }
.seg button.on { background: #fff; color: var(--ink); font-weight: 600; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08); }
.seg button:disabled { opacity: 0.35; cursor: not-allowed; }
.ed-sel { display: inline-flex; align-items: center; gap: 6px; color: var(--sub); }
.ed-sel select, .ed-fmt { height: 30px; border: 1px solid var(--bd); border-radius: 6px; padding: 0 8px; background: #fff; font: inherit; color: var(--ink); }
.ed-sel.sm select { height: 26px; font-size: 12px; }
.ed-fmt { max-width: 230px; }
label.check { display: inline-flex; align-items: center; gap: 6px; color: var(--sub); cursor: pointer; }

/* 顶栏 */
.ed-keywrap { position: relative; }
.ed-key { font-size: 12px; color: inherit; background: transparent; white-space: nowrap; padding: 5px 9px; border: 1px solid var(--bd); border-radius: 6px; cursor: pointer; }
.ed-topup { position: absolute; right: 0; top: calc(100% + 8px); z-index: 50; width: 320px; padding: 14px; background: var(--panel); border: 1px solid var(--bd); border-radius: 8px; box-shadow: 0 12px 32px rgba(0, 0, 0, .35); font-size: 13px; }
.ed-topup p { margin: 0 0 8px; }
.ed-topup-price { opacity: .6; font-size: 12px; }
.ed-topup input { width: 100%; box-sizing: border-box; padding: 7px 9px; margin-bottom: 10px; font-family: monospace; }
.ed-topup-row { display: flex; justify-content: flex-end; gap: 8px; }
.ed-topup-ok { color: #3fbf6f; margin-top: 10px !important; }
.ed-topup-err { color: #ff6b5e; margin-top: 10px !important; }
.ed-top { display: flex; align-items: center; gap: 10px; padding: 0 14px; background: var(--panel); border-bottom: 1px solid var(--bd); }
.ed-brand { display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 700; margin-right: 6px; }
.ed-logo { width: 22px; height: 22px; border-radius: 6px; background: linear-gradient(135deg, #FFB04D, var(--pri)); box-shadow: 0 2px 6px rgba(255, 107, 26, 0.35); }
.ed-gap { flex: 1; }
.ed-div { width: 1px; height: 22px; background: var(--bd); }
.ed-lab { color: var(--mute2); text-decoration: none; font-size: 12px; }
.ed-lab:hover { color: var(--blue); }

/* 提示条 */
.ed-banner { position: relative; max-height: 160px; overflow-y: auto; padding: 8px 44px 8px 14px; background: #FFF8F0; border-bottom: 1px solid #FFE4CC; }
.bn { padding: 3px 0; font-size: 13px; color: var(--ink); }
.bn.err { color: #F53F3F; }
.bn.ok { color: #00873C; }
.bn.pre { white-space: pre-line; }
.bn ul { margin: 4px 0 0; padding-left: 18px; color: var(--sub); font-size: 12px; }
.bn-x { position: absolute; right: 10px; top: 8px; border: 0; background: none; cursor: pointer; color: var(--mute2); }

/* 中间三栏 */
.ed-mid { min-height: 0; display: grid; grid-template-columns: 300px minmax(0, 1fr) 330px; }
.ed-left, .ed-right { min-height: 0; display: flex; flex-direction: column; background: var(--panel); }
.ed-left { border-right: 1px solid var(--bd); }
.ed-right { border-left: 1px solid var(--bd); overflow-y: auto; }
.tabs { display: flex; gap: 4px; padding: 8px 10px 0; border-bottom: 1px solid var(--bd); }
.tabs button { height: 34px; padding: 0 12px; border: 0; border-bottom: 2px solid transparent; background: none; cursor: pointer; color: var(--sub); font-weight: 600; }
.tabs button.on { color: var(--ink); border-bottom-color: var(--pri); }
.tabs small { color: var(--mute2); font-weight: 400; }
.lib-tools { padding: 10px; display: flex; flex-direction: column; gap: 8px; }
.lib-search { height: 30px; border: 1px solid var(--bd); border-radius: 6px; padding: 0 10px; font: inherit; background: #F7F8FA; }
.lib-cats { display: flex; flex-wrap: wrap; gap: 6px; }
.lib-cats button { height: 24px; padding: 0 10px; border: 1px solid var(--bd); border-radius: 12px; background: #fff; cursor: pointer; color: var(--sub); font-size: 12px; }
.lib-cats button.on { background: #FFF1E8; border-color: #FFC9A6; color: var(--pri); font-weight: 600; }
.lib-grid { flex: 1; min-height: 0; overflow-y: auto; padding: 4px 10px 10px; display: grid; grid-template-columns: 1fr 1fr; gap: 10px; align-content: start; }
.lib-item { cursor: pointer; border-radius: 8px; padding: 4px; border: 1px solid transparent; user-select: none; }
.lib-item:hover { border-color: #FFC9A6; background: #FFF8F2; }
.lib-thumb { border-radius: 6px; overflow: hidden; pointer-events: none; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08); }
.lib-name { margin-top: 5px; font-size: 12px; font-weight: 600; color: var(--ink); display: flex; align-items: center; gap: 4px; }
.lib-name em { font-style: normal; font-size: 10px; padding: 0 5px; border-radius: 6px; background: #F2F3F5; color: var(--mute2); font-weight: 400; }
.lib-empty { padding: 20px 14px; color: var(--mute2); font-size: 12px; line-height: 1.6; }
.lib-empty.err { color: #F53F3F; }
.lib-tip { padding: 8px 12px; border-top: 1px solid var(--bd); color: var(--mute2); font-size: 11px; }
.sub-tools { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px; border-bottom: 1px solid #F2F3F5; }
.sub-list { flex: 1; min-height: 0; overflow-y: auto; }
.sub-row { display: flex; align-items: flex-start; gap: 8px; padding: 8px 10px; border-bottom: 1px solid #F7F8FA; cursor: pointer; }
.sub-row:hover { background: #FAFAFB; }
.sub-row.on { background: #FFF4EC; }
.sub-t { font-family: Menlo, monospace; font-size: 11px; color: var(--mute2); padding-top: 2px; }
.sub-x { flex: 1; line-height: 1.5; }

/* 预览 */
.ed-center { min-width: 0; min-height: 0; display: flex; flex-direction: column; background: var(--bg); }
.pv { flex: 1; min-height: 0; display: grid; place-items: center; }
.br-stage { position: relative; overflow: hidden; border-radius: 6px; background: #1D2129; box-shadow: 0 6px 24px rgba(0, 0, 0, 0.12); }
.pv-empty { position: absolute; left: 0; right: 0; bottom: 14px; color: #6B7280; font-size: 12px; text-align: center; padding: 0 16px; }
.br-video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; background: #000; }
.pv-ctrl { position: relative; display: flex; align-items: center; justify-content: center; height: 48px; background: var(--panel); border-top: 1px solid var(--bd); }
.pv-time { position: absolute; left: 14px; font-family: Menlo, monospace; font-size: 12px; color: var(--mute2); }
.pv-time b { color: var(--ink); }
.play { width: 34px; height: 34px; border-radius: 50%; border: 0; background: var(--ink); color: #fff; cursor: pointer; font-size: 12px; }
.pv-opts { position: absolute; right: 14px; display: flex; gap: 14px; }
.pv-warn { padding: 6px 14px; background: #FFECE8; color: #F53F3F; font-size: 12px; }
.br-canvas { position: absolute; left: 0; top: 0; transform-origin: 0 0; pointer-events: none; }
.br-layer { position: absolute; transform-origin: 0 0; cursor: move; touch-action: none; user-select: none; }
.br-full { position: absolute; inset: 0; display: grid; place-items: center; pointer-events: none; }
.br-handle { position: absolute; right: -9px; bottom: -9px; width: 18px; height: 18px; transform-origin: center; background: #fff; border: 2px solid var(--blue); border-radius: 4px; cursor: nwse-resize; box-sizing: border-box; }
.br-sub { position: absolute; left: 50%; bottom: 60px; transform: translateX(-50%); max-width: calc(100% - 120px); padding: 10px 28px; border-radius: 10px; background: rgba(0, 0, 0, 0.55); color: #fff; font-size: 44px; text-align: center; }
.br-nav { z-index: 900; }
.br-guide { position: absolute; background: #FF2D8A; pointer-events: none; z-index: 999; }
.br-guide.v { top: 0; bottom: 0; }
.br-guide.h { left: 0; right: 0; }

/* 属性 */
.ins-head { position: sticky; top: 0; z-index: 2; display: flex; align-items: center; gap: 8px; padding: 12px 14px; background: var(--panel); border-bottom: 1px solid var(--bd); }
.ins-head h2 { margin: 0; flex: 1; font-size: 15px; }
.ins-cat { font-size: 11px; padding: 1px 7px; border-radius: 8px; background: #FFF1E8; color: var(--pri); }
.ins-body { padding: 4px 14px 16px; display: flex; flex-direction: column; gap: 4px; }
.ins-sec { padding: 12px 0; border-bottom: 1px solid #F2F3F5; display: flex; flex-direction: column; gap: 10px; }
.ins-sec h3 { margin: 0; font-size: 12px; color: var(--mute2); font-weight: 600; letter-spacing: 0.04em; }
.ins-empty { padding: 16px; }
.ins-empty h2 { margin: 0 0 10px; font-size: 15px; }
.ins-empty p { margin: 6px 0; }
.warn { margin-top: 10px; padding: 8px 10px; border-radius: 6px; background: #FFECE8; color: #F53F3F; font-size: 12px; line-height: 1.5; }
.hint { color: var(--mute2); font-size: 12px; }
.fld { display: flex; flex-direction: column; gap: 5px; font-size: 12px; color: var(--sub); }
.row2 { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.row3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; }
.row3 label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--sub); }
.ed-right input:not([type]), .ed-right input[type="number"], .ed-right select, .ed-right textarea {
  width: 100%; min-width: 0; box-sizing: border-box; border: 1px solid var(--bd); border-radius: 6px; padding: 6px 8px; font: inherit; font-size: 13px; color: var(--ink); background: #fff;
}
.ed-right input:focus, .ed-right select:focus, .ed-right textarea:focus { outline: none; border-color: var(--pri); box-shadow: 0 0 0 2px rgba(255, 107, 26, 0.12); }
.ed-right input[type="color"] { width: 60px; height: 28px; padding: 2px; border: 1px solid var(--bd); border-radius: 6px; background: #fff; }
.ed-right input[type="range"] { width: 100%; accent-color: var(--pri); }
.ed-right input.bool { width: 16px; height: 16px; accent-color: var(--pri); }
.ai-tag { font-style: normal; font-size: 10px; padding: 0 5px; border-radius: 6px; background: #F0E6FF; color: #722ED1; margin-left: 4px; }
.img-row { display: flex; align-items: center; gap: 6px; }
.pts { display: flex; flex-direction: column; gap: 6px; }
.pts-img { position: relative; cursor: crosshair; border-radius: 6px; overflow: hidden; max-height: 260px; overflow-y: auto; background: #F2F3F5; }
.pts-in { position: relative; }
.pts-img img { display: block; width: 100%; user-select: none; }
.pts-dot {
  position: absolute; width: 22px; height: 22px; margin: -11px 0 0 -11px; border-radius: 50%; background: #F53F3F; color: #fff;
  font-size: 12px; font-style: normal; font-weight: 700; display: grid; place-items: center; box-shadow: 0 0 0 2px #fff; pointer-events: none;
}
.img-row input { flex: 1; }
.img-thumb { width: 30px; height: 30px; border-radius: 5px; object-fit: contain; background: #F2F3F5; flex: none; }
.img-thumb.empty { border: 1.5px dashed #F53F3F; box-sizing: border-box; }

/* 时间轴 */
.ed-tl { min-height: 0; display: flex; flex-direction: column; background: var(--panel); border-top: 1px solid var(--bd); }
.tl-bar { display: flex; align-items: center; gap: 8px; height: 40px; padding: 0 12px; border-bottom: 1px solid var(--bd); }
.tl-zoom { width: 140px; accent-color: var(--pri); }
.tl-body { flex: 1; min-height: 0; display: flex; overflow-y: auto; }
.tl-heads { flex: none; width: 64px; border-right: 1px solid var(--bd); background: #FAFAFB; }
.tl-h { display: flex; align-items: center; padding-left: 10px; font-size: 11px; color: var(--mute2); border-bottom: 1px solid #F2F3F5; box-sizing: border-box; }
.tl-h.ruler { height: 24px; }
.tl-scroll { flex: 1; min-width: 0; overflow-x: auto; overflow-y: hidden; }
.br-tl-in { position: relative; min-height: 100%; cursor: pointer; }
.tl-ruler { position: relative; height: 24px; border-bottom: 1px solid var(--bd); background: #FAFAFB; }
.tick { position: absolute; top: 0; height: 24px; padding-left: 4px; border-left: 1px solid #D9DCE1; font-family: Menlo, monospace; font-size: 10px; line-height: 24px; color: var(--mute2); white-space: nowrap; }
.br-tl-row { position: relative; border-bottom: 1px solid #F2F3F5; }
.br-tl-sub { position: absolute; top: 4px; bottom: 4px; padding: 0 6px; border-radius: 4px; background: #EEF0F3; border-right: 1px solid #fff; box-sizing: border-box; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 11px; line-height: 20px; color: var(--sub); }
.br-tl-tracks { position: relative; }
.br-tl-lane { position: absolute; left: 0; right: 0; border-bottom: 1px solid #F2F3F5; }
.br-tl-card {
  position: absolute; display: flex; align-items: center; gap: 6px; padding: 0 10px; border-radius: 6px; box-sizing: border-box; overflow: hidden; white-space: nowrap;
  font-size: 12px; cursor: grab; user-select: none; touch-action: none; border: 1px solid; --c: #FF6B1A; border-color: color-mix(in srgb, var(--c) 45%, transparent);
  background: color-mix(in srgb, var(--c) 14%, #fff); color: var(--ink);
}
.br-tl-card::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: var(--c); }
.br-tl-card.cat-0 { --c: #3370FF; } .br-tl-card.cat-1 { --c: #FF6B1A; } .br-tl-card.cat-2 { --c: #00B42A; }
/* 下标跟着 LIB_CATEGORIES 的顺序：数据 / 文字强调 / 列表结构 / 章节节奏 / 界面模拟 / 画面标注 / 素材 / B-roll 场景（加分类时这里一起挪） */
.br-tl-card.cat-3 { --c: #722ED1; } .br-tl-card.cat-4 { --c: #0FC6C2; } .br-tl-card.cat-5 { --c: #F5319D; } .br-tl-card.cat-6 { --c: #86909C; }
/* B-roll 场景：深靛色，和叠加卡一眼分开（场景是盖住人像的） */
.br-tl-card.cat-7 { --c: #3D3DF5; background: color-mix(in srgb, #3D3DF5 22%, #fff); }
.br-tl-card.on { box-shadow: 0 0 0 2px var(--blue); z-index: 2; }
.br-tl-card.bad { background: #FFECE8; border-color: #F53F3F; }
.tl-card-name { font-weight: 600; flex: none; }
.tl-card-sum { color: var(--sub); overflow: hidden; text-overflow: ellipsis; }
.br-tl-edge { position: absolute; top: 0; bottom: 0; width: 8px; cursor: ew-resize; z-index: 1; }
.br-tl-edge.l { left: 0; }
.br-tl-edge.r { right: 0; }
.br-tl-card.on .br-tl-edge { background: color-mix(in srgb, var(--blue) 25%, transparent); }
.tl-cue {
  position: absolute; top: 50%; width: 11px; height: 11px; margin: -6px 0 0 -6px; transform: rotate(45deg); z-index: 3; cursor: ew-resize;
  background: #fff; border: 2px solid var(--blue); box-sizing: border-box;
}
.tl-cue.set { background: var(--blue); }
.tl-cue.late { border-color: #F53F3F; background: #FFECE8; }
.cue-row { display: grid; grid-template-columns: 18px minmax(0, 1fr) 76px auto 26px; align-items: center; gap: 6px; }
.cue-no { font-family: Menlo, monospace; font-size: 11px; color: var(--mute2); }
.cue-tg { font-size: 12px; color: var(--ink); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.tl-drop { position: absolute; width: 3px; margin-left: -1px; background: var(--pri); box-shadow: 0 0 0 3px rgba(255, 107, 26, 0.2); pointer-events: none; }
.br-tl-head { position: absolute; top: 0; bottom: 0; width: 2px; margin-left: -1px; background: #F53F3F; pointer-events: none; z-index: 5; }
.br-tl-head i { position: absolute; top: 0; left: -5px; width: 12px; height: 10px; background: #F53F3F; clip-path: polygon(0 0, 100% 0, 50% 100%); }
</style>
