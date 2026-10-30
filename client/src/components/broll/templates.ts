import type { Component } from 'vue'
import NumberImpactCard from './NumberImpactCard.vue'
import ChapterTitleCard from './ChapterTitleCard.vue'
import KeywordCard from './KeywordCard.vue'
import ListCard from './ListCard.vue'
import CompareBarCard from './CompareBarCard.vue'
import RingCard from './RingCard.vue'
import StepsCard from './StepsCard.vue'
import RightWrongCard from './RightWrongCard.vue'
import QuestionCard from './QuestionCard.vue'
import TermTagCard from './TermTagCard.vue'
import ImageGroupCard from './ImageGroupCard.vue'
import StampCard from './StampCard.vue'
import BeforeAfterCard from './BeforeAfterCard.vue'
import RankingCard from './RankingCard.vue'
import TimelineCard from './TimelineCard.vue'
import QuoteCard from './QuoteCard.vue'
import DefineCard from './DefineCard.vue'
import PictogramCard from './PictogramCard.vue'
import BubbleCard from './BubbleCard.vue'
import LowerThirdCard from './LowerThirdCard.vue'
import SearchCard from './SearchCard.vue'
import NotifyCard from './NotifyCard.vue'
import ChatCard from './ChatCard.vue'
import TerminalCard from './TerminalCard.vue'
import WindowCard from './WindowCard.vue'
import ClickCard from './ClickCard.vue'
import DanmakuCard from './DanmakuCard.vue'
import PostCard from './PostCard.vue'
import BarChartCard from './BarChartCard.vue'
import LineChartCard from './LineChartCard.vue'
import ProgressCard from './ProgressCard.vue'
import GaugeCard from './GaugeCard.vue'
import PriceCard from './PriceCard.vue'
import CountdownCard from './CountdownCard.vue'
import TwoColumnCard from './TwoColumnCard.vue'
import QuadrantCard from './QuadrantCard.vue'
import FunnelCard from './FunnelCard.vue'
import PyramidCard from './PyramidCard.vue'
import CauseChainCard from './CauseChainCard.vue'
import FormulaCard from './FormulaCard.vue'
import VennCard from './VennCard.vue'
import MarkerCard from './MarkerCard.vue'
import RewriteCard from './RewriteCard.vue'
import WarningCard from './WarningCard.vue'
import EmojiCard from './EmojiCard.vue'
import OpeningCard from './OpeningCard.vue'
import CtaCard from './CtaCard.vue'
import SoundwaveCard from './SoundwaveCard.vue'
import { pgTimes } from './pictogramTimes'
import { retypeTimes } from './retypeTimes'
import MetricSparkCard from './MetricSparkCard.vue'
import ConvergeCard from './ConvergeCard.vue'
import AnnotateCard from './AnnotateCard.vue'
import MagnifierCard from './MagnifierCard.vue'
import ScrollTourCard from './ScrollTourCard.vue'
import { stAt, ST_HOLD } from './scrollTimes'
import { pointsOf } from './imageSize'
import { FAN_AT, FAN_END } from './fanTimes'
import NewsDeskCard from './NewsDeskCard.vue'
import SliderCompareCard from './SliderCompareCard.vue'
import { NEWS_LINE_AT, NEWS_SECOND_AT } from './newsTimes'
import { SLIDER_END } from './sliderTimes'
import ShapeWipeCard from './ShapeWipeCard.vue'
import InkBleedCard from './InkBleedCard.vue'
import TurnCard from './TurnCard.vue'
import AltLinesCard from './AltLinesCard.vue'
import SlabCard from './SlabCard.vue'
import { TURN_A_IN, TURN_TEXT_IN, turnAt, turnBIn, turnMin } from './turnTimes'
import { ALT_BLOCK, ALT_LAG, altAt } from './altTimes'
import { slabLand } from './slabTimes'
import CollapseCard from './CollapseCard.vue'
import FlyWordsCard from './FlyWordsCard.vue'
import AgendaCard from './AgendaCard.vue'
import FlipCardsCard from './FlipCardsCard.vue'
import BreakoutCard from './BreakoutCard.vue'
import DateStampCard from './DateStampCard.vue'
import { clBoilAt, clMin, clWordAt } from './collapseTimes'
import { agAt, agCurrent, agFocusAt } from './agendaTimes'
import { FL_DUR, flAt } from './flipTimes'
import { boRescaleAt, boShootAt, BO_RESCALE } from './breakoutTimes'
import { dsMin, dsNoteAt, dsTypedAt } from './stampTimes'
import { parseRows } from './rows'
import CrashZoomCard from './CrashZoomCard.vue'
import ScanMarkCard from './ScanMarkCard.vue'
import TextMaskCard from './TextMaskCard.vue'
import PortraitCard from './PortraitCard.vue'
import RackFocusCard from './RackFocusCard.vue'
import { CZ_AT, CZ_IN, CZ_SETTLE } from './crashTimes'
import { scEnd, scHitAt } from './scanTimes'
import { RF_AT, RF_DUR } from './rackTimes'
import SlotCycleCard from './SlotCycleCard.vue'
import CountBadgeCard from './CountBadgeCard.vue'
import TitleDemoteCard from './TitleDemoteCard.vue'
import ChooseCard from './ChooseCard.vue'

// 动效卡模版登记表。调试台（/broll/lab）和编辑页都只从这里取。
// 上线 / 下线存在服务端（templateStatus.ts），作者在调试台里看过所有测试数据都没问题才点上线。
// fixtures 专挑最容易出问题的数据（最长 / 最短 / 千分位 / 非数字 / 高亮词对不上），不是好看的示例。

export interface FieldDef {
  key: string
  label: string
  /** image：单张图片地址；imageList：多项「图片 + 名字」；points：在 of 那张图上点出来的位置（[{x,y}]，占图宽高的百分比） */
  type: 'text' | 'list' | 'select' | 'bool' | 'image' | 'imageList' | 'points'
  /** imageList / points 最多几项 */
  max?: number
  /** points 标在哪个图片字段上 */
  of?: string
  placeholder?: string
  options?: { value: string; label: string }[]
}

export interface TemplateDef {
  id: string
  name: string
  /** 一句话：长什么样、什么时候用（调试台主预览旁边显示） */
  blurb?: string
  component: Component
  /** 编辑面板里的字段（强调色 / 底板是所有卡共有的，不写在这里） */
  fields: FieldDef[]
  defaults: Record<string, any>
  /** 从一句字幕预填（手动「+ 加卡」时用） */
  fromLine: (text: string) => Record<string, any>
  /** 时间轴上那一小块显示的字 */
  summary: (d: Record<string, any>) => string
  /** 数据本身的问题（不是排版问题）。返回的每一条都要在面板 / 调试台里显示 —— 比如高亮词不在标题里，卡片照样画、只是不高亮。 */
  check?: (d: Record<string, any>) => string[]
  /**
   * 能单独定出现时间的那几条（按顺序，和 data.cues 的下标一一对应）；没有这一项的卡不支持逐条定时。
   * defaultCue 是没设时的默认时刻（编辑页在时间轴上画标记、算「最晚那条」都要用）。
   */
  cueTargets?: (d: Record<string, any>) => string[]
  defaultCue?: (d: Record<string, any>, i: number) => number
  /** 卡片最短停留秒数（入场 + 停住 + 出场看得全） */
  minDuration: (d: Record<string, any>) => number
  /** 调试台的三个关键帧：入场中 / 停住 / 出场中（秒；负数 = 从结尾往前数） */
  keyframes: (d: Record<string, any>) => [number, number, number]
  /** 铺满画布（scene）但大部分是透明的、要不要算「盖住下层卡」由数据决定时用（如叙事转折的透明底）；没有这一项就看 data.seeThrough */
  seeThrough?: (d: Record<string, any>) => boolean
  fixtures: { name: string; data: Record<string, any> }[]
}

const common = { accent: '', panel: true, fullscreen: false }

const numberDefaults = { ...common, label: '', prefix: '', value: '', unit: '', title: '', align: 'left' }
const chapterDefaults = { ...common, index: '01', label: '', title: '', highlight: '' }
const keywordDefaults = { ...common, label: '', lead: '', key: '' }
const listDefaults = { ...common, label: '', title: '', items: [] as string[], conclusion: '' }

const compareDefaults = { ...common, label: '', title: '', aName: '', aValue: '', bName: '', bValue: '', unit: '', highlight: 'b' }
const ringDefaults = { ...common, label: '', value: '', title: '', sub: '' }
const stepsDefaults = { ...common, label: '', title: '', steps: [] as string[] }

const rightWrongDefaults = { ...common, label: '', title: '', wrong: '', right: '' }
const questionDefaults = { ...common, label: '', question: '', hint: '' }
// 词语标注默认不带底板：截图里它是直接浮在画面上的
const termDefaults = { ...common, panel: false, from: '', to: '' }

const imageGroupDefaults = { ...common, headerImg: '', kicker: '', title: '', items: [] as { img: string; name: string }[], check: true, layout: 'row', entrance: 'pop', sourceImg: '', sourceName: '' }
const IMAGE_MAX = 5
// 调试台用的假 Logo（内联 SVG，不依赖网络 / 上传）
const fakeLogo = (bg: string, fg: string, ch: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='24' fill='${bg}'/><text x='50' y='66' font-size='52' font-family='Arial' font-weight='700' text-anchor='middle' fill='${fg}'>${ch}</text></svg>`)}`
// 假的「动效卡截图」：暗底 + 一个大数字
const SHOT = `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 352 214'><rect width='352' height='214' fill='#0d1018'/><rect x='30' y='40' width='4' height='120' fill='#3b6cff'/><text x='50' y='120' font-size='64' font-family='Arial' font-weight='700' fill='#fff'>92.4<tspan font-size='30' fill='#3b6cff'>%</tspan></text><rect x='50' y='150' width='220' height='3' fill='#2a3350'/></svg>`)}`
const LOGOS = [fakeLogo('#2F6BFF', '#fff', 'D'), fakeLogo('#1FC28E', '#fff', 'W'), fakeLogo('#F4F4F4', '#111', 'G'), fakeLogo('#7B4DFF', '#fff', 'K'), fakeLogo('#FF5A3C', '#fff', 'M')]

// 图片组第 i 个开始入场的时刻（和 ImageGroupCard 里的 arrive 一致）：调试台关键帧、最短停留都按它算
const igArrive = (d: Record<string, any>, i: number) =>
  (d.sourceName || d.sourceImg ? 1.0 : 0.6) + i * (d.entrance === 'drop' ? 0.38 : 0.28)

// 印章本身就是醒目的物件，不套底板
const stampDefaults = { ...common, panel: false, text: '', sub: '', tilt: '-6' }

const beforeAfterDefaults = { ...common, label: '', title: '', before: '', after: '', unit: '', beforeLabel: '以前', afterLabel: '现在' }
const rankingDefaults = { ...common, label: '', title: '', items: [] as string[], highlight: '1' }
const timelineDefaults = { ...common, label: '', title: '', events: [] as string[] }
const quoteDefaults = { ...common, quote: '', source: '' }
const defineDefaults = { ...common, term: '', en: '', definition: '' }
const pgOf = (d: Record<string, any>) => {
  const n = Math.max(0, Math.min(100, Math.round(Number(d.total) || 10)))
  const v = Math.max(0, Math.min(n, Math.round(Number(d.value) || 0)))
  return { v, ...pgTimes(n, v) }
}
const pictogramDefaults = { ...common, label: '', title: '', value: '', total: '10', caption: '', icon: 'person' }
const slotDefaults = { ...common, label: '', stem: '', items: [] as string[], conclusion: '' }
// 和 SlotCycleCard 里的节奏一致：第 i 个短语在 SLOT_START + i * SLOT_STEP 翻上来，结论在第 n 格
const SLOT_START = 0.6
const SLOT_STEP = 0.8
// 铺满画布（scene）但除了那行字是透明的（seeThrough）：不算盖住下层卡的全屏画面
const titleDemoteDefaults = { ...common, panel: false, scene: true, seeThrough: true, index: '01', label: '', title: '', corner: 'tl' }
const chooseDefaults = { ...common, label: '', title: '', options: [] as string[], pick: '', note: '' }
// 和 ChooseCard 里的节奏一致
const chooseOptAt = (i: number) => 0.5 + i * 0.22
const choosePickAt = (d: Record<string, any>) => {
  const n = filled(d.options).length
  const v = Array.isArray(d.cues) ? Number(d.cues[n]) : NaN
  return Array.isArray(d.cues) && d.cues[n] != null && Number.isFinite(v) && v >= 0 ? v : chooseOptAt(n) + 0.6
}
const metricDefaults = { ...common, label: '', title: '', rows: [] as string[], unit: '' }
const convergeDefaults = { ...common, label: '', title: '', sources: [] as string[], result: '' }
// 和 ConvergeCard 里的节奏一致
const cvSrcAt = (d: Record<string, any>, i: number) => cueOr(d, i, 0.4 + i * 0.25)
const cvResultAt = (d: Record<string, any>) => {
  const n = filled(d.sources).length
  return cueOr(d, n, Math.max(0, ...filled(d.sources).map((_: string, i: number) => cvSrcAt(d, i))) + 1.25)
}
const cueOr = (d: Record<string, any>, i: number, fb: number) => {
  const v = Array.isArray(d.cues) ? Number(d.cues[i]) : NaN
  return Array.isArray(d.cues) && d.cues[i] != null && Number.isFinite(v) && v >= 0 ? v : fb
}
// 画面标注：没有底板，拖到口播画面里的目标上；w / h 是目标区域（画布像素）
const annotateDefaults = { ...common, panel: false, shape: 'circle', w: '420', h: '260', text: '', side: 'right' }
const sizeFields: FieldDef[] = [
  { key: 'w', label: '目标宽（像素）', type: 'text', placeholder: '如 420' },
  { key: 'h', label: '目标高（像素）', type: 'text', placeholder: '如 260' },
]
const sizeCheck = (d: Record<string, any>) => (!isNum(d.w) || !isNum(d.h) ? ['目标宽高要填数字（像素），不然按默认 420×260 画'] : [])
const magnifierDefaults = { ...common, panel: false, img: '', point: [] as { x: number; y: number }[], zoom: '3', text: '', side: 'right' }
const scrollDefaults = { ...common, panel: false, img: '', stops: [] as { x: number; y: number }[] }
// 和 ScrollTourCard 一致：停靠处从上到下排，cues[i] 对应排好之后的第 i 处
const sortedStops = (d: Record<string, any>) => pointsOf(d.stops).sort((a, b) => a.y - b.y)
const stArrive = (d: Record<string, any>, i: number) => cueOr(d, i, stAt(i))
// 调试台用的假截图（带明确的 width / height：不写的话有的浏览器读不出原始宽高比）
const fakePage = (h: number, rows: number) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='1000' height='${h}' viewBox='0 0 1000 ${h}'><rect width='1000' height='${h}' fill='#f6f7f9'/><rect width='1000' height='90' fill='#1d2129'/><text x='40' y='58' font-size='32' font-family='Arial' font-weight='700' fill='#fff'>Example News</text>${Array.from({ length: rows }, (_, i) => `<rect x='40' y='${140 + i * 120}' width='${520 + ((i * 137) % 380)}' height='26' rx='6' fill='${i % 4 === 0 ? '#3370ff' : '#c9cdd4'}'/><rect x='40' y='${180 + i * 120}' width='880' height='16' rx='5' fill='#e5e6eb'/><rect x='40' y='${206 + i * 120}' width='640' height='16' rx='5' fill='#e5e6eb'/>`).join('')}</svg>`)}`
const LONG_PAGE = fakePage(2600, 20)
const WIDE_SHOT = fakePage(640, 4)
const newsDefaults = { ...common, panel: false, img: '', img2: '', line: [] as { x: number; y: number }[], source: '' }
const newsAt = (d: Record<string, any>) => ({ line: cueOr(d, 0, NEWS_LINE_AT), second: cueOr(d, 1, NEWS_SECOND_AT) })
const sliderDefaults = { ...common, panel: false, before: '', after: '', beforeLabel: '之前', afterLabel: '之后' }
// 「之前 / 之后」两张同构图的假截图：同一个版式，之后那张字更大、配色更亮
const fakeUi = (bg: string, fg: string, big: boolean) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='1600' height='900' viewBox='0 0 1600 900'><rect width='1600' height='900' fill='${bg}'/><rect x='120' y='140' width='${big ? 900 : 620}' height='${big ? 120 : 60}' rx='14' fill='${fg}'/><rect x='120' y='${big ? 320 : 260}' width='1100' height='30' rx='10' fill='${fg}' opacity='0.35'/><rect x='120' y='${big ? 380 : 310}' width='900' height='30' rx='10' fill='${fg}' opacity='0.35'/><rect x='120' y='600' width='${big ? 420 : 300}' height='${big ? 120 : 80}' rx='60' fill='${fg}'/></svg>`)}`
const BEFORE = fakeUi('#e5e6eb', '#86909c', false)
const AFTER = fakeUi('#0e1630', '#4d7cff', true)
const shapeWipeDefaults = { ...common, panel: false, fullscreen: false, scene: true, dir: 'right', layers: '3', label: '' }
const turnDefaults = { ...common, panel: false, fullscreen: false, scene: true, bg: 'clear', before: '', after: '' }
const altLinesDefaults = { ...common, panel: false, label: '', a: '', b: '' }
const slabDefaults = { ...common, panel: false, lead: '', key: '', style: 'punch' }
const collapseDefaults = { ...common, panel: false, sentence: '', word: '' }
const flyWordsDefaults = { ...common, panel: false, fullscreen: false, scene: true, bg: 'clear', words: [] as string[], title: '' }
const agendaDefaults = { ...common, label: '', title: '', items: [] as string[], current: '0' }
const flipCardsDefaults = { ...common, panel: false, label: '', title: '', rows: [] as string[], prefix: '', unit: '' }
const breakoutDefaults = { ...common, panel: false, label: '', title: '', rows: [] as string[], unit: '' }
const dateStampDefaults = { ...common, panel: false, when: '', where: '', note: '' }
const badPairs = (rows: string[]) => parseRows(rows).filter((r) => Number.isNaN(r.v)).map((r) => r.name)
const crashZoomDefaults = { ...common, panel: false, img: '', point: [] as { x: number; y: number }[], zoom: '2.3', text: '' }
const scanMarkDefaults = { ...common, panel: false, img: '', points: [] as { x: number; y: number }[], labels: [] as string[], done: '分析完成' }
const textMaskDefaults = { ...common, panel: false, fullscreen: false, scene: true, bg: 'full', img: '', text: '' }
const portraitDefaults = { ...common, panel: false, fullscreen: false, scene: true, img: '', title: '', source: '', side: 'right' }
const rackFocusDefaults = { ...common, panel: false, img: '', img2: '', cap: '', cap2: '' }
// 调试台用的竖图（手机截图那种 9:16 左右）
const PORTRAIT_SHOT = fakePage(1800, 13)
const inkBleedDefaults = { ...common, panel: false, fullscreen: false, scene: true, from: 'center', ink: 'fg', label: '' }
const countBadgeDefaults = { ...common, label: '', lead: '', value: '', unit: '', title: '' }
const bubbleDefaults = { ...common, label: '', items: [] as string[] }
// 人名条默认不带底板（下三分之一那种，直接压在画面上）
const lowerThirdDefaults = { ...common, panel: false, name: '', role: '' }
const filled = (xs: string[]) => xs.filter((s) => s.trim())
// 「看起来有几个字宽」：中文算 1，英文 / 数字 / 空格算半个（「Final Cut」≈ 4.5 个字宽，不是 9 个）
const visLen = (s: string) => [...s].reduce((n, ch) => n + (/[\u0000-\u024f]/.test(ch) ? 0.5 : 1), 0)
const searchDefaults = { ...common, query: '', results: [] as string[], hint: '' }
// 通知 / 终端 / 窗口 / 帖子 / 弹幕本身就是一个「界面」，不套底板
const notifyDefaults = { ...common, panel: false, app: '', icon: '', title: '', body: '' }
const chatDefaults = { ...common, name: '', messages: [] as string[] }
const terminalDefaults = { ...common, panel: false, title: 'terminal', lines: [] as string[] }
const windowDefaults = { ...common, panel: false, img: '', url: '', caption: '', style: 'browser' }
const clickDefaults = { ...common, panel: false, button: '', result: '' }
const danmakuDefaults = { ...common, panel: false, items: [] as string[], mock: true }
const postDefaults = { ...common, panel: false, user: '', avatar: '', text: '', img: '', likes: '', comments: '', mock: true }
const len = (s: string) => [...(s || '')].length
const chartDefaults = { ...common, label: '', title: '', rows: [] as string[], unit: '' }
const progressDefaults = { ...common, label: '', title: '', current: '', target: '', unit: '' }
const gaugeDefaults = { ...common, label: '', title: '', score: '', max: '10', caption: '' }
const priceDefaults = { ...common, label: '', title: '', currency: '¥', oldPrice: '', newPrice: '', tag: '' }
const countdownDefaults = { ...common, lead: '', value: '', unit: '' }
const twoColDefaults = { ...common, label: '', title: '', leftTitle: '', left: [] as string[], rightTitle: '', right: [] as string[], tone: 'proscons' }
const quadDefaults = { ...common, label: '', title: '', xLabel: '', yLabel: '', q1: '', q2: '', q3: '', q4: '', highlight: '1' }
const funnelDefaults = { ...common, label: '', title: '', rows: [] as string[], unit: '' }
const pyramidDefaults = { ...common, label: '', title: '', levels: [] as string[] }
const chainDefaults = { ...common, label: '', title: '', nodes: [] as string[] }
const formulaDefaults = { ...common, label: '', title: '', parts: [] as string[], op: '+', result: '' }
const vennDefaults = { ...common, label: '', title: '', a: '', b: '', both: '' }
const markerDefaults = { ...common, sentence: '', marks: '' }
const rewriteDefaults = { ...common, lead: '不是', from: '', to: '', tail: '', style: 'strike' }
// 警告牌 / 表情 / 片头本身就是一个醒目的物件，不套底板；片头默认全屏
const warningDefaults = { ...common, panel: false, title: '注意', text: '' }
const emojiDefaults = { ...common, panel: false, emoji: '🔥', text: '' }
const openingDefaults = { ...common, panel: false, fullscreen: true, kicker: '', title: '', subtitle: '' }
const ctaDefaults = { ...common, text: '觉得有用就点个关注', buttons: 'like,fav,follow' }
// 声波过渡：铺满画布（data.scene），默认叠加模式（透明底，浮在口播上）
const soundwaveDefaults = { ...common, panel: false, fullscreen: false, scene: true, mode: 'overlay', label: '', palette: 'accent', intensity: 'normal' }
const between = (n: number, lo: number, hi: number, what: string) => (n < lo ? [`${what}少于 ${lo} 个`] : n > hi ? [`${what}超过 ${hi} 个，放不下`] : [])
// 「名字 数值」一行一个：数值必须是数字，否则柱子 / 点画不出来
const badRows = (rows: string[]) => filled(rows).filter((r) => !/^.+\s+[\d,.]+$/.test(r.trim()))

