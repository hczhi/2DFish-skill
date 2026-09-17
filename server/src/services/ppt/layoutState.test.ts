import { describe, it, expect } from 'vitest';
import { initDatabase } from '../../db/index.js';
import { layouts } from './layoutLibrary.js';
import { disabledLayoutIds, enabledLayouts, setLayoutEnabled, LayoutStateError } from './layoutState.js';

initDatabase();

// 停用这条路上的失败都长得像「一份正常的稿子」：某个页型被停到一条不剩之后，规划到那种页时
// 清单里没有可挑的，模型会挑一条别的页型的版式 —— 编号合法、每一页单看都完整，整份就是
// 没有封面/没有章节过渡了，而没有一处会报错。开关本身是 CRUD，不测。

describe('版式停用', () => {
  it('把某个页型停到一条不剩时拒绝，库里那份状态一个字都不动', () => {
    // 拿封面页那一档试：停到一条不剩的话，下一份稿子的第 1 页会排成一页数据网格或者
    // 四栏矩阵，看起来只是「这份稿子的封面做得怪」。
    // **不写死编号**：库里加减一条封面版式时这个测试会跟着变红，而它要盯的不是有几条。
    const covers = layouts().filter((l) => l.roles.includes('封面')).map((l) => l.id);
    expect(covers.length).toBeGreaterThan(1);
    const last = covers[0];

    // 停到只剩一条是允许的，再停那最后一条才拒绝。
    for (const id of covers.slice(1)) setLayoutEnabled(id, false);
    expect(() => setLayoutEnabled(last, false)).toThrow(LayoutStateError);
    expect(() => setLayoutEnabled(last, false)).toThrow(/封面页最后一条/);

    // 抛了却已经写进去 = 界面上是一句拒绝，而下一份稿子真的没有封面了。
    expect(disabledLayoutIds().has(last)).toBe(false);
    expect(enabledLayouts().some((l) => l.id === last)).toBe(true);

    for (const id of covers.slice(1)) setLayoutEnabled(id, true);
  });
});
