import { type ActionDef, type ActionContext, requireStr, str, posInt } from './types.js';
import * as store from '../diary/store.js';
import * as bitable from '../diary/bitable.js';
import * as taskBase from '../diary/taskBase.js';
import * as crossLinks from '../diary/crossLinks.js';
import { resolveRange, RANGE_KEYS } from '../diary/range.js';
import { summarizeRecords, forReply } from '../diary/summarize.js';
import { getAppByAppId } from '../appStore.js';
import { listChats } from '../chatStore.js';

// 项目日记的三个动作：建项目 / 记一条 / 复盘。
//
// 曾经还有一套 aily 智能体版（migration 064 播的 group-assistant 技能，
// 脚本只打印「Agent 接下来该建表了」，真正调接口的是 aily 那侧）。
// 已经删掉：两套并存的实际后果是同一个群里两个东西都在记，项目名一样、
// 内容不一样，而任何一侧都不知道对方存在。这里是唯一的实现。
//
// ── 三条贯穿本文件的规则 ──
// 1. **id 不进 prompt。** 参数里没有 chat_id / app_token / record_id 这类东西 ——
//    chat_id 来自事件本身，其余全部由 project 反查。模型编一个 oc_xxx 出来的后果
//    不是报错，是记录进了别的项目，而回帖说「已记录」。
// 2. **记录原文不改写。** content 是从用户这句话里摘出来的（摘这一步由意图解析的
//    LLM 做），但摘完不润色、不摘要。日志的价值就在「当时到底怎么说的」。
//    原文也一并存进 source_text，摘歪了以后还能对账。
// 3. **DB 先落地，飞书表格后同步。** 表格是镜像，写失败只回一句「还没同步，
//    下次会补推」，不让整条指令失败 —— 那会让用户再说一遍，最后表里两条。

/** 一条记录的正文上限。超长的多半是把整段会议记录都塞进来了，截断并说明。 */
const MAX_CONTENT_CHARS = 2000;

