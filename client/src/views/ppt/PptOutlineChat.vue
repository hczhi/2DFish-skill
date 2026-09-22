<script setup lang="ts">
// 「生成提纲」：和 AI 来回聊，它出一份提纲，点「用这份提纲」带回新建页那个提纲输入框。
//
// 三件事是承重的：
// ① **每说一句都是一次真实 AI 调用**（登录用户缺省 10 次/天），界面上必须写着 ——
//    不写的话他会像用普通聊天软件那样一句一句聊，然后在别处发现今天额度没了（硬规则 1）。
// ② **这段对话不落库**：整段历史每轮都由前端重发，离开这一页就没了。所以离开前要拦一句，
//    也要在页面上说明 —— 不说的话他聊了二十轮回去拿提纲，回来发现是一张白页。
// ③ 服务端**没取到提纲**（标记只开没关等）时 `outline` 是 null 而 `problems` 里有话 ——
//    那几句必须显示出来。把 problems 咽掉的话，界面上是「聊完了但那个确认按钮一直不亮」，
//    看起来像功能坏了，而真实成因（它的提纲写到一半断了）只有我们日志里有。

import { ref, computed, onMounted, nextTick } from 'vue'
import { useRouter, onBeforeRouteLeave } from 'vue-router'
import { apiPost } from '../../lib/api'
import { getToken } from '../../lib/auth'
import { openLoginModal } from '../../lib/loginModal'
import SiteHeader from '../../components/common/SiteHeader.vue'
import SiteFooter from '../../components/common/SiteFooter.vue'
import FileExtractPanel from '../../components/common/FileExtractPanel.vue'

const router = useRouter()

/** 和服务端 outlineChatService 的那几条上限一致（都是只拒不截）。 */
const MAX_MESSAGE = 4000
const MAX_OUTLINE = 12000

/** 新建页在跳过来之前把整张表单存在这儿（`PptDeckCreate.stashDraft`）。 */
const DRAFT_KEY = 'ppt:new-draft'
/** 带回去的那份提纲放这儿，新建页读完就删。 */
const PICKED_KEY = 'ppt:outline-picked'

interface Turn { role: 'user' | 'assistant'; content: string }

const turns = ref<Turn[]>([])
const input = ref('')
const busy = ref(false)
const err = ref('')
/** 服务端这一轮的 problems（「提纲写到一半断了」这类），显示在最后一条回复下面。 */
const notes = ref<string[]>([])
/** 最近一轮拿到的那份完整提纲（null = 这一轮没有提纲可带回去）。 */
const outline = ref('')
/** 已经出过第几份了 —— 显示「这是第 N 版」，不显示的话他不知道下面那块是刚更新的还是上一轮的。 */
const outlineVersion = ref(0)
/** 他在新建页框里原来那份（带上去当上下文；它会被「用这份提纲」整份换掉）。 */
const currentOutline = ref('')

/**
 * 上传的那几份资料（和品牌咨询共用那个面板）。**原样往上传，不在这边拼成一段** ——
 * 合成在服务端（`composeMaterials`）：前端拼的话「第 3 份没进去」在界面上完全看不出来，
 * 卡片还在，而提纲是照着少一份资料写的，读起来一样通顺。
 */
const attachments = ref<Array<{ filename: string; text: string; variant: 'tidy' | 'raw' }>>([])
/** 还有文件在提取/整理 —— 禁掉发送，见 canSend 上那句。 */
const filesBusy = ref(false)
/** 资料区展开着吗（默认收起：绝大多数时候他是直接开口聊的）。 */
const showFiles = ref(false)

const scroller = ref<HTMLElement | null>(null)
// 文件还在处理时**禁掉发送**（按钮上写明理由）：不禁的话他在整理跑完之前发出这一轮，
// 那几份资料压根没进请求，而 AI 照样答得好好的（它是照着没有资料的需求写的），
// 一处都不报错 —— 而这一轮的额度已经花了。
const canSend = computed(
  () => !busy.value && !filesBusy.value && input.value.trim().length > 0 && input.value.length <= MAX_MESSAGE
)

