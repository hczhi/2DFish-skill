import { stages, stageByKey } from './stages.js';
import { StageError } from './draftService.js';
import { listEntries, type ConsultProject } from './projectStore.js';
import { startRun, runningRun } from './runStore.js';
import { runStageAuto } from './autoStageService.js';
import { autoSearchForStages, type AutoSearchOutcome } from './autoSourceService.js';
import {
  startBatch,
  advanceBatch,
  finishBatch,
  failBatch,
  activeBatch,
  ackBatch,
  type ConsultBatch,
} from './batchStore.js';

// 「填完问卷一键生成整份报告」：把还没定稿的那几步按阶段顺序**串着**跑完，每一步都是
// `runStageAuto`（出方向 → AI 按建议拍板 → 出正文 → 自动定稿）。
//
// 串行不是保守 —— 每一步的 prompt 里都带着上游那几步的**定稿**，并行的话下游读到的是
// 一份还不存在的上游结论（四看那条并行路为此专门在 prompt 和定稿记录里各写了一句
// `PARALLEL_NOTE`，因为那四步之间没有依赖）。十四步并行出来的十四份照样通顺、表格齐全，
// 只是「品牌定位」压根没看过「看竞品」的结论 —— 屏幕上看不出任何差别。
//
// 这条路上没有人在屏幕前 review，代价在别处（都已经在 `runStageAuto` 里挡住了）：
// 慢车道那八步的取舍是 AI 按它自己的建议定的、截断的那一版不定稿。这里只多管两件事：
// 进度落库（`consult_batches`，111）和「停在哪一步、后面还剩几步没跑」。

const labelOf = (key: string) => stageByKey(key)?.label || key;

export interface FullReportSkip {
  stageKey: string;
  label: string;
  reason: string;
}

export interface FullReportStart {
  batch: ConsultBatch;
  /** 这一批按顺序要跑的步骤。前端拿它算「第 N / 共 M 步」。 */
  stageKeys: string[];
  labels: string[];
  skipped: FullReportSkip[];
  /** 这次自动联网的结果。**四种状态都要在界面上说**（见 `AutoSearchOutcome`）。 */
  search: AutoSearchOutcome;
  /** 这一批预计要打几次模型 —— 那颗按钮上必须写出来（一整份 ≈ 23 次，默认配额 10 次/天）。 */
  aiCallsEstimate: number;
}

/**
 * 还没定稿的那几步，**按 `stages()` 的顺序**。
 *
 * 顺序直接用阶段清单（它本身就是拓扑序：四看 → 四问 → 四大成 → 执行层），不另写一份
 * 依赖排序 —— 另写的那份迟早和 `requires` 对不上，而症状是某一步开跑时上游还没定稿，
 * `draftFastStage` 抛「未解锁」，于是整批停在半路，读起来像是这个功能坏了。
 *
 * 「待跑」的判据是**没有定稿**（不是「没跑过」）：他中途手动定过几步、上次跑到一半断了，
 * 这份清单都天然从断点继续 —— 所以「接着跑」不需要任何额外状态，就是再点一次那颗按钮。
 */
export function pendingStagesFor(projectId: string): string[] {
  const done = new Set(listEntries(projectId).map((e) => e.stage_key));
  return stages()
    .map((s) => s.key)
    .filter((k) => !done.has(k));
}

/**
 * 界面上现在还该显示的那一批（`batchStore.activeBatch` 再过一道闸）。
 *
 * 停在半路那句红字只在**还有没定稿的步骤**时才是真的：它说的是「剩下 N 步没有跑、再点一次
 * 接着跑」，而他后来把那几步手动跑完（或者又跑了一批）之后，那句话变成一句假警报 ——
 * 十四步全绿、报告能导出，顶上照旧红着，而它指的动作只会回一句 409「都已经定稿了」。
 * 顺手 `ackBatch` 是为了别每次请求都重算一遍（这条判据以后只会更真）。
 */