const LIST_MAX = 5
// 设过的逐条时间里最晚的那一个（没设过返回 0）
const lastCue = (d: Record<string, any>) => Math.max(0, ...(Array.isArray(d.cues) ? d.cues.filter((v: unknown) => v != null && Number.isFinite(Number(v))).map(Number) : []))
const STEPS_MAX = 5
const isNum = (v: string) => String(v).trim() !== '' && Number.isFinite(Number(String(v).replace(/,/g, '')))
// 从一句字幕里抓前两个数（对比条预填）
const numsIn = (text: string) => text.match(/\d[\d,]*(?:\.\d+)?/g) || []

export const TEMPLATES: TemplateDef[] = [
  {
    id: 'number',
    name: '数字冲击',
    component: NumberImpactCard,
    fields: [
      { key: 'label', label: '英文小标签', type: 'text', placeholder: '如 GROWTH，可留空' },
      { key: 'prefix', label: '前缀', type: 'text', placeholder: '如 + 或 ¥' },
      { key: 'value', label: '数字', type: 'text', placeholder: '300 / 3.5 / 1,280' },
      { key: 'unit', label: '单位', type: 'text', placeholder: '% / 万 / 倍' },
      { key: 'title', label: '说明', type: 'text' },
      { key: 'align', label: '文字对齐', type: 'select', options: [{ value: 'left', label: '靠左' }, { value: 'center', label: '居中' }, { value: 'right', label: '靠右' }] },
    ],
    defaults: numberDefaults,
    // 抓第一个数字预填；抓不到就留空让他自己填（「三倍」这种中文数字不猜）
    fromLine: (text) => {
      const m = text.match(/([+\-]?)(\d[\d,]*(?:\.\d+)?)\s*(%|％|倍|万|亿|千|个|人|元|年)?/)
      return { prefix: m?.[1] || '', value: m?.[2] || '', unit: m?.[3] === '％' ? '%' : m?.[3] || '', title: text }
    },
    summary: (d) => `${d.prefix}${d.value}${d.unit}`,
    minDuration: () => 3,
    keyframes: () => [0.5, 1.8, -0.25],
    fixtures: [
      { name: '常规', data: { ...numberDefaults, label: 'GROWTH', prefix: '+', value: '300', unit: '%', title: '去年营收增长' } },
      { name: '千分位 + 中文单位', data: { ...numberDefaults, label: 'PRICE', value: '1,280', unit: '元', title: '客单价' } },
      { name: '小数', data: { ...numberDefaults, value: '3.5', unit: '倍', title: '效率提升' } },
      { name: '最长说明（12 字）', data: { ...numberDefaults, label: 'TEAM SIZE', value: '86', unit: '个人', title: '团队从十二个人扩到了现在' } },
      { name: '超长数字', data: { ...numberDefaults, label: 'USERS', value: '12,345,678', unit: '万', title: '累计用户' } },
      { name: '只有数字', data: { ...numberDefaults, value: '86' } },
      { name: '不是数字（不跳）', data: { ...numberDefaults, label: 'X TIMES', value: '三倍', title: '比同行快' } },
    ],
  },
  {
    id: 'chapter',
    name: '章节标题',
    component: ChapterTitleCard,
    fields: [
      { key: 'index', label: '编号', type: 'text', placeholder: '01 / 02，可留空' },
      { key: 'label', label: '英文小标签', type: 'text', placeholder: '如 COST DOWN，可留空' },
      { key: 'title', label: '标题', type: 'text' },
      { key: 'highlight', label: '高亮词（标题里的一段）', type: 'text' },
    ],
    defaults: chapterDefaults,
    fromLine: (text) => ({ title: text }),
    summary: (d) => `${d.index ? d.index + ' ' : ''}${d.title}`,
    check: (d) => (d.highlight && !d.title.includes(d.highlight) ? [`高亮词「${d.highlight}」不在标题里，没有高亮`] : []),
    minDuration: (d) => Math.max(3, 0.45 + [...(d.title || '')].length * 0.05 + 1.6),
    keyframes: () => [0.6, 2, -0.25],
    fixtures: [
      { name: '常规', data: { ...chapterDefaults, index: '02', label: 'COST DOWN', title: '两项成本大幅下降', highlight: '大幅下降' } },
      { name: '无编号无标签', data: { ...chapterDefaults, index: '', title: '做口播的这群人', highlight: '这群人' } },
      { name: '最长标题（14 字）', data: { ...chapterDefaults, index: '10', label: 'SEMANTIC LAYOUT', title: '为什么你的口播视频没人看完', highlight: '没人看完' } },
      { name: '高亮词不在标题里', data: { ...chapterDefaults, index: '03', label: 'PAIN POINT', title: '提示词改了又改', highlight: '一版又一版' } },
      { name: '中英混排', data: { ...chapterDefaults, index: '01', label: 'MOTION', title: 'Opus 5.5 预制动效卡', highlight: 'Opus 5.5' } },
    ],
  },
  {
    id: 'keyword',
    name: '关键词大字',
    component: KeywordCard,
    fields: [
      { key: 'label', label: '英文小标签', type: 'text', placeholder: '如 ITERATE，可留空' },
      { key: 'lead', label: '引子（小字）', type: 'text', placeholder: '可留空' },
      { key: 'key', label: '重点（大字）', type: 'text' },
    ],
    defaults: keywordDefaults,
    fromLine: (text) => ({ key: text }),
    summary: (d) => d.key,
    minDuration: (d) => Math.max(3, 0.55 + [...(d.key || '')].length * 0.08 + 1.6),
    keyframes: (d) => [0.55 + Math.min(3, [...(d.key || '')].length) * 0.08, 2.2, -0.25],
    fixtures: [
      { name: '常规', data: { ...keywordDefaults, label: 'ITERATE', lead: '提示词是改', key: '一版又一版' } },
      { name: '只有重点', data: { ...keywordDefaults, key: '别再卷了' } },
      { name: '最长重点（10 字）', data: { ...keywordDefaults, lead: '记住一句话', key: '内容是长期主义的复利' } },
      { name: '最长引子', data: { ...keywordDefaults, label: 'KEY POINT', lead: '我做了三年口播之后才明白', key: '真诚' } },
      { name: '中英混排', data: { ...keywordDefaults, lead: '真正的护城河是', key: 'AI 工作流' } },
    ],
  },
  {
    id: 'list',
    name: '要点清单',
    component: ListCard,
    fields: [
      { key: 'label', label: '英文小标签', type: 'text', placeholder: '如 WHO IS STUCK，可留空' },
      { key: 'title', label: '标题', type: 'text' },
      { key: 'items', label: `条目（一行一条，2–${LIST_MAX} 条）`, type: 'list' },
      { key: 'conclusion', label: '结论（✓ 那一行，可留空）', type: 'text' },
    ],
    defaults: listDefaults,
    fromLine: (text) => ({ title: text, items: ['', ''] }),
    summary: (d) => `${d.title || '清单'} · ${d.items.filter((s: string) => s.trim()).length} 条`,
    check: (d) => {
      const n = d.items.filter((s: string) => s.trim()).length
      return n < 2 ? ['条目少于 2 条'] : n > LIST_MAX ? [`条目超过 ${LIST_MAX} 条，画面会很挤`] : []
    },
    cueTargets: (d) => [...filled(d.items), ...(d.conclusion?.trim() ? [`✓ ${d.conclusion}`] : [])],
    defaultCue: (d, i) => (i < filled(d.items).length ? 0.55 + i * 0.35 : 0.55 + filled(d.items).length * 0.35 + 0.2),
    // 设了逐条时间的话，按最晚那一条算（它出来之后还要留 1.6 秒看清再出场）
    minDuration: (d) => Math.max(3.5, 0.55 + d.items.length * 0.35 + (d.conclusion ? 0.8 : 0.2) + 1.2, lastCue(d) + 1.6),
    keyframes: (d) => [0.55 + 0.35 * 1.5, Math.max(0.55 + d.items.length * 0.35 + 1.1, lastCue(d) + 0.8), -0.25],
    fixtures: [
      { name: '常规 4 条 + 结论', data: { ...listDefaults, label: 'WHO IS STUCK', title: '做口播的这群人', items: ['口播博主', '知识博主', '企业号', '短视频号'], conclusion: '用国产模型' } },
      { name: '最少 2 条', data: { ...listDefaults, title: '两个原因', items: ['成本高', '周期长'] } },
      { name: '最多 5 条', data: { ...listDefaults, label: 'CHECKLIST', title: '发布前检查', items: ['标题', '封面', '字幕', '背景音乐', '话题标签'], conclusion: '全部打勾再发' } },
      { name: '最长条目', data: { ...listDefaults, title: '我们做对了三件事', items: ['只做一个品类，不贪多', '客单价提到一千二以上', '复购率做到百分之四十'] } },
      { name: '无标题', data: { ...listDefaults, items: ['提示词改一版又一版', '出来的效果总是差一点'] } },
    ],
  },
  {
    id: 'compare',
    name: '对比条',
    component: CompareBarCard,
    fields: [
      { key: 'label', label: '英文小标签', type: 'text', placeholder: '如 VS，可留空' },
      { key: 'title', label: '标题', type: 'text', placeholder: '可留空' },
      { key: 'aName', label: '第一项名字', type: 'text', placeholder: '如 同行平均' },
      { key: 'aValue', label: '第一项数值', type: 'text' },
      { key: 'bName', label: '第二项名字', type: 'text', placeholder: '如 我们' },
      { key: 'bValue', label: '第二项数值', type: 'text' },
      { key: 'unit', label: '单位', type: 'text', placeholder: '% / 万 / 天' },
      { key: 'highlight', label: '高亮哪一项', type: 'select', options: [{ value: 'a', label: '第一项' }, { value: 'b', label: '第二项' }] },
    ],
    defaults: compareDefaults,
    fromLine: (text) => {
      const [a = '', b = ''] = numsIn(text)
      return { title: text, aValue: a, bValue: b }
    },
    summary: (d) => `${d.aValue || '?'} vs ${d.bValue || '?'}${d.unit}`,
    check: (d) => [
      ...(!isNum(d.aValue) ? [`第一项「${d.aValue}」不是数字，柱子画不出来`] : []),
      ...(!isNum(d.bValue) ? [`第二项「${d.bValue}」不是数字，柱子画不出来`] : []),
    ],
    minDuration: () => 3.5,
    keyframes: () => [0.9, 2.3, -0.25],
    fixtures: [
      { name: '常规', data: { ...compareDefaults, label: 'VS', title: '营收增速', aName: '同行平均', aValue: '20', bName: '我们', bValue: '300', unit: '%' } },
      { name: '两个数差不多', data: { ...compareDefaults, title: '转化率', aName: '改版前', aValue: '3.2', bName: '改版后', bValue: '3.8', unit: '%' } },
      { name: '差距极大（小的那根）', data: { ...compareDefaults, aName: '人工', aValue: '1', bName: 'AI', bValue: '1,000', unit: '篇/天' } },
      { name: '高亮第一项 + 长名字', data: { ...compareDefaults, title: '交付周期', aName: '我们的方案', aValue: '7', bName: '传统外包团队', bValue: '45', unit: '天', highlight: 'a' } },
      { name: '数值不是数字', data: { ...compareDefaults, aName: '以前', aValue: '三天', bName: '现在', bValue: '2', unit: '小时' } },
    ],
  },
  {
    id: 'ring',
    name: '占比环',
    component: RingCard,
    fields: [
      { key: 'label', label: '英文小标签', type: 'text', placeholder: '如 SHARE，可留空' },
      { key: 'value', label: '占比（0–100）', type: 'text', placeholder: '如 40' },
      { key: 'title', label: '标题', type: 'text', placeholder: '如 的用户会复购' },
      { key: 'sub', label: '补充一行（可留空）', type: 'text' },
    ],
    defaults: ringDefaults,
    // 只预填「数字 + %」；「四成」「百分之四十」不猜，留空让他自己填
    fromLine: (text) => ({ value: text.match(/(\d+(?:\.\d+)?)\s*[%％]/)?.[1] || '', title: text }),
    summary: (d) => `${d.value || '?'}%`,
    check: (d) => {
      const n = Number(String(d.value).trim())
      return String(d.value).trim() === '' || !Number.isFinite(n) ? [`占比「${d.value}」不是数字，环画不出来`]
        : n < 0 || n > 100 ? [`占比 ${d.value} 不在 0–100 之间，环画不出来`] : []
    },
    minDuration: () => 3.5,
    keyframes: () => [0.8, 2.2, -0.25],
    fixtures: [
      { name: '常规', data: { ...ringDefaults, label: 'REPURCHASE', value: '40', title: '的用户会复购', sub: '行业平均只有 15%' } },
      { name: '很小', data: { ...ringDefaults, value: '3', title: '的人能坚持一年' } },
      { name: '满格', data: { ...ringDefaults, label: 'DONE', value: '100', title: '全部自动化' } },
      { name: '小数 + 长标题', data: { ...ringDefaults, value: '87.5', title: '的视频在前三秒就被划走了' } },
      { name: '超出 100', data: { ...ringDefaults, value: '300', title: '营收增长' } },
    ],
  },
  {
    id: 'steps',
    name: '步骤流程',
    component: StepsCard,
    fields: [
      { key: 'label', label: '英文小标签', type: 'text', placeholder: '如 WORKFLOW，可留空' },
      { key: 'title', label: '标题', type: 'text', placeholder: '可留空' },
      { key: 'steps', label: `步骤（一行一步，2–${STEPS_MAX} 步）`, type: 'list' },
    ],
    defaults: stepsDefaults,
    fromLine: (text) => ({ title: text, steps: ['', ''] }),
    summary: (d) => d.steps.filter((s: string) => s.trim()).join(' → ') || '步骤',
    check: (d) => {
      const n = d.steps.filter((s: string) => s.trim()).length
      return n < 2 ? ['步骤少于 2 步'] : n > STEPS_MAX ? [`步骤超过 ${STEPS_MAX} 步，横排放不下`] : []
    },
    cueTargets: (d) => filled(d.steps),
    defaultCue: (_d, i) => 0.5 + i * 0.45,
    minDuration: (d) => Math.max(3.5, 0.5 + d.steps.length * 0.45 + 1.5, lastCue(d) + 2),
    keyframes: (d) => [0.5 + 0.45 * 1.2, Math.max(0.5 + d.steps.length * 0.45 + 0.8, lastCue(d) + 1), -0.25],
    fixtures: [
      { name: '常规 2 步', data: { ...stepsDefaults, label: 'ITERATE', title: '反复修改', steps: ['提示词', '输出'] } },
      { name: '3 步', data: { ...stepsDefaults, label: 'WORKFLOW', title: '我的出片流程', steps: ['写稿', '录制', '剪辑'] } },
      { name: '最多 5 步', data: { ...stepsDefaults, title: '从零到发布', steps: ['选题', '写稿', '录制', '剪辑', '发布'] } },
      { name: '长步骤名', data: { ...stepsDefaults, steps: ['整理逐字稿', '自动配动效卡', '导出透明视频'] } },
      { name: '英文开头', data: { ...stepsDefaults, title: '两步搞定', steps: ['AI 生成', 'review 修改'] } },
    ],
  },
  {
    id: 'rightwrong',
    name: '正误对比',
    component: RightWrongCard,
    fields: [
      { key: 'label', label: '英文小标签', type: 'text', placeholder: '如 MYTH，可留空' },
      { key: 'title', label: '标题', type: 'text', placeholder: '可留空' },
      { key: 'wrong', label: '✕ 错误做法', type: 'text' },
      { key: 'right', label: '✓ 正确做法', type: 'text' },
    ],
    defaults: rightWrongDefaults,
    fromLine: (text) => ({ wrong: text }),
    summary: (d) => `✕ ${d.wrong || '?'} ✓ ${d.right || '?'}`,
    check: (d) => [...(!d.wrong.trim() ? ['没填错误做法'] : []), ...(!d.right.trim() ? ['没填正确做法'] : [])],
    minDuration: () => 3.5,
    keyframes: () => [1.15, 2.4, -0.25],
    fixtures: [
      { name: '常规', data: { ...rightWrongDefaults, label: 'MYTH', title: '提示词怎么写', wrong: '越长越好', right: '说清楚要什么' } },
      { name: '无标题', data: { ...rightWrongDefaults, wrong: '换个更贵的模型', right: '先把需求拆小' } },
      { name: '长句', data: { ...rightWrongDefaults, title: '做口播', wrong: '每条视频都从零开始写稿', right: '先攒一个自己的选题库' } },
      { name: '一长一短', data: { ...rightWrongDefaults, wrong: '追热点', right: '做自己真正懂的领域' } },
    ],
  },
  {
    id: 'question',
    name: '提问卡',
    component: QuestionCard,
    fields: [
      { key: 'label', label: '英文小标签', type: 'text', placeholder: '如 WHY，可留空' },
      { key: 'question', label: '问题', type: 'text' },
      { key: 'hint', label: '小字提示（可留空）', type: 'text' },
    ],
    defaults: questionDefaults,
    fromLine: (text) => ({ question: text }),
    summary: (d) => d.question || '?',
    minDuration: (d) => Math.max(3, 0.45 + [...(d.question || '')].length * 0.06 + 1.8),
    keyframes: () => [0.75, 2.4, -0.25],
    fixtures: [
      { name: '常规', data: { ...questionDefaults, label: 'WHY', question: '为什么没人看完？', hint: '问题出在前三秒' } },
      { name: '很短', data: { ...questionDefaults, question: '为什么？' } },
      { name: '最长问题（14 字）', data: { ...questionDefaults, question: '国产模型真的做不出好动效吗？' } },
      { name: '中英混排', data: { ...questionDefaults, label: 'QUESTION', question: 'AI 能替代剪辑师吗？', hint: '先说结论：不能，但能省一半时间' } },
    ],
  },
  {
    id: 'term',
    name: '词语标注',
    component: TermTagCard,
    fields: [
      { key: 'from', label: '普通说法（灰）', type: 'text', placeholder: '如 博主，可留空' },
      { key: 'to', label: '标注的词（框起来）', type: 'text', placeholder: '如 内容创作者' },
    ],
    defaults: termDefaults,
    fromLine: (text) => ({ to: text }),
    summary: (d) => `${d.from ? d.from + ' → ' : ''}【${d.to}】`,
    check: (d) => (!d.to.trim() ? ['没填要标注的词'] : []),
    minDuration: () => 2.5,
    keyframes: () => [0.85, 1.7, -0.2],
    fixtures: [
      { name: '常规', data: { ...termDefaults, from: '博主', to: '内容创作者' } },
      { name: '只有标注', data: { ...termDefaults, to: '语义编排' } },
      { name: '带底板', data: { ...termDefaults, panel: true, from: '剪辑', to: '叙事节奏' } },
      { name: '长词', data: { ...termDefaults, from: '做视频', to: '搭一套可复用的内容工作流' } },
    ],
  },
  {
    id: 'imagegroup',
    name: '图片组',
    component: ImageGroupCard,
    fields: [
      { key: 'kicker', label: '小字（可留空）', type: 'text', placeholder: '如 同一卡库，换模型' },
      { key: 'title', label: '大标题', type: 'text' },
      { key: 'headerImg', label: '标题左边的图标（可留空）', type: 'image' },
      { key: 'items', label: `图片（2–${IMAGE_MAX} 个）`, type: 'imageList', max: IMAGE_MAX },
      { key: 'layout', label: '排法', type: 'select', options: [{ value: 'row', label: '横排（方块）' }, { value: 'stack', label: '错落叠放（横版卡片）' }] },
      { key: 'entrance', label: '入场', type: 'select', options: [{ value: 'pop', label: '依次弹出' }, { value: 'drop', label: '依次落下' }, { value: 'fan', label: '卡堆扇开（按错落叠放画）' }] },
      { key: 'check', label: '每个右上角打 ✓', type: 'bool' },
      { key: 'sourceName', label: '源头卡名字（可留空，填了就显示）', type: 'text', placeholder: '如 Opus 原版卡' },
      { key: 'sourceImg', label: '源头卡图标（可留空）', type: 'image' },
    ],
    defaults: imageGroupDefaults,
    fromLine: (text) => ({ title: text, items: [{ img: '', name: '' }, { img: '', name: '' }] }),
    summary: (d) => `▦ ${d.title || '图片组'} · ${d.items.length} 张`,
    // 缺图 / 张数不对都要说：缺图的位置是一个虚线框，导出出来就是一个「待上传」
    check: (d) => {
      const missing = d.items.map((it: { img: string }, i: number) => (it.img ? 0 : i + 1)).filter(Boolean)
      return [
        ...(d.items.length < 2 ? ['图片少于 2 个'] : d.items.length > IMAGE_MAX ? [`图片超过 ${IMAGE_MAX} 个，横排放不下`] : []),
        ...(missing.length ? [`第 ${missing.join('、')} 个还没上传图片`] : []),
        // 扇开是整叠一起动的：设了逐张时间也不生效，要说出来（不然他调了半天菱形，画面一点没变）
        ...(d.entrance === 'fan' && lastCue(d) > 0 ? ['卡堆扇开是整叠一起动的，逐张出现时间不生效'] : []),
      ]
    },
    // 空位也占一个下标（和 ImageGroupCard 的 arrive(i) 一致）；没起名字的按字幕找不到，保持默认节奏
    cueTargets: (d) => (d.items || []).map((it: { name?: string }, i: number) => it?.name?.trim() || `第 ${i + 1} 张（没起名字）`),
    defaultCue: (d, i) => igArrive(d, i),
    minDuration: (d) => (d.entrance === 'fan' ? FAN_END + 1.4 : Math.max(3.5, igArrive(d, d.items.length) + 1.8, lastCue(d) + 2)),
    // 扇开：「入场中」拍在扇开停住那一拍
    keyframes: (d) => (d.entrance === 'fan' ? [FAN_AT + 0.9, FAN_END + 0.5, -0.25] : [igArrive(d, 1) + 0.15, Math.max(igArrive(d, d.items.length) + 1.1, lastCue(d) + 1.2), -0.25]),
    fixtures: [
      { name: '常规 3 个 + 图标', data: { ...imageGroupDefaults, kicker: '同一卡库，换模型', title: '预制动效', headerImg: LOGOS[3], items: [{ img: LOGOS[0], name: '豆包' }, { img: LOGOS[1], name: 'WorkBuddy' }, { img: LOGOS[2], name: 'GPT' }] } },
      { name: '最少 2 个、不打勾', data: { ...imageGroupDefaults, title: '两种方案', check: false, items: [{ img: LOGOS[0], name: '方案 A' }, { img: LOGOS[4], name: '方案 B' }] } },
      { name: '最多 5 个', data: { ...imageGroupDefaults, kicker: '本片用到的工具', title: '工具清单', items: LOGOS.map((img, i) => ({ img, name: ['剪映', 'Figma', 'GPT', 'Kimi', 'MJ'][i] })) } },
      { name: '有一个没上传', data: { ...imageGroupDefaults, title: '支持的模型', items: [{ img: LOGOS[0], name: '豆包' }, { img: '', name: '待定' }, { img: LOGOS[2], name: 'GPT' }] } },
      { name: '长名字', data: { ...imageGroupDefaults, title: '合作伙伴', items: [{ img: LOGOS[1], name: 'WorkBuddy Pro' }, { img: LOGOS[3], name: '某某科技有限公司' }] } },
      { name: '错落叠放 + 落下 + 源头卡', data: { ...imageGroupDefaults, layout: 'stack', entrance: 'drop', check: false, sourceName: 'Opus 原版卡', sourceImg: LOGOS[4], items: [{ img: SHOT, name: 'Opus 动效卡' }, { img: SHOT, name: 'Opus 动效卡' }] } },
      { name: '横排 + 依次落下', data: { ...imageGroupDefaults, entrance: 'drop', kicker: '同一卡库，换模型', title: '预制动效', items: [{ img: LOGOS[0], name: '豆包' }, { img: LOGOS[1], name: 'WorkBuddy' }, { img: LOGOS[2], name: 'GPT' }] } },
      { name: '卡堆扇开 5 张', data: { ...imageGroupDefaults, entrance: 'fan', title: '一次出五张', check: false, items: [1, 2, 3, 4, 5].map((n) => ({ img: SHOT, name: `版本 ${n}` })) } },
      { name: '卡堆扇开 2 张 + 打勾', data: { ...imageGroupDefaults, entrance: 'fan', items: [1, 2].map((n) => ({ img: SHOT, name: `方案 ${n}` })) } },
      { name: '叠放 4 张 + 弹出', data: { ...imageGroupDefaults, layout: 'stack', title: '一次出四张', items: [1, 2, 3, 4].map((n) => ({ img: SHOT, name: `版本 ${n}` })) } },
    ],
  },
  {
    id: 'stamp',
    name: '印章',
    component: StampCard,
    fields: [
      { key: 'text', label: '章上的字（2–8 个字 / 一个英文词）', type: 'text' },
      { key: 'sub', label: '下面一行小字（可留空）', type: 'text', placeholder: '如 动效包装' },
      { key: 'tilt', label: '倾斜', type: 'select', options: [{ value: '-8', label: '左倾（大）' }, { value: '-6', label: '左倾' }, { value: '0', label: '不倾斜' }, { value: '6', label: '右倾' }, { value: '8', label: '右倾（大）' }] },
    ],
    defaults: stampDefaults,
    fromLine: (text) => ({ text }),
    summary: (d) => `⬚ ${d.text}`,
    check: (d) => {
      const n = [...(d.text || '')].length
      return !n ? ['没填章上的字'] : n > 10 ? [`章上有 ${n} 个字，超过 8 个字会很长、不像章`] : []
    },
    minDuration: () => 2.8,
    keyframes: () => [0.34, 1.6, -0.2],
    fixtures: [
      { name: '英文', data: { ...stampDefaults, text: 'A-roll', sub: '动效包装' } },
      { name: '中文两字', data: { ...stampDefaults, text: '必看', tilt: '6' } },
      { name: '最长（8 字）', data: { ...stampDefaults, text: '本期最重要的一点', sub: 'KEY POINT' } },
      { name: '不倾斜 + 改强调色', data: { ...stampDefaults, text: 'NEW', tilt: '0', accent: '#3DDC97' } },
    ],
  },
  {
    id: 'beforeafter',
    name: '前后变化',
    component: BeforeAfterCard,
    fields: [
      { key: 'label', label: '英文小标签', type: 'text', placeholder: '可留空' },
      { key: 'title', label: '标题', type: 'text', placeholder: '可留空，如 团队规模' },
      { key: 'before', label: '以前的数', type: 'text' },
      { key: 'after', label: '现在的数', type: 'text' },
      { key: 'unit', label: '单位', type: 'text', placeholder: '人 / 万 / %' },
      { key: 'beforeLabel', label: '左边小字', type: 'text' },
      { key: 'afterLabel', label: '右边小字', type: 'text' },
    ],
    defaults: beforeAfterDefaults,
    fromLine: (text) => { const [a = '', b = ''] = numsIn(text); return { title: '', before: a, after: b } },
    summary: (d) => `${d.before || '?'} → ${d.after || '?'}${d.unit}`,
    check: (d) => [...(!isNum(d.before) ? [`以前的数「${d.before}」不是数字，不会跳数`] : []), ...(!isNum(d.after) ? [`现在的数「${d.after}」不是数字，不会跳数`] : [])],
    minDuration: () => 3.5,
    keyframes: () => [0.9, 2.4, -0.25],
    fixtures: [
      { name: '常规', data: { ...beforeAfterDefaults, label: 'TEAM', title: '团队规模', before: '12', after: '86', unit: '人' } },
      { name: '千分位 + 改小字', data: { ...beforeAfterDefaults, before: '1,200', after: '36,000', unit: '粉丝', beforeLabel: '开号时', afterLabel: '三个月后' } },
      { name: '变少（降本）', data: { ...beforeAfterDefaults, title: '单条成本', before: '3', after: '0.5', unit: '天' } },
      { name: '不是数字', data: { ...beforeAfterDefaults, before: '三天', after: '两小时' } },
    ],
  },
  {
    id: 'ranking',
    name: '排行榜',
    component: RankingCard,
    fields: [
      { key: 'label', label: '英文小标签', type: 'text', placeholder: '如 TOP 3，可留空' },
      { key: 'title', label: '标题', type: 'text' },
      { key: 'items', label: '名次（一行一个，第一行 = 第 1 名，2–5 个）', type: 'list' },
      { key: 'highlight', label: '突出第几名', type: 'select', options: ['1', '2', '3', '4', '5'].map((v) => ({ value: v, label: `第 ${v} 名` })) },
    ],
    defaults: rankingDefaults,
    fromLine: (text) => ({ title: text, items: ['', '', ''] }),
    summary: (d) => `🏆 ${d.title || '排行'} · ${filled(d.items).length} 名`,
    check: (d) => {
      const n = filled(d.items).length
      return [...(n < 2 ? ['名次少于 2 个'] : n > 5 ? ['名次超过 5 个，放不下'] : []), ...(Number(d.highlight) > n ? [`要突出第 ${d.highlight} 名，但只有 ${n} 名`] : [])]
    },
    // 揭晓顺序是从最后一名往前，cues 也按这个顺序（见 RankingCard）
    cueTargets: (d) => [...filled(d.items)].reverse(),
    defaultCue: (_d, k) => 0.5 + k * 0.4,
    minDuration: (d) => Math.max(3.5, 0.5 + filled(d.items).length * 0.4 + 1.5, lastCue(d) + 1.6),
    keyframes: (d) => [0.5 + 0.4 * 1.2, Math.max(0.5 + filled(d.items).length * 0.4 + 0.8, lastCue(d) + 0.8), -0.25],
    fixtures: [
      { name: '常规 3 名', data: { ...rankingDefaults, label: 'TOP 3', title: '最常用的剪辑软件', items: ['剪映', 'Premiere', '达芬奇'] } },
      { name: '5 名 + 突出第 2', data: { ...rankingDefaults, title: '涨粉最快的内容', items: ['干货教程', '日常 vlog', '测评', '剧情', '直播切片'], highlight: '2' } },
      { name: '长条目', data: { ...rankingDefaults, title: '用户最在意', items: ['出片速度要足够快', '模板好看不土', '价格'] } },
    ],
  },
  {
    id: 'timeline',
    name: '时间线',
    component: TimelineCard,
    fields: [
      { key: 'label', label: '英文小标签', type: 'text', placeholder: '如 MILESTONES，可留空' },
      { key: 'title', label: '标题', type: 'text', placeholder: '可留空' },
      { key: 'events', label: '节点（一行一个：年份 事件，2–5 个）', type: 'list' },
    ],
    defaults: timelineDefaults,
    fromLine: (text) => ({ title: text, events: ['', ''] }),
    summary: (d) => `⟶ ${filled(d.events).map((e: string) => e.split(/\s/)[0]).join(' · ') || '时间线'}`,
    check: (d) => {
      const ev = filled(d.events)
      const noText = ev.filter((e: string) => !/\S+\s+\S/.test(e.trim()) && !/^\d{2,4}年\S/.test(e.trim()))
      return [...(ev.length < 2 ? ['节点少于 2 个'] : ev.length > 5 ? ['节点超过 5 个，横排放不下'] : []), ...(noText.length ? [`「${noText[0]}」要写成「年份 事件」（中间空一格）`] : [])]
    },
    cueTargets: (d) => filled(d.events),
    defaultCue: (_d, i) => 0.55 + i * 0.45,
    minDuration: (d) => Math.max(3.5, 0.55 + filled(d.events).length * 0.45 + 1.5, lastCue(d) + 2),
    keyframes: (d) => [0.55 + 0.45 * 1.2, Math.max(0.55 + filled(d.events).length * 0.45 + 0.8, lastCue(d) + 1), -0.25],
    fixtures: [
      { name: '常规 3 个', data: { ...timelineDefaults, label: 'MILESTONES', title: '我们这三年', events: ['2022 开始做口播', '2023 签下第一个品牌', '2024 团队 30 人'] } },
      { name: '「年」字写法', data: { ...timelineDefaults, events: ['2019年创立', '2021年融资', '2024年上市'] } },
      { name: '最多 5 个', data: { ...timelineDefaults, title: '一条视频的一天', events: ['9:00 选题', '10:00 写稿', '14:00 录制', '16:00 剪辑', '20:00 发布'] } },
      { name: '没写事件', data: { ...timelineDefaults, events: ['2020', '2024 爆发'] } },
    ],
  },
  {
    id: 'quote',
    name: '引用卡',
    component: QuoteCard,
    fields: [
      { key: 'quote', label: '引文', type: 'text' },
      { key: 'source', label: '出处（可留空）', type: 'text', placeholder: '如 —— 巴菲特' },
    ],
    defaults: quoteDefaults,
    fromLine: (text) => ({ quote: text }),
    summary: (d) => `“${[...(d.quote || '')].slice(0, 8).join('')}”`,
    check: (d) => (!d.quote.trim() ? ['没填引文'] : [...d.quote].length > 40 ? [`引文 ${[...d.quote].length} 字，超过 40 字会很挤`] : []),
    minDuration: (d) => Math.max(3.5, 1.6 + [...(d.quote || '')].length * 0.08),
    keyframes: () => [0.6, 2.2, -0.25],
    fixtures: [
      { name: '常规', data: { ...quoteDefaults, quote: '别人恐惧时我贪婪', source: '—— 巴菲特' } },
      { name: '两行长引文', data: { ...quoteDefaults, quote: '你不需要很厉害才能开始，但你需要开始才能很厉害', source: '—— 齐格·金克拉' } },
      { name: '没有出处', data: { ...quoteDefaults, quote: '内容是长期主义的复利' } },
    ],
  },
  {
    id: 'define',
    name: '名词解释',
    component: DefineCard,
    fields: [
      { key: 'term', label: '名词', type: 'text' },
      { key: 'en', label: '英文 / 拼音（可留空）', type: 'text', placeholder: '如 A-ROLL' },
      { key: 'definition', label: '解释（摘说话人自己的解释）', type: 'text' },
    ],
    defaults: defineDefaults,
    fromLine: (text) => ({ definition: text }),
    summary: (d) => `📖 ${d.term || '名词'}`,
    check: (d) => [...(!d.term.trim() ? ['没填名词'] : []), ...(!d.definition.trim() ? ['没填解释'] : []), ...([...(d.definition || '')].length > 50 ? ['解释超过 50 字会很挤'] : [])],
    minDuration: () => 4,
    keyframes: () => [0.7, 2.4, -0.25],
    fixtures: [
      { name: '常规', data: { ...defineDefaults, term: 'A-roll', en: 'MAIN FOOTAGE', definition: '口播主画面，就是你对着镜头说话的那一段' } },
      { name: '中文名词 + 长解释', data: { ...defineDefaults, term: '完播率', en: 'COMPLETION RATE', definition: '看完整条视频的人占所有点进来的人的比例，平台用它判断内容值不值得继续推' } },
      { name: '没英文', data: { ...defineDefaults, term: '语义编排', definition: '按说话的意思来安排画面，而不是按时间平均切' } },
    ],
  },
  {
    id: 'pictogram',
    name: '象形图',
    component: PictogramCard,
    fields: [
      { key: 'label', label: '英文小标签', type: 'text', placeholder: '可留空' },
      { key: 'title', label: '标题', type: 'text', placeholder: '可留空' },
      { key: 'value', label: '点亮几个', type: 'text', placeholder: '如 3' },
      { key: 'total', label: '一共几个（最多 100，超过 20 画成点阵）', type: 'text', placeholder: '如 10' },
      { key: 'caption', label: '分数下面一行（可留空）', type: 'text', placeholder: '如 会坚持看完' },
      { key: 'icon', label: '图标', type: 'select', options: [{ value: 'person', label: '小人' }, { value: 'dot', label: '圆点' }] },
    ],
    defaults: pictogramDefaults,
    fromLine: (text) => { const [a = '', b = ''] = numsIn(text); return { title: text, total: a || '10', value: b } },
    summary: (d) => `${d.value || '?'}/${d.total || '?'}`,
    check: (d) => {
      const v = Number(d.value), n = Number(d.total)
      return !isNum(d.value) || !isNum(d.total) ? ['点亮个数和总数都要是数字，画不出来']
        : n > 100 ? [`总数 ${n} 超过 100，放不下（可以换算成「100 个里有几个」）`] : v > n ? [`点亮 ${v} 个比总数 ${n} 还多`] : []
    },
    minDuration: (d) => { const g = pgOf(d); return Math.max(3.5, g.light + g.v * g.step + 1.6) },
    keyframes: (d) => { const g = pgOf(d); return [g.light - 0.3, g.light + g.v * g.step + 0.6, -0.25] },
    fixtures: [
      { name: '10 个里 3 个', data: { ...pictogramDefaults, label: 'RETENTION', title: '每 10 个观众', value: '3', total: '10', caption: '会看完' } },
      { name: '20 个圆点', data: { ...pictogramDefaults, title: '20 条视频里', value: '1', total: '20', caption: '能爆一条', icon: 'dot' } },
      { name: '全亮', data: { ...pictogramDefaults, value: '5', total: '5', caption: '全部好评' } },
      { name: '100 格点阵', data: { ...pictogramDefaults, label: 'SWIPE AWAY', title: '每 100 个观众', value: '37', total: '100', caption: '前三秒划走' } },
      { name: '30 格 + 全亮', data: { ...pictogramDefaults, title: '30 天', value: '30', total: '30', caption: '天天更新' } },
      { name: '超过 100', data: { ...pictogramDefaults, value: '30', total: '1000' } },
    ],
  },
  {
    id: 'bubbles',
    name: '气泡逐条',
    component: BubbleCard,
    fields: [
      { key: 'label', label: '英文小标签', type: 'text', placeholder: '如 PAIN POINTS，可留空' },
      { key: 'items', label: '气泡（一行一条，2–4 条）', type: 'list' },
    ],
    defaults: bubbleDefaults,
    fromLine: (text) => ({ items: [text, ''] }),
    summary: (d) => `💬 ${filled(d.items).length} 条`,
    check: (d) => { const n = filled(d.items).length; return n < 2 ? ['气泡少于 2 条'] : n > 4 ? ['气泡超过 4 条，画面会很挤'] : [] },
    cueTargets: (d) => filled(d.items),
    defaultCue: (_d, i) => 0.4 + i * 0.55,
    minDuration: (d) => Math.max(3.5, 0.4 + filled(d.items).length * 0.55 + 1.4, lastCue(d) + 1.6),
    keyframes: (d) => [0.4 + 0.55 * 0.8, Math.max(0.4 + filled(d.items).length * 0.55 + 0.6, lastCue(d) + 0.8), -0.25],
    fixtures: [
      { name: '常规 2 条', data: { ...bubbleDefaults, label: 'PAIN POINTS', items: ['提示词改一版又一版', '出来的效果总是差一点'] } },
      { name: '4 条', data: { ...bubbleDefaults, items: ['选题想不出来', '写稿写不下去', '录了十几遍', '剪辑到半夜'] } },
      { name: '长气泡', data: { ...bubbleDefaults, items: ['每次换模型都要重新调一遍提示词', '同一个提示词今天和明天出来的不一样'] } },
    ],
  },
  {
    id: 'lowerthird',
    name: '人名条',
    component: LowerThirdCard,
    fields: [
      { key: 'name', label: '名字', type: 'text' },
      { key: 'role', label: '头衔 / 机构（可留空）', type: 'text', placeholder: '如 某某科技 创始人' },
    ],
    defaults: lowerThirdDefaults,
    // 不从字幕预填：名字和头衔要他自己写（AI 也不配这张卡）
    fromLine: () => ({}),
    summary: (d) => `👤 ${d.name || '人名'}`,
    check: (d) => (!d.name.trim() ? ['没填名字'] : []),
    minDuration: () => 3,
    keyframes: () => [0.45, 1.6, -0.2],
    fixtures: [
      { name: '常规', data: { ...lowerThirdDefaults, name: '张小鱼', role: '口播博主 · 10 万粉' } },
      { name: '长头衔 + 底板', data: { ...lowerThirdDefaults, panel: true, name: 'Alex Chen', role: '某某科技有限公司 联合创始人 & CTO' } },
      { name: '只有名字', data: { ...lowerThirdDefaults, name: '李老师' } },
    ],
  },
  {
    id: 'search',
    name: '搜索框',
    component: SearchCard,
    fields: [
      { key: 'hint', label: '上方一行小字（可留空）', type: 'text', placeholder: '如 第一招' },
      { key: 'query', label: '搜索词', type: 'text' },
      { key: 'results', label: '搜索结果（可留空，一行一条，只写原话里说了的）', type: 'list' },
    ],
    defaults: searchDefaults,
    fromLine: (text) => ({ query: text.match(/搜(?:一下|索)?\s*(.+)$/)?.[1] || text }),
    summary: (d) => `🔍 ${d.query}`,
    check: (d) => (!d.query.trim() ? ['没填搜索词'] : len(d.query) > 14 ? ['搜索词超过 14 字，打字会很长'] : []),
    minDuration: (d) => Math.max(3.2, 0.5 + len(d.query) * 0.11 + 0.6 + filled(d.results).length * 0.22 + 1.2),
    keyframes: (d) => [0.5 + len(d.query) * 0.06, 0.5 + len(d.query) * 0.11 + 0.9 + filled(d.results).length * 0.22, -0.25],
    fixtures: [
      { name: '常规', data: { ...searchDefaults, hint: '第一招 · 画面切换', query: '转场', results: ['速度感', '呼啸感', '穿梭感'] } },
      { name: '只有搜索词', data: { ...searchDefaults, query: 'AI 口播动效' } },
      { name: '长搜索词', data: { ...searchDefaults, query: '口播视频怎么做出高级感' } },
    ],
  },
  {
    id: 'notify',
    name: '手机通知',
    component: NotifyCard,
    fields: [
      { key: 'app', label: 'App 名', type: 'text', placeholder: '如 微信' },
      { key: 'icon', label: 'App 图标（可留空）', type: 'image' },
      { key: 'title', label: '标题（可留空）', type: 'text' },
      { key: 'body', label: '正文', type: 'text' },
    ],
    defaults: notifyDefaults,
    fromLine: (text) => ({ body: text }),
    summary: (d) => `🔔 ${d.title || d.body}`,
    check: (d) => (!d.body.trim() ? ['没填正文'] : len(d.body) > 40 ? ['正文超过 40 字会很挤'] : []),
    minDuration: () => 3,
    keyframes: () => [0.3, 1.6, -0.25],
    fixtures: [
      { name: '常规', data: { ...notifyDefaults, app: '微信', title: '客户', body: '你上次做的那条视频爆了，再来一条？' } },
      { name: '只有正文', data: { ...notifyDefaults, app: '抖音', body: '你的作品已获得 10 万次播放' } },
    ],
  },
  {
    id: 'chat',
    name: '聊天对话',
    component: ChatCard,
    fields: [
      { key: 'name', label: '对方名字', type: 'text', placeholder: '如 客户' },
      { key: 'messages', label: '消息（一行一条，「我：」开头的是我说的，2–5 条）', type: 'list' },
    ],
    defaults: chatDefaults,
    fromLine: (text) => ({ messages: [text, '我：'] }),
    summary: (d) => `💬 ${d.name || '对话'} · ${filled(d.messages).length} 条`,
    check: (d) => { const n = filled(d.messages).length; return n < 2 ? ['消息少于 2 条'] : n > 5 ? ['消息超过 5 条，窗口会很长'] : [] },
    // 按字幕找的是去掉「我：」之后的那句话；默认时刻和 ChatCard 一致（对方的消息晚 0.35 秒，前面是「正在输入」）
    cueTargets: (d) => filled(d.messages).map((m) => m.trim().replace(/^(我|对方)\s*[:：]\s*/, '')),
    defaultCue: (d, i) => 0.5 + i * 0.75 + (/^我\s*[:：]/.test(filled(d.messages)[i]?.trim() || '') ? 0 : 0.35),
    minDuration: (d) => Math.max(3.5, 0.5 + filled(d.messages).length * 0.75 + 1.2, lastCue(d) + 1.6),
    keyframes: (d) => [0.5 + 0.75 * 0.5, Math.max(0.5 + filled(d.messages).length * 0.75 + 0.5, lastCue(d) + 0.8), -0.25],
    fixtures: [
      { name: '常规', data: { ...chatDefaults, name: '客户', messages: ['这条视频能不能再加点动效？', '我：可以，十分钟搞定', '这么快？'] } },
      { name: '长消息', data: { ...chatDefaults, name: 'AI 助手', messages: ['我：帮我写一个开场白，要有悬念', '好的：「你的口播视频，可能一开始就输了。」'] } },
    ],
  },
  {
    id: 'terminal',
    name: '终端',
    component: TerminalCard,
    fields: [
      { key: 'title', label: '窗口标题', type: 'text' },
      { key: 'lines', label: '内容（一行一条，「$ 」开头的会逐字打出来）', type: 'list' },
    ],
    defaults: terminalDefaults,
    fromLine: (text) => ({ lines: [`$ ${text}`] }),
    summary: (d) => `▍${filled(d.lines)[0] || '终端'}`,
    check: (d) => (filled(d.lines).length ? [] : ['没填内容']),
    minDuration: (d) => Math.max(3, 0.5 + filled(d.lines).reduce((n: number, l: string) => n + (/^\$/.test(l) ? len(l) * 0.045 : 0.15) + 0.25, 0) + 1.2),
    keyframes: (d) => [0.9, 0.6 + filled(d.lines).reduce((n: number, l: string) => n + (/^\$/.test(l) ? len(l) * 0.045 : 0.15) + 0.25, 0) + 0.3, -0.25],
    fixtures: [
      { name: '提示词', data: { ...terminalDefaults, title: 'claude', lines: ['$ 帮我把这段口播配上动效卡', '已识别 35 句字幕', '已配 9 张卡 ✓'] } },
      { name: '命令', data: { ...terminalDefaults, lines: ['$ npm run export', 'rendering 90 frames...', 'done in 9.7s'] } },
    ],
  },
  {
    id: 'window',
    name: '窗口截图',
    component: WindowCard,
    fields: [
      { key: 'img', label: '截图', type: 'image' },
      { key: 'style', label: '外壳', type: 'select', options: [{ value: 'browser', label: '浏览器（带地址栏）' }, { value: 'app', label: 'App 窗口（带标题）' }] },
      { key: 'url', label: '地址 / 窗口标题', type: 'text', placeholder: '如 qiaonx.com' },
      { key: 'caption', label: '下面一行说明（可留空）', type: 'text' },
    ],
    defaults: windowDefaults,
    fromLine: (text) => ({ caption: text }),
    summary: (d) => `🗔 ${d.caption || d.url || '窗口'}`,
    check: (d) => (d.img ? [] : ['还没上传截图']),
    minDuration: () => 3.5,
    keyframes: () => [0.4, 1.8, -0.25],
    fixtures: [
      { name: '浏览器', data: { ...windowDefaults, img: SHOT, url: 'qiaonx.com/broll', caption: '十分钟出一条动效口播' } },
      { name: 'App 窗口', data: { ...windowDefaults, img: SHOT, style: 'app', url: '剪映专业版' } },
      { name: '没上传', data: { ...windowDefaults, url: 'example.com' } },
    ],
  },
  {
    id: 'click',
    name: '点击按钮',
    component: ClickCard,
    fields: [
      { key: 'button', label: '按钮上的字', type: 'text' },
      { key: 'result', label: '点完之后旁边一行（可留空）', type: 'text', placeholder: '如 已开启' },
    ],
    defaults: clickDefaults,
    fromLine: (text) => ({ button: text }),
    summary: (d) => `🖱 ${d.button}`,
    check: (d) => (!d.button.trim() ? ['没填按钮上的字'] : len(d.button) > 10 ? ['按钮上的字超过 10 个'] : []),
    minDuration: () => 3,
    keyframes: () => [0.9, 2, -0.25],
    fixtures: [
      { name: '常规', data: { ...clickDefaults, button: 'AI 配卡', result: '已配 9 张' } },
      { name: '只有按钮', data: { ...clickDefaults, button: '开启自动字幕' } },
    ],
  },
  {
    id: 'danmaku',
    name: '弹幕',
    component: DanmakuCard,
    fields: [
      { key: 'items', label: '弹幕（一行一条）', type: 'list' },
      { key: 'mock', label: '显示「示意」小标（不是真实评论时一定要开）', type: 'bool' },
    ],
    defaults: danmakuDefaults,
    fromLine: () => ({ items: ['', '', ''] }),
    summary: (d) => `≋ 弹幕 ${filled(d.items).length} 条`,
    check: (d) => [...(filled(d.items).length < 2 ? ['弹幕少于 2 条'] : []), ...(!d.mock ? ['关掉了「示意」：确认这些是真实评论'] : [])],
    minDuration: (d) => Math.max(3.5, 0.15 + filled(d.items).length * 0.45 + 2.5),
    keyframes: () => [0.8, 1.8, -0.25],
    fixtures: [
      { name: '常规', data: { ...danmakuDefaults, items: ['学到了', '这个转场绝了', '求教程', '已关注', '收藏了慢慢看', '666'] } },
    ],
  },
  {
    id: 'post',
    name: '社交帖子',
    component: PostCard,
    fields: [
      { key: 'user', label: '用户名', type: 'text' },
      { key: 'avatar', label: '头像（可留空）', type: 'image' },
      { key: 'text', label: '正文', type: 'text' },
      { key: 'img', label: '配图（可留空）', type: 'image' },
      { key: 'likes', label: '点赞数', type: 'text', placeholder: '如 12800' },
      { key: 'comments', label: '评论数（可留空）', type: 'text' },
      { key: 'mock', label: '显示「示意」小标（不是真实帖子时一定要开）', type: 'bool' },
    ],
    defaults: postDefaults,
    fromLine: (text) => ({ text }),
    summary: (d) => `♥ ${d.user || '帖子'}`,
    check: (d) => [...(!d.text.trim() ? ['没填正文'] : []), ...(!d.mock ? ['关掉了「示意」：确认这是真实帖子和真实数据'] : [])],
    minDuration: () => 3.5,
    keyframes: () => [0.9, 2.3, -0.25],
    fixtures: [
      { name: '常规', data: { ...postDefaults, user: '剪辑小白', text: '跟着做了一条，第一次破万播放！', likes: '12800', comments: '326' } },
      { name: '带配图', data: { ...postDefaults, user: 'Alex', text: '这套动效卡太省事了', img: SHOT, likes: '980' } },
    ],
  },
  {
    id: 'barchart',
    name: '柱状图',
    component: BarChartCard,
    fields: [
      { key: 'label', label: '英文小标签', type: 'text', placeholder: '可留空' },
      { key: 'title', label: '标题', type: 'text' },
      { key: 'rows', label: '柱子（一行一个：名字 数值，3–6 个）', type: 'list' },
      { key: 'unit', label: '单位', type: 'text' },
    ],
    defaults: chartDefaults,
    fromLine: (text) => ({ title: text, rows: ['', '', ''] }),
    summary: (d) => `▥ ${d.title || '柱状图'}`,
    check: (d) => {
      const n = filled(d.rows).length, bad = badRows(d.rows)
      return [...(n < 2 ? ['柱子少于 2 根'] : n > 6 ? ['柱子超过 6 根，放不下'] : []), ...(bad.length ? [`「${bad[0]}」要写成「名字 数值」，数值是数字`] : [])]
    },
    // 按字幕找的是柱子的名字（「抖音 300」找「抖音」）
    cueTargets: (d) => filled(d.rows).map((r) => r.trim().replace(/\s+[\d,.]+$/, '')),
    defaultCue: (_d, i) => 0.5 + i * 0.18,
    minDuration: (d) => Math.max(3.5, 0.5 + filled(d.rows).length * 0.18 + 2, lastCue(d) + 2),
    keyframes: (d) => [0.9, Math.max(0.5 + filled(d.rows).length * 0.18 + 1.2, lastCue(d) + 1.2), -0.25],
    fixtures: [
      { name: '常规 4 根', data: { ...chartDefaults, label: 'VIEWS', title: '四个平台的播放量', rows: ['抖音 120', '视频号 45', '小红书 30', 'B站 18'], unit: '万' } },
      { name: '6 根 + 小数', data: { ...chartDefaults, title: '每月涨粉', rows: ['1月 0.8', '2月 1.2', '3月 2.5', '4月 3.1', '5月 4.6', '6月 7.9'], unit: '万' } },
      { name: '写错格式', data: { ...chartDefaults, rows: ['抖音 很多', '视频号 45'] } },
    ],
  },
  {
    id: 'linechart',
    name: '折线趋势',
    component: LineChartCard,
    fields: [
      { key: 'label', label: '英文小标签', type: 'text', placeholder: '如 TREND，可留空' },
      { key: 'title', label: '标题', type: 'text' },
      { key: 'rows', label: '点（一行一个：标签 数值，3–8 个）', type: 'list' },
      { key: 'unit', label: '单位', type: 'text' },
    ],
    defaults: chartDefaults,
    fromLine: (text) => ({ title: text, rows: ['', '', ''] }),
    summary: (d) => `📈 ${d.title || '趋势'}`,
    check: (d) => {
      const n = filled(d.rows).length, bad = badRows(d.rows)
      return [...(n < 3 ? ['点少于 3 个，看不出趋势'] : n > 8 ? ['点超过 8 个，标签会挤'] : []), ...(bad.length ? [`「${bad[0]}」要写成「标签 数值」，数值是数字`] : [])]
    },
    minDuration: () => 3.8,
    keyframes: () => [1.1, 2.6, -0.25],
    fixtures: [
      { name: '上涨', data: { ...chartDefaults, label: 'TREND', title: '半年涨粉', rows: ['1月 2', '2月 3.5', '3月 3', '4月 6', '5月 9', '6月 15'], unit: '万' } },
      { name: '先跌后涨', data: { ...chartDefaults, title: '完播率', rows: ['改版前 32', '第1周 25', '第2周 38', '第3周 51'], unit: '%' } },
    ],
  },
  {
    id: 'progress',
    name: '进度条',
    component: ProgressCard,
    fields: [
      { key: 'label', label: '英文小标签', type: 'text', placeholder: '如 GOAL，可留空' },
      { key: 'title', label: '标题', type: 'text' },
      { key: 'current', label: '已完成', type: 'text' },
      { key: 'target', label: '目标', type: 'text' },
      { key: 'unit', label: '单位', type: 'text' },
    ],
    defaults: progressDefaults,
    fromLine: (text) => { const [a = '', b = ''] = numsIn(text); return { title: text, target: a, current: b } },
    summary: (d) => `▰ ${d.current || '?'}/${d.target || '?'}`,
    check: (d) => (!isNum(d.current) || !isNum(d.target) || Number(String(d.target).replace(/,/g, '')) <= 0 ? ['已完成和目标都要是数字（目标大于 0），进度画不出来'] : []),
    minDuration: () => 3.5,
    keyframes: () => [1.1, 2.4, -0.25],
    fixtures: [
      { name: '常规', data: { ...progressDefaults, label: 'GOAL', title: '今年目标', current: '70', target: '100', unit: '万' } },
      { name: '超额', data: { ...progressDefaults, title: '众筹', current: '1,520', target: '1,000', unit: '人' } },
    ],
  },
  {
    id: 'gauge',
    name: '评分仪表盘',
    component: GaugeCard,
    fields: [
      { key: 'label', label: '英文小标签', type: 'text', placeholder: '如 SCORE，可留空' },
      { key: 'title', label: '标题', type: 'text', placeholder: '可留空' },
      { key: 'score', label: '分数', type: 'text' },
      { key: 'max', label: '满分', type: 'text' },
      { key: 'caption', label: '下面一行（可留空）', type: 'text' },
    ],
    defaults: gaugeDefaults,
    fromLine: (text) => ({ title: text, score: numsIn(text)[0] || '' }),
    summary: (d) => `◔ ${d.score || '?'}/${d.max}`,
    check: (d) => {
      const s = Number(d.score), m = Number(d.max)
      return !isNum(d.score) || !isNum(d.max) || m <= 0 ? ['分数和满分都要是数字'] : s > m ? [`分数 ${s} 比满分 ${m} 还高，指针会顶满`] : []
    },
    minDuration: () => 3.5,
    keyframes: () => [1.0, 2.3, -0.25],
    fixtures: [
      { name: '常规', data: { ...gaugeDefaults, label: 'SCORE', title: '我的评分', score: '8.5', max: '10', caption: '值得一试' } },
      { name: '百分制', data: { ...gaugeDefaults, title: '性价比', score: '92', max: '100' } },
      { name: '低分', data: { ...gaugeDefaults, score: '3', max: '10', caption: '不推荐' } },
    ],
  },
  {
    id: 'price',
    name: '价格对比',
    component: PriceCard,
    fields: [
      { key: 'label', label: '英文小标签', type: 'text', placeholder: '如 SALE，可留空' },
      { key: 'title', label: '标题', type: 'text', placeholder: '可留空' },
      { key: 'currency', label: '货币符号', type: 'text' },
      { key: 'oldPrice', label: '原价', type: 'text' },
      { key: 'newPrice', label: '现价', type: 'text' },
      { key: 'tag', label: '标签（留空 = 自动算「立省 xx」）', type: 'text' },
    ],
    defaults: priceDefaults,
    fromLine: (text) => { const [a = '', b = ''] = numsIn(text); return { oldPrice: a, newPrice: b } },
    summary: (d) => `${d.currency}${d.oldPrice || '?'}→${d.currency}${d.newPrice || '?'}`,
    check: (d) => (!isNum(d.oldPrice) || !isNum(d.newPrice) ? ['原价和现价都要是数字'] : []),
    minDuration: () => 3.2,
    keyframes: () => [0.9, 2.1, -0.25],
    fixtures: [
      { name: '常规', data: { ...priceDefaults, label: 'SALE', oldPrice: '999', newPrice: '199' } },
      { name: '自定义标签', data: { ...priceDefaults, title: '会员价', oldPrice: '68', newPrice: '29.9', tag: '限时 4 折' } },
    ],
  },
  {
    id: 'countdown',
    name: '倒计时',
    component: CountdownCard,
    fields: [
      { key: 'lead', label: '前面的字', type: 'text', placeholder: '如 还剩 / 只有' },
      { key: 'value', label: '数字（整数）', type: 'text' },
      { key: 'unit', label: '后面的字', type: 'text', placeholder: '如 天 / 个名额' },
    ],
    defaults: countdownDefaults,
    fromLine: (text) => ({ value: numsIn(text)[0] || '' }),
    summary: (d) => `⏳ ${d.lead}${d.value}${d.unit}`,
    check: (d) => (/^\d+$/.test(String(d.value).trim()) ? [] : [`「${d.value}」不是整数，不会翻页`]),
    minDuration: () => 3,
    keyframes: () => [0.65, 2, -0.25],
    fixtures: [
      { name: '常规', data: { ...countdownDefaults, lead: '还剩', value: '3', unit: '天' } },
      { name: '两位数', data: { ...countdownDefaults, lead: '只有', value: '20', unit: '个名额' } },
      { name: '不是整数', data: { ...countdownDefaults, value: '三' } },
    ],
  },
  {
    id: 'twocol',
    name: '两栏对比',
    component: TwoColumnCard,
    fields: [
      { key: 'label', label: '英文小标签', type: 'text', placeholder: '可留空' },
      { key: 'title', label: '标题', type: 'text', placeholder: '可留空' },
      { key: 'tone', label: '样式', type: 'select', options: [{ value: 'proscons', label: '缺点 ✕ / 优点 ✓（右边是推荐的）' }, { value: 'neutral', label: '两边平等（方案 A / 方案 B）' }] },
      { key: 'leftTitle', label: '左栏名', type: 'text' },
      { key: 'left', label: '左栏条目（一行一条，2–4 条）', type: 'list' },
      { key: 'rightTitle', label: '右栏名', type: 'text' },
      { key: 'right', label: '右栏条目（一行一条，2–4 条）', type: 'list' },
    ],
    defaults: twoColDefaults,
    fromLine: (text) => ({ title: text, left: ['', ''], right: ['', ''] }),
    summary: (d) => `${d.leftTitle || 'A'} | ${d.rightTitle || 'B'}`,
    check: (d) => [...between(filled(d.left).length, 1, 4, '左栏条目'), ...between(filled(d.right).length, 1, 4, '右栏条目')],
    // 先左栏再右栏，和 TwoColumnCard 的出场顺序一致
    cueTargets: (d) => [...filled(d.left), ...filled(d.right)],
    defaultCue: (_d, k) => 0.55 + k * 0.28,
    minDuration: (d) => Math.max(3.5, 0.55 + (filled(d.left).length + filled(d.right).length) * 0.28 + 1.4, lastCue(d) + 1.6),
    keyframes: (d) => [0.9, Math.max(0.55 + (filled(d.left).length + filled(d.right).length) * 0.28 + 0.6, lastCue(d) + 0.8), -0.25],
    fixtures: [
      { name: '缺点 / 优点', data: { ...twoColDefaults, title: '做口播', leftTitle: '自己剪', left: ['一条要半天', '效果不稳定'], rightTitle: '用动效卡', right: ['十分钟出片', '风格统一', '可以批量'] } },
      { name: '平等', data: { ...twoColDefaults, tone: 'neutral', leftTitle: '方案 A', left: ['便宜', '慢'], rightTitle: '方案 B', right: ['贵', '快'] } },
    ],
  },
  {
    id: 'quadrant',
    name: '四象限',
    component: QuadrantCard,
    fields: [
      { key: 'label', label: '英文小标签', type: 'text', placeholder: '可留空' },
      { key: 'title', label: '标题', type: 'text', placeholder: '可留空' },
      { key: 'xLabel', label: '横轴名', type: 'text', placeholder: '如 紧急' },
      { key: 'yLabel', label: '纵轴名', type: 'text', placeholder: '如 重要' },
      { key: 'q1', label: '右上', type: 'text' },
      { key: 'q2', label: '左上', type: 'text' },
      { key: 'q3', label: '左下', type: 'text' },
      { key: 'q4', label: '右下', type: 'text' },
      { key: 'highlight', label: '点亮哪一格', type: 'select', options: [{ value: '1', label: '右上' }, { value: '2', label: '左上' }, { value: '3', label: '左下' }, { value: '4', label: '右下' }, { value: '0', label: '都不点亮' }] },
    ],
    defaults: quadDefaults,
    fromLine: (text) => ({ title: text }),
    summary: (d) => `⊞ ${d.title || '四象限'}`,
    check: (d) => (['q1', 'q2', 'q3', 'q4'].some((k) => !d[k].trim()) ? ['四个格子要都填上'] : []),
    minDuration: () => 4,
    keyframes: () => [1.1, 2.5, -0.25],
    fixtures: [
      { name: '常规', data: { ...quadDefaults, title: '时间管理', xLabel: '紧急', yLabel: '重要', q1: '马上做', q2: '计划做', q3: '别做', q4: '交给别人', highlight: '2' } },
      { name: '长格子', data: { ...quadDefaults, xLabel: '难度', yLabel: '收益', q1: '值得投入的大项目', q2: '优先做的小事', q3: '放弃', q4: '想清楚再做' } },
    ],
  },
  {
    id: 'funnel',
    name: '漏斗',
    component: FunnelCard,
    fields: [
      { key: 'label', label: '英文小标签', type: 'text', placeholder: '如 FUNNEL，可留空' },
      { key: 'title', label: '标题', type: 'text', placeholder: '可留空' },
      { key: 'rows', label: '每一层（一行一个：名称 数值，2–5 层，从大到小）', type: 'list' },
      { key: 'unit', label: '单位', type: 'text', placeholder: '人' },
    ],
    defaults: funnelDefaults,
    fromLine: (text) => ({ title: text, rows: ['', '', ''] }),
    summary: (d) => `⏷ ${d.title || '漏斗'}`,
    check: (d) => { const bad = badRows(d.rows); return [...between(filled(d.rows).length, 2, 5, '层'), ...(bad.length ? [`「${bad[0]}」要写成「名称 数值」`] : [])] },
    minDuration: (d) => Math.max(3.5, 0.5 + filled(d.rows).length * 0.38 + 1.6),
    keyframes: (d) => [0.9, 0.5 + filled(d.rows).length * 0.38 + 1, -0.25],
    fixtures: [
      { name: '常规', data: { ...funnelDefaults, label: 'FUNNEL', title: '一条视频的转化', rows: ['看到 10000', '点进来 1200', '加微信 86', '下单 12'], unit: '人' } },
      { name: '两层', data: { ...funnelDefaults, rows: ['曝光 50000', '点击 3500'] } },
    ],
  },
  {
    id: 'pyramid',
    name: '金字塔',
    component: PyramidCard,
    fields: [
      { key: 'label', label: '英文小标签', type: 'text', placeholder: '可留空' },
      { key: 'title', label: '标题', type: 'text', placeholder: '可留空' },
      { key: 'levels', label: '每一层（一行一层，第一行是塔尖，2–5 层）', type: 'list' },
    ],
    defaults: pyramidDefaults,
    fromLine: (text) => ({ title: text, levels: ['', '', ''] }),
    summary: (d) => `△ ${d.title || '金字塔'}`,
    check: (d) => between(filled(d.levels).length, 2, 5, '层'),
    minDuration: (d) => Math.max(3.5, 0.4 + filled(d.levels).length * 0.32 + 1.5),
    keyframes: (d) => [0.8, 0.4 + filled(d.levels).length * 0.32 + 0.8, -0.25],
    fixtures: [
      { name: '常规', data: { ...pyramidDefaults, title: '内容的三层', levels: ['观点', '方法', '信息'] } },
      { name: '5 层', data: { ...pyramidDefaults, levels: ['自我实现', '尊重', '社交', '安全', '生理'] } },
    ],
  },
  {
    id: 'causechain',
    name: '因果链',
    component: CauseChainCard,
    fields: [
      { key: 'label', label: '英文小标签', type: 'text', placeholder: '可留空' },
      { key: 'title', label: '标题', type: 'text', placeholder: '可留空' },
      { key: 'nodes', label: '每一环（一行一个，最后一行是结果，2–4 个）', type: 'list' },
    ],
    defaults: chainDefaults,
    fromLine: (text) => ({ nodes: [text, ''] }),
    summary: (d) => filled(d.nodes).join(' ⇒ ') || '因果链',
    check: (d) => between(filled(d.nodes).length, 2, 4, '环'),
    minDuration: (d) => Math.max(3.5, 0.45 + filled(d.nodes).length * 0.5 + 1.3),
    keyframes: (d) => [0.8, 0.45 + filled(d.nodes).length * 0.5 + 0.6, -0.25],
    fixtures: [
      { name: '常规', data: { ...chainDefaults, title: '为什么没人看完', nodes: ['开头太慢', '前三秒划走', '完播率低', '不推流'] } },
      { name: '两环', data: { ...chainDefaults, nodes: ['画面没变化', '观众走神'] } },
    ],
  },
  {
    id: 'formula',
    name: '公式卡',
    component: FormulaCard,
    fields: [
      { key: 'label', label: '英文小标签', type: 'text', placeholder: '可留空' },
      { key: 'title', label: '标题', type: 'text', placeholder: '可留空' },
      { key: 'parts', label: '各项（一行一项，2–4 项）', type: 'list' },
      { key: 'op', label: '中间的符号', type: 'select', options: [{ value: '+', label: '+' }, { value: '×', label: '×' }, { value: '−', label: '−' }] },
      { key: 'result', label: '等于什么', type: 'text' },
    ],
    defaults: formulaDefaults,
    fromLine: (text) => ({ result: text, parts: ['', ''] }),
    summary: (d) => `${filled(d.parts).join(` ${d.op} `)} = ${d.result}`,
    check: (d) => [...between(filled(d.parts).length, 2, 4, '项'), ...(!d.result.trim() ? ['没填结果'] : [])],
    minDuration: (d) => Math.max(3.2, 0.4 + filled(d.parts).length * 0.32 + 1.6),
    keyframes: (d) => [0.7, 0.4 + filled(d.parts).length * 0.32 + 1, -0.25],
    fixtures: [
      { name: '常规', data: { ...formulaDefaults, label: 'FORMULA', parts: ['选题', '表达', '节奏'], result: '好内容' } },
      { name: '乘法', data: { ...formulaDefaults, title: '收入公式', parts: ['流量', '转化率', '客单价'], op: '×', result: '收入' } },
    ],
  },
  {
    id: 'venn',
    name: '维恩图',
    component: VennCard,
    fields: [
      { key: 'label', label: '英文小标签', type: 'text', placeholder: '可留空' },
      { key: 'title', label: '标题', type: 'text', placeholder: '可留空' },
      { key: 'a', label: '左圆', type: 'text' },
      { key: 'b', label: '右圆', type: 'text' },
      { key: 'both', label: '交集', type: 'text' },
    ],
    defaults: vennDefaults,
    fromLine: (text) => ({ title: text }),
    summary: (d) => `${d.a || 'A'} ∩ ${d.b || 'B'}`,
    check: (d) => (!d.a.trim() || !d.b.trim() || !d.both.trim() ? ['左圆、右圆、交集都要填'] : [...d.both].length > 5 ? ['交集超过 5 个字，圆里放不下'] : []),
    minDuration: () => 3.5,
    keyframes: () => [0.8, 2.1, -0.25],
    fixtures: [
      { name: '常规', data: { ...vennDefaults, title: '什么内容会火', a: '你懂的', b: '别人想看的', both: '爆款' } },
      { name: '短词', data: { ...vennDefaults, a: '技术', b: '审美', both: '动效' } },
    ],
  },
  {
    id: 'marker',
    name: '荧光笔',
    component: MarkerCard,
    fields: [
      { key: 'sentence', label: '整句话', type: 'text' },
      { key: 'marks', label: '要涂的词（句子里的几个字，多个用「、」隔开）', type: 'text' },
    ],
    defaults: markerDefaults,
    fromLine: (text) => ({ sentence: text }),
    summary: (d) => `🖍 ${d.marks || d.sentence}`,
    check: (d) => {
      const bad = d.marks.split(/[、,，\s]+/).filter((w: string) => w && !d.sentence.includes(w))
      return [...(!d.sentence.trim() ? ['没填整句话'] : []), ...(bad.length ? [`「${bad[0]}」不在句子里，涂不上`] : []), ...(!d.marks.trim() ? ['没填要涂的词'] : [])]
    },
    minDuration: (d) => Math.max(3, 0.7 + d.marks.split(/[、,，\s]+/).filter(Boolean).length * 0.6 + 1.2),
    keyframes: (d) => [0.9, 0.7 + d.marks.split(/[、,，\s]+/).filter(Boolean).length * 0.6 + 0.4, -0.25],
    fixtures: [
      { name: '常规', data: { ...markerDefaults, sentence: '真正拉开差距的是你的选题能力', marks: '选题能力' } },
      { name: '涂两处', data: { ...markerDefaults, sentence: '先想清楚给谁看，再想清楚说什么', marks: '给谁看、说什么' } },
      { name: '词不在句子里', data: { ...markerDefaults, sentence: '节奏比画面更重要', marks: '剪辑' } },
    ],
  },
  {
    id: 'rewrite',
    name: '删除线改写',
    component: RewriteCard,
    fields: [
      { key: 'lead', label: '前面的字（可留空）', type: 'text', placeholder: '如 不是' },
      { key: 'from', label: '被划掉的词', type: 'text' },
      { key: 'to', label: '改成的词', type: 'text' },
      { key: 'tail', label: '后面的字（可留空）', type: 'text' },
      { key: 'style', label: '改法', type: 'select', options: [{ value: 'strike', label: '划线改写' }, { value: 'retype', label: '打字改口（删掉重打）' }] },
    ],
    defaults: rewriteDefaults,
    fromLine: (text) => ({ from: text }),
    summary: (d) => `~~${d.from}~~ → ${d.to}`,
    check: (d) => (!d.from.trim() || !d.to.trim() ? ['被划掉的词和改成的词都要填'] : []),
    minDuration: (d) => (d.style === 'retype' ? Math.max(3, retypeTimes(d.from, d.to).done + 1.4) : 3),
    // 打字改口的「入场中」拍在停顿那一拍（打错的词刚打完、光标在闪）
    keyframes: (d) => (d.style === 'retype' ? [retypeTimes(d.from, d.to).typed + 0.2, retypeTimes(d.from, d.to).done + 0.6, -0.25] : [0.95, 2, -0.25]),
    fixtures: [
      { name: '常规', data: { ...rewriteDefaults, from: '博主', to: '内容创作者' } },
      { name: '带前后文', data: { ...rewriteDefaults, lead: '你缺的不是', from: '设备', to: '方法', tail: '' } },
      { name: '打字改口', data: { ...rewriteDefaults, style: 'retype', lead: '你需要的是', from: '更贵的模型', to: '更清楚的需求' } },
      { name: '打字改口 · 短改长', data: { ...rewriteDefaults, style: 'retype', lead: '', from: '剪辑', to: '讲故事的能力' } },
    ],
  },
  {
    id: 'warning',
    name: '警告牌',
    component: WarningCard,
    fields: [
      { key: 'title', label: '大字', type: 'text', placeholder: '注意 / 千万别 / 踩坑' },
      { key: 'text', label: '说明（可留空）', type: 'text' },
    ],
    defaults: warningDefaults,
    fromLine: (text) => ({ text }),
    summary: (d) => `⚠ ${d.title}`,
    check: (d) => (!d.title.trim() ? ['没填大字'] : []),
    minDuration: () => 3,
    keyframes: () => [0.5, 1.6, -0.25],
    fixtures: [
      { name: '常规', data: { ...warningDefaults, title: '注意', text: '千万别直接用默认模板' } },
      { name: '只有大字', data: { ...warningDefaults, title: '踩坑预警' } },
    ],
  },
  {
    id: 'emoji',
    name: '表情贴纸',
    component: EmojiCard,
    fields: [
      { key: 'emoji', label: '表情', type: 'select', options: ['🔥', '👍', '😱', '🤔', '💯', '❤️', '👏', '🎉', '😂', '🙈', '💡', '✅', '❌'].map((e) => ({ value: e, label: e })) },
      { key: 'text', label: '旁边一行字（可留空）', type: 'text' },
    ],
    defaults: emojiDefaults,
    fromLine: () => ({}),
    summary: (d) => `${d.emoji} ${d.text}`,
    check: (d) => ([...(d.text || '')].length > 8 ? ['旁边的字超过 8 个，贴纸会显得很重'] : []),
    minDuration: () => 2,
    keyframes: () => [0.25, 1.2, -0.15],
    fixtures: [
      { name: '常规', data: { ...emojiDefaults, emoji: '😱', text: '这么快？' } },
      { name: '只有表情', data: { ...emojiDefaults, emoji: '💯' } },
    ],
  },
  {
    id: 'opening',
    name: '开场标题',
    component: OpeningCard,
    fields: [
      { key: 'kicker', label: '上方小字（可留空）', type: 'text', placeholder: '如 EP.01' },
      { key: 'title', label: '片名', type: 'text' },
      { key: 'subtitle', label: '副标题（可留空）', type: 'text' },
    ],
    defaults: openingDefaults,
    fromLine: (text) => ({ title: text }),
    summary: (d) => `🎬 ${d.title}`,
    check: (d) => (!d.title.trim() ? ['没填片名'] : [...d.title].length > 10 ? [`片名 ${[...d.title].length} 个字，超过 10 个字会很长`] : []),
    minDuration: (d) => Math.max(3.5, 0.4 + [...(d.title || '')].length * 0.07 + 2.2),
    keyframes: (d) => [0.4 + [...(d.title || '')].length * 0.04, 0.4 + [...(d.title || '')].length * 0.07 + 1.3, -0.3],
    fixtures: [
      { name: '常规', data: { ...openingDefaults, kicker: 'EP.01', title: '口播动效', subtitle: '十分钟做出高级感' } },
      { name: '只有片名', data: { ...openingDefaults, title: '五个剪辑关键词' } },
      { name: '叠加（不全屏）', data: { ...openingDefaults, fullscreen: false, panel: true, title: '开始' } },
    ],
  },
  {
    id: 'cta',
    name: '关注引导',
    component: CtaCard,
    fields: [
      { key: 'text', label: '引导语', type: 'text' },
      { key: 'buttons', label: '按钮', type: 'select', options: [
        { value: 'like,fav,follow', label: '点赞 + 收藏 + 关注' }, { value: 'like,follow', label: '点赞 + 关注' },
        { value: 'follow', label: '只要关注' }, { value: 'like,fav,share', label: '点赞 + 收藏 + 转发' },
      ] },
    ],
    defaults: ctaDefaults,
    fromLine: (text) => ({ text }),
    summary: () => '👍 关注引导',
    minDuration: () => 3.5,
    keyframes: () => [0.8, 2.6, -0.25],
    fixtures: [
      { name: '三连', data: { ...ctaDefaults } },
      { name: '只要关注', data: { ...ctaDefaults, text: '关注我，下期讲转场', buttons: 'follow' } },
    ],
  },
  {
    id: 'soundwave',
    name: '声波过渡',
    component: SoundwaveCard,
    fields: [
      { key: 'mode', label: '模式', type: 'select', options: [
        { value: 'overlay', label: '叠加（透明底，浮在口播上）' },
        { value: 'wipe', label: '遮挡转场（峰值时铺满整屏，盖住剪辑点）' },
        { value: 'full', label: '全屏背景（整段带暗场背景）' },
      ] },
      { key: 'label', label: '中间一行字（可留空，如 第二部分）', type: 'text' },
      { key: 'palette', label: '颜色', type: 'select', options: [{ value: 'accent', label: '主题色' }, { value: 'cyan', label: '青蓝' }, { value: 'multi', label: '多彩' }] },
      { key: 'intensity', label: '强度', type: 'select', options: [{ value: 'soft', label: '柔和' }, { value: 'normal', label: '标准' }, { value: 'strong', label: '强烈' }] },
    ],
    defaults: soundwaveDefaults,
    fromLine: () => ({}),
    summary: (d) => `〰 声波${d.label ? ' · ' + d.label : ''}`,
    check: (d) => ([...(d.label || '')].length > 10 ? ['中间的字超过 10 个，转场一闪而过读不完'] : []),
    // 阶段按总时长的比例排，太短的话扫光和起波挤成一团
    minDuration: () => 1.6,
    keyframes: () => [0.6, 1.15, -0.25],
    fixtures: [
      { name: '叠加 · 主题色', data: { ...soundwaveDefaults } },
      { name: '遮挡转场 · 带字', data: { ...soundwaveDefaults, mode: 'wipe', label: '第二部分', intensity: 'strong' } },
      { name: '全屏 · 青蓝', data: { ...soundwaveDefaults, mode: 'full', palette: 'cyan', label: 'PART 02' } },
      { name: '叠加 · 多彩 · 柔和', data: { ...soundwaveDefaults, palette: 'multi', intensity: 'soft' } },
    ],
  },
  {
    id: 'slotcycle',
    name: '词槽轮换',
    blurb: '句干固定，句尾胶囊每 0.8 秒往上翻一格换一个短语，换完落一句结论。用在「它能帮你 A / B / C」这种列举。',
    component: SlotCycleCard,
    fields: [
      { key: 'label', label: '英文小标签', type: 'text', placeholder: '可留空' },
      { key: 'stem', label: '句干（固定不动的前半句）', type: 'text', placeholder: '如「它能帮你」，可留空' },
      { key: 'items', label: '轮换的短语（一行一个，2–5 个）', type: 'list' },
      { key: 'conclusion', label: '结论（最后落进胶囊位置，可留空）', type: 'text' },
    ],
    defaults: slotDefaults,
    fromLine: (text) => ({ stem: text, items: ['', ''] }),
    summary: (d) => `${d.stem || ''}[${filled(d.items).join(' / ')}]`,
    check: (d) => {
      const out = between(filled(d.items).length, 2, 5, '短语')
      const long = filled(d.items).find((s: string) => visLen(s) > 8)
      if (long) out.push(`「${long}」超过 8 个字宽，胶囊会很长、翻得太快读不完`)
      return out
    },
    cueTargets: (d) => [...filled(d.items), ...(d.conclusion?.trim() ? [`结论：${d.conclusion}`] : [])],
    defaultCue: (d, i) => SLOT_START + i * SLOT_STEP,
    minDuration: (d) => {
      const n = filled(d.items).length
      const last = d.conclusion?.trim() ? SLOT_START + n * SLOT_STEP + 0.62 : SLOT_START + Math.max(0, n - 1) * SLOT_STEP + 0.3
      return Math.max(3, last + 1.4, lastCue(d) + 1.6)
    },
    keyframes: (d) => {
      const n = filled(d.items).length
      return [SLOT_START + SLOT_STEP + 0.13, Math.max(SLOT_START + n * SLOT_STEP + (d.conclusion?.trim() ? 0.9 : 0.3), lastCue(d) + 0.9), -0.25]
    },
    fixtures: [
      { name: '常规 4 个 + 结论', data: { ...slotDefaults, label: 'IT CAN', stem: '它能帮你', items: ['写脚本', '配动效', '出字幕', '导出成片'], conclusion: '一个人搞定' } },
      { name: '最少 2 个、无结论', data: { ...slotDefaults, stem: '你缺的是', items: ['方法', '耐心'] } },
      { name: '长短差很多', data: { ...slotDefaults, stem: '不管是', items: ['AI', '口播博主的选题库', '剪辑'], conclusion: '都能用' } },
      { name: '最多 5 个、无句干', data: { ...slotDefaults, items: ['选题', '写稿', '录制', '剪辑', '发布'], conclusion: '全流程' } },
      { name: '超过 8 个字', data: { ...slotDefaults, stem: '它能', items: ['把一整条口播自动配好卡', '导出'] } },
    ],
  },
  {
    id: 'countbadge',
    name: '开场承诺条数',
    blurb: '「今天讲 3 个方法」：数字先单独砸到位并换成强调色，量词从它右边推出来，副标题再跟上。开场 / 段落开头承诺讲几条时用。',
    component: CountBadgeCard,
    fields: [
      { key: 'label', label: '英文小标签', type: 'text', placeholder: '可留空' },
      { key: 'lead', label: '数字前面的字', type: 'text', placeholder: '如「今天讲」，可留空' },
      { key: 'value', label: '数字', type: 'text' },
      { key: 'unit', label: '量词（数字后面的字）', type: 'text', placeholder: '如「个方法」' },
      { key: 'title', label: '副标题（第二行，可留空）', type: 'text' },
    ],
    defaults: countBadgeDefaults,
    fromLine: (text) => ({ title: text, value: '3', unit: '个方法' }),
    summary: (d) => `${d.lead || ''}${d.value}${d.unit || ''}`,
    check: (d) => {
      const out: string[] = []
      if (!/^\d{1,2}$/.test(String(d.value || '').trim())) out.push('数字要写成 1–2 位的阿拉伯数字（这张卡讲的是「几条」）')
      if (!d.unit?.trim()) out.push('没写量词，只剩一个光秃秃的数字')
      return out
    },
    minDuration: (d) => (d.title ? 3.4 : 3),
    keyframes: () => [0.4, 2.1, -0.25],
    fixtures: [
      { name: '常规', data: { ...countBadgeDefaults, label: 'METHODS', lead: '今天讲', value: '3', unit: '个方法', title: '让你的口播不再没人看完' } },
      { name: '只有数字 + 量词', data: { ...countBadgeDefaults, value: '5', unit: '个坑' } },
      { name: '两位数 + 长量词', data: { ...countBadgeDefaults, lead: '我整理了', value: '12', unit: '个爆款开头', title: '直接抄作业' } },
      { name: '中文数字（拦下）', data: { ...countBadgeDefaults, value: '三', unit: '件事' } },
    ],
  },
  {
    id: 'titledemote',
    name: '标题降格成标签',
    blurb: '小节标题先在画面正中显影、站稳，再缩到 0.4 倍飞进角落变成标签，讲这一点的整段时间都挂着。用在教程里的「第 N 点」。',
    component: TitleDemoteCard,
    fields: [
      { key: 'index', label: '编号', type: 'text', placeholder: '如 02，可留空' },
      { key: 'label', label: '英文小标签（只在正中时显示）', type: 'text', placeholder: '可留空' },
      { key: 'title', label: '小节标题', type: 'text' },
      { key: 'corner', label: '停在哪个角', type: 'select', options: [{ value: 'tl', label: '左上' }, { value: 'tr', label: '右上' }] },
    ],
    defaults: titleDemoteDefaults,
    fromLine: (text) => ({ title: text }),
    summary: (d) => `🏷 ${d.index ? d.index + ' · ' : ''}${d.title}`,
    check: (d) => {
      const out: string[] = []
      if (!d.title?.trim()) out.push('没写小节标题')
      else if ([...d.title].length > 12) out.push(`小节标题 ${[...d.title].length} 个字，缩成角落标签后太长（建议 ≤12 字）`)
      return out
    },
    // 正中站稳 + 飞进角落 ≈ 2 秒；作为标签至少再挂 2 秒，不然像是一闪而过的标题
    minDuration: () => 4,
    keyframes: () => [0.35, 3.0, -0.2],
    fixtures: [
      { name: '常规', data: { ...titleDemoteDefaults, index: '02', label: 'TOPIC FIRST', title: '先定选题' } },
      { name: '最长（12 字）+ 右上', data: { ...titleDemoteDefaults, index: '10', title: '把一条口播拆成三个镜头', corner: 'tr' } },
      { name: '无编号', data: { ...titleDemoteDefaults, index: '', title: '为什么要先写稿' } },
      { name: '超长（拦下）', data: { ...titleDemoteDefaults, index: '03', title: '这是一个特别特别长的小节标题哦' } },
    ],
  },
  {
    id: 'choose',
    name: '五选一',
    blurb: '几个候选依次淡入；选中那个灰闪一下后填满强调色，其余淡到 18% 但不动，最后一行理由。用在「试了几个，最后选的是 X」。',
    component: ChooseCard,
    fields: [
      { key: 'label', label: '英文小标签', type: 'text', placeholder: '可留空' },
      { key: 'title', label: '标题', type: 'text', placeholder: '如「选哪个」，可留空' },
      { key: 'options', label: '候选（一行一个，2–6 个）', type: 'list' },
      { key: 'pick', label: '选中的那个（要和某个候选一字不差）', type: 'text' },
      { key: 'note', label: '理由（最后一行，可留空）', type: 'text' },
    ],
    defaults: chooseDefaults,
    fromLine: (text) => ({ title: text, options: ['', '', ''] }),
    summary: (d) => `✓ ${d.pick || '?'} / ${filled(d.options).length} 选 1`,
    check: (d) => {
      const opts = filled(d.options)
      const out = between(opts.length, 2, 6, '候选')
      if (!d.pick?.trim()) out.push('没写选中哪个，卡片上不会有任何一个被选中')
      else if (!opts.some((o: string) => o.trim() === d.pick.trim())) out.push(`选中的「${d.pick}」不在候选里（要一字不差），卡片上不会有任何一个被选中`)
      const long = opts.find((o: string) => visLen(o) > 8)
      if (long) out.push(`「${long}」超过 8 个字宽，一排放不下`)
      return out
    },
    cueTargets: (d) => [...filled(d.options), `选中：${d.pick || '?'}`],
    defaultCue: (d, i) => (i < filled(d.options).length ? chooseOptAt(i) : chooseOptAt(filled(d.options).length) + 0.6),
    minDuration: (d) => Math.max(3.5, choosePickAt(d) + (d.note ? 1.0 : 0.5) + 1.4, lastCue(d) + 1.6),
    keyframes: (d) => [chooseOptAt(1) + 0.15, Math.max(choosePickAt(d) + 1.1, lastCue(d) + 0.6), -0.25],
    fixtures: [
      { name: '常规 5 选 1 + 理由', data: { ...chooseDefaults, label: 'PICK ONE', title: '试了五个工具', options: ['剪映', 'Premiere', '达芬奇', 'Final Cut', 'CapCut'], pick: '剪映', note: '上手最快' } },
      { name: '2 选 1', data: { ...chooseDefaults, options: ['自己剪', '用模板'], pick: '用模板' } },
      { name: '4 个（2 + 2）、选最后一个', data: { ...chooseDefaults, title: '选哪个模型', options: ['豆包', 'Kimi', 'GPT', 'DeepSeek'], pick: 'DeepSeek', note: '便宜又快' } },
      { name: '6 个 + 长候选', data: { ...chooseDefaults, options: ['口播', 'vlog', '测评', '剧情', '直播切片', '知识科普'], pick: '知识科普' } },
      { name: '选中项不在候选里', data: { ...chooseDefaults, options: ['A 方案', 'B 方案', 'C 方案'], pick: 'B' } },
    ],
  },
  {
    id: 'metric',
    name: '数字带趋势',
    blurb: '大数字从第一个点的值滚到最后一个点，下面一条小折线同时画出来；数字停住时单位和涨跌箭头才出现。「一个数 + 它怎么来的」。',
    component: MetricSparkCard,
    fields: [
      { key: 'label', label: '英文小标签', type: 'text', placeholder: '可留空' },
      { key: 'title', label: '标题', type: 'text', placeholder: '可留空' },
      { key: 'rows', label: '点（一行一个：标签 数值，3–8 个；大数字 = 最后一个）', type: 'list' },
      { key: 'unit', label: '单位', type: 'text' },
    ],
    defaults: metricDefaults,
    fromLine: (text) => ({ title: text, rows: ['', '', ''] }),
    summary: (d) => { const r = filled(d.rows); return `📈 ${r.length ? r[r.length - 1].split(/\s+/).pop() : '?'}${d.unit || ''}` },
    check: (d) => {
      const n = filled(d.rows).length, bad = badRows(d.rows)
      return [...(n < 3 ? ['点少于 3 个，看不出是怎么来的'] : n > 8 ? ['点超过 8 个，小折线会挤'] : []), ...(bad.length ? [`「${bad[0]}」要写成「标签 数值」，数值是数字`] : [])]
    },
    minDuration: () => 3.8,
    // RUN_AT 0.5 + RUN 1.5（MetricSparkCard）：入场中拍在数字滚到一半
    keyframes: () => [1.25, 2.6, -0.25],
    fixtures: [
      { name: '上涨', data: { ...metricDefaults, label: 'FOLLOWERS', title: '半年涨粉', rows: ['1月 2', '2月 3.5', '3月 3', '4月 6', '5月 9', '6月 15'], unit: '万' } },
      { name: '下降 + 小数', data: { ...metricDefaults, title: '单条成本', rows: ['去年 3.2', '上半年 1.8', '现在 0.6'], unit: '天' } },
      { name: '千分位 + 起点更长', data: { ...metricDefaults, title: '获客成本', rows: ['开始 1,280', '三个月 860', '现在 95'], unit: '元' } },
      { name: '写错格式', data: { ...metricDefaults, rows: ['一月 很多', '二月 45'] } },
    ],
  },
  {
    id: 'converge',
    name: '多源汇聚',
    blurb: '左边几个来源依次出现，各自牵出一条曲线汇到右边；光点沿线滑过去，最后一颗到达时结果弹出来。讲「几样东西最后都落到一个结果上」。',
    component: ConvergeCard,
    fields: [
      { key: 'label', label: '英文小标签', type: 'text', placeholder: '可留空' },
      { key: 'title', label: '标题', type: 'text', placeholder: '可留空' },
      { key: 'sources', label: '来源（一行一个，2–4 个）', type: 'list' },
      { key: 'result', label: '汇成的结果', type: 'text' },
    ],
    defaults: convergeDefaults,
    fromLine: (text) => ({ title: text, sources: ['', ''] }),
    summary: (d) => `${filled(d.sources).join('+')} → ${d.result || '?'}`,
    check: (d) => {
      const out = between(filled(d.sources).length, 2, 4, '来源')
      if (!d.result?.trim()) out.push('没写结果，曲线汇到一个空位上')
      const long = filled(d.sources).find((s: string) => visLen(s) > 8)
      if (long) out.push(`「${long}」超过 8 个字宽，左边一列会很宽`)
      return out
    },
    cueTargets: (d) => [...filled(d.sources), `结果：${d.result || '?'}`],
    defaultCue: (d, i) => (i < filled(d.sources).length ? 0.4 + i * 0.25 : Math.max(0, ...filled(d.sources).map((_: string, k: number) => 0.4 + k * 0.25)) + 1.25),
    minDuration: (d) => Math.max(3.5, cvResultAt(d) + 0.5 + 1.4, lastCue(d) + 1.6),
    keyframes: (d) => [cvSrcAt(d, 0) + 0.9, Math.max(cvResultAt(d) + 0.9, lastCue(d) + 0.6), -0.25],
    fixtures: [
      { name: '常规 3 个', data: { ...convergeDefaults, label: 'ALL IN ONE', title: '最后都落到一件事上', sources: ['选题', '表达', '节奏'], result: '完播率' } },
      { name: '2 个', data: { ...convergeDefaults, sources: ['技术', '审美'], result: '动效' } },
      { name: '4 个 + 长名字', data: { ...convergeDefaults, title: '流量从哪来', sources: ['抖音', '视频号', '小红书', '公众号文章'], result: '私域' } },
      { name: '没写结果', data: { ...convergeDefaults, sources: ['A', 'B'] } },
    ],
  },
  {
    id: 'circlemark',
    name: '手绘圈',
    blurb: '一笔画出一个略歪的椭圆圈住画面里的东西（手里的产品、屏幕上的一行字），画完静置。拖到目标上，宽高调到刚好套住。',
    component: AnnotateCard,
    fields: sizeFields,
    defaults: { ...annotateDefaults, shape: 'circle' },
    fromLine: () => ({}),
    summary: () => '◯ 手绘圈',
    check: sizeCheck,
    minDuration: () => 2.5,
    keyframes: () => [0.5, 1.4, -0.15],
    fixtures: [
      { name: '常规', data: { ...annotateDefaults, shape: 'circle' } },
      { name: '细长（一行字）', data: { ...annotateDefaults, shape: 'circle', w: '700', h: '90' } },
      { name: '宽高没填数字', data: { ...annotateDefaults, shape: 'circle', w: '大', h: '' } },
    ],
  },
  {
    id: 'arrowmark',
    name: '双箭头',
    blurb: '两支手绘箭头从左上、右下几乎同时画向目标，箭尖留白不戳到目标。指向性最强，比圈更醒目。',
    component: AnnotateCard,
    fields: sizeFields,
    defaults: { ...annotateDefaults, shape: 'arrows' },
    fromLine: () => ({}),
    summary: () => '↘↖ 双箭头',
    check: sizeCheck,
    minDuration: () => 2.5,
    keyframes: () => [0.45, 1.4, -0.15],
    fixtures: [
      { name: '常规', data: { ...annotateDefaults, shape: 'arrows' } },
      { name: '小目标', data: { ...annotateDefaults, shape: 'arrows', w: '160', h: '120' } },
    ],
  },
  {
    id: 'reticle',
    name: '准星咬合',
    blurb: '四个 L 角从画外扑向目标，先大一圈再收紧咬住，咬合那一下闪一次、标签弹出。「就是这个」式的锁定。',
    component: AnnotateCard,
    fields: [...sizeFields, { key: 'text', label: '标签（可留空）', type: 'text', placeholder: '如 新功能' }],
    defaults: { ...annotateDefaults, shape: 'reticle' },
    fromLine: (text) => ({ text }),
    summary: (d) => `⌖ ${d.text || '准星'}`,
    check: (d) => [...sizeCheck(d), ...([...(d.text || '')].length > 10 ? ['标签超过 10 个字，挂在角框旁边太长'] : [])],
    minDuration: () => 2.5,
    keyframes: () => [0.35, 1.4, -0.15],
    fixtures: [
      { name: '常规 + 标签', data: { ...annotateDefaults, shape: 'reticle', w: '360', h: '360', text: '新功能' } },
      { name: '无标签、横长', data: { ...annotateDefaults, shape: 'reticle', w: '640', h: '200' } },
    ],
  },
  {
    id: 'callout',
    name: '引出线标签',
    blurb: '目标上一个圆点亮起，折线向外长出去，线端揭开一个文字标签。给画面里的东西「起个名」。圆点对准目标拖。',
    component: AnnotateCard,
    fields: [
      { key: 'text', label: '标签', type: 'text' },
      { key: 'side', label: '往哪边引', type: 'select', options: [{ value: 'right', label: '往右上' }, { value: 'left', label: '往左上' }] },
    ],
    defaults: { ...annotateDefaults, shape: 'callout', text: '' },
    fromLine: (text) => ({ text }),
    summary: (d) => `◉— ${d.text || '标签'}`,
    check: (d) => (!d.text?.trim() ? ['没写标签，只有一根线'] : [...d.text].length > 10 ? ['标签超过 10 个字，太长'] : []),
    minDuration: () => 3,
    keyframes: () => [0.8, 1.8, -0.15],
    fixtures: [
      { name: '往右上', data: { ...annotateDefaults, shape: 'callout', text: '降噪麦克风' } },
      { name: '往左上', data: { ...annotateDefaults, shape: 'callout', text: '补光灯', side: 'left' } },
      { name: '没写标签', data: { ...annotateDefaults, shape: 'callout', text: '' } },
    ],
  },
  {
    id: 'magnifier',
    name: '局部放大镜',
    blurb: '截图上目标处亮起一个小圈、本体压暗，圆形放大镜飞到旁边、里面是放大的那一块，连线指回出处。一次回答「在哪」和「是什么」。',
    component: MagnifierCard,
    fields: [
      { key: 'img', label: '截图', type: 'image' },
      { key: 'point', label: '放大哪里（在截图上点一下）', type: 'points', of: 'img', max: 1 },
      { key: 'zoom', label: '放大倍数', type: 'select', options: [{ value: '2', label: '2 倍' }, { value: '3', label: '3 倍' }, { value: '4', label: '4 倍' }] },
      { key: 'text', label: '放大镜下面一行（可留空）', type: 'text' },
      { key: 'side', label: '放大镜在哪边', type: 'select', options: [{ value: 'right', label: '右边' }, { value: 'left', label: '左边' }] },
    ],
    defaults: magnifierDefaults,
    fromLine: (text) => ({ text }),
    summary: (d) => `🔍 ${d.text || '放大镜'}`,
    check: (d) => [...(d.img ? [] : ['还没上传截图']), ...(d.img && !pointsOf(d.point).length ? ['还没在截图上点要放大的位置，现在放大的是正中间'] : [])],
    minDuration: () => 3.5,
    keyframes: () => [1.2, 2.4, -0.25],
    fixtures: [
      { name: '常规', data: { ...magnifierDefaults, img: WIDE_SHOT, point: [{ x: 22, y: 26 }], text: '标题写清楚了' } },
      { name: '放大镜在左 + 4 倍', data: { ...magnifierDefaults, img: WIDE_SHOT, point: [{ x: 80, y: 70 }], zoom: '4', side: 'left' } },
      { name: '竖长截图', data: { ...magnifierDefaults, img: LONG_PAGE, point: [{ x: 30, y: 40 }], text: '第 8 条' } },
      { name: '没点位置', data: { ...magnifierDefaults, img: WIDE_SHOT } },
      { name: '没上传', data: { ...magnifierDefaults } },
    ],
  },
  {
    id: 'scrolltour',
    name: '长截图慢滚',
    blurb: '长截图在窗口里往上滚，讲到关键处减速停住、那一行被荧光笔扫一道，再接着滚。滚速就是讲述节奏；停在哪在截图上点，什么时候停可以对齐字幕。',
    component: ScrollTourCard,
    fields: [
      { key: 'img', label: '长截图', type: 'image' },
      { key: 'stops', label: '停在哪几处（在截图上点，最多 5 处）', type: 'points', of: 'img', max: 5 },
    ],
    defaults: scrollDefaults,
    fromLine: () => ({}),
    summary: (d) => `📜 长截图 · 停 ${sortedStops(d).length} 处`,
    check: (d) => (d.img ? [] : ['还没上传长截图']),
    cueTargets: (d) => sortedStops(d).map((p, i) => `第 ${i + 1} 处（${Math.round(p.y)}% 高）`),
    defaultCue: (_d, i) => stAt(i),
    minDuration: (d) => {
      const n = sortedStops(d).length
      return n ? Math.max(4, stArrive(d, n - 1) + ST_HOLD + 1, lastCue(d) + ST_HOLD + 1) : 6
    },
    keyframes: (d) => (sortedStops(d).length ? [stArrive(d, 0) - 0.5, stArrive(d, 0) + 0.7, -0.25] : [1.5, 3, -0.25]),
    fixtures: [
      { name: '停 3 处', data: { ...scrollDefaults, img: LONG_PAGE, stops: [{ x: 50, y: 18 }, { x: 50, y: 52 }, { x: 50, y: 86 }] } },
      { name: '不停，匀速滚', data: { ...scrollDefaults, img: LONG_PAGE } },
      { name: '图比窗口还短', data: { ...scrollDefaults, img: WIDE_SHOT, stops: [{ x: 50, y: 40 }] } },
      { name: '没上传', data: { ...scrollDefaults } },
    ],
  },
  {
    id: 'newsdesk',
    name: '新闻卡上桌',
    blurb: '新闻截图包成白色卡片歪着滑上桌，念到关键句时一道红线扫过那一句；可以再压一张上来。整张桌面极缓推近。',
    component: NewsDeskCard,
    fields: [
      { key: 'img', label: '新闻截图', type: 'image' },
      { key: 'line', label: '红线从哪划到哪（在截图上点起点、终点）', type: 'points', of: 'img', max: 2 },
      { key: 'img2', label: '第二张（可留空）', type: 'image' },
      { key: 'source', label: '出处（可留空）', type: 'text', placeholder: '如 来源：36氪' },
    ],
    defaults: newsDefaults,
    fromLine: () => ({}),
    summary: (d) => `📰 ${d.source || '新闻卡'}`,
    check: (d) => [
      ...(d.img ? [] : ['还没上传新闻截图']),
      ...(d.img && pointsOf(d.line).length < 2 ? ['红线还没点满起点和终点，现在不画红线'] : []),
    ],
    cueTargets: (d) => ['红线扫过', ...(d.img2 ? ['第二张上来'] : [])],
    defaultCue: (_d, i) => (i === 0 ? NEWS_LINE_AT : NEWS_SECOND_AT),
    minDuration: (d) => Math.max(3.5, newsAt(d).line + 1.6, d.img2 ? newsAt(d).second + 1.6 : 0),
    keyframes: (d) => [newsAt(d).line + 0.3, Math.max(newsAt(d).line + 0.9, d.img2 ? newsAt(d).second + 0.9 : 0), -0.25],
    fixtures: [
      { name: '一张 + 红线 + 出处', data: { ...newsDefaults, img: WIDE_SHOT, line: [{ x: 4, y: 26 }, { x: 70, y: 26 }], source: '来源：Example News' } },
      { name: '两张叠', data: { ...newsDefaults, img: WIDE_SHOT, img2: LONG_PAGE, line: [{ x: 4, y: 45 }, { x: 60, y: 45 }] } },
      { name: '没点红线', data: { ...newsDefaults, img: WIDE_SHOT } },
      { name: '没上传', data: { ...newsDefaults } },
    ],
  },
  {
    id: 'slider',
    name: '前后滑动分屏',
    blurb: '两张同构图叠放，一根分割线左右滑：先到中线、轻推一下、滑到几乎全露「之后」、再回中线。改造前后、新旧版本。',
    component: SliderCompareCard,
    fields: [
      { key: 'before', label: '「之前」那张', type: 'image' },
      { key: 'after', label: '「之后」那张（构图要和之前一样）', type: 'image' },
      { key: 'beforeLabel', label: '左边标签', type: 'text', placeholder: '之前' },
      { key: 'afterLabel', label: '右边标签', type: 'text', placeholder: '之后' },
    ],
    defaults: sliderDefaults,
    fromLine: () => ({}),
    summary: (d) => `⇆ ${d.beforeLabel || '之前'} / ${d.afterLabel || '之后'}`,
    check: (d) => [...(d.before ? [] : ['还没上传「之前」那张']), ...(d.after ? [] : ['还没上传「之后」那张'])],
    minDuration: () => SLIDER_END + 0.8,
    keyframes: () => [1.2, 4.2, -0.25],
    fixtures: [
      { name: '常规', data: { ...sliderDefaults, before: BEFORE, after: AFTER, beforeLabel: '改版前', afterLabel: '改版后' } },
      { name: '少一张', data: { ...sliderDefaults, before: BEFORE } },
    ],
  },
  {
    id: 'shapewipe',
    name: '色块扫屏',
    blurb: '两三层同色系色块错峰从同一方向扫过整屏，中间有一段整屏全盖住 —— 把剪辑点放在卡片正中间，观众看不见切换那一下。',
    component: ShapeWipeCard,
    fields: [
      { key: 'dir', label: '方向', type: 'select', options: [{ value: 'right', label: '从左往右' }, { value: 'left', label: '从右往左' }, { value: 'down', label: '从上往下' }, { value: 'up', label: '从下往上' }] },
      { key: 'layers', label: '层数', type: 'select', options: [{ value: '3', label: '3 层' }, { value: '2', label: '2 层' }] },
      { key: 'label', label: '盖满时中间一行字（可留空）', type: 'text', placeholder: '如 第二部分' },
    ],
    defaults: shapeWipeDefaults,
    fromLine: () => ({}),
    // 全盖住的那段在 45%–58%：剪辑点放在卡片正中间
    summary: (d) => `▰ 扫屏${d.label ? ' · ' + d.label : ''}（剪辑点放正中）`,
    check: (d) => ([...(d.label || '')].length > 8 ? ['中间的字超过 8 个，盖满的那一下只有零点几秒，读不完'] : []),
    // 默认 1 秒（放上去就是这个长度）；再短的话盖满那一段不到一帧半，剪辑点很难对准
    minDuration: () => 1,
    keyframes: (d) => [0.3 * (d.duration || 2), 0.51 * (d.duration || 2), 0.75 * (d.duration || 2)],
    fixtures: [
      { name: '从左往右 3 层', data: { ...shapeWipeDefaults } },
      { name: '从右往左 + 字', data: { ...shapeWipeDefaults, dir: 'left', label: '第二部分' } },
      { name: '从上往下 2 层', data: { ...shapeWipeDefaults, dir: 'down', layers: '2' } },
      { name: '从下往上 + 字', data: { ...shapeWipeDefaults, dir: 'up', label: 'PART 03' } },
    ],
  },
  {
    id: 'turn',
    name: '叙事转折',
    blurb: '整屏场景：前一句压在反色底上，翻色那一拍底色压暗、柔光压成余晖，后一句才出来。「多年来大家都以为… → 但其实…」这种转折点用。',
    component: TurnCard,
    fields: [
      { key: 'before', label: '转折前（原话）', type: 'text', placeholder: '如 多年以来大家都以为流量最重要' },
      { key: 'after', label: '转折后（原话）', type: 'text', placeholder: '如 但真正留下来的是信任' },
      { key: 'bg', label: '底色', type: 'select', options: [{ value: 'clear', label: '透明底（叠在口播上）' }, { value: 'full', label: '整屏底色（翻色）' }] },
    ],
    defaults: turnDefaults,
    // 透明底只有字和柔光，不算盖住下层卡；写死在 defaults 的 seeThrough 里的话，切到整屏底色之后下层卡被盖住也不标红
    seeThrough: (d) => d.bg !== 'full',
    fromLine: (text) => ({ before: text }),
    summary: (d) => `↯ ${d.before || '…'} → ${d.after || '…'}`,
    check: (d) => [
      ...(!d.before?.trim() || !d.after?.trim() ? ['转折前、转折后两句都要有'] : []),
      ...([...(d.before || '')].length > 18 || [...(d.after || '')].length > 18 ? ['一句超过 18 个字，整句一行排的话字会很小'] : []),
    ],
    // 对的是「后一句出现」的时刻（按字幕对齐时拿后一句去找），翻色自动提前 0.48 秒
    cueTargets: (d) => [d.after].filter((s: string) => s?.trim()),
    defaultCue: (d) => turnBIn({ before: d.before }),
    minDuration: (d) => turnMin(d),
    keyframes: (d) => [TURN_A_IN + TURN_TEXT_IN * 0.5, turnAt(d) + 0.2, turnBIn(d) + TURN_TEXT_IN + 0.4],
    fixtures: [
      { name: '常规 · 透明底', data: { ...turnDefaults, before: '多年以来大家都以为流量最重要', after: '但真正留下来的是信任' } },
      { name: '整屏底色', data: { ...turnDefaults, bg: 'full', before: '多年以来大家都以为流量最重要', after: '但真正留下来的是信任' } },
      { name: '一长一短', data: { ...turnDefaults, before: '我以为只要坚持日更就一定能做起来', after: '我错了' } },
      { name: '最长（18 字）', data: { ...turnDefaults, before: '过去十年所有人都在拼命地追逐热点话题', after: '可是现在算法已经彻底改变了推荐的逻辑' } },
    ],
  },
  {
    id: 'altlines',
    name: '对句反色',
    blurb: '两句对仗的话各坐在自己的色块上：一行强调色、一行反色，字被块的右缘刷出来。「你以为在努力 / 其实在消耗」这种反差句用。',
    component: AltLinesCard,
    fields: [
      { key: 'label', label: '英文小标签', type: 'text', placeholder: '如 REALITY，可留空' },
      { key: 'a', label: '第一句（强调色块）', type: 'text' },
      { key: 'b', label: '第二句（反色块）', type: 'text' },
    ],
    defaults: altLinesDefaults,
    fromLine: (text) => ({ a: text }),
    summary: (d) => `▌${d.a || '…'} / ${d.b || '…'}`,
    check: (d) => [
      ...(!d.a?.trim() || !d.b?.trim() ? ['两句都要有，只有一句的话用「关键词大字」'] : []),
      ...([...(d.a || '')].length > 12 || [...(d.b || '')].length > 12 ? ['一句超过 12 个字，色块会很长，放不下时整张会缩小'] : []),
    ],
    cueTargets: (d) => [d.a, d.b].filter((s: string) => s?.trim()),
    defaultCue: (d, i) => altAt({}, i),
    minDuration: (d) => Math.max(2.8, altAt(d, 1) + ALT_LAG + ALT_BLOCK + 0.9 + [...((d.a || '') + (d.b || ''))].length * 0.06 + 0.5),
    keyframes: (d) => [altAt(d, 0) + ALT_BLOCK * 0.6, altAt(d, 1) + ALT_LAG + ALT_BLOCK + 0.5, -0.25],
    fixtures: [
      { name: '常规', data: { ...altLinesDefaults, label: 'REALITY', a: '你以为在努力', b: '其实在消耗' } },
      { name: '一长一短', data: { ...altLinesDefaults, a: '慢', b: '才是最快的那条路' } },
      { name: '最长（12 字）', data: { ...altLinesDefaults, a: '别人在研究怎么拍得更好看', b: '你得研究观众为什么要看' } },
    ],
  },
  {
    id: 'slab',
    name: '斜切色块标题',
    blurb: '第一行话题，第二行重点短语坐在斜切色块上 —— 块到位那一帧字才砸出来。速度版块从左边冲进来带速度线。比关键词大字更硬、更像封面字。',
    component: SlabCard,
    fields: [
      { key: 'lead', label: '第一行（话题，可留空）', type: 'text', placeholder: '如 做内容' },
      { key: 'key', label: '色块上的重点', type: 'text', placeholder: '如 先做减法' },
      { key: 'style', label: '入场', type: 'select', options: [{ value: 'punch', label: '中心撑开 + 砸字' }, { value: 'speed', label: '左边冲入 + 速度线' }] },
    ],
    defaults: slabDefaults,
    fromLine: (text) => ({ key: text }),
    summary: (d) => `▰ ${d.lead ? d.lead + ' / ' : ''}${d.key || '…'}`,
    check: (d) => [
      ...(!d.key?.trim() ? ['色块上的重点不能空'] : []),
      ...([...(d.key || '')].length > 8 ? ['色块上超过 8 个字，砸出来那一下读不完'] : []),
    ],
    minDuration: (d) => Math.max(2.6, slabLand(d.style) + 0.9 + [...((d.lead || '') + (d.key || ''))].length * 0.08 + 0.5),
    keyframes: (d) => [slabLand(d.style) - 0.08, slabLand(d.style) + 0.8, -0.25],
    fixtures: [
      { name: '砸字', data: { ...slabDefaults, lead: '做内容', key: '先做减法' } },
      { name: '速度线', data: { ...slabDefaults, lead: '想涨粉', key: '先学会讲故事', style: 'speed' } },
      { name: '只有重点', data: { ...slabDefaults, key: '别再卷了' } },
      { name: '最长（8 字）· 速度线', data: { ...slabDefaults, lead: '我做了三年口播之后才明白', key: '真诚是最好的技巧', style: 'speed' } },
    ],
  },
  {
    id: 'collapse',
    name: '一句话坍缩成一个词',
    blurb: '整句先在，读完后字开始沸腾、套上虚线选区框，然后碎成颗粒吸向中心，凝成一个更大更亮的词。「说白了就是一个字：卷」这种收束用。',
    component: CollapseCard,
    fields: [
      { key: 'sentence', label: '整句（原话）', type: 'text', placeholder: '如 做内容拼到最后拼的其实就是' },
      { key: 'word', label: '凝成的那个词（原话）', type: 'text', placeholder: '如 真诚' },
    ],
    defaults: collapseDefaults,
    fromLine: (text) => ({ sentence: text }),
    summary: (d) => `⊙ ${d.word || '…'}`,
    check: (d) => [
      ...(!d.sentence?.trim() || !d.word?.trim() ? ['整句和凝成的词都要有'] : []),
      ...([...(d.word || '')].length > 4 ? ['凝成的词超过 4 个字，就不是「一个词」了，用关键词大字'] : []),
      ...([...(d.sentence || '')].length > 20 ? ['整句超过 20 个字，卡片会很宽'] : []),
    ],
    minDuration: (d) => clMin(d),
    keyframes: (d) => [clBoilAt(d) + 0.3, clWordAt(d) + 0.6, -0.25],
    fixtures: [
      { name: '常规', data: { ...collapseDefaults, sentence: '做内容拼到最后拼的其实就是', word: '真诚' } },
      { name: '一个字', data: { ...collapseDefaults, sentence: '说白了现在整个行业就一个字', word: '卷' } },
      { name: '最长（20 字 + 4 字）', data: { ...collapseDefaults, sentence: '所有这些方法技巧和工具最后都指向同一件事', word: '长期主义' } },
    ],
  },
  {
    id: 'flywords',
    name: '关键词穿越',
    blurb: '一串关键词从远处沿纵深飞向镜头、擦身而过，循环不断，中间可压一行标题。开头列话题、讲「涉及的东西很多」时当背景。默认透明底。',
    component: FlyWordsCard,
    fields: [
      { key: 'words', label: '关键词（一行一个，4–16 个，原话）', type: 'list' },
      { key: 'title', label: '中间一行标题（可留空）', type: 'text' },
      { key: 'bg', label: '底色', type: 'select', options: [{ value: 'clear', label: '透明底（叠在口播上）' }, { value: 'full', label: '整屏底色' }] },
    ],
    defaults: flyWordsDefaults,
    fromLine: (text) => ({ title: text }),
    summary: (d) => `✦ ${d.title || filled(d.words || []).slice(0, 3).join(' ')}`,
    check: (d) => {
      const n = filled(d.words || []).length
      return [...(n < 4 ? ['关键词少于 4 个，飞起来很空（不够 18 个会重复填满）'] : n > 16 ? ['关键词超过 16 个，一个都读不清'] : []), ...(filled(d.words || []).some((w: string) => [...w].length > 8) ? ['有关键词超过 8 个字，飞过镜头时读不完'] : [])]
    },
    seeThrough: (d) => d.bg !== 'full',
    minDuration: () => 3,
    keyframes: () => [0.4, 1.6, -0.25],
    fixtures: [
      { name: '常规 · 透明底', data: { ...flyWordsDefaults, words: ['选题', '脚本', '封面', '标题', '剪辑', '字幕', '配乐', '节奏', '口播', '数据', '复盘', '涨粉'], title: '做一条视频要管多少事' } },
      { name: '只有 4 个词 · 整屏底色', data: { ...flyWordsDefaults, bg: 'full', words: ['AI', '工作流', '提示词', '自动化'] } },
      { name: '长词', data: { ...flyWordsDefaults, words: ['用户留存率', '完播率', '互动转化', '私域流量池', '内容矩阵', '平台推荐算法'] } },
    ],
  },
  {
    id: 'agenda',
    name: '章节目录高亮',
    blurb: '几条章节从右侧滑进来，站定后只有当前那一条换强调色、整行往前一步，其余压暗，四角角框收一下。「今天讲 4 件事，现在第 2 件」用；选「不高亮」就是开头报目录。',
    component: AgendaCard,
    fields: [
      { key: 'label', label: '英文小标签', type: 'text', placeholder: '如 TODAY，可留空' },
      { key: 'title', label: '标题（可留空）', type: 'text', placeholder: '如 今天聊四件事' },
      { key: 'items', label: '章节（一行一条，2–5 条）', type: 'list' },
      { key: 'current', label: '现在讲到第几条', type: 'select', options: [{ value: '0', label: '不高亮（开头报目录）' }, { value: '1', label: '第 1 条' }, { value: '2', label: '第 2 条' }, { value: '3', label: '第 3 条' }, { value: '4', label: '第 4 条' }, { value: '5', label: '第 5 条' }] },
    ],
    defaults: agendaDefaults,
    fromLine: (text) => ({ title: text, items: ['', '', ''] }),
    summary: (d) => `☰ ${agCurrent(d) ? `第 ${agCurrent(d)} 条 · ${filled(d.items || [])[agCurrent(d) - 1] || '?'}` : d.title || '目录'}`,
    check: (d) => {
      const n = filled(d.items || []).length, c = agCurrent(d)
      return [...(n < 2 ? ['章节少于 2 条'] : n > 5 ? ['章节超过 5 条，放不下'] : []), ...(c > n ? [`选了第 ${c} 条，但只有 ${n} 条 —— 现在一条都不亮`] : [])]
    },
    // 只有「报目录」时每条跟着口播出；高亮模式是一次全滑进来
    cueTargets: (d) => (agCurrent(d) ? [] : filled(d.items || [])),
    defaultCue: (d, i) => agAt({ current: '0' }, i),
    minDuration: (d) => Math.max(3, agFocusAt(d) + 0.4 + 1.6 + 0.5),
    keyframes: (d) => [0.5, agFocusAt(d) + 0.6, -0.25],
    fixtures: [
      { name: '第 2 条', data: { ...agendaDefaults, label: 'TODAY', title: '今天聊四件事', items: ['怎么选题', '怎么写开头', '怎么拍', '怎么复盘'], current: '2' } },
      { name: '报目录（不高亮）', data: { ...agendaDefaults, title: '这期分三部分', items: ['为什么要做', '具体怎么做', '常见的坑'] } },
      { name: '5 条 · 长', data: { ...agendaDefaults, items: ['从零开始搭建选题库', '三秒钟抓住注意力的开头', '让人看完的节奏控制', '评论区运营的小技巧', '每周一次的数据复盘'], current: '5' } },
      { name: '选错条数', data: { ...agendaDefaults, items: ['选题', '开头'], current: '4' } },
    ],
  },
  {
    id: 'flipcards',
    name: '功能卡翻面出数字',
    blurb: '一排卡正面写做了什么，逐张翻面，背面是那一项的结论数字。「做选题涨了 30%、改封面涨了 120%」这种「做了 A → 结果是 B」用。',
    component: FlipCardsCard,
    fields: [
      { key: 'label', label: '英文小标签', type: 'text', placeholder: '可留空' },
      { key: 'title', label: '标题（可留空）', type: 'text' },
      { key: 'rows', label: '卡（一行一张：名字 数值，2–4 张）', type: 'list' },
      { key: 'prefix', label: '数字前缀（如 +，可留空）', type: 'text' },
      { key: 'unit', label: '单位', type: 'text', placeholder: '如 %' },
    ],
    defaults: flipCardsDefaults,
    fromLine: (text) => ({ title: text, rows: ['', ''] }),
    summary: (d) => `⟲ ${d.title || parseRows(d.rows).map((r) => r.name).join(' / ') || '翻面卡'}`,
    check: (d) => {
      const n = parseRows(d.rows).length, bad = badPairs(d.rows)
      return [...(n < 2 ? ['少于 2 张卡'] : n > 4 ? ['超过 4 张卡，只显示前 4 张'] : []), ...(bad.length ? [`「${bad[0]}」要写成「名字 数值」，数值是数字（现在背面是 ?）`] : [])]
    },
    cueTargets: (d) => parseRows(d.rows).slice(0, 4).map((r) => r.name),
    defaultCue: (_d, i) => flAt({}, i),
    minDuration: (d) => Math.max(3, Math.max(0, ...parseRows(d.rows).slice(0, 4).map((_, i) => flAt(d, i))) + FL_DUR + 1.6 + 0.5),
    keyframes: (d) => [flAt(d, 0) + FL_DUR * 0.5, Math.max(0, ...parseRows(d.rows).slice(0, 4).map((_, i) => flAt(d, i))) + FL_DUR + 0.6, -0.25],
    fixtures: [
      { name: '3 张', data: { ...flipCardsDefaults, title: '改了三件事之后', rows: ['做选题 30', '改封面 120', '换开头 45'], prefix: '+', unit: '%' } },
      { name: '4 张 · 长名字 + 大数', data: { ...flipCardsDefaults, rows: ['建立选题库 1,280', '固定发布时间 360', '回复每条评论 95', '每周复盘 2.5'], unit: '万' } },
      { name: '写错格式', data: { ...flipCardsDefaults, rows: ['做选题 很多', '改封面 120'], unit: '%' } },
    ],
  },
  {
    id: 'breakout',
    name: '增长爆框',
    blurb: '前几根柱按旧刻度长好，最后一根冲出图框顶边、框抖一下，停一拍后纵轴重标、所有柱子缩回框里。「涨到原来的十倍」「去年才 3 万，今年 40 万」用。',
    component: BreakoutCard,
    fields: [
      { key: 'label', label: '英文小标签', type: 'text', placeholder: '可留空' },
      { key: 'title', label: '标题', type: 'text' },
      { key: 'rows', label: '柱子（一行一个：名字 数值，2–6 个，最后一个最大）', type: 'list' },
      { key: 'unit', label: '单位', type: 'text' },
    ],
    defaults: breakoutDefaults,
    fromLine: (text) => ({ title: text, rows: ['', '', ''] }),
    summary: (d) => `⇮ ${d.title || '增长爆框'}`,
    check: (d) => {
      const rs = parseRows(d.rows), bad = badPairs(d.rows)
      const last = rs[rs.length - 1]?.v ?? NaN
      const rest = Math.max(0, ...rs.slice(0, -1).map((r) => (Number.isNaN(r.v) ? 0 : r.v)))
      return [
        ...(rs.length < 2 ? ['柱子少于 2 根'] : rs.length > 6 ? ['柱子超过 6 根，只显示前 6 根'] : []),
        ...(bad.length ? [`「${bad[0]}」要写成「名字 数值」，数值是数字`] : []),
        ...(rs.length >= 2 && !bad.length && !(last >= rest * 1.5) ? ['最后一根不比前面最大的大 1.5 倍以上，冲不出框，看起来就是普通柱状图'] : []),
      ]
    },
    minDuration: (d) => boRescaleAt(parseRows(d.rows).length) + BO_RESCALE + 1.4 + 0.5,
    keyframes: (d) => [boShootAt(parseRows(d.rows).length) + 0.3, boRescaleAt(parseRows(d.rows).length) + BO_RESCALE + 0.4, -0.25],
    fixtures: [
      { name: '常规', data: { ...breakoutDefaults, title: '每年的营收', rows: ['2022 3', '2023 5', '2024 40'], unit: '万' } },
      { name: '两根 · 小数', data: { ...breakoutDefaults, title: '转化率', rows: ['以前 0.8', '现在 9.6'], unit: '%' } },
      { name: '6 根', data: { ...breakoutDefaults, title: '月播放', rows: ['1月 12', '2月 15', '3月 18', '4月 21', '5月 26', '6月 260'], unit: '万' } },
      { name: '最后不是最大', data: { ...breakoutDefaults, rows: ['去年 30', '今年 35'] } },
    ],
  },
  {
    id: 'datestamp',
    name: '时间地点戳',
    blurb: '讲故事起头那句「2019 年冬，深圳」用等宽字逐字敲出，末尾方块光标闪三下，副信息行再跟进来。',
    component: DateStampCard,
    fields: [
      { key: 'when', label: '时间（原话）', type: 'text', placeholder: '如 2019 年冬' },
      { key: 'where', label: '地点（原话，可留空）', type: 'text', placeholder: '如 深圳' },
      { key: 'note', label: '副信息（原话，可留空）', type: 'text', placeholder: '如 我刚辞职的第三天' },
    ],
    defaults: dateStampDefaults,
    fromLine: (text) => ({ when: text }),
    summary: (d) => `⌚ ${[d.when, d.where].filter(Boolean).join(' · ') || '时间地点'}`,
    check: (d) => [...(!d.when?.trim() && !d.where?.trim() ? ['时间和地点至少填一个'] : []), ...([...((d.when || '') + (d.where || ''))].length > 16 ? ['时间 + 地点超过 16 个字，敲得太久'] : [])],
    minDuration: (d) => Math.max(2.6, dsMin(d)),
    keyframes: (d) => [dsTypedAt(d) * 0.5, d.note?.trim() ? dsNoteAt(d) + 0.6 : dsTypedAt(d) + 0.6, -0.25],
    fixtures: [
      { name: '常规', data: { ...dateStampDefaults, when: '2019 年冬', where: '深圳', note: '我刚辞职的第三天' } },
      { name: '只有时间', data: { ...dateStampDefaults, when: '凌晨三点' } },
      { name: '最长', data: { ...dateStampDefaults, when: '2023 年 6 月', where: '杭州滨江', note: '那天我们第一次做到了单场一百万' } },
    ],
  },
  {
    id: 'crashzoom',
    name: '截图急推',
    blurb: '截图全景先停一拍，然后 0.2 秒急推到点选的那一处、过冲回弹后钉死，急推那几帧带运动模糊。「就是这一句」的重音。',
    component: CrashZoomCard,
    fields: [
      { key: 'img', label: '截图', type: 'image' },
      { key: 'point', label: '推到哪里（在截图上点一下）', type: 'points', of: 'img', max: 1 },
      { key: 'zoom', label: '推多近', type: 'select', options: [{ value: '1.8', label: '1.8 倍' }, { value: '2.3', label: '2.3 倍' }, { value: '3', label: '3 倍' }] },
      { key: 'text', label: '推完后底部一行字（可留空）', type: 'text' },
    ],
    defaults: crashZoomDefaults,
    fromLine: (text) => ({ text }),
    summary: (d) => `⤢ ${d.text || '急推'}`,
    check: (d) => [...(d.img ? [] : ['还没上传截图']), ...(d.img && !pointsOf(d.point).length ? ['还没在截图上点推到哪里，现在推的是正中间'] : [])],
    // 急推那一下可以对到字幕（找的是底部那行字）
    cueTargets: (d) => (d.text?.trim() ? [d.text] : []),
    defaultCue: () => CZ_AT,
    minDuration: (d) => Math.max(3, cueOr(d, 0, CZ_AT) + CZ_IN + CZ_SETTLE + 1.6 + 0.5),
    keyframes: (d) => [cueOr(d, 0, CZ_AT) - 0.3, cueOr(d, 0, CZ_AT) + 0.6, -0.25],
    fixtures: [
      { name: '常规', data: { ...crashZoomDefaults, img: WIDE_SHOT, point: [{ x: 30, y: 32 }], text: '就是这一句' } },
      { name: '贴边 + 3 倍', data: { ...crashZoomDefaults, img: WIDE_SHOT, point: [{ x: 96, y: 92 }], zoom: '3' } },
      { name: '竖长截图', data: { ...crashZoomDefaults, img: LONG_PAGE, point: [{ x: 40, y: 60 }], text: '第 12 条' } },
      { name: '没上传', data: { ...crashZoomDefaults } },
    ],
  },
  {
    id: 'scanmark',
    name: '扫描标注',
    blurb: '扫描线匀速从上往下扫过截图，扫到哪个点，取景框就收拢对准它、旁边贴出标签，右上角数 0/N → 分析完成。「AI 正在读这一页」的感觉，一次点出几处。',
    component: ScanMarkCard,
    fields: [
      { key: 'img', label: '截图', type: 'image' },
      { key: 'points', label: '标注哪几处（在截图上点，最多 4 处，按从上到下的顺序对应标签）', type: 'points', of: 'img', max: 4 },
      { key: 'labels', label: '标签（一行一个，从上到下）', type: 'list' },
      { key: 'done', label: '扫完显示', type: 'text', placeholder: '分析完成' },
    ],
    defaults: scanMarkDefaults,
    fromLine: () => ({}),
    summary: (d) => `⌖ 扫描 ${pointsOf(d.points).length} 处`,
    check: (d) => {
      const n = pointsOf(d.points).length, m = filled(d.labels || []).length
      return [...(d.img ? [] : ['还没上传截图']), ...(d.img && !n ? ['还没在截图上点要标注的位置'] : []), ...(n && m < n ? [`点了 ${n} 处、只写了 ${m} 个标签，后面几处没有字`] : []), ...(m > n && n ? [`写了 ${m} 个标签、只点了 ${n} 处，多出来的不显示`] : [])]
    },
    minDuration: () => scEnd + 0.3 + 1.6 + 0.5,
    keyframes: (d) => [scHitAt(pointsOf(d.points).sort((a, b) => a.y - b.y)[0]?.y ?? 30) + 0.25, scEnd + 0.6, -0.25],
    fixtures: [
      { name: '3 处', data: { ...scanMarkDefaults, img: WIDE_SHOT, points: [{ x: 20, y: 10 }, { x: 70, y: 45 }, { x: 30, y: 80 }], labels: ['标题太长', '按钮不显眼', '缺少价格'] } },
      { name: '贴右边 + 4 处', data: { ...scanMarkDefaults, img: WIDE_SHOT, points: [{ x: 92, y: 15 }, { x: 88, y: 40 }, { x: 15, y: 60 }, { x: 95, y: 90 }], labels: ['入口', '第二屏', '评论区', '底部导航'], done: '共 4 处问题' } },
      { name: '少写标签', data: { ...scanMarkDefaults, img: WIDE_SHOT, points: [{ x: 20, y: 20 }, { x: 60, y: 70 }], labels: ['只有一个'] } },
      { name: '没上传', data: { ...scanMarkDefaults } },
    ],
  },
  {
    id: 'textmask',
    name: '字里透图',
    blurb: '几个超粗大字里透出一张图、图在字里慢慢平移，结尾字猛地冲大、图铺满全屏接管画面。当章节卡用：「案例」字里透出案例截图。',
    component: TextMaskCard,
    fields: [
      { key: 'img', label: '字里透出的图', type: 'image' },
      { key: 'text', label: '大字（2–6 个字）', type: 'text', placeholder: '如 案例' },
      { key: 'bg', label: '底色', type: 'select', options: [{ value: 'full', label: '整屏底色' }, { value: 'clear', label: '透明底（字直接压在口播上）' }] },
    ],
    defaults: textMaskDefaults,
    fromLine: (text) => ({ text }),
    summary: (d) => `▤ ${d.text || '字里透图'}`,
    check: (d) => [...(d.img ? [] : ['还没上传图片，现在字是空心的']), ...(!d.text?.trim() ? ['大字不能空'] : [...d.text].length > 6 ? ['大字超过 6 个，笔画太细透不出图'] : [])],
    minDuration: () => 3.2,
    keyframes: (d) => [1.0, Math.max(1.4, (d.duration || 4.2) - 2), (d.duration || 4.2) - 0.9],
    fixtures: [
      { name: '常规', data: { ...textMaskDefaults, img: AFTER, text: '案例' } },
      { name: '透明底 · 6 字', data: { ...textMaskDefaults, bg: 'clear', img: WIDE_SHOT, text: '第二部分复盘' } },
      { name: '没上传', data: { ...textMaskDefaults, text: '数据' } },
    ],
  },
  {
    id: 'portrait',
    name: '竖屏素材装卡',
    blurb: '横屏视频里放一张竖图（抖音截图、手机录屏截图）：同一张图放大模糊压暗铺满当底床，竖卡落在一侧，另一侧标题和来源逐行升入。',
    component: PortraitCard,
    fields: [
      { key: 'img', label: '竖图', type: 'image' },
      { key: 'title', label: '标题', type: 'text' },
      { key: 'source', label: '来源（两行用两个空格隔开，可留空）', type: 'text', placeholder: '如 @某某  抖音 · 2024.06' },
      { key: 'side', label: '竖卡位置', type: 'select', options: [{ value: 'right', label: '右边' }, { value: 'center', label: '正中' }] },
    ],
    defaults: portraitDefaults,
    fromLine: (text) => ({ title: text }),
    summary: (d) => `▯ ${d.title || '竖屏素材'}`,
    check: (d) => [...(d.img ? [] : ['还没上传竖图']), ...([...(d.title || '')].length > 16 ? ['标题超过 16 个字，旁边那一栏放不下会换很多行'] : [])],
    minDuration: () => 3.5,
    keyframes: () => [0.5, 1.8, -0.25],
    fixtures: [
      { name: '常规', data: { ...portraitDefaults, img: PORTRAIT_SHOT, title: '这条视频三天涨了十万粉', source: '@某某  抖音 · 2024.06' } },
      { name: '正中', data: { ...portraitDefaults, img: PORTRAIT_SHOT, title: '评论区都在问', side: 'center' } },
      { name: '横图传错了', data: { ...portraitDefaults, img: WIDE_SHOT, title: '横图会被裁成竖的' } },
      { name: '没上传', data: { ...portraitDefaults, title: '待上传' } },
    ],
  },
  {
    id: 'rackfocus',
    name: '两图对焦切换',
    blurb: '两张图前后错开叠放、永远一清一糊：先对焦前面那张，讲到第二张时焦点转过去。像镜头在两张素材之间对焦，「之前是这样 → 现在是这样」也能用。',
    component: RackFocusCard,
    fields: [
      { key: 'img', label: '第 1 张（先清楚）', type: 'image' },
      { key: 'cap', label: '第 1 张说明（可留空）', type: 'text' },
      { key: 'img2', label: '第 2 张（后清楚）', type: 'image' },
      { key: 'cap2', label: '第 2 张说明（可留空，按字幕对齐时找它）', type: 'text' },
    ],
    defaults: rackFocusDefaults,
    fromLine: (text) => ({ cap: text }),
    summary: (d) => `◐ ${[d.cap, d.cap2].filter(Boolean).join(' → ') || '对焦切换'}`,
    check: (d) => [...(!d.img ? ['还没上传第 1 张'] : []), ...(!d.img2 ? ['还没上传第 2 张'] : [])],
    cueTargets: (d) => (d.cap2?.trim() ? [d.cap2] : []),
    defaultCue: () => RF_AT,
    minDuration: (d) => Math.max(3.5, cueOr(d, 0, RF_AT) + RF_DUR + 1.6 + 0.5),
    keyframes: (d) => [cueOr(d, 0, RF_AT) - 0.3, cueOr(d, 0, RF_AT) + RF_DUR + 0.4, -0.25],
    fixtures: [
      { name: '常规', data: { ...rackFocusDefaults, img: BEFORE, img2: AFTER, cap: '改版前', cap2: '改版后' } },
      { name: '竖图 + 横图', data: { ...rackFocusDefaults, img: PORTRAIT_SHOT, img2: WIDE_SHOT, cap: '手机端', cap2: '电脑端' } },
      { name: '少一张', data: { ...rackFocusDefaults, img: BEFORE, cap: '只有一张' } },
    ],
  },
  {
    id: 'inkbleed',
    name: '墨渗转场',
    blurb: '一滴墨落下，带毛边、快慢不匀地洇开吃掉整屏，盖满一小段再从同一点洇出洞把画面还回来 —— 剪辑点放卡片正中间。纸感主题下最像。',
    component: InkBleedCard,
    fields: [
      { key: 'from', label: '落墨点', type: 'select', options: [{ value: 'center', label: '正中' }, { value: 'tl', label: '左上' }, { value: 'tr', label: '右上' }, { value: 'bl', label: '左下' }, { value: 'br', label: '右下' }] },
      { key: 'ink', label: '墨色', type: 'select', options: [{ value: 'fg', label: '正文色（纸感下是深墨）' }, { value: 'accent', label: '强调色' }] },
      { key: 'label', label: '盖满时中间一行字（可留空）', type: 'text', placeholder: '如 第二部分' },
    ],
    defaults: inkBleedDefaults,
    fromLine: () => ({}),
    // 全盖住的那段在 45%–58%：剪辑点放在卡片正中间
    summary: (d) => `● 墨渗${d.label ? ' · ' + d.label : ''}（剪辑点放正中）`,
    check: (d) => ([...(d.label || '')].length > 8 ? ['中间的字超过 8 个，盖满的那一下只有零点几秒，读不完'] : []),
    // 洇开比色块扫屏慢（墨要「走」过去），再短的话读作一次普通的光圈擦除
    minDuration: () => 1.6,
    keyframes: (d) => [0.25 * (d.duration || 2.6), 0.51 * (d.duration || 2.6), 0.75 * (d.duration || 2.6)],
    fixtures: [
      { name: '正中 · 深墨', data: { ...inkBleedDefaults } },
      { name: '左上 · 强调色 + 字', data: { ...inkBleedDefaults, from: 'tl', ink: 'accent', label: '第二部分' } },
      { name: '右下 · 长英文', data: { ...inkBleedDefaults, from: 'br', label: 'PART 03' } },
    ],
  },
]

