<script setup lang="ts">
// 咨询流程（十四步）的「分析操法」和「本步必须产出的东西」后台（088）。
//
// 这一页改的是**进 prompt 的文字**，所以它唯一的失败形态是「看起来保存了，其实没生效」
// 或者反过来「以为只是排版，其实改掉了分析质量」。三件事因此是硬的：
// ① 缺省和当前值都能看到（只显示当前值的话，「这条是我改的还是本来就这样」分不出来）；
// ② 哪几步改过要在列表上一眼看见（不然一个改坏了的操法混在十四步里没人找得到）；
// ③ 有没保存的改动时切走要拦一下 —— 写了二十行点一下别的步骤就没了，而界面什么都不说。

import { ref, computed, onMounted } from 'vue'
import { apiGet, apiPut } from '../../lib/api'

interface FieldView {
  default: string[]
  current: string[]
  overridden: boolean
  updated_at: string | null
  updated_by: string | null
}
interface StageView {
  key: string
  label: string
  group: string
  lane: string
  question: string
  method: FieldView
  deliverables: FieldView
  highlight: string | null
  highlight_broken: boolean
}

const LANE_LABEL: Record<string, string> = { fast: '咨询（快车道）', slow: '分析（慢车道）', plan: '执行' }

const stages = ref<StageView[]>([])
const limits = ref({ chars: 6000, lines: 24 })
const loading = ref(false)
const err = ref('')
const saving = ref('')
const okMsg = ref('')
const warnings = ref<string[]>([])

/** 展开哪一步。一次只开一个 —— 十四步 × 两个 textarea 同时铺开根本找不到自己在改哪一步。 */
const openKey = ref('')
/** 编辑中的文本（一行一条的原文）。展开时从 current 灌进来。 */
const editing = ref<{ method: string; deliverables: string }>({ method: '', deliverables: '' })

const openStage = computed(() => stages.value.find((s) => s.key === openKey.value) || null)

/** 分组顺序**照接口返回的顺序推**，不写死 ['四看','四问',…]：写死的话新增分组的那几步
 *  在这一页上完全不存在，而接口、解锁、正文全是对的 —— 只会以为流程就到那里为止。 */
const groups = computed(() => {
  const out: Array<{ name: string; items: StageView[] }> = []
  for (const s of stages.value) {
    if (!out.length || out[out.length - 1].name !== s.group) out.push({ name: s.group, items: [] })
    out[out.length - 1].items.push(s)
  }
  return out
})

const changedCount = computed(
  () => stages.value.filter((s) => s.method.overridden || s.deliverables.overridden).length
)

function dirty(): boolean {
  const s = openStage.value
  if (!s) return false
  return (
    editing.value.method.trim() !== s.method.current.join('\n').trim() ||
    editing.value.deliverables.trim() !== s.deliverables.current.join('\n').trim()
  )
}

function lineCount(text: string): number {
  return text.split('\n').map((l) => l.trim()).filter(Boolean).length
}

async function load() {
  loading.value = true
  err.value = ''
  try {
    const res = await apiGet('/api/consult/admin/stages')
    stages.value = res.stages || []
    limits.value = res.limits || limits.value
  } catch (e: any) {
    err.value = e.message || '读取失败'
  } finally {
    loading.value = false
  }
}

function open(s: StageView) {
  if (openKey.value === s.key) {
    // 收起来也要拦：改了二十行点一下标题就没了，而界面上什么都不说。
    if (dirty() && !confirm('这一步有没保存的改动，收起来就没了。确认放弃？')) return
    openKey.value = ''
    return
  }
  if (dirty() && !confirm('上一步有没保存的改动，切过去就没了。确认放弃？')) return
  openKey.value = s.key
  editing.value = { method: s.method.current.join('\n'), deliverables: s.deliverables.current.join('\n') }
  okMsg.value = ''
  warnings.value = []
}

