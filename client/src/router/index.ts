import { createRouter, createWebHistory } from 'vue-router';
import { getToken, fetchMe } from '../lib/auth';
import { openLoginModal } from '../lib/loginModal';

function getSessionId(): string {
  let sid = sessionStorage.getItem('_sid');
  if (!sid) {
    sid = Math.random().toString(36).slice(2) + Date.now().toString(36);
    sessionStorage.setItem('_sid', sid);
  }
  return sid;
}

function trackPageView(path: string) {
  if (path.startsWith('/admin')) return;
  fetch('/api/analytics/pageview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, referrer: document.referrer || '', session_id: getSessionId() }),
  }).catch(() => {});
}

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'home',
      component: () => import('../views/Home.vue'),
    },
    {
      path: '/en',
      name: 'home-en',
      component: () => import('../views/Home.vue'),
    },
    {
      path: '/fish',
      name: 'fish',
      component: () => import('../views/fish/FishGame.vue'),
      meta: { requiresAI: true },
    },
    {
      path: '/board',
      name: 'board',
      component: () => import('../views/board/WisdomBoard.vue'),
      meta: { requiresAI: true },
    },
    {
      path: '/synap',
      name: 'synap',
      component: () => import('../views/synap/SynapApp.vue'),
      meta: { requiresAuth: true },
      children: [
        { path: '', redirect: '/synap/chat' },
        { path: 'chat', name: 'synap-chat', component: () => import('../views/synap/ChatView.vue') },
        { path: 'files', name: 'synap-files', component: () => import('../views/synap/FileView.vue') },
        { path: 'consultant', name: 'synap-consultant', component: () => import('../views/synap/ConsultantView.vue') },
        { path: 'content', name: 'synap-content', component: () => import('../views/synap/ContentLab.vue') },
        { path: 'workbench', name: 'synap-workbench', component: () => import('../views/synap/WorkbenchView.vue') },
        { path: 'skills', name: 'synap-skills', component: () => import('../views/synap/SkillBuilder.vue') },
      ],
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('../views/settings/AISettings.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/settings/logs',
      name: 'settings-logs',
      component: () => import('../views/settings/AILogs.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/settings/tokens',
      name: 'settings-tokens',
      component: () => import('../views/settings/TokenManager.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/admin',
      component: () => import('../views/admin/AdminLayout.vue'),
      meta: { requiresAuth: true, requiresAdmin: true },
      children: [
        { path: '', redirect: '/admin/users' },
        { path: 'users', name: 'admin-users', component: () => import('../views/admin/UserManagement.vue') },
        { path: 'quotas', name: 'admin-quotas', component: () => import('../views/admin/QuotaManagement.vue') },
        { path: 'usage', name: 'admin-usage', component: () => import('../views/admin/AIDashboard.vue') },
        { path: 'config', name: 'admin-config', component: () => import('../views/admin/SystemConfig.vue') },
        { path: 'home', name: 'admin-home', component: () => import('../views/admin/HomeContent.vue') },
        { path: 'home/module/:id?', name: 'admin-home-module', component: () => import('../views/admin/HomeModuleEditor.vue') },
        { path: 'seo', name: 'admin-seo', component: () => import('../views/admin/SeoManagement.vue') },
        { path: 'discover', name: 'admin-discover', component: () => import('../views/admin/DiscoverManagement.vue') },
        { path: 'discover/edit/:id?', name: 'admin-discover-edit', component: () => import('../views/admin/DiscoverArticleEditor.vue') },
        { path: 'analytics', name: 'admin-analytics', component: () => import('../views/admin/AnalyticsDashboard.vue') },
      ],
    },
    {
      path: '/discover/:slug',
      name: 'discover-article',
      component: () => import('../views/discover/ArticleView.vue'),
    },
    {
      path: '/en/discover/:slug',
      name: 'discover-article-en',
      component: () => import('../views/discover/ArticleView.vue'),
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'not-found',
      component: () => import('../views/NotFound.vue'),
    },
  ],
});

router.beforeEach(async (to, from) => {
  const token = getToken();

  if (to.meta.requiresAuth && !token) {
    if (from.name) {
      setTimeout(() => openLoginModal(to.fullPath), 0);
      return false;
    } else {
      setTimeout(() => openLoginModal(to.fullPath), 100);
      return { name: 'home' };
    }
  }

  if (to.meta.requiresAI && !token) {
    if (from.name) {
      setTimeout(() => openLoginModal(to.fullPath, 'ai'), 0);
      return false;
    } else {
      setTimeout(() => openLoginModal(to.fullPath, 'ai'), 100);
      return { name: 'home' };
    }
  }

  if (to.meta.requiresAdmin && token) {
    const user = await fetchMe();
    if (!user || user.role !== 'admin') {
      return { name: 'home' };
    }
  }
});

router.afterEach((to) => {
  trackPageView(to.fullPath);
});

export default router;