onMounted(() => {
  if (!getToken()) {
    openLoginModal(window.location.pathname, '生成提纲需要登录')
    return
  }
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY)
    if (raw) currentOutline.value = String(JSON.parse(raw)?.outline || '').trim()
  } catch {
    // 存的那份坏了就当没有（只影响「在原来那份上改」这件事，不挡聊天）
  }
})

/** 「用这份提纲」/ 空着返回 那两下是他自己要走的，不要再拦一句。 */
const leaving = ref(false)

// 离开就没了（这段对话不落库）—— 有内容时拦一句。不拦的话他点一下返回，二十轮对话
// 和那份提纲一起消失，而页面上一切正常。
onBeforeRouteLeave(() => {
  // 传上来的资料也一起没了（文件不落盘），而图片那几份每张都真花过一次额度 ——
  // 所以只有对话为空**且**没传过资料时才放行。
  if ((!turns.value.length && !attachments.value.length) || leaving.value) return true
  return window.confirm('离开这一页之后这段对话就没了（不会保存）。确定要离开吗？')
})

async function send() {
  const text = input.value.trim()
  if (!text || busy.value) return
  if (text.length > MAX_MESSAGE) {
    err.value = `这条消息 ${text.length} 字，超过 ${MAX_MESSAGE} 字上限（不会自动截断 —— 截一半的话它是照着半句需求写的）。`
    return
  }
  err.value = ''
  notes.value = []
  turns.value.push({ role: 'user', content: text })
  input.value = ''
  busy.value = true
  await scrollDown()
  try {
    const r = await apiPost<{ reply: string; outline: string | null; problems: string[] }>(
      '/api/ppt/outline-chat',
      {
        turns: turns.value,
        currentOutline: currentOutline.value || undefined,
        attachments: attachments.value.length ? attachments.value : undefined,
      }
    )
    turns.value.push({ role: 'assistant', content: r.reply })
    notes.value = r.problems || []
    if (r.outline) {
      outline.value = r.outline
      outlineVersion.value += 1
    }
  } catch (e: any) {
    // 失败的那一轮把他刚说的那句**退回输入框**：留在历史里的话下一轮会把同一句再发一遍
    // （又扣一次额度），而他以为模型已经听见了。
    const failed = turns.value.pop()
    input.value = failed?.content || input.value
    err.value = e?.message || '这一轮没聊成'
  } finally {
    busy.value = false
    await scrollDown()
  }
}

async function scrollDown() {
  await nextTick()
  const el = scroller.value
  if (el) el.scrollTop = el.scrollHeight
}

/** 带回新建页那个提纲输入框（那边读完就删这把钥匙）。 */
function useOutline() {
  if (!outline.value) return
  try {
    sessionStorage.setItem(PICKED_KEY, outline.value)
  } catch (e: any) {
    // 存不进去（隐私模式 / 满了）必须出声：静默的话他回到新建页发现框里还是原来那份，
    // 而这份提纲已经随着这一页一起没了。
    err.value = `没能把这份提纲交回新建页（浏览器拒绝了本地暂存：${e?.message || '未知原因'}）。请先把下面那份手工复制走再返回。`
    return
  }
  leaving.value = true
  router.push('/ppt/decks/new')
}

function back() {
  leaving.value = !turns.value.length
  router.push('/ppt/decks/new')
}

const starters = [
  '我要给客户讲我们公司的 AI 转型方案，30 分钟，目的是让他们批预算。',
  '内部季度复盘，讲三条业务线的进展和明年的重点。',
  '投标答疑会，讲我们方案的三个优势和实施计划。',
]
</script>

