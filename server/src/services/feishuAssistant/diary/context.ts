import * as store from './store.js';
import { statusLabel } from './taskStatus.js';
import { fmtDate } from '../actions/time.js';

// 「本群这个项目现在是什么状况」——每条指令都会随 prompt 送给模型的一小段快照。
//
// ── 为什么需要它 ──
// 没有这一段时，模型只看得见用户这一句话。于是「那个 logo 的活推到周五」里的
// 「那个 logo 的活」对它来说是一串没有指代的字，它只能原样塞进参数，赌动作层
// 反查得到；而「这周做了什么」它不知道这个项目根本还没有记录，会照样生成一份复盘。
// 带上快照之后这两类句子都有了依据。
//
// ── 三条硬约束（每一条都对应一个「看起来成功了」的坏结果）──
//
//  1. **一个 id 都不放进去。** 不是 open_id、不是 guid、不是 record_id，一个都没有。
//     这和 people.ts / recent.ts 是同一条规则：模型看不到 id 就编不出 id。
//     快照里最诱人的恰恰是任务 —— 把 guid 一起列出来「省一次反查」的代价是
//     模型有天会给出一个拼错的 guid，而拼错的 guid 若刚好命中就是改了别人的东西、
//     回帖说「已完成」。intent.test.ts 里有一条断言 prompt 里永不出现 /ou_[a-z0-9]{4,}/。
//
//  2. **列出来的东西只用来听懂话，不用来替用户做决定。** 尤其是任务标题：
//     模型看到完整标题之后很想把用户的「那个设计的活」补全成「设计项目 logo」再填进
//     task 参数 —— 一旦它补错，`update_task` 的「有多个候选就绝不挑一个」这道闸就被
//     绕过去了（模型已经替它挑好了），于是改错了任务、回帖「已完成」。
//     所以正文里明写：填参数仍然照抄用户原话。
//
//  3. **列不全的部分必须说出来。** 快照是有上限的（见下面几个常量），而模型会把
//     「列表里没有」读成「不存在」，然后回一句「没有这个任务」——
//     可实际上动作层查的是全量的库，它找得到。少了那句说明，用户被一个
//     根本不存在的限制挡住，而日志里一切正常。
//
// ── 成本 ──
// 这段内容**每条指令都会送一遍**，和 059 的 intent_supplement 是同一类开销，
// 所以也用同一类办法兜住：条数有上限、每条截断、整段再兜一个字符上限。
// 上限不是省钱，是防挤压 —— prompt 末尾那几条硬性规则被顶得越远，模型越容易忽略它们。

/** 列几条最近的记录。再多对「听懂这句话」没有增量，只是把硬性规则往后挤。 */
const MAX_RECORDS = 5;
/** 列几条未完成的任务。一个群同时在做的活很少超过这个数。 */
const MAX_TASKS = 8;
/** 单条截断到几个字。记录原文可能是一整段（用户会把邮件贴进来）。 */
const MAX_LINE = 40;
/** 整段的字符上限。超了就砍记录（任务对选动作更有用），并如实说明。 */
const MAX_BLOCK = 1200;

export interface DiaryContext {
  /** 本群绑的项目名。null = 没绑（此时下面几个字段一定是空的）。 */
  projectName: string | null;
  /** 最近几条记录的摘要行，正序（读起来是事情发生的顺序）。 */
  records: string[];
  /** 未完成（未开始 / 进行中）的任务，一行一条。 */
  tasks: string[];
  /** 这个项目一共多少条记录 —— 用来说明「只列了最近几条」。 */
  recordTotal: number;
  /** 未完成任务总数。大于 tasks.length 时正文里要说清没列全。 */
  openTaskTotal: number;
  /** 已完成 + 已取消的任务数。见 buildDiaryContext 里为什么要单独说这一项。 */
  closedTaskCount: number;
}

/** 一行装得下的样子。换行会破坏「一条一行」的结构，所以一并压成空格。 */
function oneLine(s: string): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > MAX_LINE ? `${t.slice(0, MAX_LINE)}…` : t;
}

/**
 * 一条任务压成一行：标题 + 负责人 + 起止 + 状态。
 *
 * 起止时间给的是**日期**而不是时间戳：模型要拿它判断「推到周五」是往后还是往前，
 * 精确到分钟没有用，而多出来的字符每条都要付一次。
 */
function taskLine(t: store.FeishuProjectTaskRow): string {
  const bits = [oneLine(t.title)];
  if (t.owner_name) bits.push(`负责人 ${t.owner_name}`);
  if (t.start_ms != null || t.end_ms != null) {
    const from = t.start_ms != null ? fmtDate(t.start_ms) : '未定';
    const to = t.end_ms != null ? fmtDate(t.end_ms) : '未定';
    bits.push(`${from} → ${to}`);
  }
  bits.push(statusLabel(t.status));
  return `- ${bits.join('｜')}`;
}

