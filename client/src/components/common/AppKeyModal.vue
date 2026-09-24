<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { verifyAppKey, saveAppKey, setActiveKeyApp, keyInfo, type KeyApp } from '../../lib/appKey'
import { openLoginModal } from '../../lib/loginModal'

// 输入应用 key 的弹窗（112）。挂在各应用的介绍页上：「去使用」没 key 时守卫送到
// /<app>/key，那条路由再带着 ?key=1 回到介绍页把它打开。
const props = defineProps<{ modelValue: boolean; app: KeyApp; next?: string; reason?: string }>()
const emit = defineEmits<{ 'update:modelValue': [boolean] }>()
const router = useRouter()

// theme：ppt 的介绍页是黑底电影风，弹窗做成一张「入场券」；咨询封面是浅色，用浅色那版。
const GATES: Record<KeyApp, { title: string; prefix: string; home: string; theme: 'cinema' | 'light' }> = {
  ppt: { title: 'HTML 展示稿', prefix: 'PPT', home: '/ppt/decks', theme: 'light' },
  consult: { title: '品牌咨询', prefix: 'CST', home: '/consult/projects', theme: 'light' },
}
const gate = GATES[props.app]

const key = ref('')
const busy = ref(false)
// 从 401 跳回来时带着服务端的真实成因（停用 / 查无此 key），第一眼就要看到。
const err = ref('')
watch(() => [props.modelValue, props.reason] as const, ([open, reason]) => {
  if (open) err.value = reason || ''
}, { immediate: true })

function close() {
  if (!busy.value) emit('update:modelValue', false)
}

function nextPath(): string {
  // next 只认本应用下的路径：别的应用的地址进去之后每个接口 403，读起来像那个模块坏了。
  return props.next && props.next.startsWith(`/${props.app}/`) ? props.next : gate.home
}

// B 端客户用管理员开的账号（可配专属 AI），和 key 并行。这里是他们唯一的登录入口：
// 首页没有 LOGIN，而这些页面没 key 时守卫一律送到这里。
function accountLogin() {
  emit('update:modelValue', false)
  openLoginModal(nextPath(), '企业账号登录')
}

