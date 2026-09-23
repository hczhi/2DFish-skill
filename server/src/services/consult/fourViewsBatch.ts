import { STAGE_DEFAULTS, stageByKey } from './stages.js';
import { draftFastStage, StageError } from './draftService.js';
import { draftToText, entryToText } from './chatService.js';
import {
  appendMessage,
  listEntries,
  saveEntry,
  touchStage,
  MAX_ENTRY_BODY_CHARS,
  type ConsultProject,
} from './projectStore.js';
import { countSourcesByKind, sourceLevelFor } from './sourceStore.js';
import { startRun, failRun, finishRun, type ConsultRun } from './runStore.js';
import { autoSearchForStages, searchNoteText, type AutoSearchOutcome } from './autoSourceService.js';

// 「四看一键跑完」：四步**同时**发四次 AI 调用，跑完各自自动定稿。
//
// 这是用户明确要的流程（原来是 看自己 → 看行业 → 看竞品 → 看用户 一步一步解锁，
// 每步等三四分钟、等完还要点一次定稿）。代价必须说清楚，因为它在界面上看不出来：
// 这四份**谁也没读到另外三份的定稿**（并行的意思就是那时候它们都还不存在），而四份
// 各自都通顺、表格齐全、置信度照给 —— 和按顺序跑出来的那四份在屏幕上一模一样。
// 所以三处一起管：prompt 里明说（`parallelSection`）、定稿那条记录里写一句
// （`PARALLEL_NOTE`）、四步之间不互相标 stale（`saveEntry` 的 `staleExcept`，
// 否则一键跑完立刻三个「⚠ 建议重跑」，而用户唯一想得到的动作是再花 4 次额度重跑）。

const FOUR_VIEWS_GROUP = '四看';

/**
 * 四看是哪四步 —— 从 `STAGE_DEFAULTS` 按 group 取，不在这里手写一份 key 清单。
 *
 * 手写的那份迟早和阶段清单对不上：以后四看加/改一步，这里照旧跑老的那四个，
 * 界面上「一键分析四看」按下去一切正常，只是新那步永远没跑过（进度停在 3/4 而没有报错）。
 */
export function fourViewKeys(): string[] {
  return STAGE_DEFAULTS.filter((s) => s.group === FOUR_VIEWS_GROUP).map((s) => s.key);
}

const labelOf = (key: string) => stageByKey(key)?.label || key;

/** 定稿那条记录里必须带的一句。删了它的话「并行出的」和「按顺序做的」再也分不出来。 */
const PARALLEL_NOTE =
  '⚡ 这一版是「四看一键分析」并行出的，也自动定稿了：写它的时候另外三看还在跑，' +
  '所以它只读了客户资料（和已采纳的联网资料），没读到另外三步的结论。' +
  '四步都出来之后对照一遍，哪一步口径不对就单独重跑那一步。';

export interface FourViewsSkip {
  stageKey: string;
  label: string;
  reason: string;
}

export interface FourViewsStart {
  runs: ConsultRun[];
  skipped: FourViewsSkip[];
  /** 这次自动联网的结果。**四种状态都要在界面上说**（见 `AutoSearchOutcome`）。 */
  search: AutoSearchOutcome;
}

/**
 * 四步一起开跑，**立刻返回**（不等结果）。
 *
 * 不等是必须的：四次调用各要几十秒到几分钟，同一个请求里等完的话它必然撞上反代/浏览器
 * 的超时，而那四次调用照旧在跑、额度照旧扣了 —— 用户看到的是一句「网络错误」。
 * 进度全靠 `consult_runs`（109）：每一步开跑前先 `startRun` 占住位子，所以
 * ① 连点两次第二次一个 run 都占不到（否则八次调用、八份草稿，界面上只看得到后四份）；
 * ② 刷新/离开之后 `GET …/runs` 照样接得回来。
 */
export async function startFourViews(userId: string, project: ConsultProject): Promise<FourViewsStart> {
  // 四看的结论全部来自客户资料，空着的话四步一起编 —— 而编出来的四份读着完全正常。
  // 和 draftFastStage 里那道闸同一个理由，只是这里要在扣任何额度**之前**拦住。
  if (!project.brief.trim()) {
    throw new StageError(
      '先贴一段客户资料再一键分析 —— 四看的结论全部来自这段资料，空着的话 AI 四步一起编（4 次额度）',
      400
    );
  }

  const keys = fourViewKeys();
  const done = new Set(listEntries(project.id).map((e) => e.stage_key));
  const skipped: FourViewsSkip[] = [];
  const runs: ConsultRun[] = [];

  for (const key of keys) {
    // 已定稿的不重跑：定稿是下游每一步的依据，覆盖掉的话他昨天核过的那一版就没了，
    // 而界面上只是多了一版「已定稿」。要重跑得他自己在那一步上点。
    if (done.has(key)) {
      skipped.push({ stageKey: key, label: labelOf(key), reason: '已经定稿了，这次没动它' });
      continue;
    }
    const run = startRun(project.id, key, 'draft');
    if (!run) {
      skipped.push({ stageKey: key, label: labelOf(key), reason: '已经有一次分析在跑，这次没重开' });
      continue;
    }
    runs.push(run);
  }

  if (!runs.length) {
    throw new StageError(
      `四看这四步现在没有一步需要跑：${skipped.map((s) => `${s.label}（${s.reason}）`).join('、')}`,
      409
    );
  }

  const batchKeys = runs.map((r) => r.stage_key);

  // **先占位再联网**：联网这一段要等十几秒到一分钟（1 次出词调用 + 四组检索），
  // 反过来先联网的话这段时间里那颗按钮还是可点的，连点两次就是两次出词调用（两次额度）
  // 加两批搜索，而第二次点完照旧只跑一批分析 —— 界面上完全看不出多花了一次。
  //
  // 这一段**在同一个请求里 await**（整个 POST 因此要等它）：搜到的资料必须在四步的
  // prompt 拼起来之前就落库，晚一步的话那四份是按 L2/L3 编的，而正文和引用了外部数据的
  // 那一版读起来一模一样，只有证据级别那一栏不同（它在定稿之后才出现一次）。
  const search = await autoSearchForStages(userId, project, batchKeys);

  for (const run of runs) {
    // 同批的另外几步（不含自己）写进 prompt：模型知道它们还没写完，才不会引用
    // 一份不存在的上游结论。
    const others = batchKeys.filter((k) => k !== run.stage_key).map(labelOf);
    void runOne(userId, project, run, others, batchKeys, search.note);
  }
  return { runs, skipped, search };
}