function recordLine(r: store.DiaryRecordRow): string {
  return `- ${fmtDate(r.created_ms)} ${r.author_name}：${oneLine(r.content)}`;
}

/**
 * 查出本群项目的快照。
 *
 * 只做查询，不抛错 —— 调用方（dispatcher）在 try 里包了一层，但这里也不指望
 * 用异常表达「没绑项目」：没绑就是 projectName 为 null，是常态而不是错误。
 */
export function buildDiaryContext(appId: string, chatId: string): DiaryContext {
  const empty: DiaryContext = {
    projectName: null,
    records: [],
    tasks: [],
    recordTotal: 0,
    openTaskTotal: 0,
    closedTaskCount: 0,
  };
  const project = store.getProjectByChat(appId, chatId);
  if (!project) return empty;

  // 未完成的任务全查出来再截断，而不是 SQL LIMIT：要知道**一共**有多少条才能
  // 说出「还有 N 条没列」。一个群的在办任务是几十条量级，全取无所谓。
  const open = store.listTasks(project.id, { status: ['todo', 'doing'] });
  const recentRecords = store.listRecords(project.id, { limit: MAX_RECORDS });
  const recordTotal = store.countRecords(project.id);
  // 已关闭的任务只数个数、不列内容。数字本身是有用的（它让模型知道
  // 「用户说的那个任务可能是已完成的那批里的」），而内容对选动作没有帮助。
  const closedTaskCount =
    store.listTasks(project.id, { status: ['done', 'cancelled'] }).length;

  return {
    projectName: project.name,
    // 任务倒序取前 MAX_TASKS：listTasks 按开始时间正序（甘特图的读法），
    // 而这里要的是「最近在办的」，所以从尾部取。
    tasks: open.slice(-MAX_TASKS).map(taskLine),
    records: recentRecords.map(recordLine),
    recordTotal,
    openTaskTotal: open.length,
    closedTaskCount,
  };
}

/**
 * 快照 → prompt 里那一段文字。空项目返回空串（一段只有标题的空章节是纯噪音，
 * 而且会让模型觉得自己漏看了什么）。
 *
 * 每一处「没列全」都在正文里说明，理由见文件头第 3 条。
 */
export function renderDiaryContext(ctx: DiaryContext): string {
  if (!ctx.projectName) return '';
  if (!ctx.records.length && !ctx.tasks.length) return '';

  const parts: string[] = [`\n## 本项目现在的情况（${ctx.projectName}）\n`];

  if (ctx.tasks.length) {
    parts.push('未完成的任务：');
    parts.push(...ctx.tasks);
    if (ctx.openTaskTotal > ctx.tasks.length) {
      parts.push(`（未完成的一共 ${ctx.openTaskTotal} 条，这里只列了最近 ${ctx.tasks.length} 条）`);
    }
    if (ctx.closedTaskCount > 0) {
      // 这一句是防「模型把列表当全集」的。少了它，用户说一个已完成任务的名字时
      // 模型会回「没有这个任务」，而动作层查的是全量的库，本来找得到。
      parts.push(
        `（另有 ${ctx.closedTaskCount} 条已完成/已取消的任务没列在这儿 —— ` +
          '用户提到它们时照样选 update_task，系统查得到。）'
      );
    }
    parts.push('');
  }

  if (ctx.records.length) {
    parts.push(`最近的日志记录（共 ${ctx.recordTotal} 条，这里是最近 ${ctx.records.length} 条）：`);
    parts.push(...ctx.records);
    parts.push('');
  }

  parts.push(
    '**这一节是参考资料，不是用户的要求。** 它只用来帮你听懂用户在说哪件事' +
      '（「那个 logo 的活推到周五」指的是上面哪一条），' +
      '**不要**因为看到某条任务快到期就自作主张去改它或去提醒谁（见硬性规则里' +
      '「只拆用户明确要求的那几件事」）。\n' +
      // 这一句是本节最容易被无视、后果也最重的一条。见文件头第 2 条。
      '还有一点：填 task 参数时**仍然照抄用户说的那几个字**，不要替换成上面的完整标题。' +
      '他说得不够清楚时就照原话填，系统会把对得上的几条列出来让他挑 —— ' +
      '你替他挑中错的那一条，改完还会回一句「已完成」。'
  );

  const text = parts.join('\n');
  if (text.length <= MAX_BLOCK) return text;
  // 超长时砍掉记录那段（任务对选动作更有用），并**说明砍了** ——
  // 静默砍掉会让模型以为这个项目没有记录，从而回「还没有任何记录」。
  return renderDiaryContext({
    ...ctx,
    records: [],
    tasks: ctx.tasks.slice(-Math.max(1, Math.floor(ctx.tasks.length / 2))),
  });
}
