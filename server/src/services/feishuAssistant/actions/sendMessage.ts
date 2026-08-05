import { type ActionDef, type ActionContext, requireStr, str, strList } from './types.js';
import { describeAudience, resolveAudience, type ResolvedPerson } from './people.js';
import { describeFeishuError } from '../feishuError.js';
import { findByOpenId } from '../directory/store.js';

/**
 * 给某人 / 某个部门发私聊消息。
 *
 * ── 收件人怎么确定 ──
 * 参数是 `to`：**用户原话里的那个名字**，不是 open_id。open_id 由 people.ts
 * 从两个不经过模型的来源里查出来 —— 本条消息 @ 到的人，或本地名册（migration 057）。
 * 让 LLM 直接输出 open_id 是不行的：它会编 ou_xxx，而把消息发给错误的人
 * 是本模块从一开始就划定的不可接受的失败模式。
 *
 * 名册让这个动作在**私聊里也能用** —— 私聊里没法 @ 任何人，
 * 在有名册之前这个动作在私聊里是个死胡同。
 *
 * ── 为什么支持按部门群发 ──
 * 名册里本来就存了 `department_ids` 和部门树，「给销赞云事业部所有人发个通知」
 * 只差一步反查（`resolveAudience`）。但它和单人发送有两处本质区别：
 *   1. **上限**（`MAX_BROADCAST`）—— 「给全公司发」和「给销售部发」在自然语言里
 *      长得一样，而消息发出去撤不回来；
 *   2. **逐条发送会部分失败** —— 某个人不在应用可用范围里（230013）时只有他那条
 *      失败。所以这里不是 all-or-nothing，而是**发完所有能发的，然后把失败的
 *      名单和原因一起回帖**。中途 throw 会留下一个「发了一半、不知道发到谁」
 *      的状态，用户重下指令前面那些人就会收到两遍。
 *

 * ── 为什么正文里要写「谁让我转告的」 ──
 * 消息是机器人发的，收件人看到的是机器人的头像和名字。少了这一句，
 * 「明天的会议改到下午三点」就成了一条没有主人的通知 —— 收件人不知道是谁改的、
 * 该找谁确认，也可能干脆当成系统广播忽略掉。
 *
 * 这不是"让消息看起来像本人发的"。真的以本人身份发要 `user_access_token`，
 * 而那需要 OAuth 授权码流程：一个公网回调路由（本模块现在**零 public 路由**，
 * 见文档第二节）、每人各自在浏览器里授权一次、存 + 刷新一对会过期的 token。
 * 代价远大于收益，因为收件人真正需要知道的只是"这话是谁说的"。
 * 把转达关系写进正文就把这件事解决了，且没有任何会过期的东西。
 *
 * 显式写出转达关系还避免了一种更糟的情况：收件人以为**机器人**在通知他某件事，
 * 于是回复机器人 —— 而机器人不会把回复转回给发起人（那需要另一套会话状态）。
 * 看到「洪成智 让我转告你」他会直接去找洪成智。
 */
/**
 * 在正文前面加一行「谁让我转告的」。
 *
 * 用换行而不是「洪成智说：xxx」那种前缀拼接：原文可能是多行的，
 * 挤在同一行会把第二行之后的内容和署名割裂开。
 *
 * 拿不到发言人姓名时**什么都不加**，不要写成「有人让我转告你」——
 * 那比没有署名更糟（收件人会以为是匿名消息或系统故障），而没有署名时
 * 至少还是一条正常的机器人消息。
 */
export function withAttribution(text: string, senderName: string | undefined): string {
  const name = senderName?.trim();
  if (!name) return text;
  return `${name} 让我转告你：\n${text}`;
}

/**
 * 群发时两条消息之间的间隔（毫秒）。
 *
 * 顺序发只解决了"不并发"，但没有限制**速率**：紧挨着的 for 循环在快网络下
 * 就是每秒十几条请求。飞书 im 消息的限额是每个会话 5 QPS，而这个额度是
 * **所有机器人共享**的 —— 也就是说别人的机器人也在花它，我们不该刚好把它顶满。
 *
 * 250ms ≈ 4 QPS，留一点余量。代价是 30 人的部门多花约 7 秒，
 * 而群发的回帖本来就要等（用户已经知道"人多会慢一点"）；
 * 换来的是不会有人因为限流收不到通知 —— 那种失败在用户眼里和
 * 「没有权限」一模一样，而且是随机几个人收不到，最难查。
 *
 * 单人发送不受影响：下面的循环只在**两条之间**等，一个人时一次都不等。
 *
 * 测试里归零：群发用例有十来个、每个发 4~5 个人，按真实间隔跑会给整个套件
 * 凭空加上六七秒。而这里要验的是"发给了谁、失败的怎么回帖"，
 * 不是"两条之间等了多久" —— 拿套件时长换一个没人断言的行为不值得。
 */
