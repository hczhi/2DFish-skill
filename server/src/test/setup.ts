import fs from 'fs';
import os from 'os';
import path from 'path';

// 每个测试文件进程一个独立的临时 sqlite 文件。
// 必须在任何业务模块被 import 之前设好 DB_PATH —— app.ts 顶层就会 initDatabase()，
// 晚一步就会连到真实的 data/app.db 并被测试数据污染。
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mmpla-test-'));
process.env.DB_PATH = path.join(dir, 'test.db');
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-do-not-use-in-production';
// 反代跳数固定，避免测试机环境变量影响 X-Forwarded-For 解析。
process.env.TRUST_PROXY_HOPS = '1';

process.on('exit', () => {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 临时目录清理失败无所谓 */ }
});