export const createDiaryProjectAction: ActionDef = {
  name: 'create_diary_project',
  description:
    '在**本群**新建一个项目，并给它建一张专属的项目日志多维表格。' +
    '一个群只能有一个项目 —— 以后在这个群里说「记一下……」就会记到这个项目名下。' +
    '用户话里出现「项目」两个字并且是要**开一个新的**时就用这个动作：' +
    '「新建项目 / 建个项目 / 添加项目 / 添加新项目 / 创建项目 / 新增项目 / 开个项目 / 立项」' +
    '都算，说法不限于这几种。\n' +
    '**这不是建任务。** 「项目」是长期的、一个群一张日志表；任务是一条一次性的待办。' +
    '用户说「项目」时绝对不要选 create_task 或 update_task —— ' +
    '那会回一句「任务已创建」，而他要的日志表根本没建出来。',
  params: {
    name:
      '必填。项目名称，原样用用户说的那几个字，不要自己加「项目」二字、不要翻译。' +
      '用户说「添加新项目，XX 纪录片」时，name 就是「XX 纪录片」。',
  },
  examples: [
    '新建项目：印度纪录片',
    '添加新项目，8月飞书skill开发',
    '创建项目 春节品牌片',
    '建个项目叫客户A改版',
    '这个群立个项目，叫年度品牌规划',
    '新增一个项目：纪录片二期',
  ],
  hint: '在本群立一个项目，并建一张专属的项目日志表（「新建项目：印度纪录片」）',
  // bitable:app 建表 + 写记录；drive:drive 收链接分享 + 把表授权给群。
  // 少了 drive:drive 的表现是表建出来了但群里谁都打不开。
  scopes: ['bitable:app', 'drive:drive'],
  async run(params: Record<string, unknown>, ctx: ActionContext) {
    const name = requireStr(params, 'name', '项目名称');

    // 私聊里建不了：项目的身份就是那个群（chat_id 是 UNIQUE 键的一半），
    // 而私聊没有可绑的群。把它绑到私聊会话上的话，「以后在群里记一下」这件事
    // 从一开始就不成立。
    //
    // dispatcher 现在就把私聊整体挡掉了，正常走不到这个分支。留着是因为它是
    // 这个动作**自己的**前提（chat_id 必须是群），而不是调度层的策略 ——
    // 哪天私聊策略又变了，这里不该跟着变成一个静默写坏数据的口子。
    if (ctx.chatType !== 'group') {
      return {
        summary:
          '项目要建在**群里**：项目是跟群绑定的，以后群里说「记一下……」才知道记到哪个项目。\n' +
          '请把我拉进那个项目群，在群里 @ 我说「新建项目：XXX」。',
      };
    }

    const chatName = listChats(ctx.appId).find((c) => c.chat_id === ctx.chatId)?.name ?? '';

    // 先占位。建表要好几个来回，期间同群第二个人再说一次「新建项目」时，
    // 没有这道闸就会建出第二套多维表格，而库里只留得下一行 ——
    // 另一套成了没人知道存在的孤儿表（还带着群成员的可见权限）。
    let project;
    try {
      project = store.claimProject({
        appId: ctx.appId,
        chatId: ctx.chatId,
        chatName,
        name,
        createdBy: ctx.senderOpenId,
        createdByName: ctx.senderName,
      });
    } catch (e) {
      if (e instanceof store.ProjectConflictError) {
        // 撞的是哪一条要分开说：解法不同（去那个群里记 / 换个名字）。
        if (e.reason === 'chat') {
          // 链接要带上：说「新建项目」的人有一半其实是在找那张表的地址
          // （消息被刷走了），而这条回帖是他最可能撞到的地方。
          const url = e.existing.url ? `\n[日志表](${e.existing.url})` : '';
          return {
            summary:
              `这个群已经是项目 **${e.existing.name}** 了，一个群只能对应一个项目。\n` +
              `直接说「记一下……」就会记到它名下。要开新项目请另建一个群。${url}`,
          };
        }
        return {
          summary:
            `已经有一个叫 **${e.existing.name}** 的项目了（在另一个群里），换个名字吧 —— ` +
            `重名的话以后「记到 XXX」就分不出是哪一个。`,
        };
      }
      throw e;
    }

    // 项目总表：第一次建项目时顺手建出来，没有「请先初始化」这一步。
    const warnings: string[] = [];
    try {
      const idx = await bitable.ensureIndex(ctx.client, ctx.appId, ctx.senderOpenId);
      if (idx.warning) warnings.push(idx.warning);
    } catch (e) {
      // 总表建不出来不该拦住项目本身：项目日志表是用户真正要的东西，
      // 总表只是索引，下次建项目时会再试一次。
      warnings.push('（项目总表这次没建成，不影响本项目使用，下次建项目时会再试。）');
      console.error('[diary] 建项目总表失败:', (e as Error).message);
    }

    // 项目自己的日志表。**这一步失败要回滚占位行** ——
    // 不回滚的话这个群就永远卡在「有项目但没有表」：UNIQUE 挡着，
    // 用户重说一遍只会收到「这个群已经是项目 X 了」。
    let url = '';
    try {
      const created = await bitable.createProjectBitable(ctx.client, project);
      url = created.url;
      if (created.warning) warnings.push(created.warning);
    } catch (e) {
      store.dropProject(project.id);
      throw e;
    }

    // 任务 base（070）。**独立一个 base**，因为它要开放给群成员编辑，
    // 而日志表必须只读 —— 文档权限的粒度是 base 不是表。
    //
    // 失败**不回滚**、只带一句 warning：日志表已经建好了，而它是「项目」这个
    // 概念的本体。抛出去会把已经建好的日志 base 变成孤儿，而用户重说一遍
    // 只会撞上「这个群已经是项目 X 了」—— 一个我们自己造成的死结。
    // 补建的时机是第一次派活（taskBase.ensureTaskBase）。
    let taskUrl = '';
    try {
      const created = await taskBase.createTaskBase(ctx.client, store.getProjectById(project.id)!);
      taskUrl = created.url;
      if (created.warning) warnings.push(created.warning);
    } catch (e) {
      warnings.push(
        `⚠️ 任务表这次没建成（${(e as Error).message}），日志功能不受影响，` +
          `第一次派任务时我会再建一次。`
      );
      console.error('[task] 建任务 base 失败:', (e as Error).message);
    }

    // 两个 base 之间的互跳入口（074）：日记 base 里一张指向任务表的「🔗 相关链接」，
    // 任务 base 里一张指向日志表的。群消息一刷走，用户手上有哪张表就只剩哪张。
    let fresh = store.getProjectById(project.id)!;
    try {
      const linked = await crossLinks.ensureLinkTables(ctx.client, fresh);
      if (linked.warning) warnings.push(linked.warning);
      fresh = linked.project;
    } catch (e) {
      console.error('[diary] 建相关链接表失败:', (e as Error).message);
    }

    // 总表那一列「任务表」要在 addToIndex **之前**补出来：老总表（074 之前建的）
    // 没有这一列，而 record.create 遇到不认识的列名是整行失败 ——
    // 于是新项目压根没进总表，而回帖里只有一句「总表这次没更新」。
    try {
      const entry = await crossLinks.ensureIndexTaskEntry(ctx.client, ctx.appId);
      if (entry) warnings.push(entry);
    } catch (e) {
      console.error('[diary] 补总表任务表列失败:', (e as Error).message);
    }

    const idx = await bitable.addToIndex(ctx.client, fresh);
    if (idx.warning) warnings.push(idx.warning);

    // 总表链接也要给出来。它是全公司的项目清单，而这些多维表格**不在任何人的
    // 云文档空间里**（建表时没传 folder_token，表归机器人身份所有），链接分享
    // 又是关掉的 —— 所以链接是唯一的入口。不在这里给的话，用户手上就只有
    // 本项目那张表，而那张全局的表谁都找不到。
    // 找回的路径另有 list_diary_projects（「有哪些项目」），因为群消息会被刷走。
    const indexUrl = store.getIndex(ctx.appId)?.url ?? '';

    const parts = [
      `✅ 项目 **${name}** 已建好。`,
      `以后在本群 @ 我说「记一下……」就会记到这个项目的日志表里；说「复盘一下」我来总结。`,
      url ? `[项目日志表](${url})` : '',
      taskUrl ? `[任务管理表](${taskUrl})（**可以直接编辑**）` : '',
      indexUrl ? `[项目总表](${indexUrl})（全公司的项目清单，只有你能打开）` : '',
      // 两张表的权限**刻意相反**，而这件事必须现在说清楚：
      // 用户第一反应会是去日志表里手动加一行，发现改不了才回来问；
      // 反过来，他也不会想到任务表可以随手改（而那正是这张表的用法）。
      '日志表对本群**只读**（日志只能 @ 我来记，这样每条都有记录人和时间，也不会被误删）；\n' +
        '任务表对本群**可编辑** —— 进展、负责人、日期你们直接在表里改就行，我读的就是这张表。',
      // 链接会被刷走，而这两张表没有别的入口，所以必须告诉用户怎么问回来。
      '（两张表的 tab 栏上各有一个「🔗 相关链接」，可以互相跳；链接都找不到了就 @ 我说「有哪些项目」。）',
    ].filter(Boolean);
    if (warnings.length) parts.push(`\n${warnings.join('\n')}`);

    return {
      summary: parts.join('\n'),
      data: {
        // 存项目名而不是 id：日志详情页给人看，而 UUID 对人没有意义。
        // 后续动作靠 chat_id 找项目，不需要从日志里反查 —— 所以这里不存 id。
        project: name,
        url,
      },
    };
  },
};