/** `field` 只传改动过的那一栏：两栏一起发的话，只改了操法也会把输出物清单原样存成一条覆盖，
 *  从此代码里的缺省改了它也不跟着变，而后台显示的是「已修改」。 */
async function save() {
  const s = openStage.value
  if (!s) return
  const body: Record<string, string> = {}
  if (editing.value.method.trim() !== s.method.current.join('\n').trim()) body.method = editing.value.method
  if (editing.value.deliverables.trim() !== s.deliverables.current.join('\n').trim()) {
    body.deliverables = editing.value.deliverables
  }
  if (!Object.keys(body).length) {
    okMsg.value = '没有改动。'
    return
  }
  saving.value = s.key
  err.value = ''
  okMsg.value = ''
  warnings.value = []
  try {
    const res: StageView & { warnings: string[] } = await apiPut(`/api/consult/admin/stages/${s.key}`, body)
    const i = stages.value.findIndex((x) => x.key === s.key)
    if (i >= 0) stages.value[i] = res
    editing.value = { method: res.method.current.join('\n'), deliverables: res.deliverables.current.join('\n') }
    warnings.value = res.warnings || []
    okMsg.value = `已保存。下一次生成「${res.label}」就按这份跑 —— 已经定稿的那些步骤不会自己重跑。`
  } catch (e: any) {
    // 上限是服务端只拒不截，那句话里带着真实字数/条数，原样显示。
    err.value = e.message || '保存失败'
  } finally {
    saving.value = ''
  }
}

/** 恢复缺省 = 提交空串（服务端删掉那一行，不是写回一份拷贝，见 stageOverrides.ts）。 */
async function reset(field: 'method' | 'deliverables') {
  const s = openStage.value
  if (!s) return
  const name = field === 'method' ? '分析操法' : '本步必须产出的东西'
  if (!confirm(`把「${s.label}」的${name}恢复成代码里的缺省？你现在写的那份会被删掉，恢复不了。`)) return
  saving.value = s.key
  err.value = ''
  okMsg.value = ''
  warnings.value = []
  try {
    const res: StageView & { warnings: string[] } = await apiPut(`/api/consult/admin/stages/${s.key}`, { [field]: '' })
    const i = stages.value.findIndex((x) => x.key === s.key)
    if (i >= 0) stages.value[i] = res
    editing.value = { method: res.method.current.join('\n'), deliverables: res.deliverables.current.join('\n') }
    warnings.value = res.warnings || []
    okMsg.value = `已恢复缺省（${name}）。`
  } catch (e: any) {
    err.value = e.message || '恢复失败'
  } finally {
    saving.value = ''
  }
}

onMounted(load)
</script>

