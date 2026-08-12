import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../../../db/index.js';
import { isUniqueViolation } from '../../../db/sqliteError.js';

// 项目日记的库层（migration 066）。纯 SQL，不碰飞书接口 ——
// 飞书那侧在 bitable.ts，同步失败时本模块的数据仍然完整。
//
// 所有查询都带 app_id：一个平台账号可以绑多家公司的自建应用，
// 漏掉它就会让 A 公司的项目出现在 B 公司的操作里。

export interface DiaryIndexRow {
  app_id: string;
  base_app_token: string;
  table_id: string;
  url: string;
  link_share_closed: number;
  /**
   * 1 = 总表已经有「任务表」那一列了（074）。0 = 下次建项目/派活时补建。
   * 看这一位而不是看表里当前有没有那一列：用户手动删掉之后我们不该一直重建。
   */
  task_col_added: number;
  /** 1 = 老行的「任务表」链接已经补过（074）。补出来的列对已有行是空的。 */
  task_col_backfilled: number;
  created_at: string;
  updated_at: string;
}

export interface DiaryProjectRow {
  id: string;
  app_id: string;
  chat_id: string;
  chat_name: string;
  name: string;
  base_app_token: string;
  record_table_id: string;
  review_table_id: string;
  /**
   * 项目日记 base 里那张老「任务」表（068）。**已经删掉了**（074 那一片）：
   * 任务搬到独立 base（070）之后两张表各存一半，而它们不同步。
   * 非空 = 飞书那侧那张表还在，下次派活时删。删成之后这两列都置空串。
   */
  task_table_id: string;
  /** 老「任务」表的甘特视图 id。跟着上面那张表一起作废。 */
  task_view_id: string;
  /**
   * 日记 base 里那张「🔗 相关链接」表（074，指向任务管理表）。
   * 空串 = 还没建出来，下次派活/建项目时补建 —— 这一列就是那段代码的幂等依据。
   */
  link_table_id: string;
  /** 任务 base 里那张「🔗 相关链接」表（074，指向项目日志表）。同上。 */
  task_link_table_id: string;
  /**
   * 独立的任务 base（070）。**空串 = 这个项目还没有任务 base**，第一次派活时补建
   * （taskBase.ensureTaskBase）。判据只看这一列 —— 上面那两列是老表，非空。
   */
  task_base_app_token: string;
  task_base_table_id: string;
  task_base_url: string;
  /**
   * 列名 → field_id 的 JSON。任务表对群成员**可编辑**，列名随时会被改，
   * 而写记录的接口只收列名 —— 所以写之前要用 field_id 反查当前列名。
   * 空串 = 建表时没读到字段清单，写入退回按中文常量硬写。
   */
  task_field_map: string;
  /** 两个看板视图。空串 = 没建成（少两个视图，数据仍在默认表格视图里）。 */
  task_board_view_id: string;
  task_person_view_id: string;
  /**
   * 甘特视图（072）。**空串 = 还没建过**，下次派活时补建 —— 这一列就是那段
   * 补建代码的幂等依据，没有它每次派活都会多一个同名视图而且全都成功。
   */
  task_gantt_view_id: string;
  /**
   * 1 = 老行的「飞书任务」列已经回填过（073）。0 = 还没跑成，下次派活时再试。
   * 它挡住的是「每条派活指令都把整张表读一遍」——不报错，只是白慢。
   */
  task_url_backfilled: number;
  /** 0 = 收紧链接分享失败，表处于租户默认可见范围。回帖要提醒手动收紧。 */
  task_base_link_share_closed: number;
  url: string;
  link_share_closed: number;
  index_record_id: string | null;
  created_by: string;
  created_by_name: string;
  created_at: string;
  updated_at: string;
}

/**
 * 一条日志记录是谁写的字（migration 069）。
 *
 * `manual` = 用户自己说的原话（066 以来的全部记录都是这个）；
 * `chat_digest` = LLM 从群聊记录里总结出来的散文。**必须分开**：
 * 这张表存在的唯一理由是「当时到底怎么说的」，而混进去的模型产出会让
 * 半年后回头看的人分不清哪句是真话 —— 见 069 的文件头。
 */
export type RecordOrigin = 'manual' | 'chat_digest';

export interface DiaryRecordRow {
  id: string;
  app_id: string;
  project_id: string;
  content: string;
  source_text: string;
  author_open_id: string;
  author_name: string;
  message_id: string;
  step_index: number;
  created_ms: number;
  created_at: string;
  bitable_synced_at: string | null;
  origin: RecordOrigin;
  /** 摘要覆盖的时间段（`today:2026-08-10` 这种）。空串 = 不是摘要。 */
  digest_range: string;
}

/**
 * 一条项目任务（migration 068）。
 *
 * 库是数据源，飞书任务是执行侧的镜像（提醒/待办列表），多维表格是看板侧的镜像
 * （甘特图）。两侧同步失败都只降级成一句 warning，见 068 的文件头注释。
 */
export interface FeishuProjectTaskRow {
  id: string;
  app_id: string;
  /** null = 在没绑项目的群里派的活。这种行不进多维表格。 */
  project_id: string | null;
  title: string;
  content: string;
  owner_open_id: string;
  owner_name: string;
  /** 毫秒。null = 没说开始时间，甘特图上是个点。 */
  start_ms: number | null;
  end_ms: number | null;
  status: string;
  guid: string;
  url: string;
  created_by: string;
  created_by_name: string;
  message_id: string;
  step_index: number;
  created_ms: number;
  created_at: string;
  updated_at: string;
  bitable_synced_at: string | null;
  /**
   * 任务管理表（070）里那一行的 record_id。
   *
   * 074 之前它指的是老「任务」表里那一行；那张表删掉之后这一列改指任务管理表。
   * 改写那张表时**不靠这一列**（靠「助理标记」列反查，表是开放编辑的、行会被
   * 删掉重建），所以它现在只是「这条任务进表了没有」的凭据。
   */
  bitable_record_id: string;
}

export interface DiarySummaryRow {
  id: string;
  app_id: string;
  project_id: string;
  range_label: string;
  range_start_ms: number | null;
  range_end_ms: number | null;
  record_count: number;
  summary: string;
  created_by: string;
  created_by_name: string;
  created_at: string;
  bitable_synced_at: string | null;
}

// ── 项目总表 ──

