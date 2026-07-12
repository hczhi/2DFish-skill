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
        <router-link to="/admin/topics" class="nav-item" active-class="active" @click="sidebarOpen = false">专题管理</router-link>
        <router-link to="/admin/analytics" class="nav-item" active-class="active" @click="sidebarOpen = false">数据统计</router-link>
        <router-link to="/admin/modules" class="nav-item" active-class="active" @click="sidebarOpen = false">模块管理</router-link>
        <router-link to="/admin/seo" class="nav-item" active-class="active" @click="sidebarOpen = false">SEO 管理</router-link>
        <router-link to="/admin/ads" class="nav-item" active-class="active" @click="sidebarOpen = false">广告管理</router-link>
        <router-link to="/admin/upload" class="nav-item" active-class="active" @click="sidebarOpen = false">图片上传</router-link>
        <router-link to="/admin/tender" class="nav-item" active-class="active" @click="sidebarOpen = false">标讯管理</router-link>
        <div class="nav-group" :class="{ active: isUiReviewActive }">
          <div class="nav-item nav-group-title">UI 测评</div>
          <div class="nav-submenu">
            <router-link to="/admin/ui-review-records" class="nav-sub-item" active-class="active" @click="sidebarOpen = false">评测记录</router-link>
            <router-link to="/admin/ui-review-rules" class="nav-sub-item" active-class="active" @click="sidebarOpen = false">评分规则</router-link>
            <router-link to="/admin/ui-style-skills" class="nav-sub-item" active-class="active" @click="sidebarOpen = false">风格 Skill</router-link>
          </div>
        </div>
      </nav>
    </aside>
    <main class="admin-main">
      <router-view />
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { fetchMe, isAdmin } from '../../lib/auth'

const router = useRouter()
const route = useRoute()
const sidebarOpen = ref(false)

const isUiReviewActive = computed(() => {
  const path = route.path
  return path.startsWith('/admin/ui-review') || path.startsWith('/admin/ui-style')
})

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
.hc-modal-container .btn-cancel,
.hc-btn {
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
.hc-modal-container .btn-primary,
.hc-btn-primary {
  background: #3B5BDB;
  color: #fff;
}
.admin-main .btn-primary:hover,
.hc-modal-container .btn-primary:hover,
.hc-btn-primary:hover {
  background: #2b45a8;
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(59, 91, 219, 0.3);
}

.admin-main .btn-secondary,
.admin-main .btn-cancel,
.hc-modal-container .btn-secondary,
.hc-modal-container .btn-cancel,
.hc-btn-secondary,
.hc-btn-cancel {
  border-color: #e5e7eb;
}
.admin-main .btn-secondary:hover,
.admin-main .btn-cancel:hover,
.admin-main .btn-sm:hover,
.hc-modal-container .btn-secondary:hover,
.hc-modal-container .btn-cancel:hover,
.hc-modal-container .btn-sm:hover,
.hc-btn-secondary:hover,
.hc-btn-cancel:hover {
  background: #f9fafb;
  border-color: #d1d5db;
}

.admin-main .btn-danger,
.hc-modal-container .btn-danger,
.hc-btn-danger {
  color: #ef4444;
  background: #fef2f2;
}
.admin-main .btn-danger:hover,
.hc-modal-container .btn-danger:hover,
.hc-btn-danger:hover {
  background: #fee2e2;
  color: #dc2626;
}

/* --- HC Design 数据表格 (Data Table) 优化 --- */
.hc-table-container {
  background: #ffffff;
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.04); /* 加深了点阴影增强层次 */
  overflow: hidden;
  border: 1px solid rgba(0, 0, 0, 0.05); /* 极细的高级边框 */
  margin-top: 32px; /* 增加与页面标题的间距 */
}

.hc-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  text-align: left;
}

.hc-table th {
  padding: 24px 24px 16px 24px; /* 表头增加间距，留白更足 */
  font-size: 14px;
  font-weight: 600;
  color: var(--c-text-sub);
  background: #fdfdfd; /* 极淡的灰底区分表头 */
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);
  white-space: nowrap;
}

