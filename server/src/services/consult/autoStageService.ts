import { stageByKey } from './stages.js';
import { draftFastStage, StageError } from './draftService.js';
import { buildDecisions } from './decisionService.js';
import { autoDecideStage } from './autoDecideService.js';
import { draftToText, entryToText, decisionsToText } from './chatService.js';
import {
  appendMessage,
  saveEntry,
  touchStage,
  MAX_ENTRY_BODY_CHARS,
  type ConsultProject,
} from './projectStore.js';
import { countSourcesByKind, sourceLevelFor } from './sourceStore.js';
import { failRun, finishRun, type ConsultRun } from './runStore.js';
import { searchNoteText } from './autoSourceService.js';

// 「这一步全自动跑完」：出方向 → AI 按建议拍板 → 出正文 → 自动定稿，中间不停。
//
// 这是「填完问卷一次出整份报告」的**单步零件**（那条驱动器就是照阶段顺序把它调 14 遍）。
// 先做成一个单步按钮是为了让他能一步一步核这条路的产出 —— 直接上整份的话，
// 第一次看到 AI 替他定的那些取舍是在十四步、二十多次额度之后。
//
// 这条路上没有人在屏幕前 review，所以手动流程里靠「他看一眼」挡住的两件事必须由代码挡：
// ① 截断/超长的正文**不自动定稿**（定稿是下游每一步的依据，而断在半句上的正文和写完的
//    在屏幕上一模一样）；② AI 替他定了几处取舍要写进**定稿那条记录**里 —— 只写在拍板那条
//    记录里的话，跑完十四步他读的是十四份「已定稿」，而地基是谁定的要逐步往上翻才看得到。

const labelOf = (key: string) => stageByKey(key)?.label || key;

export interface AutoStageOutcome {
  stageKey: string;
  label: string;
  status: 'done' | 'failed';
  /** 失败原因（上游原文整段，不合成一句 —— 硬规则 1）。 */
  error?: string;
  version?: number;
  /** 这一步实际打了几次模型（慢车道 2 次：出方向 + 出正文；快车道/执行层 1 次）。 */
  aiCalls: number;
  /** 慢车道 AI 替他定的处数 / 其中掷硬币的处数。两个都要，见 `DecisionBy`。 */
  aiPicked?: number;
  fallbacks?: number;
}

/** 定稿那条记录里必须带的一句。删了它「全自动跑的」和「他一步步核过的」再也分不出来。 */
function autoNote(aiPicked: number, fallbacks: number): string {
  const head =
    '⚡ 这一版是「这一步全自动跑完」出的，也自动定稿了 —— 中间没有人看过。' +
    '往下每一步都会拿它当依据，所以先核一眼结论和那几张表，不对就单独重跑这一步。';
  if (!aiPicked) return head;
  return (
    `${head}\n\n⚠ 这一版的地基里有 ${aiPicked} 处取舍是 **AI 替你定的**（你还没核过）` +
    (fallbacks
      ? `，其中 ${fallbacks} 处它连建议都没给准、用的是第一个选项 —— 先看这几处`
      : '') +
    '。哪几处、放弃了什么写在上面那条拍板记录里（每一行都标着 ⚠）。'
  );
}

/**
 * 跑完一步：慢车道先出方向并让 AI 按建议拍板，然后出正文、自动定稿。
 *
 * **`run` 由调用方先 `startRun` 占住**（连点两次的第二次就占不到），这里只负责
 * `finishRun` / `failRun`。**一个异常都不许漏出去**：这个 promise 通常没人 await，
 * 漏出去是 unhandledRejection，而那条 run 永远停在 running —— 界面上这一步永远
 * 「正在分析」，重点一次还被那条唯一索引挡住（这一步就此点不动）。
 *
 * 联网**不在这里**（调用方在占位之后自己 await 一次 `autoSearchForStages`）：
 * 整份报告那条驱动器要的是「一次出词覆盖所有待跑步骤」，放进来的话十四步各搜一遍，
 * 多花十三次额度而界面上只是「慢了一点」。
 */
