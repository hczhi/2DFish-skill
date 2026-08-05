import type { ActionDef } from './types.js';
import { replyAction } from './reply.js';
import { sendMessageAction } from './sendMessage.js';
import { createTaskAction } from './createTask.js';
import { updateTaskAction } from './updateTask.js';
import { createCalendarEventAction } from './createCalendarEvent.js';
import {
  updateCalendarEventAction,
  deleteCalendarEventAction,
} from './updateCalendarEvent.js';
import { queryFreebusyAction } from './queryFreebusy.js';
import { DIRECTORY_SCOPES } from '../directory/sync.js';

// 动作注册表。
//
// 加一个飞书小功能只需两步：写 actions/xxx.ts、在下面数组里加一项。
// 意图解析的 prompt 由本表自动生成（intent.ts），调度逻辑、日志、回帖都不用碰。
// 顺序会进 prompt，所以让「建」和它的「改/删」相邻 —— 模型选动作时是顺着读的，
// create_task 和 update_task 隔得远会更容易在「标记完成」上误选 create。
export const ACTIONS: ActionDef[] = [
  replyAction,
  sendMessageAction,
  createTaskAction,
  updateTaskAction,
  createCalendarEventAction,
  updateCalendarEventAction,
  deleteCalendarEventAction,
  queryFreebusyAction,
];

export function getAction(name: string): ActionDef | undefined {
  return ACTIONS.find((a) => a.name === name);
}

/** 所有动作用到的飞书权限点并集，供后台「绑定前请先开通这些权限」提示用。 */
export function allRequiredScopes(): string[] {
  const set = new Set<string>();
  for (const a of ACTIONS) for (const s of a.scopes) set.add(s);
  // 收事件本身需要的权限点：群里被 @ 的消息。不属于任何单个动作，但一个都不能少。
  set.add('im:message.group_at_msg:readonly');
  set.add('im:message.p2p_msg:readonly');
  // 「收到了」那个 👀 表情（dispatcher 的 ack）。列出来是因为不开它会在服务端日志里
  // 刷一片 99991672，而用户侧只是少了个表情 —— 光看现象猜不到缺哪一项。
  set.add('im:message.reaction:write');
  // 名册同步用的权限。同样不属于任何单个动作，但少了它「私聊里指名同事」就不成立。
  for (const s of DIRECTORY_SCOPES) set.add(s);
  // 机器人被拉进群时查群名（connection.ts 的 botAdded）。DIRECTORY_SCOPES 里
  // 本来就有 im:chat:readonly（名册兜底路要用），这里不用重复添加。
  return [...set].sort();
}

export type { ActionDef, ActionContext, ActionResult } from './types.js';
