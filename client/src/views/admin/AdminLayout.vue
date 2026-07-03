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
        <router-link to="/admin/discover" class="nav-item" active-class="active" @click="sidebarOpen = false">文章管理</router-link>
        <router-link to="/admin/analytics" class="nav-item" active-class="active" @click="sidebarOpen = false">数据统计</router-link>
        <router-link to="/admin/seo" class="nav-item" active-class="active" @click="sidebarOpen = false">SEO 管理</router-link>
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

<style>
/* 注入全局的 HC Design Admin 样式，作用于所有的后台子页面及 HcModal 内的表单 */
.admin-main .page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  margin-bottom: 32px;
  border-bottom: 1px solid var(--c-border, #E5E7EB);
  padding-bottom: 16px;
}
.admin-main .page-header h1,
.admin-main .section-header h2 {
  font-family: var(--font-sans, sans-serif);
  font-size: 32px;
  font-weight: 800;
  margin: 0;
  letter-spacing: -1px;
}

/* 按钮全局 HC Design */
.admin-main .btn-primary,
.admin-main .btn-secondary,
.admin-main .btn-sm,
.admin-main .btn-danger,
.admin-main .btn-cancel,
.hc-modal-container .btn-primary,
.hc-modal-container .btn-secondary,
.hc-modal-container .btn-sm,
.hc-modal-container .btn-danger,
.hc-modal-container .btn-cancel {
  font-family: var(--font-sans, sans-serif);
  font-size: 14px;
  font-weight: 600;
  border: 1px solid transparent;
  border-radius: 8px;
  padding: 8px 16px;
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  background: #fff;
  color: #374151;
}

.admin-main .btn-primary,
.hc-modal-container .btn-primary {
  background: #3B5BDB;
  color: #fff;
}
.admin-main .btn-primary:hover,
.hc-modal-container .btn-primary:hover {
  background: #2b45a8;
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(59, 91, 219, 0.3);
}

.admin-main .btn-secondary,
.admin-main .btn-cancel,
.hc-modal-container .btn-secondary,
.hc-modal-container .btn-cancel {
  border-color: #e5e7eb;
}
.admin-main .btn-secondary:hover,
.admin-main .btn-cancel:hover,
.admin-main .btn-sm:hover,
.hc-modal-container .btn-secondary:hover,
.hc-modal-container .btn-cancel:hover,
.hc-modal-container .btn-sm:hover {
  background: #f9fafb;
  border-color: #d1d5db;
}

.admin-main .btn-danger,
.hc-modal-container .btn-danger {
  color: #ef4444;
  background: #fef2f2;
}
.admin-main .btn-danger:hover,
.hc-modal-container .btn-danger:hover {
  background: #fee2e2;
  color: #dc2626;
}