export const templateById = (id: string) => TEMPLATES.find((t) => t.id === id)

/** 字幕区占画面底部的比例。卡片压进来会和口播字幕叠在一起。 */
export const SUBTITLE_ZONE = 0.18

/** 全屏卡放大到多少：居中，宽不超过画面 78%、高不超过 70%，最多放大 1.6 倍（太大字会糊） */
export const fullscreenScale = (size: { w: number; h: number } | undefined, W: number, H: number) =>
  size ? Math.min(1.6, (W * 0.78) / size.w, (H * 0.7) / size.h) : 1

/** 新卡的默认位置（占画布比例）和大小 */
export const defaultBox = (aspect: '16:9' | '9:16') =>
  aspect === '16:9' ? { x: 0.05, y: 0.18, s: 1 } : { x: 0.06, y: 0.12, s: 0.9 }

/** 卡片库的分类（和服务端 AI 目录 templateSpecs 的 category 对齐；只能手动加的那几种单列「素材」） */
export const LIB_CATEGORIES = ['数据', '文字强调', '列表结构', '章节节奏', '界面模拟', '画面标注', '素材', 'B-roll 场景'] as const
const CATEGORY_OF: Record<string, (typeof LIB_CATEGORIES)[number]> = {
  number: '数据', compare: '数据', ring: '数据', beforeafter: '数据', pictogram: '数据', barchart: '数据', linechart: '数据',
  progress: '数据', gauge: '数据', price: '数据', countdown: '数据', funnel: '数据',
  keyword: '文字强调', quote: '文字强调', define: '文字强调', term: '文字强调', marker: '文字强调', rewrite: '文字强调',
  stamp: '文字强调', warning: '文字强调', emoji: '文字强调',
  list: '列表结构', steps: '列表结构', ranking: '列表结构', timeline: '列表结构', bubbles: '列表结构', twocol: '列表结构',
  quadrant: '列表结构', pyramid: '列表结构', causechain: '列表结构', formula: '列表结构', venn: '列表结构', rightwrong: '列表结构',
  chapter: '章节节奏', question: '章节节奏', opening: '章节节奏', cta: '章节节奏',
  search: '界面模拟', notify: '界面模拟', chat: '界面模拟', terminal: '界面模拟', click: '界面模拟', imagegroup: '界面模拟',
  window: '素材', danmaku: '素材', post: '素材', lowerthird: '素材',
  soundwave: 'B-roll 场景',
  slotcycle: '列表结构', countbadge: '章节节奏', titledemote: '章节节奏', choose: '列表结构', metric: '数据', converge: '列表结构',
  circlemark: '画面标注', arrowmark: '画面标注', reticle: '画面标注', callout: '画面标注',
  magnifier: '素材', scrolltour: '素材', newsdesk: '素材', slider: '素材', shapewipe: 'B-roll 场景', inkbleed: 'B-roll 场景', turn: 'B-roll 场景', altlines: '文字强调', slab: '文字强调', collapse: '文字强调', flywords: 'B-roll 场景', agenda: '章节节奏', flipcards: '数据', breakout: '数据', datestamp: '章节节奏', crashzoom: '素材', scanmark: '画面标注', textmask: 'B-roll 场景', portrait: 'B-roll 场景', rackfocus: '素材',
}
// 新加了卡却没归类的话卡片库里找不到它 —— 归到「素材」并在控制台喊一声，不悄悄消失
export const categoryOf = (id: string) => {
  const c = CATEGORY_OF[id]
  if (!c) console.warn(`[broll] 卡片「${id}」没有归类（templates.ts 的 CATEGORY_OF），暂时放在「素材」`)
  return c || '素材'
}
