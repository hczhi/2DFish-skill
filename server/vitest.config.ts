import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // 每个测试文件单独一个进程：app.ts 是模块级单例（DB 连接、cron、路由装配），
    // 同进程内多文件共享会互相污染 process.env.DB_PATH 和数据库句柄。
    pool: 'forks',
    setupFiles: ['src/test/setup.ts'],
    testTimeout: 20_000,
  },
});
