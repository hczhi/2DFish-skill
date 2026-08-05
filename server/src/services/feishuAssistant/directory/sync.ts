import type { Client } from '@larksuiteoapi/node-sdk';
import { describeFeishuError, isContactUnavailable } from '../feishuError.js';
import {
  replaceDirectory,
  setSyncState,
  type DirectoryDepartment,
  type UpsertUserInput,
} from './store.js';

// 从飞书拉一次组织架构，整批写进本地名册。
//
// ── 为什么要有两条路 ──
// 主路是通讯录接口（contact/v3）：拿到全公司的人 + 部门归属，这是「私聊里说
// 『给张三发消息』」真正需要的东西。但它要 contact 的数据权限，而那需要在飞书
// 后台单独申请、且有的企业管理员不给。
// 兜底路是群成员（im/v1）：机器人在哪些群里，就能拿到那些群的成员 name + open_id，
// 只要 im:chat:readonly，**不需要任何通讯录权限**。覆盖面小（只有机器人所在的群、
// 没有部门信息），但对「我和同事在同一个群里」这个绝大多数情况够用。
//
// 两条路都失败才算失败。只要有一条成功就写库，并把实际用的是哪条记进
// feishu_apps.dir_source —— 用户必须知道自己拿到的是全公司还是仅群成员，
// 否则他会以为「查不到某人」是 bug。

/**
 * 名册同步需要的权限点。
 *
 * 前两条给主路（通讯录），第三条给兜底路（群成员）。飞书对缺权限的报错是
 * 「以下权限任一项即可」的语义，所以这里列的是**并集**，后台展示成
 * 「同步组织架构需要」的一组，让用户一次配齐。
 *
 * 放在这里而不是某个 ActionDef 里：同步不属于任何一个动作，
 * 它是绑定流程的一步。allRequiredScopes() 会把它并进总清单。
 */
export const DIRECTORY_SCOPES = [
  'contact:user.base:readonly',
  'contact:department.base:readonly',
  'im:chat:readonly',
];

/** 部门树的根。飞书用字符串 '0' 表示根部门。 */
const ROOT_DEPARTMENT = '0';

/**
 * 通讯录接口全都调通了，但可读范围里一个人也没有。
 *
 * 单独一个类型，因为它在飞书那边**不是错误**（"你能读的范围内确实没人"），
 * 但对用户的后果和 40004 完全一样：通讯录读不到。所以要走同一条兜底路。
 */
class ContactEmptyError extends Error {
  constructor() {
    super(
      '通讯录接口能调通，但可读的成员是 0 人 —— 通常是「通讯录权限范围」里没有勾选任何部门。\n' +
        '去飞书开发者后台【权限管理 > 数据权限 > 通讯录范围】把部门（或全部成员）加进去，' +
        '然后【创建并发布新版本】。'
    );
    this.name = 'ContactEmptyError';
  }
}

/** 单次同步最多拉多少人。防止超大企业把一次同步拖成半小时。 */
const MAX_USERS = 20000;

/** 部门树最大深度。防御环形数据（飞书不该给，但遍历不能因此挂死）。 */
const MAX_DEPTH = 20;

export interface SyncResult {
  source: 'contact' | 'chats';
  userCount: number;
  departmentCount: number;
  /** 兜底路生效时的说明，会展示在后台。成功走通讯录时为空。 */
  note: string;
}

/**
 * 同步一个应用的名册。
 *
 * 调用方（API 层）不要 await 这个函数的完整过程 —— 大企业能跑几十秒。
 * 状态全程写进 feishu_apps.dir_sync_*，前端轮询即可。
 */
export async function syncDirectory(
  client: Client,
  appId: string,
  opts: { onLog?: (msg: string) => void } = {}
): Promise<SyncResult> {
  const log = opts.onLog ?? (() => {});
  setSyncState(appId, 'syncing', { error: null });

  try {
    let result: SyncResult;
    try {
      result = await syncFromContact(client, appId, log);
    } catch (e) {
      // 只有「通讯录注定读不到」才降级 —— 权限点没开（99991672）或者
      // 通讯录数据权限范围是空的（40004）。其它错误（网络、限流、飞书 5xx）
      // 降级会掩盖真实原因，让用户拿着一份不完整的名册以为同步成功了。
      if (!isContactUnavailable(e) && !(e instanceof ContactEmptyError)) throw e;
      log('通讯录读不到（权限点或通讯录范围未配），改用群成员兜底');
      result = await syncFromChats(client, appId, log, describeFeishuError(e, appId));
    }

    setSyncState(appId, 'ok', {
      error: result.note || null,
      userCount: result.userCount,
      source: result.source,
    });
    log(`同步完成：${result.userCount} 人、${result.departmentCount} 个部门`);
    return result;
  } catch (e) {
    // 带上 appId：失败原因会原样显示在前端，缺权限那类要能给出可点的授权链接。
    const msg = describeFeishuError(e, appId);
    // 失败时**不清空**已有名册：一次网络抖动不该让助理突然不认识任何人。
    setSyncState(appId, 'failed', { error: msg });
    throw new Error(msg);
  }
}

