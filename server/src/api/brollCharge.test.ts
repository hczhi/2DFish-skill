import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

// 导出本身（无头浏览器 + ffmpeg）不在这里测，只测扣点跟着成败走。
const exportMock = vi.fn();
vi.mock('../services/broll/exportService.js', async (orig) => ({
  ...(await orig<typeof import('../services/broll/exportService.js')>()),
  exportCard: (...a: unknown[]) => exportMock(...a),
}));

import { initDatabase, getDatabase } from '../db/index.js';
import { createAppKeys, getAppKey } from '../services/appKeyService.js';
import { authMiddleware } from '../auth/middleware.js';
import { scopeGuard } from '../auth/scopeGuard.js';
import { brollRouter } from './broll.js';
import { BrollExportError } from '../services/broll/exportService.js';

initDatabase();

const app = express();
app.use(express.json());
app.use(authMiddleware, scopeGuard);
app.use('/api/broll', brollRouter);
app.post('/api/xhs/structure', (_req, res) => res.json({ ok: true }));

const body = { aspect: '16:9', theme: 'ember', format: 'png', card: { template: 'number', data: {}, duration: 3 } };

beforeEach(() => {
  const db = getDatabase();
  db.prepare('DELETE FROM app_keys').run();
  db.prepare('DELETE FROM app_key_ledger').run();
  db.prepare("DELETE FROM user WHERE username LIKE 'key:%'").run();
  exportMock.mockReset();
});

describe('口播动效卡的 key', () => {
  it('导出失败不扣点，成功扣 5 点', async () => {
    // 失败也扣的话他看到的是「导出失败」，而余额悄悄少了 5 点，重试几次就没了。
    const { keys } = createAppKeys('broll', 1, 20);
    exportMock.mockRejectedValueOnce(new BrollExportError('有一张导出在进行中', 429));
    await request(app).post('/api/broll/export').set('Authorization', `Bearer ${keys[0].key}`).send(body).expect(429);
    expect(getAppKey(keys[0].id)).toMatchObject({ balance: 20, frozen: 0 });

    exportMock.mockResolvedValueOnce({ buffer: Buffer.from('mov'), notes: [] });
    await request(app).post('/api/broll/export').set('Authorization', `Bearer ${keys[0].key}`).send(body).expect(200);
    expect(getAppKey(keys[0].id)).toMatchObject({ balance: 15, frozen: 0 });
  });

  it('broll 的卡碰不到别的应用的接口', async () => {
    // 403 同时说明 BRL- 被认成了 key（前缀没认上的话是一句 401 token 无效）；放行的话这张卡能调 /api/xhs，每个都 200。
    const { keys } = createAppKeys('broll', 1, 10);
    await request(app).post('/api/xhs/structure').set('Authorization', `Bearer ${keys[0].key}`).send({}).expect(403);
  });
});
