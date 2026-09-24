import { createRouter, createWebHistory } from 'vue-router';
import { getToken, fetchMe } from '../lib/auth';
import { openLoginModal } from '../lib/loginModal';
import { isEmbedMode, embedModule, requestEmbedToken, embedHostOrigin } from '../lib/embed';
import { setActiveKeyApp, type KeyApp } from '../lib/appKey';

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
        { path: 'consult', name: 'admin-consult', component: () => import('../views/admin/ConsultManagement.vue') },
        // 咨询流程与方法论（088）：改十四步的「分析操法」和「本步必须产出的东西」。
        // 和上面那条 /admin/consult（对外接入 = 发 pk）是两页，别合并。
        { path: 'consult-flow', name: 'admin-consult-flow', component: () => import('../views/admin/ConsultFlow.vue') },
        // 展示稿对外接入（100）= 发 pk。和 /admin/consult 是两页，别合并：两个模块的 key
        // 混在一张表里，改错哪一行（停用/删除）看不出来。
        { path: 'ppt-access', name: 'admin-ppt-access', component: () => import('../views/admin/PptAccess.vue') },
        { path: 'app-keys', name: 'admin-app-keys', component: () => import('../views/admin/AppKeys.vue') },
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
    // HTML 展示稿。/ppt 是介绍页（「去使用」进 /ppt/decks 演示稿列表，一份稿子一行，落库）。
    {
      path: '/ppt',
      name: 'ppt-cover',
      component: () => import('../views/ppt/PptCover.vue'),
    },
    {
      // 第三方 iframe 的入口（100，写法同 /consult/embed）。**不能带 requiresAuth**
      // —— 它此刻正是来换凭证的，挂上守卫就会在别人的页面里弹出我们的登录框。
      path: '/ppt/embed',
      name: 'ppt-embed',
      component: () => import('../views/ppt/PptEmbed.vue'),
    },
    {
      // 没 key 时守卫和 401 都送到这里（112），它带着 ?key=1 回介绍页打开输入 key 的弹窗。
      // 名字和路径不能改：守卫按 `${keyApp}-key` 找它，api.ts 的 401 按 `/${app}/key` 拼地址。
      path: '/ppt/key',
      name: 'ppt-key',
      redirect: (to) => ({ path: '/ppt', query: { ...to.query, key: '1' } }),
    },
    {
      path: '/ppt/decks',
      name: 'ppt-decks',
      component: () => import('../views/ppt/PptDecks.vue'),
      meta: { requiresAuth: true, keyApp: 'ppt' },
    },
    {
      // new 必须写在 :id 之前 —— 反过来的话 /ppt/decks/new 会被当成一个 deck id，
      // 界面上是一句「这份演示稿不存在」，读起来像新建功能坏了。
      path: '/ppt/decks/new',
      name: 'ppt-deck-create',
      component: () => import('../views/ppt/PptDeckCreate.vue'),
      meta: { requiresAuth: true, keyApp: 'ppt' },
    },
    {
      // 「生成提纲」那个对话页。也必须写在 /ppt/decks/:id 之前（同 new 那条的理由）。
      path: '/ppt/decks/new/outline',
      name: 'ppt-outline-chat',
      component: () => import('../views/ppt/PptOutlineChat.vue'),
      meta: { requiresAuth: true, requiresAI: true, keyApp: 'ppt' },
    },
    {
      path: '/ppt/decks/:id',
      name: 'ppt-deck',
      component: () => import('../views/ppt/PptPlan.vue'),
      meta: { requiresAuth: true, requiresAI: true, keyApp: 'ppt' },
    },
    {
      // 素材库：每张生成过的配图（花过钱的）都在这儿，以后可以重用
      path: '/ppt/assets',
      name: 'ppt-assets',
      component: () => import('../views/ppt/PptAssets.vue'),
      meta: { requiresAuth: true, keyApp: 'ppt' },
    },
    {
      path: '/ppt/layouts',
      name: 'ppt-layouts',
      component: () => import('../views/ppt/PptLayouts.vue'),
      meta: { requiresAuth: true, keyApp: 'ppt' },
    },
    {
      // 老的 /ppt/plan 是**不落库**的那个工作台。留着它等于留一个「干半天关掉就全没了」
      // 的入口，而在那儿干活和在 deck 里干活界面上一模一样 —— 所以直接送去列表。
      path: '/ppt/plan',
      redirect: '/ppt/decks',
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
      // 第三方 iframe 的入口（084）。**不能带 requiresAuth** —— 它此刻正是来换凭证的，
      // 挂上守卫就会在别人的页面里弹出我们的登录框。
      path: '/consult/embed',
      name: 'consult-embed',
      component: () => import('../views/consult/ConsultEmbed.vue'),
    },
    {
      // 同 /ppt/key：回封面打开输入 key 的弹窗。
      path: '/consult/key',
      name: 'consult-key',
      redirect: (to) => ({ path: '/consult', query: { ...to.query, key: '1' } }),
    },
    {
      path: '/consult/projects',
      name: 'consult-home',
      component: () => import('../views/consult/ConsultHome.vue'),
      meta: { requiresAuth: true, keyApp: 'consult' },
    },
    {
      path: '/consult/projects/new',
      name: 'consult-create',
      component: () => import('../views/consult/ConsultCreate.vue'),
      meta: { requiresAuth: true, keyApp: 'consult' },
    },
    {
      // 补料问卷单独一页（新建项目后必过一轮）。放在工作台前面登记，
      // 但两者不冲突：段数不同，`/consult/projects/:id` 兜不住三段的路径。
      path: '/consult/projects/:id/intake',
      name: 'consult-intake',
      component: () => import('../views/consult/ConsultIntake.vue'),
      meta: { requiresAuth: true, keyApp: 'consult' },
    },
    {
      path: '/consult/projects/:id',
      name: 'consult-project',
      component: () => import('../views/consult/ConsultProject.vue'),
      meta: { requiresAuth: true, keyApp: 'consult' },
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
  setActiveKeyApp((to.meta.keyApp as KeyApp | undefined) ?? null);
  let token = getToken();

  // 嵌入模式（084）下刷新 iframe：内存里那把短 token 没了，而当前地址已经是
  // /consult/projects/xxx。不在这里补一次握手的话，下一行就会在第三方页面里弹出我们的
  // 登录框 —— 用户既没有我们的账号，也看不出是凭证掉了。
  if (!token && to.meta.requiresAuth && isEmbedMode()) {
    token = await requestEmbedToken();
    if (!token) {
      // 回哪个引导页要**按模块**算：写死 consult 的话展示稿那个 iframe 刷新之后跳进
      // 咨询的引导页，它再 replace 到 /consult/projects —— 第三方页面里的展示稿工作台
      // 变成了一个咨询工作台（每个接口 403），而没有一处报错。
      const name = embedModule() === 'ppt' ? 'ppt-embed' : 'consult-embed';
      return { name, query: { host: embedHostOrigin() || '', next: to.fullPath } };
    }
  }

  // 应用 key（112）：卖出去的页面没有登录框，没 key 就去输 key。
  if (to.meta.keyApp && !token) {
    return { name: `${to.meta.keyApp}-key`, query: { next: to.fullPath } };
  }

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
