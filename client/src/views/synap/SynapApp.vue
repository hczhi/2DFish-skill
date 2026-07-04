<template>
  <div class="synap-app">
    <aside class="sidebar">
      <nav class="sidebar-nav">
        <div class="nav-section">
          <!-- Logo / Home -->
          <router-link to="/" class="nav-item" title="返回首页">
            <span class="nav-item-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9,22 9,12 15,12 15,22"/></svg>
            </span>
            <span class="nav-item-text">首页</span>
          </router-link>

          <div class="nav-divider" />

          <!-- Main Nav -->
          <router-link to="/synap/chat" class="nav-item" active-class="active" title="对话">
            <span class="nav-item-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
            </span>
            <span class="nav-item-text">对话</span>
          </router-link>
          
          <router-link to="/synap/consultant" class="nav-item" active-class="active" title="顾问">
            <span class="nav-item-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            </span>
            <span class="nav-item-text">顾问</span>
          </router-link>

          <router-link to="/synap/content" class="nav-item" active-class="active" title="内容">
            <span class="nav-item-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
            </span>
            <span class="nav-item-text">内容</span>
          </router-link>

          <router-link to="/synap/workbench" class="nav-item" active-class="active" title="工作台">
            <span class="nav-item-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
            </span>
            <span class="nav-item-text">工作台</span>
          </router-link>

          <div class="nav-divider" />

          <router-link to="/synap/files" class="nav-item" active-class="active" title="知识库文件">
            <span class="nav-item-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
            </span>
            <span class="nav-item-text">文件库</span>
          </router-link>

          <router-link to="/synap/skills" class="nav-item" active-class="active" title="技能构建">
            <span class="nav-item-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
            </span>
            <span class="nav-item-text">技能库</span>
          </router-link>

          <div class="nav-divider" />

          <!-- Settings -->
          <router-link to="/settings" class="nav-item" active-class="active" title="设置">
            <span class="nav-item-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            </span>
            <span class="nav-item-text">设置</span>
          </router-link>
        </div>
      </nav>
    </aside>

    <main class="synap-main">
      <router-view />
    </main>
  </div>
</template>


<style scoped>
.synap-app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  width: 100vw;
  background: var(--bg);
  position: relative;
  overflow: hidden;
}

/* Floating Dock Navigation - Editorial Vertical */
.sidebar {
  position: fixed;
  top: 50%;
  left: var(--space-6);
  transform: translateY(-50%);
  background: rgba(255, 255, 255, 0.6);
  backdrop-filter: blur(40px) saturate(150%);
  -webkit-backdrop-filter: blur(40px) saturate(150%);
  border: 1px solid rgba(0, 0, 0, 0.05);
  border-radius: var(--radius-lg);
  display: flex;
  flex-direction: column;
  padding: var(--space-3) var(--space-2);
  gap: var(--space-1);
  box-shadow: 
    0 4px 24px -8px rgba(0, 0, 0, 0.05),
    0 0 0 1px rgba(255, 255, 255, 0.8) inset;
  z-index: 1000;
  transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
  width: 52px;
  overflow: hidden;
}

.sidebar:hover {
  width: 160px;
  background: rgba(255, 255, 255, 0.9);
  box-shadow: 
    0 12px 48px -12px rgba(0, 0, 0, 0.1),
    0 0 0 1px rgba(255, 255, 255, 1) inset;
}

.sidebar-nav {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  height: 100%;
}

.nav-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin: 0;
  white-space: nowrap;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: 0 var(--space-2);
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 500;
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  background: transparent;
  position: relative;
  overflow: hidden;
  height: 36px;
  width: 100%;
  border: none;
  cursor: pointer;
  text-decoration: none;
  justify-content: flex-start;
}

.nav-item::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: var(--text);
  opacity: 0;
  transition: opacity 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  z-index: -1;
  border-radius: var(--radius-md);
}

.nav-item:hover {
  color: var(--text-inverse);
  transform: translateX(2px);
}

.nav-item:hover::before {
  opacity: 1;
}

.nav-item.active {
  color: var(--primary);
  background: transparent;
}

.nav-item.active::after {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 3px;
  height: 16px;
  background: var(--primary);
  border-radius: 0 4px 4px 0;
}

.nav-item.active:hover {
  color: var(--text-inverse);
}

.nav-item.active:hover::after {
  background: var(--text-inverse);
}

.nav-item-icon {
  font-size: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  z-index: 1;
  transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

.nav-item:hover .nav-item-icon {
  transform: scale(1.1);
}

.nav-item-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 15px;
  font-family: var(--font-serif);
  font-style: italic;
  letter-spacing: 0.02em;
  opacity: 0;
  transform: translateX(-10px);
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  z-index: 1;
}

.sidebar:hover .nav-item-text {
  opacity: 1;
  transform: translateX(0);
}

.nav-divider {
  width: 24px;
  height: 1px;
  background: var(--border);
  margin: var(--space-2) auto;
  transition: width 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

.sidebar:hover .nav-divider {
  width: calc(100% - 16px);
}

.synap-main {
  flex: 1;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  position: relative;
  padding-left: 72px;
  background: var(--bg);
}

@media (max-width: 768px) {
  .sidebar {
    top: auto;
    bottom: 12px;
    left: 50%;
    transform: translateX(-50%) translateY(0);
    flex-direction: row;
    width: auto !important;
    padding: var(--space-2) var(--space-3);
  }
  .sidebar:hover { width: auto !important; }
  .sidebar-nav, .nav-section { flex-direction: row; gap: var(--space-1); }
  .nav-item-text { display: none; }
  .nav-divider { width: 1px !important; height: 24px; margin: 0 var(--space-1); }
  .synap-main { padding-left: 0; padding-bottom: 64px; }
}
</style>
