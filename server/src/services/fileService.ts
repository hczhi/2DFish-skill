import fs from 'fs';
import path from 'path';

const WORKSPACES_ROOT = path.resolve(process.cwd(), '../workspaces');

let currentUserId: string = 'default';

/**
 * @deprecated Use explicit userId parameter on each function instead.
 * Kept for backward compatibility only. This sets a global that is unsafe
 * under concurrent requests.
 */
export function setCurrentUser(userId: string): void {
  currentUserId = userId;
}

function getWorkspacePath(userId: string): string {
  return path.join(WORKSPACES_ROOT, userId);
}

function resolveSecurePath(userId: string, relativePath: string): string {
  const basePath = getWorkspacePath(userId);
  const resolved = path.resolve(basePath, relativePath);

  if (!resolved.startsWith(basePath + path.sep) && resolved !== basePath) {
    throw new Error('Access Denied: Path traversal detected.');
  }

  return resolved;
}

const ALLOWED_EXTENSIONS = ['.md', '.json', '.csv', '.txt', '.js'];

function validateExtension(filePath: string): void {
  const ext = path.extname(filePath).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    throw new Error(`Access Denied: Extension "${ext}" is not allowed. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`);
  }
}

export function ensureWorkspaceExists(userId: string): void {
  const workspacePath = path.join(WORKSPACES_ROOT, userId);
  if (!fs.existsSync(workspacePath)) {
    fs.mkdirSync(workspacePath, { recursive: true });
    const dirs = ['journal', 'monthly', 'knowledge', 'skills'];
    for (const dir of dirs) {
      fs.mkdirSync(path.join(workspacePath, dir), { recursive: true });
    }
  }
}

export function readFile(relativePath: string, userId?: string): string {
  const uid = userId ?? currentUserId;
  const fullPath = resolveSecurePath(uid, relativePath);
  validateExtension(fullPath);

  if (!fs.existsSync(fullPath)) {
    throw new Error(`File not found: ${relativePath}`);
  }

  return fs.readFileSync(fullPath, 'utf-8');
}

export function writeFile(relativePath: string, content: string, userId?: string): void {
  const uid = userId ?? currentUserId;
  const fullPath = resolveSecurePath(uid, relativePath);
  validateExtension(fullPath);

  const dir = path.dirname(fullPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf-8');
}

export function deleteFile(relativePath: string, userId?: string): void {
  const uid = userId ?? currentUserId;
  const fullPath = resolveSecurePath(uid, relativePath);
  if (fs.existsSync(fullPath)) {
    fs.unlinkSync(fullPath);
  }
}

export function listFiles(relativePath: string = '', userId?: string): Array<{ name: string; type: 'file' | 'dir'; path: string }> {
  const uid = userId ?? currentUserId;
  const fullPath = resolveSecurePath(uid, relativePath);
  if (!fs.existsSync(fullPath)) return [];

  const entries = fs.readdirSync(fullPath, { withFileTypes: true });
  return entries
    .filter(e => !e.name.startsWith('.'))
    .map(e => ({
      name: e.name,
      type: e.isDirectory() ? 'dir' as const : 'file' as const,
      path: relativePath ? `${relativePath}/${e.name}` : e.name,
    }));
}

export function searchFiles(query: string, userId?: string): Array<{ path: string; matches: string[] }> {
  const uid = userId ?? currentUserId;
  const results: Array<{ path: string; matches: string[] }> = [];
  const basePath = getWorkspacePath(uid);

  function walk(dir: string, relBase: string) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(dir, entry.name);
      const relPath = relBase ? `${relBase}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        walk(fullPath, relPath);
      } else if (ALLOWED_EXTENSIONS.includes(path.extname(entry.name).toLowerCase())) {
        try {
          const content = fs.readFileSync(fullPath, 'utf-8');
          const lines = content.split('\n');
          const matches = lines.filter(l => l.toLowerCase().includes(query.toLowerCase()));
          if (matches.length > 0) {
            results.push({ path: relPath, matches: matches.slice(0, 3) });
          }
        } catch { /* skip unreadable */ }
      }
    }
  }

  walk(basePath, '');
  return results.slice(0, 20);
}