/**
 * 跑一步：出草稿 → 进对话 → 自动定稿。
 *
 * **这个 promise 没人 await**（见 `startFourViews`），所以它一个异常都不许漏出去：
 * 漏出去是 unhandledRejection，进程里只剩一行警告，而那条 run 永远停在 running ——
 * 界面上那一步永远「正在分析」，重点一次还被那条唯一索引挡住（这一步就此点不动）。
 */
async function runOne(
  userId: string,
  project: ConsultProject,
  run: ConsultRun,
  otherLabels: string[],
  batchKeys: string[],
  /**
   * 这次自动联网的结论，**要跟着定稿那条记录一起存下来**。
   * 只回在那个 POST 的返回里的话，刷新一次就没了 —— 而「这一版是查了资料写的」和
   * 「这一版压根没联网、数字是按常识给的区间」在正文里读起来一模一样，
   * 事后唯一的线索就只剩证据级别那一栏（L1? / L2），而那一栏解释不了成因。
   */
  searchNote: string
): Promise<void> {
  const label = labelOf(run.stage_key);
  try {
    const { draft, truncated } = await draftFastStage(userId, project, run.stage_key, {
      // 上游还没定稿是这条路的前提，所以两个一起传（见 draftFastStage 的注释）
      skipUnlock: true,
      parallelWith: otherLabels,
    });
    touchStage(project.id, run.stage_key, 'exploring', { incRound: true });
    const message = appendMessage(project.id, run.stage_key, {
      role: 'assistant',
      kind: 'draft',
      content: draftToText(draft),
      payload: draft,
    });

    // 断在半句话上的正文**不自动定稿**：定稿是下游十步的依据，而截断的那一版在屏幕上
    // 和写完的一模一样（结论、前几节表格都在，只是最后一节没了）。手动那条路上这件事
    // 由他 review 时挡住（界面上有「这一版被截断了」），一键这条路上没人 review，
    // 所以改成「草稿留在对话里 + 这条 run 标失败并说出成因」——
    // 不说的话他看到的是「已定稿」，而那一节永远缺着。
    const tooLong = draft.body.length > MAX_ENTRY_BODY_CHARS;
    if (truncated || tooLong) {
      failRun(
        run.id,
        truncated
          ? `「${label}」这一版被截断了（思维链吃掉了 max_tokens），所以**没有**自动定稿。` +
              '草稿已经留在这一步的对话里，你自己看一眼：缺的那几节补上再手动定稿，或者单独重跑这一步。'
          : `「${label}」这一版正文 ${draft.body.length} 字，超过定稿上限 ${MAX_ENTRY_BODY_CHARS} 字，` +
              '所以**没有**自动定稿（自动截一刀的话会悄悄丢掉最后几节）。草稿在这一步的对话里，自己删减一下再定稿。'
      );
      return;
    }

    const { entry, staled } = saveEntry(
      project.id,
      run.stage_key,
      {
        conclusion: draft.conclusion,
        body: draft.body,
        rationale: draft.rationale,
        evidence: draft.evidence,
        confidence: draft.confidence,
        aiOpportunities: draft.aiOpportunities,
        // 级别按「实际喂进去了什么」算，不问模型（硬规则 3）。自动联网搜到的那几条
        // 算 `L1?`（查过网但没人核对过），不算 L1 —— 一键这条路上他一条都没看过。
        sourceLevel: (() => {
          const n = countSourcesByKind(project.id);
          return sourceLevelFor({
            hasPicked: n.picked > 0,
            hasAuto: n.auto > 0,
            hasBrief: !!project.brief.trim(),
          });
        })(),
      },
      // 同批那四步之间不互相标 stale（见 saveEntry 的注释）
      batchKeys
    );
    appendMessage(project.id, run.stage_key, {
      role: 'assistant',
      kind: 'entry',
      content: `${entryToText(
        { ...entry, ai_opportunities: draft.aiOpportunities },
        staled.map(labelOf)
      )}\n\n${PARALLEL_NOTE}\n\n${searchNoteText(searchNote)}`,
      payload: { version: entry.version, confidence: entry.confidence, sourceLevel: entry.source_level },
    });
    finishRun(run.id, message.id);
  } catch (err) {
    // 原文整段落库（`failRun`）：四次里挂一次是常事（额度用完 429、上游忙 503、
    // 思维链吃光 max_tokens），而这四种的解法完全不同。合成一句「分析失败」的话
    // 他会把四步全重跑一遍（再花 4 次额度），而真正该做的可能只是等一分钟。
    const msg = (err as Error)?.message || String(err);
    failRun(run.id, `「${label}」这一步没跑成：${msg}`);
    console.warn(`[consult] 四看并行：${label} 失败 —— ${msg}`);
  }
}