export function getIndex(appId: string): DiaryIndexRow | undefined {
  return getDatabase().prepare('SELECT * FROM feishu_diary_indexes WHERE app_id = ?').get(appId) as
    | DiaryIndexRow
    | undefined;
}

export function saveIndex(input: {
  appId: string;
  baseAppToken: string;
  tableId: string;
  url: string;
  linkShareClosed: boolean;
}): void {
  const now = new Date().toISOString();
  getDatabase()
    .prepare(
      // 两位「任务表那一列」的状态直接置 1：新建的总表结构里本来就有那一列
      // （INDEX_FIELDS），而一行都还没有，没有可回填的东西。置 0 的话第一次
      // 建项目之后会去补一列已经存在的列 —— 飞书拒掉重名列，于是每次建项目都
      // 挂一句永远不会好的 warning。
      `INSERT INTO feishu_diary_indexes
         (app_id, base_app_token, table_id, url, link_share_closed,
          task_col_added, task_col_backfilled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?)
       ON CONFLICT(app_id) DO UPDATE SET
         base_app_token = excluded.base_app_token,
         table_id = excluded.table_id,
         url = excluded.url,
         link_share_closed = excluded.link_share_closed,
         task_col_added = excluded.task_col_added,
         task_col_backfilled = excluded.task_col_backfilled,
         updated_at = excluded.updated_at`
    )
    .run(
      input.appId,
      input.baseAppToken,
      input.tableId,
      input.url,
      input.linkShareClosed ? 1 : 0,
      now,
      now
    );
}

/**
 * 「总表已经有『任务表』那一列了」/「老行的链接已经补过了」这两位（074）。
 *
 * 只在**真写成之后**置位。提前置位（比如先置位再补链接）的后果是那批链接永远是
 * 空的：置了位就不会再回来，而总表里那一列看着只是「没填」，谁都不会去查。
 */
export function markIndexTaskCol(appId: string, part: 'added' | 'backfilled'): void {
  const col = part === 'added' ? 'task_col_added' : 'task_col_backfilled';
  getDatabase()
    .prepare(`UPDATE feishu_diary_indexes SET ${col} = 1, updated_at = ? WHERE app_id = ?`)
    .run(new Date().toISOString(), appId);
}

// ── 项目 ──

export function getProjectByChat(appId: string, chatId: string): DiaryProjectRow | undefined {
  return getDatabase()
    .prepare('SELECT * FROM feishu_diary_projects WHERE app_id = ? AND chat_id = ?')
    .get(appId, chatId) as DiaryProjectRow | undefined;
}

export function getProjectById(id: string): DiaryProjectRow | undefined {
  return getDatabase().prepare('SELECT * FROM feishu_diary_projects WHERE id = ?').get(id) as
    | DiaryProjectRow
    | undefined;
}

export function listProjects(appId: string): DiaryProjectRow[] {
  return getDatabase()
    .prepare('SELECT * FROM feishu_diary_projects WHERE app_id = ? ORDER BY created_at DESC')
    .all(appId) as DiaryProjectRow[];
}

/**
 * 按名字找项目。**精确匹配（去空格、忽略大小写），不做模糊。**
 *
 * 原版 skill 用的是 `keyword in name or name in keyword`，于是「印度纪录片」
 * 会匹配上「印度纪录片II」—— 记录进了错的项目，而回帖说「已记录」。
 * 包含匹配在这个场景下没有安全的写法：一旦项目名互相嵌套，选哪个都是猜。
 * 所以只精确匹配，找不到就让用户在对应的群里说，或者把名字写全。
 */
export function findProjectByName(appId: string, name: string): DiaryProjectRow | undefined {
  const key = name.trim().toLowerCase();
  if (!key) return undefined;
  return listProjects(appId).find((p) => p.name.trim().toLowerCase() === key);
}

export class ProjectConflictError extends Error {
  /** 冲突的既有项目。调用方要把它的名字说出来 —— 「这个群已经是《X》了」。 */
  existing: DiaryProjectRow;
  /** 'chat' = 这个群已经有项目了；'name' = 别的群占了这个名字。 */
  reason: 'chat' | 'name';
  constructor(reason: 'chat' | 'name', existing: DiaryProjectRow) {
    super(reason === 'chat' ? 'chat already has a project' : 'project name already used');
    this.name = 'ProjectConflictError';
    this.reason = reason;
    this.existing = existing;
  }
}

/**
 * 占一个项目位（还没有多维表格）。
 *
 * **先占位、再建表**，顺序是有意的：建多维表格要好几个来回（建 base、建两张表、
 * 删默认表、收链接分享、授权给群），期间同群第二个人再说一次「新建项目」，
 * 没有这道闸就会建出第二套表格，而库里只留得下一行 —— 另一套成了没人知道
 * 存在的孤儿表（还带着群成员的可见权限）。
 *
 * 撞到 UNIQUE 就抛 ProjectConflictError，附上既有项目，让回帖能说清是哪个。
 */
