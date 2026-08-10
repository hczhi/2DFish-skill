import type { Client } from '@larksuiteoapi/node-sdk';

// 读群聊记录。只有「总结群聊」这一个功能用它。
//
// ── 为什么这是本模块唯一一处「主动去读用户的聊天」──
// 其余所有功能都是被动的：用户 @ 我一句，我处理那一句。这个功能要读**没有
// @ 我的**消息，也就是读整个群的对话。这件事在两个方向上要格外小心：
//
//  1. **权限是最难批的那一档。** `im:message.group_msg`（获取群组中所有消息）
//     在飞书后台是需要额外说明用途的权限，多数企业不会随手开。所以它**不在**
//     `allRequiredScopes()` 里 —— 把它列进「接入前请先开通」会让所有人的接入
//     流程都卡在一个大部分人用不到的权限上（这正是当年那五个日程动作被删掉的
//     第二个理由）。代价是第一次用这个功能会失败，但失败信息是
//     feishuError.ts 翻译过的「缺哪个权限 + 一键申请链接」，用户照着点就行。
//     见 CHAT_HISTORY_SCOPES。
//
//  2. **读到的东西不能当成日志原文。** 群聊里大量是「好」「收到」「哈哈」，
//     以及别人贴的图和文件。这些进不了日志，而**丢掉什么必须数出来说清**
//     （本模块第一条原则）：一句「今天群里没什么可记的」在"真的没聊正事"和
//     "全是图片我读不了"两种情况下是同一句话，而处置完全不同。
//     所以 FetchResult.skipped 是分类计数，不是一个总数。
//
// ── 飞书这个接口的几个坑 ──
// - `start_time` / `end_time` 是**秒**，而返回的 `create_time` 是**毫秒**。
//   （和 task 的 due.timestamp 一样，飞书的时间单位是逐个接口定的。）
// - `page_size` 上限 50。
// - 撤回的消息**照样返回**，content 固定是 `This message was recalled` ——
//   把它当正文喂给模型，摘要里就会出现一句英文提示。
// - `body.content` 是**序列化过的 JSON 字符串**，不是对象。
// - 文本里的 @ 是占位符（`@_user_1`），真名在同一条消息的 `mentions[]` 里。
//   不还原的话摘要里会写「@_user_1 说要改 logo」。

/**
 * 读群聊记录需要的权限点。**故意不并进 `allRequiredScopes()`。**
 *
 * 三个是「或」的关系（飞书文档：im:message / im:message:readonly /
 * im:message.history:readonly 任一），而 `im:message.group_msg` 是读**群**
 * 消息时额外必须的那一个。这里按用户要去后台勾选的粒度列出来，
 * 顺序上把「至少要有一个」的那三个放在后面。
 */
export const CHAT_HISTORY_SCOPES = [
  'im:message.group_msg',
  'im:message:readonly',
];

/** 单页上限（飞书的硬限制）。 */
const PAGE_SIZE = 50;

/**
 * 一次最多读多少条。
 *
 * 500 条 ≈ 一个活跃项目群一整天的量。再多的意义不大：喂给模型的部分另有上限
 * （见 digest.ts），而多读的那些只是被丢掉，却实打实花了 10 次接口调用。
 * 读满了必须说出来 —— 否则「今天上午的事没在摘要里」会被当成模型漏了。
 */
const MAX_MESSAGES = 500;

/** 单条正文截断。有人会把整封邮件贴进群里。 */
const MAX_TEXT = 400;

/** 这些短语单独成句时不进摘要 —— 它们不携带任何信息，只挤占额度。 */
const TRIVIAL = new Set([
  '好', '好的', '好滴', '嗯', '嗯嗯', '哦', '收到', '收到了', '知道了', '明白',
  '明白了', '了解', '可以', '行', '行吧', '没问题', '同意', '赞', '辛苦了',
  '谢谢', '感谢', '不客气', '哈哈', '哈哈哈', '呵呵', '？', '?', '。',
  'ok', 'okay', 'okk', 'yes', 'no', 'thanks', 'thx', 'got it', '+1',
]);

export interface ChatMessage {
  messageId: string;
  senderOpenId: string;
  /** 接口给的显示名。可能为空（那时由调用方拿 open_id 去名册里换）。 */
  senderName: string;
  text: string;
  ms: number;
}

