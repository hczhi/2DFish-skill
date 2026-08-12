<script setup lang="ts">
// 新版 AI 辅助写作台。主旨：人负责洞察/提问/判断，AI 负责结构化/验证/润色。
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { apiGet, apiPost, apiPut, apiDelete, apiStream, streamSSEData } from '../../lib/api'
import MindTree, { type MindNode } from '../../components/xhs/MindTree.vue'
import SelectionChat, { type ChatResult } from '../../components/xhs/SelectionChat.vue'

// TipTap Editor
import { useEditor, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Highlight from '@tiptap/extension-highlight'

type Stage = 'brief' | 'structure' | 'draft'
const stage = ref<Stage>('brief')
const router = useRouter()

// ---------- 草稿 ----------
const draftId = ref<string | null>(null)
const draftList = ref<Array<{ id: string; title: string; stage: string; updated_at: string }>>([])

// ---------- ① 引导式五栏 ----------
const brief = reactive({ topic: '', judgment: '', materials: '', audience: '', goal: '' })
const skills = ref<Array<{ id: string; name: string }>>([])
const skillId = ref<string>('')
const persona = ref('')
const niche = ref('')

// ---------- ② 结构 ----------
const nodes = ref<MindNode[]>([])
const selectedNode = ref<MindNode | null>(null)
const structuring = ref(false)
const pendingQuestions = ref<Array<{ q: string; options: string[] }>>([])
const answers = reactive<Record<number, string>>({})
const validating = ref(false)
const issues = ref<Array<{ nodeId: string | null; problem: string; fix: string }>>([])
const validated = ref(false)

// ---------- ③ 成文 ----------
const title = ref('')
const body = ref('')
const writing = ref(false)
let abortController: AbortController | null = null
const blockHits = ref<Array<{ term: string; index: number; length: number }>>([])

// TipTap Editor setup
const editor = useEditor({
  content: '',
  extensions: [
    StarterKit,
    Placeholder.configure({ placeholder: '在此撰写正文...' }),
    Highlight.configure({ HTMLAttributes: { class: 'xw-hit-highlight' } })
  ],
  onUpdate: ({ editor }) => {
    body.value = editor.getHTML()
    // 流式成文期间每来一个字符都会 setContent 触发一次 onUpdate，绝不能在这里同步扫描
    // （否则一篇文章几千次 scan 打爆限流）。writing 时完全跳过，成文结束后统一扫一次；
    // 用户手动编辑则走防抖，停笔 300ms 才扫。
    if (writing.value) return
    if (stage.value === 'draft') scanBlocklistDebounced()
  },
  // tiptap v3 的 vue-3 包不再导出 BubbleMenu 组件，改用自绘浮动工具条：
  // 选区非空时按选区坐标定位，选区塌陷/失焦时隐藏。
  onSelectionUpdate: ({ editor }) => updateSelToolbar(editor),
})

// ---------- 划选浮动工具条 ----------
const selToolbar = reactive({ show: false, top: 0, left: 0 })
// 当前选区里命中的禁用词（用于「避开禁用词重写」快捷钮的显隐与诉求文案）
const selHitTerms = ref<string[]>([])
function updateSelToolbar(ed: any) {
  if (writing.value) { selToolbar.show = false; return }
  const { from, to, empty } = ed.state.selection
  const text = ed.state.doc.textBetween(from, to, ' ').trim()
  if (empty || !text) { selToolbar.show = false; return }
  // 前端子串匹配出选区里命中的禁用词，不额外发请求
  selHitTerms.value = blocklist.value.map(b => b.term).filter(t => t && text.includes(t))
  const dom = ed.view.dom as HTMLElement
  const container = dom.closest('.xw-editor-container') as HTMLElement | null
  if (!container) { selToolbar.show = false; return }
  const start = ed.view.coordsAtPos(from)
  const end = ed.view.coordsAtPos(to)
  const box = container.getBoundingClientRect()
  selToolbar.top = Math.min(start.top, end.top) - box.top - 8
  selToolbar.left = (start.left + end.right) / 2 - box.left
  selToolbar.show = true
}
function hideSelToolbar() {
  // 延迟一拍，避免点工具条按钮时因失焦先被隐藏、拿不到选区
  setTimeout(() => { if (editor.value && editor.value.state.selection.empty) selToolbar.show = false }, 150)
}

// ---------- 禁用库 ----------
const blocklist = ref<Array<{ id: string; term: string; kind: 'word' | 'phrase'; note: string }>>([])
const blOpen = ref(false)
const blTerm = ref('')
const blKind = ref<'word' | 'phrase'>('word')

// ---------- 选中对话浮层 ----------
const chatOpen = ref(false)
const chatTitle = ref('')
const chatContext = ref('')
const chatRunner = ref<(message: string, onDelta?: (text: string) => void) => Promise<ChatResult>>(async () => ({ reply: '', preview: '', apply: () => {} }))
const chatPrefill = ref<string | undefined>(undefined)
const chatAutoSend = ref<string | undefined>(undefined)  // 有值时 SelectionChat 打开即自动发（禁用词一键重写）
// 浮层里那个风格下拉。只在「改正文」时给（结构阶段的 node-chat 不吃 styleSkill）。
const chatSkills = ref<Array<{ id: string; name: string }>>([])
// 空 = 跟随①里选的那个。**不回写 skillId**：改一段用了别的风格，不该悄悄把
// 下次「重新成文」的风格也换掉。它是粘的（连改几段不用每次重选），而当前值
// 每次打开都摆在下拉里，所以粘着也看得见。
const reviseSkillId = ref('')
const briefSkillName = computed(() => skills.value.find(s => s.id === skillId.value)?.name || '默认')

// ---------- ① 头脑风暴 / 用户洞察（AI 抛初稿，作者挑改）----------
const bsOpen = ref(false)          // 面板折叠
const bsLoading = ref(false)
const bsIdeas = ref<Array<{ point: string; why: string }>>([])
const rsOpen = ref(false)
const rsLoading = ref(false)
const research = ref<{
  personas: string[]
  painPoints: Array<{ desc: string; hook: string }>
  blindSpots: Array<{ claim: string; explain: string }>
  desires: string[]
  problems: Array<{ question: string; solution: string }>
} | null>(null)

// ---------- ③ 通读诊断（只读）----------
const dxOpen = ref(false)
const dxLoading = ref(false)
const diagnostics = ref<Array<{ dimension: string; finding: string; suggestion: string }>>([])

const briefHasEnough = computed(() =>
  !!(brief.topic.trim() || brief.judgment.trim() || brief.materials.trim())
)

onMounted(async () => {
  try {
    const r = await apiGet<{ skills: Array<{ id: string; name: string }> }>('/api/xhs/skills')
    skills.value = (r as any).skills || (r as any) || []
  } catch { /* 无 skill 不阻塞 */ }
  await Promise.all([loadBlocklist(), loadDrafts()])
})

// ===== 草稿 =====
async function loadDrafts() {
  try { draftList.value = await apiGet('/api/xhs/drafts') } catch { /* ignore */ }
}
async function saveDraft() {
  const payload = { title: title.value, brief, nodes: nodes.value, body: body.value, stage: stage.value }
  try {
    if (draftId.value) {
      await apiPut(`/api/xhs/drafts/${draftId.value}`, payload)
    } else {
      const d = await apiPost<{ id: string }>('/api/xhs/drafts', payload)
      draftId.value = d.id
    }
    await loadDrafts()
  } catch (e: any) { alert(e?.message || '保存草稿失败') }
}
async function openDraft(id: string) {
  const d = await apiGet<any>(`/api/xhs/drafts/${id}`)
  draftId.value = d.id
  Object.assign(brief, JSON.parse(d.brief_json || '{}'))
  nodes.value = JSON.parse(d.structure_json || '[]')
  body.value = d.body || ''
  title.value = d.title || ''
  stage.value = (d.stage as Stage) || 'brief'
  // 换稿子了，上一篇的改写快照必须扔掉：留着的话「↩ 撤销改写」会把 A 稿的正文
  // 贴进 B 稿，而两边都不报错。
  preRewriteBody.value = null
  if (editor.value) {
    editor.value.commands.setContent(body.value)
  }
  if (stage.value === 'draft') scanBlocklist()
}
async function removeDraft(id: string) {
  if (!confirm('删除这篇草稿？')) return
  await apiDelete(`/api/xhs/drafts/${id}`)
  if (draftId.value === id) newDraft()
  await loadDrafts()
}
function newDraft() {
  draftId.value = null
  Object.assign(brief, { topic: '', judgment: '', materials: '', audience: '', goal: '' })
  nodes.value = []; body.value = ''; title.value = ''; issues.value = []; validated.value = false
  pendingQuestions.value = []; stage.value = 'brief'
  preRewriteBody.value = null
  if (editor.value) editor.value.commands.setContent('')
}

watch(stage, () => { if (briefHasEnough.value) saveDraft() })

// ===== ① → ② 定主题搭结构 =====
async function buildStructure() {
  if (!briefHasEnough.value) return
  structuring.value = true
  pendingQuestions.value = []
  try {
    const extra = Object.entries(answers)
      .map(([i, a]) => (a ? `${pendingQuestions.value[+i]?.q || ''} → ${a}` : ''))
      .filter(Boolean).join('\n')
    const materials = extra ? `${brief.materials}\n\n[补充回答]\n${extra}` : brief.materials
    const r = await apiPost<any>('/api/xhs/structure', { ...brief, materials })
    if (r.needsInput) {
      pendingQuestions.value = r.questions || []
      Object.keys(answers).forEach(k => delete answers[+k])
      return
    }
    nodes.value = r.nodes || []
    validated.value = false; issues.value = []
    stage.value = 'structure'
  } catch (e: any) {
    alert(e?.message || '搭结构失败')
  } finally {
    structuring.value = false
  }
}

// ===== ① 头脑风暴 =====
async function runBrainstorm() {
  bsOpen.value = true
  bsLoading.value = true
  try {
    const r = await apiPost<{ ideas: Array<{ point: string; why: string }> }>('/api/xhs/brainstorm', { ...brief })
    bsIdeas.value = r.ideas || []
  } catch (e: any) {
    alert(e?.message || '头脑风暴失败')
  } finally {
    bsLoading.value = false
  }
}
// 采纳后的短暂提示 + 逐条标记（结果面板在下方，采纳的目标栏在页面顶部，不给反馈用户会以为没点上）
const adoptToast = ref('')
let adoptToastTimer: ReturnType<typeof setTimeout> | null = null
function flashAdopt(msg: string) {
  adoptToast.value = msg
  if (adoptToastTimer) clearTimeout(adoptToastTimer)
  adoptToastTimer = setTimeout(() => { adoptToast.value = '' }, 1800)
}
const adoptedIdeas = ref<Set<string>>(new Set())
const adoptedResearch = ref<Set<string>>(new Set())

// 把一个观点采纳进核心观点栏（追加，不覆盖已填的）
function adoptIdea(point: string) {
  brief.judgment = brief.judgment ? `${brief.judgment.trim()}\n${point}` : point
  adoptedIdeas.value.add(point)
  flashAdopt('✓ 已追加到「核心观点」')
}

// ===== ① AI 调研用户 =====
async function runResearch() {
  rsOpen.value = true
  rsLoading.value = true
  try {
    research.value = await apiPost('/api/xhs/research', { ...brief })
  } catch (e: any) {
    alert(e?.message || '调研失败')
  } finally {
    rsLoading.value = false
  }
}
// 采纳一句到指定 brief 栏（追加），文案里带上「（待核实）」提醒这是 AI 假设
function adoptToBrief(field: 'audience' | 'materials', text: string) {
  const line = `${text}（AI假设·待核实）`
  brief[field] = brief[field] ? `${brief[field].trim()}\n${line}` : line
  adoptedResearch.value.add(text)
  flashAdopt(field === 'audience' ? '✓ 已追加到「写给谁看」' : '✓ 已追加到「素材」')
}

// ===== ③ 通读诊断 =====
async function runDiagnose() {
  const plain = editor.value?.getText().trim()
  if (!plain) { alert('先有正文再诊断'); return }
  dxOpen.value = true
  dxLoading.value = true
  // 不在这里清空 diagnostics：诊断中仍显示上一次结果，成功拿到新结果才替换，失败则保留旧的。
  try {
    const r = await apiPost<{ diagnostics: Array<{ dimension: string; finding: string; suggestion: string }> }>(
      '/api/xhs/diagnose', { body: plain }
    )
    diagnostics.value = r.diagnostics || []
    dxSourceLen.value = plain.length  // 记下这次诊断针对的正文长度，正文变了给用户提示「已过期」
  } catch (e: any) {
    alert(e?.message || '诊断失败')
  } finally {
    dxLoading.value = false
  }
}
// 重开抽屉看上次诊断结果，不重新调用 AI（关闭只是收起，数据一直在）。
function reopenDiagnose() {
  dxOpen.value = true
}
// 上次诊断针对的正文长度；当前正文长度与之不同时提示结果可能过期。
const dxSourceLen = ref(0)
const dxStale = computed(() =>
  diagnostics.value.length > 0 && (editor.value?.getText().trim().length || 0) !== dxSourceLen.value
)

function addRootTheme() {
  if (nodes.value.some(n => n.type === 'theme')) return
  nodes.value = [{ id: 'u' + Math.random().toString(36).slice(2, 9), parentId: null, type: 'theme', text: '', order: 0 }]
  stage.value = 'structure'
}

// ===== ② 选中节点 → 对话 =====
function onSelectNode(node: MindNode) {
  selectedNode.value = node
}
function chatWithNode() {
  const node = selectedNode.value
  if (!node) return
  chatTitle.value = '和 AI 讨论这个节点'
  chatContext.value = node.text || '(空节点)'
  // 结构阶段不给风格下拉：/structure/node-chat 只吃 xhs-structure 那个底层 skill，
  // 摆一个它读不到的选项出来，用户换了没反应，而返回的结构看着完全正常。
  chatSkills.value = []
  chatAutoSend.value = undefined
  chatPrefill.value = undefined
  chatRunner.value = async (message: string): Promise<ChatResult> => {
    const r = await apiPost<{ reply: string; updateNode: { id: string; text: string } | null; addNodes: MindNode[] }>(
      '/api/xhs/structure/node-chat', { node, nodes: nodes.value, message }
    )
    const preview = [
      r.updateNode ? `改写本节点：\n${r.updateNode.text}` : '',
      r.addNodes?.length ? `新增 ${r.addNodes.length} 个子节点：\n` + r.addNodes.map(n => `· ${n.text}`).join('\n') : '',
    ].filter(Boolean).join('\n\n') || '(AI 未提出修改)'
    return {
      reply: r.reply || '',
      preview,
      apply: () => {
        let next = nodes.value
        if (r.updateNode) next = next.map(n => (n.id === r.updateNode!.id ? { ...n, text: r.updateNode!.text } : n))
        if (r.addNodes?.length) {
          const mapped = r.addNodes.map((n, i) => ({
            ...n, id: 'u' + Math.random().toString(36).slice(2, 9) + i,
            order: next.filter(x => x.parentId === n.parentId).length + i,
          }))
          next = [...next, ...mapped]
        }
        nodes.value = next
      },
    }
  }
  chatOpen.value = true
}

// ===== ② 自检 =====
async function validateStructure() {
  if (!nodes.value.length) return
  validating.value = true
  try {
    const r = await apiPost<{ ok: boolean; issues: any[] }>('/api/xhs/structure/validate', { nodes: nodes.value })
    issues.value = r.issues || []
    validated.value = true
  } catch (e: any) {
    alert(e?.message || '自检失败')
  } finally {
    validating.value = false
  }
}

// ===== ② → ③ 成文（流式）=====
async function write() {
  if (!nodes.value.length) return
  
  // 防呆设计：检查是否有正文，避免覆盖
  if (body.value.trim() && !confirm('发现已有生成的文本，继续操作将覆盖现有内容。是否确认覆盖？\n（若想追加内容，请点击取消后手动操作）')) {
    stage.value = 'draft'
    return
  }

  writing.value = true
  stage.value = 'draft'
  title.value = ''
  body.value = ''
  blockHits.value = []
  preRewriteBody.value = null   // 重新成文了，旧快照回滚回去只会是另一篇
  if (editor.value) editor.value.commands.setContent('')
  abortController = new AbortController()
  let acc = ''
  let truncated = false

  try {
    const res = await apiStream('/api/xhs/write', {
      brief,
      nodes: nodes.value,
      skillId: skillId.value || undefined,
      persona: persona.value || undefined,
      niche: niche.value || undefined,
    }, { signal: abortController.signal, failMessage: '生成失败' })

    for await (const parsed of streamSSEData(res)) {
      // 后端在流里推的错误事件（上游报错/空返回）：抛出去让外层 catch 弹提示、停转圈。
      if (parsed.error) throw new Error(parsed.error)
      if (parsed.truncated) truncated = true
      const delta = parsed.delta
      if (delta) {
        acc += delta
        const nl = acc.indexOf('\n')
        if (nl === -1) { title.value = acc }
        else {
          title.value = acc.slice(0, nl).trim()
          const content = acc.slice(nl + 1).trim()
          const html = content.split('\n').map(p => p ? `<p>${p}</p>` : '<p><br></p>').join('')
          body.value = html
          if (editor.value) {
            editor.value.commands.setContent(html)
            // 自动滚动到底部
            editor.value.commands.focus('end')
          }
        }
      }
    }
    await saveDraft()
    scanBlocklist()
    // 撞上模型输出上限的稿子结尾是断在半句话上的，和写完的长得一样 —— 必须说出来。
    if (truncated) alert('⚠️ 这篇撞到了模型的输出长度上限，结尾是断的。建议把结构拆短一点重新成文，或者手动续写结尾。')
  } catch (e: any) {
    if (e.name === 'AbortError') {
      console.log('生成已手动停止')
    } else {
      alert(e?.message || '成文失败')
    }
  } finally {
    writing.value = false
    abortController = null
  }
}

function stopGeneration() {
  if (abortController) {
    abortController.abort()
  }
}

// ===== ③ 选中正文片段 → 修改 =====
// 打开「选中→对话→采纳」浮层；autoSend 有值时（禁用词一键重写）打开即自动发。
function openReviseChat(sel: string, title: string, autoSend?: string) {
  const { from, to } = editor.value!.state.selection
  chatTitle.value = title
  chatContext.value = sel
  chatAutoSend.value = autoSend
  chatPrefill.value = undefined   // 别把「全文改写」那句诉求带进改片段的框里
  chatSkills.value = skills.value
  chatRunner.value = async (message: string): Promise<ChatResult> => {
    const plainBody = editor.value?.getText() || ''
    const r = await apiPost<{ reply: string; revised: string }>('/api/xhs/revise', {
      body: plainBody, selection: sel, message,
      // 浮层里选了就用它，没选（空）才跟随①。读的是 ref 而不是打开时的快照，
      // 所以用户可以先改下拉再点「发给 AI」。
      skillId: reviseSkillId.value || skillId.value || undefined,
      persona: persona.value || undefined, niche: niche.value || undefined,
    })
    return {
      reply: r.reply || '',
      preview: r.revised,
      apply: () => {
        if (editor.value) {
          // 只替换原选区，避免把全文覆盖
          editor.value.chain().focus().insertContentAt({ from, to }, r.revised).run()
          scanBlocklist()
        }
      },
    }
  }
  chatOpen.value = true
  selToolbar.show = false
}

function reviseSelection() {
  if (!editor.value) return
  const { from, to } = editor.value.state.selection
  const sel = editor.value.state.doc.textBetween(from, to, ' ')
  if (!sel) { alert('先在正文里选中要改的一段'); return }
  openReviseChat(sel, '修改选中片段')
}

// 一键：把选区里命中的禁用词换掉（诉求自动生成，无需手动打字）
function reviseAvoidBlocked() {
  if (!editor.value) return
  const { from, to } = editor.value.state.selection
  const sel = editor.value.state.doc.textBetween(from, to, ' ')
  if (!sel) { alert('先在正文里选中要改的一段'); return }
  const terms = selHitTerms.value
  if (!terms.length) { alert('这段里没有命中禁用词'); return }
  const msg = `请把这段里的这些禁用词/表达换成自然、贴合语境的说法，改完不要再出现它们：${terms.join('、')}。其余内容尽量保持原样、别改动。`
  openReviseChat(sel, '避开禁用词重写', msg)
}

// ===== ③ 全文改写 =====
// 默认诉求。预填而**不自动发**：全文改写一次就是一整篇的 token，
// 得让用户先把风格挑好再点发送。
const REWRITE_PREFILL = '按所选的写作风格重写全文：保留原文的论点、真实素材和事实，只换表达方式，篇幅别缩水。'
// 采纳前的正文。改写是唯一一个「一下子换掉整篇」的操作，而流式 setContent 会把
// 编辑器的撤销栈冲掉 —— 没有这一份快照，用户手改过的那些内容就真的没了，
// 而界面上只显示「改写成功」。
const preRewriteBody = ref<string | null>(null)

function rewriteAll() {
  const plain = editor.value?.getText().trim() || ''
  if (!plain) { alert('正文还是空的，没什么可改写的'); return }
  chatTitle.value = '全文改写'
  chatContext.value = plain
  chatAutoSend.value = undefined
  chatPrefill.value = REWRITE_PREFILL
  chatSkills.value = skills.value
  chatRunner.value = async (message, onDelta): Promise<ChatResult> => {
    const res = await apiStream('/api/xhs/rewrite', {
      body: plain, message,
      skillId: reviseSkillId.value || skillId.value || undefined,
      persona: persona.value || undefined, niche: niche.value || undefined,
    }, { failMessage: '改写失败' })
    let acc = ''
    let truncated = false
    for await (const parsed of streamSSEData(res)) {
      if (parsed.error) throw new Error(parsed.error)
      if (parsed.truncated) truncated = true
      if (parsed.delta) { acc += parsed.delta; onDelta?.(acc) }
    }
    const text = acc.trim()
    if (!text) throw new Error('AI 没有返回内容，请重试')
    return {
      // 截断必须挡在采纳前面说：结尾断在半句话上的稿子和写完的稿子长得一模一样。
      reply: truncated
        ? '⚠️ 这次撞到了模型的输出长度上限，下面这版**结尾是断的**。采纳前先看一眼结尾，或者把正文分两段分别改写。'
        : '已按所选风格重写全文。采纳会替换整篇正文（标题不动），之后可以点「↩ 撤销改写」还原。',
      preview: text,
      apply: () => {
        preRewriteBody.value = body.value
        const html = text.split('\n').map(p => p.trim() ? `<p>${p}</p>` : '<p><br></p>').join('')
        body.value = html
        if (editor.value) editor.value.commands.setContent(html)
        scanBlocklist()
      },
    }
  }
  chatOpen.value = true
}

function undoRewrite() {
  if (preRewriteBody.value === null) return
  body.value = preRewriteBody.value
  if (editor.value) editor.value.commands.setContent(preRewriteBody.value)
  preRewriteBody.value = null
  scanBlocklist()
}

// ===== 禁用库 =====
async function loadBlocklist() {
  try { blocklist.value = await apiGet('/api/xhs/blocklist') } catch { /* ignore */ }
}
async function addBlock() {
  const t = blTerm.value.trim()
  if (!t) return
  await apiPost('/api/xhs/blocklist', { term: t, kind: blKind.value })
  blTerm.value = ''
  await loadBlocklist()
  if (stage.value === 'draft') scanBlocklist()
}
async function addSelectionToBlock() {
  if (!editor.value) return
  const { from, to } = editor.value.state.selection
  const sel = editor.value.state.doc.textBetween(from, to, ' ').trim()
  if (!sel) { alert('先选中一个词或表达'); return }
  const kind: 'word' | 'phrase' = sel.length <= 6 && !/\s/.test(sel) ? 'word' : 'phrase'
  await apiPost('/api/xhs/blocklist', { term: sel, kind })
  await loadBlocklist()
  scanBlocklist()
  selToolbar.show = false
}
async function removeBlock(id: string) {
  await apiDelete(`/api/xhs/blocklist/${id}`)
  await loadBlocklist()
  if (stage.value === 'draft') scanBlocklist()
}

// 扫描禁用词
async function scanBlocklist() {
  if (!editor.value || !body.value.trim()) { blockHits.value = []; return }
  try {
    const plainText = editor.value.getText()
    const r = await apiPost<{ hits: any[] }>('/api/xhs/blocklist/scan', { body: plainText })
    blockHits.value = r.hits || []
  } catch { blockHits.value = [] }
}

// 防抖版：用户手动编辑时用，停笔 300ms 才真正发一次扫描请求，避免逐字触发。
let scanTimer: ReturnType<typeof setTimeout> | null = null
function scanBlocklistDebounced() {
  if (scanTimer) clearTimeout(scanTimer)
  scanTimer = setTimeout(() => { scanBlocklist() }, 300)
}

const hitTerms = computed(() => {
  const set = new Set(blockHits.value.map(h => h.term))
  return Array.from(set)
})
</script>

<template>
  <div class="xw-page hc-grid-bg">
    <transition name="xw-toast">
      <div v-if="adoptToast" class="xw-toast">{{ adoptToast }}</div>
    </transition>
    
    <!-- 左侧常驻极简边栏：草稿列表 -->
    <aside class="xw-sidebar">
      <div class="xw-sidebar-head">
        <h2>写作台草稿</h2>
        <button class="xw-btn-primary xw-btn-new" @click="newDraft">＋</button>
      </div>
      <div class="xw-drafts-list">
        <div v-for="d in draftList" :key="d.id" class="xw-draft" :class="{ on: d.id === draftId }">
          <button class="xw-draft-open" @click="openDraft(d.id)">
            <span class="d-title">{{ d.title || '未命名草稿' }}</span>
            <span class="d-stage">{{ d.stage === 'brief' ? '① 想法' : d.stage === 'structure' ? '② 结构' : '③ 成文' }}</span>
          </button>
          <button class="xw-btn-icon danger xw-draft-del" @click="removeDraft(d.id)">✕</button>
        </div>
        <div v-if="!draftList.length" class="xw-empty-hint">暂无草稿</div>
      </div>
    </aside>

    <div class="xw-wrap">
      <!-- 顶栏 -->
      <header class="xw-header">
        <div class="xw-brand-group">
          <button class="xw-btn-back" @click="router.push('/xhs')" title="返回主页">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="19" y1="12" x2="5" y2="12"></line>
              <polyline points="12 19 5 12 12 5"></polyline>
            </svg>
          </button>
          <div class="xw-brand">
            <h1>AI Copilot</h1>
            <span class="xw-tagline">人负责洞察·提问·判断，AI 负责结构化·验证·润色</span>
          </div>
        </div>
        <div class="xw-header-actions">
          <button v-if="stage === 'draft' && body" class="xw-btn-secondary" :disabled="dxLoading" @click="runDiagnose">
            {{ dxLoading ? '诊断中…' : '🩺 通读诊断' }}
          </button>
          <button v-if="stage === 'draft' && diagnostics.length && !dxOpen" class="xw-btn-secondary" @click="reopenDiagnose">
            📋 查看上次诊断
          </button>
          <button class="xw-btn-secondary" @click="blOpen = true">🚫 禁用库（{{ blocklist.length }}）</button>
          <button class="xw-btn-secondary" @click="saveDraft">💾 存草稿</button>
        </div>
      </header>

      <!-- stage 进度 -->
      <nav class="xw-steps">
        <button :class="{ on: stage === 'brief' }" @click="stage = 'brief'">① 想法</button>
        <span class="sep">›</span>
        <button :class="{ on: stage === 'structure' }" :disabled="!nodes.length" @click="stage = 'structure'">② 结构</button>
        <span class="sep">›</span>
        <button :class="{ on: stage === 'draft' }" :disabled="!body && !writing" @click="stage = 'draft'">③ 成文</button>
      </nav>

      <div class="xw-main-container">
        <!-- ========== ① 引导式五栏 ========== -->
        <section v-if="stage === 'brief'" class="xw-stage xw-card">
          <p class="xw-hint">先把你的洞察交出来——AI 不替你想，只帮你把想法理成结构。素材越具体，成稿越不像 AI。</p>
          
          <div class="xw-compact-row">
            <label class="xw-field"><span>写给谁看</span><input v-model="brief.audience" placeholder="目标读者" /></label>
            <label class="xw-field"><span>想要的效果</span><input v-model="brief.goal" placeholder="共鸣 / 涨粉 / 种草" /></label>
            <label class="xw-field"><span>写作风格</span>
              <select v-model="skillId">
                <option value="">默认</option>
                <option v-for="s in skills" :key="s.id" :value="s.id">{{ s.name }}</option>
              </select>
            </label>
            <label class="xw-field"><span>赛道/人群</span><input v-model="niche" placeholder="如：职场女性" /></label>
          </div>

          <label class="xw-field mt-4"><span>主题方向</span>
            <input v-model="brief.topic" placeholder="想写什么？例：远程办公一年后的真实感受" /></label>
          <label class="xw-field mt-4"><span>核心观点 / 反常识判断</span>
            <textarea v-model="brief.judgment" rows="2" placeholder="你要表达的那个有立场、可能有人反对的判断" /></label>
          <label class="xw-field mt-4"><span>手上的真实素材、细节、数字</span>
            <textarea v-model="brief.materials" rows="4" placeholder="具体的人、对话、时间、数字、翻车瞬间——越具体越好，这是真人味的来源" /></label>

          <!-- AI 辅助想法：默认收起，按需展开 -->
          <div class="xw-assist mt-4">
            <div class="xw-assist-tabs">
              <button class="xw-assist-btn" :disabled="bsLoading" @click="runBrainstorm">
                {{ bsLoading ? '发散中…' : '🧠 帮我发散观点' }}
              </button>
              <button class="xw-assist-btn" :disabled="rsLoading" @click="runResearch">
                {{ rsLoading ? '调研中…' : '🔍 调研目标用户' }}
              </button>
            </div>

            <!-- 头脑风暴结果 -->
            <div v-if="bsOpen" class="xw-assist-panel">
              <div class="xw-assist-head">
                <span>🧠 观点发散（AI 抛的角度，挑一个改成你的）</span>
                <button class="xw-assist-x" @click="bsOpen = false">收起</button>
              </div>
              <p v-if="!bsLoading && !bsIdeas.length" class="xw-assist-empty">还没有结果，点上面「帮我发散观点」。</p>
              <div v-for="(idea, i) in bsIdeas" :key="i" class="xw-idea">
                <div class="xw-idea-body">
                  <div class="xw-idea-point">{{ idea.point }}</div>
                  <div class="xw-idea-why">↳ {{ idea.why }}</div>
                </div>
                <button class="xw-adopt-mini" :class="{ done: adoptedIdeas.has(idea.point) }" @click="adoptIdea(idea.point)">{{ adoptedIdeas.has(idea.point) ? '✓ 已用' : '用这个 →' }}</button>
              </div>
            </div>

            <!-- 用户洞察结果（全部标 待核实）-->
            <div v-if="rsOpen" class="xw-assist-panel">
              <div class="xw-assist-head">
                <span>🔍 用户洞察 <em class="xw-assumption">· AI 假设，需你核实成真实的</em></span>
                <button class="xw-assist-x" @click="rsOpen = false">收起</button>
              </div>
              <p v-if="rsLoading" class="xw-assist-empty">AI 调研中…</p>
              <template v-else-if="research">
                <div class="xw-rs-group">
                  <h5>受众角色</h5>
                  <div v-for="(p, i) in research.personas" :key="'p'+i" class="xw-rs-item">
                    <span>{{ p }}</span>
                    <button class="xw-adopt-mini" :class="{ done: adoptedResearch.has(p) }" @click="adoptToBrief('audience', p)">{{ adoptedResearch.has(p) ? '✓ 已采纳' : '采纳→受众' }}</button>
                  </div>
                </div>
                <div class="xw-rs-group">
                  <h5>痛点</h5>
                  <div v-for="(p, i) in research.painPoints" :key="'pp'+i" class="xw-rs-item">
                    <span><b>「{{ p.hook }}」</b> {{ p.desc }}</span>
                    <button class="xw-adopt-mini" :class="{ done: adoptedResearch.has(p.desc) }" @click="adoptToBrief('materials', p.desc)">{{ adoptedResearch.has(p.desc) ? '✓ 已采纳' : '采纳→素材' }}</button>
                  </div>
                </div>
                <div class="xw-rs-group">
                  <h5>认知盲区</h5>
                  <div v-for="(p, i) in research.blindSpots" :key="'bs'+i" class="xw-rs-item">
                    <span><b>{{ p.claim }}</b> — {{ p.explain }}</span>
                    <button class="xw-adopt-mini" :class="{ done: adoptedResearch.has(p.claim + '——' + p.explain) }" @click="adoptToBrief('materials', p.claim + '——' + p.explain)">{{ adoptedResearch.has(p.claim + '——' + p.explain) ? '✓ 已采纳' : '采纳→素材' }}</button>
                  </div>
                </div>
                <div class="xw-rs-group">
                  <h5>渴望</h5>
                  <div v-for="(p, i) in research.desires" :key="'d'+i" class="xw-rs-item">
                    <span>{{ p }}</span>
                    <button class="xw-adopt-mini" :class="{ done: adoptedResearch.has(p) }" @click="adoptToBrief('materials', p)">{{ adoptedResearch.has(p) ? '✓ 已采纳' : '采纳→素材' }}</button>
                  </div>
                </div>
                <div class="xw-rs-group">
                  <h5>问题 + 方案</h5>
                  <div v-for="(p, i) in research.problems" :key="'q'+i" class="xw-rs-item">
                    <span><b>Q:</b> {{ p.question }}　<b>A:</b> {{ p.solution }}</span>
                    <button class="xw-adopt-mini" :class="{ done: adoptedResearch.has(p.question + ' → ' + p.solution) }" @click="adoptToBrief('materials', p.question + ' → ' + p.solution)">{{ adoptedResearch.has(p.question + ' → ' + p.solution) ? '✓ 已采纳' : '采纳→素材' }}</button>
                  </div>
                </div>
              </template>
            </div>
          </div>

          <!-- AI 选项式反问 -->
          <div v-if="pendingQuestions.length" class="xw-questions">
            <p class="xw-q-head">AI 想先跟你确认几件事（选一个，或自己填）：</p>
            <div v-for="(q, i) in pendingQuestions" :key="i" class="xw-q">
              <div class="xw-q-text">{{ q.q }}</div>
              <div class="xw-q-opts">
                <button v-for="(o, j) in q.options" :key="j" :class="{ on: answers[i] === o }" @click="answers[i] = o">{{ o }}</button>
              </div>
              <input class="xw-q-input" :value="q.options.includes(answers[i]) ? '' : (answers[i] || '')"
                placeholder="都不满意？自己填…" @input="answers[i] = ($event.target as HTMLInputElement).value" />
            </div>
          </div>

          <div class="xw-actions mt-6">
            <button class="xw-btn-primary" :disabled="!briefHasEnough || structuring" @click="buildStructure">
              <span v-if="structuring" class="xw-loader-dots">AI 搭结构中...</span>
              <span v-else>{{ pendingQuestions.length ? '带上回答，再搭结构 →' : 'AI 定主题 + 搭结构 →' }}</span>
            </button>
            <button class="xw-btn-secondary" @click="addRootTheme">或手动搭结构</button>
          </div>
        </section>

        <!-- ========== ② 结构确认 ========== -->
        <section v-else-if="stage === 'structure'" class="xw-stage xw-card">
          <p class="xw-hint">这是文章的骨架。增删改节点、选中某个节点让 AI 帮你补，确认撑得住了再成文。</p>
          <div class="xw-struct">
            <MindTree v-model:nodes="nodes" :selectedId="selectedNode?.id || null" :issues="issues" @select="onSelectNode" />
          </div>
          <div v-if="selectedNode" class="xw-selbar">
            <span>已选中：「{{ selectedNode.text || '(空节点)' }}」</span>
            <button class="xw-btn-mini" @click="chatWithNode">💬 让 AI 补充/改写</button>
          </div>
          <!-- 自检结果 -->
          <div v-if="validated" class="xw-issues">
            <div v-if="!issues.length" class="xw-ok">✅ AI 审过了，结构撑得住，可以成文。</div>
          </div>
          <div class="xw-actions mt-6">
            <button class="xw-btn-secondary" :disabled="validating" @click="validateStructure">
              {{ validating ? 'AI 审查中…' : '🔍 AI 自检结构' }}
            </button>
            <button v-if="body" class="xw-btn-primary danger" @click="write">
              ⚠️ 重新成文 (覆盖现有)
            </button>
            <button v-if="body" class="xw-btn-primary" @click="stage = 'draft'">
              继续查看正文 →
            </button>
            <button v-else class="xw-btn-primary" :disabled="writing || !nodes.length" @click="write">
              {{ writing ? '成文中…' : '结构确认，开始成文 →' }}
            </button>
          </div>
        </section>

        <!-- ========== ③ 成文 + 修改 (双栏结构) ========== -->
        <section v-else class="xw-draft-split">
          <div class="xw-draft-left xw-card">
            <h3 class="xw-col-title">文章大纲参考</h3>
            <div class="xw-draft-left-tree">
              <MindTree v-model:nodes="nodes" :selectedId="selectedNode?.id || null" :issues="issues" :readonly="true" @select="onSelectNode" />
            </div>
          </div>
          <div class="xw-draft-right xw-card">
            
            <!-- 等待骨架屏 -->
            <div v-if="writing && !title && !body" class="xw-skeleton-container">
              <div class="xw-skeleton-title"></div>
              <div class="xw-skeleton-text" style="width: 100%"></div>
              <div class="xw-skeleton-text" style="width: 90%"></div>
              <div class="xw-skeleton-text" style="width: 95%"></div>
              <div class="xw-skeleton-text" style="width: 60%"></div>
              <div class="xw-skeleton-tip">✨ AI 正在根据大纲奋笔疾书，请稍候...</div>
            </div>

            <!-- 实际内容区 -->
            <div v-show="!(writing && !title && !body)">
              <div class="xw-draft-header">
                <input v-model="title" class="xw-title-input" placeholder="输入标题..." :disabled="writing" />
              </div>
              <!-- 禁用词命中提示 -->
              <div v-if="hitTerms.length" class="xw-blockhit">
                ⚠ 命中禁用词：
                <span v-for="t in hitTerms" :key="t" class="xw-hit-tag">{{ t }}</span>
                <span class="xw-hit-tip">（划选正文可进行修改）</span>
              </div>
              
              <div class="xw-editor-container" :class="{'is-writing': writing}">
                <div
                  v-if="selToolbar.show"
                  class="xw-bubble-menu"
                  :style="{ top: selToolbar.top + 'px', left: selToolbar.left + 'px' }"
                >
                  <button
                    v-if="selHitTerms.length"
                    class="bm-btn bm-warn"
                    @mousedown.prevent
                    @click="reviseAvoidBlocked"
                  >🔁 避开禁用词重写</button>
                  <button class="bm-btn" @mousedown.prevent @click="reviseSelection">✨ 和 AI 沟通/改写</button>
                  <button class="bm-btn bm-danger" @mousedown.prevent @click="addSelectionToBlock">🚫 加入禁用库</button>
                </div>
                <editor-content :editor="editor" class="xw-tiptap" @blur.capture="hideSelToolbar" />
              </div>
            </div>

            <div class="xw-actions mt-6">
              <button class="xw-btn-secondary" @click="stage = 'structure'" :disabled="writing">← 修改结构</button>
              <button class="xw-btn-secondary" @click="rewriteAll" :disabled="writing || !body">🔄 全文改写</button>
              <button v-if="preRewriteBody !== null" class="xw-btn-secondary" @click="undoRewrite">↩ 撤销改写</button>
              <button v-if="writing" class="xw-btn-primary danger" @click="stopGeneration">
                <span class="icon">⏹</span> 停止生成
              </button>
              <button v-else class="xw-btn-primary" @click="saveDraft" :disabled="!title || !body">
                💾 保存
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>

    <!-- 禁用库右侧抽屉 -->
    <div class="xw-drawer-mask" :class="{ 'is-open': blOpen }" @click.self="blOpen = false">
      <div class="xw-drawer" :class="{ 'is-open': blOpen }">
        <div class="xw-drawer-head">
          <h3>禁用表达库</h3>
          <button class="xw-btn-icon" @click="blOpen = false">✕</button>
        </div>
        <div class="xw-drawer-body">
          <div class="xw-bl-add">
            <input v-model="blTerm" placeholder="不想再看到的词 / 表达" @keydown.enter="addBlock" />
            <select v-model="blKind">
              <option value="word">词 (精确)</option>
              <option value="phrase">句式 (模糊)</option>
            </select>
            <button class="xw-btn-primary" @click="addBlock">加入</button>
          </div>
          <p class="xw-bl-note">「词」会在成文后提示；「表达/句式」只在生成时告知 AI 尽量避免。</p>
          <div class="xw-bl-list">
            <div v-for="b in blocklist" :key="b.id" class="xw-bl-item">
              <span class="xw-bl-kind" :class="b.kind">{{ b.kind === 'word' ? '词' : '表达' }}</span>
              <span class="xw-bl-term">{{ b.term }}</span>
              <button class="xw-btn-icon danger" @click="removeBlock(b.id)">✕</button>
            </div>
            <p v-if="!blocklist.length" class="xw-bl-empty">暂无禁用词。</p>
          </div>
        </div>
      </div>
    </div>

    <!-- 通读诊断抽屉（只读建议，不改稿）-->
    <div class="xw-drawer-mask" :class="{ 'is-open': dxOpen }" @click.self="dxOpen = false">
      <div class="xw-drawer xw-drawer-wide" :class="{ 'is-open': dxOpen }">
        <div class="xw-drawer-head">
          <h3>🩺 AI 通读诊断</h3>
          <button class="xw-btn-icon" @click="dxOpen = false">✕</button>
        </div>
        <div class="xw-drawer-body">
          <p class="xw-bl-note">AI 只给建议、不替你改。看完自己用划选工具改，判断权在你。</p>
          <p v-if="dxStale && !dxLoading" class="xw-dx-stale">⚠ 正文已改动，这是上一次诊断的结果，可能已过期。点「🩺 通读诊断」重新体检。</p>
          <p v-if="dxLoading" class="xw-assist-empty">AI 通读中…</p>
          <div v-for="(d, i) in diagnostics" :key="i" class="xw-dx-card">
            <div class="xw-dx-dim">{{ d.dimension }}</div>
            <div class="xw-dx-finding">{{ d.finding }}</div>
            <div class="xw-dx-sugg">💡 {{ d.suggestion }}</div>
          </div>
          <p v-if="!dxLoading && !diagnostics.length" class="xw-bl-empty">还没有诊断结果。</p>
        </div>
      </div>
    </div>

    <!-- 统一选中对话浮层 -->
    <SelectionChat
      :open="chatOpen" :title="chatTitle" :context="chatContext" :runner="chatRunner" :auto-send="chatAutoSend"
      :prefill="chatPrefill"
      :skills="chatSkills" v-model:skillId="reviseSkillId" :follow-label="'跟随①：' + briefSkillName"
      @close="chatOpen = false; chatAutoSend = undefined; chatPrefill = undefined"
    />
  </div>
</template>

<style scoped>
/* HC Design System 基础规范 (适配 XHS 红) */
.xw-page {
  --hc-primary: #FF2442;
  --hc-primary-hover: #E01E36;
  --hc-bg-gray: #F9FAFB;
  --hc-border: #E5E7EB;
  --hc-text-main: #111827;
  --hc-text-sub: #6B7280;
  
  height: 100vh; display: flex; flex-direction: row; font-family: Inter, system-ui, sans-serif; color: var(--hc-text-main); overflow: hidden; position: relative;
}

/* 全局布局与背景 */
.hc-grid-bg {
  background-color: #faf9f7;
  background-image: linear-gradient(rgba(0,0,0,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.03) 1px, transparent 1px);
  background-size: 40px 40px;
}

/* 左侧固定侧边栏 (Mac OS Dock 风格悬浮) */
.xw-sidebar {
  width: 280px; flex: none; 
  background: rgba(255,255,255,0.7); backdrop-filter: blur(20px) saturate(180%);
  border: 1px solid rgba(255,255,255,0.6); box-shadow: 4px 0 24px rgba(0,0,0,0.06);
  display: flex; flex-direction: column; padding: 24px 16px;
  position: fixed; left: -260px; top: 16px; bottom: 16px; z-index: 100;
  border-radius: 0 16px 16px 0;
  transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.xw-sidebar:hover { left: 0; }
.xw-sidebar::after {
  content: ''; position: absolute; right: 8px; top: 50%; transform: translateY(-50%);
  width: 4px; height: 40px; background: rgba(0,0,0,0.15); border-radius: 4px;
  transition: opacity 0.3s;
}
.xw-sidebar:hover::after { opacity: 0; }

.xw-sidebar-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
.xw-sidebar-head h2 { font-size: 16px; font-weight: 600; margin: 0; }
.xw-btn-new { padding: 4px 12px; font-size: 16px; border-radius: 6px; }

.xw-drafts-list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; }
.xw-draft { display: flex; gap: 6px; align-items: stretch; }
.xw-draft-open { 
  flex: 1; text-align: left; background: transparent; border: 1px solid transparent; 
  border-radius: 8px; padding: 10px 12px; cursor: pointer; transition: all 0.2s ease;
}
.xw-draft-open:hover { background: rgba(255,255,255,0.5); }
.xw-draft.on .xw-draft-open { background: #fff; border-color: #E5E7EB; box-shadow: 0 4px 12px rgba(0,0,0,0.02); }
.d-title { display: block; font-size: 14px; font-weight: 500; color: #111827; margin-bottom: 4px; }
.d-stage { font-size: 12px; color: #6B7280; }
.xw-draft-del { opacity: 0; transition: opacity 0.2s; }
.xw-draft:hover .xw-draft-del { opacity: 1; }
.xw-empty-hint { text-align: center; font-size: 13px; color: #9CA3AF; margin-top: 40px; }

/* 主内容区 */
.xw-wrap { 
  flex: 1; display: flex; flex-direction: column; 
  width: 100%; max-width: none; margin: 0; padding: 24px 60px 0 60px; box-sizing: border-box; height: 100vh;
}
.xw-header { display: flex; align-items: flex-end; justify-content: space-between; margin-bottom: 24px; flex: none; }
.xw-brand-group { display: flex; align-items: flex-start; gap: 16px; }
.xw-btn-back {
  display: flex; align-items: center; justify-content: center;
  width: 36px; height: 36px; border: 1px solid #E5E7EB; border-radius: 10px;
  background: #fff; color: #4B5563; cursor: pointer; transition: all 0.2s;
  flex: none; margin-top: 2px;
}
.xw-btn-back:hover { background: #F9FAFB; color: var(--hc-primary); border-color: var(--hc-primary); transform: translateX(-2px); }
.xw-brand h1 { font-size: 24px; margin: 0; font-weight: 700; letter-spacing: -0.5px; line-height: 1.2; }
.xw-tagline { font-size: 13px; color: #6B7280; display: block; margin-top: 4px; }
.xw-header-actions { display: flex; gap: 12px; }

/* 步骤导航 */
.xw-steps { display: flex; align-items: center; gap: 12px; margin-bottom: 24px; flex: none; }
.xw-steps button { border: none; background: none; cursor: pointer; font-size: 15px; color: #9CA3AF; padding: 6px 12px; border-radius: 8px; font-weight: 500; transition: all 0.2s; }
.xw-steps button.on { color: var(--hc-primary); background: rgba(255, 36, 66, 0.1); }
.xw-steps .sep { color: #D1D5DB; }

/* 主体内容滚动区 */
.xw-main-container {
  flex: 1; display: flex; flex-direction: column; overflow: hidden; position: relative;
}
.xw-stage {
  flex: 1; overflow-y: auto; display: flex; flex-direction: column; padding-bottom: 80px; /* 留出底部 actions 空间 */
}

/* 卡片模块 (HC Design) */
.xw-card { background: #FFFFFF; border-radius: 12px; padding: 24px; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.03); border: 1px solid #F3F4F6; }
.xw-hint { font-size: 13px; color: #6B7280; background: #F9FAFB; padding: 12px 16px; border-radius: 8px; margin: 0 0 20px; border-left: 3px solid var(--hc-primary); flex: none; }

/* 表单系统 */
.xw-field { display: block; }
.xw-field > span { display: block; font-size: 13px; color: #4B5563; margin-bottom: 6px; font-weight: 600; }
.xw-field input, .xw-field textarea, .xw-field select {
  width: 100%; box-sizing: border-box; border: 1px solid #E5E7EB; border-radius: 8px; background: #F9FAFB;
  padding: 12px 16px; font: inherit; transition: all 0.2s;
}
.xw-field input:focus, .xw-field textarea:focus, .xw-field select:focus {
  background: #fff; border-color: var(--hc-primary); box-shadow: 0 0 0 4px rgba(255, 36, 66, 0.15); outline: none;
}
.xw-compact-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; }
.mt-4 { margin-top: 16px; }
.mt-6 { margin-top: 24px; }

/* 按钮系统 */
button { font-family: inherit; }
.xw-btn-primary { 
  border: none; background: var(--hc-primary); color: #fff; border-radius: 8px; padding: 10px 20px; cursor: pointer; 
  font-weight: 600; transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
}
.xw-btn-primary:hover:not(:disabled) { background: var(--hc-primary-hover); transform: translateY(-2px); box-shadow: 0 4px 12px rgba(255, 36, 66, 0.3); }
.xw-btn-primary:disabled { background: #E5E7EB; color: #9CA3AF; cursor: not-allowed; box-shadow: none; transform: none; }

.xw-btn-secondary {
  border: 1px solid #E5E7EB; background: #fff; color: #374151; border-radius: 8px; padding: 9px 18px; cursor: pointer;
  font-weight: 500; transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}
.xw-btn-secondary:hover:not(:disabled) { background: #F9FAFB; transform: translateY(-1px); box-shadow: 0 2px 8px rgba(0,0,0,0.04); }

.xw-btn-icon { border: none; background: transparent; cursor: pointer; padding: 6px; border-radius: 6px; color: #6B7280; transition: all 0.2s; }
.xw-btn-icon:hover { background: #F3F4F6; color: #111827; }
.xw-btn-icon.danger:hover { background: #FEE2E2; color: #DC2626; }

.xw-actions { 
  display: flex; gap: 12px; flex-wrap: wrap; 
  position: sticky; bottom: 0; background: rgba(255,255,255,0.9); backdrop-filter: blur(8px);
  padding: 16px 0; margin-top: auto; border-top: 1px solid #F3F4F6; z-index: 10;
}

/* 骨架屏动画 */
.xw-skeleton-container { display: flex; flex-direction: column; gap: 16px; padding: 24px; animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite; }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: .5; } }
.xw-skeleton-title { height: 32px; width: 40%; background: #E5E7EB; border-radius: 6px; margin-bottom: 24px; }
.xw-skeleton-text { height: 16px; background: #F3F4F6; border-radius: 4px; }
.xw-skeleton-tip { font-size: 14px; color: #6B7280; text-align: center; margin-top: 40px; font-style: italic; }
.xw-struct { border: 1px solid #F3F4F6; border-radius: 8px; padding: 16px; flex: 1; min-height: 200px; background: #fafafb; overflow-y: auto; overflow-x: hidden; }
.xw-selbar { margin-top: 16px; font-size: 13px; color: #6B7280; display: flex; align-items: center; justify-content: space-between; flex: none; background: #fff; padding: 8px 16px; border-radius: 8px; border: 1px solid #E5E7EB; }
.xw-selbar span { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-right: 12px; }
.xw-btn-mini { border: 1px solid #E5E7EB; background: #fff; border-radius: 6px; padding: 4px 10px; cursor: pointer; font-size: 12px; flex: none; transition: all 0.2s; }
.xw-btn-mini:hover { background: #F9FAFB; border-color: var(--hc-primary); color: var(--hc-primary); }

/* Stage 3 双栏布局 */
.xw-draft-split { 
  display: flex; flex-direction: row; gap: 24px; align-items: flex-start; width: 100%; box-sizing: border-box; 
  padding: 0 0 80px 0; background: transparent; border: none; box-shadow: none; 
  flex: 1; overflow-y: auto;
}
.xw-draft-left { width: 360px; flex: none; position: sticky; top: 0; max-height: 100%; overflow-y: hidden; display: flex; flex-direction: column; }
.xw-col-title { font-size: 14px; font-weight: 600; color: #4B5563; margin: 0 0 16px 0; padding-bottom: 8px; border-bottom: 1px solid #E5E7EB; flex: none; }
.xw-draft-left-tree { flex: 1; overflow-y: auto; overflow-x: hidden; padding-right: 12px; margin-right: -12px; padding-bottom: 24px; }
.xw-draft-left-tree::-webkit-scrollbar { width: 4px; }
.xw-draft-left-tree::-webkit-scrollbar-thumb { background: #E5E7EB; border-radius: 4px; }
.xw-draft-right { flex: 1; min-width: 0; width: 100%; }

.xw-title-input { 
  width: 100%; border: none; font-size: 24px; font-weight: 700; color: #111827; padding: 0 0 16px 0;
  border-bottom: 1px solid #E5E7EB; margin-bottom: 20px; outline: none; background: transparent; letter-spacing: -0.5px;
}
.xw-title-input::placeholder { color: #D1D5DB; }

.xw-editor-container { position: relative; min-height: 400px; font-size: 15px; line-height: 1.8; color: #374151; }
/* TipTap 样式重置 */
:deep(.ProseMirror) { outline: none; min-height: 300px; }
:deep(.ProseMirror p) { margin-bottom: 1em; }
:deep(.ProseMirror p.is-editor-empty:first-child::before) {
  content: attr(data-placeholder); float: left; color: #adb5bd; pointer-events: none; height: 0;
}

/* 划词菜单 (BubbleMenu) */
.xw-bubble-menu {
  position: absolute; z-index: 50;
  transform: translate(-50%, -100%);
  display: flex; background: #111827; border-radius: 8px; padding: 4px;
  box-shadow: 0 8px 16px rgba(0,0,0,0.15); white-space: nowrap;
}
.bm-btn { border: none; background: transparent; color: #fff; font-size: 13px; padding: 6px 10px; cursor: pointer; border-radius: 4px; font-weight: 500; }
.bm-btn:hover { background: rgba(255,255,255,0.1); }
.bm-warn { color: #FCD34D; }
.bm-warn:hover { background: rgba(251, 191, 36, 0.2); color: #FBBF24; }
.bm-danger { color: #FCA5A5; }
.bm-danger:hover { background: rgba(239, 68, 68, 0.2); color: #F87171; }

/* 禁用词提示 */
.xw-blockhit { margin-bottom: 16px; font-size: 13px; color: #B91C1C; background: #FEF2F2; padding: 10px 16px; border-radius: 8px; border-left: 3px solid #EF4444; }
.xw-hit-tag { display: inline-block; background: #FECACA; padding: 2px 8px; border-radius: 4px; margin: 0 4px; font-weight: 500; }
.xw-hit-tip { color: #7F1D1D; opacity: 0.8; font-size: 12px; }

/* 抽屉 (Drawer) HC Design */
.xw-drawer-mask { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.4); backdrop-filter: blur(8px); z-index: 999; opacity: 0; visibility: hidden; transition: all 0.3s; }
.xw-drawer-mask.is-open { opacity: 1; visibility: visible; }
.xw-drawer { 
  position: absolute; right: 0; top: 0; bottom: 0; width: 400px; background: #fff; box-shadow: -8px 0 24px rgba(0,0,0,0.1);
  transform: translateX(100%); transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1); display: flex; flex-direction: column;
}
.xw-drawer.is-open { transform: translateX(0); }
/* 诊断抽屉专用：6 条卡片密集，400px 太窄挤不下，加宽并让长文本正常换行 */
.xw-drawer-wide { width: min(560px, 94vw); }
.xw-drawer-head { display: flex; justify-content: space-between; align-items: center; padding: 24px; border-bottom: 1px solid #E5E7EB; }
.xw-drawer-head h3 { margin: 0; font-size: 18px; font-weight: 600; }
.xw-drawer-body { padding: 24px; overflow-y: auto; flex: 1; }

.xw-bl-add { display: flex; gap: 8px; margin-bottom: 12px; }
.xw-bl-add input { flex: 1; border: 1px solid #E5E7EB; border-radius: 8px; padding: 8px 12px; font-size: 13px; outline: none; }
.xw-bl-add input:focus { border-color: var(--hc-primary); }
.xw-bl-add select { border: 1px solid #E5E7EB; border-radius: 8px; padding: 8px; font-size: 13px; outline: none; }

.xw-bl-list { display: flex; flex-direction: column; gap: 8px; margin-top: 24px; }
.xw-bl-item { display: flex; align-items: center; gap: 12px; padding: 12px; background: #F9FAFB; border-radius: 8px; }
.xw-bl-kind { font-size: 11px; padding: 2px 6px; border-radius: 4px; font-weight: 500; }
.xw-bl-kind.word { background: #FFE4E6; color: #991B1B; }
.xw-bl-kind.phrase { background: #F3E8FF; color: #6B21A8; }
.xw-bl-term { flex: 1; font-size: 14px; color: #111827; }

/* ① AI 辅助想法 */
.xw-assist { border: 1px dashed #E5E7EB; border-radius: 10px; padding: 12px; background: #FCFCFD; }
.xw-assist-tabs { display: flex; gap: 8px; }
.xw-assist-btn {
  border: 1px solid #E5E7EB; background: #fff; border-radius: 8px;
  padding: 6px 12px; font-size: 13px; cursor: pointer; color: #374151;
}
.xw-assist-btn:hover:not(:disabled) { border-color: var(--hc-primary); color: var(--hc-primary); }
.xw-assist-btn:disabled { opacity: .6; cursor: not-allowed; }
.xw-assist-panel { margin-top: 12px; border-top: 1px solid #F0F0F0; padding-top: 12px; }
.xw-assist-head { display: flex; justify-content: space-between; align-items: center; font-size: 13px; font-weight: 600; color: #374151; margin-bottom: 8px; }
.xw-assist-x { border: none; background: none; color: #9CA3AF; cursor: pointer; font-size: 12px; }
.xw-assist-empty { font-size: 13px; color: #9CA3AF; font-style: italic; }
.xw-assumption { font-style: normal; font-weight: 500; font-size: 12px; color: #B45309; }
.xw-idea { display: flex; align-items: flex-start; gap: 10px; padding: 8px 10px; border-radius: 8px; }
.xw-idea:hover { background: #F9FAFB; }
.xw-idea-body { flex: 1; }
.xw-idea-point { font-size: 14px; color: #111827; line-height: 1.5; }
.xw-idea-why { font-size: 12px; color: #6B7280; margin-top: 2px; }
.xw-adopt-mini {
  flex: none; border: 1px solid #FFE0C2; background: #FFF8F0; color: #C2410C;
  border-radius: 6px; padding: 4px 8px; font-size: 12px; cursor: pointer; white-space: nowrap;
}
.xw-adopt-mini:hover { background: #FFEFDD; }
.xw-adopt-mini.done { background: #ECFDF5; border-color: #A7F3D0; color: #059669; }

/* 采纳提示 toast */
.xw-toast {
  position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
  z-index: 2000; background: #059669; color: #fff;
  padding: 8px 18px; border-radius: 999px; font-size: 13px; font-weight: 600;
  box-shadow: 0 8px 24px rgba(5, 150, 105, .32);
}
.xw-toast-enter-active, .xw-toast-leave-active { transition: opacity .2s, transform .2s; }
.xw-toast-enter-from, .xw-toast-leave-to { opacity: 0; transform: translateX(-50%) translateY(-8px); }
.xw-rs-group { margin-top: 10px; }
.xw-rs-group h5 { margin: 0 0 4px; font-size: 12px; color: #6B7280; font-weight: 600; }
.xw-rs-item { display: flex; align-items: flex-start; gap: 10px; padding: 6px 8px; border-radius: 8px; font-size: 13px; color: #374151; line-height: 1.5; }
.xw-rs-item:hover { background: #F9FAFB; }
.xw-rs-item > span { flex: 1; }

/* ③ 通读诊断卡片 */
.xw-dx-card { border: 1px solid #E5E7EB; border-radius: 10px; padding: 12px 14px; margin-bottom: 12px; }
.xw-dx-dim { font-size: 13px; font-weight: 600; color: var(--hc-primary); margin-bottom: 6px; }
.xw-dx-finding { font-size: 14px; color: #374151; line-height: 1.6; white-space: pre-wrap; word-break: break-word; }
.xw-dx-sugg { font-size: 13px; color: #059669; line-height: 1.6; margin-top: 6px; background: #ECFDF5; border-radius: 6px; padding: 6px 10px; white-space: pre-wrap; word-break: break-word; }
.xw-dx-stale { font-size: 13px; color: #B45309; background: #FFFBEB; border: 1px solid #FDE68A; border-radius: 8px; padding: 8px 12px; line-height: 1.5; margin-bottom: 12px; }

/* 骨架屏动画 / Loading */
.xw-loader-dots::after { content: ''; animation: dots 1.5s infinite steps(4, end); }
@keyframes dots { 0% { content: ''; } 25% { content: '.'; } 50% { content: '..'; } 75% { content: '...'; } 100% { content: ''; } }

/* 选项反问区 */
.xw-questions { background: #F9FAFB; border-radius: 8px; padding: 16px; margin: 24px 0; border: 1px solid #E5E7EB; }
.xw-q-head { font-size: 14px; font-weight: 600; color: var(--hc-primary); margin: 0 0 12px; }
.xw-q { margin-bottom: 16px; }
.xw-q:last-child { margin-bottom: 0; }
.xw-q-text { font-size: 14px; margin-bottom: 8px; color: #111827; }
.xw-q-opts { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
.xw-q-opts button { border: 1px solid #E5E7EB; background: #fff; border-radius: 16px; padding: 6px 14px; cursor: pointer; font-size: 13px; transition: all 0.2s; }
.xw-q-opts button:hover { background: #F3F4F6; }
.xw-q-opts button.on { background: var(--hc-primary); color: #fff; border-color: var(--hc-primary); }
.xw-q-input { width: 100%; border: 1px solid #E5E7EB; border-radius: 8px; padding: 8px 12px; font-size: 13px; }
.xw-q-input:focus { border-color: var(--hc-primary); outline: none; }
</style>