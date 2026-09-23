// `ppt:embed` 的放行清单（`scopeGuard.ts`）和 pptRouter 上**真实挂着的**路必须对得上。
// 漏一条的形态是：平台自己用一切正常，只有第三方页面里那个嵌入版的某一个按钮是一句 403，
// 而同一屏上其余几十个按钮全是好的 —— 读起来像那一个功能坏了。实测漏掉的是
// `PUT /decks/:id/decor`（整份装饰底图）和整条「生成提纲」（outline-chat / extract-file /
// tidy-text，它们在 `sdkLimits.ts` 的计费表里都登记着，说明本来就是给嵌入版用的）。
// 作者不测嵌入版，所以这种漏只会由接入方发现，手测测不出来 —— 必须钉在这里。
import { describe, it, expect } from 'vitest';
import { pptRouter } from '../api/ppt.js';
import { scopeGuard } from './scopeGuard.js';

/** 故意不放行的那几类（原因写在 scopeGuard.ts 的注释里）。新增时要连原因一起写。 */
const DELIBERATE: Array<{ methods: string[]; path: RegExp }> = [
  // 发 key 的后台接口：放进来 = 把发 key 的能力给了第三方页面里那把公开 pk。
  { methods: ['GET', 'POST', 'PATCH', 'DELETE'], path: /^\/api\/ppt\/admin\// },
  // 用 pk 换 token 那一步本身（那时候还没有 token，压根到不了这个闸门）。
  { methods: ['POST', 'OPTIONS'], path: /^\/api\/ppt\/sdk\/token$/ },
  // 账号级开关：一个接入方停用一个版式，绑定账号和其他接入方从此都排不出它。
  { methods: ['PUT'], path: /^\/api\/ppt\/layouts\/[^/]+\/enabled$/ },
  // deck 外壳的共享 CSS/配色资料，前端一处都没在调。
  { methods: ['GET'], path: /^\/api\/ppt\/library\/assets$/ },
  // 版式 demo 那张 html 是**同源 iframe 的文档请求**：浏览器从不带 Authorization 头，
  // 所以它压根不带 scope token，不经过这个闸门（放进来也不起作用）。
  { methods: ['GET'], path: /^\/api\/ppt\/demo-deck\.html$/ },
];

const routes = ((pptRouter as any).stack as any[])
  .filter((l) => l.route)
  .flatMap((l) =>
    Object.keys(l.route.methods)
      .filter((m) => m !== '_all')
      .map((m) => ({
        method: m.toUpperCase(),
        // 参数填个样本值就够了：清单里都是 `[^/]+`
        path: '/api/ppt' + String(l.route.path).replace(/:[A-Za-z_]+/g, 'x1'),
      }))
  );

function allows(method: string, path: string): boolean {
  let passed = false;
  scopeGuard(
    { tokenScope: 'ppt:embed', method, path } as any,
    { status: () => ({ json: () => undefined }) } as any,
    () => {
      passed = true;
    }
  );
  return passed;
}

describe('ppt:embed 的放行清单', () => {
  it('pptRouter 上每一条路要么放行，要么明确登记成「故意不放行」', () => {
    // 数得出路来才算数：stack 的形状变了（换 express 大版本）会让这条测试变成空跑，
    // 那时候它只会一直绿着，而清单已经和真实路由脱节了。
    expect(routes.length).toBeGreaterThan(30);

    const missing = routes
      .filter((r) => !allows(r.method, r.path))
      .filter((r) => !DELIBERATE.some((d) => d.methods.includes(r.method) && d.path.test(r.path)))
      .map((r) => `${r.method} ${r.path}`);
    expect(missing).toEqual([]);
  });

  it('不许把发 key 的后台接口和账号级开关带进来', () => {
    // 反方向的那一种：清单写宽成 `^/api/ppt/` 之后每个请求都是 200，
    // 界面上一切正常，而第三方页面里那把公开 pk 能自己发 key、能停别人的版式。
    expect(allows('GET', '/api/ppt/admin/sdk-keys')).toBe(false);
    expect(allows('PUT', '/api/ppt/layouts/abc/enabled')).toBe(false);
  });
});