<template>
  <div class="page-wrapper">
    <SiteHeader />

    <main class="chat-layout">
      <div class="bg-elements">
        <div class="bg-overlay"></div>
        <div class="grid-bg"></div>
      </div>

      <header class="bar">
        <!-- <div>
          <h1>AI 生成提纲</h1>
          <p class="sub">
            说清楚给谁讲、什么场合、要对方做什么，它会先问缺的、再出一份能直接排版的提纲。
            <b>每发一句是一次真实 AI 调用</b>；这段对话不保存，离开这一页就没了。
          </p>
        </div> -->
        <button class="btn-ghost" @click="back">返回新建页</button>
      </header>

      <div v-if="err" class="alert">{{ err }}</div>

      <!-- 资料上传。默认收起 —— 展开着的话这一页第一眼是个上传框，而主路径是直接开口说。
           标题上写着「每轮都会带上」：不写的话他以为传一次就够了，而每一轮都真的带着它
           （字数算在那 20000 字上限里）。 -->
      <section class="files">
        <button class="files-toggle" @click="showFiles = !showFiles">
          <span>{{ showFiles ? '▾' : '▸' }} 参考资料（可选）</span>
          <em v-if="attachments.length">已带 {{ attachments.length }} 份 · 每轮都会带上</em>
          <em v-else>产品资料 / 旧稿 / 截图都可以，AI 只照资料写，不编数字</em>
        </button>
        <div v-show="showFiles" class="files-body">
          <FileExtractPanel
            api-base="/api/ppt"
            noun="参考资料"
            carry-hint="每轮对话都会带给 AI"
            :current-chars="0"
            @change="attachments = $event"
            @busy="filesBusy = $event"
          />
        </div>
      </section>

      <div class="chat-body">
        <div class="stream" ref="scroller">
          <div v-if="!turns.length" class="empty">
            <p>先说一句你要讲什么 —— 比如：</p>
            <button v-for="s in starters" :key="s" class="starter" @click="input = s">{{ s }}</button>
            <p v-if="currentOutline" class="tip">
              新建页那个框里已经有一份提纲（{{ currentOutline.length }} 字），这次会在它基础上改
              —— 你点「用这份提纲」时，框里那份会被<b>整份换掉</b>。
            </p>
          </div>

          <div v-for="(t, i) in turns" :key="i" class="msg" :class="t.role">
            <span class="who">{{ t.role === 'user' ? '你' : 'AI' }}</span>
            <div class="bubble">{{ t.content }}</div>
          </div>

          <div v-if="busy" class="msg assistant">
            <span class="who">AI</span>
            <div class="bubble thinking">正在想… </div>
          </div>

          <div v-for="(n, i) in notes" :key="`n${i}`" class="note">{{ n }}</div>
        </div>

        <aside class="side">
          <div class="side-head">
            <span>提纲</span>
            <em v-if="outlineVersion">第 {{ outlineVersion }} 版 · {{ outline.length }} / {{ MAX_OUTLINE }} 字</em>
          </div>
          <textarea
            v-if="outline"
            v-model="outline"
            class="outline-box"
            rows="20"
            spellcheck="false"
          ></textarea>
          <p v-else class="side-empty">
            还没提纲信息, 请先说一句你要讲什么。
          </p>
          <button class="btn-primary" :disabled="!outline || busy" @click="useOutline">
            用这份提纲
          </button>
         
        </aside>
      </div>

      <div class="composer">
        <textarea
          v-model="input"
          rows="3"
          :placeholder="busy ? '等这一轮回完再说下一句…' : '说一句（Ctrl/⌘ + Enter 发送）'"
          @keydown.meta.enter.prevent="send"
          @keydown.ctrl.enter.prevent="send"
        ></textarea>
        <div class="composer-side">
          <em :class="{ over: input.length > MAX_MESSAGE }">{{ input.length }} / {{ MAX_MESSAGE }}</em>
          <button class="btn-primary" :disabled="!canSend" @click="send">
            {{ busy ? '发送中…' : filesBusy ? '资料还在处理…' : '发送' }}
          </button>
        </div>
      </div>
    </main>

    <SiteFooter />
  </div>
