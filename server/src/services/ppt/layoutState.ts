// 哪几条版式**停用**了（案例库页面上每张卡一个开关）。
//
// 三条决定这个文件的形状：
//
// ① **停用是一行状态，不是把 md 删掉、也不是从 `layouts()` 里去掉。** 老稿子的 `plan_json`
//    里存着 layoutId，`layoutById` 认不出的话那几页重新生成会直接 400（而他停用的本意只是
//    「以后别再挑它」）。所以 `layouts()` / `layoutById` 照旧是全部 22 条，**只有「给模型挑的
//    那份清单」过滤停用的**。
//
// ② **存在库里（`system_config.ppt_disabled_layouts`）而不是 md 里**：md 是跟着代码走的，
//    写进 md 等于每次改开关都要改代码、还要发一次版。**这一份是全站共用的**（不分用户、
//    不分稿子）—— 这一点在案例库页面上要写出来，不写的话他会以为是「我这份稿子不用它」。
//
// ③ **某个页型只剩一条时拒绝停用**（`setLayoutEnabled` 抛）。放它过去的话，规划到那种页时
//    清单里一条都没有，模型会挑一条别的页型的版式 —— 编号合法、`kindWarnings` 只多一句
//    提示、每一页单看都正常，整份就是没有封面/没有章节过渡了。

import { getDatabase } from '../../db/index.js';
import { layouts, PAGE_ROLES, LAYOUT_SHAPES, type PageRole, type PptLayout } from './layoutLibrary.js';

const KEY = 'ppt_disabled_layouts';

export class LayoutStateError extends Error {}

/**
 * 停用的编号。
 *
 * **读不出来一律抛**，不回落成「一条都没停用」：回落的话他关掉的那几条版式又开始出现在
 * 规划里，而案例库页面上那几个开关还是关着的 —— 界面和实际彻底反了，而没有一处会说。
 * 只有手改过库才会走到这里（写进去的一定是 `JSON.stringify(string[])`）。
 */
export function disabledLayoutIds(): Set<string> {
  const row = getDatabase().prepare('SELECT value FROM system_config WHERE key = ?').get(KEY) as
    | { value: string }
    | undefined;
  if (!row?.value?.trim()) return new Set();
  let arr: unknown;
  try {
    arr = JSON.parse(row.value);
  } catch {
    arr = null;
  }
  if (!Array.isArray(arr) || arr.some((x) => typeof x !== 'string')) {
    throw new LayoutStateError(
      `版式的停用状态读不出来（system_config.${KEY} 不是一个字符串数组）——` +
        '案例库页面上的开关现在都不准。把库里这一行删掉会回到「全部启用」。'
    );
  }
  return new Set((arr as string[]).map((s) => s.trim().toUpperCase()).filter(Boolean));
}

/** 给模型挑的那份清单（**只有这里过滤停用的**，见文件头第 ① 条）。 */
export function enabledLayouts(): PptLayout[] {
  const off = disabledLayoutIds();
  return layouts().filter((l) => !off.has(l.id));
}

export function enabledLayoutsForRole(role: PageRole): PptLayout[] {
  return enabledLayouts().filter((l) => l.roles.includes(role));
}

/**
 * 开 / 关一条。回**停用后的完整清单**（前端照它重画，不自己在本地取反 —— 取反的话
 * 保存失败那一次开关照样动了，他以为存上了）和几句要显示的提醒。
 */
export function setLayoutEnabled(id: string, enabled: boolean): { disabled: string[]; warnings: string[] } {
  const wanted = String(id || '').trim().toUpperCase();
  const all = layouts();
  if (!all.some((l) => l.id === wanted)) {
    throw new LayoutStateError(`案例库里没有版式 ${wanted || '(空)'}（只有 ${all.map((l) => l.id).join(' / ')}）。`);
  }
  const before = disabledLayoutIds();
  const after = new Set(before);
  if (enabled) after.delete(wanted);
  else after.add(wanted);

  // ③ 某个页型不能被停到一条不剩。
  const leftFor = (role: PageRole, off: Set<string>) =>
    all.filter((l) => l.roles.includes(role) && !off.has(l.id));
  for (const role of PAGE_ROLES) {
    if (leftFor(role, before).length && !leftFor(role, after).length) {
      throw new LayoutStateError(
        `${wanted} 是${role}页最后一条可用的版式了，不能停用 —— 停了之后规划到${role}页时清单里一条都没有，` +
          `模型会挑一条别的页型的版式：编号合法、每一页单看都正常，整份就是没有${role}页了。` +
          `要停用它，先启用另一条能当${role}页的版式。`
      );
    }
  }

  // 形状少了一整种只提醒、不拦：内容页的版式是按「形状」挑的（规划硬规则 5），
  // 少了一种之后模型只能挑一条形状不对的 —— 那一页仍然合法、看起来正常。
  const warnings: string[] = [];
  for (const shape of LAYOUT_SHAPES) {
    const had = all.some((l) => l.roles.includes('内容') && l.shape === shape && !before.has(l.id));
    const has = all.some((l) => l.roles.includes('内容') && l.shape === shape && !after.has(l.id));
    if (had && !has) {
      warnings.push(
        `内容页里从此没有「${shape}」这种形状的版式了 —— 规划遇到这种结构的内容时只能挑一条形状不对的，` +
          '那一页仍然是一页完整正常的幻灯片，不会报错。'
      );
    }
  }

  const list = [...after].sort();
  getDatabase()
    .prepare(
      `INSERT INTO system_config (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .run(KEY, JSON.stringify(list));
  return { disabled: list, warnings };
}
