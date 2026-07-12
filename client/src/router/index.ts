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
    },
    {
      path: '/en/fish',
      name: 'fish-en',
      component: () => import('../views/fish/FishGame.vue'),
    },
    {
      path: '/board',
      name: 'board',
      component: () => import('../views/board/WisdomBoard.vue'),
    },
    {
      path: '/en/board',
      name: 'board-en',
      component: () => import('../views/board/WisdomBoard.vue'),
    },
    {
      path: '/synap',
      name: 'synap',
      component: () => import('../views/synap/SynapApp.vue'),
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
      redirect: '/settings/tokens',
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
        { path: 'topics', name: 'admin-topics', component: () => import('../views/admin/TopicManagement.vue') },
        { path: 'discover/edit/:id?', name: 'admin-discover-edit', component: () => import('../views/admin/DiscoverArticleEditor.vue') },
        { path: 'modules', name: 'admin-modules', component: () => import('../views/admin/ModuleConfig.vue') },
        { path: 'analytics', name: 'admin-analytics', component: () => import('../views/admin/AnalyticsDashboard.vue') },
        { path: 'ads', name: 'admin-ads', component: () => import('../views/admin/AdSlotManagement.vue') },
        { path: 'upload', name: 'admin-upload', component: () => import('../views/admin/UploadPage.vue') },
        { path: 'ui-review-records', name: 'admin-ui-review-records', component: () => import('../views/admin/UiReviewRecords.vue') },
        { path: 'ui-review-records/:id', name: 'admin-ui-review-detail', component: () => import('../views/admin/UiReviewDetail.vue') },
        { path: 'ui-review-rules', name: 'admin-ui-review-rules', component: () => import('../views/admin/UiReviewRules.vue') },
        { path: 'ui-review-rules/create', name: 'admin-ui-review-rule-create', component: () => import('../views/admin/UiReviewRuleEditor.vue') },
        { path: 'ui-review-rules/:id/edit', name: 'admin-ui-review-rule-edit', component: () => import('../views/admin/UiReviewRuleEditor.vue') },
        { path: 'ui-style-skills', name: 'admin-ui-style-skills', component: () => import('../views/admin/UiStyleSkills.vue') },
        { path: 'ui-style-skills/create', name: 'admin-ui-style-skill-create', component: () => import('../views/admin/UiStyleSkillEditor.vue') },
        { path: 'ui-style-skills/:id/edit', name: 'admin-ui-style-skill-edit', component: () => import('../views/admin/UiStyleSkillEditor.vue') },
        { path: 'tender', name: 'admin-tender', component: () => import('../views/admin/TenderManagement.vue') },
      ],
    },
    {
      path: '/ui-review',
      name: 'ui-review',
      component: () => import('../views/uiReview/UiReviewPage.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/en/ui-review',
      name: 'ui-review-en',
      component: () => import('../views/uiReview/UiReviewPage.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/tender',
      name: 'tender',
      component: () => import('../views/tender/TenderPage.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/en/tender',
      name: 'tender-en',
      component: () => import('../views/tender/TenderPage.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/discover',
      name: 'discover-list',
      component: () => import('../views/discover/DiscoverList.vue'),
    },
    {
      path: '/en/discover',
      name: 'discover-list-en',
      component: () => import('../views/discover/DiscoverList.vue'),
    },
    {
      path: '/discover/topic/:slug',
      name: 'discover-topic',
      component: () => import('../views/discover/TopicView.vue'),
    },
    {
      path: '/en/discover/topic/:slug',
      name: 'discover-topic-en',
      component: () => import('../views/discover/TopicView.vue'),
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
      path: '/privacy',
      name: 'privacy',
      component: () => import('../views/PrivacyPolicy.vue'),
    },
    {
      path: '/en/privacy',
      name: 'privacy-en',
      component: () => import('../views/PrivacyPolicy.vue'),
    },
    {
      path: '/terms',
      name: 'terms',
      component: () => import('../views/TermsOfService.vue'),
    },
    {
      path: '/en/terms',
      name: 'terms-en',
      component: () => import('../views/TermsOfService.vue'),
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
