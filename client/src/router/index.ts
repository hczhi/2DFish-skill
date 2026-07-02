import { createRouter, createWebHistory } from 'vue-router';
import { getToken, fetchMe } from '../lib/auth';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'home',
      component: () => import('../views/Home.vue'),
    },
    {
      path: '/login',
      name: 'login',
      component: () => import('../views/Login.vue'),
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
      ],
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'not-found',
      component: () => import('../views/NotFound.vue'),
    },
  ],
});

router.beforeEach(async (to) => {
  const token = getToken();

  if (to.meta.requiresAuth && !token) {
    return { name: 'login', query: { redirect: to.fullPath } };
  }

  if (to.meta.requiresAI && !token) {
    return { name: 'login', query: { redirect: to.fullPath, reason: 'ai' } };
  }

  if (to.meta.requiresAdmin && token) {
    const user = await fetchMe();
    if (!user || user.role !== 'admin') {
      return { name: 'home' };
    }
  }
});

export default router;
