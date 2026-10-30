import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { writeFileSync } from 'fs';

// 导出本身（无头浏览器 + ffmpeg）不在这里测，只测扣点跟着成败走、key 的权限范围。
const exportMock = vi.fn();
vi.mock('../services/explainer/exportService.js', async (orig) => ({
  ...(await orig<typeof import('../services/explainer/exportService.js')>()),
  exportVideo: (...a: unknown[]) => exportMock(...a),
}));

import { initDatabase, getDatabase } from '../db/index.js';
import { createAppKeys, getAppKey } from '../services/appKeyService.js';
import { authMiddleware } from '../auth/middleware.js';
import { scopeGuard } from '../auth/scopeGuard.js';
import { explainerRouter } from './explainer.js';
import { ExplainerError } from '../services/explainer/scriptService.js';

initDatabase();

const app = express();
app.use(express.json());
app.use(authMiddleware, scopeGuard);
app.use('/api/explainer', explainerRouter);
app.post('/api/broll/plan', (_req, res) => res.json({ ok: true }));

const body = { style: 'whiteboard', scene: { version: 1, title: 't', duration: 15, shots: [{ seconds: 5, heading: 'A', items: [{ id: 'a', type: 'icon', icon: 'Smartphone' }] }] } };

beforeEach(() => {
  const db = getDatabase();
  db.prepare('DELETE FROM app_keys').run();
  db.prepare('DELETE FROM app_key_ledger').run();
  db.prepare("DELETE FROM user WHERE username LIKE 'key:%'").run();
  exportMock.mockReset();
});

describe('代码动画视频的 key', () => {
  it('导出失败不扣点，成功扣 5 点（后台任务，结算在任务结束时）', async () => {
    // 失败也扣的话他看到的是「导出失败」，而余额悄悄少了 5 点，重试几次就没了。
    const { keys } = createAppKeys('explainer', 1, 20);
    const auth = `Bearer ${keys[0].key}`;
    const waitDone = async (id: string) => {
      for (let i = 0; i < 50; i++) {
        const r = await request(app).get(`/api/explainer/export/${id}`).set('Authorization', auth).expect(200);
        if (r.body.state !== 'running') return r.body;
        await new Promise((ok) => setTimeout(ok, 10));
      }
      throw new Error('job never finished');
    };
    exportMock.mockRejectedValueOnce(new ExplainerError('渲染页没准备好', 500));
    const a = await request(app).post('/api/explainer/export').set('Authorization', auth).send(body).expect(202);
    expect((await waitDone(a.body.id)).state).toBe('failed');
    expect(getAppKey(keys[0].id)).toMatchObject({ balance: 20, frozen: 0 });

    exportMock.mockImplementationOnce(async (_spec: unknown, file: string) => { writeFileSync(file, 'mp4'); return { notes: [], frames: 1, ms: 1 }; });
    const b = await request(app).post('/api/explainer/export').set('Authorization', auth).send(body).expect(202);
    expect((await waitDone(b.body.id)).state).toBe('done');
    expect(getAppKey(keys[0].id)).toMatchObject({ balance: 15, frozen: 0 });
    const f = await request(app).get(`/api/explainer/export/${b.body.id}/file`).set('Authorization', auth).expect(200);
    expect(f.headers['content-type']).toContain('video/mp4');
  });

  it('EXP 的卡碰不到别的应用的接口', async () => {
    // 403 同时说明 EXP- 被认成了 key（前缀没认上的话是一句 401 token 无效）；放行的话这张卡能调别的应用，每个都 200。
    const { keys } = createAppKeys('explainer', 1, 10);
    await request(app).post('/api/broll/plan').set('Authorization', `Bearer ${keys[0].key}`).send({}).expect(403);
  });
});