export function activeBatchFor(projectId: string): ConsultBatch | null {
  const b = activeBatch(projectId);
  if (!b || b.status === 'running') return b;
  if (pendingStagesFor(projectId).length) return b;
  ackBatch(projectId, b.id);
  return null;
}

/** 这一批要打几次模型：慢车道 2 次（出方向 + 出正文），其余 1 次，外加出词那 1 次。 */
export function estimateAiCalls(stageKeys: string[]): number {
  return (
    1 + stageKeys.reduce((n, k) => n + (stageByKey(k)?.lane === 'slow' ? 2 : 1), 0)
  );
}

/**
 * 开跑，**立刻返回**（不等结果，同 `startFourViews`）：整份报告要打二十多次模型、十几分钟，
 * 同一个请求里等完必然撞上反代/浏览器超时，而那些调用照旧在跑、额度照旧扣了 ——
 * 用户看到的是一句「网络错误」。进度全靠 `consult_batches` + `consult_runs`。
 *
 * 顺序是**先占位再联网**（同 `startFourViews`）：反过来的话联网那十几秒里按钮还可点，
 * 连点两次就是两批驱动器跑同一条链。
 */
export async function startFullReport(
  userId: string,
  project: ConsultProject
): Promise<FullReportStart> {
  // 客户资料空着的话整份报告是二十多次调用编出来的，而每一份读起来都完全正常。
  // 和 `startFourViews` 同一道闸，只是这里要在扣任何额度**之前**拦住。
  if (!project.brief.trim()) {
    throw new StageError(
      '先贴一段客户资料（问卷）再一键生成 —— 整份报告的事实全部来自这段资料，空着的话 AI 二十多次调用一路编下去',
      400
    );
  }

  const stageKeys = pendingStagesFor(project.id);
  const skipped: FullReportSkip[] = stages()
    .filter((s) => !stageKeys.includes(s.key))
    .map((s) => ({ stageKey: s.key, label: s.label, reason: '已经定稿了，这次没动它' }));

  if (!stageKeys.length) {
    throw new StageError(
      '十四步都已经定稿了，没有需要跑的。要重做某一步的话在那一步上手动跑（全自动这条路不会盖掉已定稿的版本）。',
      409
    );
  }

  // 有单步正在跑就不开批：开了的话驱动器走到那一步 `startRun` 占不到位子，整批就停在
  // 那里 —— 而那时候已经花掉的是前面几步的额度。在这里拦住，一次额度都还没花。
  for (const key of stageKeys) {
    const busy = runningRun(project.id, key);
    if (busy) {
      throw new StageError(
        `「${labelOf(key)}」正在单独跑（${busy.kind}），整份报告这次没开跑 —— 等它跑完再点一次（已经定稿的那几步不会重跑）。`,
        409
      );
    }
  }

  const batch = startBatch(project.id, userId, stageKeys, '');
  if (!batch) {
    throw new StageError(
      '这个项目已经有一份报告在跑了，这次没重开（等它跑完，或者看上面那条进度）。',
      409
    );
  }

  // 联网**只做一次**、覆盖这一批全部待跑步骤（`autoSearchForStages` 一次出词、并行检索）。
  // 每步各搜一遍的话多花十三次出词额度，而界面上只是「慢了一点」。
  let search: AutoSearchOutcome;
  try {
    search = await autoSearchForStages(userId, project, stageKeys);
  } catch (err) {
    // 联网这一段挂了要**把占住的位子还回去**：不还的话那条唯一索引把这个项目永久锁在
    // 「已经有一批在跑」，于是这颗按钮从此一律 409，而压根没有人在跑它。
    const msg = (err as Error)?.message || String(err);
    failBatch(batch.id, `联网查资料这一步挂了，整份报告一步都没开跑：${msg}`);
    throw err;
  }
  batch.search_note = search.note;

  void driveBatch(userId, project, batch, stageKeys, search.note);
  return {
    batch,
    stageKeys,
    labels: stageKeys.map(labelOf),
    skipped,
    search,
    aiCallsEstimate: estimateAiCalls(stageKeys),
  };
}