// ==================== 主路：通讯录 ====================

async function syncFromContact(
  client: Client,
  appId: string,
  log: (msg: string) => void
): Promise<SyncResult> {
  const departments = await fetchAllDepartments(client, log);
  log(`已取到 ${departments.length} 个部门`);

  const deptName = new Map(departments.map((d) => [d.department_id, d.name]));

  // 用 open_id 去重：一个人可以同时属于多个部门，会在多个部门的成员列表里出现。
  const users = new Map<string, UpsertUserInput>();

  // 根部门也要拉：直属于公司根的人（常见于小公司和高管）不在任何子部门里，
  // 漏了他们的话「给老板发个消息」永远查不到人。
  for (const deptId of [ROOT_DEPARTMENT, ...departments.map((d) => d.department_id)]) {
    if (users.size >= MAX_USERS) {
      log(`已达上限 ${MAX_USERS} 人，停止拉取`);
      break;
    }
    const list = await fetchDepartmentUsers(client, deptId);
    for (const u of list) {
      if (!u.open_id || !u.name) continue;
      const ids = u.department_ids ?? [];
      const names = ids
        .map((id) => deptName.get(id))
        .filter((n): n is string => !!n)
        .join(' / ');
      // 同一个人在第二个部门被再次遇到时，合并部门名而不是覆盖 ——
      // 部门名是同名歧义时唯一的区分依据，丢一半会让提示语没法回答。
      const existing = users.get(u.open_id);
      users.set(u.open_id, {
        openId: u.open_id,
        name: u.name,
        enName: u.en_name ?? '',
        departmentIds: existing ? [...new Set([...(existing.departmentIds ?? []), ...ids])] : ids,
        departmentNames: mergeNames(existing?.departmentNames, names),
        jobTitle: u.job_title ?? existing?.jobTitle ?? '',
        isResigned: !!u.status?.is_resigned,
        source: 'contact',
      });
    }
  }

  const list = [...users.values()];

  // 接口全部成功却一个人都没返回 = 通讯录权限范围里没有任何成员。
  // 飞书这时**不报错**（技术上「你能读的范围内确实没人」），所以只能自己判。
  // 抛 ContactEmptyError 而不是普通 Error：调用方据此走群成员兜底 ——
  // 对用户来说这和 40004 是同一件事（读不到通讯录），后果也该一样。
  if (list.length === 0) throw new ContactEmptyError();

  replaceDirectory(appId, list, departments);
  return {
    source: 'contact',
    userCount: list.length,
    departmentCount: departments.length,
    note: '',
  };
}

function mergeNames(a: string | undefined, b: string): string {
  const parts = [...(a ?? '').split(' / '), ...b.split(' / ')].map((s) => s.trim()).filter(Boolean);
  return [...new Set(parts)].join(' / ');
}

/**
 * 广度优先遍历部门树。
 *
 * 用 children(fetch_child=true) 一次拿整棵子树在飞书这边是允许的，但对
 * 大企业会超时；而且我们本来就要逐部门拉成员，逐层遍历的成本可以忽略。
 * MAX_DEPTH 是防环：数据不该有环，但真有环时无限循环比少几个部门糟得多。
 */
async function fetchAllDepartments(
  client: Client,
  log: (msg: string) => void
): Promise<DirectoryDepartment[]> {
  const out: DirectoryDepartment[] = [];
  const seen = new Set<string>();
  let frontier = [ROOT_DEPARTMENT];

  for (let depth = 0; depth < MAX_DEPTH && frontier.length > 0; depth++) {
    const next: string[] = [];
    for (const parent of frontier) {
      let pageToken: string | undefined;
      do {
        const res = await client.contact.v3.department.children({
          path: { department_id: parent },
          params: {
            department_id_type: 'open_department_id',
            page_size: 50,
            ...(pageToken ? { page_token: pageToken } : {}),
          },
        });
        for (const d of res.data?.items ?? []) {
          const id = d.open_department_id || d.department_id;
          if (!id || seen.has(id)) continue;
          // 已删除的部门只会让名册里多出无人的空节点。
          if (d.status?.is_deleted) continue;
          seen.add(id);
          out.push({
            department_id: id,
            name: d.name ?? '',
            parent_id: d.parent_department_id ?? '',
            member_count: d.member_count ?? null,
          });
          next.push(id);
        }
        pageToken = res.data?.has_more ? res.data?.page_token : undefined;
      } while (pageToken);
    }
    if (next.length) log(`第 ${depth + 1} 层：${next.length} 个部门`);
    frontier = next;
  }

  return out;
}

