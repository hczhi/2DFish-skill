import type { Client } from '@larksuiteoapi/node-sdk';
import { capabilityHints, getAction } from './actions/index.js';
import type { ActionContext } from './actions/index.js';
import { parseIntent, MAX_STEPS } from './intent.js';
import { describeCommandError } from './commandError.js';
import { withIntentSlot } from './concurrency.js';
import { countUsers } from './directory/store.js';
import { recordRejected } from './chatStore.js';
import { buildDiaryContext, type DiaryContext } from './diary/context.js';
import {
  claimEvent,
  findPriorClarification,
  finishCommand,
  setCommandIntent,
  startCommand,
} from './commandLog.js';
import { parseAllowedChats, type FeishuApp } from './appStore.js';

// 事件调度。
//
// ── 3 秒限制怎么绕 ──
// 飞书要求 3 秒内处理完事件，超时/抛异常都算失败并触发重推（15s/5min/1hr/6hr）。
// 而意图解析要调 LLM，必然超过 3 秒。所以 handleMessage 的策略是：
// 同步部分只做「去重 + 落一条 pending 日志」，然后**不 await** 地把重活丢出去，
// 立刻返回。飞书那边看到的是瞬时成功；干完活再用回帖告知用户。
// 这也是为什么 execute 内部必须自己 catch 到底 —— 它是个游离的 promise，
// 抛出去只会变成 unhandledRejection。

/**
 * 私聊里唯一的回复：请到群里说。
 *
 * 助理**只在群聊里工作**（见 handleMessage 里那道闸的注释）。这条话术要回答
 * 用户当下的两个问题：为什么没办、接下来该怎么做。少了它，私聊就变成
 * 「@ 了没反应」—— 而那和"助理坏了"完全同形。
 */
const P2P_ONLY_GROUP_REPLY =
  '我只在**群聊**里工作，私聊不处理指令。\n' +
  '请把我拉进项目群，在群里 @ 我说话 —— 项目日志和任务都是跟群绑定的。\n' +
  '（这样每条指令都留在群里，同事能看到谁让我做了什么。）';

/**
 * 用户可见的兜底话术。解析不出来时也必须回一句，否则表现成「@ 了没反应」。
 *
 * 能力清单**从注册表生成**（capabilityHints）。以前这里是一段手写的散文，
 * 于是删掉日程和私聊发消息之后它还在推销那些功能 —— 用户照着说一句，
 * 换回来的还是这句「没太听懂」，而清单就印在同一条消息里。
 * 剩下这几句限制是手写的，因为它们不属于任何单个动作。
 */
function fallbackReply(): string {
  return [
    '没太听懂这条指令。我目前会：',
    ...capabilityHints().map((h) => `· ${h}`),
    '',
    '注意「项目」和「任务」是两件事：项目是一个群一张长期的日志表，任务是一条待办。',
    '改任务只对**我帮你建过的**那些有效，你自己在飞书里建的我看不到；' +
      '日志和任务都要先在本群建过项目才能记。',
  ].join('\n');
}

export interface InboundMessage {
  messageId: string;
  chatId: string;
  chatType: 'p2p' | 'group';
  senderOpenId: string;
  senderName: string;
  /** 已剥掉 @ 占位符的正文 */
  text: string;
  /** 已排除机器人自己的 @ 列表 */
  mentions: Array<{ openId: string; name: string }>;
  /**
   * 助理自己的 open_id。只有「总结群聊」用得上（要把助理自己的回帖和
   * @ 助理的指令消息从群聊记录里滤掉），透传到 ActionContext.botOpenId。
   * 可能为空 —— 见那边的注释，空的时候只是摘要里多几条复述指令的内容。
   */
  botOpenId?: string;
}

/** 回帖通道。由 connection.ts 注入 LarkChannel 的 send，测试里可注入假的。 */
export type Replier = (chatId: string, markdown: string, replyTo: string) => Promise<void>;

/**
 * 「收到了，在办」的即时反馈。由 connection.ts 注入 LarkChannel 的 addReaction。
 *
 * 存在的理由是**回帖必然来得很晚**：意图解析要调 LLM，忙时还要排队，
 * 一句「已建好日程」经常是十几秒后才出现。在这十几秒里用户看到的是
 * 「@ 了没反应」——和真的坏掉了完全同形，于是他会再 @ 一遍
 * （被去重挡掉，更像没反应），或者干脆自己去手动建了那个日程。
 *
 * 用表情回应而不是先发一条「正在处理…」：那会在群里留下一条永久的噪音消息，
 * 而助理办完还要再发一条，一次指令占三条消息。表情是贴在**用户自己那条消息**上的，
 * 办完了也不用清理。
 */
