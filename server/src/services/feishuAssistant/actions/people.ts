import {
  expandDepartmentTree,
  findByName,
  findDepartmentByName,
  listUsersByDepartments,
  type DirectoryUser,
} from '../directory/store.js';
import type { ActionContext } from './types.js';

// 「用户说的那个名字」→ open_id。
//
// ── 这一层为什么存在 ──
// 私聊里没法 @ 任何人，所以「帮我给张三发个消息」在只认 mentions[] 的年代
// 是个死胡同。加了名册（migration 057）之后可以查了，但**绝不能**因此让 LLM
// 输出 open_id —— 模型会编 ou_xxx，而把消息发给错误的人是不可接受的失败模式。
// 所以约定是：LLM 只输出 `to_name`（用户原话里的名字），open_id 由这里查。
// 于是 open_id 的来源仍然只有两个，都不经过模型：
//   1. 事件自带的 mentions[]（@ 过的人，零权限、零歧义，优先级最高）
//   2. 本地名册的精确匹配（管理员同步来的通讯录）
//
// ── 三种失败必须分开说 ──
// 查不到 / 同名多个 / 已离职。含糊地回「找不到这个人」会让用户以为是同步没做，
// 而同名时随便挑一个就是在赌。所以每种都有自己的话术，且都以「你 @ 一下对方」
// 作为百分百可靠的退路。

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
      '认不出要发给谁。请直接 @ 一下对方，或者用对方在通讯录里的姓名。'
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
      `「${hits[0].name}」在通讯录里已标记为离职，不能给 ta 发消息或派任务。`
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

// ==================== 按部门找一批人 ====================

/**
 * 一次群发最多多少人。
 *
 * 这是个**安全阀**，不是性能上限。「给全公司发个消息」在一个 800 人的企业里
 * 是个能把人吓出冷汗的操作，而它和「给销售部发个消息」在自然语言里长得一样。
 * 超过这个数就让用户明确确认，而不是默默发出去 —— 发出去的消息撤不回来。
 */
export const MAX_BROADCAST = 30;

export interface ResolvedDepartment {
  departmentId: string;
  name: string;
  members: ResolvedPerson[];
}

/**
 * 按部门名解析出一批人（含子部门的在职成员）。
 *
 * 三种失败和 resolvePerson 一样必须分开说，因为用户的下一步动作完全不同：
 * 部门名不对 → 换个名字；同名部门 → 说清是哪个；部门是空的 → 去同步名册。
 */
export function resolveDepartment(rawName: string, ctx: ActionContext): ResolvedDepartment {
  const name = rawName.trim();
  if (!name) throw new PersonNotResolvedError('没说清是哪个部门。');

  const hits = findDepartmentByName(ctx.appId, name);

  if (hits.length === 0) {
    // 把「部门名对不上」和「名册没同步」分开：前者换个说法就行，
    // 后者要去平台点一下同步。含糊成「找不到」的话用户会在两个方向上乱试。
    throw new PersonNotResolvedError(
      `通讯录里没有找到叫「${name}」的部门。请确认名称和飞书组织架构里一致` +
        `（可以在平台的飞书助理页面查看已同步的部门列表），或者直接 @ 要通知的同事。`
    );
  }

  if (hits.length > 1) {
    // 绝不挑一个 —— 挑错部门就是把消息群发给一批不相干的人。
    throw new PersonNotResolvedError(
      `通讯录里有 ${hits.length} 个叫「${name}」的部门，无法确定是哪一个。` +
        `请说得更具体些，或者直接 @ 要通知的同事。`
    );
  }

  const dept = hits[0];
  // 含子部门：事业部通常只是个容器，人挂在下面各个组上。
  // 只查本级会返回零人或几个领导，而用户以为整个部门都通知到了。
  const ids = expandDepartmentTree(ctx.appId, dept.department_id);
  const users = listUsersByDepartments(ctx.appId, ids);

  if (users.length === 0) {
    throw new PersonNotResolvedError(
      `「${dept.name}」这个部门在名册里没有成员。可能是组织架构还没同步全` +
        `（去平台的飞书助理页面重新同步一次），或者这个部门的人都挂在别处。`
    );
  }

  return {
    departmentId: dept.department_id,
    name: dept.name,
    members: users.map((u) => ({ openId: u.open_id, name: u.name, from: 'directory' as const })),
  };
}

export interface ResolvedAudience {
  members: ResolvedPerson[];
  /** 解析到的部门（用于回帖里说清"哪个部门、多少人"） */
  departments: ResolvedDepartment[];
}

/**
 * 把「点名的人」+「点名的部门」合成一份去重后的名单。
 *
 * ── 为什么先全部解析完再返回 ──
 * 任何一个目标解析不出来就整体抛错，**一个都不动**。半成功是这里最坏的结果：
 * 用户看到「发给了 12 个人，但张三没找到」时不知道该补发张三还是整个重来，
 * 而重来会让那 12 个人收到两遍。解析阶段抛错则什么都还没发生，重说一遍是安全的。
 *
 * @param opts.dropSenderFromDepartments 部门展开出来的人里剔掉发起人。
 *   群发消息要开（「给销售部所有人发」时他自己在销售部里，而他不需要收到
 *   一条自己让机器人转告的话 —— 执行结果已经在会话里了）。
 *   **只对部门生效**：他要是明确点了自己的名字，那就是他真想发给自己。
 */
export function resolveAudience(
  opts: { names: string[]; departments: string[]; dropSenderFromDepartments?: boolean },
  ctx: ActionContext
): ResolvedAudience {
  const departments = opts.departments.map((d) => resolveDepartment(d, ctx));
  const named = opts.names.map((n) => resolvePerson(n, ctx));

  const byId = new Map<string, ResolvedPerson>();
  for (const p of departments.flatMap((d) => d.members)) {
    if (opts.dropSenderFromDepartments && p.openId === ctx.senderOpenId) continue;
    byId.set(p.openId, p);
  }
  // 点名的人放在后面写入，覆盖部门捞出来的同一个人：他的 `from` 可能是更可信的
  // 'mention'，而回帖要据此标注来源。顺带也让「给销售部和张三发」时张三只收一条。
  for (const p of named) byId.set(p.openId, p);

  const members = [...byId.values()];
  if (members.length === 0) {
    throw new PersonNotResolvedError(
      '算下来没有需要通知的人（可能这个部门里只有你自己）。'
    );
  }

  // 安全阀。「给全公司发个消息」和「给销售部发个消息」在自然语言里长得一样，
  // 而前者在一个几百人的企业里是个撤不回来的事故。超了就停下来让用户
  // 说清范围 —— 这里必须报出实际人数，否则他不知道该怎么缩小。
  if (members.length > MAX_BROADCAST) {
    const scope = departments.length
      ? departments.map((d) => `「${d.name}」`).join('、')
      : '这个范围';
    throw new PersonNotResolvedError(
      `${scope}一共 ${members.length} 人，超过了一次群发的上限（${MAX_BROADCAST} 人）。` +
        `为避免误发，请缩小到具体的子部门或点名要通知的同事。`
    );
  }

  return { members, departments };
}

/** 回帖里描述范围用的一句话：「销赞云事业部（12 人）」/「张三、李四」。 */
export function describeAudience(a: ResolvedAudience): string {
  if (a.departments.length) {
    const depts = a.departments.map((d) => d.name).join('、');
    return `${depts} 等 ${a.members.length} 人`;
  }
  return a.members.map((m) => m.name).join('、');
}
