// 项目任务的进展。
//
// ── 为什么是代码里的枚举，而不是让 LLM 自由填 ──
// 这和 diary/range.ts 的时间范围、people.ts 的 open_id 是同一条规则：
// **模型不输出它能悄悄搞错的格式。**
//
// 「进展」这一列在多维表格里是「单选」字段，而单选的选项是**写进去的时候自动建的**。
// 模型对同一个意思会给出「进行中」「进行中的」「in progress」「doing」四种写法，
// 于是那一列很快就有四个看起来一样的选项 —— 后果不是报错，是看板按进展分列
// 彻底失效（每个选项一列）、按进展筛选只筛到一部分，而每一行看上去都对。
//
// 所以：模型只能从 {@link TASK_STATUS_KEYS} 里挑一个词，认不出来的一律当
// `todo` 处理。不认识的进展**不报错**，因为它是附属信息 —— 为了一个说不清的
// 进展让「派任务」整条失败，用户会以为助理坏了。
//
// 五个值。`stalled`（已停滞）是给「卡住了但没取消」用的 —— 这个状态和
// `doing` 的区别是要不要催，看板上分开一列才有意义。
// 「待验收」这类更细的阶段仍然不收：每多一个值都要进 prompt、都要在看板上
// 占一列，而在群里口头派活的场景里说得出来的只有这五种。

/** 进展的机器值。表格里存的是 {@link LABELS} 的中文，这里是代码内部的取值。 */
export type TaskStatus = 'todo' | 'doing' | 'done' | 'stalled' | 'cancelled';

export const TASK_STATUS_KEYS: TaskStatus[] = ['todo', 'doing', 'done', 'stalled', 'cancelled'];

/**
 * 给人看的说法。**这也是多维表格「进展」列的单选选项值** ——
 * 表格里存中文，因为那张表是给人看的（看板按进展分列时列头就是这几个字）。
 */
const LABELS: Record<TaskStatus, string> = {
  todo: '待开始',
  doing: '进行中',
  done: '已完成',
  stalled: '已停滞',
  cancelled: '已取消',
};

/** 多维表格单选字段的选项清单。建表时一次性建好，之后写入不会再新增选项。 */
export const TASK_STATUS_OPTIONS: string[] = TASK_STATUS_KEYS.map((k) => LABELS[k]);

/** 「未完成」的那几个值。查在办任务、催活、看板默认筛选都用它。 */
export const OPEN_STATUSES: TaskStatus[] = ['todo', 'doing', 'stalled'];

export function statusLabel(status: string): string {
  return LABELS[normalizeStatus(status)];
}

/**
 * 表格里那个中文 → 机器值。**这是读回路径的入口。**
 *
 * 单独一个函数而不是复用 normalizeStatus：读回和模型输入是两件事 ——
 * 读回时认不出来的值意味着**用户自己在表里加了个选项**（单选字段在飞书界面上
 * 可以随手加），而 normalizeStatus 会把它归成 `todo`。那就成了「他标了『待验收』，
 * 助理说这活还没开始」。所以这里认不出来返回 undefined，让调用方决定怎么说。
 */
export function statusFromLabel(label: string | undefined | null): TaskStatus | undefined {
  const t = (label ?? '').trim();
  if (!t) return undefined;
  return TASK_STATUS_KEYS.find((k) => LABELS[k] === t);
}

/**
 * 模型给的说法 → 机器值。认不出来一律 `todo`。
 *
 * 收的写法比 prompt 里列的宽得多（中文、英文、带标点），因为这是**兜底**：
 * prompt 已经要求只填那几个词，这里处理的是它没照做的情况。
 * 宽容在这个字段上没有代价 —— 进展猜错了用户一眼能看出来并改掉，
 * 而猜错负责人或猜错项目是看不出来的（那两处因此一律抛错，不兜底）。
 */