const SEND_INTERVAL_MS = process.env.NODE_ENV === 'test' ? 0 : 250;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * 发起人叫什么。事件自带的 sender_name 优先，空了才查名册。
 *
 * 事件里的名字**更可信**（是飞书此刻给的），名册是同步时的快照。
 * 但 sender_name 偶尔就是空的，而署名缺失会让收件人收到一条没有主人的通知 ——
 * 查一次主键索引换掉这个失败很划算。
 */
function senderNameOf(ctx: ActionContext): string | undefined {
  const fromEvent = ctx.senderName?.trim();
  if (fromEvent) return fromEvent;
  return findByOpenId(ctx.appId, ctx.senderOpenId)?.name;
}

/**
 * 幂等键。同一条飞书消息可能被重推，带上它重推不会让对方收到两遍。
 *
 * **每个收件人一个**（把 open_id 拼进去）：群发时所有人共用一个 uuid 的话，
 * 第一个人发出去之后剩下的全被飞书判成重复消息静默丢掉 —— 而接口返回成功，
 * 我们会回帖「已通知 12 人」，实际只发出去 1 条。同理带上 stepIndex，
 * 一句话里让给同一个人发两条不同的消息时，第二条不该被吞掉。
 *
 * 50 字符是飞书的上限，而 message_id + open_id 加起来会超，所以用哈希压一下。
 * 只要「同一条指令 + 同一步 + 同一个人」稳定映射到同一个 uuid 就够了，不需要可逆。
 */
function uuidFor(ctx: ActionContext, openId: string): string {
  let h = 0;
  const s = `${ctx.messageId}:${ctx.stepIndex ?? 0}:${openId}`;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return `${ctx.messageId.slice(0, 30)}:${(h >>> 0).toString(36)}`.slice(0, 50);
}

