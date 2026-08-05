// 把飞书 SDK 抛出的错误变成一句用户能照着办的话，外加一个可点的补权限链接。
//
// SDK 的做法是：把格式化好的错误详情打进 logger，然后 `throw e` 抛**原始的
// AxiosError**（见 node-sdk lib/index.js 的 `.catch((e) => { this.logger.error(formatErrors(e)); throw e; })`）。
// 于是 `e.message` 只有 "Request failed with status code 400" ——
// 真正有用的那段（缺哪个权限、去哪申请）在 `e.response.data` 里。
//
// 这个模块的失败会原文回帖给飞书里的用户，而他看不到服务端日志。
// 回一句 "Request failed with status code 400" 等于没回。

/** 飞书 OpenAPI 的错误响应体。字段全部按可能缺失处理——不同接口给的不一样全。 */
interface FeishuErrorBody {
  code?: number;
  msg?: string;
  log_id?: string;
  permission_violations?: Array<{ type?: string; subject?: string; scopes?: string[] }>;
}

/** 缺权限点。飞书所有接口共用这一个 code，是本模块最高频的失败原因。 */
const SCOPE_DENIED = 99991672;

/**
 * 通讯录的**数据权限范围**没配。这和 99991672 是两件不同的事，
 * 在飞书后台也是两个不同的地方：
 *
 * - 权限**点**（`contact:user.base:readonly` 等）在「权限管理 > API 权限」
 * - 权限**范围**（哪些部门/成员可读）在「权限管理 > 数据权限 > 通讯录范围」
 *
 * 只开权限点、不把任何部门加进范围时，contact 接口返回的就是这个 code，
 * 原文是 `no dept authority error` —— 用户照着它什么都做不了，
 * 尤其会以为是权限点没开（那里明明已经是绿的），所以必须单独翻译一遍。
 */
const NO_DEPT_AUTHORITY = 40004;

/**
 * 收件人不在应用的**可用范围**内（`Bot has NO availability to this user`）。
 *
 * 这是飞书的**第三套**独立设置，和前两个都不在一个页面：
 *
 * - 权限**点** → 权限管理 > API 权限（能调哪些接口）
 * - 数据权限 → 权限管理 > 数据权限（能读哪些部门的通讯录）
 * - **可用范围** → 应用发布 > 版本管理与发布 > 可用范围（**谁能用这个应用**）
 *
 * 名册同步成功（我们查得到这个人）和能给他发消息是两件事：可用范围默认只有
 * 创建者自己，所以「给同事发消息」在新绑的应用上必然撞这个错。
 * 而它的原文是英文，且没有任何一句提到「可用范围」—— 用户几乎不可能猜到。
 */
const NO_AVAILABILITY = 230013;

/** 按 code 覆写成能照着办的一句话。飞书原文太简（或是英文），照抄等于没说。 */
const KNOWN_CODES: Record<number, string> = {
  [NO_DEPT_AUTHORITY]:
    '飞书应用的「通讯录权限范围」是空的（code 40004）。\n' +
    '权限点已经开了不等于能读通讯录 —— 还要在飞书开发者后台的' +
    '【权限管理 > 数据权限 > 通讯录范围】里，把要让助理认识的部门（或整个公司）加进去。\n' +
    '⚠️ 改完同样要【创建并发布新版本】才生效。',

  [NO_AVAILABILITY]:
    '对方不在这个飞书应用的「可用范围」里（code 230013），所以机器人没法给他发消息。\n' +
    '这和权限点、通讯录权限是三件不同的事：去飞书开发者后台的' +
    '【应用发布 > 版本管理与发布】，把「可用范围」改成全体成员（或把这位同事所在的部门加进去），' +
    '然后【创建并发布新版本】。\n' +
    '新建的应用默认只有创建者本人可用，所以第一次给同事发消息一定会撞到这里。',
};

/**
 * 结构化的失败信息。存进 feishu_commands.error_detail，前端据此渲染
 * 「一键补权限」按钮 —— 让前端去正则解析 error 文本是不可维护的。
 */
