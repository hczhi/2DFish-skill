import { jsonGateway, jsonFailMessage } from '../../core/llm/parseJson.js';
import { SAMPLING } from '../../core/llm/gateway.js';
import { BpError } from './factCardService.js';

// BP 报告各章共用的那一次 JSON 调用。参数在这里定一次：各章各写一份的话，某一章漏了
// `noThinking` 的现象只是「这一章特别慢、偶发截断」，看起来像模型问题（硬规则 2）。
//
// 不自动再来一次（attempts: 1）：失败的成因（截断 / 空返回）第二次多半一样，只是多花一次钱。

export async function bpJson(input: {
  system: string;
  user: string;
  userId: string;
  /** 进 ai_logs.operation，也是报错话术里的章节名。 */
  operation: string;
  label: string;
  filename: string;
  maxTokens?: number;
  timeoutMs?: number;
}): Promise<any> {
  const maxTokens = input.maxTokens ?? 16_000;
  const { parsed, raw, finish, reasoningTokens, noThinkingRequested } = await jsonGateway<any>(
    () => ({
      messages: [
        { role: 'system', content: input.system },
        { role: 'user', content: input.user },
      ],
      ...SAMPLING.analytic,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
    }),
    {
      userId: input.userId,
      source: 'bp',
      operation: input.operation,
      tier: 'strong',
      timeoutMs: input.timeoutMs ?? 240_000,
      maxRetries: 0,
      retryOnBusy: true,
      noThinking: true,
      requestSummary: `${input.filename} · ${input.label}`,
    },
    { attempts: 1 }
  );
  if (!parsed) {
    throw new BpError(
      jsonFailMessage(input.label, { raw, finish, reasoningTokens, budget: maxTokens, noThinkingRequested }),
      502
    );
  }
  return parsed;
}
