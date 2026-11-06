import { AsyncLocalStorage } from 'node:async_hooks';

// 一组 AI 调用的「计费归属」上下文（AsyncLocalStorage）。目前只有 BP 报告用：一份报告串十几次调用，
// 计费是**整份一次**（key 用户固定 200 点，见 bp/billing.ts），嵌入版按 pk 计实际调用次数。
//
// 用上下文而不是给 GatewayOptions 加一个参数：报告里的调用散在十几处（事实卡 / 各章 / 图片转写），
// 逐处传参的话漏一处的后果是那一次调用**又按次扣了 1 点**（或者反过来，免费了），界面上一切正常。
// 上下文由 runReport / 上传那一下统一包住，网关只读不写。

export interface AiCallContext {
  /**
   * 这组调用已经由上层整体计费（key 用户冻结过整份报告的点数）。网关看到它就**既不按次冻结点数、
   * 也不扣日额度** —— 只跳过前者的话 key 影子用户会落到 `checkAndDeductQuota`，被一个它压根没有的
   * 「10 次/天」挡住。只对 key 影子用户生效，普通账号照旧走日额度。
   */
  coversPoints?: boolean;
  /** 每次真正发出去一次调用时回调（嵌入版按 pk 计当日 AI 调用数用）。失败也算 —— 钱已经花了。 */
  onAiCall?: () => void;
}

export const aiCallContext = new AsyncLocalStorage<AiCallContext>();
