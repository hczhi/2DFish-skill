import { getDatabase } from '../../db/index.js';
import { holdPoints, keyIdOfUser, type PointHold } from '../appKeyService.js';
import { sdkAiStatus, chargeExtraSdkAiCalls } from '../consult/sdkLimits.js';
import type { BpOwner } from './reportStore.js';

// BP 分析对第三方开放时的计费与上限（品牌咨询的 key / iframe 嵌入，管理员不受这里管）。
//
// - **key 用户：一份报告固定 `BP_REPORT_POINTS` 点**。开跑前冻结（不够当场 402，不会跑到一半停），
//   跑完结算一笔、失败解冻（reportStore.finishReport / failReport）；扣过之后续跑、重跑不再扣。
//   报告里的每次调用不再按次扣 1 点 —— 由 core/llm/callContext 的 `coversPoints` 告诉网关；
//   漏了的话一份报告既扣 200 又扣十几个 1 点，流水上是一堆看起来正常的零散扣费。
// - **嵌入版（pk）：按实际调用次数计这把 pk 的当日额度**（同咨询的口径，后台「今日已用」就是真实调用数），
//   开跑前按 `BP_EST_AI_CALLS` 预检：不预检的话跑到第七章撞上限，前面六章的钱白花、报告停在一半。
// - **每个 owner 每天最多开跑 `BP_DAILY_RUNS` 次**（新建 + 续跑 + 重跑都算）：一份约 30 次联网检索，
//   而嵌入用的 pk 是公开字符串，重跑对 key 用户又是免费的 —— 不封顶的话一个循环就能刷几百份。

export const BP_REPORT_POINTS = 200;
export const BP_EST_AI_CALLS = 15;
export const BP_DAILY_RUNS = 10;

export class BpLimitError extends Error {
  constructor(message: string, public status: number, public code: string, public extra: Record<string, unknown> = {}) {
    super(message);
    this.name = 'BpLimitError';
  }
}

export const ownerOf = (req: { user?: { id: string }; sdkPk?: string; externalUid?: string }): BpOwner => ({
  userId: req.user!.id, sdkPk: req.sdkPk ?? null, externalUid: req.externalUid ?? null,
});

/** 计次的那个主体：key → 按这把 key；嵌入 → 按 pk（一个接入方所有终端用户合计）；管理员 / 普通账号 → 不计。 */
function usageOwner(owner: BpOwner): { key: string; label: string } | null {
  const keyId = keyIdOfUser(owner.userId);
  if (keyId) return { key: `key:${keyId}`, label: '这把 key' };
  if (owner.sdkPk) return { key: `pk:${owner.sdkPk}`, label: '这个接入方' };
  return null;
}

/**
 * 开跑前的全部闸门（新建 / 续跑 / 重跑都走这里），按顺序：pk 状态 → pk 额度预检 → 当日次数 → 冻结点数。
 * 次数用一条带条件的 UPSERT 原子加一（先读再写的话并发两次都看见「还有一次」）。
 * `needPoints = false`：这份报告已经扣过（续跑 / 重跑），不再冻结。
 * 返回冻结记录（不是 key 用户或不需要时为 null）；调用方后面失败了要 `releasePoints`。
 */
export function admitRun(owner: BpOwner, needPoints: boolean): PointHold | null {
  const est = BP_EST_AI_CALLS;
  const cap = BP_DAILY_RUNS;
  const what = '一份 BP 报告';
  if (owner.sdkPk) {
    const st = sdkAiStatus(owner.sdkPk);
    if (!st || !st.enabled) throw new BpLimitError('接口已关闭，请联系管理员', 403, 'sdk_key_disabled');
    if (st.limit - st.used < est) {
      throw new BpLimitError(
        `这个接入方（${st.name}）今天的 AI 调用还剩 ${Math.max(st.limit - st.used, 0)} 次（${st.used}/${st.limit}），`
          + `${what}最多约需 ${est} 次，不够跑完，这次没有开始。服务器时间 0 点重置，或联系管理员调高这把 key 的每日上限。`,
        429, 'sdk_ai_quota', { used: st.used, limit: st.limit, need: est }
      );
    }
  }
  const u = usageOwner(owner);
  if (u) {
    const day = new Date().toISOString().split('T')[0];
    const db = getDatabase();
    const ok = db.prepare(
      `INSERT INTO bp_usage (owner, day, runs) VALUES (?, ?, 1)
       ON CONFLICT(owner, day) DO UPDATE SET runs = runs + 1 WHERE runs < ?`
    ).run(u.key, day, cap).changes === 1;
    if (!ok) {
      throw new BpLimitError(
        `${u.label}今天已经开跑 ${cap} 次 BP 分析（新建、接着跑、重跑都算），到上限了，服务器时间 0 点重置。`,
        429, 'bp_daily_cap', { limit: cap }
      );
    }
  }
  // 点数最后冻结：前面任何一道拒了都不该冻结（冻结了又要解，并发时可用点数会闪一下）。
  if (!needPoints) return null;
  try {
    return holdPoints(owner.userId, BP_REPORT_POINTS);
  } catch (e) {
    // 点数不够这次没跑：刚加上的那次计数退回去，不然他充完值回来发现今天的次数被几次 402 吃掉了。
    if (u) getDatabase().prepare(`UPDATE bp_usage SET runs = MAX(runs - 1, 0) WHERE owner = ? AND day = ?`).run(u.key, new Date().toISOString().split('T')[0]);
    throw e;
  }
}

/** 嵌入版：报告里每发出一次 AI 调用，这把 pk 的当日用量加一（失败也算，钱已经花了）。 */
export const sdkCallCounter = (pk: string | null) => (pk ? () => chargeExtraSdkAiCalls(pk, 1) : undefined);
