import * as fileService from '../../services/fileService.js';
import fs from 'fs';
import path from 'path';

export interface ToolCallResult {
  name: string;
  result: string;
  success: boolean;
}

export function executeTool(name: string, args: Record<string, unknown>, userId?: string): ToolCallResult {
  try {
    switch (name) {
      case 'read_file': {
        const content = fileService.readFile(args.path as string, userId);
        return { name, result: content, success: true };
      }

      case 'write_file': {
        const filePath = args.path as string;
        const content = args.content as string;
        const mode = args.mode as string;

        if (mode === 'append') {
          const existing = (() => { try { return fileService.readFile(filePath, userId); } catch { return ''; } })();
          fileService.writeFile(filePath, existing + '\n' + content, userId);
        } else {
          fileService.writeFile(filePath, content, userId);
        }
        return { name, result: `文件 "${filePath}" 已${mode === 'append' ? '追加' : '写入'}成功。`, success: true };
      }

      case 'list_files': {
        const files = fileService.listFiles(args.path as string, userId);
        return { name, result: JSON.stringify(files, null, 2), success: true };
      }

      case 'search_files': {
        const results = fileService.searchFiles(args.query as string, userId);
        if (results.length === 0) {
          return { name, result: '未找到匹配内容。', success: true };
        }
        const formatted = results.map(r =>
          `${r.path}:\n${r.matches.map(m => `  - ${m.trim()}`).join('\n')}`
        ).join('\n\n');
        return { name, result: formatted, success: true };
      }

      case 'delete_file': {
        const filePath = args.path as string;
        const allowedPrefixes = ['journal/', 'knowledge/', 'monthly/'];
        const isAllowed = allowedPrefixes.some(p => filePath.startsWith(p));
        if (!isAllowed) {
          return { name, result: `错误: 仅允许删除 journal/、knowledge/、monthly/ 目录下的文件。`, success: false };
        }
        fileService.deleteFile(filePath, userId);
        return { name, result: `文件 "${filePath}" 已删除。`, success: true };
      }

      default:
        return { name, result: `未知工具: ${name}`, success: false };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { name, result: `错误: ${message}`, success: false };
  }
}
