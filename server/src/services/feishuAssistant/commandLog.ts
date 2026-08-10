import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../../db/index.js';
import { isUniqueViolation } from '../../db/sqliteError.js';

// 指令执行日志 + 事件去重。
//
// 日志不是可选的运维糖：@ 一下没反应时，这是唯一能区分
// 「事件没收到」/「意图没解析出来」/「飞书接口报错」三种情况的东西。

export interface CommandRow {
  id: string;
  app_id: string;
  user_id: string;
  message_id: string;
  chat_id: string;
  chat_type: string;
  sender_open_id: string;
  sender_name: string;
  text: string;
  action: string | null;
  params: string | null;
  status: string;
  error: string | null;
  /** FeishuErrorDetail 的 JSON。前端据此渲染「一键补权限」，见 migration 055。 */
  error_detail: string | null;
  result: string | null;
  duration_ms: number | null;
  created_at: string;
  completed_at: string | null;
}

/**
 * 登记一条事件；返回 false 表示这条 message_id 已经处理过（重复推送），应当直接丢弃。
 *
 * 用 INSERT 的主键冲突来判断，而不是先 SELECT 再 INSERT ——
 * 后者在同一条消息被并发投递两次时会双双通过检查（飞书重推间隔虽长，
 * 但重连瞬间补推 + 正常推送同时到达是真实存在的）。
 *
 * **只把主键冲突当"已处理"，别的错一律抛出去。** 这里以前是个 `catch {}`，
 * 于是任何库故障（磁盘满、库被锁、表结构没迁移到位）都会被读成
 * 「这条消息处理过了」，dispatcher 于是安静地 return —— 用户 @ 了没反应，
 * 服务端一行日志都没有，连指令日志里都不会有那条 pending 行可查。
 * 而这类故障恰恰是**每一条**消息都会撞上的，也就是整个模块彻底哑掉，
 * 表现成"偶尔不灵"里最难查的那一种。抛出去的话至少落进 dispatcher 的收口，
 * 有一条服务端错误日志。
 */
export function claimEvent(messageId: string, appId: string, nowIso: string): boolean {
  try {
    getDatabase()
      .prepare('INSERT INTO feishu_events (message_id, app_id, received_at) VALUES (?, ?, ?)')
      .run(messageId, appId, nowIso);
    return true;
  } catch (e) {
    if (isUniqueViolation(e)) return false;
    throw e;
  }
}

export function startCommand(input: {
  appId: string;
  userId: string;
  messageId: string;
  chatId: string;
  chatType: string;
  senderOpenId: string;
  senderName: string;
  text: string;
}): string {
  const id = uuidv4();
  getDatabase()
    .prepare(
      `INSERT INTO feishu_commands
         (id, app_id, user_id, message_id, chat_id, chat_type, sender_open_id, sender_name,
          text, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
    )
    .run(
      id,
      input.appId,
      input.userId,
      input.messageId,
      input.chatId,
      input.chatType,
      input.senderOpenId,
      input.senderName,
      input.text,
      new Date().toISOString()
    );
  return id;
}

export function setCommandIntent(id: string, action: string, params: unknown): void {
  getDatabase()
    .prepare("UPDATE feishu_commands SET action = ?, params = ?, status = 'running' WHERE id = ?")
    .run(action, JSON.stringify(params ?? {}), id);
}

export function finishCommand(
  id: string,
  status: 'done' | 'failed' | 'ignored',
  opts: {
    result?: string;
    error?: string;
    /** 结构化失败原因（FeishuErrorDetail）。缺权限时前端靠它渲染补权限按钮。 */
    errorDetail?: unknown;
    durationMs?: number;
  } = {}
): void {
  getDatabase()
    .prepare(
      `UPDATE feishu_commands SET status = ?, result = ?, error = ?, error_detail = ?,
       duration_ms = ?, completed_at = ? WHERE id = ?`
    )
    .run(
      status,
      opts.result ?? null,
      opts.error ?? null,
      opts.errorDetail === undefined ? null : JSON.stringify(opts.errorDetail),
      opts.durationMs ?? null,
      new Date().toISOString(),
      id
    );
}

export interface ListCommandsFilter {
  /** 非管理员必须传，用于把结果限定在自己的应用上 */
  userId?: string;
  appId?: string;
  /**
   * 只看某一个群（= 某一个项目）的指令。
   *
   * 这个筛选存在的理由是**一个群 = 一个项目**：不按群分的话，一个绑了十个项目群的
   * 应用，它的日志页就是十个项目的指令混在一起按时间排 —— 而人来这一页
   * 几乎总是在查「A 项目那条记录到底记进去了没有」。混排时他要在几百行里
   * 靠 chat_id 后六位认群，而 `oc_xxx` 在飞书客户端里根本看不到，
   * 也就是说他没有任何办法确认自己认对了。
   *
   * 校验归属和 appId 一样是**调用方**的事（见 api/feishuAssistant.ts）：
   * 这里只管拼 SQL。
   */
  chatId?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export function listCommands(f: ListCommandsFilter): { commands: CommandRow[]; total: number } {
  const db = getDatabase();
  let where = 'WHERE 1=1';
  const params: unknown[] = [];
  if (f.userId) {
    where += ' AND user_id = ?';
    params.push(f.userId);
  }
  if (f.appId) {
    where += ' AND app_id = ?';
    params.push(f.appId);
  }
  if (f.chatId) {
    where += ' AND chat_id = ?';
    params.push(f.chatId);
  }
  if (f.status) {
    where += ' AND status = ?';
    params.push(f.status);
  }

  const total = (
    db.prepare(`SELECT COUNT(*) as c FROM feishu_commands ${where}`).get(...params) as {
      c: number;
    }
  ).c;

  const commands = db
    .prepare(
      `SELECT * FROM feishu_commands ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    )
    .all(...params, f.limit ?? 50, f.offset ?? 0) as CommandRow[];

  return { commands, total };
}