export type Acker = (messageId: string) => Promise<void>;

export interface DispatchDeps {
  app: FeishuApp;
  client: Client;
  reply: Replier;
  /** 可选：没注入时只是少了那个 👀，不影响任何执行路径。 */
  ack?: Acker;
  nowMs?: number;
}

/**
 * 处理一条被 @ 的消息。同步返回（不等 LLM），重活在后台跑。
 * 返回值只用于测试和日志：'accepted' | 'duplicate' | 'not_allowed'
 */
export function handleMessage(
  msg: InboundMessage,
  deps: DispatchDeps
): 'accepted' | 'duplicate' | 'not_allowed' | 'p2p_rejected' {
  const { app } = deps;
  const nowIso = new Date(deps.nowMs ?? Date.now()).toISOString();

  // 助理**只在群聊里工作**。
  //
  // 这不只是产品口味，它同时补掉一个洞：上面那道白名单闸只管群聊，私聊从来
  // 没有任何闸 —— 同一租户里的任何人私聊机器人就能烧掉绑定账号的 AI 额度，
  // 而且私聊不在 feishu_chats 里，用户连"谁在用"都看不到。
  //
  // 也补掉一类"看起来坏了"的体验：私聊里建不了项目（项目的身份就是那个群）、
  // 记日志/复盘必须手打项目名、`@` 不到人只能靠名册 —— 私聊能做的事本来就是
  // 群聊的真子集，而失败方式却更多。
  //
  // **必须回一句**，不能静默丢（本模块的第一条原则）：私聊里没反应和
  // 「助理坏了」完全同形，用户会去查连接和权限。
  //
  // 顺序上先 claimEvent 再回帖：飞书成功也重推（至多 5 次），少了这道去重
  // 用户会连收五条一样的「我只在群聊里工作」。刻意不写 feishu_commands ——
  // 同 not_allowed 那条路：这条消息没被受理，没花额度、没执行任何东西。
  if (msg.chatType !== 'group') {
    if (!claimEvent(msg.messageId, app.app_id, nowIso)) return 'duplicate';
    void deps.reply(msg.chatId, P2P_ONLY_GROUP_REPLY, msg.messageId).catch((e) => {
      console.error('[feishu] 私聊拒绝回帖失败:', e instanceof Error ? e.message : e);
    });
    return 'p2p_rejected';
  }

  // 群白名单。自建应用被拉进任何群都会收到 @ ——
  // 没有这道闸，任何人把机器人拉进自己的群就能消耗这个账号的 AI 额度。
  // （不再需要判 chatType：私聊已经在上面被挡掉了，走到这里一定是群聊。）
  if (!isChatAllowed(app, msg.chatId)) {
    // 拦是对的，但**不能连拦了都不留痕**：用户侧的现象是「在群里 @ 了没反应，
    // 指令日志里也什么都没有」，而这和「事件根本没进来」（连接断了、权限没发版）
    // 完全同形，处置却完全相反。所以在会话表上累加一个计数，
    // 前端就能显示「这个群 @ 过你 7 次，全被白名单拦了」+ 一个放行按钮。
    //
    // 刻意**不写 feishu_commands**：那是已受理指令的日志（会花额度、会执行），
    // 而且写进去等于让任何人拉机器人进群就能往别人的日志里灌行。
    try {
      recordRejected({ appId: app.app_id, chatId: msg.chatId, chatType: msg.chatType });
    } catch (e) {
      // 记不下来不该影响"拦住"这件事本身。
      console.error('[feishu] 记录白名单外会话失败:', e instanceof Error ? e.message : e);
    }
    return 'not_allowed';
  }

  // 去重必须在落日志之前：飞书成功也会重推，重复执行会建出两个任务。
  if (!claimEvent(msg.messageId, app.app_id, nowIso)) return 'duplicate';

  const commandId = startCommand({
    appId: app.app_id,
    userId: app.user_id,
    messageId: msg.messageId,
    chatId: msg.chatId,
    chatType: msg.chatType,
    senderOpenId: msg.senderOpenId,
    senderName: msg.senderName,
    text: msg.text,
  });

  // 故意不 await：3 秒内必须让飞书收到成功。execute 自己兜住所有异常。
  void execute(commandId, msg, deps);
  return 'accepted';
}