export function claimProject(input: {
  appId: string;
  chatId: string;
  chatName?: string;
  name: string;
  createdBy: string;
  createdByName: string;
}): DiaryProjectRow {
  const db = getDatabase();
  const now = new Date().toISOString();
  const row: DiaryProjectRow = {
    id: uuidv4(),
    app_id: input.appId,
    chat_id: input.chatId,
    chat_name: (input.chatName ?? '').trim(),
    name: input.name.trim(),
    base_app_token: '',
    record_table_id: '',
    review_table_id: '',
    task_table_id: '',
    task_view_id: '',
    // 新项目的两张「相关链接」表是建项目时就建出来的（074），这里先占空串。
    link_table_id: '',
    task_link_table_id: '',
    // 070 的这几列必须一起列进下面那条 INSERT：better-sqlite3 对具名参数是
    // 严格的，`row` 上多一个语句里没有的键会直接抛（不是被忽略）。
    task_base_app_token: '',
    task_base_table_id: '',
    task_base_url: '',
    task_field_map: '',
    task_board_view_id: '',
    task_person_view_id: '',
    task_gantt_view_id: '',
    // 新项目没有可回填的行：每一行在写入时就带着飞书任务链接。置 1 省掉一次
    // 「把整张表读出来发现没什么可补」的扫描（那次扫描挂在第一条派活指令上）。
    task_url_backfilled: 1,
    task_base_link_share_closed: 0,
    url: '',
    link_share_closed: 0,
    index_record_id: null,
    created_by: input.createdBy,
    created_by_name: input.createdByName,
    created_at: now,
    updated_at: now,
  };
  try {
    db.prepare(
      `INSERT INTO feishu_diary_projects
         (id, app_id, chat_id, chat_name, name, base_app_token, record_table_id, review_table_id,
          task_table_id, task_view_id, link_table_id, task_link_table_id,
          task_base_app_token, task_base_table_id, task_base_url, task_field_map,
          task_board_view_id, task_person_view_id, task_gantt_view_id, task_url_backfilled,
          task_base_link_share_closed,
          url, link_share_closed, index_record_id, created_by, created_by_name, created_at, updated_at)
       VALUES (@id, @app_id, @chat_id, @chat_name, @name, @base_app_token, @record_table_id,
               @review_table_id, @task_table_id, @task_view_id,
               @link_table_id, @task_link_table_id,
               @task_base_app_token, @task_base_table_id, @task_base_url, @task_field_map,
               @task_board_view_id, @task_person_view_id, @task_gantt_view_id,
               @task_url_backfilled, @task_base_link_share_closed,
               @url, @link_share_closed, @index_record_id, @created_by,
               @created_by_name, @created_at, @updated_at)`
    ).run(row);
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    // 撞了哪一条约束要分开报：「这个群已经有项目了」和「这个名字被别的群用了」
    // 是两件事，解法也不同（去那个群里记 / 换个名字）。
    const byChat = getProjectByChat(input.appId, input.chatId);
    if (byChat) throw new ProjectConflictError('chat', byChat);
    const byName = findProjectByName(input.appId, input.name);
    if (byName) throw new ProjectConflictError('name', byName);
    throw e;
  }
  return row;
}

/**
 * 改项目名。
 *
 * 存在的理由很具体：项目名是**建的时候一句话说定的**（「新建项目：印度纪录片」），
 * 而那句话是语音转文字或顺手打的 —— 打错字、少个字、后来正式定名换了个说法，
 * 都很常见。在没有这个函数的年代唯一的出路是「另建一个群」，因为
 * `(app_id, chat_id)` 是 UNIQUE 的，同一个群改不了名也建不了第二个。
 *
 * 只改名，**不动那些 id**（base_app_token / 各表 id / index_record_id）：
 * 多维表格那侧的 base 名字里带着旧项目名，改它要再调一次接口，失败了不该
 * 让改名整体失败 —— 库里的名字才是数据源。调用方负责把表格那侧尽力刷一下。
 *
 * 重名照旧要拒（`(app_id, name)` UNIQUE）：允许两个项目同名的话，
 * 「记到 XXX」就分不出是哪一个，而它记错了是不会报错的。
 */
export function renameProject(id: string, name: string): DiaryProjectRow {
  const db = getDatabase();
  const trimmed = name.trim();
  const current = getProjectById(id);
  if (!current) throw new Error('项目不存在');
  try {
    db.prepare('UPDATE feishu_diary_projects SET name = ?, updated_at = ? WHERE id = ?').run(
      trimmed,
      new Date().toISOString(),
      id
    );
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    // 只可能撞名字（chat_id 没动）。抛的是同一个错误类型，于是动作层那套
    // 「换个名字吧」的话术可以原样复用。
    const byName = findProjectByName(current.app_id, trimmed);
    throw new ProjectConflictError('name', byName ?? current);
  }
  return getProjectById(id)!;
}

/** 建表成功后回填。失败时调用方会 dropProject，所以这里不处理部分成功。 */
export function attachProjectBitable(
  id: string,
  input: {
    baseAppToken: string;
    recordTableId: string;
    reviewTableId: string;
    url: string;
    linkShareClosed: boolean;
  }
): void {
  getDatabase()
    .prepare(
      `UPDATE feishu_diary_projects
       SET base_app_token = ?, record_table_id = ?, review_table_id = ?,
           url = ?, link_share_closed = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      input.baseAppToken,
      input.recordTableId,
      input.reviewTableId,
      input.url,
      input.linkShareClosed ? 1 : 0,
      new Date().toISOString(),
      id
    );
}

/**
 * 老「任务」表（068）已经从飞书那侧删掉了 —— 把这两列清空。
 *
 * 这两列非空 = 「飞书那边还有那张表」，所以只能在 appTable.delete 真的成功之后
 * 才清（bitable.dropTaskTable）。提前清掉的后果是那张表永远留在用户的日记文档里，
 * 而我们再也不会去删它：一个和任务管理表内容不一致、还在被人看的僵尸 tab。
 */
export function clearProjectTaskTable(id: string): void {
  getDatabase()
    .prepare(
      "UPDATE feishu_diary_projects SET task_table_id = '', task_view_id = '', updated_at = ? WHERE id = ?"
    )
    .run(new Date().toISOString(), id);
}

/** 「🔗 相关链接」表建出来了（074）。两个 base 各一张，所以分两个键。 */
export function setLinkTable(id: string, which: 'diary' | 'task', tableId: string): void {
  const col = which === 'diary' ? 'link_table_id' : 'task_link_table_id';
  getDatabase()
    .prepare(`UPDATE feishu_diary_projects SET ${col} = ?, updated_at = ? WHERE id = ?`)
    .run(tableId, new Date().toISOString(), id);
}

/**
 * 回填独立任务 base 的坐标（070）。
 *
 * 单独一个 setter 而不是并进 attachProjectBitable：070 之前建的项目已经有日志
 * base 了，它们的任务 base 是**第一次派任务时**补建的（taskBase.ensureTaskBase）。
 * 走整行回填的那个函数会把 url / link_share_closed 一起重写，而补建时手上并没有
 * 这些值 —— 传空串下去等于把用户的日志表链接抹掉。
 *
 * 视图 id 和 fieldMap 允许为空：表建出来了但视图没建成/字段清单没读到时，
 * 任务照样能写进去（见 taskBase.resolveFieldNames 的降级分支）。
 */
export function attachTaskBase(
  id: string,
  input: {
    appToken: string;
    tableId: string;
    url: string;
    fieldMap: Record<string, string>;
    boardViewId: string;
    personViewId: string;
    ganttViewId?: string;
    linkShareClosed: boolean;
  }
): void {
  getDatabase()
    .prepare(
      `UPDATE feishu_diary_projects
       SET task_base_app_token = ?, task_base_table_id = ?, task_base_url = ?,
           task_field_map = ?, task_board_view_id = ?, task_person_view_id = ?,
           task_gantt_view_id = ?, task_base_link_share_closed = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      input.appToken,
      input.tableId,
      input.url,
      Object.keys(input.fieldMap).length ? JSON.stringify(input.fieldMap) : '',
      input.boardViewId,
      input.personViewId,
      input.ganttViewId ?? '',
      input.linkShareClosed ? 1 : 0,
      new Date().toISOString(),
      id
    );
}

