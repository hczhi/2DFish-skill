import type { Response } from 'express';
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions';
import type OpenAI from 'openai';
import { executeTool } from './tools/executor.js';

export interface StreamContext {
  res: Response;
  client: OpenAI;
  model: string;
  messages: ChatCompletionMessageParam[];
  tools?: ChatCompletionTool[];
  userId?: string;
  onComplete?: (assistantContent: string, totalInput: number, totalOutput: number) => void;
}

function sendEvent(res: Response, event: string, data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function streamWithToolCalls(ctx: StreamContext): Promise<{ content: string; totalInput: number; totalOutput: number }> {
  const { res, client, model, messages, tools, userId } = ctx;
  let totalInput = 0;
  let totalOutput = 0;
  let finalContent = '';

  let continueLoop = true;

  while (continueLoop) {
    const stream = await client.chat.completions.create({
      model,
      messages,
      tools,
      stream: true,
      stream_options: { include_usage: true },
    });

    let assistantContent = '';
    let toolCalls: Array<{ id: string; function: { name: string; arguments: string } }> = [];
    let currentToolCallIndex = -1;

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;

      if (delta?.content) {
        assistantContent += delta.content;
        sendEvent(res, 'content', { content: delta.content });
      }

      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          if (tc.index !== currentToolCallIndex) {
            currentToolCallIndex = tc.index;
            toolCalls[tc.index] = { id: tc.id || '', function: { name: tc.function?.name || '', arguments: '' } };
          }
          if (tc.function?.arguments) toolCalls[tc.index].function.arguments += tc.function.arguments;
          if (tc.id) toolCalls[tc.index].id = tc.id;
          if (tc.function?.name) toolCalls[tc.index].function.name = tc.function.name;
        }
      }

      if ((chunk as any).usage) {
        const u = (chunk as any).usage;
        totalInput += u.prompt_tokens || 0;
        totalOutput += u.completion_tokens || 0;
      }
    }

    if (toolCalls.length > 0) {
      messages.push({
        role: 'assistant',
        content: assistantContent || null,
        tool_calls: toolCalls.map(tc => ({ id: tc.id, type: 'function' as const, function: tc.function })),
      });

      for (const tc of toolCalls) {
        const args = JSON.parse(tc.function.arguments);
        sendEvent(res, 'tool_call', { id: tc.id, name: tc.function.name, arguments: args });
        const result = executeTool(tc.function.name, args, userId);
        sendEvent(res, 'tool_result', { id: tc.id, name: tc.function.name, result: result.result, success: result.success });
        messages.push({ role: 'tool', tool_call_id: tc.id, content: result.result });
      }
    } else {
      continueLoop = false;
      finalContent = assistantContent;
    }
  }

  return { content: finalContent, totalInput, totalOutput };
}