export const sendMessageAction: ActionDef = {
  name: 'send_message',
  description:
    '以机器人身份给同事发私聊消息（会自动署名是谁让你转告的）。' +
    '可以发给一个人、几个人，也可以按**部门**群发给整个部门（含子部门）的在职同事。' +
    '收件人写用户说的那个**姓名**即可；在群里 @ 过的人最准，没 @ 的人会去公司通讯录里按姓名查。',
  params: {
    to:
      '收件人姓名。一个人写 "张三"，多个人写 ["张三","李四"]，原样填用户说的名字。' +
      '不要填 open_id，也不要自己编 —— 系统会自己去查。' +
      '用户只说了部门（如「给销售部所有人」）时这个参数留空，改填 departments。',
    departments:
      '要群发的部门名数组，如 ["销赞云事业部"]。' +
      '用户说「给 X 部门/事业部/组的所有人发」时填这个，名称原样照抄他说的那几个字。' +
      '会自动包含子部门里的在职同事，你不用自己展开。没提到部门就留空。',
    text:
      '必填。要转达的话，用**第一人称**写（就当是发起人自己在说）。' +
      '不要自己加「XX说」「XX让我告诉你」这类署名 —— 系统会自动加在最前面，' +
      '你再加一遍就会重复两次。',
  },
  examples: [
    '告诉 @张三 明天的会议改到下午三点',
    '给李四发消息说方案已经评审通过了',
    '跟王五和赵六说一下我这边延后半小时',
    '给销赞云事业部的所有人发消息：周五早上九点半开会',
  ],
  scopes: ['im:message', 'im:message:send_as_bot'],
  async run(params: Record<string, unknown>, ctx: ActionContext) {
    const text = requireStr(params, 'text', '消息内容');

    // 兼容 LLM 仍按老参数名输出 to_open_id 的情况：resolvePerson 里
    // 对 ou_xxx 有专门的拦截，落到那条分支会给出「请 @ 一下」的提示。
    const names = strList(params, 'to');
    if (names.length === 0) {
      const legacy = str(params, 'to_open_id');
      if (legacy) names.push(legacy);
    }
    const departments = strList(params, 'departments');
    if (names.length === 0 && departments.length === 0) {
      throw new Error('缺少收件人，请说清要发给谁（某个人的姓名，或某个部门）。');
    }

    // 解析全部收件人。任何一个解析不出来就在这里抛错 —— 此时一条都还没发，
    // 用户重说一遍是安全的。
    const audience = resolveAudience(
      { names, departments, dropSenderFromDepartments: true },
      ctx
    );

    // 一次算好，所有人共用同一份，日志里也存这一份 —— 分开算会出现
    //「日志里有署名、实际发出去的没有」这种对不上的情况
    //（名册在两次调用之间被重新同步过就够了）。
    const sentText = withAttribution(text, senderNameOf(ctx));

    const sent: ResolvedPerson[] = [];
    const failed: Array<{ person: ResolvedPerson; error: string }> = [];

    // 顺序发，不并发：im 消息是每个会话 5 QPS 且所有机器人共享，
    // 并发几十条会撞限流 —— 而那些失败看起来和「没有权限」一模一样。
    // 顺序之外还要限速，见 SEND_INTERVAL_MS。
    for (const [i, person] of audience.members.entries()) {
      // 只在两条之间等，所以单人发送一次都不等（绝大多数指令是单人）。
      if (i > 0 && SEND_INTERVAL_MS > 0) await sleep(SEND_INTERVAL_MS);
      try {
        await ctx.client.im.message.create({
          params: { receive_id_type: 'open_id' },
          data: {
            receive_id: person.openId,
            msg_type: 'text',
            content: JSON.stringify({ text: sentText }),
            uuid: uuidFor(ctx, person.openId),
          },
        });
        sent.push(person);
      } catch (e) {
        // 一个人失败不该让其余的人收不到。最常见的原因是他不在应用可用范围里
        // （230013），那是**逐人**生效的：同一次群发里有人成功有人失败很正常。
        // 这里自己 catch 了，走不到 dispatcher 的收口，所以要自己翻译原文。
        failed.push({ person, error: describeFeishuError(e, ctx.appId) });
      }
    }

    // 一个都没成功 = 整体失败。回一句「已通知 0 人」是在假装成功，
    // 而这种情况几乎总是配置问题（可用范围/权限），用户需要看到原因。
    if (sent.length === 0) {
      throw new Error(
        `一条都没发出去。${failed[0]?.error ?? '飞书没有返回具体原因。'}`
      );
    }

    const preview = text.length > 40 ? text.slice(0, 40) + '…' : text;
    const isBatch = audience.members.length > 1;
    const parts: string[] = [];

    if (isBatch) {
      parts.push(`已通知 ${sent.length} 人（${describeAudience(audience)}）：${preview}`);
      parts.push(`收到的人：${sent.map((p) => p.name).join('、')}`);
    } else {
      // 单人时保留原来那句话的形状。名册查出来的人要标来源：万一同名查错了，
      // 用户能立刻看出来并纠正，而不是过几天才发现消息发给了另一个张三。
      const via = sent[0].from === 'directory' ? '（按通讯录姓名匹配）' : '';
      parts.push(`已私聊 ${sent[0].name}${via}：${preview}`);
    }

    // 失败的人必须逐个点名。汇总成「3 人失败」的话用户不知道该单独补谁 ——
    // 而他唯一的补救办法就是自己去跟那几个人说一声。
    if (failed.length) {
      parts.push(
        `⚠️ 有 ${failed.length} 人没发成功，需要你自己跟他们说一声：` +
          failed.map((f) => f.person.name).join('、')
      );
      // 原因通常是同一个（可用范围），只贴第一条即可，贴 N 条会把回帖淹掉。
      parts.push(failed[0].error);
    }

    return {
      summary: parts.join('\n'),
      data: {
        // 单人时保留老字段名，后台日志页和已有排障习惯都在读它。
        ...(audience.members.length === 1 && sent.length === 1
          ? {
              to_open_id: sent[0].openId,
              to_name: sent[0].name,
              resolved_from: sent[0].from,
            }
          : {}),
        departments: audience.departments.map((d) => ({
          department_id: d.departmentId,
          name: d.name,
          member_count: d.members.length,
        })),
        sent: sent.map((p) => ({ open_id: p.openId, name: p.name, resolved_from: p.from })),
        failed: failed.map((f) => ({
          open_id: f.person.openId,
          name: f.person.name,
          error: f.error,
        })),
        // 存实际发出去的正文，不是 LLM 给的那段。排查「对方说没收到/收到的不对」时
        // 要看的是真正发出去的东西 —— 少了署名那一行就对不上收件人的截图。
        sent_text: sentText,
      },
    };
  },
};