</template>

<style scoped>
/* 配色跟着 /ppt 那几屏（深色底 + 品牌黄），照抄 PptDeckCreate 的那几个变量：
   换成浅色的话这一页在整条流程里像是另一个站点。 */
.page-wrapper {
  --font-sans: "Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Microsoft YaHei", sans-serif;
  --font-mono: "SF Mono", Menlo, Monaco, "JetBrains Mono", monospace;
  --brand-yellow: #FFB800;
  --brand-yellow-hover: #E6A600;
  --text-primary: #FFFFFF;
  --color-soft: rgba(255, 255, 255, 0.6);
  --bg-color: #12182B;
  padding-top: 50px;
  display: flex; flex-direction: column; min-height: 100vh;
  background: var(--bg-color); font-family: var(--font-sans); color: var(--text-primary);
}
.chat-layout { position: relative; flex: 1; width: 100%; max-width: 1240px; margin: 0 auto; padding: 32px 4vw 64px; box-sizing: border-box; }

.bg-elements {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 0;
  background-image: url('https://file.qiaonan.vip/uploads/2026/09/03/01bf04c8-8d07-4af2-b94a-4261ee342576.png');
  background-size: cover;
  background-position: center;
}
.bg-overlay {
  position: absolute;
  inset: 0;
  background: rgba(18, 24, 43, 0.65);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}
.grid-bg {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(255, 255, 255, 0.03) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.03) 1px, transparent 1px);
  background-size: 32px 32px;
  z-index: 1;
}

.bar, .alert, .files, .chat-body, .composer { position: relative; z-index: 1; }