/**
 * 本群项目的现状快照（项目名 + 在办任务 + 最近记录）。
 *
 * 出错吞掉，退化成「没绑项目」：这是拼 prompt 用的参考资料，为它让整条指令失败
 * 不值得。退化之后模型少了指代信息（「那个 logo 的活」它认不出是哪条），
 * 但动作层的反查是独立的一套（走库，不看 prompt），所以指令仍然办得成。
 */
function diaryContext(appId: string, msg: InboundMessage): DiaryContext {
  try {
    return buildDiaryContext(appId, msg.chatId);
  } catch (e) {
    console.error('[feishu] 查本群项目失败（按未绑定继续）:', e instanceof Error ? e.message : e);
    return {
      projectName: null,
      records: [],
      tasks: [],
      recordTotal: 0,
      openTaskTotal: 0,
      closedTaskCount: 0,
    };
  }
}

/**
 * 这个群放行吗。
 *
 * 解析统一在 appStore.parseAllowedChats（以前这段 try/catch 在三个地方各有一份）。
 *
 * **解析失败要拒，不能当成"不限群"。** 以前这里 `catch { allowed = [] }`，
 * 而下一行「空 = 不限群」立刻把它读成放行全部 —— 也就是列一坏，本模块唯一
 * 那道闸就静默失效，任何人把机器人拉进自己的群都能烧掉绑定账号的 AI 额度。
 * 而且现象是「一切正常」，没人会去查。拒了的话用户看到的是自己那个群不响应
 * （而 reject_count 在涨），去后台把白名单重存一次就好。
 */
function isChatAllowed(app: FeishuApp, chatId: string): boolean {
  const { chats, malformed } = parseAllowedChats(app.allowed_chats);
  if (malformed) {
    console.error(
      `[feishu] ${app.app_id} 的群白名单不是合法 JSON，本条按「不放行」处理。` +
        `请到后台重新保存一次白名单。原值：${String(app.allowed_chats).slice(0, 120)}`
    );
    return false;
  }
  // 空白名单 = 不限制。首次接入时用户还不知道自己的 chat_id，强制填写会让他卡在第一步。
  return chats.length === 0 || chats.includes(chatId);
}

/**
 * 真正干活的部分。所有异常都在这里收口：
 * 失败也要回帖 + 落日志，否则用户只看到「@ 了没反应」。
 */
