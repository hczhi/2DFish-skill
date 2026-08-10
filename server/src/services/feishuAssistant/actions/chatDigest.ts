import { type ActionDef, type ActionContext, str, posInt } from './types.js';
import * as store from '../diary/store.js';
import * as bitable from '../diary/bitable.js';
import { resolveRange, type RangeKey } from '../diary/range.js';
import { fetchChatMessages, CHAT_HISTORY_SCOPES } from '../diary/chatHistory.js';
import { digestChat } from '../diary/digest.js';
import { getAppByAppId } from '../appStore.js';

// 「总结群聊」：把一段群聊读出来，抽成几条日志记录。
//
// 这是本模块唯一一个**主动去读用户聊天**的动作，也是唯一一个把 LLM 写的字
// 落进日志表的动作。两件事各自的风险和处置写在 diary/chatHistory.ts 和
// diary/digest.ts 的文件头里；这个文件负责把它们串起来，并保证三件事：
//
// 1. **落库的每一条都标成 `chat_digest`**（migration 069），正文还顶一行
//    「【群聊摘要 MM-DD】」。日志表里用户的原话和模型写的话并排放着，
//    分不出来的话整张表就不能再当证据用了 —— 而那是它唯一的用途。
// 2. **丢了什么都要说出来。** 「今天群里没什么可记的」这句话在「真的没聊正事」、
//    「全是图片我读不了」、「消息太多只读了后 500 条」三种情况下完全同形，
//    而处置各不相同。所以回帖里带分类计数。
// 3. **不拦重复总结，但要说清是第几版。** 上午总结过、下午又聊了两小时是常态，
//    拦掉等于让下午的事永远进不了日志。所以只用 countDigests 数一下版本号
//    （见 store.countDigests）。
//
// 权限：`im:message.group_msg` **故意不在** allRequiredScopes() 里，
// 见 chatHistory.ts 的文件头 —— 它是最难批的那一档，而绝大多数用户用不到
// 这个功能。第一次用会失败，但失败信息是 feishuError.ts 翻译过的
// 「缺哪个权限 + 一键申请链接」。

/**
 * 能总结的时间范围。**故意窄于 RANGE_KEYS。**
 *
 * 群聊不是日志：一个活跃项目群一个月有上万条消息，而喂给模型的上限是 200 条
 * （digest.ts）。允许 `this_month` / `all` 的后果不是报错 —— 是读了 500 条、
 * 用了最后 200 条，产出一份写着「本月」的摘要，实际只覆盖最后半天，
 * 而且这份东西会落进日志表被后来的人当成事实读。
 *
 * 所以只留三个能真正读完的窗口。超出的范围**明说做不到并给出替代**，
 * 不静默降级（那正是上面那个失败）。「阶段性总结」要的是复盘（review_diary）——
 * 那边读的是已经落库的日志，没有条数问题。
 */
const DIGEST_RANGES: RangeKey[] = ['today', 'yesterday', 'recent_days'];

/** 「最近 N 天」最多几天。三天的群聊已经够冲爆 200 条上限了。 */
const MAX_DAYS = 3;