/* 表格全局 HC Design */
.admin-main .data-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  background: #fff;
  border: 1px solid var(--c-border, #E5E7EB);
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.02);
}
.admin-main .data-table th {
  text-align: left;
  padding: 16px;
  font-family: var(--font-sans, sans-serif);
  font-size: 13px;
  font-weight: 600;
  color: #6b7280;
  border-bottom: 1px solid var(--c-border, #E5E7EB);
  background: #f9fafb;
}
.admin-main .data-table td {
  padding: 16px;
  border-bottom: 1px solid var(--c-border, #E5E7EB);
  font-size: 14px;
  vertical-align: middle;
}
.admin-main .data-table tr:last-child td {
  border-bottom: none;
}
.admin-main .data-table tr:hover td {
  background: #f9fafb;
}

/* 徽章 HC Design */
.admin-main .badge,
.hc-modal-container .badge {
  font-family: var(--font-sans, sans-serif);
  font-size: 12px;
  font-weight: 600;
  padding: 4px 8px;
  border-radius: 6px;
}
.admin-main .badge.admin, .admin-main .badge-green, .hc-modal-container .badge-green { color: #059669; background: #d1fae5; }
.admin-main .badge.user, .admin-main .badge-gray, .hc-modal-container .badge-gray { color: #4b5563; background: #f3f4f6; }
.admin-main .badge-blue, .hc-modal-container .badge-blue { color: #3B5BDB; background: #e0e7ff; }

/* 表单全局 HC Design */
.admin-main .form-row label, .admin-main .form-group label,
.hc-modal-container .form-row label, .hc-modal-container .form-group label {
  display: block;
  margin-bottom: 8px;
  font-family: var(--font-sans, sans-serif);
  font-size: 13px;
  font-weight: 600;
  color: #4b5563;
}
.admin-main .form-row input, .admin-main .form-row select,
.admin-main .form-row textarea,
.admin-main .form-group input,
.admin-main .form-group textarea,
.hc-modal-container .form-row input, .hc-modal-container .form-row select,
.hc-modal-container .form-row textarea,
.hc-modal-container .form-group input,
.hc-modal-container .form-group textarea {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 12px 16px;
  font-family: var(--font-sans, sans-serif);
  font-size: 14px;
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  background: #f9fafb;
  color: #111827;
  box-shadow: inset 0 2px 4px rgba(0,0,0,0.02);
}
.admin-main .form-row input:focus, .admin-main .form-row select:focus,
.admin-main .form-row textarea:focus,
.admin-main .form-group input:focus,
.admin-main .form-group textarea:focus,
.hc-modal-container .form-row input:focus, .hc-modal-container .form-row select:focus,
.hc-modal-container .form-row textarea:focus,
.hc-modal-container .form-group input:focus,
.hc-modal-container .form-group textarea:focus {
  outline: none;
  background: #ffffff;
  border-color: #3B5BDB;
  box-shadow: 0 0 0 4px rgba(59, 91, 219, 0.15);
}
</style>

<style scoped>
.admin-layout {
  display: flex;
  height: 100vh;
  overflow: hidden;
  --c-grid: rgba(0, 160, 255, 0.15);
  --c-blue-primary: #0077FF;
  --c-text-main: #111111;
  --c-text-sub: #555555;
  --c-border: #E5E7EB;
  --font-serif: "Noto Serif SC", "Songti SC", "SimSun", serif;
  --font-mono: "JetBrains Mono", "Courier New", monospace;
  --font-sans: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Arial, sans-serif;
  font-family: var(--font-sans);
  background-color: #ffffff;
  color: var(--c-text-main);
}
.admin-sidebar {
  width: 240px;
  background: #fff;
  border-right: 2px solid var(--c-text-main);
  color: var(--c-text-main);
  display: flex;
  flex-direction: column;
  padding: 0;
  flex-shrink: 0;
  z-index: 10;
}
.admin-brand {
  padding: 32px 24px;
  border-bottom: 2px solid var(--c-text-main);
  background: #f8f8f8;
}
.admin-brand h2 {
  font-family: var(--font-serif);
  font-size: 28px;
  font-weight: 700;
  margin: 12px 0 0;
  letter-spacing: -1px;
  text-transform: uppercase;
}
.back-link {
  color: var(--c-text-sub);
  text-decoration: none;
  font-size: 12px;
  font-family: var(--font-mono);
  text-transform: uppercase;
  letter-spacing: 1px;
  display: inline-block;
  transition: color 0.2s;
}
.back-link:hover { color: var(--c-blue-primary); }
.admin-nav {
  display: flex;
  flex-direction: column;
  padding: 0;
}
.nav-item {
  display: block;
  padding: 16px 24px;
  color: var(--c-text-main);
  text-decoration: none;
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: bold;
  text-transform: uppercase;
  letter-spacing: 1px;
  border-bottom: 1px solid var(--c-border);
  transition: all 0.2s;
}
.nav-item:hover {
  background: rgba(0, 119, 255, 0.05);
  padding-left: 32px;
}
.nav-item.active {
  background: var(--c-text-main);
  color: #fff;
  border-left: 4px solid var(--c-blue-primary);
}
.admin-main {
  flex: 1;
  overflow-y: auto;
  padding: 48px;
  background: #ffffff;
  position: relative;
}
.admin-main::before {
  content: '';
  position: fixed;
  top: 0; left: 240px; right: 0; bottom: 0;
  background-image:
    linear-gradient(to right, var(--c-grid) 1px, transparent 1px),
    linear-gradient(to bottom, var(--c-grid) 1px, transparent 1px);
  background-size: 50px 50px;
  z-index: 0;
  pointer-events: none;
}
.admin-main > * {
  position: relative;
  z-index: 1;
}
.mobile-toggle {
  display: none;
  position: fixed;
  top: 16px;
  left: 16px;
  z-index: 100;
  background: #fff;
  color: var(--c-text-main);
  border: 2px solid var(--c-text-main);
  border-radius: 0;
  padding: 8px 12px;
  font-size: 18px;
  cursor: pointer;
  box-shadow: 4px 4px 0 var(--c-text-main);
}
@media (max-width: 768px) {
  .mobile-toggle { display: block; }
  .admin-sidebar {
    position: fixed;
    left: -260px;
    top: 0;
    height: 100vh;
    z-index: 99;
    transition: left 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    box-shadow: 20px 0 40px rgba(0,0,0,0.1);
  }
  .admin-sidebar.open { left: 0; }
  .admin-main { padding: 24px; padding-top: 80px; }
  .admin-main::before { left: 0; }
}
</style>
