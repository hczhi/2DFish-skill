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

// 埋点保持裸 fetch：接口是 public 的，不需要带 token；
// 而且它是 fire-and-forget，绝不该因为一次上报失败弹登录框打断用户。
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
      component: () => import('../views/synap/SynapApp.vue'),
      children: [
        { path: '', name: 'synap', redirect: '/synap/chat' },
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
        { path: 'users/:id/dedicated-ai', name: 'admin-dedicated-ai', component: () => import('../views/admin/DedicatedAi.vue') },
        { path: 'quotas', name: 'admin-quotas', component: () => import('../views/admin/QuotaManagement.vue') },
        { path: 'usage', name: 'admin-usage', component: () => import('../views/admin/AIDashboard.vue') },
        { path: 'ai-logs', name: 'admin-ai-logs', component: () => import('../views/admin/AILogs.vue') },
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
        { path: 'feishu', name: 'admin-feishu', component: () => import('../views/admin/FeishuAssistantManagement.vue') },
        { path: 'skills', name: 'admin-skills', component: () => import('../views/admin/SkillRegistry.vue') },
        { path: 'skills/new', name: 'admin-skill-create', component: () => import('../views/admin/SkillEditor.vue') },
        { path: 'skills/:id/edit', name: 'admin-skill-edit', component: () => import('../views/admin/SkillEditor.vue') },
        { path: 'agent-skills', name: 'admin-agent-skills', component: () => import('../views/admin/AgentSkills.vue') },
        { path: 'agent-skills/:id', name: 'admin-agent-skill-edit', component: () => import('../views/admin/AgentSkillEditor.vue') },
      ],
    },
    {
      path: '/ui-review',
      name: 'ui-review',
      component: () => import('../views/uiReview/UiReviewPage.vue'),
    },
    {
      path: '/en/ui-review',
      name: 'ui-review-en',
      component: () => import('../views/uiReview/UiReviewPage.vue'),
    },
    {
      path: '/xhs',
      name: 'xhs-home',
      component: () => import('../views/xhs/XhsHome.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/xhs/studio',
      name: 'xhs-studio',
      component: () => import('../views/xhs/XhsStudio.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/xhs/writer',
      name: 'xhs-writer',
      component: () => import('../views/xhs/XhsWriter.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/xhs/skills',
      name: 'xhs-skills',
      component: () => import('../views/xhs/XhsSkills.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/xhs/calibration',
      name: 'xhs-calibration',
      component: () => import('../views/xhs/XhsCalibration.vue'),
      meta: { requiresAuth: true },
    },
    // xhs 是登录后写作台工具，无对外英文站点；/en/xhs* 统一重定向到中文路径
    {
      path: '/en/xhs/:pathMatch(.*)*',
      redirect: (to) => '/xhs' + (to.params.pathMatch ? '/' + (to.params.pathMatch as string[]).join('/') : ''),
    },
    // 品牌咨询：/consult 是封面（不要求登录，可以直接发出去），
    // 项目列表和工作台在 /consult/projects 下。列表段落写死成 projects
    // 而不是让 /consult/:id 兜住 —— 参数路由会把 /consult/projects 当成一个项目 id，
    // 打开是「项目不存在」而不是 404，读起来像项目丢了。不做 /en 版本。
    {
      path: '/consult',
      name: 'consult-cover',
      component: () => import('../views/consult/ConsultCover.vue'),
    },
    {
      path: '/consult/projects',
      name: 'consult-home',
      component: () => import('../views/consult/ConsultHome.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/consult/projects/:id',
      name: 'consult-project',
      component: () => import('../views/consult/ConsultProject.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/en/consult/:pathMatch(.*)*',
      redirect: (to) => '/consult' + (to.params.pathMatch ? '/' + (to.params.pathMatch as string[]).join('/') : ''),
    },
    {
      // 飞书助理是登录后的配置台，没有对外展示页，所以不做 /en 版本。
      path: '/feishu',
      name: 'feishu-home',
      component: () => import('../views/feishu/FeishuHome.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/en/feishu',
      redirect: '/feishu',
    },
    {
      path: '/tender',
      name: 'tender',
      component: () => import('../views/tender/TenderHome.vue'),
    },
    {
      path: '/en/tender',
      name: 'tender-en',
      component: () => import('../views/tender/TenderHome.vue'),
    },
    {
      path: '/tender/browse',
      name: 'tender-browse',
      component: () => import('../views/tender/TenderBrowse.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/en/tender/browse',
      name: 'tender-browse-en',
      component: () => import('../views/tender/TenderBrowse.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/tender/settings',
      name: 'tender-settings',
      component: () => import('../views/tender/TenderSettings.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/en/tender/settings',
      name: 'tender-settings-en',
      component: () => import('../views/tender/TenderSettings.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/tender/sdk-docs',
      name: 'tender-sdk-docs',
      component: () => import('../views/tender/TenderSdkDocs.vue'),
    },
    {
      path: '/en/tender/sdk-docs',
      name: 'tender-sdk-docs-en',
      component: () => import('../views/tender/TenderSdkDocs.vue'),
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
      path: '/about',
      name: 'about',
      component: () => import('../views/About.vue'),
    },
    {
      path: '/en/about',
      name: 'about-en',
      component: () => import('../views/About.vue'),
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
  // GA4：SPA 路由切换不会整页刷新，需手动补发 page_view（gtag 库在 index.html 里加载）。
  // 与自建埋点一致，后台 /admin 不计入统计。
  const gtag = (window as any).gtag;
  if (typeof gtag === 'function' && !to.path.startsWith('/admin')) {
    gtag('event', 'page_view', {
      page_path: to.fullPath,
      page_title: document.title,
      page_location: window.location.href,
    });
  }
});

export default router;
