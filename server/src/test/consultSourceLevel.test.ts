import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';

// 定稿上那个证据级别（L1 联网 / L2 客户资料 / L3 模型内置知识）**必须反映实际喂进去的东西**。
// 这条路径原来是路由里硬写的 `sourceLevel: 'L1'`：一条完全靠常识编出来的结论在界面上
// 挂着「L1 联网检索」，读起来和真查过一模一样，用户会拿它去做决策，中途一句错都不报。
vi.mock('../core/llm/gateway.js', () => ({
  aiGateway: vi.fn(async () => {
    throw new Error('这个文件不该调模型');
  }),
  SAMPLING: { analytic: { temperature: 0.2 } },
  QuotaExceededError: class extends Error {},
}));

const { app } = await import('../app.js');
const { getDatabase } = await import('../db/index.js');
const { createUser } = await import('./helpers.js');

let auth: { Authorization: string };
beforeAll(() => {
  auth = createUser('user').auth;
});

async function newProject(brief: string): Promise<string> {
  const res = await request(app).post('/api/consult/projects').set(auth).send({ brandName: '捷停车', brief });
  return res.body.project.id;
}

/** 直接落一条采纳记录：这个文件测的是「级别怎么算」，不是 Tavily 通不通。 */
function adopt(projectId: string): void {
  getDatabase()
    .prepare(
      `INSERT INTO consult_sources (id, project_id, stage_key, title, url, domain, published, snippet, query, created_at)
       VALUES ('s1', ?, 'self', '停车行业白皮书', 'https://a.com/x', 'a.com', '2025', '规模 300 亿', 'q', ?)`
    )
    .run(projectId, new Date().toISOString());
}

const finalize = (id: string, extra: Record<string, unknown> = {}) =>
  request(app)
    .put(`/api/consult/projects/${id}/stages/self/entry`)
    .set(auth)
    .send({ conclusion: '一句结论', confidence: 'mid', ...extra });

describe('定稿的证据级别只能按实际依据算', () => {
  it('没采纳任何联网资料时，前端就算硬传 L1 也只能存成 L2', async () => {
    const id = await newProject('停车场 SaaS，覆盖 2000+ 车场');
    const res = await finalize(id, { sourceLevel: 'L1' });
    expect(res.status).toBe(200);
    expect(res.body.entry.source_level).toBe('L2');
  });

  it('连客户资料都没有时是 L3（模型内置知识），采纳了联网资料才是 L1', async () => {
    const empty = await newProject('');
    expect((await finalize(empty)).body.entry.source_level).toBe('L3');

    const withSrc = await newProject('停车场 SaaS');
    adopt(withSrc);
    expect((await finalize(withSrc)).body.entry.source_level).toBe('L1');
  });
});
