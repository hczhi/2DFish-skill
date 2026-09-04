import { describe, it, expect } from 'vitest';
import { initDatabase } from '../../db/index.js';
import { layouts } from './layoutLibrary.js';
import { disabledLayoutIds, enabledLayouts, setLayoutEnabled, LayoutStateError } from './layoutState.js';

initDatabase();

// 停用这条路上的失败都长得像「一份正常的稿子」：某个页型被停到一条不剩之后，规划到那种页时
// 清单里没有可挑的，模型会挑一条别的页型的版式 —— 编号合法、每一页单看都完整，整份就是
// 没有目录/没有封面了，而没有一处会报错。开关本身是 CRUD，不测。

describe('版式停用', () => {
  it('把某个页型停到一条不剩时拒绝，库里那份状态一个字都不动', () => {
    // L17 是唯一一条目录页版式 —— 放它过去的话，下一份稿子的目录页会排成一页
    // 数据网格或者四栏矩阵，看起来只是「这份稿子没有目录」。
    const only = layouts().filter((l) => l.roles.includes('目录'));
    expect(only.map((l) => l.id)).toEqual(['L17']);

    expect(() => setLayoutEnabled('L17', false)).toThrow(LayoutStateError);
    expect(() => setLayoutEnabled('L17', false)).toThrow(/目录页最后一条/);

    // 抛了却已经写进去 = 界面上是一句拒绝，而下一份稿子真的没有目录了。
    expect(disabledLayoutIds().has('L17')).toBe(false);
    expect(enabledLayouts().some((l) => l.id === 'L17')).toBe(true);
  });
});
