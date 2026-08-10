import * as lark from '@larksuiteoapi/node-sdk';
import { decryptSecret } from '../../core/secrets.js';
import { getAppByAppId, listEnabledApps, setConnState, type FeishuApp } from './appStore.js';
import { handleMessage, type InboundMessage } from './dispatcher.js';
import { recordBotAdded } from './chatStore.js';

// 长连接的生命周期管理。
//
// 用 SDK 的 LarkChannel（而不是裸 WSClient）：它把 @ 占位符剥离、mentionedBot 判定、
// mentions 归一化（key/openId/name/isBot）、markdown 发送都做好了，
// 这些我们全都要，自己实现只是重复它已有的正确逻辑。
//
// 注意 LarkChannel 自带的 safety.dedup 是**内存**去重，进程重启后失效，
// 而飞书会重推到 6 小时后。所以权威去重仍然落库（commandLog.claimEvent），
// 内存那层只当免费的前置过滤。
//
// 集群：长连接是竞争消费（同一事件只有一个实例收到），本项目单实例部署，不涉及。

interface Conn {
  app_id: string;
  channel: lark.LarkChannel;
}

const conns = new Map<string, Conn>();

/**
 * 每个 app_id 上正在进行的建/断连操作。**同一个应用的连接操作必须串起来。**
 *
 * ── 为什么需要 ──
 * `connectApp` 的第一步是 `disconnectApp`，然后 await 好几次（解密、建 channel、
 * `channel.connect()` 走一整个 websocket 握手）。这中间有真实的并发窗口，
 * 而触发它的路径有四条，其中三条不需要用户手速：
 *   - 看门狗每 5 分钟一轮，撞上用户刚点的「重连」；
 *   - 保存配置（`POST /apps`）会 connect，而用户改完名字连点两下保存是常事；
 *   - `startAllConnections()` 和第一轮看门狗。
 *
 * 两个 connectApp 交叉跑的后果不是"多连一次"：后建的那个 channel 会覆盖
 * `conns` 里的项，而**先建的那个仍然连着、仍然在收事件**，只是再也没人能
 * disconnect 它（表里已经没有它了）。于是同一条 @ 消息被处理两遍 ——
 * claimEvent 挡得住同一条消息，所以现象不是"任务建两个"，而是更难查的一类：
 * 一半的指令回帖说「这条已经处理过了」/ 干脆没有回帖，因为另一个 channel
 * 抢到了 claimEvent，而它的回帖走的是那条孤儿连接。停用应用之后也一样收指令。
 *
 * 用「串行链」而不是「正在忙就拒绝」：调用方全都是要求"连上"这个**结果**
 * （看门狗、保存、启动），拒绝掉一次就等于把这个结果丢了，而没有人会重试。
 */
const connOps = new Map<string, Promise<void>>();

/** 把 `op` 排在同一个 app_id 上一次操作之后。 */
function serialize(appId: string, op: () => Promise<void>): Promise<void> {
  // 前一次失败（建连失败会抛）不该拖垮排在后面的那次，所以 catch 掉再接。
  const prev = connOps.get(appId) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(op);
  // 登记的是吞掉异常的版本：这个 Map 只用来排序。失败照样从 return 的那个
  // promise 传给调用方（保存接口要把「凭证不对」回给用户）——
  // 登记原版的话，没人 await 的那些调用（看门狗、stopAll）会变成 unhandledRejection。
  const tail = next.catch(() => {});
  connOps.set(appId, tail);
  // 链空了就把这一项摘掉，别让 Map 随应用数无限长。判一下还是不是自己那条 ——
  // 期间可能又排进来一次，那条还没跑完。
  void tail.then(() => {
    if (connOps.get(appId) === tail) connOps.delete(appId);
  });
  return next;
}

/**
 * 「收到了，在办」那个表情的 emoji_type。
 *
 * 取值是飞书表情的**固定英文标识**（不是 unicode，也不是随便一个字符串），
 * 由飞书文档定义、SDK 只做透传，所以这里没法从 SDK 的类型里推出合法值
 * （签名就是 `emojiType: string`）。写错的表现是 addReaction 报错，
 * 而 dispatcher 把贴表情的失败整个忽略掉 —— 也就是**静默失效**，只有
 * 服务端日志里那行 warn。要换表情的话，去飞书开放平台「表情文案」表里查标识。
 *
 * 选 OnIt（🫡 收到）而不是 Eyes（👀）：这条反馈的语义是"我接了这活"，
 * 而 👀 更像"我看见了"，在群里容易被当成围观。
 */