/**
 * 补一列之后把新的 field_id 存回去。
 *
 * 单独一个 setter 是必须的：070 之前建的任务表缺后来加的列（现在是「飞书任务」），
 * 补列的代码在派活路径上会被反复执行，而它是否再调一次飞书接口**只看这个映射里
 * 有没有那个键**。不存回去的话每次派活都会再 create 一次同名字段 ——
 * 飞书那边报重名（于是每次派活都带一句莫名的 warning），或者更糟：真加出第二列。
 */
export function setTaskFieldMap(id: string, fieldMap: Record<string, string>): void {
  getDatabase()
    .prepare('UPDATE feishu_diary_projects SET task_field_map = ?, updated_at = ? WHERE id = ?')
    .run(
      Object.keys(fieldMap).length ? JSON.stringify(fieldMap) : '',
      new Date().toISOString(),
      id
    );
}

/** 甘特视图建好之后回填（072）。空串意味着「还没建过」，见那个迁移的文件头。 */
export function setTaskGanttView(id: string, viewId: string): void {
  getDatabase()
    .prepare('UPDATE feishu_diary_projects SET task_gantt_view_id = ?, updated_at = ? WHERE id = ?')
    .run(viewId, new Date().toISOString(), id);
}

/**
 * 「老行的『飞书任务』列已经回填完了」（073）。
 *
 * **只在真的回填成功之后置位。** 失败时留着 0 是刻意的：下一次派活会再试一遍。
 * 提前置位的后果没有任何声响 —— 那些老行的链接列永远是空的，而库里那份任务
 * （guid 的另一个来源）将来要砍掉，砍掉之后就再也找不回来了。
 */
export function markTaskUrlBackfilled(id: string): void {
  getDatabase()
    .prepare(
      'UPDATE feishu_diary_projects SET task_url_backfilled = 1, updated_at = ? WHERE id = ?'
    )
    .run(new Date().toISOString(), id);
}

export function setProjectIndexRecord(id: string, recordId: string): void {
  getDatabase()
    .prepare('UPDATE feishu_diary_projects SET index_record_id = ?, updated_at = ? WHERE id = ?')
    .run(recordId, new Date().toISOString(), id);
}

/**
 * 删掉占位行。**只在建表失败的回滚路径上调用。**
 *
 * 不删已有的记录：占位行还没来得及被记录引用，正常不会有。
 * 保险起见连带删掉，否则那些记录会挂在一个查不到的 project_id 下，
 * 既进不了表格也没人看得见。
 */
export function dropProject(id: string): void {
  const db = getDatabase();
  db.transaction(() => {
    db.prepare('DELETE FROM feishu_diary_records WHERE project_id = ?').run(id);
    db.prepare('DELETE FROM feishu_diary_summaries WHERE project_id = ?').run(id);
    // 任务**只解绑、不删**（这是和记录/复盘不同的地方）。
    //
    // 这个函数只在「建表失败要回滚占位行」那条路上被调用，而占位行是刚建的，
    // 正常挂不上任务。但万一挂上了：任务在飞书那侧是真的建出来了（有 guid、
    // 在负责人的待办列表里），库里删掉只会让「改一下那个任务」再也找不到它，
    // 而它还在提醒着人。project_id 置空 = 退化成一条不属于任何项目的待办，
    // 这正是没绑项目的群里派活时的形态，后面的路径全都成立。
    db.prepare('UPDATE feishu_project_tasks SET project_id = NULL WHERE project_id = ?').run(id);
    db.prepare('DELETE FROM feishu_diary_projects WHERE id = ?').run(id);
  })();
}

// ── 记录 ──

/**
 * 落一条记录。返回既有行时 `created` 为 false（同一条消息的同一步重放）。
 *
 * 幂等键是 (app_id, message_id, step_index)：飞书**成功也会重投**事件
 * （at-least-once），而 claimEvent 只在同一进程/同一张库里挡得住。
 * 真正保证「一条消息只记一行」的是这里的 UNIQUE。
 */
export function insertRecord(input: {
  appId: string;
  projectId: string;
  content: string;
  sourceText?: string;
  authorOpenId: string;
  authorName: string;
  messageId: string;
  stepIndex: number;
  /** 缺省 `manual`（人说的原话）。群聊摘要要显式传 `chat_digest`，见 069。 */
  origin?: RecordOrigin;
  digestRange?: string;
}): { row: DiaryRecordRow; created: boolean } {
  const db = getDatabase();
  const now = new Date();
  const row: DiaryRecordRow = {
    id: uuidv4(),
    app_id: input.appId,
    project_id: input.projectId,
    content: input.content,
    source_text: input.sourceText ?? '',
    author_open_id: input.authorOpenId,
    author_name: input.authorName,
    message_id: input.messageId,
    step_index: input.stepIndex,
    created_ms: now.getTime(),
    created_at: now.toISOString(),
    bitable_synced_at: null,
    origin: input.origin ?? 'manual',
    digest_range: input.digestRange ?? '',
  };
  try {
    db.prepare(
      `INSERT INTO feishu_diary_records
         (id, app_id, project_id, content, source_text, author_open_id, author_name,
          message_id, step_index, created_ms, created_at, bitable_synced_at,
          origin, digest_range)
       VALUES (@id, @app_id, @project_id, @content, @source_text, @author_open_id, @author_name,
               @message_id, @step_index, @created_ms, @created_at, @bitable_synced_at,
               @origin, @digest_range)`
    ).run(row);
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    const existing = db
      .prepare(
        'SELECT * FROM feishu_diary_records WHERE app_id = ? AND message_id = ? AND step_index = ?'
      )
      .get(input.appId, input.messageId, input.stepIndex) as DiaryRecordRow | undefined;
    if (existing) return { row: existing, created: false };
    throw e;
  }
  return { row, created: true };
}

