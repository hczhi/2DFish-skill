import { describe, it, expect } from 'vitest';
import { buildScene } from './sceneService.js';
import type { Script } from './scriptService.js';

// 这几条出错时画面照样「画得出来」，不报的话他只会觉得 AI 就配了这么些。
const script: Script = {
  title: 't', summary: '', style: 'whiteboard', duration: 20,
  shots: [
    { seconds: 5, heading: 'A', visual: '', elements: ['手机'], note: '' },
    { seconds: 5, heading: 'B', visual: '', elements: ['数据库', '云'], note: '' },
  ],
};

describe('buildScene', () => {
  it('图标库里没有的图标名改成文字并报出来', () => {
    const { scene, notes } = buildScene({ shots: [{ items: [{ id: 'a', type: 'icon', icon: 'Teleporter', label: '传送门' }] }, { items: [{ id: 'b', type: 'icon', icon: '数据库' }] }] }, script);
    expect(scene.shots[0].items[0]).toMatchObject({ type: 'text', text: '传送门' });
    expect(scene.shots[1].items[0]).toMatchObject({ type: 'icon', icon: 'Database' });
    expect(notes.some((n) => n.includes('「Teleporter」图标库里没有'))).toBe(true);
  });

  it('AI 少回一镜时，那一镜用剧本里的元素顶上并报出来', () => {
    const { scene, notes } = buildScene({ shots: [{ items: [{ id: 'a', type: 'icon', icon: 'Smartphone' }], arrows: [{ from: 'a', to: 'zz' }] }] }, script);
    expect(scene.shots[1].items.map((i) => (i.type === 'icon' ? i.icon : ''))).toEqual(['Database', 'Cloud']);
    expect(scene.shots[0].arrows).toBeUndefined();
    expect(notes.some((n) => n.includes('AI 回了 1 镜'))).toBe(true);
    expect(notes.some((n) => n.includes('箭头指向不存在的元素'))).toBe(true);
  });
});

describe('buildScene 图示', () => {
  it('一个图形都没画出来时报出来', () => {
    const { notes } = buildScene({ shots: [{ items: [{ id: 'a', type: 'text', text: '手机' }] }, { items: [{ id: 'b', type: 'icon', icon: 'Database' }] }] }, script);
    expect(notes.some((n) => n.startsWith('第 1 镜没有画出任何图形'))).toBe(true);
    expect(notes.some((n) => n.startsWith('第 2 镜没有画出任何图形'))).toBe(false);
  });

  it('算式两边不相等时报出来，相等时不报', () => {
    const { scene, notes } = buildScene({ shots: [
      { items: [{ id: 'e', type: 'diagram', kind: 'equation', text: '8 + 2 = 11' }] },
      { items: [{ id: 'f', type: 'diagram', kind: 'equation', text: '10 + 3 = 13' }] },
    ] }, script);
    expect(scene.shots[0].items[0]).toMatchObject({ type: 'diagram', kind: 'equation', text: '8 + 2 = 11' });
    expect(notes.filter((n) => n.includes('两边算出来不相等'))).toHaveLength(1);
  });
});

describe('buildScene 版式和讲解动作', () => {
  it('讲解动作对着不存在的元素时去掉并报出来，版式不认识时按平均分格并报出来', () => {
    const { scene, notes } = buildScene({ shots: [
      { layout: 'spiral', items: [{ id: 'a', type: 'icon', icon: 'Smartphone' }], beats: [{ do: 'circle', target: 'a' }, { do: 'circle', target: 'zz' }] },
      { layout: 'compare', items: [{ id: 'b', type: 'icon', icon: 'Database' }] },
    ] }, script);
    expect(scene.shots[0].beats).toEqual([{ do: 'circle', target: 'a' }]);
    expect(scene.shots[0].layout).toBeUndefined();
    expect(scene.shots[1].layout).toBe('compare');
    expect(notes.some((n) => n.includes('对着一个不存在的元素（zz）'))).toBe(true);
    expect(notes.some((n) => n.includes('版式「spiral」不认识'))).toBe(true);
  });
});

it('讲解动作的键写成 type / action 时照样认', () => {
  const { scene, notes } = buildScene({ shots: [
    { items: [{ id: 'a', type: 'icon', icon: 'Smartphone' }], beats: [{ type: 'circle', target: 'a' }, { action: 'Zoom', target: 'a' }] },
    { items: [{ id: 'b', type: 'icon', icon: 'Database' }] },
  ] }, script);
  expect(scene.shots[0].beats).toEqual([{ do: 'circle', target: 'a' }, { do: 'zoom', target: 'a' }]);
  expect(notes.some((n) => n.includes('讲解动作'))).toBe(false);
});
