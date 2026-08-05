import { findRecentActionResults, type RecentActionRef } from '../commandLog.js';
import type { ActionContext } from './types.js';

// 「刚才那个任务 / 那个日程」→ 具体的 guid / event_id。
//
// ── 这一层为什么存在 ──
// 改任务要 guid、改日程要 event_id，而**模型不可能知道它们**。这和 open_id
// 是同一类问题（见 people.ts），解法也一样：id 绝不经过 LLM，只从代码控制的
// 来源里取 —— 这里的来源是我们自己的执行日志（建的时候存了 guid / event_id）。
//
// 编 guid 比编 open_id 更隐蔽：编出来的大概率 404，但**万一命中**就是动了
// 别人的任务，而回帖会说「已完成」。
//
// ── 一条必须一直说清楚的限制 ──
// **只能改助理自己帮他建的那些。** 用户在飞书里手动建的任务/日程我们看不见：
// 任务系统视角下 tenant token 就是另一个普通用户（见 createTask.ts 的注释），
// `task.list` 只返回**调用身份自己**创建的东西，所以拿不到不是"报错"，
// 而是安安静静地返回空。所以查不到时的话术必须是「我只能改我自己帮你建的那些」，
// 而不是「没找到这个任务」—— 后者会让用户以为是搜索没搜到，反复换措辞重试。
//
// ── 歧义绝不自己挑一个 ──
// 和 resolvePerson 同一条原则。挑错的后果是改了/删了另一件事，
// 而回帖说的是「已完成」—— 用户要过几天才发现。所以有多个候选就列出来让他重说。

/** 反查失败。错误原文会回帖给用户，措辞必须是能照着做的人话。 */
export class TargetNotResolvedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TargetNotResolvedError';
  }
}

/** 往前找多久。比会话上下文（10 分钟）长得多：「上周建的那个任务」是正常说法。 */
const LOOKBACK_MS = 7 * 86400_000;

/** 列给用户挑的时候最多列几个。列一屏是噪音，用户反而更难挑。 */
const MAX_OPTIONS = 5;

export interface RecentTarget {
  /** 建它的那条指令产生的结构化产物（guid / event_id / calendar_id 都在里面） */
  data: Record<string, unknown>;
  /** 给用户看的标题 */
  title: string;
  createdAt: string;
}

