import { describe, it, expect, beforeEach } from 'vitest';
import { initDatabase, getDatabase } from '../../db/index.js';
import {
  startRun,
  finishRun,
  failRun,
  activeRuns,
  ackRun,
  reapInterruptedConsultRuns,
} from './runStore.js';

initDatabase();

// 这三条全是「出错时界面上是一句正常回复」的路径：
// ① 同一步被点两次，两次都正常返回一份草稿（后一份盖掉前一份），账单扣两次；
// ② 那次分析挂了，而下次进页面只有一个「还没生成」的空白界面，成因一个字都没有；
// ③ 收尸漏了 done/failed 的话，早就正常结束的那一步下次进来显示成「被中断」——
//    他会去重跑一版已经写好的（再扣一次额度）。

describe('consult runStore', () => {
  beforeEach(() => {
    getDatabase().exec('DELETE FROM consult_runs;');
  });

  it('同一步同时只准有一次在跑，跑完/挂了之后才准再开一次', () => {
    expect(startRun('p1', 'self', 'draft')).not.toBeNull();
    // 第二次点（另一个标签页、或刷新之后再点）必须被挡住
    expect(startRun('p1', 'self', 'draft')).toBeNull();
    // 别的步、别的项目不受影响
    expect(startRun('p1', 'industry', 'decisions')).not.toBeNull();
    expect(startRun('p2', 'self', 'draft')).not.toBeNull();

    const run = activeRuns('p1').find((r) => r.stage_key === 'self')!;
    finishRun(run.id, 'msg-1');
    expect(startRun('p1', 'self', 'draft')).not.toBeNull();
  });

  it('挂掉那次存的是上游原文，用户说过一次就不再弹', () => {
    const run = startRun('p1', 'self', 'draft')!;
    failRun(run.id, '上游 502：思维链吃掉了全部 max_tokens（reasoning_tokens=6000），正文是空的');

    const dead = activeRuns('p1');
    expect(dead).toHaveLength(1);
    expect(dead[0].status).toBe('failed');
    // 不许合成一句「分析失败」：空返回 / 截断 / 上游忙的解法完全不同
    expect(dead[0].error).toContain('reasoning_tokens=6000');

    expect(ackRun('p1', dead[0].id)).toBe(true);
    expect(activeRuns('p1')).toHaveLength(0);
  });

  it('启动收尸只碰上次遗留的 running，并把成因写进去', () => {
    const zombie = startRun('p1', 'self', 'draft')!;
    const done = startRun('p1', 'industry', 'draft')!;
    finishRun(done.id, 'msg-2');

    expect(reapInterruptedConsultRuns()).toBe(1);

    const rows = activeRuns('p1');
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(zombie.id);
    expect(rows[0].status).toBe('interrupted');
    expect(rows[0].error).toContain('额度');
    // 收尸之后这一步必须能重新点（那条唯一索引不再锁着它）
    expect(startRun('p1', 'self', 'draft')).not.toBeNull();
    // 正在跑的那次已经不在了，跟它一起来的 finishRun 不该把新的一次标成 done
    finishRun(zombie.id, 'msg-3');
    expect(activeRuns('p1').filter((r) => r.status === 'running')).toHaveLength(1);
  });
});