const ACK_EMOJI = 'OnIt';

/**
 * 建一个应用的连接。已存在则先断开重建（凭证/开关改了要立刻生效）。
 *
 * 同一个 app_id 的建/断连是**串行**的，见 serialize —— 交叉跑会留下一条
 * 谁都断不掉的孤儿连接，而它照样在收指令。
 */
export function connectApp(app: FeishuApp): Promise<void> {
  return serialize(app.app_id, () => doConnect(app));
}

async function doConnect(app: FeishuApp): Promise<void> {
  // 注意这里调的是 doDisconnect：走 disconnectApp 会在同一条链上再排一次，
  // 而我们已经在链里了 —— 那是个必死的自锁。
  await doDisconnect(app.app_id);

  // 密文只在这一个点解开，和 feishuBitable.getTenantToken 同样的约定。
  const appSecret = decryptSecret(app.app_secret);

  const channel = lark.createLarkChannel({
    appId: app.app_id,
    appSecret,
    transport: 'websocket',
    loggerLevel: lark.LoggerLevel.warn,
    policy: {
      // 群里必须 @ 才响应。
      requireMention: true,
      // @所有人 不该触发助理——那通常是通知全员，不是给机器人下指令。
      respondToMentionAll: false,
      // ⚠️ 助理只在群聊里工作，但这里**故意仍然是 'open'**。
      //
      // SDK 也有 `dmMode: 'disabled'`，它在 LarkChannel 内部就把私聊消息丢掉。
      // 不用它，因为那是**静默丢弃** —— 用户私聊机器人后什么都收不到，
      // 而"没反应"和"助理坏了"完全同形（本模块的第一条原则就是不许静默丢）。
      // 所以消息照收，由 dispatcher 挡下来并回一句「我只在群聊里工作，请在群里 @ 我」，
      // 见 dispatcher.ts 的 P2P_ONLY_GROUP_REPLY。
      //
      // 代价是私聊消息仍然会进到我们的进程里（占一次 claimEvent 写库），
      // 但**不会花 AI 额度**：那道闸在意图解析之前。
      dmMode: 'open',
    },
    // 事件里带上原始 payload，排障时能看到 SDK 归一化时丢掉的字段。
    includeRawEvent: true,
    safety: {
      // ⚠️ 关掉「攒一会儿再一起处理」。这是本文件最要紧的一行配置。
      //
      // LarkChannel 默认会把**同一个会话**里 600ms 内到达的消息攒成一批，
      // 然后 `mergeBatch()` 用 `\n\n` 把正文拼起来，元数据取**最后一条**的
      // （messageId、senderId 都是最后那个人的）。这个默认值是为"聊天机器人"
      // 设计的：一个人分三行打完一句话，攒起来一起理解确实更好。
      //
      // 但助理收的是**指令**。同一个群里两个人几乎同时 @ 机器人时（早会前
      // 一人建日程、一人派任务，这不是罕见场景），后果是：
      //   - 两条正文被拼成一条，LLM 当成一句话来解析；
      //   - messageId 只剩后一条的 → 前一条**从来没被 claimEvent 登记过**，
      //     指令日志里彻底没有它；
      //   - 回帖 replyTo 也是后一条，前一个人连"我的指令去哪了"都无从追问。
      // 也就是说：一个人的指令**静默消失**，而这正是本模块从头到尾在防的失败模式。
      //
      // `delayMs: 0` 命中 ChatPipeline.push() 的短路分支（`delayMs <= 0` 时
      // 直接入队冲刷，不启攒批定时器），但**保留每个 chatId 的串行链**——
      // 同一个群的消息仍然按序进 dispatcher，只是不再合并。顺带还省掉了
      // 每条指令固定 600ms 的延迟。
      batch: { text: { delayMs: 0 } },
    },
  });

  channel.on('message', async (msg) => {
    // 机器人自己发的消息不处理，否则回帖会触发自己（无限循环）。
    // LarkChannel 已经会过滤 bot sender，这里是第二道保险。
    if (msg.senderId === channel.botIdentity?.openId) return;

    // 最新的应用配置从库里取：白名单/开关可能在连接建立后被改过，
    // 用建连时那份快照会让改动直到重启才生效。
    const current = getAppByAppId(app.app_id) ?? app;

    const inbound: InboundMessage = {
      messageId: msg.messageId,
      chatId: msg.chatId,
      chatType: msg.chatType,
      senderOpenId: msg.senderId,
      senderName: msg.senderName || '',
      text: (msg.content || '').trim(),
      // 排除 @ 到机器人自己的那一项——它不是"要操作的人"。
      mentions: (msg.mentions || [])
        .filter((m) => !m.isBot && m.openId && m.openId !== channel.botIdentity?.openId)
        .map((m) => ({ openId: m.openId!, name: m.name || '' })),
      // 「总结群聊」要读整个群的历史消息，而其中助理自己的回帖必须滤掉 ——
      // 不滤的话摘要会开始总结助理说过的话，那是我们自己制造的信息。
      botOpenId: channel.botIdentity?.openId,
    };

    handleMessage(inbound, {
      app: current,
      client: channel.rawClient,
      reply: async (chatId, markdown, replyTo) => {
        await channel.send(chatId, { markdown }, { replyTo });
      },
      // 「收到了」的 👀，贴在用户自己那条消息上。回帖动辄十几秒才来，
      // 这段空白期和"助理坏了"完全同形，见 dispatcher 的 Acker 注释。
      ack: async (messageId) => {
        await channel.addReaction(messageId, ACK_EMOJI);
      },
    });
  });

  // 机器人被拉进一个群。这一刻是我们**唯一**能免费拿到 chat_id 的时机 ——
  // 它在飞书客户端里根本看不到，没有这个事件，用户配白名单只能先不设防跑一遍、
  // 再去指令日志里把那串 id 抄出来（而多数人不会回来抄）。
  channel.on('botAdded', async (ev) => {
    // 群名要单独查：botAdded 里的 botName 是**机器人**的名字，不是群名。
    // 查不到就只存 id（需要 im:chat:readonly，它在必需权限里，但用户可能没开全）——
    // 显示一串 oc_xxx 仍然远好过让他自己去日志里找。
    let name = '';
    let chatType = 'group';
    try {
      const info = await channel.getChatInfo(ev.chatId);
      name = info.name ?? '';
      chatType = info.chatType || 'group';
    } catch (e) {
      console.warn(
        `[feishu] 应用 ${app.app_id} 取群名失败（只记 chat_id）:`,
        e instanceof Error ? e.message : e
      );
    }
    try {
      recordBotAdded({
        appId: app.app_id,
        chatId: ev.chatId,
        name,
        chatType,
        addedBy: ev.operator?.openId ?? '',
      });
    } catch (e) {
      console.error('[feishu] 记录会话失败:', e instanceof Error ? e.message : e);
    }
  });

  channel.on('error', (err) => {
    console.error(`[feishu] 应用 ${app.app_id} 连接错误:`, err.message);
    setConnState(app.app_id, 'failed', err.message);
  });
  channel.on('reconnecting', () => setConnState(app.app_id, 'reconnecting', null));
  channel.on('reconnected', () => setConnState(app.app_id, 'connected', null));

  try {
    await channel.connect();
    conns.set(app.app_id, { app_id: app.app_id, channel });
    setConnState(app.app_id, 'connected', null);
    console.log(`[feishu] 应用 ${app.app_id}（${app.name}）长连接已建立`);
  } catch (e) {
    const msg = explainConnectError(e);
    setConnState(app.app_id, 'failed', msg);
    // 抛出去让调用方（后台保存接口）能把失败原因回给用户 ——
    // 凭证填错是最常见的情况，静默失败会让用户以为绑好了。
    throw new Error(`建立飞书长连接失败：${msg}`);
  }
}