export interface SkipCounts {
  /** 不是文本/富文本（图片、文件、表情包、系统消息…）。 */
  nonText: number;
  /** 已撤回。 */
  recalled: number;
  /** 机器人自己发的（含助理的回帖 —— 不滤掉，摘要就会开始总结它自己）。 */
  bot: number;
  /** @ 了助理的指令消息。它们已经在指令日志里，且摘要不该复述指令。 */
  command: number;
  /** 「好」「收到」这类无信息量的短句。 */
  trivial: number;
}

export interface FetchResult {
  messages: ChatMessage[];
  skipped: SkipCounts;
  /** 撞到 MAX_MESSAGES 上限了 —— 更早的那些没读进来。必须说出来。 */
  truncated: boolean;
}

interface RawItem {
  message_id?: string;
  msg_type?: string;
  create_time?: string;
  deleted?: boolean;
  sender?: { id?: string; sender_type?: string; sender_name?: string };
  body?: { content?: string };
  mentions?: Array<{ key?: string; name?: string; id?: string }>;
}

/**
 * 取一段时间内的群消息，按时间正序（读起来是对话发生的顺序）。
 *
 * **翻页是倒着翻的**（`ByCreateTimeDesc`），最后再翻回正序。因为读满
 * MAX_MESSAGES 就得停，而"停在哪一头"决定了丢掉的是哪一半：正着翻的话
 * 一个刷了 800 条的群，读到的是**最早**那 500 条 —— 摘要里全是上午的闲聊，
 * 下午定的方案一条都没有，而回帖只说了一句「消息太多，更早的没读进来」，
 * 意思正好相反。倒着翻则丢掉最早的那些，和回帖说的一致。
 *
 * 抛错：这个函数**会抛**（和本模块其他"表格是镜像"的地方不同）。读不到消息
 * 意味着这个功能一件事都做不了，降级成「今天没什么可记的」是在撒谎 ——
 * 而那句谎话看起来完全正常。调用方把异常交给 dispatcher 的失败收口，
 * 缺权限会被 feishuError.ts 翻译成「缺哪个权限 + 一键申请链接」。
 */
export async function fetchChatMessages(
  client: Client,
  opts: {
    chatId: string;
    /** 含。 */
    startMs?: number;
    /** 不含（和 listRecords 的语义一致）。 */
    endMs?: number;
    /** 助理自己的 open_id。拿不到时只能靠 sender_type 滤，见下。 */
    botOpenId?: string;
  }
): Promise<FetchResult> {
  const skipped: SkipCounts = { nonText: 0, recalled: 0, bot: 0, command: 0, trivial: 0 };
  const messages: ChatMessage[] = [];
  let pageToken: string | undefined;
  let truncated = false;

  for (;;) {
    const res = await client.im.message.list({
      params: {
        container_id_type: 'chat',
        container_id: opts.chatId,
        // 秒！返回的 create_time 是毫秒。别在这里统一，两边都是飞书定的。
        ...(opts.startMs !== undefined
          ? { start_time: String(Math.floor(opts.startMs / 1000)) }
          : {}),
        // endMs 是"不含"，而飞书的 end_time 是"含"。减 1 秒不够严谨（同一秒里
        // 的消息会被带进来），但这个窗口的边界是当天 0 点 —— 0 点整发的消息
        // 归哪天在这个功能里没有意义，而少减会把次日凌晨的消息算进昨天。
        ...(opts.endMs !== undefined
          ? { end_time: String(Math.floor(opts.endMs / 1000) - 1) }
          : {}),
        // 倒序 —— 读满上限时要丢掉**最早**的那些，见函数注释。
        sort_type: 'ByCreateTimeDesc',
        page_size: PAGE_SIZE,
        // 让接口把发送者昵称一起带回来，省掉每个人一次通讯录查询。
        // 拿不到时调用方还会去本地名册里换一次。
        with_sender_name: true,
        ...(pageToken ? { page_token: pageToken } : {}),
      },
    });

    const items = (res.data?.items ?? []) as RawItem[];
    for (const it of items) {
      const parsed = parseItem(it, opts.botOpenId, skipped);
      if (parsed) messages.push(parsed);
    }

    if (messages.length >= MAX_MESSAGES) {
      // 已经是倒序，所以多出来的都在尾部（= 更早的）。
      messages.length = MAX_MESSAGES;
      truncated = true;
      break;
    }
    if (!res.data?.has_more || !res.data.page_token) break;
    pageToken = res.data.page_token;
  }

  // 翻回正序：模型读的应该是对话发生的顺序，倒着读因果关系是反的
  //（「那就按这个来」出现在方案之前）。
  messages.reverse();
  return { messages, skipped, truncated };
}

