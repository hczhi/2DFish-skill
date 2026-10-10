import { describe, it, expect } from 'vitest';
import { loadSkill, checkShots, checkFinal } from './optimizeService.js';

// 方法论提炼自一个具体作品的实战文档。漏一个原作品的角色/道具进来，模型会往用户的提示词里
// 塞那个啤酒瓶 —— 输出读起来完全正常，手测看不出是哪来的。
describe('video-prompt 方法论', () => {
  it('base 和各题材附加规范都不含原作品的角色、道具与「本 IP」字样', () => {
    const words = ['老板', '女学徒', '啤酒', '刷刷怪', '小酒馆', '本 IP', '本IP', '银白发', '白背心', '魔王', '男主', '女主', '围裙', '筷筒'];
    const leaked = ['base', 'fight', 'acting', 'chase', 'stage'].flatMap((n) =>
      words.filter((w) => loadSkill(n).includes(w)).map((w) => `${n}:${w}`)
    );
    expect(leaked).toEqual([]);
  });
});

// 秒数排错的稿子读起来完全正常（每段都写得很细），只是 0–3 / 2–6 重叠、或 8 秒的片子写到 6 秒就完了。
describe('checkShots', () => {
  const shot = (start: number, end: number, templateId: string | null = null) => ({ start, end, templateId });

  it('不首尾相接、或没排满总时长都拒', () => {
    expect(checkShots([shot(0, 3), shot(2, 6), shot(6, 8)], 8, [])).toMatch(/首尾相接/);
    expect(checkShots([shot(0, 3), shot(3, 6)], 8, [])).toMatch(/最后一段结束在 6 秒/);
    expect(checkShots([shot(0, 2.5), shot(2.5, 8)], 8, [])).toBeNull();
  });

  it('用户指定的镜头没用上就拒（不然界面上照样是一份正常的稿子，选了等于没选）', () => {
    expect(checkShots([shot(0, 4, '01'), shot(4, 8)], 8, ['01', '12'])).toMatch(/12 近景缓慢后拉至全景/);
    expect(checkShots([shot(0, 4, '1'), shot(4, 8, 12 as any)], 8, ['01', '12'])).toBeNull();
  });
});

// 整段提示词里的秒数是代码按 shots 逐条加的：逐段那两栏少一条，后面每段的动作都挂到错的秒数上。
describe('checkFinal', () => {
  it('逐段动作条数和镜头段数对不上就拒', () => {
    const f = (n: number, m: number) => ({ cameraByShot: Array(n).fill('x'), blockingByShot: Array(n).fill('x'), actionByShot: Array(m).fill('x') });
    expect(checkFinal(f(3, 2), 3)).toMatch(/actionByShot 有 2 条，但 shots 有 3 段/);
    expect(checkFinal(f(3, 3), 3)).toBeNull();
  });
});