/**
 * 把建连失败翻译成「该去查什么」。
 *
 * ── 为什么不能直接用 e.message ──
 * SDK 建连时第一件事是 `fetchBotIdentity()`（GET /open-apis/bot/v3/info），
 * 它把**所有**失败都包成同一句话：
 *   「could not resolve bot identity via /open-apis/bot/v3/info — required for
 *     channel to function」
 * 真实原因塞在 `cause` 里，分类结果塞在 `code` 里，两个都被 `e.message` 丢掉。
 *
 * 于是网络不通和 App Secret 填错在界面上**完全同形**，而那句话里唯一具体的信息
 * 是个接口路径 —— 它把人径直指向「是不是权限没开」「是不是密钥错了」，
 * 而实际可能只是本机开着 VPN／代理（Node 的 fetch 不认 HTTP_PROXY，
 * curl 认，所以「浏览器能上飞书」不能作为网络正常的证据）。
 * 这是本模块反复防的那类失败的变体：不是失败伪装成成功，而是**失败伪装成
 * 另一种失败**，代价是整个排查方向错掉。
 *
 * 所以按 `code` 给出方向。措辞刻意说「查什么」而不是「是什么错」——
 * 用户要的是下一步动作。原文附在后面，便于对着飞书文档搜。
 */
export function explainConnectError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  // LarkChannelError 的 code 是 SDK 公开的联合类型（LarkChannelErrorCode），
  // 不用字符串匹配 message —— 那会随 SDK 改文案而静默失效。
  const code = (e as { code?: lark.LarkChannelErrorCode })?.code;
  // cause 才是真正的失败（undici 的 ETIMEDOUT / ENOTFOUND / 飞书的业务码）。
  const cause = (e as { cause?: unknown })?.cause;
  const causeMsg = cause instanceof Error ? cause.message : cause ? String(cause) : '';
  const causeCode = (cause as { cause?: { code?: string }; code?: string })?.code
    ?? (cause as { cause?: { code?: string } })?.cause?.code;

  const detail = [causeCode, causeMsg].filter(Boolean).join(' ') || raw;

  switch (code) {
    case 'permission_denied':
      return `飞书拒绝了凭证（${detail}）。请核对 App ID / App Secret 是否为同一个自建应用的，以及应用是否已发布。`;
    case 'not_connected':
      // 最常见、也最容易被前一版文案带偏的一类。
      return (
        `连不上飞书开放平台（${detail}）。` +
        `依次查：本机 VPN／代理（Node 不走 HTTP_PROXY，curl 能通不代表这里能通）、DNS 能否解析 open.feishu.cn、防火墙。`
      );
    case 'rate_limited':
      return `飞书限流（${detail}），过一会儿会自动重试。`;
    case 'send_timeout':
      return `连飞书超时（${detail}）。多为网络或代理问题，也可能是飞书侧抖动，稍后会自动重连。`;
    default:
      return code ? `${raw}（${code}${detail && detail !== raw ? `: ${detail}` : ''}）` : raw;
  }
}