export const renameDiaryProjectAction: ActionDef = {
  name: 'rename_diary_project',
  description:
    '给**本群**的项目改名字。项目名是建的时候一句话说定的，打错字、后来正式定名' +
    '换了说法都很常见 —— 用户说「项目改名叫 XXX」「项目名写错了，应该是 XXX」' +
    '「把项目名改成 XXX」时用这个动作。\n' +
    // 这一句和 create 那边是一对：一个群只能有一个项目，所以「换个名字」
    // 和「开个新项目」在群里是同一件事的两种说法，模型必须分清。
    '注意：这只改**名字**，项目、日志表、已记的内容全都不动。' +
    '用户要的是在这个群开一个**全新的**项目时，那是 create_diary_project（但一个群只能有一个）；' +
    '改的是某个**任务**的标题时，那是 update_task。',
  params: {
    name:
      '必填。新的项目名称，原样用用户说的那几个字，不要自己加「项目」二字、不要翻译。' +
      '用户说「项目改名叫印度纪录片二期」时，name 就是「印度纪录片二期」。',
  },
  examples: [
    '项目改名叫印度纪录片二期',
    '项目名写错了，应该是 8月飞书skill开发',
    '把本群项目名改成年度品牌规划',
  ],
  hint: '给本群项目改个名字（「项目改名叫印度纪录片二期」）',
  // 只改总表里那一行，不建表。
  scopes: ['bitable:app'],
  async run(params: Record<string, unknown>, ctx: ActionContext) {
    const name = requireStr(params, 'name', '新的项目名称');

    // 只能在群里改，理由和建项目一样：项目的身份就是那个群。
    const found = resolveProject(params, ctx);
    if ('message' in found) return { summary: found.message };
    const project = found.project;

    if (project.name === name.trim()) {
      // 同名不算失败，但也不能回「已改名」—— 那会让用户以为刚才那次没生效、
      // 再说一遍。说清「本来就叫这个」才是他需要的信息。
      return {
        summary: `本群项目本来就叫 **${project.name}**，没改动。`,
        data: { project: project.name, unchanged: true },
      };
    }

    let renamed;
    try {
      renamed = store.renameProject(project.id, name);
    } catch (e) {
      if (e instanceof store.ProjectConflictError) {
        return {
          summary:
            `已经有一个叫 **${e.existing.name}** 的项目了（在另一个群里），换个名字吧 —— ` +
            '重名的话以后「记到 XXX」就分不出是哪一个。',
        };
      }
      throw e;
    }

    // 总表那侧刷失败只是一句 warning：库里的名字才是数据源。
    const warning = await bitable.renameInIndex(ctx.client, renamed);

    const parts = [
      `✅ 项目已改名：**${project.name}** → **${renamed.name}**`,
      // 说清什么没变，否则用户会担心之前记的东西跟丢了。
      '已记的日志、任务、复盘都还在原处，链接也没变。',
    ];
    if (renamed.url) parts.push(`[项目日志表](${renamed.url})`);
    if (warning) parts.push(warning);

    return {
      summary: parts.join('\n'),
      data: { project: renamed.name, previous_name: project.name },
    };
  },
};