/** 时间范围内的记录，按时间正序（复盘要按事情发生的顺序读）。 */
export function listRecords(
  projectId: string,
  range?: { startMs?: number; endMs?: number; limit?: number }
): DiaryRecordRow[] {
  const clauses = ['project_id = ?'];
  const params: unknown[] = [projectId];
  if (range?.startMs !== undefined) {
    clauses.push('created_ms >= ?');
    params.push(range.startMs);
  }
  if (range?.endMs !== undefined) {
    clauses.push('created_ms < ?');
    params.push(range.endMs);
  }
  // limit 是"取最近 N 条"，所以要先倒序截断、再翻回正序 ——
  // 正序 LIMIT 会截掉**最近**那些，正好是复盘最需要的部分。
  const limit = range?.limit;
  const sql = limit
    ? `SELECT * FROM (SELECT * FROM feishu_diary_records WHERE ${clauses.join(' AND ')}
         ORDER BY created_ms DESC LIMIT ${Number(limit)}) ORDER BY created_ms ASC`
    : `SELECT * FROM feishu_diary_records WHERE ${clauses.join(' AND ')} ORDER BY created_ms ASC`;
  return getDatabase().prepare(sql).all(...params) as DiaryRecordRow[];
}

/** 还没推进多维表格的记录（含历史欠账），按时间正序补推。 */
export function listUnsyncedRecords(projectId: string, limit = 200): DiaryRecordRow[] {
  return getDatabase()
    .prepare(
      `SELECT * FROM feishu_diary_records
       WHERE project_id = ? AND bitable_synced_at IS NULL
       ORDER BY created_ms ASC LIMIT ?`
    )
    .all(projectId, limit) as DiaryRecordRow[];
}

/**
 * 标记已同步。**在一个事务里批量置位**，理由同 tender：
 * 逐条提交时进程在中途挂掉，会留下"表格里有行、库里状态位没置"的记录，
 * 下次补推重复写入。
 */
export function markRecordsSynced(ids: string[]): void {
  if (!ids.length) return;
  const db = getDatabase();
  const now = new Date().toISOString();
  const stmt = db.prepare('UPDATE feishu_diary_records SET bitable_synced_at = ? WHERE id = ?');
  db.transaction(() => {
    for (const id of ids) stmt.run(now, id);
  })();
}

export function countRecords(projectId: string): number {
  const row = getDatabase()
    .prepare('SELECT COUNT(*) AS n FROM feishu_diary_records WHERE project_id = ?')
    .get(projectId) as { n: number };
  return row.n;
}

/**
 * 同一段时间已经被总结过几次（migration 069）。
 *
 * 不用来拦第二次 —— 上午总结过、下午又聊了两小时是常态，拦掉等于让下午的事
 * 永远进不了日志。用来**在回帖里说出「这是今天的第 2 版」**：
 * 少了这句，日志里会出现三条内容七成重合的摘要，而看的人会以为群里真的
 * 把同一件事讨论了三轮。
 */
export function countDigests(projectId: string, digestRange: string): number {
  if (!digestRange) return 0;
  // 数的是**总结过几次**，不是落了几行 —— 一次总结会写进好几条记录，
  // 用 COUNT(*) 的话第二次总结会报成「第 6 份」（上次写了 5 条）。
  // 一次总结共用同一条指令消息，所以 DISTINCT message_id 就是次数。
  const row = getDatabase()
    .prepare(
      `SELECT COUNT(DISTINCT message_id) AS n FROM feishu_diary_records
        WHERE project_id = ? AND digest_range = ?`
    )
    .get(projectId, digestRange) as { n: number };
  return row.n;
}

/**
 * 网页端「项目日记」页用的一页记录，**最新的在前**。
 *
 * 和 listRecords 反着排是有意的：那个是喂给 LLM 的，必须按事情发生的顺序读；
 * 这个是给人翻的，人打开页面想看的是「最近记了什么」。
 */
export function listRecordsPage(
  projectId: string,
  opts: { limit: number; offset: number }
): { records: DiaryRecordRow[]; total: number } {
  const db = getDatabase();
  const total = (
    db
      .prepare('SELECT COUNT(*) AS n FROM feishu_diary_records WHERE project_id = ?')
      .get(projectId) as { n: number }
  ).n;
  const records = db
    .prepare(
      `SELECT * FROM feishu_diary_records WHERE project_id = ?
       ORDER BY created_ms DESC LIMIT ? OFFSET ?`
    )
    .all(projectId, opts.limit, opts.offset) as DiaryRecordRow[];
  return { records, total };
}

export function listSummariesPage(
  projectId: string,
  opts: { limit: number; offset: number }
): { summaries: DiarySummaryRow[]; total: number } {
  const db = getDatabase();
  const total = (
    db
      .prepare('SELECT COUNT(*) AS n FROM feishu_diary_summaries WHERE project_id = ?')
      .get(projectId) as { n: number }
  ).n;
  const summaries = db
    .prepare(
      `SELECT * FROM feishu_diary_summaries WHERE project_id = ?
       ORDER BY created_at DESC LIMIT ? OFFSET ?`
    )
    .all(projectId, opts.limit, opts.offset) as DiarySummaryRow[];
  return { summaries, total };
}

export interface DiaryProjectStats {
  record_count: number;
  /**
   * 其中有几条是 LLM 从群聊里总结出来的（069 的 `chat_digest`）。
   *
   * 单独列出来是因为这两种记录的**可信度不一样**：其余那些是人说的原话，
   * 这些是模型写的散文。混在一个 record_count 里的话，「这个项目记了 40 条」
   * 读起来像 40 条一手信息，而实际可能有 30 条是每天自动总结出来的。
   */
  digest_count: number;
  /** 还没推进多维表格的条数。**必须露出来**：这是"库里有、表里没有"的唯一提示。 */
  unsynced_count: number;
  /** 最后一条记录的时间（毫秒）。null = 一条都没记过。 */
  last_record_ms: number | null;
  summary_count: number;
  last_summary_at: string | null;
  /** 任务总数 / 未完成数（068）。网页侧显示「12 个任务，4 个未完成」。 */
  task_count: number;
  open_task_count: number;
  /** 任务里还没推进多维表格的条数。和记录的 unsynced_count 同理，必须露出来。 */
  unsynced_task_count: number;
}