export function disconnectApp(appId: string): Promise<void> {
  return serialize(appId, () => doDisconnect(appId));
}

async function doDisconnect(appId: string): Promise<void> {
  const conn = conns.get(appId);
  if (!conn) return;
  conns.delete(appId);
  try {
    await conn.channel.disconnect();
  } catch {
    /* 断开失败无所谓，连接对象已经从表里摘掉了 */
  }
  setConnState(appId, 'idle', null);
}

/** 启动时把所有启用的应用连上。单个失败不影响其他应用。 */
export async function startAllConnections(): Promise<void> {
  const apps = listEnabledApps();
  if (apps.length === 0) return;
  console.log(`[feishu] 正在建立 ${apps.length} 个应用的长连接…`);
  await Promise.all(
    apps.map((app) =>
      connectApp(app).catch((e) => {
        console.error(`[feishu] 应用 ${app.app_id} 建连失败:`, e instanceof Error ? e.message : e);
      })
    )
  );
}

export async function stopAllConnections(): Promise<void> {
  stopConnectionWatchdog();
  await Promise.all([...conns.keys()].map((id) => disconnectApp(id)));
}

// ==================== 看门狗 ====================

/**
 * 巡检间隔。
 *
 * 5 分钟是"用户还没来得及以为坏了"和"别拿建连去捶飞书"之间的折中：
 * 断线的典型现象是 @ 了没反应，而人第一反应是再 @ 一次、然后过几分钟再试。
 */
const WATCHDOG_INTERVAL_MS = 5 * 60_000;

