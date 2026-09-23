import { describe, it, expect, beforeEach, vi } from 'vitest';

// 四看自动联网的两条「出错时伪装成成功」的路径：
// ① 自动搜来的那几条丢了 auto 标记 —— 它们就和用户逐条核过的资料一样进 prompt、
//    一样算 L1，于是一页没人看过的软文被写成「据公开数据」，而正文只会更自信；
// ② 压根没联网（没配 key / 搜失败）却不出声 —— 四看照样跑完四份通顺的正文，
//    那几节数字是按模型内置知识编的，唯一的差别在定稿之后才出现一次的证据级别那一栏。
//
// mock 必须在 import 业务代码之前（ESM 提升）。
const replies: string[] = [];
vi.mock('../../core/llm/gateway.js', () => ({
  aiGateway: vi.fn(async () => {
    const r = replies.shift();
    if (r === undefined) throw new Error('测试没有为这次 LLM 调用准备返回值');
    return { response: { choices: [{ message: { content: r }, finish_reason: 'stop' }] } };
  }),
  SAMPLING: { analytic: { temperature: 0.2 } },
  QuotaExceededError: class extends Error {},
}));

let searchOn = true;
vi.mock('../webSearchService.js', () => ({
  isSearchEnabled: () => searchOn,
  webSearch: vi.fn(async (query: string) => [
    {
      title: `${query} 的搜索结果`,
      url: `https://example.com/${encodeURIComponent(query)}`,
      content: '智慧停车市场 2025 年规模约 200 亿元，年增速 18%。',
      score: 0.9,
      published: '2025-03-01',
    },
  ]),
}));

const { initDatabase, getDatabase } = await import('../../db/index.js');
const { createProject, platformOwner, appendMessage } = await import('./projectStore.js');
const { discussionBlock } = await import('./draftService.js');
const { listSources, sourcesBlock, sourceLevelFor, adoptSources, verifySource, countSourcesByKind } =
  await import('./sourceStore.js');
const { autoSearchForStages, searchNoteText } = await import('./autoSourceService.js');

initDatabase();

describe('consult 四看自动联网', () => {
  let project: any;

  beforeEach(() => {
    const db = getDatabase();
    db.exec('DELETE FROM consult_sources; DELETE FROM consult_messages; DELETE FROM consult_projects;');
    project = createProject(platformOwner('u1'), '捷停车', '停车场 SaaS，覆盖 2000+ 车场');
    replies.length = 0;
    searchOn = true;
  });

  it('自动搜来的资料标成「未人工核对」，只撑到 L1?，被手动采纳一次才升级成 L1', async () => {
    replies.push(JSON.stringify({ queries: { industry: ['智慧停车 市场规模 2025'] } }));
    const out = await autoSearchForStages('u1', project, ['industry']);
    expect(out.status).toBe('ok');
    expect(out.added).toBe(1);

    const rows = listSources(project.id);
    expect(rows[0].auto).toBe(1);
    // 进 prompt 的必须是「没有人核对过」那一段 —— 混进采纳那一段的话模型分不出来
    const block = sourcesBlock(rows);
    expect(block).toContain('没有人核对过');
    expect(block).not.toContain('用户逐条勾选采纳的');
    expect(sourceLevelFor({ hasPicked: false, hasAuto: true, hasBrief: true })).toBe('L1?');

    // 他手动勾了同一条（url 撞上唯一索引）= 他亲自核过了，必须升级成 L1，
    // 不升的话 prompt 里照旧挂着「未人工核对」，而他明明看过了
    const again = adoptSources(project.id, 'industry', '智慧停车 市场规模 2025', [
      { title: rows[0].title, url: rows[0].url, snippet: rows[0].snippet },
    ]);
    expect(again.added).toBe(1);
    expect(listSources(project.id)[0].auto).toBe(0);
  });

  it('按了「我核过了」之后，这条资料不再挂「未人工核对」，级别也回到 L1', async () => {
    replies.push(JSON.stringify({ queries: { industry: ['智慧停车 市场规模 2025'] } }));
    await autoSearchForStages('u1', project, ['industry']);
    const row = listSources(project.id)[0];

    expect(verifySource(project.id, row.id)).toBe(true);
    // 界面上说了「已记成你核对过的」，prompt 和级别就必须跟着动 —— 不动的话模型照旧
    // 给区间、照旧写「未人工核对」，而他已经核过了，只会以为那个按钮没用
    const block = sourcesBlock(listSources(project.id));
    expect(block).toContain('用户逐条勾选采纳的');
    expect(block).not.toContain('没有人核对过');
    const n = countSourcesByKind(project.id);
    expect(sourceLevelFor({ hasPicked: n.picked > 0, hasAuto: n.auto > 0, hasBrief: true })).toBe('L1');
  });

  it('落在对话里的联网结论不算「聊过的话」，不会当成又一份资料进下一次 prompt', () => {
    // 这条记录是每次分析都会写的（api/consult.ts 的 autoSearchBeforeAnalysis）。kind 写成
    // 'text' 的话它会被 discussionBlock 当成顾问说过的话带进下一次 prompt —— 里面写着
    // 「自动联网查到 8 条资料」，模型于是把它当成又一处印证，而那句话读起来完全正常。
    appendMessage(project.id, 'industry', {
      role: 'assistant',
      kind: 'search',
      content: searchNoteText('自动联网查到 **8** 条资料'),
    });
    appendMessage(project.id, 'industry', { role: 'user', kind: 'text', content: '重点看加盟商' });
    const d = discussionBlock(project.id, 'industry');
    expect(d.used).toBe(1);
    expect(d.text).not.toContain('联网');
  });

  it('没配 Tavily key 时不悄悄跑过去，话里说清这次没联网', async () => {
    searchOn = false;
    const out = await autoSearchForStages('u1', project, ['industry']);
    expect(out.status).toBe('off');
    expect(out.note).toContain('没有联网');
    // 没配 key 不许白花一次「出检索词」的额度
    expect(replies).toHaveLength(0);
  });
});