/**
 * 串行驱动：一步一步跑，**第一步失败就停**。
 *
 * 不接着跑是有理由的：下游每一步的 prompt 都要上游的定稿，失败那一步没有定稿，
 * 接着跑的话后面十一步一路抛「未解锁」—— 十一条失败记录，成因全是同一句，而真正的
 * 成因（额度用完 429 / 上游忙 / 那一版被截断）埋在第一条里。更要紧的是额度用完那一种
 * 会在接着跑的每一步上再撞一次，每一次都是一次真调用。
 *
 * **这个 promise 没人 await**，所以一个异常都不许漏出去：漏出去是 unhandledRejection，
 * 而这一批永远停在 running —— 界面上「正在跑第 7 步」而没有人在跑它，重开还被那条唯一
 * 索引挡住（这颗按钮从此一律 409）。`runStageAuto` 自己不抛，会抛的是 `startRun`/游标写库。
 */
async function driveBatch(
  userId: string,
  project: ConsultProject,
  batch: ConsultBatch,
  stageKeys: string[],
  searchNote: string
): Promise<void> {
  const total = stageKeys.length;
  let cursor = 0;
  /** 停在半路那句话必须带上「后面 M 步没有跑」—— 见 `failBatch`。 */
  const stopped = (why: string) => {
    const left = total - cursor;
    failBatch(
      batch.id,
      `${why}\n\n所以整份报告停在这里：前面 ${cursor} 步已经定稿，后面 ${left} 步**一步都没跑**` +
        '（额度只花在已经跑完的那几步上）。处理掉上面那个原因，再点一次「一键生成整份报告」，' +
        '它会从没定稿的那一步接着跑，已经定稿的不会重跑。'
    );
  };

  try {
    for (const key of stageKeys) {
      const label = labelOf(key);
      // 这一步在这条链跑到它之前已经有人定稿了（另一个标签页 / 第三方 SDK / 他自己手动
      // 跑完的那一步）→ **跳过，不覆盖**。覆盖的话他刚核过的那一版被一版没人看过的顶掉，
      // 而界面上只是「已定稿」（版本号 +1，没有任何一处说这件事）。
      if (listEntries(project.id).some((e) => e.stage_key === key)) {
        cursor += 1;
        advanceBatch(batch.id, cursor);
        console.log(`[consult] 整份报告跳过「${label}」：这一步在链条跑到它之前已经定稿了`);
        continue;
      }
      const run = startRun(project.id, key, 'draft');
      if (!run) {
        stopped(`第 ${cursor + 1}/${total} 步「${label}」上已经有一次分析在跑（你在别处单独点了它？），这一批没跟着重开。`);
        return;
      }
      const out = await runStageAuto(userId, project, run, searchNote);
      if (out.status === 'failed') {
        // 原文整段带出来（`runStageAuto` 已经把上游那句话包在 error 里）：合成一句
        // 「生成失败」的话他只会一路重点这颗按钮，而每次都真跑一遍前面没定稿的那些步。
        stopped(`第 ${cursor + 1}/${total} 步「${label}」没跑成：${out.error || '没有给出原因'}`);
        return;
      }
      cursor += 1;
      // 每跑完一步就写游标（不是整批写一次）：刷新/息屏之后「跑到第几步」全靠这个数。
      advanceBatch(batch.id, cursor);
    }
    finishBatch(batch.id, cursor);
    console.log(`[consult] 整份报告跑完：${project.id}，${cursor} 步`);
  } catch (err) {
    const msg = (err as Error)?.message || String(err);
    stopped(`第 ${cursor + 1}/${total} 步开跑的时候出错了：${msg}`);
    console.warn(`[consult] 整份报告驱动器挂了 —— ${msg}`);
  }
}