<template>
  <div class="cf">
    <div class="admin-header"><h1>品牌咨询 · 流程与方法论</h1></div>

    <p v-if="err" class="err">{{ err }}</p>

    <div class="intro">
      <p>
        改的是每一步进 AI prompt 的两段文字：<b>分析操法</b>（按什么顺序推、判断标准是什么）和
        <b>本步必须产出的东西</b>（要交出哪几张表）。这两段同时<b>原样显示给用户</b>，
        所以它们既是 prompt 也是界面文案。
      </p>
      <ul>
        <li><b>只有这两栏能改。</b>步骤本身（有哪几步、解锁顺序、哪几步带整份正文进 prompt）在代码里 —— 那些是行为，改了不报错，只是解锁条件变了、prompt 里少带一份依据。</li>
        <li><b>操法不是文案，是分析质量。</b>只给「要交什么」不给「怎么推」的话，模型会把表格填满而推导是自己编的 —— 那种正文和照方法论推出来的在屏幕上一模一样。</li>
        <li><b>只影响下一次生成</b>，已经定稿的步骤不会自己重跑（要用新口径就回工作台重跑那一步）。</li>
        <li>一行一条。空着保存 = 恢复成代码里的缺省。上限每栏 {{ limits.lines }} 条 / {{ limits.chars }} 字 —— 超了会拒，不会替你截。</li>
      </ul>
    </div>

    <p class="count">
      共 {{ stages.length }} 步，其中 <b :class="{ hot: changedCount > 0 }">{{ changedCount }}</b> 步改过缺省。
    </p>

    <div v-for="g in groups" :key="g.name" class="group">
      <h3>{{ g.name }}</h3>
      <div v-for="s in g.items" :key="s.key" class="stage" :class="{ open: openKey === s.key }">
        <button class="stage-head" type="button" @click="open(s)">
          <span class="s-label">{{ s.label }}</span>
          <span class="s-lane">{{ LANE_LABEL[s.lane] || s.lane }}</span>
          <span class="s-q">{{ s.question }}</span>
          <span class="s-tags">
            <span v-if="s.method.overridden" class="tag">操法已改</span>
            <span v-if="s.deliverables.overridden" class="tag">产出清单已改</span>
            <span v-if="!s.method.overridden && !s.deliverables.overridden" class="tag plain">缺省</span>
            <!-- 定稿气泡摊不开那张表 = 那一步的定稿读起来只剩一句结论，所以这条要常显。 -->
            <span v-if="s.highlight_broken" class="tag bad">摊开的那一节对不上「{{ s.highlight }}」</span>
          </span>
          <span class="s-caret">{{ openKey === s.key ? '收起' : '编辑' }}</span>
        </button>

        <div v-if="openKey === s.key" class="editor">
          <p v-if="okMsg" class="ok">{{ okMsg }}</p>
          <p v-for="(w, i) in warnings" :key="i" class="warn-line">⚠️ {{ w }}</p>

          <div class="field">
            <div class="f-head">
              <b>分析操法</b>
              <span class="f-meta">
                {{ lineCount(editing.method) }} / {{ limits.lines }} 条 ·
                {{ editing.method.length }} / {{ limits.chars }} 字
                <template v-if="s.method.overridden">
                  · 已改（{{ (s.method.updated_at || '').slice(0, 16).replace('T', ' ') }}）
                  <button class="link" @click="reset('method')">恢复缺省</button>
                </template>
                <template v-else>· 现在用的是代码里的缺省</template>
              </span>
            </div>
            <textarea v-model="editing.method" rows="10" spellcheck="false"></textarea>
            <!-- 缺省要能对着看：改坏了之后「原来那条是怎么写的」只有这里还留着。 -->
            <details v-if="s.method.overridden">
              <summary>代码里的缺省（{{ s.method.default.length }} 条）</summary>
              <ol><li v-for="(m, i) in s.method.default" :key="i">{{ m }}</li></ol>
            </details>
          </div>

          <div class="field">
            <div class="f-head">
              <b>本步必须产出的东西</b>
              <span class="f-meta">
                {{ lineCount(editing.deliverables) }} / {{ limits.lines }} 条 ·
                {{ editing.deliverables.length }} / {{ limits.chars }} 字
                <template v-if="s.deliverables.overridden">
                  · 已改（{{ (s.deliverables.updated_at || '').slice(0, 16).replace('T', ' ') }}）
                  <button class="link" @click="reset('deliverables')">恢复缺省</button>
                </template>
                <template v-else>· 现在用的是代码里的缺省</template>
              </span>
            </div>
            <textarea v-model="editing.deliverables" rows="10" spellcheck="false"></textarea>
            <p v-if="s.highlight" class="hint">
              定稿气泡会直接摊开以「{{ s.highlight }}」开头的那一项 —— 改这一项的开头，那张表就要多点一次才看得到。
            </p>
            <details v-if="s.deliverables.overridden">
              <summary>代码里的缺省（{{ s.deliverables.default.length }} 条）</summary>
              <ol><li v-for="(d, i) in s.deliverables.default" :key="i">{{ d }}</li></ol>
            </details>
          </div>

          <div class="actions">
            <button class="btn-primary" :disabled="saving === s.key" @click="save">
              {{ saving === s.key ? '保存中…' : '保存' }}
            </button>
            <span class="dirty" v-if="dirty()">有未保存的改动</span>
          </div>
        </div>
      </div>
    </div>

    <p v-if="!stages.length && !loading" class="empty">读不到阶段清单。</p>
  </div>
