import { Router, Request, Response } from 'express';
import { aiGatewayStream, QuotaExceededError, resolveLLMConfig } from '../core/llm/gateway.js';
import { toolDefinitions } from '../core/tools/definitions.js';
import { streamWithToolCalls } from '../core/streaming.js';
import { loadAllSkills, findMatchingSkills, buildSkillPromptSection } from '../services/skillService.js';
import { setCurrentUser, ensureWorkspaceExists } from '../services/fileService.js';
import { getDatabase } from '../db/index.js';
import { v4 as uuidv4 } from 'uuid';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

export const consultantRouter = Router();

const RECENT_COUNT = 10;

function getConsultantMessages(userId: string) {
  const db = getDatabase();
  return db.prepare('SELECT * FROM consultant_messages WHERE user_id = ? ORDER BY created_at ASC').all(userId) as Array<{
    id: string; role: string; content: string; created_at: string;
  }>;
}

function saveConsultantMessage(userId: string, role: string, content: string) {
  const db = getDatabase();
  const id = uuidv4();
  db.prepare('INSERT INTO consultant_messages (id, user_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, userId, role, content, new Date().toISOString());
}

function buildConsultantSystemPrompt(): string {
  const skills = loadAllSkills();
  const skillList = skills.map(s => `- **${s.name}**: ${s.description}`).join('\n');

  return `你是一位专业顾问。用户可以就任何问题向你咨询。

## 你的特点
- 直接、务实、不说废话
- 给出可执行的建议
- 如果发现用户的问题本身有问题，会直接指出
- 使用结构化的方法论来分析问题

## 可用的专业知识模块
${skillList}

## 工作方式
1. 理解用户的真实需求
2. 判断是否需要加载专业知识模块
3. 如果需要，用 read_file 加载相关内容
4. 给出结构化的回答

## 重要规则
- 当用户要求保存、整理文件时，必须实际调用 write_file 工具
- 专注于解决问题`;
}

consultantRouter.get('/messages', (req: Request, res: Response) => {
  const messages = getConsultantMessages(req.user!.id);
  res.json(messages);
});

consultantRouter.delete('/messages', (req: Request, res: Response) => {
  const db = getDatabase();
  db.prepare('DELETE FROM consultant_messages WHERE user_id = ?').run(req.user!.id);
  db.prepare('DELETE FROM consultant_summaries WHERE user_id = ?').run(req.user!.id);
  res.json({ success: true });
});

consultantRouter.post('/stream', async (req: Request, res: Response) => {
  const { message } = req.body as { message: string };
  if (!message) { res.status(400).json({ error: 'message is required' }); return; }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendEvent = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const userId = req.user!.id;
  setCurrentUser(userId);
  ensureWorkspaceExists(userId);

  try {
    saveConsultantMessage(userId, 'user', message);

    let systemPrompt = buildConsultantSystemPrompt();
    const matchedSkills = findMatchingSkills(message);
    if (matchedSkills.length > 0) {
      systemPrompt += buildSkillPromptSection(matchedSkills);
    }

    const allMessages = getConsultantMessages(userId);
    const recent = allMessages.slice(-RECENT_COUNT);
    const contextMessages: ChatCompletionMessageParam[] = recent.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    const fullMessages: ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...contextMessages,
    ];

    const { stream: _, model, onComplete } = await aiGatewayStream(
      { messages: fullMessages, tools: toolDefinitions, stream_options: { include_usage: true } },
      { userId, source: 'consultant', operation: 'stream', requestSummary: message.slice(0, 50) }
    );

    const { client } = resolveLLMConfig();
    const startTime = Date.now();

    const { content, totalInput, totalOutput } = await streamWithToolCalls({
      res, client, model, messages: fullMessages, tools: toolDefinitions, userId,
    });

    if (content) {
      saveConsultantMessage(userId, 'assistant', content);
    }

    const duration = Date.now() - startTime;
    if (totalInput || totalOutput) {
      onComplete(totalInput, totalOutput, duration);
    }

    sendEvent('done', {});
    res.end();
  } catch (error) {
    if (error instanceof QuotaExceededError) {
      sendEvent('error', { error: 'quota_exceeded', remaining: 0, daily_limit: error.dailyLimit });
      res.end();
      return;
    }
    sendEvent('error', { error: error instanceof Error ? error.message : String(error) });
    res.end();
  }
});
