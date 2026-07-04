import { Router, Request, Response } from 'express';
import { aiGatewayStream, QuotaExceededError, resolveLLMConfig } from '../core/llm/gateway.js';
import { toolDefinitions } from '../core/tools/definitions.js';
import { streamWithToolCalls } from '../core/streaming.js';
import { buildSystemPrompt } from '../core/prompts/system.js';
import { readFile, setCurrentUser, ensureWorkspaceExists } from '../services/fileService.js';
import { findMatchingSkills, buildSkillPromptSection, loadAllSkills } from '../services/skillService.js';
import { appendToJournal } from '../services/journalService.js';
import {
  getMessages,
  saveMessage,
  clearMessages,
  buildContextMessages,
  generateSummary,
  getLatestSummary,
} from '../services/chatService.js';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

export const chatRouter = Router();

function getContext(userId: string) {
  let indexContent = '';
  let profileContent = '';
  let journalContent: string | null = null;

  try { indexContent = readFile('INDEX.md', userId); } catch { /* empty */ }
  try { profileContent = readFile('CORE_PROFILE.md', userId); } catch { /* empty */ }

  const today = new Date().toISOString().split('T')[0];
  try { journalContent = readFile(`journal/${today}.md`, userId); } catch { /* empty */ }

  return { indexContent, profileContent, journalContent };
}

chatRouter.get('/messages', (req: Request, res: Response) => {
  try {
    const messages = getMessages(req.user!.id);
    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

chatRouter.delete('/messages', (req: Request, res: Response) => {
  try {
    clearMessages(req.user!.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

chatRouter.post('/stream', async (req: Request, res: Response) => {
  const { message } = req.body as { message: string };

  if (!message || typeof message !== 'string') {
    res.status(400).json({ error: 'message is required' });
    return;
  }

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
    saveMessage(userId, 'user', message);

    const { indexContent, profileContent, journalContent } = getContext(userId);
    const { messages: contextMessages, needsSummary } = buildContextMessages(userId);
    const summary = getLatestSummary(userId);
    let systemPrompt = buildSystemPrompt(indexContent, profileContent, journalContent, summary?.summary);

    const matchedSkills = findMatchingSkills(message);
    if (matchedSkills.length > 0) {
      systemPrompt += buildSkillPromptSection(matchedSkills);
      sendEvent('skills_activated', { skills: matchedSkills.map(s => s.name) });
    }

    const allSkills = loadAllSkills();
    if (allSkills.length > 0) {
      systemPrompt += `\n\n## 可用 Skills\n${allSkills.map(s => `- **${s.name}**: ${s.description}`).join('\n')}`;
    }

    const fullMessages: ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...contextMessages,
    ];

    // Check quota and get stream config
    const { stream: _, model, onComplete } = await aiGatewayStream(
      { messages: fullMessages, tools: toolDefinitions, stream_options: { include_usage: true } },
      { userId, source: 'chat', operation: 'stream', requestSummary: message.slice(0, 50) }
    );

    // Use shared streaming utility with the resolved client
    const { client } = resolveLLMConfig();
    const startTime = Date.now();

    const { content, totalInput, totalOutput } = await streamWithToolCalls({
      res, client, model, messages: fullMessages, tools: toolDefinitions, userId,
    });

    if (content) {
      saveMessage(userId, 'assistant', content);
      try { appendToJournal(message, content, userId); } catch { /* non-critical */ }
    }

    if (needsSummary) {
      generateSummary(userId, client, model).catch(() => {});
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
