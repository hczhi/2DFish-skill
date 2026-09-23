import { describe, it, expect, beforeEach, vi } from 'vitest';

// 四看一键并行的两条「界面上读起来完全正常」的路径：
// ① 断在半句话上的那一版被自动定稿 —— 那一步显示「✅ 已自动定稿」，而缺的那几节
//    从此进下游十步的 prompt，没有任何一处报错；
// ② 四步互相标 stale —— 一键跑完立刻三个「⚠ 建议重跑」，而它们全是这一次刚出的，
//    用户唯一看得懂的动作是再花 4 次额度重跑，跑完还是三个 ⚠。
//    反过来连真下游（四问）也不标的话，报告里两节互相矛盾而读起来完整。
//
// mock 必须在 import 业务代码之前（ESM 提升）。
const replies: Array<{ text: string; finish?: string }> = [];
vi.mock('../../core/llm/gateway.js', () => ({
  aiGateway: vi.fn(async () => {
    const r = replies.shift();
    if (!r) throw new Error('测试没有为这次 LLM 调用准备返回值');
    return { response: { choices: [{ message: { content: r.text }, finish_reason: r.finish || 'stop' }] } };
  }),
  SAMPLING: { analytic: { temperature: 0.2 } },
  QuotaExceededError: class extends Error {},
}));

const { initDatabase, getDatabase } = await import('../../db/index.js');
const { createProject, saveEntry, listEntries, platformOwner } = await import('./projectStore.js');
const { activeRuns } = await import('./runStore.js');
const { startFourViews, fourViewKeys } = await import('./fourViewsBatch.js');

initDatabase();

const FULL_BODY = `## 1. 企业现状卡\n| 维度 | 事实 | 判读 |\n| --- | --- | --- |\n`.padEnd(600, '文');
const okReply = (label: string) =>
  JSON.stringify({ conclusion: `${label} 的结论`, body: FULL_BODY, confidence: 'mid' });

/** 等那批没人 await 的 `runOne` 跑完（全部离开 running）。 */
async function settle(projectId: string): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (!activeRuns(projectId).some((r) => r.status === 'running')) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('这批 run 没有跑完');
}

describe('consult 四看一键并行', () => {
  let project: any;

  beforeEach(() => {
    const db = getDatabase();
    db.exec(
      'DELETE FROM consult_runs; DELETE FROM consult_messages; DELETE FROM consult_entries; DELETE FROM consult_stages; DELETE FROM consult_projects;'
    );
    project = createProject(platformOwner('u1'), '捷停车', '停车场 SaaS，覆盖 2000+ 车场，客单价偏低');
    replies.length = 0;
  });

  it('被截断的那一版不自动定稿，并且这条 run 上写出成因', async () => {
    const keys = fourViewKeys();
    // 第一步截断（finish_reason=length），其余三步正常
    replies.push({ text: okReply(keys[0]), finish: 'length' });
    for (const k of keys.slice(1)) replies.push({ text: okReply(k) });

    const { runs } = await startFourViews('u1', project);
    expect(runs).toHaveLength(keys.length);
    await settle(project.id);

    const decided = new Set(listEntries(project.id).map((e) => e.stage_key));
    expect(decided.has(keys[0])).toBe(false);
    for (const k of keys.slice(1)) expect(decided.has(k)).toBe(true);

    // 失败那条要留在 activeRuns 里（没 ack 过），错误里必须说出「被截断 + 没有定稿」，
    // 只写一句「失败」的话他分不清该重跑还是该去看草稿。
    const dead = activeRuns(project.id).find((r) => r.stage_key === keys[0]);
    expect(dead?.status).toBe('failed');
    expect(dead?.error).toMatch(/截断/);
    expect(dead?.error).toMatch(/没.*自动定稿/);
  });

  it('同批四步之间不互相标 stale，真下游（四问）照旧被标', async () => {
    const keys = fourViewKeys();
    // 先让一条真下游定过稿 —— 它是「口径变了要回头看」的那一条
    saveEntry(project.id, 'positioning', { conclusion: '旧口径的定位', confidence: 'mid' });
    for (const k of keys) replies.push({ text: okReply(k) });

    await startFourViews('u1', project);
    await settle(project.id);

    const entries = listEntries(project.id);
    const staled = entries.filter((e) => e.stale).map((e) => e.stage_key);
    expect(staled).toEqual(['positioning']);
    // 四步都定稿了才谈得上「互不标」—— 少跑一步的话上面那条断言会假通过
    expect(entries.filter((e) => keys.includes(e.stage_key))).toHaveLength(keys.length);
  });
});
