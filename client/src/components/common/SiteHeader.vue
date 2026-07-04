<template>
  <header class="site-header" :class="{ 'is-home': isHome }">
    <!-- Brand / Back Link -->
    <div class="header-left">
      <router-link :to="locale === 'en' ? '/en' : '/'" class="brand-link" v-if="!isHome">
        <span class="back-arrow">&larr;</span>
        <span class="brand-text">QiaoNan.</span>
      </router-link>
    </div>

    <!-- Right Actions -->
    <div class="header-right">
      <div class="top-links" v-if="user">
        <span class="label">USER:</span>
        <span class="value">{{ user.username }}</span>
        <QuotaIndicator />
        <router-link to="/admin" class="nav-btn" v-if="isAdmin(user)">ADMIN</router-link>
        <router-link to="/settings/logs" class="nav-btn">LOGS</router-link>
        <router-link to="/settings" class="nav-btn">SETTINGS</router-link>
      </div>
      
      <div class="lang-switch">
        <button :class="{ active: locale === 'zh' }" @click="setLocale('zh')">中</button>
        <button :class="{ active: locale === 'en' }" @click="setLocale('en')">EN</button>
      </div>
      
      <button class="auth-btn" @click="handleLogout" v-if="user">EXIT</button>
      <button class="auth-btn" @click="openLogin" v-else>LOGIN</button>
    </div>
  </header>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { fetchMe, logout, isAdmin, type AuthUser } from '../../lib/auth'
import QuotaIndicator from './QuotaIndicator.vue'
import { openLoginModal } from '../../lib/loginModal'

const route = useRoute()
const router = useRouter()
const isHome = computed(() => route.path === '/' || route.path === '/en')

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
  user.value = await fetchMe()
})

function handleLogout() {
  logout()
}

function openLogin() {
  openLoginModal(route.fullPath)
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

@media (max-width: 768px) {
  .site-header.is-home {
    left: 0;
  }
  .top-links {
    display: none;
  }
  .header-left {
    padding-left: 16px;
  }
  .auth-btn {
    padding: 0 20px;
  }
}
</style>
