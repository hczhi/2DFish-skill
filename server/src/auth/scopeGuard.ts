import { Request, Response, NextFunction } from 'express';

// ============================================================================
// scope 短 token 的**全局**端点闸门。
//
// 这些 token 是拿公开的 pk 换来的（见 core/sdkKeys.ts），签的是绑定账号的身份。
// 闸门原来只挂在 tenderRouter 里面（`tenderSdkGuard`），于是一把 `tender:read`
// 短 token 在 /api/tender 之外**畅通无阻**：它能以绑定账号的身份调 /api/ai/chat、
// /api/xhs/*、/api/consult/*、/api/feishu-assistant/*（改别人的飞书应用绑定）——
// 每一处都返回 200，账单和数据都记在那个账号上，后台看不出这些请求来自一把
// 写在第三方页面 JS 里的 pk。
//
// 所以闸门收到这里、**默认拒绝**：新增一条 scope 必须在下面登记它能碰的端点，
// 忘了登记的结果是 403（吵闹地失败），而不是放行整个平台。
// ============================================================================

/** `"METHOD /path-regex"` 的白名单。method 必须写明 —— 只按路径放行的话，同一个 URL 上的写端点会跟着开。 */
interface ScopeRule {
  methods: string[];
  path: RegExp;
}

const SCOPE_RULES: Record<string, ScopeRule[]> = {
  // 标讯智能推荐 SDK（034）：只读三个端点。
  'tender:read': [
    { methods: ['GET'], path: /^\/api\/tender\/recommendations$/ },
    { methods: ['GET'], path: /^\/api\/tender\/detail\/[^/]+$/ },
    { methods: ['GET'], path: /^\/api\/tender\/list$/ },
  ],

  // 品牌咨询 iframe 嵌入（084）：整个工作台都要能用，所以这里是**写**权限。
  // 但只限 /api/consult 下的 stages / projects 两棵子树 —— 这样 /api/consult/admin/*
  // （SDK key 自己的管理接口）不会被它碰到。写成 `^/api/consult/` 就是把发 key 的
  // 后台接口一起开给了第三方页面里那把公开 pk。
  'consult:embed': [
    { methods: ['GET'], path: /^\/api\/consult\/stages$/ },
    {
      methods: ['GET', 'POST', 'PUT', 'DELETE'],
      path: /^\/api\/consult\/projects(\/|$)/,
    },
    // 「从文件提取文字」那两条不在 projects 子树下（新建页还没有项目 id，所以它们
    // 压根不带 id）。不登记的话嵌入版的新建页上传文件是一句 403，而工作台其余部分
    // 全是好的 —— 读起来像那个按钮坏了。/tidy-text 会调 AI，所以它同时登记在
    // `consult/sdkLimits.ts:AI_SPEND_ROUTES` 里按 pk 计额度（两处缺一处都不行：
    // 缺这里是 403，缺那里是这条路对第三方免费）。
    { methods: ['POST'], path: /^\/api\/consult\/extract-file$/ },
    { methods: ['POST'], path: /^\/api\/consult\/tidy-text$/ },
  ],

  // HTML 展示稿 iframe 嵌入（100）：整个工作台都要能用，所以 decks 那棵子树是**写**权限。
  // 逐条登记而不是放行 `^/api/ppt/`，被排除在外的三类是故意的：
  //   ① `/api/ppt/admin/*` —— 发 key 的后台接口（放进来 = 把发 key 的能力给了第三方页面里
  //      那把公开 pk，而每次调用都是 200）；
  //   ② `PUT /api/ppt/layouts/:id/enabled` —— 那是**账号级**开关，一个接入方停用一个版式，
  //      绑定账号自己和其他接入方从此都排不出这个版式，而两边界面上都只是「这个版式没了」；
  //   ③ `GET /api/ppt/library/assets` —— 那是 deck 外壳的共享 CSS/配色资料，前端一处都没在调，
  //      放进来只是多一个对外的面。
  // `/api/ppt/assets*` 是**故意放行**的（101 之后素材库按租户存）：素材在**一家公司内共用**，
  // 同一把 pk 下的员工看得到彼此生成的图。挡掉的话嵌入版的挑图抽屉是一片 403，而那意味着
  // 每次要同一张图都得重新生一次（真钱）。
  'ppt:embed': [
    { methods: ['GET'], path: /^\/api\/ppt\/(layouts|styles|design-options|edit-palette)$/ },
    { methods: ['GET'], path: /^\/api\/ppt\/layouts\/[^/]+$/ },
    {
      methods: ['GET', 'POST', 'PATCH', 'DELETE'],
      path: /^\/api\/ppt\/decks(\/|$)/,
    },
    { methods: ['GET', 'POST', 'DELETE'], path: /^\/api\/ppt\/assets(\/|$)/ },
  ],
};

export function scopeGuard(req: Request, res: Response, next: NextFunction): void {
  const scope = req.tokenScope;
  // 正常登录用户 / 模块 token / 匿名请求都不受影响。
  if (!scope) return next();

  const rules = SCOPE_RULES[scope] || [];
  const allowed = rules.some(
    (r) => r.methods.includes(req.method.toUpperCase()) && r.path.test(req.path)
  );
  if (allowed) return next();

  // 话术要说出「是这把 token 的权限范围」而不是一句 Forbidden：接入方拿到的
  // 是自己刚换来的 token，读成「token 无效」的话他只会一路重换。
  res.status(403).json({
    error: `This token is scoped to "${scope}" and cannot access ${req.method} ${req.path}`,
    scope,
  });
}
