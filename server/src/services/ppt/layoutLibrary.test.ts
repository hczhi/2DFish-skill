import { describe, it, expect, vi, afterEach } from 'vitest';
import { statSync, utimesSync } from 'fs';
import { join } from 'path';
import { loadLibrary, layoutById, libraryRoot, libraryVersion } from './layoutLibrary.js';
import { templateClasses } from './deckShell.js';

// 这个解析器的每种失败都伪装成成功：漏掉几条案例、某条的 buildText 是空的、
// fullbleed 判反了 —— 三种都不报错，生成阶段照样出一份完整的 HTML，
// 只是版式是模型自己编的 / 全幅图被包进 padding 里成了一张留白图。
// 手测看不出来（页面是好看的，只是不是那个版式），所以必须有测试。

describe('版式案例库', () => {
  it('73 条案例全部解析出来，且每条都有非空的选型文本和生成文本', () => {
    const lib = loadLibrary();
    const ids = lib.layouts.map((l) => l.id);
    expect(ids).toEqual(Array.from({ length: 73 }, (_, i) => `L${i + 1}`));

    // 空文本进 prompt 等于这一条案例不存在，而它在列表里还是一行
    const empty = lib.layouts.filter((l) => !l.selectText.trim() || !l.buildText.trim());
    expect(empty.map((l) => l.id)).toEqual([]);

    // 每条都要有「适用」，选版式那一步全靠它匹配内容
    expect(lib.layouts.filter((l) => !l.applicable).map((l) => l.id)).toEqual([]);
  });

  it('fullbleed 只认「内容不包 .slide-inner」，「背景图铺满」不算', () => {
    // 「背景图铺满整页」不算全幅：L2/L3 的图是绝对定位铺满的，文字照旧在 .slide-inner 里
    // （demo 片段就是这么写的，`demoDeck.test.ts` 拿它对账）。标成 true 的那段时间里，
    // 每一页 L2 都被告知「不要包」—— 标题贴着画面边缘、疏密档不动一个像素，一处都不报错。
    expect(layoutById('L2')?.fullbleed).toBe(false);
    expect(layoutById('L3')?.fullbleed).toBe(false);
    // 真全幅的那几条（内容整块脱离 .slide-inner）照旧是 true
    expect(layoutById('L18')?.fullbleed).toBe(true);
    expect(layoutById('L11')?.fullbleed).toBe(true);
    // L12 明写「否」但要 has-card（色带溢出卡片边缘）
    expect(layoutById('L12')?.fullbleed).toBe(false);
    expect(layoutById('L12')?.hasCard).toBe(true);
    expect(layoutById('L14')?.fullbleed).toBe(false);
  });

  it('详情按 L 编号找而不是按版式名，改过名的 L12 也要带上 CSS 骨架', () => {
    // 文件名还是 L12-bio-portrait-card.md，条目名已改成 circle-float-card
    const l12 = layoutById('L12')!;
    expect(l12.name).toBe('circle-float-card');
    expect(l12.hasDetail).toBe(true);
    expect(l12.buildText).toContain('bio-card');
    // 还没写详情 md 的那几条，buildText 回落成索引条目原文（不能是空的、要认得出是哪一条）
    // —— 回落成空串的话生成那一步只剩「版式 L6」三个字，模型自己发明结构，而页面照样出来
    for (const l of loadLibrary().layouts.filter((x) => !x.hasDetail)) {
      expect(l.buildText).toContain(l.name);
    }
  });

  it('library 目录里的文件一改就重读，派生缓存跟着作废', () => {
    // 原来是「读一次缓存住，改了 md 要重启服务」。那条约定的代价是一次真实调用：
    // 改完某条案例的结构模板去点「重新生成这一页」，拿到的是**一模一样的旧版** ——
    // 页面渲染正常、接口 200、problems 里还是原来那几条，没有一处说「这个进程读的
    // 还是旧那份 md」。他只会以为是模型不听话，一遍遍重试（每次扣一次额度）。
    const file = join(libraryRoot(), 'template.html');
    const before = statSync(file);
    const v1 = libraryVersion();
    const classes1 = templateClasses();
    try {
      utimesSync(file, before.atime, new Date(before.mtimeMs + 5000));
      // 一秒内不重复扫目录（`stamp` 的节流），所以把时间往后拨过那道门槛
      vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 5000);
      expect(libraryVersion()).toBeGreaterThan(v1);
      // 派生缓存（这里用类名表代表）也要重算，不然「md 改了一半生效」
      expect(templateClasses()).not.toBe(classes1);
    } finally {
      utimesSync(file, before.atime, before.mtime);
    }
  });
});

afterEach(() => vi.restoreAllMocks());
