import type { Client } from '@larksuiteoapi/node-sdk';

// 动作注册表的类型。加一个飞书小功能 = 在 actions/ 下加一个文件并在 index.ts 注册，
// 调度/意图解析/日志三处都不用改。
//
// 参数 schema 是给 LLM 看的（拼进 prompt 让它选动作并填参），不是运行时校验器；
// 运行时校验各动作在 run() 里自己做——LLM 会漏字段，动作必须自己兜住。

/** 一条被 @ 的消息在动作侧需要知道的全部上下文。 */
export interface ActionContext {
  /** 已建好的 SDK client（tenant_access_token 由 SDK 自己管） */
  client: Client;
  /**
   * 飞书应用的 app_id。动作里自己 catch 掉的错误需要它来拼补权限链接
   * （dispatcher 的失败收口有自己的来源，见 feishuError.ts）。
   */
  appId: string;
  /** 发言人的 open_id。任务负责人/日程参与人默认就是他。 */
  senderOpenId: string;
  senderName: string;
  chatId: string;
  chatType: 'p2p' | 'group';
  /** 触发本次执行的消息 id。用作幂等键（飞书会重复推送）。 */
  messageId: string;
  /**
   * 本次执行是这条指令里的第几步（一句话包含两件事时会有多步，见 dispatcher）。
   * 缺省视为 0。
   *
   * **幂等键必须带上它**：一条指令里出现两次 create_task 时，两个任务共用
   * `client_token` 会让第二个被飞书静默判成重复 —— 接口返回成功，
   * 我们回帖「已创建」，实际只有一个任务。
   */
  stepIndex?: number;
  /**
   * 消息里被 @ 到的其他人（已排除机器人自己）。
   * 「给 @张三 创建任务」这类指令的 open_id 直接来自这里 ——
   * 事件自带 open_id + name，不需要任何通讯录权限，也不需要按名字查人。
   */
  mentions: Array<{ openId: string; name: string }>;
  /**
   * 助理**自己**的 open_id（LarkChannel 建连时拿到的 botIdentity）。
   *
   * 只有「总结群聊」用得上：它要读整个群的历史消息，而其中助理自己的回帖
   * 必须滤掉 —— 不滤的话摘要会开始总结助理说过的话（「助理确认任务已创建」），
   * 那是我们自己制造的信息，不是群里发生的事，却会以「今天的进展」的身份
   * 落进日志表。同理，@ 到助理的那些消息是**指令**（已在指令日志里）。
   *
   * 可能为空：SDK 那侧 botIdentity 还没拿到时就是 undefined。空的时候
   * chatHistory 只能靠 `sender_type === 'app'` 滤机器人（够用），
   * 但认不出「@ 了助理的指令消息」—— 那些会被当成普通群聊读进来。
   * 结果是摘要里多几条复述指令的内容，不好但不致命，所以不因此拒绝执行。
   */
  botOpenId?: string;
}

/** 动作执行结果。summary 会回帖给用户，也存进 feishu_commands.result。 */
export interface ActionResult {
  /** 回给用户的一句话。支持 markdown（用 send 的 markdown 通道发出）。 */
  summary: string;
  /** 结构化产物，存日志用（任务 guid、日程 id 等） */
  data?: Record<string, unknown>;
}

export interface ActionDef {
  /** LLM 输出的动作名，也是日志里的 action 值 */
  name: string;
  /** 给 LLM 的说明：什么时候该选这个动作 */
  description: string;
  /** 给 LLM 的参数说明。键是参数名，值是「类型 + 含义 + 是否必填」的自然语言描述。 */
  params: Record<string, string>;
  /** 几个例句，显著提升小模型的选择准确率 */
  examples: string[];
  /**
   * 给**用户**看的一句能力说明（不进 prompt），如「记一条项目日志」。
   *
   * **必填字段，故意的。** 听不懂指令时的兜底话术要列出「我目前会什么」
   * （dispatcher 的 fallbackReply），那段话以前是手写的 ——
   * 于是动作删了它还在推销日程和私聊发消息，用户照着说一句，
   * 换回来的是同一句「没太听懂」。写成必填的话，新增动作时编译器就会提醒；
   * 少一个动作时那一行也跟着消失，不需要有人记得去改。
   *
   * `undefined` 表示这个动作**不对用户构成一项能力**（目前只有 reply）。
   * 要显式写出来，不能靠"忘了填"—— 后者和"该填没填"没法区分。
   */
  hint: string | undefined;
  /**
   * 这个动作需要的飞书权限点。只用于后台展示「绑定这个应用前请先开通这些权限」——
   * 权限没开时飞书返回的 code 往往很难对应到具体缺哪一项。
   */
  scopes: string[];
  run(params: Record<string, unknown>, ctx: ActionContext): Promise<ActionResult>;
}

/** 参数取字符串，缺失/空白返回 undefined。LLM 常把可选参数填成空串。 */
export function str(params: Record<string, unknown>, key: string): string | undefined {
  const v = params[key];
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t ? t : undefined;
}

/** 必填字符串参数，缺了就抛——错误会回帖给用户，让他知道要补什么。 */
export function requireStr(params: Record<string, unknown>, key: string, label: string): string {
  const v = str(params, key);
  if (!v) throw new Error(`缺少${label}，请在指令里说清楚。`);
  return v;
}

/**
 * 取布尔参数。缺失返回 undefined（区别于"明确说了 false"）。
 *
 * 也认字符串："true"/"是"/"要"/"1"。prompt 里写的是布尔，但模型经常给
 * `"true"` 甚至 `"是"` —— 在这里兜掉比让每个动作各判一次可靠。
 * 认不出来的值当作没说，而不是当作 true：这些开关（开视频会议、设重复）
 * 全都是"多做了一件用户没要求的事"这一侧更难收拾。
 */
export function bool(params: Record<string, unknown>, key: string): boolean | undefined {
  const v = params[key];
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const t = v.trim().toLowerCase();
    if (['true', 'yes', '1', '是', '要', '需要', '开'].includes(t)) return true;
    if (['false', 'no', '0', '否', '不要', '不用', '不'].includes(t)) return false;
  }
  return undefined;
}

/**
 * 取正整数参数（提前几分钟提醒之类）。缺失/非法返回 undefined。
 *
 * 非法值**当作没说**而不是抛错：这类参数都是可选的锦上添花，
 * 为一个填歪的提醒时间让整条「建日程」失败是不划算的（日程本身才是用户要的）。
 */
export function posInt(params: Record<string, unknown>, key: string): number | undefined {
  const v = params[key];
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.trim()) : NaN;
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.floor(n);
}

/**
 * 取字符串数组，缺失返回空数组。
 *
 * 也接受单个字符串和逗号分隔的字符串：prompt 里写了要数组，但只有一个人时
 * 模型经常直接给 `"张三"`，两个人时又可能给 `"张三,李四"`。
 * 在这里兜掉比在每个动作里各判一次可靠。
 */
export function strList(params: Record<string, unknown>, key: string): string[] {
  const v = params[key];
  const raw = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,，、]/) : [];
  return raw
    .map((x) => (typeof x === 'string' ? x.trim() : ''))
    .filter(Boolean);
}