export const listDiaryProjectsAction: ActionDef = {
  name: 'list_diary_projects',
  description:
    '列出这家公司**所有**的项目日记项目，连同项目总表和各自日志表的链接。' +
    '用户说「有哪些项目」「项目列表」「项目总表在哪」「日志表链接发一下」这类话时用它。' +
    '注意：这个动作只回「有哪些项目、表在哪」，**不看日志内容** ——' +
    '问「这周干了什么」是 review_diary。',
  params: {},
  examples: [
    '有哪些项目',
    '项目列表',
    '项目总表的链接发一下',
    '本群的日志表在哪',
  ],
  hint: '列出所有项目和表格链接（「有哪些项目」）',
  // 需要建总表的权限：如果一个项目都还没建过，总表也还不存在。
  scopes: ['bitable:app', 'drive:drive'],
  async run(_params: Record<string, unknown>, ctx: ActionContext) {
    const projects = store.listProjects(ctx.appId);
    if (!projects.length) {
      return {
        summary:
          '还没有任何项目。项目要建在群里 —— 把我拉进项目群，在群里说「新建项目：XXX」。',
        data: { count: 0 },
      };
    }

    // 总表链接是这个动作存在的**主要理由**：它只在建第一个项目时出现过一次回帖里，
    // 而群消息会被刷走。刷走之后没有任何其他途径能拿到它（链接分享是关掉的，
    // 表也不在任何人的云文档空间里），于是那张全公司的项目清单事实上找不回来。
    const index = store.getIndex(ctx.appId);

    const lines = projects.map((p) => {
      const n = store.countRecords(p.id);
      const link = p.url ? ` [日志表](${p.url})` : '（日志表缺失）';
      // 标出「就是本群那个」：一屏项目名里认出自己在哪个群，靠名字是要费一秒的。
      const here = ctx.chatType === 'group' && p.chat_id === ctx.chatId ? '（本群）' : '';
      return `· **${p.name}**${here} — ${n} 条${link}`;
    });

    const parts: string[] = [];
    if (index?.url) parts.push(`📊 [项目总表](${index.url})`);
    parts.push(`\n共 ${projects.length} 个项目：`, lines.join('\n'));
    // 打不开总表不是 bug，得先说清楚，否则用户会以为链接坏了。
    if (index?.url) {
      parts.push('\n（项目总表只有建项目的人能打开；各项目的日志表对应群里的人都能看。）');
    }

    return {
      summary: parts.join('\n'),
      data: { count: projects.length, index_url: index?.url ?? '' },
    };
  },
};