export interface FeishuErrorDetail {
  /**
   * 前端据此选渲染方式。前三类是飞书**三套互不相干的设置**，各自在后台的不同页面：
   * - `scope_denied`（99991672）—— 缺权限点 → 权限管理 > API 权限
   * - `contact_scope_empty`（40004）—— 通讯录范围是空的 → 权限管理 > 数据权限
   * - `availability_denied`（230013）—— 对方不在可用范围里 → 应用发布 > 版本管理与发布
   * - `api_error` —— 其余，原文展示
   *
   * 必须分开：三者的报错都长得像「没权限」，但去错页面的人会看到一片绿勾/一切正常，
   * 然后开始怀疑我们的代码。
   */
  kind: 'scope_denied' | 'contact_scope_empty' | 'availability_denied' | 'api_error';
  /** 回帖 / 日志里展示的人话 */
  message: string;
  code?: number;
  log_id?: string;
  /** 缺的权限点。多项时是「任一即可」（飞书的 99991672 语义如此） */
  scopes?: string[];
  /** 飞书的一键申请链接。透传飞书给的，不自己拼 */
  apply_url?: string;
}

function bodyOf(e: unknown): FeishuErrorBody | undefined {
  if (!e || typeof e !== 'object') return undefined;
  const data = (e as { response?: { data?: unknown } }).response?.data;
  if (!data || typeof data !== 'object') return undefined;
  return data as FeishuErrorBody;
}

/**
 * 缺哪些权限。优先用结构化的 permission_violations；
 * 拿不到就从 msg 里把 `[task:task:write, task:task:writeonly]` 抠出来——
 * 不是所有接口都返回 permission_violations，但 msg 一直有。
 */
