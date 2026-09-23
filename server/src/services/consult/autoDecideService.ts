import { listMessages, appendMessage, touchStage, type ConsultMessage } from './projectStore.js';
import { StageError } from './draftService.js';
import {
  applyDecisions,
  type DecisionBy,
  type DecisionSheet,
  type DecidedSheet,
  type PickInput,
} from './decisionService.js';
import { decidedToText } from './chatService.js';

// 「AI 替他在那几处取舍上拍板」——全自动出整份报告（14 步串着跑）的前提：
// 慢车道那 8 步在动笔之前要求一条 `kind='decided'` 记录（没有就 400），而全自动跑的时候
// 没有人在屏幕前面点那几张卡片。
//
// 这条路唯一的风险不是选错（选错还能重跑那一步），是**选完看不出是谁选的**：
// 原来那段 prompt 写的是「顾问已经拍板」「他定了 X」，还要求正文的「方法论速览」
// 写明这几处是顾问定的 —— 直接拿来用的话，整份方案里唯一能看出地基是谁定的那一段
// 变成一句假话，而正文读起来完全正常（它本来就该那么写）。所以每一处都带 `by`
// （见 `DecisionBy`），prompt 和对话记录两处都跟着分岔。
//
// 选哪一个**在代码里算**（硬规则 3）：模型那句 `recommend` 是自由文本，让它另回一个
// 「推荐第几项」的字段就是又开一个它会算错的格式（回 2 而正文写的是第 3 个选项，
// 存下来的记录和真的一模一样）。所以拿 `recommend` 去比对选项 label，比不出唯一一个
// 就老实记成 `ai-fallback`。

/** 一处自动拍板的结果（喂给 `applyDecisions` 的那份 + 谁定的）。 */
interface AutoPick {
  id: string;
  label: string;
  by: Exclude<DecisionBy, 'consultant'>;
}

/**
 * 按代码规则给一份岔路口清单挑答案。**纯函数**，不碰库。
 *
 * 规则：`recommend` 那句话里**恰好**出现一个选项的 label → 就是它（`ai-recommend`）；
 * 一个都没出现、或真的出现了两个以上（「A 和 B 都行，看你」）→ 拿第一个选项并记
 * `ai-fallback`。
 *
 * **被别的命中项包住的那些不算命中**：模型给的 label 常常互为子串
 * （「稳住」/「稳住存量 + 打新城」），推荐句里写了长的那个，短的那个一定也 `includes`
 * 得到 —— 不去掉的话这一处被判成「它没给准」，于是落库的是**第一个选项**，
 * 而它可能正是它不推荐的那条。那条记录在对话里、在正文的方法论速览里读起来完全正常。
 */
export function autoPicksFor(sheet: DecisionSheet): AutoPick[] {
  const points = Array.isArray(sheet.points) ? sheet.points : [];
  return points.map((p) => {
    const options = Array.isArray(p.options) ? p.options : [];
    const rec = String(p.recommend || '');
    const raw = options.map((o) => o.label).filter((l) => l && rec.includes(l));
    const hit = raw.filter((l) => !raw.some((other) => other !== l && other.includes(l)));
    // 恰好一个才算「它自己建议的」。真的两个都被点到时（互不为子串）第一个选项可能正是
    // 它不推荐的那条 —— 所以那种记 ai-fallback（他复核时那一处要排在最前面）。
    if (hit.length === 1) return { id: p.id, label: hit[0], by: 'ai-recommend' as const };
    return { id: p.id, label: options[0]?.label || '', by: 'ai-fallback' as const };
  });
}

export interface AutoDecideResult {
  decided: DecidedSheet;
  message: ConsultMessage;
  /** 这一处是 AI 掷硬币定的（`ai-fallback`）有几处。要显示出来 —— 见下面 `autoDecideStage`。 */
  fallbacks: number;
}

/**
 * 读这一步最后那一版岔路口清单，按代码规则替他定完，落一条 `kind='decided'` 记录。
 *
 * **不打模型**（0 次额度）：清单是上一次 `buildDecisions` 已经花过钱出来的，
 * 这里只是挑。
 *
 * 落库那条记录的 `role` 是 `assistant`，不是手动那条路的 `user` —— 存成 user 的话
 * 过两天回来看，对话里是「他说他定了这几处」，而他一处都没看过。
 */
export function autoDecideStage(projectId: string, stageKey: string): AutoDecideResult {
  const msgs = listMessages(projectId, stageKey);
  const last = [...msgs].reverse().find((m) => m.kind === 'decisions');
  if (!last) {
    throw new StageError('这一步还没有出过待定方向，没什么可定的 —— 先点「开始分析」。', 400);
  }
  let sheet: DecisionSheet;
  try {
    sheet = JSON.parse(last.payload || '{}') as DecisionSheet;
  } catch {
    throw new StageError('那一版待定方向的记录读不出来了 —— 点一次「重新分析这一步」。', 500);
  }

  const auto = autoPicksFor(sheet);
  const by = new Map<string, DecisionBy>(auto.map((a) => [a.id, a.by]));
  const raw: PickInput[] = auto.map((a) => ({ id: a.id, label: a.label }));
  // 校验照旧走 applyDecisions（选项必须是摆出来的那几个之一、清单必须是最新那版）——
  // 在这里另写一遍的话，自动这条路会慢慢接受手动那条路拒掉的东西（例如答案配到
  // 上一版清单的问题上），而存下来的记录读起来完全正常。
  const decided = applyDecisions(projectId, stageKey, last.id, raw, by);
  touchStage(projectId, stageKey, 'exploring');
  const message = appendMessage(projectId, stageKey, {
    role: 'assistant',
    kind: 'decided',
    content: decidedToText(decided),
    payload: decided,
  });
  return {
    decided,
    message,
    fallbacks: decided.picks.filter((p) => p.by === 'ai-fallback').length,
  };
}
