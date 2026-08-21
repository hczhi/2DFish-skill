// 对外中转接口的准入闸门（migration 082）。
//
// 下游拿一把 sk-mmpla-… 按 OpenAI 协议调我们的域名，我们用**绑定的那条接入点**转发。
// 这里只负责回答「这次调用算不算数、用哪条接入点、记在谁头上」。
import { getDatabase } from '../db/index.js';
import {
  findRelayKeyByRaw, touchRelayKey, type RelayKeyPublic,
} from './relayKeyService.js';
import { getProvider, usesDedicatedChannel, type AIProvider } from './aiProviderService.js';

/** key 对不上（抄错了 / 压根不存在）。对外可以直说，好让下游去核对那把 key。 */
export class RelayAuthError extends Error {
  constructor(message = '无效的 API Key') {
    super(message);
    this.name = 'RelayAuthError';
  }
}

/**
 * 接口已被这边关掉（吊销 / 接入点停用 / 接入点删除 / 专属渠道开关关了）。
 *
 * 对外**只说这一句**：具体是哪一种是我们的内部状态，说出来等于把后台配置泄给下游。
 * 但反过来也不能把它并到 RelayAuthError 里 —— 「key 抄错了」和「接口已关闭」合成一句
 * 「无效的 API Key」的话，下游会一直去核对那把没抄错的 key，而真实原因在我们这边。
 * 后台那一页显示 revoke_reason，管理员能分清。
 */
export class RelayClosedError extends Error {
  constructor(message = '接口已关闭，请联系管理员') {
    super(message);
    this.name = 'RelayClosedError';
  }
}

export interface RelayAuth {
  relayKey: RelayKeyPublic;
  provider: AIProvider;
}

/**
 * 校验一把 key，返回它绑的接入点。
 *
 * 顺序上「key 对不对」必须在最前面：先查接入点状态的话，一把伪造的 key 也能试出
 * 我们这边配了什么。
 *
 * 通过之后立刻记一次 last_used_at（哪怕上游随后失败）—— 那一列的含义是
 * 「有没有人在拿这把 key 调」，不置位的话下游配错模型一直在撞，
 * 后台却显示「还没被调用过」，管理员会以为对接方还没开始接。
 */
export function authorizeRelay(rawKey: string | null | undefined): RelayAuth {
  const raw = (rawKey || '').trim();
  if (!raw) throw new RelayAuthError('缺少 API Key');

  const relayKey = findRelayKeyByRaw(raw);
  if (!relayKey) throw new RelayAuthError();

  if (relayKey.revoked_at || !relayKey.enabled) throw new RelayClosedError();

  const provider = getProvider(relayKey.provider_id);
  if (!provider || provider.kind !== 'llm' || !provider.enabled || !provider.api_key) {
    throw new RelayClosedError();
  }
  // 专属渠道开关关掉了也算关闭：管理员关它的意思是「这个人不再走自己的通道」，
  // 而这把 key 花的正是那条通道上的钱 —— 继续能调 = 他以为断掉的口子还在漏。
  if (!usesDedicatedChannel(relayKey.user_id)) throw new RelayClosedError();

  touchRelayKey(relayKey.id);
  return { relayKey, provider };
}

/**
 * 这个用户的对外接口用量。**是这个人所有 key 的合计，不分到每把 key 上** ——
 * ai_logs 只记 user_id + source，没有 key 维度。界面上必须照这个口径写，
 * 把合计数摆在某一行 key 旁边的话，管理员会照着它去判「哪个下游在烧」，
 * 而那个数字里混着另外几把 key 的调用。
 *
 * 「今日」的边界和额度计数器用的是同一个（UTC 日期串比较），两处才不会互相矛盾。
 */
export interface RelayUsage {
  today_calls: number;
  today_tokens: number;
  week_calls: number;
  week_tokens: number;
}

export function relayUsage(userId: string): RelayUsage {
  const db = getDatabase();
  const q = (since: string) =>
    db
      .prepare(
        `SELECT COUNT(*) AS calls, COALESCE(SUM(total_tokens), 0) AS tokens
         FROM ai_logs WHERE user_id = ? AND source = 'relay' AND created_at >= ?`
      )
      .get(userId, since) as { calls: number; tokens: number };

  const today = new Date().toISOString().split('T')[0];
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600_000).toISOString().split('T')[0];
  const t = q(today);
  const w = q(weekAgo);
  return { today_calls: t.calls, today_tokens: t.tokens, week_calls: w.calls, week_tokens: w.tokens };
}