/**
 * 一个项目的统计初值。
 *
 * **导出**是因为接口层也要用它兜「这个项目一条记录都还没有」的情况 ——
 * 那边原来抄了一份字面量，于是这里加字段（task_count / digest_count）时
 * 抄的那份没跟上：新项目返回的对象少几个键，而前端读到 undefined
 * 渲染成空白 —— 看起来和「有数据但是 0」完全一样，谁都不会去查。
 */
export function emptyStats(): DiaryProjectStats {
  return {
    record_count: 0,
    digest_count: 0,
    unsynced_count: 0,
    last_record_ms: null,
    summary_count: 0,
    last_summary_at: null,
    task_count: 0,
    open_task_count: 0,
    unsynced_task_count: 0,
  };
}

/**
 * 一次性把本应用所有项目的统计查出来。
 *
 * 三条聚合查询而不是每个项目查六次：项目数量虽然不大（一个群一个），
 * 但这个接口是页面打开就调的，N+1 在这里没有任何好处。
 */
export function projectStats(appId: string): Record<string, DiaryProjectStats> {
  const db = getDatabase();
  const out: Record<string, DiaryProjectStats> = {};
  /** 取（必要时建）某个项目那一格。三条查询各自可能先见到一个项目。 */
  const slot = (projectId: string) => (out[projectId] ??= emptyStats());

  const rec = db
    .prepare(
      `SELECT project_id,
              COUNT(*) AS n,
              SUM(CASE WHEN origin = 'chat_digest' THEN 1 ELSE 0 END) AS digest_n,
              SUM(CASE WHEN bitable_synced_at IS NULL THEN 1 ELSE 0 END) AS unsynced,
              MAX(created_ms) AS last_ms
       FROM feishu_diary_records WHERE app_id = ? GROUP BY project_id`
    )
    .all(appId) as Array<{
    project_id: string;
    n: number;
    digest_n: number;
    unsynced: number;
    last_ms: number;
  }>;
  for (const r of rec) {
    const cur = slot(r.project_id);
    cur.record_count = r.n;
    cur.digest_count = r.digest_n;
    cur.unsynced_count = r.unsynced;
    cur.last_record_ms = r.last_ms;
  }

  const sum = db
    .prepare(
      `SELECT project_id, COUNT(*) AS n, MAX(created_at) AS last_at
       FROM feishu_diary_summaries WHERE app_id = ? GROUP BY project_id`
    )
    .all(appId) as Array<{ project_id: string; n: number; last_at: string }>;
  for (const s of sum) {
    const cur = slot(s.project_id);
    cur.summary_count = s.n;
    cur.last_summary_at = s.last_at;
  }

  // 任务（068）。`project_id IS NOT NULL` 是必需的：没绑项目的群里派的活
  // project_id 为 NULL，GROUP BY 会给它们凑成一格，键是 null ——
  // 挂到 out 上就成了一个叫 "null" 的假项目，前端会照着渲染一行。
  const task = db
    .prepare(
      `SELECT project_id,
              COUNT(*) AS n,
              SUM(CASE WHEN status IN ('todo','doing') THEN 1 ELSE 0 END) AS open_n,
              SUM(CASE WHEN bitable_synced_at IS NULL THEN 1 ELSE 0 END) AS unsynced
       FROM feishu_project_tasks
       WHERE app_id = ? AND project_id IS NOT NULL GROUP BY project_id`
    )
    .all(appId) as Array<{ project_id: string; n: number; open_n: number; unsynced: number }>;
  for (const t of task) {
    const cur = slot(t.project_id);
    cur.task_count = t.n;
    cur.open_task_count = t.open_n;
    cur.unsynced_task_count = t.unsynced;
  }
  return out;
}

// ── 任务（migration 068）──

/**
 * 落一条任务。返回既有行时 `created` 为 false（同一条消息的同一步重放）。
 *
 * 幂等键和记录表一样是 (app_id, message_id, step_index)，理由也一样：
 * 飞书**成功也会重投**事件，claimEvent 只在同一张库里挡得住。
 * 差别是这张表的唯一索引是**部分索引**（`WHERE message_id != ''`），
 * 因为网页侧/将来的定时任务建的任务没有消息 id，而空串在 SQLite 里是正常值 ——
 * 全表 UNIQUE 的话第二条无消息任务会撞。
 */
export function insertTask(input: {
  appId: string;
  projectId?: string | null;
  title: string;
  content?: string;
  ownerOpenId?: string;
  ownerName?: string;
  startMs?: number | null;
  endMs?: number | null;
  status: string;
  guid?: string;
  url?: string;
  createdBy: string;
  createdByName: string;
  messageId?: string;
  stepIndex?: number;
}): { row: FeishuProjectTaskRow; created: boolean } {
  const db = getDatabase();
  const now = new Date();
  const row: FeishuProjectTaskRow = {
    id: uuidv4(),
    app_id: input.appId,
    project_id: input.projectId ?? null,
    title: input.title,
    content: input.content ?? '',
    owner_open_id: input.ownerOpenId ?? '',
    owner_name: input.ownerName ?? '',
    start_ms: input.startMs ?? null,
    end_ms: input.endMs ?? null,
    status: input.status,
    guid: input.guid ?? '',
    url: input.url ?? '',
    created_by: input.createdBy,
    created_by_name: input.createdByName,
    message_id: input.messageId ?? '',
    step_index: input.stepIndex ?? 0,
    created_ms: now.getTime(),
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    bitable_synced_at: null,
    bitable_record_id: '',
  };
  try {
    db.prepare(
      `INSERT INTO feishu_project_tasks
         (id, app_id, project_id, title, content, owner_open_id, owner_name, start_ms, end_ms,
          status, guid, url, created_by, created_by_name, message_id, step_index,
          created_ms, created_at, updated_at, bitable_synced_at, bitable_record_id)
       VALUES (@id, @app_id, @project_id, @title, @content, @owner_open_id, @owner_name,
               @start_ms, @end_ms, @status, @guid, @url, @created_by, @created_by_name,
               @message_id, @step_index, @created_ms, @created_at, @updated_at,
               @bitable_synced_at, @bitable_record_id)`
    ).run(row);
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    const existing = db
      .prepare(
        `SELECT * FROM feishu_project_tasks
         WHERE app_id = ? AND message_id = ? AND step_index = ?`
      )
      .get(input.appId, input.messageId ?? '', input.stepIndex ?? 0) as
      | FeishuProjectTaskRow
      | undefined;
    if (existing) return { row: existing, created: false };
    throw e;
  }
  return { row, created: true };
}

