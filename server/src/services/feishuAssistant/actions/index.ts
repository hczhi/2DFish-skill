import type { ActionDef } from './types.js';
import { replyAction } from './reply.js';
import { createTaskAction } from './createTask.js';
import { updateTaskAction } from './updateTask.js';
import { listTasksAction } from './listTasks.js';
import {
  createDiaryProjectAction,
  renameDiaryProjectAction,
  listDiaryProjectsAction,
  addDiaryRecordAction,
  reviewDiaryAction,
} from './diary.js';
import { digestChatAction } from './chatDigest.js';
import { DIRECTORY_SCOPES } from '../directory/sync.js';
import { CHAT_HISTORY_SCOPES } from '../diary/chatHistory.js';

// 动作注册表。
//
// 加一个飞书小功能只需两步：写 actions/xxx.ts、在下面数组里加一项。
// 意图解析的 prompt 由本表自动生成（intent.ts），调度逻辑、日志、回帖都不用碰。
//
// ── 范围：这是**项目群助理**，不是通用飞书机器人 ──
// 曾经还有建日程/改日程/删日程/查忙闲/给同事发私聊消息五个动作，已经删掉。
// 删的理由不是"用得少"，而是它们**不属于项目群**这个场景，而留着它们要付两笔代价：
//   1. 动作清单原样进 prompt，每多一个语义相邻的动作就多一处误选面 ——
//      「给张三派个任务，明天开始」在有 create_calendar_event 的年代会被拆成
//      建任务 + 建日程两步，而用户只想要一条任务；
//   2. 它们独有的权限点（calendar:calendar.event:create/update/delete、
//      calendar:calendar.free_busy:read）是接入时最容易卡住的几项，
//      而它们支撑的能力在项目群里没人用 —— 让用户为用不到的功能去开一批权限，
//      是把绑定流程里最容易失败的一步无谓地加长。
// 要日程和私聊消息的话，飞书自己的机器人和日历就是干这个的，不必由本助理代劳。
//
// ── 顺序是**功能**，不是排版 ──
// 这个数组的顺序原样进 prompt 的「可用动作」清单，而模型是顺着读的：
// 先撞上一个说得通的就选了。所以两条规则：
//   1. 「建」和它的「改/删」相邻 —— create_task 和 update_task 隔得远，
//      「标记完成」会误选 create。
//   2. **语义上容易串味的两组要拉开，并且把"用户更常想要的那个"排在前面。**
//      项目日记原先排在最后（第 9-12 位），而 create_task 在第 3 位，
//      于是「添加新项目，XX 纪录片」一路撞到 create_task 上就停了 ——
//      回帖「✅ 任务已创建」，看着像成功了，用户要的那张日志表根本没建。
//      现在项目日记整块排在任务**之前**：说「项目」的人先撞上
//      create_diary_project。语义上的排除在 intent.ts 的 PROJECT_VS_TASK_RULE，
//      两者缺一个都还会串（位置只改变"先看到谁"，规则才说明"为什么不是那个"）。
export const ACTIONS: ActionDef[] = [
  replyAction,
  // 项目日记 —— 本模块的主用途。这几个必须**挨在一起**（理由同规则 1），
  // 而整块排在任务**之前**（理由同规则 2 —— 这也是误选的重灾区）。
  createDiaryProjectAction,
  // 「改名」紧跟着「建」（规则 1：建和它的改/删相邻）。一个群只能有一个项目，
  // 所以「项目改名叫 X」和「新建项目 X」在群里是同一件事的两种说法 ——
  // 隔远了的表现是改名被选成 create_diary_project，回一句
  // 「这个群已经是项目 Y 了」，而用户要的正是把 Y 改掉。
  renameDiaryProjectAction,
  // 紧跟着「建」放「列」：这两个是同一件事的两半（建完给链接、事后找回链接），
  // 而多维表格不在任何人的云文档空间里、链接分享也是关掉的，
  // 所以「问回来」是唯一的找回途径。
  listDiaryProjectsAction,
  addDiaryRecordAction,
  reviewDiaryAction,
  // 「总结群聊」紧跟着复盘：这两个是这一块里唯一容易串味的一对
  //（都是"总结"，但一个读群聊原话、一个读已落库的日志），而串了之后
  // 用户拿到的东西是反的 —— 他要助理去读群聊，收到的是一份基于日志的总结，
  // 而群里的事本来就没人手动记过，于是那份总结是空的。
  // 复盘排在前面：「总结一下」这句话绝大多数时候要的是复盘。
  // 语义上的排除写在两个动作**各自**的 description 里（同 PROJECT_VS_TASK_RULE
  // 那对：位置只改变"先看到谁"，规则才说明"为什么不是那个"）。
  digestChatAction,
  createTaskAction,
  updateTaskAction,
  // 「看任务」排在建/改**后面**（规则 1 说的是建和它的改/删相邻，不含"看"），
  // 而且必须在 review_diary 后面隔着几个 —— 「进度怎么样」两个都说得通，
  // 而绝大多数时候用户问的是复盘。反过来排的表现是问「复盘一下」拿到一份
  // 任务清单，而回帖看着完全正常。
  listTasksAction,
];