export async function runStageAuto(
  userId: string,
  project: ConsultProject,
  run: ConsultRun,
  /** 这次自动联网的结论，要跟着定稿那条记录一起落库（同 `fourViewsBatch.runOne`）。 */
  searchNote: string
): Promise<AutoStageOutcome> {
  const stageKey = run.stage_key;
  const label = labelOf(stageKey);
  let aiCalls = 0;
  let aiPicked = 0;
  let fallbacks = 0;
  const failed = (msg: string): AutoStageOutcome => {
    failRun(run.id, msg);
    console.warn(`[consult] 全自动跑「${label}」失败 —— ${msg}`);
    return { stageKey, label, status: 'failed', error: msg, aiCalls, aiPicked, fallbacks };
  };

  try {
    // 慢车道：先出那一屏岔路口，再让 AI 按它自己的建议定完（拍板不花额度）。
    // 两条记录都要落库 —— 只在内存里传给出正文的话，他事后翻这一步看不到
    // 「AI 面对的是哪几个选项、放弃了什么」，而那是这一步唯一不可逆的信息。
    if (stageByKey(stageKey)?.lane === 'slow') {
      const sheet = await buildDecisions(userId, project, stageKey);
      aiCalls += 1;
      touchStage(project.id, stageKey, 'exploring');
      appendMessage(project.id, stageKey, {
        role: 'assistant',
        kind: 'decisions',
        content: decisionsToText(sheet),
        payload: sheet,
      });
      const auto = autoDecideStage(project.id, stageKey);
      aiPicked = auto.decided.picks.length;
      fallbacks = auto.fallbacks;
    }

    const { draft, truncated } = await draftFastStage(userId, project, stageKey);
    aiCalls += 1;
    touchStage(project.id, stageKey, 'exploring', { incRound: true });
    const message = appendMessage(project.id, stageKey, {
      role: 'assistant',
      kind: 'draft',
      content: draftToText(draft),
      payload: draft,
    });

    // 断在半句话上 / 超过定稿上限的**不自动定稿**（同 fourViewsBatch）：草稿留在对话里，
    // 这条 run 标失败并说出成因。悄悄定稿的话他看到的是「已定稿」，而那一节永远缺着，
    // 后面每一步都拿这份缺了一节的结论当依据。
    const tooLong = draft.body.length > MAX_ENTRY_BODY_CHARS;
    if (truncated || tooLong) {
      return failed(
        truncated
          ? `「${label}」这一版被截断了（思维链吃掉了 max_tokens），所以**没有**自动定稿。` +
              '草稿已经留在这一步的对话里：缺的那几节补上再手动定稿，或者单独重跑这一步。'
          : `「${label}」这一版正文 ${draft.body.length} 字，超过定稿上限 ${MAX_ENTRY_BODY_CHARS} 字，` +
              '所以**没有**自动定稿（自动截一刀会悄悄丢掉最后几节）。草稿在这一步的对话里，自己删减一下再定稿。'
      );
    }

    const { entry, staled } = saveEntry(project.id, stageKey, {
      conclusion: draft.conclusion,
      body: draft.body,
      rationale: draft.rationale,
      evidence: draft.evidence,
      confidence: draft.confidence,
      aiOpportunities: draft.aiOpportunities,
      // 级别按「实际喂进去了什么」算，不问模型（硬规则 3）。自动搜来的那几条算 `L1?` ——
      // 这条路上他一条都没核过。
      sourceLevel: (() => {
        const n = countSourcesByKind(project.id);
        return sourceLevelFor({
          hasPicked: n.picked > 0,
          hasAuto: n.auto > 0,
          hasBrief: !!project.brief.trim(),
        });
      })(),
    });
    appendMessage(project.id, stageKey, {
      role: 'assistant',
      kind: 'entry',
      content: `${entryToText(
        { ...entry, ai_opportunities: draft.aiOpportunities },
        staled.map(labelOf)
      )}\n\n${autoNote(aiPicked, fallbacks)}${searchNote ? `\n\n${searchNoteText(searchNote)}` : ''}`,
      payload: { version: entry.version, confidence: entry.confidence, sourceLevel: entry.source_level },
    });
    finishRun(run.id, message.id);
    return { stageKey, label, status: 'done', version: entry.version, aiCalls, aiPicked, fallbacks };
  } catch (err) {
    // 原文整段落库：额度用完 429 / 上游忙 503 / 思维链吃光 max_tokens / 慢车道那一屏
    // 一个岔路口都没立住 —— 四种的解法完全不同，合成一句「分析失败」他只会一路重跑，
    // 而每次重跑都真扣一次额度。
    const msg = err instanceof StageError ? err.message : (err as Error)?.message || String(err);
    return failed(`「${label}」这一步没跑成：${msg}`);
  }
}