</template>

<style scoped>
.cf { padding: 20px; }
.admin-header h1 { margin: 0 0 16px; font-size: 20px; }
.err { background: #fef2f2; border: 1px solid #fecaca; color: #b91c1c; padding: 10px 14px; border-radius: 6px; font-size: 13px; white-space: pre-wrap; }
.ok { background: #ecfdf5; border: 1px solid #a7f3d0; color: #166534; padding: 8px 12px; border-radius: 6px; font-size: 13px; margin: 0 0 10px; }
.warn-line { background: #fffbeb; border: 1px solid #fde68a; color: #92400e; padding: 8px 12px; border-radius: 6px; font-size: 13px; margin: 0 0 10px; line-height: 1.7; }
.intro { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px 18px; margin-bottom: 14px; font-size: 13px; color: #475569; line-height: 1.75; }
.intro p { margin: 0; }
.intro ul { margin: 8px 0 0; padding-left: 18px; }
.intro li { margin: 4px 0; }
.count { font-size: 13px; color: #475569; margin: 0 0 12px; }
.count .hot { color: #b45309; }

.group { margin-bottom: 18px; }
.group h3 { margin: 0 0 8px; font-size: 14px; color: #0f172a; }

.stage { border: 1px solid #e2e8f0; border-radius: 8px; margin-bottom: 8px; background: #fff; }
.stage.open { border-color: #93c5fd; }
.stage-head {
  width: 100%; display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  background: none; border: none; padding: 10px 14px; cursor: pointer; text-align: left; font-family: inherit;
}
.s-label { font-size: 14px; font-weight: 600; color: #0f172a; }
.s-lane { font-size: 12px; color: #64748b; }
.s-q { font-size: 12px; color: #94a3b8; flex: 1; min-width: 200px; }
.s-tags { display: flex; gap: 6px; flex-wrap: wrap; }
.tag { font-size: 11px; padding: 2px 8px; border-radius: 10px; background: #fef3c7; color: #92400e; }
.tag.plain { background: #f1f5f9; color: #94a3b8; }
.tag.bad { background: #fee2e2; color: #991b1b; }
.s-caret { font-size: 12px; color: #2563eb; }

.editor { padding: 0 14px 14px; }
.field { margin-bottom: 14px; }
.f-head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; margin-bottom: 6px; }
.f-head b { font-size: 13px; color: #0f172a; }
.f-meta { font-size: 12px; color: #64748b; }
.field textarea {
  width: 100%; box-sizing: border-box; border: 1px solid #cbd5e1; border-radius: 6px;
  padding: 10px 12px; font-size: 13px; line-height: 1.8; font-family: inherit; resize: vertical;
}
.field textarea:focus { outline: none; border-color: #2563eb; }
.hint { margin: 6px 0 0; font-size: 12px; color: #b45309; line-height: 1.7; }
details { margin-top: 8px; font-size: 12px; color: #475569; }
details summary { cursor: pointer; color: #2563eb; }
details ol { margin: 6px 0 0; padding-left: 20px; line-height: 1.8; }
.actions { display: flex; align-items: center; gap: 12px; }
.btn-primary { background: #2563eb; color: #fff; border: none; border-radius: 6px; padding: 8px 18px; font-size: 13px; cursor: pointer; }
.btn-primary:disabled { opacity: 0.6; cursor: default; }
.dirty { font-size: 12px; color: #b45309; }
.link { background: none; border: none; color: #2563eb; cursor: pointer; font-size: 12px; padding: 0 2px; }
.empty { color: #94a3b8; font-size: 13px; }
</style>