/**
 * 按「哪条消息的第几步建的」找库里那一行。
 *
 * 用途只有一个：目标是从**任务管理表**里认出来的（表里那一行带着这个标记），
 * 而库里那份还要跟着改一次（甘特图从库里推）。用标题回查是错的 —— 表是开放编辑的，
 * 用户改过标题之后库里还是旧名字，回查不到就静默漏掉库和甘特图那两处，
 * 而回帖照样是「✅ 已更新」。
 */
export function findTaskByMessage(
  appId: string,
  messageId: string,
  stepIndex: number
): FeishuProjectTaskRow | undefined {
  if (!messageId) return undefined;
  return getDatabase()
    .prepare(
      'SELECT * FROM feishu_project_tasks WHERE app_id = ? AND message_id = ? AND step_index = ?'
    )
    .get(appId, messageId, stepIndex) as FeishuProjectTaskRow | undefined;
}

export function getTaskById(id: string): FeishuProjectTaskRow | undefined {
  return getDatabase().prepare('SELECT * FROM feishu_project_tasks WHERE id = ?').get(id) as
    | FeishuProjectTaskRow
    | undefined;
}

/**
 * 改一条任务。
 *
 * **只更新明确传进来的字段**（`undefined` 的一律不碰），这条和飞书 `task.patch` 的
 * `update_fields` 是同一个坑：顺手把整行写一遍会静默清掉用户之前设的截止时间
 * 或负责人，而回帖说的是「已更新」。
 *
 * 任何一次改动都把 `bitable_synced_at` 清空 —— 那一行在表里已经过期了，
 * 得重新推一次。这是本函数最容易漏的一步：不清的话库里改了、甘特图上没动，
 * 而甘特图正是这个功能的产出。
 */
export function updateTask(
  id: string,
  patch: {
    title?: string;
    content?: string;
    ownerOpenId?: string;
    ownerName?: string;
    startMs?: number | null;
    endMs?: number | null;
    status?: string;
    guid?: string;
    url?: string;
    projectId?: string | null;
  }
): FeishuProjectTaskRow | undefined {
  const sets: string[] = [];
  const params: unknown[] = [];
  const put = (col: string, v: unknown) => {
    sets.push(`${col} = ?`);
    params.push(v);
  };
  if (patch.title !== undefined) put('title', patch.title);
  if (patch.content !== undefined) put('content', patch.content);
  if (patch.ownerOpenId !== undefined) put('owner_open_id', patch.ownerOpenId);
  if (patch.ownerName !== undefined) put('owner_name', patch.ownerName);
  if (patch.startMs !== undefined) put('start_ms', patch.startMs);
  if (patch.endMs !== undefined) put('end_ms', patch.endMs);
  if (patch.status !== undefined) put('status', patch.status);
  if (patch.guid !== undefined) put('guid', patch.guid);
  if (patch.url !== undefined) put('url', patch.url);
  if (patch.projectId !== undefined) put('project_id', patch.projectId);
  if (!sets.length) return getTaskById(id);

  // 改了就等于表里那行过期了，必须重推。见函数注释。
  sets.push('bitable_synced_at = NULL');
  put('updated_at', new Date().toISOString());
  getDatabase()
    .prepare(`UPDATE feishu_project_tasks SET ${sets.join(', ')} WHERE id = ?`)
    .run(...params, id);
  return getTaskById(id);
}

/**
 * 一个项目的任务，按开始时间排（甘特图的读法）。
 *
 * 没有开始时间的排在**最后**而不是最前：`start_ms IS NULL` 的行在甘特图上是个点，
 * 混在有横条的行中间会让整张图看起来乱。SQLite 的 NULL 默认排最前，所以显式写。
 */
export function listTasks(
  projectId: string,
  opts?: { status?: string[]; limit?: number }
): FeishuProjectTaskRow[] {
  const clauses = ['project_id = ?'];
  const params: unknown[] = [projectId];
  if (opts?.status?.length) {
    clauses.push(`status IN (${opts.status.map(() => '?').join(',')})`);
    params.push(...opts.status);
  }
  const sql =
    `SELECT * FROM feishu_project_tasks WHERE ${clauses.join(' AND ')}` +
    ` ORDER BY start_ms IS NULL, start_ms ASC, created_ms ASC` +
    (opts?.limit ? ` LIMIT ${Number(opts.limit)}` : '');
  return getDatabase().prepare(sql).all(...params) as FeishuProjectTaskRow[];
}

/**
 * 记下任务管理表里那一行，并置同步位。
 *
 * 没有「补推」这条路了（老「任务」表删掉之后写表失败是整条指令失败），所以这一位
 * 现在只有一个用处：**统计里那个「N 个任务未同步」**。它必须诚实 ——
 * 派活时写表失败会抛错，库里那行留着而表里没有，而用户已经看到一句红字之后
 * 大概不会去数；这个计数是他事后唯一能看见的缺口。
 */
export function markTaskSynced(id: string, recordId: string): void {
  getDatabase()
    .prepare(
      'UPDATE feishu_project_tasks SET bitable_synced_at = ?, bitable_record_id = ? WHERE id = ?'
    )
    .run(new Date().toISOString(), recordId, id);
}

/**
 * 「改一下那个任务」→ 具体是哪条。
 *
 * 关键词匹配的归一化和 actions/recent.ts 的 `norm` **必须一致**（去掉所有空白 +
 * 小写）：中文里空格可有可无，「xzy8 月飞书 skill 开发」和「xzy8月飞书skill开发」
 * 在用户眼里是同一个东西。用 SQL 的 LIKE 做不到这件事（它不会忽略空白），
 * 所以取出候选之后在 JS 里筛 —— 候选集本来就只有几十行。
 *
 * 范围是 app + 说话人，和 recent.ts 一样：跨应用是跨企业，跨人是改别人的东西。
 * **但不限 7 天**，这正是这张表存在的理由之一（一个季度的项目派活要查得到）。
 *
 * 已取消的任务仍然在候选里：「那个取消的任务重新打开」是正常说法。
 * 排序是最近的在前，让调用方（歧义时列给用户挑）先列近的。
 */
