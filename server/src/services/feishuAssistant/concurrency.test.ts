import { describe, it, expect } from 'vitest';
import { TooBusyError, intentLoad, withIntentSlot } from './concurrency.js';

// 这个闸守的是"一个部门早上九点集体 @ 一下机器人"那一刻：
// 没有它就是同时几十个 LLM 请求打向同一把 key，撞限流后用户拿到的是
// 一段英文报错，而他做的事完全正常。
//
// 断言不写死 MAX_CONCURRENT / MAX_QUEUED 的具体数字（它们是可调的运行参数），
// 只验三件不该变的事：并发有上限、排队先到先服务、队伍满了立刻拒绝。

/** 一个手动放行的任务。 */
function gate() {
  let release: () => void = () => {};
  const started = { yes: false };
  const blocked = new Promise<void>((r) => { release = r; });
  const run = () =>
    withIntentSlot(async () => {
      started.yes = true;
      await blocked;
      return 'ok';
    });
  return { run, release, started };
}

const tick = () => new Promise<void>((r) => setImmediate(r));

describe('withIntentSlot', () => {
  it('并发数封顶，超出的排队而不是一起打出去', async () => {
    const max = intentLoad().maxConcurrent;
    const gates = Array.from({ length: max + 3 }, () => gate());
    const all = gates.map((g) => g.run());
    await tick();

    // 前 max 个跑起来了，剩下的还没进 fn。
    expect(gates.slice(0, max).every((g) => g.started.yes)).toBe(true);
    expect(gates.slice(max).some((g) => g.started.yes)).toBe(false);
    expect(intentLoad().running).toBe(max);
    expect(intentLoad().queued).toBe(3);

    gates.forEach((g) => g.release());
    await Promise.all(all);
    // 全部跑完后计数归零 —— 漏减会让闸越用越窄，最后谁都排不上。
    expect(intentLoad()).toMatchObject({ running: 0, queued: 0 });
  });

  it('先到先服务 —— 后到的先跑会让最早那条指令在忙时段饿死', async () => {
    const max = intentLoad().maxConcurrent;
    const holders = Array.from({ length: max }, () => gate());
    const held = holders.map((h) => h.run());
    await tick();

    const order: number[] = [];
    const queued = [0, 1, 2].map((i) =>
      withIntentSlot(async () => { order.push(i); })
    );
    await tick();
    expect(order).toEqual([]);

    // 一次放一个名额出来，看谁接棒。
    for (const h of holders) {
      h.release();
      await tick();
    }
    await Promise.all([...held, ...queued]);
    expect(order).toEqual([0, 1, 2]);
  });

  it('队伍满了立刻抛 TooBusyError，而不是让人等一个不会来的回复', async () => {
    const { maxConcurrent } = intentLoad();
    // 灌到"并发满 + 队伍满"。MAX_QUEUED 没有导出（它是可调参数），
    // 所以往上灌到真的被拒为止，同时验证它确实是有界的。
    const gates: ReturnType<typeof gate>[] = [];
    const pending: Promise<unknown>[] = [];
    const errors: unknown[] = [];
    let attempts = 0;
    // 500 只是个跑不到的上界：真跑到这个数就说明队伍**没有**上限，
    // 而那正是这个用例要排除的（无上限排队会把"限流"换成"永远不回"）。
    for (; attempts < 500 && errors.length === 0; attempts++) {
      const g = gate();
      gates.push(g);
      const p = g.run();
      // withIntentSlot 是 async，满队时的 throw 变成的是 rejected promise，
      // 不是同步异常 —— 用 try/catch 包 g.run() 是抓不到的。
      p.catch((e) => errors.push(e));
      pending.push(p);
      await tick();
    }

    expect(attempts).toBeLessThan(500);
    const rejected = errors[0];
    expect(rejected).toBeInstanceOf(TooBusyError);
    // 这句承诺的前提是闸只包住意图解析（此时一个写操作都没发生）。
    expect((rejected as Error).message).toContain('本次没有执行任何操作');
    expect(intentLoad().running).toBe(maxConcurrent);

    gates.forEach((g) => g.release());
    await Promise.allSettled(pending);
    expect(intentLoad()).toMatchObject({ running: 0, queued: 0 });
  });

  it('fn 抛错也要还名额，否则一次失败就永久占掉一个位置', async () => {
    const before = intentLoad();
    await expect(withIntentSlot(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(intentLoad()).toMatchObject({ running: before.running, queued: before.queued });
  });
});