let watchdogTimer: NodeJS.Timeout | null = null;

/**
 * 定期把「库里启用的应用」和「实际活着的连接」对齐。
 *
 * ── 为什么必须有 ──
 * SDK 的 WSClient 自己会重连，但它的重试是**有次数上限**的：网断了十分钟
 * （或飞书侧维护）把次数耗完之后，它就彻底躺平了，而进程还活得好好的。
 * 此时的现象是：服务在跑、页面正常、conn_state 停在 `failed` 或 `reconnecting`，
 * 而所有人在飞书里 @ 机器人都没反应，**指令日志里一条记录都没有**
 * （事件根本没进来）。
 *
 * 在没有这个巡检的版本里，唯一的恢复手段是有人正好想到去后台点一次「重连」，
 * 或者重启整个服务。而这类故障最可能发生在半夜，最可能被发现于第二天早会。
 *
 * ── 判据是 getConnectionStatus，不是 conns 里有没有这一项 ──
 * 躺平的连接对象仍然在 conns 里（`connect()` 当初是成功的），只看 Map
 * 会认为一切正常。所以要看 SDK 自己报的状态。
 *
 * ── 三种不一致，各自的处置 ──
 * 1. 启用了但没连上/连死了 → 重连。
 * 2. 连着但库里已经停用/删掉了 → 断开。漏掉这一步的后果是被停用的应用
 *    仍在处理指令、仍在烧那个账号的额度，而界面显示"已停用"。
 * 3. 剩下的（连着且该连着）→ 什么都不做。
 */
function sweepConnections(): void {
  const enabled = new Map(listEnabledApps().map((a) => [a.app_id, a]));

  for (const app of enabled.values()) {
    const state = connectionStatus(app.app_id);
    // 'connecting' / 'reconnecting' 是 SDK 正在努力，别去打断它 ——
    // 重建连接会把它当前的重试进度扔掉，反而更慢。
    if (state === 'connected' || state === 'connecting' || state === 'reconnecting') continue;
    console.warn(`[feishu] 看门狗：应用 ${app.app_id} 连接状态为 ${state}，尝试重连`);
    void connectApp(app).catch((e) => {
      // 失败不要紧，下一轮还会再试。connectApp 已经把原因写进 conn_error 了。
      console.error(
        `[feishu] 看门狗：应用 ${app.app_id} 重连失败:`,
        e instanceof Error ? e.message : e
      );
    });
  }

  for (const appId of [...conns.keys()]) {
    if (enabled.has(appId)) continue;
    console.warn(`[feishu] 看门狗：应用 ${appId} 已停用或删除，断开残留连接`);
    void disconnectApp(appId);
  }
}

/** 启动巡检。重复调用是安全的（先清掉上一个定时器）。 */
export function startConnectionWatchdog(): void {
  stopConnectionWatchdog();
  watchdogTimer = setInterval(sweepConnections, WATCHDOG_INTERVAL_MS);
  // 让定时器不要拦住进程退出：它纯粹是运维用的，没有必须跑完的工作。
  watchdogTimer.unref?.();
}

export function stopConnectionWatchdog(): void {
  if (watchdogTimer) clearInterval(watchdogTimer);
  watchdogTimer = null;
}

/**
 * 拿一个能直接调飞书 API 的 client。
 *
 * 名册同步需要 client，但它跟「有没有建长连接」无关：应用可能被停用、或者刚绑好
 * 还没连上，用户仍然应该能同步组织架构。所以优先复用长连接里那个（token 缓存是热的），
 * 没有就临时建一个。
 *
 * 解密仍然只发生在本文件 —— 上层拿不到明文 secret。
 */
export function clientFor(app: FeishuApp): lark.Client {
  const live = conns.get(app.app_id);
  if (live) return live.channel.rawClient;
  return new lark.Client({
    appId: app.app_id,
    appSecret: decryptSecret(app.app_secret),
    loggerLevel: lark.LoggerLevel.warn,
  });
}

/** 某个应用当前的连接状态快照，供后台展示。 */
export function connectionStatus(appId: string): string {
  const conn = conns.get(appId);
  if (!conn) return 'idle';
  return conn.channel.getConnectionStatus()?.state ?? 'idle';
}
