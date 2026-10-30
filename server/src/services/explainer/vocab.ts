// 剧本和场景共用的词表（两边都 import 这里，避免 scriptService ↔ sceneService 互相 import）。
// 版式 / 讲解动作的含义见前端 components/explainer/scene.ts 的注释，名字必须和那边一致。

export const LAYOUTS = ['grid', 'hero', 'reveal', 'compare', 'flow', 'hub', 'timeline'] as const;
export type Layout = (typeof LAYOUTS)[number];
export const LAYOUT_NAMES: Record<Layout, string> = {
  hero: '主角放大', reveal: '大字揭示', compare: '左右对比', flow: '流程链', hub: '中心发散', timeline: '时间线', grid: '平均分格',
};
export const BEATS = ['circle', 'underline', 'cross', 'check', 'box', 'zoom'] as const;

/** 叙事角色：这一镜在整条片子里干什么 */
export const ROLES = ['hook', 'setup', 'develop', 'turn', 'payoff', 'close'] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_NAMES: Record<Role, string> = {
  hook: '开场钩子', setup: '铺垫', develop: '展开', turn: '反转', payoff: '高潮', close: '收束',
};