async function submit() {
  if (!key.value.trim()) { err.value = '请粘贴你购买的 key'; return }
  busy.value = true
  err.value = ''
  try {
    keyInfo.value = await verifyAppKey(props.app, key.value)
    saveAppKey(props.app, key.value)
    setActiveKeyApp(props.app)
    emit('update:modelValue', false)
    router.replace(nextPath())
  } catch (e: any) {
    err.value = e.message || '校验失败'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="ticket">
      <div v-if="modelValue" class="key-overlay" :class="`theme-${gate.theme}`" @click.self="close" @keydown.esc="close">
        <div class="ticket" role="dialog" aria-modal="true" :aria-label="`开始使用${gate.title}`">
          <button class="x" type="button" aria-label="关闭" @click="close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>

          <div class="main">
            <p class="kicker"><span>ADMIT ONE</span><span class="dot">·</span><span>入场券</span></p>
            <h3>{{ gate.title }}</h3>
            <p class="sub">输入你购买的 key，开始使用</p>

            <form @submit.prevent="submit">
              <label class="field" :class="{ bad: !!err }">
                <span class="field-label">ACCESS KEY</span>
                <input v-model="key" :placeholder="`${gate.prefix}-XXXX-XXXX-XXXX-XXXX`" autocomplete="off" spellcheck="false" autofocus />
              </label>
              <button type="submit" class="enter" :disabled="busy">
                <span>{{ busy ? '校验中…' : '进入' }}</span>
                <svg v-if="!busy" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
              </button>
            </form>
            <p v-if="err" class="err">{{ err }}</p>
          </div>

          <!-- 票根：撕口 + 风险提示 -->
          <div class="perf" aria-hidden="true"></div>
          <div class="stub">
            <p class="warn">
              <b>请自己保存好这个 key。</b>它就是你的账号：你的内容和剩余点数都只认这个 key，
              换浏览器或清缓存之后要重新输入它才能找回；也不要发给别人，拿到它的人能用掉你的点数、看到你的内容。
            </p>
            <p class="account">企业客户？<a href="#" @click.prevent="accountLogin">用账号登录 →</a></p>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.key-overlay {
  position: fixed; inset: 0; z-index: 10000; padding: 24px;
  display: flex; align-items: center; justify-content: center;
}
.ticket { position: relative; width: 100%; max-width: 480px; }
.x { position: absolute; top: 14px; right: 14px; z-index: 1; width: 32px; height: 32px; padding: 7px; border: 0; background: none; cursor: pointer; border-radius: 50%; }
.x svg { width: 100%; height: 100%; }
.main { padding: 40px 40px 30px; }
.kicker { margin: 0 0 14px; font-size: 11px; letter-spacing: .4em; }
.kicker .dot { margin: 0 .6em; }
h3 { margin: 0 0 8px; font-size: 28px; font-weight: 500; letter-spacing: .06em; }
.sub { margin: 0 0 28px; font-size: 13px; }
form { display: flex; align-items: flex-end; gap: 14px; }
.field { flex: 1; min-width: 0; display: block; }
.field-label { display: block; font-size: 10px; letter-spacing: .3em; margin-bottom: 8px; }
.field input {
  width: 100%; box-sizing: border-box; border: 0; border-bottom: 1px solid; background: transparent;
  padding: 8px 0 10px; font-family: ui-monospace, Menlo, monospace; font-size: 15px; letter-spacing: .12em; outline: none;
  transition: border-color .3s;
}
.enter {
  display: inline-flex; align-items: center; gap: 10px; flex-shrink: 0;
  padding: 12px 22px; font-size: 14px; letter-spacing: .25em; cursor: pointer; border: 1px solid;
  transition: background .3s, color .3s, border-color .3s;
}
.enter svg { width: 16px; height: 16px; }
.enter:disabled { opacity: .55; cursor: default; }
.err { margin: 18px 0 0; font-size: 13px; line-height: 1.6; padding-left: 12px; border-left: 2px solid; }
.perf { position: relative; height: 0; margin: 0 22px; border-top: 1px dashed; }
.perf::before, .perf::after { content: ''; position: absolute; top: -11px; width: 22px; height: 22px; border-radius: 50%; }
.perf::before { left: -33px; } .perf::after { right: -33px; }
.stub { padding: 22px 40px 28px; }
.warn { margin: 0; font-size: 12px; line-height: 1.85; }
.account { margin: 16px 0 0; font-size: 12px; }
.account a { text-decoration: none; margin-left: 4px; }

/* 电影风（ppt） */
.theme-cinema { background: rgba(0, 0, 0, .72); backdrop-filter: blur(6px); }
.theme-cinema .ticket {
  background: linear-gradient(160deg, #19171a 0%, #0f0e10 60%);
  color: #ece6da; font-family: "PingFang SC", "Noto Sans SC", sans-serif;
  outline: 1px solid rgba(217, 178, 111, .35); outline-offset: -8px;
  box-shadow: 0 40px 120px rgba(0, 0, 0, .9), 0 0 80px rgba(217, 178, 111, .08);
}
.theme-cinema .x { color: #8b857a; } .theme-cinema .x:hover { color: #ece6da; }
.theme-cinema .kicker { color: #d9b26f; }
.theme-cinema h3 { font-family: "Noto Serif SC", "Source Han Serif SC", "Songti SC", serif; color: #fff; }
.theme-cinema .sub, .theme-cinema .field-label { color: #8b857a; }
.theme-cinema .field input { color: #fff; border-color: rgba(236, 230, 218, .25); }
.theme-cinema .field input::placeholder { color: rgba(236, 230, 218, .22); }
.theme-cinema .field input:focus { border-color: #d9b26f; }
.theme-cinema .field.bad input { border-color: #d0735f; }
.theme-cinema .enter { background: transparent; color: #ece6da; border-color: rgba(217, 178, 111, .6); }
.theme-cinema .enter:not(:disabled):hover { background: #d9b26f; color: #0a0a0b; border-color: #d9b26f; }
.theme-cinema .err { color: #e8a594; border-color: #d0735f; }
.theme-cinema .perf { border-color: rgba(236, 230, 218, .16); }
.theme-cinema .perf::before, .theme-cinema .perf::after { background: #050505; }
.theme-cinema .warn { color: #8b857a; } .theme-cinema .warn b { color: #d9b26f; font-weight: 500; }
.theme-cinema .account { color: #6b665d; } .theme-cinema .account a { color: #ece6da; border-bottom: 1px solid rgba(236, 230, 218, .3); }
.theme-cinema .account a:hover { color: #d9b26f; border-color: #d9b26f; }

/* 浅色（consult） */
.theme-light { background: rgba(15, 23, 42, .4); backdrop-filter: blur(8px); }
.theme-light .ticket { background: #fff; color: #0f172a; border-radius: 12px; box-shadow: 0 24px 64px rgba(0, 0, 0, .14); }
.theme-light .x { color: #94a3b8; } .theme-light .x:hover { color: #0f172a; background: #f1f5f9; }
.theme-light .kicker { color: #2563eb; }
.theme-light .sub, .theme-light .field-label { color: #64748b; }
.theme-light .field input { color: #0f172a; border-color: #cbd5e1; }
.theme-light .field input:focus { border-color: #2563eb; }
.theme-light .field.bad input { border-color: #dc2626; }
.theme-light .enter { background: #2563eb; color: #fff; border-color: #2563eb; border-radius: 8px; }
.theme-light .enter:not(:disabled):hover { background: #1d4ed8; }
.theme-light .err { color: #b91c1c; border-color: #dc2626; }
.theme-light .perf { border-color: #e2e8f0; }
.theme-light .perf::before, .theme-light .perf::after, .theme-light .kicker { display: none; }
.theme-light .stub { background: #f8fafc; border-radius: 0 0 12px 12px; }
.theme-light .warn { color: #64748b; } .theme-light .warn b { color: #92400e; }
.theme-light .account { color: #64748b; } .theme-light .account a { color: #2563eb; }

.ticket-enter-active, .ticket-leave-active { transition: opacity .35s ease; }
.ticket-enter-active .ticket, .ticket-leave-active .ticket { transition: transform .5s cubic-bezier(.2, .7, .1, 1), opacity .5s ease; }
.ticket-enter-from, .ticket-leave-to { opacity: 0; }
.ticket-enter-from .ticket { transform: translateY(24px) scale(.97); opacity: 0; }
.ticket-leave-to .ticket { transform: translateY(12px); opacity: 0; }

@media (max-width: 520px) {
  .main { padding: 36px 24px 24px; } .stub { padding: 20px 24px 24px; }
  form { flex-direction: column; align-items: stretch; }
  .enter { justify-content: center; }
}
</style>
