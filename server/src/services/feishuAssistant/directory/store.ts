import { getDatabase } from '../../../db/index.js';

// 名册的读写 + 按名字找人。
//
// 这一层是「私聊里也能给同事发消息」的关键：LLM 只输出用户说的**名字**，
// open_id 一律由这里精确查出来。于是 open_id 的来源仍然只有两个，都不经过模型：
// 事件自带的 mentions[]，和这张表（migration 057）。
//
// 查不到、同名、离职三种情况都必须**明确区分**并各自回一句人话。
// 含糊地回「找不到」会让用户以为是同步没做；而同名时随便挑一个，
// 就等于把消息发给错误的人——本模块从一开始就把它定为不可接受的失败模式。

export interface DirectoryUser {
  open_id: string;
  name: string;
  en_name: string;
  department_names: string;
  job_title: string;
  is_resigned: number;
}

export interface DirectoryDepartment {
  department_id: string;
  name: string;
  parent_id: string;
  member_count: number | null;
}

/**
 * 归一化姓名，用于匹配。
 *
 * 中文名里的空格、间隔号（「张·三」）和全角空格都是用户随手打出来的差异，
 * 英文名还有大小写。写入和查询共用这一个函数是必须的——分开实现的话，
 * 会出现「存的时候归一化了、查的时候没有」这种查不到但看不出原因的故障。
 */
export function normalizeName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\s　·・.．,，]/g, '');
}

// ==================== 写入（同步用） ====================

export interface UpsertUserInput {
  openId: string;
  name: string;
  enName?: string;
  departmentIds?: string[];
  departmentNames?: string;
  jobTitle?: string;
  isResigned?: boolean;
  source?: 'contact' | 'chats';
}

/**
 * 整批替换某个应用的名册。
 *
 * 用「先删后插」而不是逐行 upsert：离职并从通讯录移除的人必须从名册里消失，
 * 否则助理会一直能给一个已经不存在的 open_id 发消息（飞书那边报错，
 * 而用户以为发出去了）。整个替换过程包在一个事务里——同步跑到一半崩了
 * 不该留下半张空名册，那比旧数据糟得多。
 */
