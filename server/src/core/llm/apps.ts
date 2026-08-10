// 「应用」维度的唯一事实来源。
//
// 这里的 id **必须**和 gateway 调用点里 `source: 'xxx'` 的字面量逐字相同 ——
// 按应用配 token / 配额全靠字符串相等匹配，写错一个字符的表现是
// 「后台配了、界面显示正常、运行时永远不生效」，没有任何报错。
//
// 所以：
//   1. 后台下拉框只从 AI_APPS 生成，管理员没有手写的机会；
//   2. api/admin.ts 保存 provider / 配额时校验 scope_app 在白名单里，否则 400；
//   3. src/test/aiAppRegistry.test.ts 扫全仓库的 `source: '...'` 字面量，
//      有 source 没进白名单就红 —— 新加模块时会被强制想起这件事。
//
// 加新模块的动作：在这里加一行，测试就会放行。不要跳过第 3 条去改测试。
export interface AIAppDef {
  /** 等于 GatewayOptions.source */
  id: string;
  /** 后台下拉里显示的名字 */
  name: string;
}

export const AI_APPS: AIAppDef[] = [
  { id: 'xhs', name: '小红书写作台' },
  { id: 'tender', name: '标讯智能推荐' },
  { id: 'feishu', name: '飞书助理' },
  { id: 'ui-review', name: 'UI 评测' },
  { id: 'discover', name: '文章分析' },
  { id: 'chat', name: '对话' },
  { id: 'consultant', name: 'AI 顾问' },
  { id: 'fish', name: '摸鱼缸' },
  { id: 'board', name: '智慧看板' },
];

const APP_IDS = new Set(AI_APPS.map((a) => a.id));

/** '' 表示「不限应用」，也是合法值（通用配置）。 */
export function isValidAppScope(app: string | null | undefined): boolean {
  if (!app) return true;
  return APP_IDS.has(app);
}

export function appName(app: string): string {
  return AI_APPS.find((a) => a.id === app)?.name || app;
}
