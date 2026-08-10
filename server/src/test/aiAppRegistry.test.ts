import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { AI_APPS, isValidAppScope, appName } from '../core/llm/apps.js';

// 「按应用配 token / 配额」靠 GatewayOptions.source 和配置里的 scope_app
// **字符串相等**来匹配。所以 AI_APPS 白名单一旦漏了某个 source，
// 那个应用就永远配不上自己的配置 —— 而且不报错，只是不生效。
//
// 这个测试扫全仓库的 `source: '...'` 字面量，逼着新加模块时把白名单一起更新。
// 它红了的正确做法是去 core/llm/apps.ts 加一行，不是来改这个测试。

const SRC = join(process.cwd(), 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') && !p.includes('.test.')) out.push(p);
  }
  return out;
}

/**
 * 去掉注释再扫。注释里写 `source: 'xxx'` 举例子是很自然的事
 * （本次就正好在 apps.ts 和 062 迁移的说明里各写了一处），
 * 不排除的话这个测试会被自己的文档搞红。
 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * 找出所有作为 gateway 参数出现的 source 字面量。
 *
 * 只认 `source: '字面量'` 这一种形态。项目里 gateway 的 40 多个调用点全是这个写法
 * （没有一处是变量或模板串），下面还有一条测试守着这件事 —— 一旦有人写成
 * `source: someVar`，这个扫描就会漏掉它，所以那种写法必须被挡住。
 */
function collectSourceLiterals(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const file of walk(SRC)) {
    const text = stripComments(readFileSync(file, 'utf8'));
    for (const m of text.matchAll(/source:\s*'([^']+)'/g)) {
      const val = m[1];
      if (!found.has(val)) found.set(val, []);
      found.get(val)!.push(file.replace(SRC, 'src'));
    }
  }
  return found;
}

// 非 gateway 用途的 source 字段（飞书通讯录同步的 dir_source、
// agent_skills.source 记的「这个技能是手建/导入/复制来的」等），
// 它们不是「应用」，不该进白名单。按值排除而不是按文件排除：
// 换文件位置不该让这个白名单失效。
const NOT_AN_APP = new Set(['contact', 'chats', 'copy']);

describe('AI 应用白名单与 gateway 的 source 保持一致', () => {
  it('每个 gateway source 字面量都在 AI_APPS 里', () => {
    const literals = collectSourceLiterals();
    const known = new Set(AI_APPS.map((a) => a.id));
    const missing: string[] = [];
    for (const [val, files] of literals) {
      if (NOT_AN_APP.has(val) || known.has(val)) continue;
      missing.push(`${val}（出现在 ${files.slice(0, 3).join(', ')}）`);
    }
    expect(
      missing,
      `这些 source 没有在 core/llm/apps.ts 的 AI_APPS 里，按应用配 token/配额对它们会静默失效：\n${missing.join('\n')}`
    ).toEqual([]);
  });

  it('AI_APPS 里没有代码中不存在的应用', () => {
    // 反方向：白名单里挂着一个已经删掉的模块，后台下拉会给出配了也没用的选项。
    const literals = collectSourceLiterals();
    const stale = AI_APPS.filter((a) => !literals.has(a.id)).map((a) => a.id);
    expect(stale, `AI_APPS 里这些 id 在代码里找不到对应的 gateway 调用：${stale.join(', ')}`).toEqual([]);
  });

  it('AI_APPS 的 id 不重复', () => {
    const ids = AI_APPS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('gateway 的 source 必须是字面量', () => {
  it('没有 source: 变量 / 模板串 的写法', () => {
    // 一旦有人写 `source: mod` 或 `source: \`x-${y}\``，上面的扫描就漏了它，
    // 白名单的保护随之失效（而且没人会注意到）。
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const text = stripComments(readFileSync(file, 'utf8'));
      for (const m of text.matchAll(/source:\s*([^'",}\s][^,}\n]*)/g)) {
        const raw = m[1].trim();
        // 类型声明（source: string / 'a' | 'b'）和取字段（row.dir_source）不算调用点。
        if (/^(string|\('|'|"|`)/.test(raw)) continue;
        if (/^[A-Za-z_$][\w$]*\.(dir_)?source\b/.test(raw)) continue;
        if (raw.startsWith('src ?')) continue;
        if (/^'[^']*'(\s*\|\s*'[^']*')*;?$/.test(raw)) continue;
        offenders.push(`${file.replace(SRC, 'src')}: source: ${raw.slice(0, 60)}`);
      }
    }
    expect(
      offenders,
      `gateway 的 source 必须写成字面量，否则 AI_APPS 白名单测试扫不到它：\n${offenders.join('\n')}`
    ).toEqual([]);
  });
});

describe('isValidAppScope', () => {
  it('空值表示「不限应用」，是合法的', () => {
    expect(isValidAppScope('')).toBe(true);
    expect(isValidAppScope(null)).toBe(true);
    expect(isValidAppScope(undefined)).toBe(true);
  });

  it('白名单内的 id 合法', () => {
    expect(isValidAppScope('xhs')).toBe(true);
    expect(isValidAppScope('tender')).toBe(true);
  });

  it('大小写和拼写错误一律不合法 —— 这正是它存在的理由', () => {
    expect(isValidAppScope('XHS')).toBe(false);
    expect(isValidAppScope('ui_review')).toBe(false);   // 真值是 ui-review
    expect(isValidAppScope('小红书')).toBe(false);
  });
});

describe('appName', () => {
  it('已知 id 返回中文名', () => {
    expect(appName('xhs')).toBe('小红书写作台');
  });

  it('未知 id 原样返回，不抛错', () => {
    // 库里可能留着白名单删掉之后的历史行，日志/报错文案不该因此崩。
    expect(appName('zzz')).toBe('zzz');
  });
});