interface ContactUser {
  open_id?: string;
  name?: string;
  en_name?: string;
  job_title?: string;
  department_ids?: string[];
  status?: { is_resigned?: boolean };
}

async function fetchDepartmentUsers(client: Client, departmentId: string): Promise<ContactUser[]> {
  const out: ContactUser[] = [];
  let pageToken: string | undefined;
  do {
    const res = await client.contact.v3.user.findByDepartment({
      params: {
        department_id: departmentId,
        department_id_type: 'open_department_id',
        user_id_type: 'open_id',
        page_size: 50,
        ...(pageToken ? { page_token: pageToken } : {}),
      },
    });
    out.push(...((res.data?.items ?? []) as ContactUser[]));
    pageToken = res.data?.has_more ? res.data?.page_token : undefined;
  } while (pageToken);
  return out;
}

// ==================== 兜底路：群成员 ====================

/**
 * 从机器人所在的群里收集成员。
 *
 * 只要 im:chat:readonly，不需要任何通讯录权限。拿到的是 name + open_id，
 * 没有部门 —— 于是同名时无法区分，`people.ts` 会退化成「请 @ 一下对方」。
 * 这是可接受的：它至少让「和我在同一个群的同事」在私聊里也能被指名。
 */
async function syncFromChats(
  client: Client,
  appId: string,
  log: (msg: string) => void,
  scopeError: string
): Promise<SyncResult> {
  const chatIds: string[] = [];
  let pageToken: string | undefined;
  do {
    const res = await client.im.v1.chat.list({
      params: { page_size: 100, ...(pageToken ? { page_token: pageToken } : {}) },
    });
    for (const c of res.data?.items ?? []) {
      // p2p 不在这个接口的返回里（飞书文档明确说明），这里只会是群。
      if (c.chat_id) chatIds.push(c.chat_id);
    }
    pageToken = res.data?.has_more ? res.data?.page_token : undefined;
  } while (pageToken);

  log(`机器人在 ${chatIds.length} 个群里`);

  const users = new Map<string, UpsertUserInput>();
  for (const chatId of chatIds) {
    if (users.size >= MAX_USERS) break;
    let token: string | undefined;
    do {
      const res = await client.im.v1.chatMembers.get({
        path: { chat_id: chatId },
        params: {
          member_id_type: 'open_id',
          page_size: 100,
          ...(token ? { page_token: token } : {}),
        },
      });
      for (const m of res.data?.items ?? []) {
        // 这个接口本身就会过滤掉机器人成员，所以不用再判 isBot。
        if (!m.member_id || !m.name) continue;
        if (!users.has(m.member_id)) {
          users.set(m.member_id, {
            openId: m.member_id,
            name: m.name,
            source: 'chats',
          });
        }
      }
      token = res.data?.has_more ? res.data?.page_token : undefined;
    } while (token);
  }

  const list = [...users.values()];

  // 一个人都没收集到时**不写库**，而是当失败抛出去。两个理由：
  //   1. replaceDirectory 是整批替换 —— 写空数组会把上一次成功同步的名册清光。
  //      「管理员收回了通讯录权限」这种情况下，用户会从一份好名册变成零人，
  //      而状态显示「已同步」。
  //   2. 「已同步 · 0 人」看起来像成功，用户不会再去处理真正的原因。
  if (list.length === 0) {
    throw new Error(
      '读不到通讯录，也没能从群里收集到人（机器人可能还没被拉进任何群）。\n' +
        `原因：${scopeError}\n` +
        '两条路都行：在飞书后台配好通讯录权限范围，或者先把机器人拉进一个有同事的群再同步。'
    );
  }

  // 部门传空数组：这条路拿不到部门，写进去的空壳只会让后台的架构树显示成空。
  replaceDirectory(appId, list, []);

  return {
    source: 'chats',
    userCount: list.length,
    departmentCount: 0,
    note:
      `读不到通讯录，已改用「机器人所在群的成员」建名册（${list.length} 人）。` +
      `这份名册只覆盖机器人在的群，且没有部门信息（同名时无法区分，仍需 @ 一下）。` +
      `想要全公司名册，请按下面的原因处理后回来重新同步。\n` +
      `原因：${scopeError}`,
  };
}
