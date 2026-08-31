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