async function execute(commandId: string, msg: InboundMessage, deps: DispatchDeps): Promise<void> {
  const startedAt = Date.now();
  const safeReply = async (text: string) => {
    try {
      await deps.reply(msg.chatId, text, msg.messageId);
    } catch (e) {
      // 回帖失败不该盖掉真正的失败原因，只记日志。
      console.error('[feishu] 回帖失败:', e instanceof Error ? e.message : e);
    }
  };

  /**
   * 落终态日志。**写不进去也不能影响回帖。**
   *
   * 这一层不是防御性冗余：`execute` 的每一条出口都是「先 finishCommand、再 safeReply」，
   * 其中最后那条还在 catch 块里。库这一刻不可用（磁盘满、库被锁、迁移没跑到位）时，
   * 没有这层保护的表现是 —— finishCommand 抛出去，**回帖那一行永远执行不到**，
   * 而外层 catch 里再抛就直接成了 unhandledRejection。用户侧看到的是
   * 「@ 了没反应」，也就是本模块最不该出现的那一种失败：出错了，但没人被告知。
   * 而这类故障是**每条指令**都会撞上的，等于整个助理静默罢工。
   *
   * 日志行会停在 pending/running，下次重启由 reapZombieCommands 收尸。
   */
  const safeFinish = (...args: Parameters<typeof finishCommand>) => {
    try {
      finishCommand(...args);
    } catch (e) {
      console.error('[feishu] 写指令终态失败（回帖照发）:', e instanceof Error ? e.message : e);
    }
  };

  try {
    if (!msg.text.trim()) {
      safeFinish(commandId, 'ignored', {
        result: '空指令',
        durationMs: Date.now() - startedAt,
      });
      await safeReply(fallbackReply());
      return;
    }

    // 「收到了」的表情要在**排队之前**贴：忙时排队本身就是最需要反馈的那十几秒。
    // 失败完全忽略（少一个 im:message.reaction 权限是最常见的原因）——
    // 为了一个装饰性的表情让整条指令失败是荒唐的。
    if (deps.ack) {
      try {
        await deps.ack(msg.messageId);
      } catch (e) {
        console.error('[feishu] 贴表情失败（不影响执行）:', e instanceof Error ? e.message : e);
      }
    }

    // 上一轮如果是助理在反问，把那一问一答带上，否则用户的补充（「下午三点」）
    // 在模型眼里就是一句孤立的话，只能再反问一次 —— 反问这条路本来就走不通。
    // 条件卡得很死（同会话、同一人、10 分钟、上一条必须是 reply），见该函数的注释。
    // 查不到就当没有：这是个增强，失败要退化成原来的行为，不能挡住指令。
    let prior: { text: string; reply: string } | undefined;
    try {
      prior =
        findPriorClarification({
          appId: deps.app.app_id,
          chatId: msg.chatId,
          senderOpenId: msg.senderOpenId,
          excludeCommandId: commandId,
        }) ?? undefined;
    } catch (e) {
      console.error('[feishu] 取上一轮追问失败（按无上文继续）:', e instanceof Error ? e.message : e);
    }

    // 意图解析走并发闸。只包住这一段：此时一个写操作都还没发生，
    // 所以「太忙了请重说一遍」这句话是安全的（见 concurrency.ts）。
    const intent = await withIntentSlot(() =>
      parseIntent({
        userId: deps.app.user_id,
        text: msg.text,
        mentions: msg.mentions,
        nowMs: deps.nowMs ?? Date.now(),
        prior,
        // 名册有没有同步过会改变 LLM 的策略：没名册时「派给李四」应该回一句
        // 请他 @ 一下（否则 people.ts 只会抛一个「没找到李四」），有名册时才
        // 直接派。每条指令查一次 COUNT，有索引且是单表整数聚合，
        // 比缓存一份可能过期的数字更省心。
        peopleCount: countUsers(deps.app.app_id),
        // 本企业自己填的补充规则（059）。取的是 deps.app 这一行，所以天然按应用隔离；
        // 空串会让 intent.ts 回落到平台默认那份示例模板。
        supplement: deps.app.intent_supplement,
        // 本会话绑没绑项目日记，同样会改变动作选择（「记一下」该走日志还是
        // 该提示先建项目）；连带把在办任务和最近记录一起带上，这样
        // 「那个 logo 的活推到周五」里的指代模型才认得出来（多轮的一半靠这个，
        // 另一半是上面的 prior）。查不到就当没绑 —— 这是个增强，不能挡住指令。
        diary: diaryContext(deps.app.app_id, msg),
      })
    );

    if (!intent) {
      safeFinish(commandId, 'ignored', {
        error: '意图解析未返回可用结果',
        durationMs: Date.now() - startedAt,
      });
      await safeReply(fallbackReply());
      return;
    }

    const { steps } = intent;
    // 日志的 action / params 列存**整条指令**：一步时和以前逐字节相同，
    // 多步时存数组。排障时要能看出这条指令实际打算做几件事。
    setCommandIntent(
      commandId,
      steps.map((s) => s.action).join(' + '),
      steps.length === 1 ? steps[0].params : steps
    );

    const baseCtx = {
      client: deps.client,
      appId: deps.app.app_id,
      senderOpenId: msg.senderOpenId,
      senderName: msg.senderName,
      chatId: msg.chatId,
      chatType: msg.chatType,
      messageId: msg.messageId,
      mentions: msg.mentions,
      botOpenId: msg.botOpenId,
    };

    // 逐步执行。**前面的步骤已经生效了**，所以某一步失败不能整体抛错 ——
    // 那会让回帖只有一句报错，而用户不知道消息其实已经发出去了，
    // 重下一遍就会发第二遍。所以这里收集每一步的结果，最后一次性回帖。
    const done: Array<{ action: string; summary: string; data?: Record<string, unknown> }> = [];
    let failure: { action: string; detail: ReturnType<typeof describeCommandError> } | undefined;

    for (const [i, step] of steps.entries()) {
      const action = getAction(step.action);
      if (!action) {
        // parseIntent 已经校验过动作名，走到这里说明注册表在运行中被改了。
        failure = {
          action: step.action,
          detail: { kind: 'api_error', message: `未知动作 ${step.action}` },
        };
        break;
      }
      try {
        const ctx: ActionContext = { ...baseCtx, stepIndex: i };
        const result = await action.run(step.params, ctx);
        done.push({ action: step.action, summary: result.summary, data: result.data });
      } catch (e) {
        // 不能用 e.message：SDK 抛的是原始 AxiosError，见 catch 块的注释。
        failure = { action: step.action, detail: describeCommandError(e, deps.app.app_id) };
        // 后面的步骤不再执行：多半会以同样的原因失败，而每次失败都会
        // 在回帖里堆一段权限说明。第一条原因就够用户去修了。
        break;
      }
    }

    // 一步都没成功 = 和以前的单步失败完全等价。**不能把 e 重新抛给外层 catch**：
    // 那会让 describeFeishuErrorDetail 重跑一遍，而 detail 已经算好了。
    if (done.length === 0 && failure) {
      safeFinish(commandId, 'failed', {
        error: failure.detail.message,
        errorDetail: failure.detail,
        durationMs: Date.now() - startedAt,
      });
      await safeReply(failureReply(failure.detail));
      return;
    }

    const parts = done.map((d) => d.summary);
    if (intent.droppedSteps > 0) {
      // 截断必须说出来。静默截断和「一件事静默消失」是同一个失败模式，
      // 而多步支持本来就是为了消灭后者：用户以为四件事都办了，实际只办了前三件，
      // 而这几件都是记日志、派任务这种在群里没人会再核对一遍的写操作。
      parts.push(
        `\n⚠️ 这句话里的事情超过了一次能办的上限（最多 ${MAX_STEPS} 件），` +
          `后面 ${intent.droppedSteps} 件**没有执行**。请把剩下的分开再说一遍。`
      );
    }
    if (failure) {
      // 做成了一半时必须说清「哪些已经生效、哪一步没做成」，否则用户重下指令
      // 会把成功的那部分再做一遍（日志里两条一样的、任务建两个）。
      parts.push(
        `\n⚠️ 但后面这一步没做成（前面的已经生效了，重下指令会重复执行，请只补这一步）：\n` +
          failure.detail.message
      );
    }

    safeFinish(commandId, failure ? 'failed' : 'done', {
      result: JSON.stringify({
        // 顶层 summary 必须留着：前端日志详情读的是 `JSON.parse(result).summary`，
        // 没有它就退化成把整段 JSON 糊在页面上。这里只放**做成了的那几步**，
        // 失败那一步的说明在 error / error_detail 里，重复一遍是噪音。
        summary: done.map((d) => d.summary).join('\n'),
        steps: done.map((d) => ({ action: d.action, summary: d.summary, ...(d.data ?? {}) })),
        // 落库一份：排障时「用户说他让办四件事，日志里只有三件」要能一眼看出
        // 是被上限截掉的，而不是 LLM 漏听了一件。
        ...(intent.droppedSteps > 0 ? { dropped_steps: intent.droppedSteps } : {}),
      }),
      ...(failure
        ? { error: `${failure.action}: ${failure.detail.message}`, errorDetail: failure.detail }
        : {}),
      durationMs: Date.now() - startedAt,
    });
    await safeReply(parts.join('\n'));
  } catch (e) {
    // 不能用 e.message，两个原因：
    //   - SDK 抛的是原始 AxiosError，e.message 只有 "Request failed with status code 400"，
    //     缺哪个权限、去哪申请都埋在 e.response.data 里（app_id 传进去是为了在
    //     飞书没给申请链接时兜底拼一个）；
    //   - 平台自己那几类错误（额度用完、专属渠道缺档、模型超时）的原文是写给
    //     网页前的管理员看的，照抄到飞书群里会让人去点一个他打不开的后台页面。
    // 两种翻译都在 describeCommandError 里收口。
    const detail = describeCommandError(e, deps.app.app_id);
    safeFinish(commandId, 'failed', {
      error: detail.message,
      // 结构化存一份，后台日志据此渲染「一键补权限」按钮。
      errorDetail: detail,
      durationMs: Date.now() - startedAt,
    });
    // 把真实原因告诉用户。兜成「出错了」的话，缺权限/时间说不清这类可自助解决的问题
    // 就永远卡住了——而用户看不到服务端日志。
    await safeReply(failureReply(detail));
  }
}

/**
 * 失败回帖的开头。
 *
 * `advisory` 的那几类（额度用完、现在太忙）不套「❌ 执行失败」：它们是助理的
 * 正常状态，红叉会让用户以为坏了，跑去检查连接和权限，而他要做的只是等一等
 * 或者找人加额度。它们的文案自带该有的语气标记（⏳）。
 */
function failureReply(detail: ReturnType<typeof describeCommandError>): string {
  return detail.advisory ? detail.message : `❌ 执行失败：${detail.message}`;
}