export const digestChatAction: ActionDef = {
  name: 'digest_chat',
  description:
    '把**本群最近的聊天记录**交给 AI 挑出值得记的信息，逐条写进本群项目的日志。' +
    '用户说「总结一下群里的聊天」「把今天群里的内容记到日志」「整理下昨天的群消息」' +
    '这类话时用它 —— 特征是要处理的对象是**群聊消息本身**。\n' +
    // 和复盘的分界。这两个是这个动作唯一容易串味的地方，而串了之后
    // 用户拿到的东西是反的：他想让助理去读群聊，收到的却是一份基于日志的总结
    //（很可能是空的，因为群里的事根本没人手动记过）。
    '**这不是复盘。** 复盘（review_diary）读的是**已经记在日志里**的内容，产出一段总结发在群里；' +
    '这个动作读的是**没人记过的群聊原话**，产出是往日志里**新增几条记录**。' +
    '用户说「复盘」「这周干了什么」「总结下项目情况」时用 review_diary，不要用这个。',
  params: {
    range:
      `可选。时间范围，只能是这三个值之一：${DIGEST_RANGES.join(' / ')}` +
      '（today=今天，yesterday=昨天，recent_days=最近 N 天）。用户没说时间就填 today。' +
      '**不要输出具体日期或时间戳**，只填这几个词，具体范围由系统计算。' +
      `范围最长 ${MAX_DAYS} 天 —— 更长的时间跨度请用 review_diary（复盘）。`,
    days: `可选。仅当 range 是 recent_days 时填，表示最近多少天（1 到 ${MAX_DAYS}）。`,
  },
  examples: [
    '总结一下今天群里聊了什么，记到日志',
    '把今天的群聊整理进日志',
    '整理下昨天群里的消息',
    '最近两天群里的内容总结一下',
  ],
  hint: '读本群聊天记录，把值得记的挑出来写进日志（「总结一下今天群里聊了什么」）',
  // bitable:app 是同步日志表用的；读消息那两项单独列在 CHAT_HISTORY_SCOPES 里，
  // 一并声明在这里是为了让后台的权限清单能显示它们**属于哪个功能**。
  // allRequiredScopes() 会把它们并进「必需权限」——这正是我们不想要的，
  // 所以下面 index.ts 里对本动作的 scopes 做了排除，见那边的注释。
  scopes: ['bitable:app', ...CHAT_HISTORY_SCOPES],
  async run(params: Record<string, unknown>, ctx: ActionContext) {
    // 只在群里工作：要读的就是「本群」的聊天记录，私聊里没有群可读。
    // dispatcher 已经把私聊整体挡掉了，这里是本动作自己的前提。
    if (ctx.chatType !== 'group') {
      return { summary: '这个功能要在项目群里用 —— 我读的是**本群**的聊天记录。' };
    }

    const project = store.getProjectByChat(ctx.appId, ctx.chatId);
    if (!project) {
      return {
        summary:
          '这个群还没有对应的项目，总结出来的东西没地方记。\n' +
          '先说一句「新建项目：XXX」我就把项目和日志表建起来。',
      };
    }

    // 范围先归一化，再判在不在白名单里。**认不出来的范围要明说**，
    // 不能静默按「今天」办 —— 用户要的是「这个月」，拿到一份只覆盖今天的
    // 摘要却写着「已记入日志」，那几条还会永久留在表里。
    const wanted = str(params, 'range');
    const range = resolveRange(wanted, Date.now(), posInt(params, 'days'));
    if (!DIGEST_RANGES.includes(range.key)) {
      return {
        summary:
          `群聊记录我一次最多读 ${MAX_DAYS} 天（群里消息量太大，读不完的部分会被丢掉，` +
          '而一份只覆盖了一小段的「本月总结」比没有更糟）。\n' +
          '试试「总结一下今天群里聊了什么」；要看整个项目的情况请说「复盘一下本月」——' +
          '那个读的是日志，没有这个限制。',
      };
    }
    if (range.key === 'recent_days') {
      const days = posInt(params, 'days') ?? 1;
      if (days > MAX_DAYS) {
        return {
          summary:
            `群聊记录我一次最多读 ${MAX_DAYS} 天（你说的是 ${days} 天）。\n` +
            `先「总结最近 ${MAX_DAYS} 天群里聊了什么」，更长的时间跨度请说「复盘一下」——` +
            '那个读的是日志，没有这个限制。',
        };
      }
    }

    // 读消息。这一步**会抛**（缺权限最常见），交给 dispatcher 的失败收口翻译成
    // 「缺哪个权限 + 一键申请链接」。降级成「今天没什么可记的」是在撒谎，
    // 而那句谎话看起来完全正常。
    const fetched = await fetchChatMessages(ctx.client, {
      chatId: ctx.chatId,
      startMs: range.startMs,
      endMs: range.endMs,
      botOpenId: ctx.botOpenId,
    });

    // 一条都没读到就不花 AI 额度。**要分清是哪一种没有** ——
    // 「群里没人说话」和「说了但全是图片/全是「收到」」处置不同：
    // 前者没什么好做的，后者用户可以自己补一句「记一下……」。
    if (!fetched.messages.length) {
      return {
        summary:
          `${range.label}**${project.name}** 群里没读到可以总结的文字消息。\n` +
          (skipLine(fetched.skipped) ||
            '（这段时间群里没有人发言。直接说「记一下……」也能手动记一条。）'),
        data: { project: project.name, range: range.label, item_count: 0 },
      };
    }

    const result = await digestChat({
      // 额度记在**绑这个飞书应用的平台账号**上（同复盘，见 diary.ts 的注释）。
      userId: getAppByAppId(ctx.appId)?.user_id ?? '',
      projectName: project.name,
      rangeLabel: range.label,
      messages: fetched.messages,
      skipped: fetched.skipped,
    });

    // 摘不出东西是**正常结果**，不是失败：群里聊了一天闲天很常见，
    // 而 digest.ts 的 prompt 是明确鼓励返回空数组的（宁可不记也不编）。
    // 这里必须把「读了多少条」说出来，否则和「没读到消息」那条分支同形。
    if (!result.items.length) {
      return {
        summary:
          `读了 ${result.usedCount} 条${range.label}的群消息，没挑出需要记进日志的内容` +
          `（决定、客户要求、进度、问题、钱和时间这类）。\n` +
          // 这一句在这条分支上同样要说：「没挑出东西」和「那天的正事全发在图片里」
          // 在用户看来是同一句话，而后者他还能自己补一条。
          [skipLine(fetched.skipped), '有该记的事直接说「记一下……」，我原样记下来。']
            .filter(Boolean)
            .join('\n'),
        data: { project: project.name, range: range.label, item_count: 0, read: result.usedCount },
      };
    }

    // 同一段时间的第几版。数在插入**之前** —— 插完再数永远至少是 1。
    // 键里带上窗口起点而不是 label：label 带中文说法，
    // 「今天（08-10）」和「最近 1 天（08-10 至 08-10）」是同一段时间。
    const digestRange = `${range.key}:${range.startMs ?? 0}`;
    const version = store.countDigests(project.id, digestRange) + 1;

    // 逐条落库。幂等键是 (message_id, step_index)，而这里一条指令要写 N 行，
    // step_index 已经被多步指令占用了 —— 所以用 `stepIndex * 100 + i` 错开。
    // 少了这一步，飞书重投这条指令时第 2..N 条会各自撞上第 1 条的键，
    // 被当成重复而丢掉：表里只剩一条，回帖却说「已记 5 条」。
    const base = (ctx.stepIndex ?? 0) * 100;
    const created: string[] = [];
    let duplicates = 0;
    for (const [i, item] of result.items.entries()) {
      // 标记写在正文里，不新增表格列：老项目的日志表没有这一列，
      // 而写一个表里不存在的字段名会让**整批**同步失败（见 migration 069）。
      const content = `【群聊摘要 ${range.label}】${item.text}`;
      const { created: isNew } = store.insertRecord({
        appId: ctx.appId,
        projectId: project.id,
        content,
        // source_text 留空：这条不是谁的原话，没有可对账的「当时怎么说的」。
        // 塞进 200 条群聊只会让日志表变成聊天记录的副本。
        sourceText: '',
        // 记录人是**发指令的人**，不是模型：这条摘要是他让助理生成的，
        // 出了问题该找他核对。写空的话人员字段整个省掉，表里那行没有记录人。
        authorOpenId: ctx.senderOpenId,
        authorName: ctx.senderName,
        messageId: ctx.messageId,
        stepIndex: base + i,
        origin: 'chat_digest',
        digestRange,
      });
      if (isNew) created.push(item.text);
      else duplicates += 1;
    }

    // 全是重投 = 这条指令已经办过了。不能谎称又记了几条。
    if (!created.length) {
      return {
        summary: `这次总结已经记过了（${project.name}，共 ${duplicates} 条）。`,
        data: { project: project.name, range: range.label, duplicate: true },
      };
    }

    const push = await bitable.pushRecords(ctx.client, project);

    const parts = [
      `📋 ${range.label}的群聊我读了 ${result.usedCount} 条，挑出 ${created.length} 条记进了 **${project.name}** 的日志：`,
      ...created.map((t, i) => `${i + 1}. ${t}`),
      '',
      // 「这是模型写的」必须说出来，而且要说在群里 —— 表里那行只有一个前缀，
      // 而群里这条回帖是当事人**唯一**会看的一眼。写错了当场就能纠正。
      '⚠️ 这几条是我根据群聊**归纳**的，不是谁的原话（日志表里带「群聊摘要」前缀）。' +
        '有归纳错的地方说一句，我按你说的原话再记一条。',
    ];
    if (version > 1) {
      // 不拦第二次，但要说清 —— 否则日志里会出现几条内容七成重合的摘要，
      // 而看表的人会以为群里真的把同一件事讨论了好几轮。
      parts.push(`（这已经是${range.label}的第 ${version} 份摘要，和之前那份可能有重复。）`);
    }
    const skips = skipLine(fetched.skipped);
    if (skips) parts.push(skips);
    if (fetched.truncated) {
      // 截断必须说出来。少了这句，「上午定的事没进日志」会被当成模型漏了，
      // 而实际是那些消息根本没读进来。
      parts.push(`⚠️ 这段时间消息太多，我只读了**最近的**那批，更早的没读进来。`);
    }
    if (result.droppedCount > 0) {
      parts.push(`（读到的消息里只有最近 ${result.usedCount} 条参与了归纳。）`);
    }
    if (push.warning) parts.push(push.warning);
    else if (project.url) parts.push(`[日志表](${project.url})`);

    return {
      summary: parts.join('\n'),
      data: {
        project: project.name,
        range: range.label,
        item_count: created.length,
        read: result.usedCount,
        origin: 'chat_digest',
        ...(duplicates ? { duplicate_items: duplicates } : {}),
        ...(fetched.truncated ? { truncated: true } : {}),
      },
    };
  },
};

/**
 * 「跳过了什么」那一句。
 *
 * 分类说而不是给一个总数：处置完全不同 —— 图片多说明该发文字的人发了图，
 * 撤回多说明那段对话本来就不算，而 command 多只是说明大家在跟助理说话。
 * 全是 0 时返回空串（调用方据此决定说不说）。
 */
function skipLine(s: {
  nonText: number;
  recalled: number;
  bot: number;
  command: number;
  trivial: number;
}): string {
  const bits: string[] = [];
  if (s.nonText) bits.push(`${s.nonText} 条图片/文件等非文字消息`);
  if (s.recalled) bits.push(`${s.recalled} 条已撤回`);
  if (s.command) bits.push(`${s.command} 条 @ 我的指令`);
  if (s.bot) bits.push(`${s.bot} 条机器人消息`);
  if (s.trivial) bits.push(`${s.trivial} 条「收到」「好的」这类`);
  if (!bits.length) return '';
  return `（跳过了 ${bits.join('、')}。）`;
}