export function getAction(name: string): ActionDef | undefined {
  return ACTIONS.find((a) => a.name === name);
}

/**
 * 声明在动作上、但**不列进「必需权限」**的权限点。
 *
 * 目前只有读群聊记录那两项（digest_chat 用）。理由和当年删掉五个日程动作的
 * 第二条一样：`im:message.group_msg`（获取群组中所有消息）在飞书后台要额外
 * 说明用途，是最难批的一档，而「总结群聊」是一个可选功能 ——
 * 把它写进「绑定前请先开通」会让**每个人**的接入流程都卡在这里。
 *
 * 代价是第一次用这个功能会失败。这个代价是可接受的，因为失败信息是
 * feishuError.ts 翻译过的「缺哪个权限 + 一键申请链接」，而不是一句空白。
 * 权限点仍然声明在动作上（不是删掉），这样后台能把它们作为**可选权限**
 * 单独列出来并说明「开了才能用哪个功能」，见 GET /capabilities 的 optional_scopes。
 */
const OPTIONAL_SCOPES = new Set(CHAT_HISTORY_SCOPES);

/**
 * 可选权限点 → 开了它才能用的功能说明。后台照这个渲染「可选权限」那一段。
 *
 * 做成一份显式清单而不是「凡是不在必需里的就是可选」：后者在新增动作时会
 * 静默把一项必需权限降级成可选，而表现是那个动作**在所有人那里**都缺权限，
 * 却没人被提示要去开。
 */
export function optionalScopeGroups(): Array<{ scopes: string[]; feature: string }> {
  return [
    {
      scopes: [...CHAT_HISTORY_SCOPES],
      feature:
        '总结群聊（「总结一下今天群里聊了什么」）。不开也能用其余全部功能 —— ' +
        '只是助理读不到没有 @ 它的消息。',
    },
  ];
}

/**
 * 「我目前会：……」那份清单，给用户看的（dispatcher 的兜底话术用）。
 *
 * 从注册表生成而不是手写，因为手写的那份**必然会过期**：日程/私聊发消息删掉之后，
 * 兜底话术还在推销它们，用户照着说一句，换回来的是同一句「没太听懂」——
 * 一条自相矛盾的回复。而没有任何测试会失败，因为那只是一个字符串。
 * 见 ActionDef.hint。
 */
export function capabilityHints(): string[] {
  return ACTIONS.map((a) => a.hint).filter((h): h is string => !!h);
}

/**
 * 「绑定这个应用前请先开通这些权限」的清单。
 *
 * 一个动作声明的权限点**不一定都进这份清单**：见下面 OPTIONAL_SCOPES ——
 * 这份清单是接入流程里最容易卡住的一步，为一个大部分人用不到的功能
 * 把它加长，代价由所有人承担。
 */
export function allRequiredScopes(): string[] {
  const set = new Set<string>();
  for (const a of ACTIONS) {
    for (const s of a.scopes) if (!OPTIONAL_SCOPES.has(s)) set.add(s);
  }
  // 收事件本身需要的权限点：群里被 @ 的消息。不属于任何单个动作，但一个都不能少。
  set.add('im:message.group_at_msg:readonly');
  // 私聊消息的读权限仍然要开：助理只在群聊里干活，但私聊进来时要能**回一句**
  // 「请到群里 @ 我」（见 dispatcher 的 P2P_ONLY_GROUP_REPLY）。不开它的话
  // 私聊变成静默不响应 —— 而"没反应"和"助理坏了"完全同形。
  set.add('im:message.p2p_msg:readonly');
  // 回帖本身。以前这一项由 send_message 动作带进来，那个动作删掉之后
  // 它成了没有主人的必需权限 —— 少了它助理什么都回不了，表现是全模块静默。
  set.add('im:message:send_as_bot');
  // 「收到了」那个表情（dispatcher 的 ack）。列出来是因为不开它会在服务端日志里
  // 刷一片 99991672，而用户侧只是少了个表情 —— 光看现象猜不到缺哪一项。
  set.add('im:message.reaction:write');
  // 名册同步用的权限。同样不属于任何单个动作，但少了它「没 @ 到的人也能被指名」
  // 就不成立（派任务时最常撞到）。
  for (const s of DIRECTORY_SCOPES) set.add(s);
  // 机器人被拉进群时查群名（connection.ts 的 botAdded）。DIRECTORY_SCOPES 里
  // 本来就有 im:chat:readonly（名册兜底路要用），这里不用重复添加。
  return [...set].sort();
}

export type { ActionDef, ActionContext, ActionResult } from './types.js';