/** 上一轮「助理反问 → 用户补充」的那半截对话。 */
export interface PriorTurn {
  /** 用户当时说的原话 */
  text: string;
  /** 助理当时反问的内容 */
  reply: string;
}

/**
 * 找出紧挨着的上一轮**反问**，用于让用户的补充能接上话。
 *
 * ── 为什么需要它 ──
 * `reply` 动作的描述里明确让 LLM「拿不准就反问，说明还需要补充什么」，
 * 于是助理会说「你想约几点？」。但每条消息都是**独立解析**的：用户回一句
 * 「下午三点」，模型看到的就只有"下午三点"这四个字，没有任何上文 ——
 * 它只能再反问一次。也就是说反问这条路是**走不通的**，而它是整个模块
 * 拿不准时的唯一安全出口。
 *
 * ── 为什么条件卡得这么死 ──
 * 只在上一条是 `reply`（助理确实在等补充）、同一个会话、同一个人、10 分钟内时
 * 才带上文。放宽任何一条都会引入更糟的失败：
 *   - 上一条是写操作也带上下文 → 「再发一条」「改成四点」会让模型在没有真正
 *     修改能力的情况下重放一次写操作，用户收到两条消息 / 多出一个日程；
 *   - 不限发言人 → 群里 A 被反问、B 随口说了句话，就成了 A 的补充；
 *   - 不限时间 → 明天的一句「好」会接上今天那个悬着的问题。
 *
 * 只带**一轮**，不做多轮会话：一次反问一次补充就能补齐参数，
 * 而真正的多轮状态机要处理"话题切换/放弃"，那是另一个量级的东西。
 */
