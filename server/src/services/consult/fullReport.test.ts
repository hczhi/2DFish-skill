import { describe, it, expect, beforeEach, vi } from 'vitest';

// 「一键生成整份报告」的两条「界面上读起来完全正常」的路径：
// ① 中间某一步挂了，驱动器停在那里 —— 界面上是「12 步已定稿 + 1 条失败」，而剩下那几步
//    和「他压根没点过这颗按钮」一模一样（唯一的差别只有那句话里的「后面 N 步没跑」）；
// ② 进程重启，驱动那条链的 async 函数必然死了 —— 不收尸的话那条唯一索引把项目永久锁在
//    「已经有一批在跑」（这颗按钮从此一律 409），而界面上写着「正在跑第 N 步」。
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
const { STAGE_DEFAULTS } = await import('./stages.js');
const { activeRuns } = await import('./runStore.js');
const { activeBatch, reapInterruptedConsultBatches } = await import('./batchStore.js');
const { startFullReport, pendingStagesFor, activeBatchFor } = await import('./fullReportService.js');

initDatabase();

const FULL_BODY = `## 1. 占位\n| 维度 | 事实 | 判读 |\n| --- | --- | --- |\n`.padEnd(600, '文');
const draftReply = JSON.stringify({ conclusion: '占位结论一句话', body: FULL_BODY, confidence: 'mid' });

/** 只留最后两步（执行层，各 1 次调用）待跑，前面全部先定稿 —— 让这条链短到能测。 */
function seedAllBut(projectId: string, pending: string[]) {
  for (const s of STAGE_DEFAULTS) {
    if (pending.includes(s.key)) continue;
    saveEntry(projectId, s.key, { conclusion: `${s.label} 的结论`, body: FULL_BODY, confidence: 'mid' });
  }
}

/** 等那条没人 await 的驱动器跑完（这一批离开 running）。 */
async function settle(projectId: string): Promise<void> {
  for (let i = 0; i < 300; i++) {
    const b = activeBatch(projectId);
    if (!b || b.status !== 'running') return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('这一批没有跑完');
}

describe('consult 一键生成整份报告', () => {
  let project: any;

  beforeEach(() => {
    const db = getDatabase();
    db.exec(
      'DELETE FROM consult_batches; DELETE FROM consult_runs; DELETE FROM consult_messages; DELETE FROM consult_entries; DELETE FROM consult_stages; DELETE FROM consult_projects;'
    );
    project = createProject(platformOwner('u1'), '捷停车', '停车场 SaaS，覆盖 2000+ 车场，客单价偏低');
    replies.length = 0;
  });

  it('中间一步挂了就停住，并且说出后面几步没跑', async () => {
    seedAllBut(project.id, ['content', 'digital']);
    // 第一步待跑的那一版被截断 → 不定稿 → 整批停在这里
    replies.push({ text: draftReply, finish: 'length' });

    const out = await startFullReport('u1', project);
    expect(out.stageKeys).toEqual(['content', 'digital']);
    await settle(project.id);

    const batch = activeBatch(project.id)!;
    expect(batch.status).toBe('failed');
    // 这句话是「停住了」和「他没点过」唯一的差别。只写那一步的成因的话，剩下那几步
    // 在界面上和从没开跑一模一样，他会等着它跑完。
    expect(batch.error).toMatch(/截断/);
    expect(batch.error).toMatch(/后面 2 步/);
    // 后面那一步真的没跑（也就没有多扣额度）
    expect(listEntries(project.id).some((e) => e.stage_key === 'digital')).toBe(false);
    expect(activeRuns(project.id).some((r) => r.stage_key === 'digital')).toBe(false);
    // 「接着跑」不需要额外状态：待跑清单按「哪几步还没定稿」现算
    expect(pendingStagesFor(project.id)).toEqual(['content', 'digital']);
  });

  it('重启收尸写出跑到第几步、剩几步，并且放开那把锁让他能接着跑', async () => {
    seedAllBut(project.id, ['content', 'digital']);
    replies.push({ text: draftReply });

    await startFullReport('u1', project);
    await settle(project.id); // 第二步没准备返回值 → 停在第 1 步跑完之后
    // 伪造「上一个进程留下的 running」：真正的场景是进程在链条中间被杀掉
    getDatabase()
      .prepare(`UPDATE consult_batches SET status = 'running', finished_at = NULL, error = NULL WHERE project_id = ?`)
      .run(project.id);

    expect(reapInterruptedConsultBatches()).toBe(1);
    const batch = activeBatch(project.id)!;
    expect(batch.status).toBe('interrupted');
    expect(batch.error).toMatch(/1\/2 步/);
    expect(batch.error).toMatch(/剩下 1 步/);

    // 锁放开了：不放的话那条唯一索引让这颗按钮从此一律 409，而界面上写着「正在跑」
    replies.push({ text: draftReply });
    const again = await startFullReport('u1', project);
    expect(again.stageKeys).toEqual(['digital']);
    await settle(project.id);
  });

  it('剩下那几步后来定稿了，「停在半路」那条就不再显示', async () => {
    seedAllBut(project.id, ['content', 'digital']);
    replies.push({ text: draftReply, finish: 'length' }); // 第一步就截断 → 整批 failed
    await startFullReport('u1', project);
    await settle(project.id);
    expect(activeBatchFor(project.id)?.status).toBe('failed');

    // 他后来把剩下两步跑完/手动定稿了 —— 那句「剩下 2 步没有跑、再点一次接着跑」现在是假的，
    // 而它指的动作只会回一句 409「都已经定稿了」：十四步全绿，顶上照旧红着一片。
    saveEntry(project.id, 'content', { conclusion: '手动定的', body: FULL_BODY, confidence: 'mid' });
    saveEntry(project.id, 'digital', { conclusion: '手动定的', body: FULL_BODY, confidence: 'mid' });
    expect(activeBatchFor(project.id)).toBeNull();
  });
});
