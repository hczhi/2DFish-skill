import { describe, it, expect } from 'vitest';
import { normalizeScript, lintScript } from './scriptService.js';

// 截断 / 丢镜头时剧本照样「完整」地显示出来 —— 不报出来的话他看不出标题被截了半句、后几镜没了。
describe('normalizeScript', () => {
  it('超长标题截断并写进 notes，多出来的镜头丢掉也写进 notes', () => {
    const shots = Array.from({ length: 9 }, (_, i) => ({ seconds: 3, heading: i === 0 ? '这是一个特别特别特别特别长的标题啊啊' : `第${i}镜`, visual: '', elements: ['手机'], note: '' }));
    const { script, notes } = normalizeScript({ title: '测试', shots }, 'whiteboard', 15);
    expect(script.shots[0].heading).toBe('这是一个特别特别特别特别长的标题');
    expect(notes.some((n) => n.includes('第 1 镜标题超过 16 字'))).toBe(true);
    expect(script.shots.length).toBe(5);
    expect(notes.some((n) => n.includes('分了 9 镜'))).toBe(true);
  });
});

// 剧本「读起来能用」但讲得呆板：这几条不报的话 AI 也不会去改，他只会觉得效果就这样。
describe('lintScript', () => {
  it('连着三镜同一个版式、开头不是钩子、30 秒以上没有转折，都报出来', () => {
    const shot = (role: any, layout: any) => ({ seconds: 5, heading: 'x', visual: '', elements: ['手机'], note: '', role, layout });
    const issues = lintScript({ title: 't', summary: '', style: 'whiteboard', duration: 30, shots: [shot('setup', 'grid'), shot('develop', 'grid'), shot('develop', 'grid'), shot('close', 'hero')] });
    expect(issues.some((x) => x.includes('开场要是钩子'))).toBe(true);
    expect(issues.some((x) => x.includes('第 1–3 镜连着 3 镜'))).toBe(true);
    expect(issues.some((x) => x.includes('没有转折'))).toBe(true);
    const ok = lintScript({ title: 't', summary: '', style: 'whiteboard', duration: 30, shots: [shot('hook', 'hero'), shot('develop', 'flow'), shot('turn', 'reveal'), shot('close', 'compare')] });
    expect(ok).toEqual([]);
  });
});
