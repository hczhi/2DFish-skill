<template>
  <header v-if="!embedded" class="site-header" :class="{ 'is-home': isHome }">
    <!-- Brand / Back Link -->
    <div class="header-left">
      <router-link :to="locale === 'en' ? '/en' : '/'" class="brand-link" v-if="!isHome">
        <span class="back-arrow">&larr;</span>
        <span class="brand-text">QiaoNan.</span>
      </router-link>
    </div>

    <!-- Right Actions -->
    <div class="header-right">
      <!-- 应用 key（112）模式：没有账号，显示的是这张卡和剩余点数。 -->
      <div class="top-links" v-if="keyMode">
        <span class="label">KEY:</span>
        <span class="value">{{ keyInfo?.keyPrefix || '…' }}</span>
        <span class="label">点数:</span>
        <span class="value">{{ keyInfo ? keyInfo.balance : '…' }}</span>
      </div>
      <div class="top-links" v-else-if="user">
        <span class="label">USER:</span>
        <span class="value">{{ user.username }}</span>
        <QuotaIndicator />
        <router-link to="/admin" class="nav-btn" v-if="isAdmin(user)">ADMIN</router-link>
        <router-link to="/settings/logs" class="nav-btn">LOGS</router-link>
        <router-link to="/settings" class="nav-btn">SETTINGS</router-link>
      </div>
      
      <!-- 应用页（展示稿 / 品牌咨询）只有中文，切到 EN 什么都不变，按了像是坏了。 -->
      <div class="lang-switch" v-if="!isAppPage">
        <button :class="{ active: locale === 'zh' }" @click="setLocale('zh')">中</button>
        <button :class="{ active: locale === 'en' }" @click="setLocale('en')">EN</button>
      </div>
      
      <button class="auth-btn topup-btn" @click="openTopup" v-if="keyMode">充值</button>
      <button class="auth-btn" @click="switchKey" v-if="keyMode">换 KEY</button>
      <button class="auth-btn" @click="handleLogout" v-else-if="user">EXIT</button>
      <!-- 对外没有登录（112 起卖 key）：管理员直接打开 /admin，守卫会弹登录框。 -->
    </div>
  </header>

  <!-- 充值码（115）：码充进的是**当前这把 key**，所以弹窗里要写出是哪一把 ——
       同一台电脑存过两把 key 时，充错了那一把读起来也是一句「充值成功」。 -->
  <Teleport to="body">
    <div v-if="topupOpen" class="topup-mask" @click.self="topupOpen = false">
      <div class="topup-box">
        <h3>充值</h3>
        <p class="topup-target">充进 KEY <code>{{ keyInfo?.keyPrefix || '…' }}</code>，当前 {{ keyInfo ? keyInfo.balance : '…' }} 点</p>
        <input v-model="topupCode" placeholder="粘贴充值码，如 PPTCZ-XXXX-XXXX-XXXX-XXXX" @keydown.enter="redeem" :disabled="topupBusy" />
        <p v-if="topupErr" class="topup-err">{{ topupErr }}</p>
        <p v-if="topupOk" class="topup-ok">{{ topupOk }}</p>
        <div class="topup-actions">
          <button class="topup-cancel" @click="topupOpen = false">{{ topupOk ? '完成' : '取消' }}</button>
          <button class="topup-go" :disabled="topupBusy || !topupCode.trim()" @click="redeem">{{ topupBusy ? '充值中…' : '充值' }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { fetchMe, logout, isAdmin, type AuthUser } from '../../lib/auth'
import QuotaIndicator from './QuotaIndicator.vue'
import { isEmbedMode } from '../../lib/embed'
import { activeKeyApp, activeAppKey, clearAppKey, keyInfo, refreshKeyInfo } from '../../lib/appKey'
import { apiPost } from '../../lib/api'

// 嵌到第三方页面里的时候整条刊头（和页脚）都不出现。判断放在这两个组件**自己**身上，
// 不放在各个页面里：漏掉一个页面的后果是那一页在别人的站点上顶着我们的 LOGIN 按钮和
// ADMIN/SETTINGS 链接 —— 点进去是我们的登录框（在他们的页面里），而那一页本身工作正常。
// 顺带也别再发 fetchMe()：拿着 consult:embed 那把短 token 调 /api/auth/me 会被 scopeGuard
// 403，控制台里一串红，而界面看不出任何异常。
const embedded = isEmbedMode()
// key 模式下也不发 fetchMe()：影子用户调 /api/auth/me 会被 scopeGuard 403（同上）。
const keyMode = !embedded && !!activeAppKey()

const route = useRoute()
const router = useRouter()
const isHome = computed(() => route.path === '/' || route.path === '/en')
const isAppPage = computed(() => /^\/(ppt|consult)(\/|$)/.test(route.path))

const user = ref<AuthUser | null>(null)
const locale = computed(() => {
  if (route.path === '/en' || route.path.startsWith('/en/')) return 'en'
  return 'zh'
})

const emit = defineEmits(['locale-changed'])

function setLocale(lang: string) {
  localStorage.setItem('locale', lang)
  emit('locale-changed', lang)

  if (isHome.value) {
    router.push(lang === 'en' ? '/en' : '/')
  } else if (route.path === '/en/discover' || route.path.startsWith('/en/discover/')) {
    if (lang === 'zh') router.push(route.path.replace('/en/discover', '/discover'))
  } else if (route.path === '/discover' || route.path.startsWith('/discover/')) {
    if (lang === 'en') router.push('/en' + route.path)
  } else if (route.path.startsWith('/en/')) {
    if (lang === 'zh') router.push(route.path.replace(/^\/en/, ''))
  } else {
    if (lang === 'en') router.push('/en' + route.path)
    else window.location.reload()
  }
}

onMounted(async () => {
  if (embedded) return
  if (keyMode) { refreshKeyInfo(); return }
  user.value = await fetchMe()
})

// 「换 KEY」只清本地这一份，不动服务端：卡还在，稿子也在，重新输入就回来了。
function switchKey() {
  const app = activeKeyApp()
  if (!app) return
  if (!confirm('退出这个 key？稿子不会丢，重新输入同一个 key 就能回来。请确认你已经保存好它。')) return
  clearAppKey(app)
  window.location.href = `/${app}/key`
}

const topupOpen = ref(false)
const topupCode = ref('')
const topupBusy = ref(false)
const topupErr = ref('')
const topupOk = ref('')

function openTopup() {
  topupCode.value = ''
  topupErr.value = ''
  topupOk.value = ''
  topupOpen.value = true
}

async function redeem() {
  if (topupBusy.value || !topupCode.value.trim()) return
  topupBusy.value = true
  topupErr.value = ''
  topupOk.value = ''
  try {
    const r = await apiPost<{ points: number; balance: number }>('/api/app-keys/redeem', { code: topupCode.value })
    topupOk.value = `已充入 ${r.points} 点，现在可用 ${r.balance} 点`
    topupCode.value = ''
    await refreshKeyInfo()
  } catch (e: any) {
    // 服务端的话术已经分好了成因（抄错 / 贴成 key / 别的应用 / 已用过），原样给他看。
    topupErr.value = e.message || '充值失败'
  } finally {
    topupBusy.value = false
  }
}

function handleLogout() {
  logout()
}

</script>

<style scoped>
.site-header {
  position: fixed;
  top: 0; 
  right: 0; 
  left: 0;
  height: 50px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  z-index: 100;
  border-bottom: 1px solid var(--c-grid, rgba(0, 160, 255, 0.15));
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(8px);
  font-family: var(--font-mono, monospace);
  font-size: 12px;
  letter-spacing: 1px;
  padding-left: env(safe-area-inset-left);
  padding-right: env(safe-area-inset-right);
}

/* On Home page, the header only spans the right side if left panel exists */
@media (min-width: 769px) {
  .site-header.is-home {
    left: 360px; /* match the left-panel width */
    background: rgba(255, 255, 255, 0.9);
  }
}

/* Adjust header offset when left panel shrinks on medium screens */
@media (max-width: 1200px) and (min-width: 901px) {
  .site-header.is-home {
    left: 280px;
  }
}

@media (max-width: 900px) and (min-width: 769px) {
  .site-header.is-home {
    left: 240px;
  }
}

.header-left {
  display: flex;
  align-items: center;
  padding-left: 24px;
}

.brand-link {
  display: flex;
  align-items: center;
  gap: 8px;
  text-decoration: none;
  color: var(--c-text-main, #111);
  transition: color 0.2s;
}

.brand-link:hover {
  color: #0077FF;
}

.back-arrow {
  font-size: 16px;
}

.brand-text {
  font-family: var(--font-serif, serif);
  font-size: 18px;
  font-weight: 700;
  letter-spacing: 0;
}

.header-right {
  display: flex;
  align-items: center;
  height: 100%;
  min-width: 0;
}

.top-links {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 0 24px;
  border-right: 1px solid var(--c-grid, rgba(0, 160, 255, 0.15));
  height: 100%;
}

.label {
  color: #888;
  letter-spacing: 2px;
  text-transform: uppercase;
}

.value {
  font-weight: bold;
  color: var(--c-text-main, #111);
}

.nav-btn {
  color: var(--c-text-sub, #555);
  text-decoration: none;
  transition: color 0.2s;
  margin-left: 8px;
}
.nav-btn:hover { color: #0077FF; }

.lang-switch {
  display: flex;
  align-items: center;
  height: 100%;
  border-right: 1px solid var(--c-grid, rgba(0, 160, 255, 0.15));
  padding: 0 12px;
  gap: 4px;
}

.lang-switch button {
  padding: 4px 10px;
  border: 1px solid #e5e7eb;
  background: transparent;
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  cursor: pointer;
  border-radius: 8px; /* HC Design */
  color: var(--c-text-sub, #555);
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

.lang-switch button.active {
  background: #3B5BDB;
  color: #fff;
  border-color: #3B5BDB;
  box-shadow: 0 4px 12px rgba(59, 91, 219, 0.2);
}

.lang-switch button:hover:not(.active) {
  border-color: #3B5BDB;
  color: #3B5BDB;
}

.auth-btn {
  height: 100%;
  padding: 0 32px;
  background-color: #3B5BDB;
  color: #fff;
  border: none;
  font-family: var(--font-mono, monospace);
  font-size: 12px;
  font-weight: bold;
  letter-spacing: 2px;
  cursor: pointer;
  display: flex;
  align-items: center;
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

.auth-btn:hover {
  background-color: #2b45a8;
}

.auth-btn.topup-btn { background-color: #f07a2c; }
.auth-btn.topup-btn:hover { background-color: #d9661b; }

.topup-mask { position: fixed; inset: 0; z-index: 1000; display: grid; place-items: center; background: rgba(15, 23, 42, .45); }
.topup-box { width: min(420px, calc(100vw - 32px)); box-sizing: border-box; padding: 24px; border-radius: 14px; background: #fff; box-shadow: 0 24px 60px rgba(15, 23, 42, .25); font-size: 14px; color: #334155; }
.topup-box h3 { margin: 0 0 6px; font-size: 18px; color: #0f172a; font-family: inherit; }
.topup-target { margin: 0 0 14px; font-size: 13px; color: #64748b; }
.topup-target code { background: #f1f5f9; padding: 1px 5px; border-radius: 4px; color: #0f172a; }
.topup-box input { width: 100%; box-sizing: border-box; padding: 10px 12px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 14px; font-family: monospace; }
.topup-box input:focus { outline: none; border-color: #3B5BDB; box-shadow: 0 0 0 3px rgba(59, 91, 219, .15); }
.topup-err { margin: 10px 0 0; padding: 8px 10px; border-radius: 6px; background: #fef2f2; color: #b91c1c; font-size: 13px; }
.topup-ok { margin: 10px 0 0; padding: 8px 10px; border-radius: 6px; background: #ecfdf5; color: #166534; font-size: 13px; }
.topup-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
.topup-actions button { padding: 8px 18px; border-radius: 8px; font-size: 14px; cursor: pointer; border: 1px solid #e2e8f0; background: #fff; color: #475569; }
.topup-actions .topup-go { background: #3B5BDB; border-color: #3B5BDB; color: #fff; }
.topup-actions .topup-go:disabled { opacity: .5; cursor: not-allowed; }

@media (max-width: 768px) {
  .site-header {
    height: 56px;
  }
  .site-header.is-home {
    left: 0;
  }
  .top-links {
    display: none;
  }
  .header-left {
    padding-left: 16px;
  }
  .header-right {
    flex-shrink: 0;
  }
  .brand-text {
    font-size: 16px;
  }
  .lang-switch {
    padding: 0 8px;
  }
  .lang-switch button {
    min-width: 36px;
    padding: 4px 8px;
    font-size: 10px;
  }
  .auth-btn {
    padding: 0 18px;
    font-size: 11px;
    letter-spacing: 1.5px;
  }
}
</style>
