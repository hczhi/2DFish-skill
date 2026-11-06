import { getSkillForSlot } from '../skillRegistryService.js';

export * from './methods.js';

// BP 报告各章「分析方法」那段提示词：后台 /admin/skills 里可改（slot 绑定），没绑就用这里的内置默认。
//
// 能改的只有「怎么分析」。输出 JSON 的结构、引文核验、算分都在各章 service 的代码里，**不进这份文字**：
// 后台改了字段名的话报告那一块是空白而不报错，看起来像「这份 BP 没有这项」。
// 所以默认文字和后台播种（migration 121）里都不许写输出格式。
//
// 每章都要把 `origin` 存进报告（字段名 promptSource）：后台那份被删 / 被停用 / 解绑时静默退回内置默认，
// 不记的话他在后台改了半天，报告看不出到底用没用上。

// 字段叫 origin 不叫 source：`source: '…'` 在这个仓库里是 gateway 的应用名，aiAppRegistry 测试扫全库那个字面量。
export function bpMethod(slot: string, fallback: string): { text: string; origin: 'skill' | 'default' } {
  const fromSkill = getSkillForSlot(slot);
  return fromSkill ? { text: fromSkill, origin: 'skill' } : { text: fallback, origin: 'default' };
}
