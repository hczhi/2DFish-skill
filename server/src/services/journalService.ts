import { readFile, writeFile } from './fileService.js';

export function appendToJournal(userMessage: string, assistantReply: string, userId?: string): void {
  const today = new Date().toISOString().split('T')[0];
  const filePath = `journal/${today}.md`;
  const time = new Date().toTimeString().slice(0, 5);

  const entry = `\n## ${time}\n**用户**: ${userMessage.slice(0, 200)}\n**AI**: ${assistantReply.slice(0, 300)}\n`;

  let existing = '';
  try {
    existing = readFile(filePath, userId);
  } catch {
    existing = `# ${today} 对话记录\n`;
  }

  writeFile(filePath, existing + entry, userId);
}
