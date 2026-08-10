import { describeFeishuErrorDetail, type FeishuErrorDetail } from './feishuError.js';

// 指令失败原因的收口。`feishuError.ts` 只管翻译**飞书**的错误，
// 而这条执行路径上还会撞到三类**平台自己的**错误，它们的默认文案都是
// 写给「网页里的操作者」看的，而这里的读者是飞书群里的另一个人。
//
// 这个区别不是措辞洁癖 —— 这三类错误的默认文案会把用户导向一个他做不到的动作：
//
//   1. 额度用完（QuotaExceededError）
//      原文：「请联系管理员提升额度」+ 一整句英文重复。
//      问题：飞书里说话的人**通常没有平台账号**，额度是绑应用那个账号的。
//      他既看不到额度页面，也不知道"管理员"指谁。而且这条不是故障，
//      混在「❌ 执行失败」里会让人以为助理坏了，跑去检查权限和连接。
//
//   2. 专属渠道缺档（DedicatedChannelError）
//      原文：「请在后台『用户管理 → 专属 AI 渠道』补齐 default/strong/fast 三档」。
//      问题：那是**管理员**的操作台，群里的人打不开。照抄过去等于让他去点一个
//      不存在的按钮，而真正该做的事是去找绑这个应用的人。
//
//   2b. 现在太忙（TooBusyError，见 concurrency.ts）
//      这条的文案本来就是为飞书写的，原样透传；它和额度用完一样**不是故障**。
//
//   3. 模型超时（APIConnectionTimeoutError 等）
//      原文：`Request timed out.`（英文，且不说是谁超时了）。
//      问题：用户会以为是飞书或网络的问题，而这是上游模型服务的问题，
//      正确的处置就是原样再说一遍。
//
//   4. AI 中转站/模型服务返回 HTTP 错误（OpenAI SDK 的 APIError 家族）
//      原文是**响应体原文**，而中转站前面挂着 nginx 时那就是一整页 HTML：
//      `502 <html><head><title>502 Bad Gateway</title>…<center>nginx</center>…`
//      —— 这一整坨会原样贴进飞书群。它同时踩了三个坑：群里的人根本不知道
//      「AI 中转站」这个东西存在（他会去查飞书权限和机器人是不是掉线了）、
//      看不出这不是他的指令写错了、也看不出到底有没有执行。所以按 status 翻译，
//      **响应体一个字都不带进回帖**（它对群里的人没有任何信息量）。
//
// 判据一律用 **`e.name` / 构造函数名**，不匹配文案：文案随时会改，
// 而 name 是这几个类的稳定标识。反过来，**普通 Error 一律原样透传** ——
// 动作层抛的错（「缺少参数 text」「通讯录里没找到张三」）本来就是写给用户看的人话，
// 在这里加工只会把它们变模糊。
//
// kind 全部落 `api_error`：前端那三张卡片对应的是飞书后台的三个页面，
// 而这几类错误在飞书后台里没有任何东西可点。

/**
 * 失败原因 + 一个「这不是故障」的标记。
 *
 * `advisory` 为真时，dispatcher **不加「❌ 执行失败：」前缀**。额度用完、
 * 现在太忙这两类是助理的正常状态（甚至自带 ⏳ 表情），套上一个红叉会让用户
 * 以为助理坏了，然后跑去检查连接和权限 —— 而他要做的只是等一等或者找人加额度。
 *
 * 只可能出现在「一步都还没执行」的路径上：这几类错误全都发生在意图解析阶段。
 */
export interface CommandErrorDetail extends FeishuErrorDetail {
  advisory?: boolean;
}

/** 额度用完不是故障，用 ⏳ 而不是 ❌ —— 见文件头第 1 条。 */
const QUOTA_MESSAGE =
  '⏳ 今天的 AI 额度用完了，助理暂时没法理解新指令（明天 0 点自动恢复）。\n' +
  '要现在就恢复的话，请找当初在平台上绑定这个飞书应用的同事，让他提升额度或改用自己的 AI 渠道。';