.hc-table td {
  padding: 24px; /* 增大单元格间距，让内容呼吸 */
  font-size: 14px;
  color: var(--c-text-main);
  border-bottom: 1px solid rgba(0, 0, 0, 0.04);
  vertical-align: top; /* 顶部对齐，适合多行文本如文章标题/摘要 */
  line-height: 1.6;
}

.hc-table tr:last-child td {
  border-bottom: none;
}

.hc-table tr:hover td {
  background: rgba(67, 97, 238, 0.02); /* Hover 时非常淡的品牌蓝背景 */
}

/* 表格内的操作按钮容器 */
.table-actions {
  display: flex;
  gap: 12px; /* 增大按钮之间的间距 */
  flex-wrap: wrap;
}

/* 调整徽章(Badge)在表格中的显示 */
.hc-table .hc-badge {
  display: inline-flex;
  margin-right: 6px;
  margin-bottom: 6px;
}

/* 徽章 HC Design */
.admin-main .badge,
.hc-modal-container .badge,
.hc-badge {
  font-family: var(--font-sans, sans-serif);
  font-size: 12px;
  font-weight: 600;
  padding: 4px 8px;
  border-radius: 6px;
}
.admin-main .badge.admin, .admin-main .badge-green, .hc-modal-container .badge-green, .hc-badge-green { color: #059669; background: #d1fae5; }
.admin-main .badge.user, .admin-main .badge-gray, .hc-modal-container .badge-gray, .hc-badge-gray { color: #4b5563; background: #f3f4f6; }
.admin-main .badge-blue, .hc-modal-container .badge-blue, .hc-badge-blue { color: #3B5BDB; background: #e0e7ff; }
.admin-main .badge-red, .hc-modal-container .badge-red, .hc-badge-red { color: #dc2626; background: #fef2f2; }

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
  border-radius: 10px;
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
  --c-grid: rgba(0, 0, 0, 0.02);
  --c-blue-primary: #0077FF;
  --c-text-main: #111111;
  --c-text-sub: #555555;
  --c-border: #E5E7EB;
  --font-serif: "Noto Serif SC", "Songti SC", "SimSun", serif;
  --font-mono: "JetBrains Mono", "Courier New", monospace;
  --font-sans: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Arial, sans-serif;
  font-family: var(--font-sans);
  background-color: #fbfbfd;
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
  flex: 1;
  overflow-y: auto;
  min-height: 0;
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
.nav-divider {
  height: 1px;
  background: var(--c-border);
  margin: 8px 24px;
}
.nav-group {
  position: relative;
}
.nav-group-title {
  cursor: default;
}
.nav-submenu {
  display: none;
  position: absolute;
  left: 100%;
  top: 0;
  min-width: 160px;
  background: #fff;
  border: 2px solid var(--c-text-main);
  box-shadow: 6px 6px 0 rgba(0,0,0,0.08);
  z-index: 20;
}
.nav-group:hover .nav-submenu {
  display: flex;
  flex-direction: column;
}
.nav-group:hover .nav-group-title {
  background: rgba(0, 119, 255, 0.05);
  padding-left: 32px;
}
.nav-group.active .nav-group-title {
  background: var(--c-text-main);
  color: #fff;
  border-left: 4px solid var(--c-blue-primary);
}
.nav-sub-item {
  display: block;
  padding: 12px 20px;
  color: var(--c-text-main);
  text-decoration: none;
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: bold;
  letter-spacing: 0.5px;
  border-bottom: 1px solid var(--c-border);
  transition: all 0.2s;
}
.nav-sub-item:last-child {
  border-bottom: none;
}
.nav-sub-item:hover {
  background: rgba(0, 119, 255, 0.05);
  padding-left: 28px;
}
.nav-sub-item.active {
  background: var(--c-text-main);
  color: #fff;
}
.admin-main {
  flex: 1;
  overflow-y: auto;
  padding: 48px;
  background: #fbfbfd;
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
