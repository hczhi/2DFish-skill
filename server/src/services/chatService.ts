import { getDatabase } from '../db/index.js';
import { v4 as uuidv4 } from 'uuid';
import type OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

interface ChatSummary {
  id: string;
  summary: string;
  up_to_message_id: string;
  created_at: string;
}

const RECENT_MESSAGE_COUNT = 10;

export function getMessages(userId: string): ChatMessage[] {
  const db = getDatabase();
  return db.prepare('SELECT * FROM chat_messages WHERE user_id = ? ORDER BY created_at ASC').all(userId) as ChatMessage[];
}

export function saveMessage(userId: string, role: 'user' | 'assistant', content: string): ChatMessage {
  const db = getDatabase();
  const msg: ChatMessage = {
    id: uuidv4(),
    role,
    content,
    created_at: new Date().toISOString(),
  };
  db.prepare('INSERT INTO chat_messages (id, user_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(msg.id, userId, msg.role, msg.content, msg.created_at);
  return msg;
}

export function clearMessages(userId: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM chat_messages WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM chat_summaries WHERE user_id = ?').run(userId);
}

export function getLatestSummary(userId: string): ChatSummary | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM chat_summaries WHERE user_id = ? ORDER BY created_at DESC LIMIT 1').get(userId) as ChatSummary | undefined;
  return row || null;
}

export function saveSummary(userId: string, summary: string, upToMessageId: string): void {
  const db = getDatabase();
  db.prepare('INSERT INTO chat_summaries (id, user_id, summary, up_to_message_id, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(uuidv4(), userId, summary, upToMessageId, new Date().toISOString());
}

export function buildContextMessages(userId: string): { messages: ChatCompletionMessageParam[]; needsSummary: boolean } {
  const allMessages = getMessages(userId);
  const recent = allMessages.slice(-RECENT_MESSAGE_COUNT);
  const needsSummary = allMessages.length > RECENT_MESSAGE_COUNT * 2;

  const contextMessages: ChatCompletionMessageParam[] = recent.map(m => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }));

  return { messages: contextMessages, needsSummary };
}

export async function generateSummary(userId: string, client: OpenAI, model: string): Promise<void> {
  const allMessages = getMessages(userId);
  if (allMessages.length < RECENT_MESSAGE_COUNT) return;

  const toSummarize = allMessages.slice(0, -RECENT_MESSAGE_COUNT);
  const lastMsg = toSummarize[toSummarize.length - 1];

  const existing = getLatestSummary(userId);
  if (existing && existing.up_to_message_id === lastMsg.id) return;

  const conversationText = toSummarize.map(m => `${m.role}: ${m.content}`).join('\n');

  try {
    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: '将以下对话摘要为简洁的要点，保留关键信息和决策。用中文。不超过500字。' },
        { role: 'user', content: conversationText },
      ],
      max_tokens: 600,
    });

    const summary = response.choices[0]?.message?.content;
    if (summary) {
      saveSummary(userId, summary, lastMsg.id);
    }
  } catch { /* non-critical */ }
}