function pickStr(data: Record<string, unknown>, key: string): string | undefined {
  const v = data[key];
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/**
 * 给用户看的标题。
 *
 * `title` 是后来才加进 `ActionResult.data` 的，**老日志行里没有**，所以要能退回到
 * 那一步的回帖文案（里面本来就带着标题）。取不到就给一句「（无标题）」，
 * 不要给空串 —— 列表里出现一个空行时用户根本不知道那是个选项。
 */
function titleOf(ref: RecentActionRef): string {
  const explicit = pickStr(ref.data, 'title');
  if (explicit) return explicit;

  const summary = pickStr(ref.data, 'summary');
  if (summary) {
    // 回帖第一行形如「✅ 任务已创建：**写季度报告**」。剥掉前缀和 markdown 加粗，
    // 剥不干净也无所谓：这只是给人看的标签，匹配用的是全文。
    const first = summary.split('\n')[0];
    const bold = first.match(/\*\*(.+?)\*\*/);
    if (bold) return bold[1];
    const afterColon = first.split(/[:：]/).slice(1).join('：').trim();
    if (afterColon) return afterColon;
    return first.trim();
  }
  return '（无标题）';
}

/** 关键词匹配的原文。标题之外把整段回帖也算进去 —— 老日志行只有回帖。 */
function haystack(ref: RecentActionRef): string {
  return `${titleOf(ref)}\n${pickStr(ref.data, 'summary') ?? ''}`.toLowerCase();
}

function fmtOptions(refs: RecentActionRef[]): string {
  return refs
    .slice(0, MAX_OPTIONS)
    .map((r) => `· ${titleOf(r)}`)
    .join('\n');
}

/**
 * 找出用户说的那个东西。
 *
 * @param keyword 用户话里提到的标题片段（「整理客户名单那个任务」→「整理客户名单」）。
 *                模型没给就是 undefined，此时只有恰好一个候选才能确定。
 * @param opts.actions 产生它的动作名。**改动作自己也要列进来**（如
 *   `['create_task','update_task']`）：改过名之后日志里最新那行才带新标题，
 *   只查 create 的话用户按新名字反而找不到自己刚改的那个。
 * @param opts.label 用于话术的名字：「任务」/「日程」
 * @param opts.requireKeys 必须齐全的 id 字段。缺了的候选直接排除 ——
 *   比如很早的日志行里没有 `calendar_id`，拿它去调接口只会撞一个莫名的参数错误。
 * @param opts.deletedBy 会让一个候选作废的动作名（如 `['delete_calendar_event']`）。
 *   删掉的日程必须从候选里消失，否则用户删完再说「那个会推到四点」，
 *   我们会拿一个已删的 event_id 去 patch，撞回来的是一句他看不懂的飞书报错。
 */
export function findRecentTarget(
  keyword: string | undefined,
  ctx: ActionContext,
  opts: { actions: string[]; label: string; requireKeys: string[]; deletedBy?: string[] }
): RecentTarget {
  const all = findRecentActionResults({
    appId: ctx.appId,
    senderOpenId: ctx.senderOpenId,
    actions: [...opts.actions, ...(opts.deletedBy ?? [])],
    withinMs: LOOKBACK_MS,
  });

  const keyOf = (ref: RecentActionRef) =>
    opts.requireKeys.map((k) => pickStr(ref.data, k)).join('|');
  const deletedActions = new Set(opts.deletedBy ?? []);
  const tombstoned = new Set(
    all.filter((r) => deletedActions.has(r.action)).map(keyOf)
  );

  // id 字段不全的候选排除掉。同一个东西可能在日志里出现多次（建了之后又改过，
  // 或者重放/重推留下的行），按 id 去重 —— 日志是 created_at DESC，所以留下的
  // 是**最新**那行，标题也就是改过之后的那个。
  const seen = new Set<string>();
  const usable: RecentActionRef[] = [];
  for (const ref of all) {
    if (deletedActions.has(ref.action)) continue;
    if (!opts.requireKeys.every((k) => pickStr(ref.data, k))) continue;
    const key = keyOf(ref);
    if (seen.has(key) || tombstoned.has(key)) continue;
    seen.add(key);
    usable.push(ref);
  }

  if (usable.length === 0) {
    throw new TargetNotResolvedError(
      `我这边没有可以改的${opts.label}。**我只能改我自己帮你建的那些**（最近 7 天内）——` +
        `你在飞书里手动建的${opts.label}我看不到，那种只能在飞书里自己改。`
    );
  }

  const kw = keyword?.trim().toLowerCase();
  if (kw) {
    const hits = usable.filter((r) => haystack(r).includes(kw));
    if (hits.length === 1) {
      return { data: hits[0].data, title: titleOf(hits[0]), createdAt: hits[0].createdAt };
    }
    if (hits.length === 0) {
      throw new TargetNotResolvedError(
        `没找到和「${keyword}」对得上的${opts.label}。我最近帮你建过这些：\n` +
          `${fmtOptions(usable)}\n请照着其中一个的名字说一遍。` +
          `（**我只能改我自己帮你建的那些** —— 你手动建的我看不到。）`
      );
    }
    // 绝不挑一个。挑错的后果是动了另一件事，而回帖说的是「已完成」。
    throw new TargetNotResolvedError(
      `有 ${hits.length} 个${opts.label}都能对上「${keyword}」：\n${fmtOptions(hits)}\n` +
        `请说全一点，我不敢替你挑。`
    );
  }

  if (usable.length === 1) {
    return { data: usable[0].data, title: titleOf(usable[0]), createdAt: usable[0].createdAt };
  }

  // 没给关键词、候选又不止一个。这里**不能**默认取最近那个：「那个任务完成了」
  // 里的"那个"指的是他心里想的那件事，不一定是时间上最近的一件。
  throw new TargetNotResolvedError(
    `不确定你说的是哪个${opts.label}。我最近帮你建过这些：\n${fmtOptions(usable)}\n` +
      `请带上名字再说一遍，比如「把 XXX 那个${opts.label}…」。`
  );
}