/** 一条原始消息 → 一条可用的消息，或者 null（并记一笔为什么丢的）。 */
function parseItem(
  it: RawItem,
  botOpenId: string | undefined,
  skipped: SkipCounts
): ChatMessage | null {
  if (it.deleted) {
    skipped.recalled++;
    return null;
  }
  // 机器人发的：sender_type 是 'app'。助理自己的回帖走这条 ——
  // 不滤掉的话摘要会开始总结助理说过的话（「助理确认任务已创建」），
  // 而那是我们自己制造的信息，不是群里发生的事。
  const senderType = it.sender?.sender_type ?? '';
  const senderId = it.sender?.id ?? '';
  if (senderType === 'app' || senderType === 'bot' || (botOpenId && senderId === botOpenId)) {
    skipped.bot++;
    return null;
  }

  const type = it.msg_type ?? '';
  if (type !== 'text' && type !== 'post') {
    skipped.nonText++;
    return null;
  }

  let text = type === 'text' ? textOf(it.body?.content) : postOf(it.body?.content);
  if (!text) {
    skipped.nonText++;
    return null;
  }

  // @ 占位符还原成真名。
  const mentions = it.mentions ?? [];
  let mentionsBot = false;
  for (const m of mentions) {
    if (!m.key) continue;
    const name = m.name ?? '';
    // @ 到助理的消息就是**指令**，已经在指令日志里了，而且摘要不该复述指令
    // （「张三让助理记一条日志」不是项目进展）。这里只能靠名字判断 ——
    // mentions[] 里没有 sender_type 那种字段，而 open_id 要额外传进来。
    if (botOpenId && m.id === botOpenId) mentionsBot = true;
    text = text.split(m.key).join(name ? `@${name}` : '');
  }
  // @所有人 的占位符没有对应的 mentions 项。
  text = text.split('@_all').join('@所有人').trim();

  if (mentionsBot) {
    skipped.command++;
    return null;
  }
  if (TRIVIAL.has(text.toLowerCase().replace(/[\s。，,.!！~～]/g, ''))) {
    skipped.trivial++;
    return null;
  }

  const ms = Number(it.create_time ?? 0);
  return {
    messageId: it.message_id ?? '',
    senderOpenId: senderId,
    senderName: it.sender?.sender_name ?? '',
    text: text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…（过长已截断）` : text,
    ms: Number.isFinite(ms) && ms > 0 ? ms : 0,
  };
}

/** `{"text":"..."}` */
function textOf(raw: string | undefined): string {
  if (!raw) return '';
  try {
    const v = JSON.parse(raw) as { text?: unknown };
    return typeof v.text === 'string' ? v.text.trim() : '';
  } catch {
    return '';
  }
}

/**
 * 富文本（`post`）。结构是 `{title, content: [[{tag, text}, …], …]}` ——
 * 段落数组的数组。只取 tag 是 text/a/at 的那些，图片段落直接跳过。
 *
 * 支持 post 是因为群里的长消息（会议纪要、需求说明）几乎都是富文本，
 * 而它们恰恰是最值得进日志的那些。只认 text 的话，摘要会漏掉一整天里
 * 唯一有信息量的那条消息，同时报告「今天没什么可记的」。
 */
function postOf(raw: string | undefined): string {
  if (!raw) return '';
  try {
    const v = JSON.parse(raw) as {
      title?: unknown;
      content?: Array<Array<{ tag?: string; text?: unknown; href?: unknown }>>;
    };
    const title = typeof v.title === 'string' ? v.title.trim() : '';
    const body = (v.content ?? [])
      .map((para) =>
        (para ?? [])
          .map((seg) => (typeof seg?.text === 'string' ? seg.text : ''))
          .join('')
          .trim()
      )
      .filter(Boolean)
      .join('\n');
    return [title, body].filter(Boolean).join('\n').trim();
  } catch {
    return '';
  }
}