export function replaceDirectory(
  appId: string,
  users: UpsertUserInput[],
  departments: DirectoryDepartment[]
): void {
  const db = getDatabase();
  const now = new Date().toISOString();

  const run = db.transaction(() => {
    db.prepare('DELETE FROM feishu_directory_users WHERE app_id = ?').run(appId);
    db.prepare('DELETE FROM feishu_directory_departments WHERE app_id = ?').run(appId);

    const insUser = db.prepare(
      `INSERT OR REPLACE INTO feishu_directory_users
         (app_id, open_id, name, en_name, match_key, department_ids, department_names,
          job_title, is_resigned, source, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const u of users) {
      // 没有 open_id 的行留着毫无用处——名册存在的意义就是给出 open_id。
      if (!u.openId || !u.name.trim()) continue;
      insUser.run(
        appId,
        u.openId,
        u.name.trim(),
        (u.enName ?? '').trim(),
        normalizeName(u.name),
        JSON.stringify(u.departmentIds ?? []),
        u.departmentNames ?? '',
        u.jobTitle ?? '',
        u.isResigned ? 1 : 0,
        u.source ?? 'contact',
        now
      );
    }

    const insDept = db.prepare(
      `INSERT OR REPLACE INTO feishu_directory_departments
         (app_id, department_id, name, parent_id, member_count, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    for (const d of departments) {
      if (!d.department_id) continue;
      insDept.run(appId, d.department_id, d.name, d.parent_id, d.member_count ?? null, now);
    }
  });

  run();
}

// ==================== 读取 ====================

export function countUsers(appId: string): number {
  return (
    getDatabase()
      .prepare('SELECT COUNT(*) AS c FROM feishu_directory_users WHERE app_id = ?')
      .get(appId) as { c: number }
  ).c;
}

export function listDepartments(appId: string): DirectoryDepartment[] {
  return getDatabase()
    .prepare(
      `SELECT department_id, name, parent_id, member_count
       FROM feishu_directory_departments WHERE app_id = ? ORDER BY name`
    )
    .all(appId) as DirectoryDepartment[];
}

export interface ListUsersFilter {
  appId: string;
  /** 模糊搜索（姓名 / 英文名 / 部门），后台名册页用 */
  q?: string;
  limit?: number;
  offset?: number;
}

export function listUsers(f: ListUsersFilter): { users: DirectoryUser[]; total: number } {
  const db = getDatabase();
  let where = 'WHERE app_id = ?';
  const params: unknown[] = [f.appId];

  const q = (f.q ?? '').trim();
  if (q) {
    // 姓名走归一化键（和执行路径一致），部门名走原文——用户搜部门时
    // 打的是「销售部」而不是归一化后的形式。
    where += ' AND (match_key LIKE ? OR department_names LIKE ? OR job_title LIKE ?)';
    params.push(`%${normalizeName(q)}%`, `%${q}%`, `%${q}%`);
  }

  const total = (
    db.prepare(`SELECT COUNT(*) AS c FROM feishu_directory_users ${where}`).get(...params) as {
      c: number;
    }
  ).c;

  const users = db
    .prepare(
      `SELECT open_id, name, en_name, department_names, job_title, is_resigned
       FROM feishu_directory_users ${where}
       ORDER BY is_resigned ASC, name ASC LIMIT ? OFFSET ?`
    )
    .all(...params, f.limit ?? 50, f.offset ?? 0) as DirectoryUser[];

  return { users, total };
}

/**
 * 按名字精确找人（归一化后完全相等）。返回所有命中，由调用方决定歧义怎么处理。
 *
 * **刻意不做模糊匹配**。「张」前缀匹配到「张三」「张伟」「张小明」时，
 * 挑一个是错的，全列出来又不是用户想问的；而真正的坏情况是只有一个人姓张，
 * 于是它默默把消息发给了一个用户根本没想过的人。要模糊搜索请用后台的名册页，
 * 那里由人来选。
 */
export function findByName(appId: string, rawName: string): DirectoryUser[] {
  const key = normalizeName(rawName);
  if (!key) return [];
  return getDatabase()
    .prepare(
      `SELECT open_id, name, en_name, department_names, job_title, is_resigned
       FROM feishu_directory_users
       WHERE app_id = ? AND match_key = ?
       ORDER BY is_resigned ASC, name ASC`
    )
    .all(appId, key) as DirectoryUser[];
}

/**
 * 按 open_id 取一个人。走主键 `(app_id, open_id)`，没有歧义也不需要归一化。
 *
 * 用途和 findByName 相反：那个是"用户说了个名字，是谁"，这个是"我有 id，他叫什么"。
 * 目前只在一处用 —— 转达消息要署发起人的名字，而飞书事件里的 sender_name
 * 偶尔是空的（某些客户端版本、或名字为空的账号）。署名缺失会让收件人收到一条
 * 没有主人的通知，所以值得再查一次库补上。
 */
export function findByOpenId(appId: string, openId: string): DirectoryUser | undefined {
  if (!openId) return undefined;
  return getDatabase()
    .prepare(
      `SELECT open_id, name, en_name, department_names, job_title, is_resigned
       FROM feishu_directory_users
       WHERE app_id = ? AND open_id = ?`
    )
    .get(appId, openId) as DirectoryUser | undefined;
}

/**
 * 按部门名精确找部门（归一化后相等）。返回所有命中，歧义由调用方处理。
 *
 * 和 findByName 一样**不做模糊匹配**，理由也一样：公司里常有
 * 「销售部」「销售一部」「云销售部」这种名字，前缀匹配挑一个就是在赌
 * —— 而这里赌错的代价比发错一条消息大得多（会群发给一整个部门的人）。
 */
export function findDepartmentByName(appId: string, rawName: string): DirectoryDepartment[] {
  const key = normalizeName(rawName);
  if (!key) return [];
  return (
    getDatabase()
      .prepare(
        `SELECT department_id, name, parent_id, member_count
         FROM feishu_directory_departments WHERE app_id = ?`
      )
      .all(appId) as DirectoryDepartment[]
  ).filter((d) => normalizeName(d.name) === key);
}

/**
 * 某个部门（可含子部门）的在职成员。
 *
 * ── 为什么按 department_ids 而不是 department_names ──
 * 名字会重（两个「销售部」挂在不同上级下），id 不会。`department_names` 是给人看的
 * 冗余字段，用它来筛会把另一个同名部门的人一起捞进来 —— 而这个函数的结果
 * 会被用来群发消息，多捞一个部门就是发错一批人。
 *
 * `department_ids` 存的是 JSON 数组，这里用 LIKE 匹配带引号的完整 id
 * （`"od_123"`）。看着糙，但比拆一张关联表划算：这是唯一按部门反查的地方，
 * 而且带引号匹配不会出现 `od_1` 命中 `od_12` 的前缀误伤。
 *
 * **只回在职的人**：给部门群发通知时把离职的人算进去，会撞一堆发送失败，
 * 而用户完全不知道那几个失败是正常的。
 */
export function listUsersByDepartments(appId: string, departmentIds: string[]): DirectoryUser[] {
  const ids = departmentIds.filter(Boolean);
  if (ids.length === 0) return [];

  const clause = ids.map(() => 'department_ids LIKE ?').join(' OR ');
  return getDatabase()
    .prepare(
      `SELECT open_id, name, en_name, department_names, job_title, is_resigned
       FROM feishu_directory_users
       WHERE app_id = ? AND is_resigned = 0 AND (${clause})
       ORDER BY name ASC`
    )
    .all(appId, ...ids.map((id) => `%"${id}"%`)) as DirectoryUser[];
}

/**
 * 一个部门及其所有子部门的 id。
 *
 * 「销赞云事业部的所有人」几乎肯定包括它下面各个组 —— 事业部通常只是个
 * 容器，人挂在子部门上。只查本级会返回零人或者只有几个领导，
 * 而用户以为通知到了整个部门。
 *
 * 在内存里爬树而不是递归 SQL：部门数是几十到几百级别，一次全读出来更简单，
 * 而且 listDepartments 本来就已经在别处用了。
 */
export function expandDepartmentTree(appId: string, rootId: string): string[] {
  const all = listDepartments(appId);
  const childrenOf = new Map<string, string[]>();
  for (const d of all) {
    const list = childrenOf.get(d.parent_id) ?? [];
    list.push(d.department_id);
    childrenOf.set(d.parent_id, list);
  }

  const out: string[] = [];
  const seen = new Set<string>();
  const queue = [rootId];
  // 防环：数据不该有环，但真有环时无限循环比少几个部门糟得多。
  while (queue.length && out.length < 500) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    queue.push(...(childrenOf.get(id) ?? []));
  }
  return out;
}

export function deleteDirectory(appId: string): void {
  const db = getDatabase();
  const run = db.transaction(() => {
    db.prepare('DELETE FROM feishu_directory_users WHERE app_id = ?').run(appId);
    db.prepare('DELETE FROM feishu_directory_departments WHERE app_id = ?').run(appId);
  });
  run();
}

// ==================== 同步状态（挂在 feishu_apps 上） ====================

export type DirSyncState = 'idle' | 'syncing' | 'ok' | 'failed';

export function setSyncState(
  appId: string,
  state: DirSyncState,
  opts: { error?: string | null; userCount?: number; source?: string } = {}
): void {
  const db = getDatabase();
  const sets = ['dir_sync_state = ?', 'dir_sync_at = ?'];
  const params: unknown[] = [state, new Date().toISOString()];

  if (opts.error !== undefined) {
    sets.push('dir_sync_error = ?');
    params.push(opts.error);
  }
  if (opts.userCount !== undefined) {
    sets.push('dir_user_count = ?');
    params.push(opts.userCount);
  }
  if (opts.source !== undefined) {
    sets.push('dir_source = ?');
    params.push(opts.source);
  }

  params.push(appId);
  db.prepare(`UPDATE feishu_apps SET ${sets.join(', ')} WHERE app_id = ?`).run(...params);
}
