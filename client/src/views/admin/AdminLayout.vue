<template>
  <div class="admin-layout">
    <button class="mobile-toggle" @click="sidebarOpen = !sidebarOpen">&#9776;</button>
    <aside class="admin-sidebar" :class="{ open: sidebarOpen }">
      <div class="admin-brand">
        <router-link to="/" class="back-link">&larr; 返回首页</router-link>
        <h2>管理后台</h2>
      </div>
      <nav class="admin-nav">
        <router-link to="/admin/users" class="nav-item" active-class="active" @click="sidebarOpen = false">用户管理</router-link>
        <router-link to="/admin/quotas" class="nav-item" active-class="active" @click="sidebarOpen = false">额度管理</router-link>
        <router-link to="/admin/usage" class="nav-item" active-class="active" @click="sidebarOpen = false">AI 用量</router-link>
        <router-link to="/admin/config" class="nav-item" active-class="active" @click="sidebarOpen = false">系统配置</router-link>
        <router-link to="/admin/home" class="nav-item" active-class="active" @click="sidebarOpen = false">首页内容</router-link>
      </nav>
    </aside>
    <main class="admin-main">
      <router-view />
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { fetchMe, isAdmin } from '../../lib/auth'

const router = useRouter()
const sidebarOpen = ref(false)

onMounted(async () => {
  const user = await fetchMe()
  if (!user || !isAdmin(user)) {
    router.replace('/')
  }
})
</script>

<style scoped>
.admin-layout {
  display: flex;
  height: 100vh;
  overflow: hidden;
}
.admin-sidebar {
  width: 220px;
  background: #1a1a2e;
  color: #fff;
  display: flex;
  flex-direction: column;
  padding: 24px 0;
  flex-shrink: 0;
}
.admin-brand {
  padding: 0 20px 24px;
  border-bottom: 1px solid rgba(255,255,255,0.1);
}
.admin-brand h2 {
  font-family: -apple-system, sans-serif;
  font-size: 18px;
  font-weight: 600;
  margin: 8px 0 0;
}
.back-link {
  color: rgba(255,255,255,0.6);
  text-decoration: none;
  font-size: 13px;
}
.back-link:hover { color: #fff; }
.admin-nav {
  display: flex;
  flex-direction: column;
  padding: 16px 0;
}
.nav-item {
  display: block;
  padding: 10px 20px;
  color: rgba(255,255,255,0.7);
  text-decoration: none;
  font-size: 14px;
  transition: all 0.2s;
}
.nav-item:hover { color: #fff; background: rgba(255,255,255,0.05); }
.nav-item.active { color: #fff; background: rgba(0,82,255,0.3); border-left: 3px solid #0052FF; }
.admin-main {
  flex: 1;
  overflow-y: auto;
  padding: 32px;
  background: var(--bg-secondary, #f8f9fa);
}
.mobile-toggle {
  display: none;
  position: fixed;
  top: 12px;
  left: 12px;
  z-index: 100;
  background: #1a1a2e;
  color: #fff;
  border: none;
  border-radius: 6px;
  padding: 8px 12px;
  font-size: 18px;
  cursor: pointer;
}
@media (max-width: 768px) {
  .mobile-toggle { display: block; }
  .admin-sidebar {
    position: fixed;
    left: -240px;
    top: 0;
    height: 100vh;
    z-index: 99;
    transition: left 0.3s;
  }
  .admin-sidebar.open { left: 0; }
  .admin-main { padding: 16px; padding-top: 52px; }
}
</style>
