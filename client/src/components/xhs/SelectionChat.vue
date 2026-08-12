<script setup lang="ts">
// 统一的「选中 → 对话 → AI 返回修改建议 → 采纳/放弃」浮层。
// 结构阶段（选中节点）和成文阶段（选中正文片段）复用同一个组件。
// 组件不关心调哪个接口——父级传入 runner(message)，返回 { reply, preview, apply }：
//   reply   = AI 的一句话说明
//   preview = 给用户看的"改成什么样"预览
//   apply   = 用户点采纳时执行的副作用（父级自己知道怎么合并进数据）
import { ref, watch } from 'vue'

export interface ChatResult {
  reply: string
  preview: string
  apply: () => void
}

const props = defineProps<{
  open: boolean
  title: string          // 顶部标题，如"讨论这个论点"或"修改选中片段"
  context: string        // 选中的内容原文，展示给用户确认改的是哪段
  // onDelta 是给**流式**调用方的（全文改写）：边生成边把已收到的文本喂回来，
  // 显示在预览框里。不传也能用（非流式的调用方就是这么用的）。
  runner: (message: string, onDelta?: (text: string) => void) => Promise<ChatResult>
  autoSend?: string      // 有值时：打开即预填该诉求并自动发送（禁用词一键重写等快捷入口）
  prefill?: string       // 预填诉求但**不**自动发（全文改写：得让用户先挑风格再发）
  // 写作风格选择。**只在调用方真的会把它传给接口时才传** ——
  // 传了却没人读，用户换一个风格、AI 照旧改法，回来的东西看着很正常，
  // 他只会以为这个 skill 没什么效果（结构阶段的 node-chat 就不吃 styleSkill，
  // 所以那边不传这两个 prop，下拉根本不出现）。
  skills?: Array<{ id: string; name: string }>
  skillId?: string
  followLabel?: string   // 空值那一项的文案（如"跟随①：口语化"）
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'update:skillId', v: string): void
}>()

const message = ref('')
const busy = ref(false)
const result = ref<ChatResult | null>(null)
const errMsg = ref('')
const streamText = ref('')   // 流式生成中的部分文本（只用于展示）

// 每次重新打开（或切换选中对象）都清空上一轮；若传了 autoSend 则预填并自动发。
watch(() => [props.open, props.context], () => {
  result.value = null
  errMsg.value = ''
  streamText.value = ''
  if (props.open && props.autoSend) {
    message.value = props.autoSend
    send()
  } else {
    message.value = props.open ? (props.prefill || '') : ''
  }
})

async function send() {
  const m = message.value.trim()
  if (!m || busy.value) return
  busy.value = true
  result.value = null
  errMsg.value = ''
  streamText.value = ''
  try {
    result.value = await props.runner(m, (t) => { streamText.value = t })
  } catch (e: any) {
    errMsg.value = e?.message || '出错了，再试一次'
  } finally {
    busy.value = false
    // 生成失败时那半截文本必须清掉：留着它、上面又飘一句红字，
    // 用户很容易把它当成"改完了"往回抄。
    if (!result.value) streamText.value = ''
  }
}

function adopt() {
  result.value?.apply()
  emit('close')
}
</script>

<template>
  <div v-if="open" class="sc-mask" @click.self="emit('close')">
    <div class="sc-panel">
      <div class="sc-head">
        <span class="sc-title">{{ title }}</span>
        <button class="sc-x" @click="emit('close')">✕</button>
      </div>

      <div class="sc-context" v-if="context">{{ context }}</div>

      <div class="sc-body">
        <div v-if="skills && skills.length" class="sc-skill">
          <span>写作风格</span>
          <select
            :value="skillId || ''"
            @change="emit('update:skillId', ($event.target as HTMLSelectElement).value)"
          >
            <option value="">{{ followLabel || '默认' }}</option>
            <option v-for="s in skills" :key="s.id" :value="s.id">{{ s.name }}</option>
          </select>
        </div>

        <textarea
          v-model="message"
          class="sc-input"
          placeholder="告诉 AI 你想怎么改 / 想补充什么（例：这个论点太空，帮我补两条真实论据；或：这段太啰嗦，压到两句）"
          rows="3"
          @keydown.ctrl.enter="send"
          @keydown.meta.enter="send"
        />
        <button class="sc-send" :disabled="busy || !message.trim()" @click="send">
          {{ busy ? 'AI 思考中…' : '发给 AI（⌘/Ctrl+Enter）' }}
        </button>

        <p v-if="errMsg" class="sc-err">{{ errMsg }}</p>

        <!-- 流式生成中：边写边看。没有采纳按钮 —— 还没写完的东西不能采纳。 -->
        <div v-if="busy && streamText" class="sc-result">
          <p class="sc-reply">AI 正在写…（写完才会出现「采纳」）</p>
          <div class="sc-preview">{{ streamText }}</div>
        </div>

        <div v-if="result" class="sc-result">
          <p class="sc-reply">{{ result.reply }}</p>
          <div class="sc-preview">{{ result.preview }}</div>
          <div class="sc-btns">
            <button class="sc-adopt" @click="adopt">采纳</button>
            <button class="sc-discard" @click="result = null">放弃，重说</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sc-mask {
  position: fixed; inset: 0; background: rgba(0,0,0,.28);
  display: flex; align-items: center; justify-content: center; z-index: 1000;
}
.sc-panel {
  width: min(560px, 92vw); max-height: 86vh; overflow: auto;
  background: #fff; border-radius: 14px; box-shadow: 0 12px 40px rgba(0,0,0,.2);
  display: flex; flex-direction: column;
}
.sc-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 16px; border-bottom: 1px solid #f0f0f0;
}
.sc-title { font-weight: 600; }
.sc-x { border: none; background: none; cursor: pointer; font-size: 15px; color: #999; }
.sc-context {
  margin: 12px 16px 0; padding: 10px 12px; background: #f7f7f9; border-radius: 8px;
  font-size: 13px; color: #555; white-space: pre-wrap; max-height: 120px; overflow: auto;
}
.sc-body { padding: 12px 16px 16px; }
.sc-skill { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; font-size: 13px; color: #555; }
.sc-skill select {
  flex: 1; border: 1px solid #ddd; border-radius: 8px; padding: 6px 8px; font: inherit; background: #fff;
}
.sc-input {
  width: 100%; box-sizing: border-box; border: 1px solid #ddd; border-radius: 8px;
  padding: 8px 10px; font: inherit; resize: vertical;
}
.sc-send {
  margin-top: 8px; width: 100%; padding: 9px; border: none; border-radius: 8px;
  background: #ff6a3d; color: #fff; font-weight: 600; cursor: pointer;
}
.sc-send:disabled { background: #f3b39c; cursor: not-allowed; }
.sc-err { color: #c0392b; font-size: 13px; margin: 8px 0 0; }
.sc-result { margin-top: 14px; border-top: 1px dashed #eee; padding-top: 12px; }
.sc-reply { font-size: 13px; color: #666; margin: 0 0 8px; }
.sc-preview {
  background: #fff8f0; border: 1px solid #ffe0c2; border-radius: 8px;
  padding: 10px 12px; white-space: pre-wrap; line-height: 1.6; font-size: 14px;
}
.sc-btns { display: flex; gap: 8px; margin-top: 12px; }
.sc-adopt {
  flex: 1; padding: 8px; border: none; border-radius: 8px;
  background: #2e7d32; color: #fff; font-weight: 600; cursor: pointer;
}
.sc-discard {
  flex: 1; padding: 8px; border: 1px solid #ddd; border-radius: 8px;
  background: #fff; color: #666; cursor: pointer;
}
</style>