function missingScopes(body: FeishuErrorBody): string[] {
  const structured = (body.permission_violations ?? []).flatMap((v) => v.scopes ?? []);
  if (structured.length) return [...new Set(structured)];

  // 形如 [a:b:c, d:e] 的第一段。要求含冒号，避免误抓 msg 里其他方括号内容。
  const m = (body.msg ?? '').match(/\[([a-z0-9_.:]+(?:\s*,\s*[a-z0-9_.:]+)*)\]/i);
  if (!m || !m[1].includes(':')) return [];
  return m[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 飞书在 msg 里带的一键申请链接。直接透传，不自己拼——域名分飞书/Lark 两套。 */
function applyUrlFromMsg(body: FeishuErrorBody): string | undefined {
  return (body.msg ?? '').match(
    /https:\/\/open\.(?:feishu\.cn|larksuite\.com)\/app\/\S+?(?=[\s，。]|$)/
  )?.[0];
}

/**
 * 兜底拼一个申请链接。
 *
 * 飞书**不是每次**都在 msg 里给链接（不同接口、不同网关版本表现不一致），
 * 而"点一下就能去开权限"恰恰是这类失败唯一需要的操作。所以 msg 里没有时，
 * 用已知的 app_id + scopes 拼出等价的 auth 页地址。
 * 格式取自飞书自己返回的链接，只有 q 和 app_id 两个变量。
 */
function buildApplyUrl(appId: string | undefined, scopes: string[]): string | undefined {
  if (!appId || scopes.length === 0) return undefined;
  const q = encodeURIComponent(scopes.join(','));
  return `https://open.feishu.cn/app/${appId}/auth?q=${q}&op_from=openapi&token_type=tenant`;
}

/**
 * 把任意异常变成结构化的失败信息。
 *
 * 缺权限单独成一类：那是唯一「用户自己点两下就能解决」的失败，
 * 而且必须提醒他开通后要**发布版本**——权限不发版不生效是本模块的头号坑，
 * 只开权限不发版的表现和没开完全一样。
 *
 * @param appId 出错的飞书应用 app_id，用于在飞书没给链接时兜底拼一个。
 */
export function describeFeishuErrorDetail(e: unknown, appId?: string): FeishuErrorDetail {
  const fallback = e instanceof Error ? e.message : String(e);
  const body = bodyOf(e);
  if (!body) return { kind: 'api_error', message: fallback };

  if (body.code === SCOPE_DENIED) {
    const scopes = missingScopes(body);
    const applyUrl = applyUrlFromMsg(body) ?? buildApplyUrl(appId, scopes);
    const parts = ['飞书应用缺少权限。'];
    if (scopes.length === 1) parts.push(`需要开通：${scopes[0]}`);
    else if (scopes.length > 1) parts.push(`需要开通以下任一项：${scopes.join(' 或 ')}`);
    if (applyUrl) parts.push(`申请链接：${applyUrl}`);
    parts.push('⚠️ 开通后必须在飞书开发者后台【创建并发布新版本】才生效。');
    return {
      kind: 'scope_denied',
      message: parts.join('\n'),
      code: body.code,
      log_id: body.log_id,
      scopes,
      apply_url: applyUrl,
    };
  }

  // 通讯录范围为空。这里**不带 `q=scopes`**：那个参数是"勾选这几个权限点"的意思，
  // 而权限点用户已经开好了，带上它只会打开一个全是绿勾的页面然后让他卡住。
  // 只给权限管理页（数据权限和 API 权限都在这一页），具体去哪一栏由 message 说明。
  if (body.code === NO_DEPT_AUTHORITY) {
    return {
      kind: 'contact_scope_empty',
      message: KNOWN_CODES[NO_DEPT_AUTHORITY],
      code: body.code,
      log_id: body.log_id,
      apply_url: appId ? `https://open.feishu.cn/app/${appId}/auth` : undefined,
    };
  }

  // 可用范围里没有这个人。链接指向**发布**页而不是权限页 —— 可用范围在那儿改。
  if (body.code === NO_AVAILABILITY) {
    return {
      kind: 'availability_denied',
      message: KNOWN_CODES[NO_AVAILABILITY],
      code: body.code,
      log_id: body.log_id,
      apply_url: appId ? `https://open.feishu.cn/app/${appId}/publish` : undefined,
    };
  }

  const msg = body.msg?.trim();
  if (!msg) return { kind: 'api_error', message: fallback, code: body.code, log_id: body.log_id };

  // 其他错误带上 code 和 log_id：用户复制给管理员时，这两个能直接在飞书后台查到。
  const suffix = [body.code ? `code ${body.code}` : '', body.log_id ? `log_id ${body.log_id}` : '']
    .filter(Boolean)
    .join('，');
  return {
    kind: 'api_error',
    message: suffix ? `${msg}（${suffix}）` : msg,
    code: body.code,
    log_id: body.log_id,
  };
}

/** 只要那句人话。回帖用这个。 */
export function describeFeishuError(e: unknown, appId?: string): string {
  return describeFeishuErrorDetail(e, appId).message;
}

/**
 * 这个错误是不是"缺权限点"。
 */
export function isScopeDenied(e: unknown): boolean {
  return bodyOf(e)?.code === SCOPE_DENIED;
}

/**
 * 读通讯录这件事**注定做不到**吗？名册同步用它决定「该不该降级到群成员兜底」。
 *
 * 两个 code 都算，因为对用户的后果完全一样 —— 通讯录一个人也读不到：
 * - `99991672` 权限点没开
 * - `40004` 权限点开了，但通讯录数据权限范围是空的
 *
 * 只判 99991672 是不够的：40004 的企业里权限点全是绿的，同步却整个失败，
 * 用户看到「no dept authority error」完全无从下手，而其实降级到群成员就能用。
 *
 * 反过来，网络抖动、限流、飞书 5xx **不能**降级：那会掩盖真实原因，
 * 让用户拿着一份只覆盖几个群的名册以为同步成功了。所以判据精确到 code，不看文本。
 */
export function isContactUnavailable(e: unknown): boolean {
  const code = bodyOf(e)?.code;
  return code === SCOPE_DENIED || code === NO_DEPT_AUTHORITY;
}
