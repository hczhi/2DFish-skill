// 对外中转接口：`/api/v1/*`，OpenAI 兼容（非流式）。见 migration 082 与 services/relayService.ts。
//
// 路径故意长得像 OpenAI（`/v1/chat/completions`）：下游把 base_url 填成
// `https://我们的域名/api/v1` 就能直接用任何 OpenAI SDK/客户端，不用改代码。
//
// 三条对外语义（错一条就是「看起来能用，其实不是那么回事」）：
//   1. **模型由接入点决定**，body 里的 `model` 一律忽略，返回里回真实模型名 ——
//      下游填了别的模型名却拿到我们这条的回答时，唯一能看出真相的地方就是那个字段。
//   2. **不支持流式**，`stream: true` 直接 400 而不是当没看见：无声忽略的话客户端会
//      一直等 SSE 帧，界面上是「AI 没回答」，没有任何一处报错。
//   3. 报错一律是 OpenAI 的 `{error:{message,type,code}}` 形状 —— 第三方客户端只认这个，
//      回我们自己的 `{error:"…"}` 会被显示成空白或「未知错误」，下游看不到原因。
import { Router, Request, Response } from 'express';
import { authorizeRelay, RelayAuthError, RelayClosedError } from '../services/relayService.js';
import { aiGateway } from '../core/llm/gateway.js';

export const relayRouter = Router();

/** OpenAI 形状的错误体。 */
function relayError(res: Response, status: number, message: string, type: string, code: string): void {
  res.status(status).json({ error: { message, type, code, param: null } });
}

function bearer(req: Request): string {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : (req.headers['api-key'] as string) || '';
}

/**
 * 把闸门抛出来的错映射成 OpenAI 形状。
 * 「key 不对」和「接口已关闭」必须是两句不同的话，理由见 relayService。
 */
function handleAuthError(res: Response, e: unknown): boolean {
  if (e instanceof RelayAuthError) {
    relayError(res, 401, e.message, 'invalid_request_error', 'invalid_api_key');
    return true;
  }
  if (e instanceof RelayClosedError) {
    relayError(res, 403, e.message, 'invalid_request_error', 'endpoint_closed');
    return true;
  }
  return false;
}

/**
 * 只有绑定的那一个模型。
 *
 * 不列别的（哪怕这个用户还有其它接入点）：客户端的模型下拉是照这个列表画的，
 * 多列一个就等于让人选一个选了也不生效的模型 —— 选完照样能出结果，
 * 只是出自另一个模型，界面上完全看不出来。
 */
relayRouter.get('/models', (req: Request, res: Response) => {
  let auth;
  try {
    auth = authorizeRelay(bearer(req));
  } catch (e) {
    if (handleAuthError(res, e)) return;
    throw e;
  }
  const model = auth.provider.model || 'unknown';
  res.json({
    object: 'list',
    data: [{ id: model, object: 'model', created: 0, owned_by: 'mmpla' }],
  });
});

relayRouter.post('/chat/completions', async (req: Request, res: Response) => {
  let auth;
  try {
    auth = authorizeRelay(bearer(req));
  } catch (e) {
    if (handleAuthError(res, e)) return;
    throw e;
  }

  const b = (req.body || {}) as Record<string, any>;

  if (b.stream === true) {
    relayError(
      res,
      400,
      '本接口不支持流式，请把 stream 去掉（或设为 false）后重试。',
      'invalid_request_error',
      'stream_not_supported'
    );
    return;
  }
  // 工具调用同理必须明确拒：悄悄丢掉 tools 的话模型会用一段普通文字回答，
  // 而客户端在等一个 tool_call，表现是「AI 不肯调用工具」，看不出是被我们剥掉了。
  if (b.tools || b.functions || b.tool_choice) {
    relayError(res, 400, '本接口暂不支持工具调用（tools / functions）。', 'invalid_request_error', 'tools_not_supported');
    return;
  }
  if (!Array.isArray(b.messages) || b.messages.length === 0) {
    relayError(res, 400, 'messages 必须是非空数组。', 'invalid_request_error', 'invalid_messages');
    return;
  }

  // 白名单转发：body 里其余字段（含 model）一概不往上游传。
  const params: Record<string, any> = { messages: b.messages };
  for (const k of ['temperature', 'top_p', 'max_tokens', 'presence_penalty', 'frequency_penalty', 'stop', 'response_format', 'seed', 'n']) {
    if (b[k] !== undefined) params[k] = b[k];
  }

  try {
    const { response } = await aiGateway(params as any, {
      userId: auth.relayKey.user_id,
      source: 'relay',
      operation: 'chat-completions',
      // 绑死接入点：档位在这条路上不参与解析（见 GatewayOptions.providerId）
      providerId: auth.provider.id,
      requestSummary: `relay ${auth.relayKey.key_prefix}${auth.relayKey.label ? ` (${auth.relayKey.label})` : ''}`,
    });
    // 回真实模型名：上游没给就用接入点上配的那个。下游若填了别的模型名，
    // 这个字段是他唯一能发现「模型不是我选的那个」的地方。
    res.json({ ...response, model: response.model || auth.provider.model });
  } catch (e: any) {
    if (e?.name === 'QuotaExceededError') {
      relayError(res, 429, e.message, 'insufficient_quota', 'quota_exceeded');
      return;
    }
    // 接入点在校验之后、转发之前被删/停用（管理员正好在这一秒操作）——
    // 对外和「已关闭」是同一句话，否则下游收到 500 会去重试，而它永远不会成功。
    if (e?.name === 'PinnedProviderError') {
      relayError(res, 403, '接口已关闭，请联系管理员', 'invalid_request_error', 'endpoint_closed');
      return;
    }
    console.error('[relay] chat/completions failed:', e?.message || e);
    // 上游的原文要带出去：不带的话下游看到的是一句「转发失败」，
    // 而真实原因（模型名不对、上游余额不足）只有我们的日志里有。
    relayError(res, 502, `上游模型调用失败：${e?.message || 'unknown error'}`, 'api_error', 'upstream_error');
  }
});
