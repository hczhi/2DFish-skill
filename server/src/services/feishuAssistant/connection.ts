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

/** 建一个应用的连接。已存在则先断开重建（凭证/开关改了要立刻生效）。 */
export async function connectApp(app: FeishuApp): Promise<void> {
  await disconnectApp(app.app_id);

  // 密文只在这一个点解开，和 feishuBitable.getTenantToken 同样的约定。
  const appSecret = decryptSecret(app.app_secret);

  const channel = lark.createLarkChannel({
    appId: app.app_id,
    appSecret,
    transport: 'websocket',
    loggerLevel: lark.LoggerLevel.warn,
    policy: {
      // 群里必须 @ 才响应；私聊直接说话即可。
      requireMention: true,
      // @所有人 不该触发助理——那通常是通知全员，不是给机器人下指令。
      respondToMentionAll: false,
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
    const msg = e instanceof Error ? e.message : String(e);
    setConnState(app.app_id, 'failed', msg);
    // 抛出去让调用方（后台保存接口）能把失败原因回给用户 ——
    // 凭证填错是最常见的情况，静默失败会让用户以为绑好了。
    throw new Error(`建立飞书长连接失败：${msg}`);
  }
}

export async function disconnectApp(appId: string): Promise<void> {
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