export function findPriorClarification(input: {
  appId: string;
  chatId: string;
  senderOpenId: string;
  /** 排除本条自己（startCommand 已经先插了一行 pending） */
  excludeCommandId: string;
  withinMs?: number;
}): PriorTurn | null {
  const since = new Date(Date.now() - (input.withinMs ?? 10 * 60_000)).toISOString();
  const row = getDatabase()
    .prepare(
      `SELECT text, result FROM feishu_commands
       WHERE app_id = ? AND chat_id = ? AND sender_open_id = ?
         AND id <> ? AND action = 'reply' AND status = 'done' AND created_at >= ?
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(input.appId, input.chatId, input.senderOpenId, input.excludeCommandId, since) as
    | { text: string; result: string | null }
    | undefined;
  if (!row) return null;

  // result 是 execute() 拼的那个 JSON，反问的内容在 summary 里。
  // 解析不出来就当没有上文 —— 拿一段 JSON 原文塞进 prompt 只会干扰模型。
  let reply = '';
  try {
    const parsed = JSON.parse(row.result || '{}');
    if (parsed && typeof parsed.summary === 'string') reply = parsed.summary.trim();
  } catch {
    reply = '';
  }
  if (!reply) return null;

  return { text: row.text, reply };
}

/** 助理**自己建过**的某个东西（目前只有飞书任务），从指令日志里反查出来的。 */
export interface RecentActionRef {
  /** 产生它的那条指令 */
  commandId: string;
  createdAt: string;
  action: string;
  /**
   * 那一步的结构化产物：`create_task` 给 `guid`/`url`/`title`。
   * 形状由各动作的 `ActionResult.data` 决定，见 dispatcher 落库那一段。
   */
  data: Record<string, unknown>;
}

/**
 * 一次最多回看多少条**相关**指令。
 *
 * 这不是"能改多久以前的东西"（那是 `withinMs`），而是一道成本闸：要在 JS 里
 * 逐行 JSON.parse。
 *
 * 关键是「相关」两个字。以前这里是无条件取最近 50 行，于是话术里承诺的
 * 「最近 7 天内」其实是**最近 50 条指令**：一个活跃的群一天就能有几十条
 * 「记一下…」，用户早上派的任务到下午就已经掉出窗口，助理却回一句
 * 「我只能改我自己帮你建的那些（最近 7 天内）」—— 一句在他看来明显不成立的话。
 * 所以先在 SQL 里按动作名过滤，让这 200 行全是**候选**，7 天这个承诺才是真的。
 */
const LOOKBACK_ROWS = 200;

/**
 * 反查助理最近帮这个人建过的任务。
 *
 * ── 为什么必须有这一层 ──
 * `task.patch` 要 guid，而**模型不可能知道它**。这和 open_id 是同一类问题
 * （见 actions/people.ts），也用同一套解法：id 绝不经过 LLM，只从代码控制的
 * 来源里取。这里的来源就是我们自己的执行日志 —— 建的时候把 guid 存进了
 * `result`，现在原样读回来。
 *
 * 让 LLM 输出 guid 的后果比编 open_id 更隐蔽：编出来的 guid 大概率 404，
 * 但**万一命中**就是改了别人的任务，而回帖会说「已完成」。
 *
 * ── 范围为什么是 app + 发言人，不含会话 ──
 * 「那个任务」指的是**我让助理建的**那个，跟他当时在哪个群说的没关系
 * （在项目群里派的任务，回头在另一个群里说「标记完成」是很自然的）。
 * 而 app + 发言人这两条一条都不能少：跨应用是跨企业，跨人是改别人的东西。
 *
 * ── 为什么 failed 的指令也算 ──
 * `result` 里只会有**成功的那几步**（见 dispatcher）。一条"建任务 + 记一条日志"的
 * 指令在第二步失败时整条记为 `failed`，但任务是真建出来了 —— 不收它的话，
 * 用户明明看到任务在飞书里，助理却说「我没帮你建过任务」。
 *
 * 注意这里**不能**复用 `findPriorClarification`：那个函数的 `action = 'reply'`
 * 闸门是故意的（不让上下文越过写操作），语义正好相反。
 */
export function findRecentActionResults(input: {
  appId: string;
  senderOpenId: string;
  /** 只要这几个动作产生的东西，如 ['create_task'] */
  actions: string[];
  /** 往前看多久，默认 7 天 */
  withinMs?: number;
}): RecentActionRef[] {
  if (input.actions.length === 0) return [];
  const since = new Date(Date.now() - (input.withinMs ?? 7 * 86400_000)).toISOString();
  // 按动作名先在 SQL 里筛一遍，见 LOOKBACK_ROWS 的注释：不筛的话行数配额会被
  // 无关指令吃光，而「最近 7 天」就成了一句空话。
  //
  // 用 LIKE 而不是 `action = ?`：多步指令的 action 列存的是
  // 「create_task + add_diary_record」这种拼接串（见 dispatcher），等号对不上。
  // LIKE 宽一点没有代价 —— 下面逐步遍历 `steps` 时还要按 action 精确核一遍，
  // 这里只是把明显不可能的行挡在 JSON.parse 之外。
  const likeClause = input.actions.map(() => 'action LIKE ?').join(' OR ');
  const rows = getDatabase()
    .prepare(
      `SELECT id, action, result, created_at FROM feishu_commands
       WHERE app_id = ? AND sender_open_id = ?
         AND status IN ('done', 'failed') AND result IS NOT NULL AND created_at >= ?
         AND (${likeClause})
       ORDER BY created_at DESC LIMIT ?`
    )
    .all(
      input.appId,
      input.senderOpenId,
      since,
      ...input.actions.map((a) => `%${a}%`),
      LOOKBACK_ROWS
    ) as Array<{
    id: string;
    action: string | null;
    result: string | null;
    created_at: string;
  }>;

  const wanted = new Set(input.actions);
  const out: RecentActionRef[] = [];

  for (const row of rows) {
    // 坏 JSON 跳过就好 —— 反查是个增强功能，不该因为一行脏数据整体失败。
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.result || '{}');
    } catch {
      continue;
    }
    const steps = (parsed as { steps?: unknown }).steps;
    if (!Array.isArray(steps)) continue;

    for (const step of steps) {
      if (!step || typeof step !== 'object') continue;
      const s = step as Record<string, unknown>;
      if (typeof s.action !== 'string' || !wanted.has(s.action)) continue;
      out.push({
        commandId: row.id,
        createdAt: row.created_at,
        action: s.action,
        data: s,
      });
    }
  }

  return out;
}

/**
 * 清理旧的去重记录。
 *
 * 飞书最多重推到 6 小时后，保留 7 天已经远超需要；不清理的话这张表会无限增长
 * （每条 @ 消息一行）。指令日志另说，见 cleanupOldCommands。
 */
export function cleanupOldEvents(retainDays = 7): number {
  const cutoff = new Date(Date.now() - retainDays * 86400_000).toISOString();
  return getDatabase()
    .prepare('DELETE FROM feishu_events WHERE received_at < ?')
    .run(cutoff).changes;
}

/**
 * 清理旧的指令日志。
 *
 * 这张表**每条 @ 消息一行、还带原文**，是本模块里长得最快的表，而在加上这个
 * 函数之前它根本没有保留期 —— 一个几十人天天用的企业跑一年就是几万行原始聊天内容
 * 躺在库里。留着它们既不用于排障（没人查半年前那条指令为什么失败），
 * 又是实打实的隐私负担。
 *
 * 保留期和 `ai_logs` 那批一致（logCleanupService 的 14 天）：排障看的都是
 * 「刚才那条为什么没成」，两周远够；两张表用同一个周期也省得以后各自漂。
 */
export function cleanupOldCommands(retainDays = 14): number {
  const cutoff = new Date(Date.now() - retainDays * 86400_000).toISOString();
  return getDatabase()
    .prepare('DELETE FROM feishu_commands WHERE created_at < ?')
    .run(cutoff).changes;
}

/**
 * 把上一次运行遗留的 pending / running 指令标成失败。
 *
 * 和 `core/jobs.ts` 的 `reapZombieJobs()` 是同一件事，理由也一样：这些指令
 * 全靠内存里那个游离的 `execute()` promise 驱动（见 dispatcher.ts 的 3 秒限制），
 * 进程一没就必然死了，绝不会有人再来把它们推进到终态。
 *
 * 不收尸的后果不是"多几行脏数据"，而是**排障表里最难受的那一格**：
 * 用户说「我 @ 了它没反应」，日志里那行明明写着 `running` ——
 * 看起来像还在办，于是他继续等，而实际上永远不会有结果。
 * 而且飞书那边的重推窗口早就过了，连自动重试都不会发生。
 *
 * 与 jobs 的一点不同：这里连 `pending` 一起收。pending 意味着连意图解析都还没
 * 走到（`setCommandIntent` 会把状态改成 running），它同样不可能自己复活。
 */
export function reapZombieCommands(): number {
  const now = new Date().toISOString();
  const result = getDatabase()
    .prepare(
      `UPDATE feishu_commands
       SET status = 'failed',
           error = '服务重启，这条指令执行中断（可能已部分生效，请检查后再重下）',
           completed_at = ?
       WHERE status IN ('pending', 'running')`
    )
    .run(now);
  if (result.changes > 0) {
    console.log(`[feishu] 已将 ${result.changes} 条重启前未完成的指令标为 failed`);
  }
  return result.changes;
}