export function normalizeStatus(raw: string | undefined | null): TaskStatus {
  const t = (raw ?? '').trim().toLowerCase().replace(/[\s。，,.!！✅]/g, '');
  if (!t) return 'todo';
  if ((TASK_STATUS_KEYS as string[]).includes(t)) return t as TaskStatus;
  if (['已完成', '完成', '做完了', '做完', '完成了', '搞定', 'finished', 'complete', 'completed'].includes(t)) {
    return 'done';
  }
  if (['进行中', '进行中的', '在做', '正在做', '开始了', 'doing', 'inprogress', 'ing', 'wip'].includes(t)) {
    return 'doing';
  }
  // 「卡住了」这批必须在 doing 之后单独认：说「卡住了」的人想要的是别人来推一把，
  // 归成 doing 的话它在看板上和正常在做的活混在一列，谁都不会去看。
  if (['已停滞', '停滞', '卡住了', '卡住', '搁置', '暂停', '停了', 'blocked', 'stalled', 'paused', 'onhold'].includes(t)) {
    return 'stalled';
  }
  if (['已取消', '取消', '不做了', '作废', 'canceled', 'cancel', 'dropped'].includes(t)) {
    return 'cancelled';
  }
  if (['待开始', '未开始', '待办', '没开始', '还没开始', 'pending', 'new', 'open'].includes(t)) {
    return 'todo';
  }
  return 'todo';
}

/** 写进 prompt 的参数说明。和上面这份枚举一起改，不要在动作里另抄一份。 */
export const TASK_STATUS_PARAM_DOC =
  `可选。任务进展，只能是这几个词之一：${TASK_STATUS_KEYS.join(' / ')}` +
  `（todo=待开始，doing=进行中，done=已完成，stalled=已停滞/卡住了，cancelled=已取消）。` +
  '用户没说进展就留空（系统按待开始处理），**不要自己编别的写法**。';

// ── 重要紧急程度（艾森豪威尔四象限）──
//
// 和进展同一条规则：单选字段 + 建表时写死选项 + 模型只能挑一个词。
// 它是**可选**的，而且默认不填：用户在群里说「派给张三设计 logo」时没有
// 优先级信息，替他猜一个填进去，看板上那一列就成了假数据 ——
// 而四象限的全部用处就是「哪几件真的重要」。空着反而诚实。

export type TaskPriority = 'iu' | 'in' | 'ui' | 'nn';

export const TASK_PRIORITY_KEYS: TaskPriority[] = ['iu', 'in', 'ui', 'nn'];

const PRIORITY_LABELS: Record<TaskPriority, string> = {
  iu: '重要紧急',
  in: '重要不紧急',
  ui: '紧急不重要',
  nn: '不紧急不重要',
};

export const TASK_PRIORITY_OPTIONS: string[] = TASK_PRIORITY_KEYS.map((k) => PRIORITY_LABELS[k]);

/** 认不出来返回 undefined —— 见 TASK_PRIORITY_PARAM_DOC，这个字段宁可空着。 */
export function normalizePriority(raw: string | undefined | null): TaskPriority | undefined {
  const t = (raw ?? '').trim().toLowerCase().replace(/[\s。，,.!！]/g, '');
  if (!t) return undefined;
  if ((TASK_PRIORITY_KEYS as string[]).includes(t)) return t as TaskPriority;
  const found = TASK_PRIORITY_KEYS.find((k) => PRIORITY_LABELS[k] === t);
  if (found) return found;
  // 只说了「很重要」「加急」这种半个维度的，补成常见的那一半：
  // 说「加急」的人要的是「现在就办」，那是重要紧急。
  if (['重要', '很重要', '最重要', '加急', '紧急', '急', '优先', 'urgent', 'important', 'p0'].includes(t)) {
    return 'iu';
  }
  return undefined;
}

export function priorityLabel(p: TaskPriority): string {
  return PRIORITY_LABELS[p];
}

/** 表格里那个中文 → 机器值。读回用，认不出来返回 undefined（同 statusFromLabel）。 */
export function priorityFromLabel(label: string | undefined | null): TaskPriority | undefined {
  const t = (label ?? '').trim();
  if (!t) return undefined;
  return TASK_PRIORITY_KEYS.find((k) => PRIORITY_LABELS[k] === t);
}

export const TASK_PRIORITY_PARAM_DOC =
  `可选。重要紧急程度，只能是这几个词之一：${TASK_PRIORITY_KEYS.join(' / ')}` +
  `（iu=重要紧急，in=重要不紧急，ui=紧急不重要，nn=不紧急不重要）。` +
  '**用户没提到重要/紧急/优先级就必须留空，不要替他猜** —— ' +
  '猜一个填进去会让看板上的四象限变成假数据。';
