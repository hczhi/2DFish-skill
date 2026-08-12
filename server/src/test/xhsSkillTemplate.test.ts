import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import * as uws from '../services/userWritingSkillService.js';
import { createUser, type TestUser } from './helpers.js';

// 导入内置模板：唯一会伪装成成功的地方是「skill 建出来了，但主文件是空的」——
// 列表里有它，写作台能选它，生成出来的东西和没挂 skill 一模一样，没有一处报错。
vi.mock('../services/feishuAssistant/connection.js', () => ({
  connectApp: vi.fn().mockResolvedValue(undefined),
  disconnectApp: vi.fn().mockResolvedValue(undefined),
  startAllConnections: vi.fn().mockResolvedValue(undefined),
  stopAllConnections: vi.fn().mockResolvedValue(undefined),
  connectionStatus: vi.fn().mockReturnValue('connected'),
  clientFor: vi.fn(() => ({})),
  startConnectionWatchdog: vi.fn(),
  stopConnectionWatchdog: vi.fn(),
}));

let user: TestUser;
beforeAll(() => {
  user = createUser('user');
});

describe('导入内置写作模板', () => {
  it('导进来的 skill 主文件必须有正文（空正文=选了也等于没选）', async () => {
    const res = await request(app)
      .post('/api/xhs/skills/import-template')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ templateId: 'human-writing' })
      .expect(201);

    const { assembled } = uws.assembleSkillBody(res.body.skill.id, user.id);
    expect(assembled.length).toBeGreaterThan(500);
    // 抽一条硬禁令做锚：它没进去就说明装的是别的东西
    expect(assembled).toContain('翻案腔');
  });

  it('模板列表接口没被 /skills/:id 接走', async () => {
    const res = await request(app)
      .get('/api/xhs/skills/templates')
      .set('Authorization', `Bearer ${user.token}`)
      .expect(200);
    expect(res.body.templates.map((t: any) => t.id)).toContain('human-writing');
  });
});