export function findTasksByKeyword(input: {
  appId: string;
  senderOpenId?: string;
  keyword?: string;
  limit?: number;
}): FeishuProjectTaskRow[] {
  const clauses = ['app_id = ?'];
  const params: unknown[] = [input.appId];
  if (input.senderOpenId) {
    // 自己派的 + 派给自己的都算「我的任务」：在项目群里 A 派给 B 的活，
    // B 说「那个任务做完了」是最自然的说法，而按 created_by 单独筛会让他找不到。
    clauses.push('(created_by = ? OR owner_open_id = ?)');
    params.push(input.senderOpenId, input.senderOpenId);
  }
  const rows = getDatabase()
    .prepare(
      `SELECT * FROM feishu_project_tasks WHERE ${clauses.join(' AND ')}
       ORDER BY created_ms DESC LIMIT ?`
    )
    .all(...params, input.limit ?? 200) as FeishuProjectTaskRow[];

  const kw = normKeyword(input.keyword ?? '');
  if (!kw) return rows;
  return rows.filter((r) => normKeyword(`${r.title}\n${r.content}`).includes(kw));
}

/** 和 actions/recent.ts 的 norm 同一套规则，改一处要改两处。 */
function normKeyword(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '');
}

// ── 复盘 ──

export function insertSummary(input: {
  appId: string;
  projectId: string;
  rangeLabel: string;
  rangeStartMs?: number;
  rangeEndMs?: number;
  recordCount: number;
  summary: string;
  createdBy: string;
  createdByName: string;
}): DiarySummaryRow {
  const now = new Date().toISOString();
  const row: DiarySummaryRow = {
    id: uuidv4(),
    app_id: input.appId,
    project_id: input.projectId,
    range_label: input.rangeLabel,
    range_start_ms: input.rangeStartMs ?? null,
    range_end_ms: input.rangeEndMs ?? null,
    record_count: input.recordCount,
    summary: input.summary,
    created_by: input.createdBy,
    created_by_name: input.createdByName,
    created_at: now,
    bitable_synced_at: null,
  };
  getDatabase()
    .prepare(
      `INSERT INTO feishu_diary_summaries
         (id, app_id, project_id, range_label, range_start_ms, range_end_ms, record_count,
          summary, created_by, created_by_name, created_at, bitable_synced_at)
       VALUES (@id, @app_id, @project_id, @range_label, @range_start_ms, @range_end_ms,
               @record_count, @summary, @created_by, @created_by_name, @created_at,
               @bitable_synced_at)`
    )
    .run(row);
  return row;
}

export function markSummarySynced(id: string): void {
  getDatabase()
    .prepare('UPDATE feishu_diary_summaries SET bitable_synced_at = ? WHERE id = ?')
    .run(new Date().toISOString(), id);
}

/**
 * 删掉一个项目：库里的记录、复盘、项目行全清，任务只解绑。
 *
 * 和 `dropProject` 分开的是**语义**，不是实现：那个是「建表失败了，回滚刚占的位」，
 * 这个是用户在网页上按了删除。合成一个的话，回滚路径上任何一次注释调整都会
 * 悄悄改变用户删除的行为（或者反过来）—— 而两边都没有测试盯着这件事。
 *
 * ── 飞书那侧的表**不删**，项目总表里那一行也**不动** ──
 * 只解除关联。多维表格里是这家公司的项目日志和任务，而删除是一次网页点击 ——
 * 顺手把云文档也删掉的话，用户按错一下就丢掉全部历史，而我们既没有回收站
 * 也没有第二份（070 之后任务**只存在**于表格里）。所以把整行原样返回，
 * 让调用方在回执里把那几个链接给出来：这一步过后表还在，只是助理不再认识它们。
 * 总表里那一行同理留着 —— 它正是"事后还能找回这几张表"的唯一途径
 * （表不在任何人的云文档空间里，飞书里搜不到）。代价是总表继续列着一个
 * 助理已经不认识的项目，用户回那个群说「记一下」会得到「本群还没有项目」。
 *
 * 群和项目的绑定（chat_id 的 UNIQUE）随项目行一起消失 —— 也就是说这个群之后
 * 可以重新「新建项目」，而**新项目会另建一套表**，老表和它没有关系。
 */
export function deleteProject(
  id: string
): { project: DiaryProjectRow; recordCount: number; summaryCount: number } | undefined {
  const db = getDatabase();
  const project = getProjectById(id);
  if (!project) return undefined;

  const counts = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM feishu_diary_records WHERE project_id = ?) AS records,
         (SELECT COUNT(*) FROM feishu_diary_summaries WHERE project_id = ?) AS summaries`
    )
    .get(id, id) as { records: number; summaries: number };

  db.transaction(() => {
    db.prepare('DELETE FROM feishu_diary_records WHERE project_id = ?').run(id);
    db.prepare('DELETE FROM feishu_diary_summaries WHERE project_id = ?').run(id);
    // 任务只解绑，理由同 dropProject：飞书那侧的任务是真的建出来了
    // （在负责人的待办列表里提醒着人），库里删掉只会让「改一下那个任务」
    // 再也找不到它。置空 = 退化成一条不属于任何项目的待办。
    db.prepare('UPDATE feishu_project_tasks SET project_id = NULL WHERE project_id = ?').run(id);
    db.prepare('DELETE FROM feishu_diary_projects WHERE id = ?').run(id);
  })();

  return { project, recordCount: counts.records, summaryCount: counts.summaries };
}

/** 解绑应用时清掉。和名册（057）、会话（058）一样按 app_id，没有外键级联。 */
export function deleteDiaryData(appId: string): void {
  const db = getDatabase();
  db.transaction(() => {
    db.prepare('DELETE FROM feishu_diary_records WHERE app_id = ?').run(appId);
    db.prepare('DELETE FROM feishu_diary_summaries WHERE app_id = ?').run(appId);
    // 任务这里是**真删**（和 dropProject 里只解绑不同）：那边是回滚一个建失败的
    // 项目，应用还在；这里是解绑整个应用 —— 助理不再连那个租户，
    // 留着任务行只会让下次绑同一个 app_id 时冒出一批查不到项目的旧任务。
    db.prepare('DELETE FROM feishu_project_tasks WHERE app_id = ?').run(appId);
    db.prepare('DELETE FROM feishu_diary_projects WHERE app_id = ?').run(appId);
    db.prepare('DELETE FROM feishu_diary_indexes WHERE app_id = ?').run(appId);
  })();
}

