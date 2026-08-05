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

/** 这几个类都不能 import：gateway/aiProviderService 在测试里被 mock 掉，按 name 判。 */
function nameOf(e: unknown): string {
  if (!e || typeof e !== 'object') return '';
  const named = e as { name?: unknown; constructor?: { name?: unknown } };
  if (typeof named.name === 'string' && named.name) return named.name;
  return typeof named.constructor?.name === 'string' ? named.constructor.name : '';
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

  return describeFeishuErrorDetail(e, appId);
}