.bar { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 20px; }
.bar h1 { margin: 0 0 8px; font-size: 28px; font-weight: 800; letter-spacing: -0.03em; }
.sub { margin: 0; font-size: 13px; color: var(--color-soft); line-height: 1.8; max-width: 760px; }
.sub b { color: var(--brand-yellow); font-weight: 700; }
.alert {
  margin-bottom: 16px; padding: 12px 16px; border-radius: 12px; font-size: 14px; line-height: 1.7;
  background: rgba(254, 242, 242, 0.1); border: 1px solid rgba(252, 165, 165, 0.3); color: #FCA5A5;
}
.files { margin-bottom: 16px; border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 16px; background: rgba(255, 255, 255, 0.04); }
.files-toggle {
  display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; width: 100%;
  padding: 13px 18px; background: none; border: none; cursor: pointer; text-align: left;
  font-family: var(--font-sans); font-size: 13.5px; font-weight: 700; color: var(--text-primary);
}
.files-toggle em { font-style: normal; font-weight: 400; font-size: 12px; color: var(--color-soft); }
.files-body { padding: 0 18px 16px; }
.chat-body { display: grid; grid-template-columns: 1fr 400px; gap: 20px; align-items: stretch; }
.stream {
  min-height: 440px; max-height: 60vh; overflow-y: auto; padding: 20px;
  background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 20px;
}
.empty { font-size: 13px; color: var(--color-soft); line-height: 1.8; }
.empty p { margin: 0 0 12px; }
.starter {
  display: block; width: 100%; text-align: left; margin-bottom: 10px; padding: 11px 14px;
  border: 1px dashed rgba(255, 255, 255, 0.2); border-radius: 12px; background: rgba(0, 0, 0, 0.2);
  font-size: 13px; color: var(--text-primary); font-family: var(--font-sans); cursor: pointer;
  line-height: 1.7; transition: all .2s;
}
.starter:hover { border-color: var(--brand-yellow); color: var(--brand-yellow); }
.tip { margin-top: 16px; padding: 11px 14px; border-radius: 12px; background: rgba(255, 184, 0, 0.08); color: var(--color-soft); }
.msg { margin-bottom: 16px; }
.who { display: block; font-size: 11px; font-family: var(--font-mono); letter-spacing: .1em; color: var(--color-soft); margin-bottom: 6px; }
.bubble {
  white-space: pre-wrap; word-break: break-word; font-size: 14px; line-height: 1.85;
  padding: 12px 16px; border-radius: 14px; background: rgba(0, 0, 0, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.06);
}
.msg.user .bubble { background: rgba(255, 184, 0, 0.1); border-color: rgba(255, 184, 0, 0.25); }
.bubble.thinking { color: var(--color-soft); }
.note {
  margin: 12px 0; padding: 12px 14px; border-radius: 12px; font-size: 13px; line-height: 1.8;
  background: rgba(255, 184, 0, 0.08); border: 1px solid rgba(255, 184, 0, 0.3); color: #FFD979;
}
.side {
  position: sticky; top: 20px; padding: 18px; border-radius: 20px;
  background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1);
  display: flex; flex-direction: column;
}
.side-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 12px; flex-shrink: 0; }
.side-head span { font-size: 14px; font-weight: 700; }
.side-head em { font-size: 12px; font-family: var(--font-mono); color: var(--color-soft); font-style: normal; }
.outline-box {
  width: 100%; flex: 1; box-sizing: border-box; font-family: var(--font-mono); font-size: 12.5px;
  line-height: 1.8; padding: 12px 14px; border-radius: 12px; resize: none; margin-bottom: 12px;
  background: rgba(0, 0, 0, 0.3); border: 1px solid rgba(255, 255, 255, 0.1); color: var(--text-primary);
}
.outline-box:focus { outline: none; border-color: var(--brand-yellow); }
.side-empty { font-size: 13px; line-height: 1.8; color: var(--color-soft); margin: 0 0 14px; flex: 1; }
.side-hint { font-size: 12px; line-height: 1.8; color: var(--color-soft); margin: 10px 0 0; flex-shrink: 0; }
.composer { display: flex; gap: 14px; margin-top: 20px; }
.composer textarea {
  flex: 1; box-sizing: border-box; padding: 14px 16px; font-size: 15px; line-height: 1.8;
  border-radius: 14px; resize: vertical; font-family: var(--font-sans);
  background: rgba(0, 0, 0, 0.25); border: 1px solid rgba(255, 255, 255, 0.1); color: var(--text-primary);
}
.composer textarea::placeholder { color: rgba(255, 255, 255, 0.3); }
.composer textarea:focus { outline: none; border-color: var(--brand-yellow); box-shadow: 0 0 0 4px rgba(255, 184, 0, 0.1); }
.composer-side { display: flex; flex-direction: column; align-items: flex-end; gap: 10px; }
.composer-side em { font-size: 12px; font-family: var(--font-mono); color: var(--color-soft); font-style: normal; }
.composer-side em.over { color: #FCA5A5; }
.btn-primary {
  padding: 12px 20px; border: none; border-radius: 12px; background: var(--brand-yellow);
  color: #12182B; font-size: 14px; font-weight: 700; font-family: var(--font-sans);
  cursor: pointer; white-space: nowrap; transition: all .2s;
}
.btn-primary:hover:not(:disabled) { background: var(--brand-yellow-hover); }
.btn-primary:disabled { opacity: .45; cursor: default; }
.side .btn-primary { width: 100%; }
.btn-ghost {
  padding: 10px 16px; border-radius: 12px; font-size: 13px; cursor: pointer; white-space: nowrap;
  background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.15);
  color: var(--text-primary); font-family: var(--font-sans);
}
.btn-ghost:hover { border-color: var(--brand-yellow); color: var(--brand-yellow); }
@media (max-width: 900px) {
  .chat-body { grid-template-columns: 1fr; }
  .side { position: static; }
  .chat-layout { padding: 24px 20px 48px; }
}
</style>