const DEDICATED_MESSAGE =
  '助理的专属 AI 渠道没配全，暂时没法理解指令。\n' +
  '这需要平台管理员去后台把专属渠道的三档模型补齐（或关掉专属渠道开关），' +
  '请把这句话转给他 —— 在飞书里改不了。';

const TIMEOUT_MESSAGE =
  '理解这条指令时 AI 服务超时了，本次没有执行任何操作。\n' +
  '请再说一遍。如果一直超时，请让管理员看一下平台的 AI 渠道是否正常。';

/**
 * 连不上上游（DNS 解析不了、连接被拒、TLS 失败）。
 *
 * 和 502 分开说：502 是"服务在但这一刻不行"（等一等有用），
 * 这个是"根本没连上"（多半是渠道地址写错了或那台机器没了，等也没用）。
 */
const CONNECTION_MESSAGE =
  '连不上 AI 服务，助理没法理解指令，本次没有执行任何操作。\n' +
  '这通常不是等一等能好的 —— 请让管理员检查平台配置的 AI 渠道地址是否还有效。';

/**
 * 这几个类都不能 import：gateway/aiProviderService 在测试里被 mock 掉，按 name 判。
 *
 * 两个来源都要看，而且**构造函数名优先**：平台自己那三个类在构造器里写了
 * `this.name = 'QuotaExceededError'`，两者一致；而 OpenAI SDK 的错误类
 * **一个都没设 `this.name`**，于是 `e.name` 继承自 Error 就是字面的 `'Error'`——
 * 只看 `e.name` 的话 `APIConnectionTimeoutError` 永远匹配不上，超时会当成
 * 未知错误把英文原文（甚至一页 HTML）贴进飞书群。
 */
function nameOf(e: unknown): string {
  if (!e || typeof e !== 'object') return '';
  const named = e as { name?: unknown; constructor?: { name?: unknown } };
  const ctor = typeof named.constructor?.name === 'string' ? named.constructor.name : '';
  if (ctor && ctor !== 'Error' && ctor !== 'Object') return ctor;
  return typeof named.name === 'string' ? named.name : '';
}

/**
 * 上游 AI 服务返回的 HTTP 状态码。
 *
 * 只认 `number`：SDK 的 `APIConnectionError` 家族把 status 留成 undefined，
 * 而它的子类构造器签名是 `({message, cause})`，实际会把那个对象塞进 status 位
 * （见 openai/error.js）—— 所以拿到非数字时必须当"没有状态码"，
 * 否则会走进按状态码翻译的分支，说出一个编造的原因。
 */
function statusOf(e: unknown): number | undefined {
  const s = (e as { status?: unknown } | null)?.status;
  return typeof s === 'number' ? s : undefined;
}

/**
 * 是 axios 抛的吗（飞书 SDK 用的就是 axios）。
 *
 * `isAxiosError` 是 axios 自己打上的稳定标记。要区分开是因为 AxiosError 也带
 * `status`，而它该走 `describeFeishuErrorDetail` —— 那边认飞书的 code、
 * 拼得出补权限链接，走到这里只会退化成一句「HTTP 400」。
 */
function isAxios(e: unknown): boolean {
  return (e as { isAxiosError?: unknown } | null)?.isAxiosError === true;
}

/**
 * 按 HTTP 状态码说人话。
 *
 * 每一条都要回答群里那个人的两个问题：**这是谁的问题**、**要不要重发**。
 * 「本次没有执行任何操作」必须说 —— 意图解析是第一步，这几类错误全都发生在
 * 任何动作跑起来之前，不说的话用户不敢重发（怕建出两个项目）。
 */
