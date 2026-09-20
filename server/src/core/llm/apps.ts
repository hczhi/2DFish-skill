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
  { id: 'consult', name: '品牌咨询工作台' },
  { id: 'relay', name: '对外中转接口' },
  { id: 'ppt', name: 'HTML 展示稿' },
];

/**
 * 解析通道：**不是应用，也不是 source**。
 *
 * 它只回答一个问题：「这一类操作用哪条接入点」。某个模块里有一两步和别的步骤想用
 * 不同的模型（提取图片文字 / 整理文件，便宜快的小模型就够，而模块其余部分要强模型），
 * 而「应用」这一维粒度太粗 —— 给 consult 配一条就把对话、出草稿全都换掉了。
 *
 * 所以通道只参与 {@link GatewayOptions.channel} 的接入点解析，
 * **配额和 `ai_logs.source` 一律还记在真正的 source 上**（提取是 consult 的一步，
 * 花的是 consult 的额度）。也因此它**不能**进 AI_APPS：
 *   - 没有任何调用点写 `source: 'extract'`，进白名单会让 aiAppRegistry 那条反向断言变红；
 *   - 更要紧的是后台「按应用额度」会多出一个 extract 选项，配上去永远不触发 ——
 *     界面上显示「已限 10 次/天」，而实际一次都不计（api/admin.ts 因此仍用
 *     isValidAppScope 校验额度，只有 provider 的 scope_app 用下面那个宽的）。
 */
export const AI_CHANNELS: AIAppDef[] = [
  { id: 'extract', name: '文件/图片内容提取（解析通道）' },
];

/** 提取通道的 id。调用点引这个常量而不是手写字面量：拼错的表现是「配了但永远不生效」。 */
export const EXTRACT_CHANNEL = 'extract';

/**
 * 「上传资料 → 提取 → AI 整理」那条路被哪几个应用共用（`api/extractRoutes.ts`）。
 *
 * 这条路的 `source` 是**参数**而不是字面量 —— 全库唯一一处，`aiAppRegistry.test.ts` 那条
 * 「source 必须是字面量」的规则为它开了一个口子，而开口的**前提就是这个数组里每一项都在
 * `AI_APPS` 里**（同一个文件里有测试断言这件事）。往这里加模块时那条断言会跟着检查它 ——
 * 加一个不在 AI_APPS 里的值的话，按应用配 token/额度对它会静默失效。
 */
export const EXTRACT_APPS = ['consult', 'ppt'] as const;
export type ExtractApp = (typeof EXTRACT_APPS)[number];

/** 后台 provider 的「应用」下拉 = 真应用 + 解析通道。 */
export const PROVIDER_SCOPES: AIAppDef[] = [...AI_APPS, ...AI_CHANNELS];

const APP_IDS = new Set(AI_APPS.map((a) => a.id));
const SCOPE_IDS = new Set(PROVIDER_SCOPES.map((a) => a.id));

/**
 * 真应用（= 某个 `source`）。**按应用配额度只认这个** —— 放通道进来的话，
 * 管理员能给 extract 配一个永远不触发的上限。'' 表示「不限应用」，也是合法值。
 */
export function isValidAppScope(app: string | null | undefined): boolean {
  if (!app) return true;
  return APP_IDS.has(app);
}

/** provider 的 scope_app 可以指到通道上（那正是通道存在的意义）。 */
export function isValidProviderScope(app: string | null | undefined): boolean {
  if (!app) return true;
  return SCOPE_IDS.has(app);
}

export function appName(app: string): string {
  return PROVIDER_SCOPES.find((a) => a.id === app)?.name || app;
}