export const addDiaryRecordAction: ActionDef = {
  name: 'add_diary_record',
  description:
    '往**本群对应项目**的日志里记一条。这是「写日志」，不是建任务、不设提醒、不通知任何人 ——' +
    '用户说「记一下」「记录一下」「写进日志」这类话时用它。' +
    '注意：如果用户是要一件**待办**（「提醒我」「派给谁」「几点前要做完」），那是 create_task，不是这个。',
  params: {
    content:
      '必填。要记的内容。**原样照抄用户说的话**，只去掉「记一下」「记录一下」这类指令前缀，' +
      '其余一个字都不要改、不要润色、不要摘要、不要补主语。' +
      '日志的价值就在于当时是怎么说的。',
    project:
      '可选。项目名称。**在群里说话时一律留空**（记到本群的项目）。' +
      '只有在私聊里、用户明确说了「记到 XXX 项目」时才填那个项目名。',
  },
  examples: [
    '记一下：今天和导演对了分镜，第三场要重拍',
    '记录一下，客户说预算追加 20 万，但要提前一周交片',
    '写进日志：设备明天到，摄影组周三进场',
  ],
  hint: '往本群项目的日志里记一条（「记一下：客户要把 logo 改大」）',
  scopes: ['bitable:app'],
  async run(params: Record<string, unknown>, ctx: ActionContext) {
    const raw = requireStr(params, 'content', '要记录的内容');
    const content =
      raw.length > MAX_CONTENT_CHARS
        ? `${raw.slice(0, MAX_CONTENT_CHARS)}…（原文过长，已截断）`
        : raw;

    const found = resolveProject(params, ctx);
    if ('message' in found) return { summary: found.message };
    const project = found.project;

    const { row, created } = store.insertRecord({
      appId: ctx.appId,
      projectId: project.id,
      content,
      sourceText: raw,
      authorOpenId: ctx.senderOpenId,
      authorName: ctx.senderName,
      messageId: ctx.messageId,
      stepIndex: ctx.stepIndex ?? 0,
    });

    // 重放（飞书事件是 at-least-once）：不再写第二条，也不谎称新记了一条。
    if (!created) {
      return {
        summary: `这条已经记过了（${project.name}）。`,
        data: { project: project.name, duplicate: true },
      };
    }

    // 同步失败只是 warning：记录已经在库里了，下一条记录进来会连它一起补推。
    const push = await bitable.pushRecords(ctx.client, project);

    const parts = [`📝 已记到 **${project.name}**：${content}`];
    if (push.warning) parts.push(push.warning);
    else if (project.url) parts.push(`[日志表](${project.url})`);

    return {
      summary: parts.join('\n'),
      data: { project: project.name, record_id: row.id, synced: !push.warning },
    };
  },
};

