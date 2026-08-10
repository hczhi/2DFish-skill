import { findByName, type DirectoryUser } from '../directory/store.js';
import type { ActionContext } from './types.js';

// 「用户说的那个名字」→ open_id。
//
// ── 这一层为什么存在 ──
// `mentions[]` 只覆盖本条消息 @ 到的人，而「派给张三一个任务」里的张三经常
// 没被 @（甚至不在这个群里）。加了名册（migration 057）之后可以查了，
// 但**绝不能**因此让 LLM 输出 open_id —— 模型会编 ou_xxx，而把任务派给
// 错误的人是不可接受的失败模式（回帖还写着「✅ 已派给张三」）。
// 所以约定是：LLM 只输出姓名（用户原话里那几个字），open_id 由这里查。
// 于是 open_id 的来源仍然只有两个，都不经过模型：
//   1. 事件自带的 mentions[]（@ 过的人，零权限、零歧义，优先级最高）
//   2. 本地名册的精确匹配（管理员同步来的通讯录）
//
// ── 三种失败必须分开说 ──
// 查不到 / 同名多个 / 已离职。含糊地回「找不到这个人」会让用户以为是同步没做，
// 而同名时随便挑一个就是在赌。所以每种都有自己的话术，且都以「你 @ 一下对方」
// 作为百分百可靠的退路。
//
// 按**部门**批量解析的那一套（resolveDepartment / resolveAudience / MAX_BROADCAST）
// 随 send_message、create_calendar_event 一起删了：它存在的全部理由是群发消息和
// 批量拉参与人，而项目群助理里没有这两件事 —— 任务只派给一个人。名册的部门数据
// 仍然在同步、仍然在后台「组织架构」页展示，只是不再有动作按部门展开成一批人。

/** 解析失败。错误原文会回帖给用户，所以措辞必须是能照着做的人话。 */
export class PersonNotResolvedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PersonNotResolvedError';
  }
}

export interface ResolvedPerson {
  openId: string;
  name: string;
  /** 'mention' = 从本条消息 @ 到的人里取的；'directory' = 名册查到的 */
  from: 'mention' | 'directory';
}

/** 同名时用来区分的一句话。没有部门信息（群成员兜底那条路）时返回空串。 */
function describe(u: DirectoryUser): string {
  const bits = [u.department_names, u.job_title].map((s) => s.trim()).filter(Boolean);
  return bits.join(' · ');
}

/**
 * 按名字解析一个人。
 *
 * @param who 用户原话里的名字，或一个 open_id（LLM 偶尔仍会塞 open_id，
 *            此时按 mentions 校验，与加名册之前的行为完全一致）。
 */
export function resolvePerson(who: string, ctx: ActionContext): ResolvedPerson {
  const raw = who.trim();
  if (!raw) throw new PersonNotResolvedError('没说清要找谁，请带上对方的名字。');

  // ── 优先级 1：本条消息 @ 到的人 ──
  // 事件自带 name + open_id，零权限零歧义，比名册更可信（名册可能是旧的）。
  // 先按 open_id 匹配（兼容 LLM 直接给 open_id 的老行为），再按名字。
  const byId = ctx.mentions.find((m) => m.openId === raw);
  if (byId) return { openId: byId.openId, name: byId.name, from: 'mention' };

  const byName = ctx.mentions.filter((m) => sameName(m.name, raw));
  if (byName.length === 1) {
    return { openId: byName[0].openId, name: byName[0].name, from: 'mention' };
  }

  // LLM 给了一个 ou_xxx，但它不在 mentions 里 —— 这就是编造。
  // 名册里也查不到它（名册按名字建索引，不按 open_id 查名字），所以直接拦下，
  // 不要拿它去当名字查，那样错误提示会变得莫名其妙。
  if (/^ou_/i.test(raw)) {
    throw new PersonNotResolvedError(
      '认不出说的是谁。请直接 @ 一下对方，或者用对方在通讯录里的姓名。'
    );
  }

  // ── 优先级 2：本地名册 ──
  const hits = findByName(ctx.appId, raw);

  if (hits.length === 0) {
    throw new PersonNotResolvedError(
      `通讯录里没有找到「${raw}」。请 @ 一下对方，或者确认姓名和飞书通讯录里一致。` +
        `（如果还没同步过组织架构，请让管理员在平台的飞书助理页面同步一次。）`
    );
  }

  // 在职优先：一个人离职、新人同名的情况下，用户说的几乎肯定是在职那个。
  const active = hits.filter((u) => !u.is_resigned);

  if (active.length === 0) {
    // 全部离职。必须明说，否则用户会以为是同步没做，反复重试。
    throw new PersonNotResolvedError(
      `「${hits[0].name}」在通讯录里已标记为离职，不能给 ta 派任务。`
    );
  }

  if (active.length > 1) {
    // 绝不挑一个。有部门信息时把选项列出来让用户重说一遍；
    // 群成员兜底那条路没有部门，此时唯一可靠的办法就是让他 @ 一下。
    const options = active
      .map(describe)
      .filter(Boolean)
      .map((d) => `「${d}」`)
      .join('、');
    throw new PersonNotResolvedError(
      options
        ? `通讯录里有 ${active.length} 个叫「${raw}」的人：${options}。` +
          `请 @ 一下你要找的那位，或者说清楚是哪个部门的。`
        : `通讯录里有 ${active.length} 个叫「${raw}」的人，无法确定是哪一位。请 @ 一下对方。`
    );
  }

  return { openId: active[0].open_id, name: active[0].name, from: 'directory' };
}

function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}