function upstreamMessage(status: number): string {
  const suffix = '\n本次没有执行任何操作，可以过一会儿原话再说一遍。';
  // 502/503/504 = 中转站或模型服务这一刻不可用（我们这侧没做错任何事）。
  // nginx 的 502 页面是这一类里最常见的，也是唯一会以整页 HTML 形式出现的。
  if (status === 502 || status === 503 || status === 504) {
    return `AI 服务暂时不可用（HTTP ${status}），助理没法理解指令。${suffix}\n一直这样的话，请让管理员检查平台配置的 AI 渠道地址是否还能访问。`;
  }
  if (status === 429) {
    return `AI 服务限流了（HTTP 429），助理这会儿排不上队。${suffix}`;
  }
  if (status === 401 || status === 403) {
    // 这条**不能**说「过一会儿再试」：密钥不会自己变好，重发一百遍都是同样的结果。
    return `AI 服务拒绝了请求（HTTP ${status}），一般是 API 密钥失效或没有额度了。\n本次没有执行任何操作。这需要平台管理员去后台更新 AI 渠道的密钥 —— 在飞书里改不了，请把这句话转给他。`;
  }
  if (status === 404) {
    return `AI 渠道的地址或模型名不对（HTTP 404），助理没法理解指令。\n本次没有执行任何操作。这需要平台管理员去后台核对 AI 渠道的接口地址和模型名。`;
  }
  if (status >= 500) {
    return `AI 服务出错了（HTTP ${status}）。${suffix}`;
  }
  return `调用 AI 服务失败（HTTP ${status}），助理没法理解指令。\n本次没有执行任何操作。如果一直这样，请让管理员检查平台的 AI 渠道配置。`;
}

/**
 * 一条指令为什么失败，翻成飞书里的人能照着办的一句话。
 *
 * 先认平台自己的几类错误（见文件头），其余全部交给 `describeFeishuErrorDetail`——
 * 它认飞书的 code，认不出来就原样透传 `e.message`。
 */
export function describeCommandError(e: unknown, appId?: string): CommandErrorDetail {
  const name = nameOf(e);

  if (name === 'QuotaExceededError') {
    return { kind: 'api_error', message: QUOTA_MESSAGE, advisory: true };
  }
  if (name === 'TooBusyError') {
    // 并发闸拒绝的（concurrency.ts）。它的 message 本来就是写给飞书用户的，
    // 原样用；只是别套红叉——这是"稍后再说一遍"，不是坏了。
    return { kind: 'api_error', message: (e as Error).message, advisory: true };
  }
  if (name === 'DedicatedChannelError') {
    return { kind: 'api_error', message: DEDICATED_MESSAGE };
  }
  // SDK 的超时类：APIConnectionTimeoutError（含重试耗尽），以及被 abort 的那种。
  if (name === 'APIConnectionTimeoutError' || name === 'APIUserAbortError') {
    return { kind: 'api_error', message: TIMEOUT_MESSAGE };
  }
  // 连不上（DNS 挂了、连接被拒、TLS 失败）。没有状态码，所以要在按码翻译之前拦下。
  if (name === 'APIConnectionError') {
    return { kind: 'api_error', message: CONNECTION_MESSAGE };
  }

  // 上游 AI 服务返回了 HTTP 错误。按状态码翻译，**丢掉响应体** ——
  // 中转站前面挂 nginx 时它是一整页 HTML，贴进飞书群只会让人以为助理彻底坏了。
  //
  // 判据是「有数字 status，且不是 axios 抛的」而不是列一串类名：
  // OpenAI SDK 的子类名字没有共同前缀（BadRequestError / RateLimitError /
  // InternalServerError 里都没有 API），白名单迟早漏掉新增的那个，
  // 而漏掉的表现就是这次的 bug —— 原文直接进群。
  // 排除 axios 是因为飞书 SDK 抛的就是 AxiosError，它也带 status，
  // 但那类错误该走下面的飞书翻译（认 code、给补权限链接）。
  const status = statusOf(e);
  if (status !== undefined && !isAxios(e)) {
    return { kind: 'api_error', message: upstreamMessage(status), code: status };
  }

  return describeFeishuErrorDetail(e, appId);
}