export const reviewDiaryAction: ActionDef = {
  name: 'review_diary',
  description:
    '把**本群对应项目**在某段时间内的日志取出来，让 AI 归纳成一份复盘，发在群里。' +
    '用户说「复盘」「总结一下」「这周干了什么」这类话时用它。',
  params: {
    range:
      `可选。时间范围，只能是这几个值之一：${RANGE_KEYS.join(' / ')}。` +
      '（today=今天，yesterday=昨天，this_week=本周，last_week=上周，this_month=本月，' +
      'recent_days=最近N天，all=全部）。用户没说时间就填 today。' +
      '**不要输出具体日期或时间戳**，只填这几个词，具体范围由系统计算。',
    days: '可选。仅当 range 是 recent_days 时填，表示最近多少天（正整数）。',
    project:
      '可选。项目名称。**在群里说话时一律留空**（复盘本群的项目）。' +
      '只有在私聊里、用户明确说了某个项目名时才填。',
  },
  examples: [
    '复盘一下',
    '总结下本周的情况',
    '最近 10 天这个项目干了什么',
    '上周的复盘发一下',
  ],
  hint: '按时间范围复盘本群项目（「复盘一下本周」「最近 10 天干了什么」）',
  scopes: ['bitable:app'],
  async run(params: Record<string, unknown>, ctx: ActionContext) {
    const found = resolveProject(params, ctx);
    if ('message' in found) return { summary: found.message };
    const project = found.project;

    // 范围由代码算，模型只给一个枚举值。让它直接给起止时间的后果不是报错 ——
    // 是生成一份写着「本周」、实际取了上周记录的复盘。见 diary/range.ts。
    const range = resolveRange(str(params, 'range'), Date.now(), posInt(params, 'days'));
    const records = store.listRecords(project.id, {
      startMs: range.startMs,
      endMs: range.endMs,
    });

    // 空范围不调 LLM：那会白花一次额度，换回一段「本周没有明显进展」——
    // 而事实是**没人记录**，两件事完全不同。
    if (!records.length) {
      const total = store.countRecords(project.id);
      return {
        summary:
          `**${project.name}** 在${range.label}没有任何记录，所以没什么可复盘的。\n` +
          (total > 0
            ? `这个项目一共有 ${total} 条记录，换个时间范围试试（比如「上周的复盘」「全部复盘」）。`
            : '在群里 @ 我说「记一下……」就能开始记日志。'),
        data: { project: project.name, range: range.label, record_count: 0 },
      };
    }

    const result = await summarizeRecords({
      // 额度记在**绑这个飞书应用的平台账号**上（飞书里说话的人通常没有平台账号）。
      // 应用行取不到时退回 senderOpenId 只会让配额查询查不到人 —— 但那种情况下
      // dispatcher 本来也走不到这里，所以只做类型上的兜底。
      // 注意查的是 getAppByAppId：ctx.appId 是飞书那个 `cli_xxx`，
      // 不是 feishu_apps 表的行 id。用 getApp 会一律查不到，于是额度记到空账号上。
      userId: getAppByAppId(ctx.appId)?.user_id ?? '',
      projectName: project.name,
      rangeLabel: range.label,
      records,
    });

    const summary = store.insertSummary({
      appId: ctx.appId,
      projectId: project.id,
      rangeLabel: range.label,
      rangeStartMs: range.startMs,
      rangeEndMs: range.endMs,
      recordCount: result.usedCount,
      summary: result.markdown,
      createdBy: ctx.senderOpenId,
      createdByName: ctx.senderName,
    });

    // 存进「复盘」表：群消息会被刷走，而这段总结是这个功能真正的产出。
    const warning = await bitable.pushSummary(ctx.client, project, summary);

    const reply = forReply(result.markdown, warning ? '' : bitable.reviewTableUrl(project));
    return {
      summary: warning ? `${reply}\n\n${warning}` : reply,
      data: {
        project: project.name,
        range: range.label,
        record_count: result.usedCount,
        ...(result.droppedCount ? { dropped_records: result.droppedCount } : {}),
      },
    };
  },
};

/**
 * 「记到哪个项目」。
 *
 * 群里 = 本群那个项目，**不看 project 参数**：群的 chat_id 是事件带来的事实，
 * 而 project 参数是模型填的。让参数能覆盖它意味着一句「记一下，跟上次那个项目一样」
 * 就可能把记录写进另一个群的项目里 —— 而那个群的人根本不知道。
 *
 * 下面那半段（按项目名找）现在正常走不到：助理只在群聊里工作，dispatcher 已经
 * 把私聊挡在外面了。保留它的理由和上面 create 里那道 chatType 闸一样 ——
 * 它是这个动作自己的兜底，而不是调度层策略的复述。
 * 按名字找时**精确匹配**（见 store.findProjectByName），找不到就把项目列表
 * 给出来，不猜。
 */
function resolveProject(
  params: Record<string, unknown>,
  ctx: ActionContext
): { project: store.DiaryProjectRow } | { message: string } {
  if (ctx.chatType === 'group') {
    const project = store.getProjectByChat(ctx.appId, ctx.chatId);
    if (project) return { project };
    return {
      message:
        '这个群还没有对应的项目，所以不知道该记到哪儿。\n' +
        '先说一句「新建项目：XXX」我就把项目和日志表建起来。',
    };
  }

  const wanted = str(params, 'project');
  const all = store.listProjects(ctx.appId);
  if (!all.length) {
    return {
      message:
        '还没有任何项目。项目要建在群里 —— 把我拉进项目群，在群里说「新建项目：XXX」。',
    };
  }
  if (!wanted) {
    return {
      message:
        '私聊里我不知道你说的是哪个项目，请带上项目名（比如「记到印度纪录片：……」）。\n' +
        `目前有这些项目：${all.map((p) => p.name).join('、')}`,
    };
  }
  const project = store.findProjectByName(ctx.appId, wanted);
  if (!project) {
    // 不做模糊匹配：「印度纪录片」和「印度纪录片II」互相包含，猜错的表现是
    // 记录进了另一个项目而回帖说「已记录」。列出来让用户自己挑。
    return {
      message:
        `没有叫「${wanted}」的项目（名字要完全一致）。\n` +
        `目前有这些：${all.map((p) => p.name).join('、')}`,
    };
  }
  return { project };
}
