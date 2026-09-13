import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { createUser, type TestUser } from './helpers.js';
import {
  createDeck, savePlan, savePageHtml, getDeck, listPages, platformOwner,
} from '../services/ppt/deckStore.js';
import { injectEids, eidsIn } from '../services/ppt/pageEdit.js';

// 页序版本号（098）在**就地编辑**这几条路上的端到端回归。
//
// 这是典型的「出错时伪装成成功」：他在 A 标签页删了第 3 页，B 标签页还停在旧页序上。
// B 里双击改一句字 / 拖蒙版 / 点 AI 编辑，接口 200、界面上「已修改」、库里也真的存了 ——
// 只是存到了现在的第 3 页（原来的第 4 页）上。手测测不出来：那一页照样是一页完整的
// 幻灯片，只是内容和标题对不上，而他要翻到那一页才可能发现。
//
// 所以这里断言的是**库里那一行没被动过**，不只是状态码。

const HTML = injectEids(
  '<section class="slide"><div class="slide-inner"><h2 class="l02-title">原标题</h2></div></section>'
);

let user: TestUser;
let deckId: string;
let rev: number;
let eid: string;

function htmlOf(page: number): string {
  return listPages(deckId, platformOwner(user.id)).find((p) => p.page === page)?.html || '';
}

beforeAll(() => {
  user = createUser();
  const deck = createDeck(platformOwner(user.id), { title: '页序测试', outline: '一二三' });
  deckId = deck.id;
  savePlan(deckId, platformOwner(user.id), { pages: [{ title: 'P1' }, { title: 'P2' }] });
  savePageHtml(deckId, platformOwner(user.id), { page: 1, layoutId: 'L1', html: HTML });
  rev = getDeck(deckId, platformOwner(user.id))!.plan_rev;
  eid = eidsIn(HTML)[0];
});

describe('ppt 就地编辑的页序版本号', () => {
  // 七条路一起过：漏一条的表现和全都没有一样（他恰好用的是那一条），
  // 而那一条上一切正常 —— 只有落库的那一页是错的。
  const cases: Array<{ name: string; run: (planRev: unknown) => request.Test }> = [
    {
      name: 'edit-text',
      run: (planRev) =>
        request(app).post(`/api/ppt/decks/${deckId}/edit-text`).set(user.auth)
          .send({ page: 1, eid, oldText: '原标题', newText: '被改坏的标题', planRev }),
    },
    {
      name: 'edit-style',
      run: (planRev) =>
        request(app).post(`/api/ppt/decks/${deckId}/edit-style`).set(user.auth)
          .send({ page: 1, eid, style: { fontWeight: '700' }, planRev }),
    },
    {
      name: 'edit-region-style',
      run: (planRev) =>
        request(app).post(`/api/ppt/decks/${deckId}/edit-region-style`).set(user.auth)
          .send({ page: 1, path: [0, 0], style: { textAlign: 'center' }, planRev }),
    },
    {
      name: 'delete-node',
      run: (planRev) =>
        request(app).post(`/api/ppt/decks/${deckId}/delete-node`).set(user.auth)
          .send({ page: 1, path: [0, 0], planRev }),
    },
    {
      name: 'ai-edit',
      run: (planRev) =>
        request(app).post(`/api/ppt/decks/${deckId}/ai-edit`).set(user.auth)
          .send({ page: 1, path: [0, 0], eids: [eid], instruction: '排成两列', planRev }),
    },
    {
      name: 'ai-remake',
      run: (planRev) =>
        request(app).post(`/api/ppt/decks/${deckId}/ai-remake`).set(user.auth)
          .send({ page: 1, path: [0, 0], eids: [eid], instruction: '换个排法', planRev }),
    },
    {
      name: 'veil',
      run: (planRev) =>
        request(app).patch(`/api/ppt/decks/${deckId}/pages/1/veil`).set(user.auth)
          .send({ opacity: 0.4, planRev }),
    },
  ];

  it('页序变过（旧版本号）时七条路一律 409，库里那一页一个字都不动', async () => {
    for (const c of cases) {
      const res = await c.run(rev - 1);
      expect(res.status, c.name).toBe(409);
      expect(res.body.error, c.name).toMatch(/页数\/页序在你打开之后变过/);
      expect(htmlOf(1), c.name).toBe(HTML);
    }
    // 蒙版那条不写 html 列，单独核它那一列也没动（不核的话它「拒了」和「照做了」看不出区别）。
    expect(listPages(deckId, platformOwner(user.id)).find((p) => p.page === 1)?.veil_opacity || 0).toBe(0);
  });

  it('压根不带 planRev 一律 400（旧前端 / 少传一个字段都算）', async () => {
    for (const c of cases) {
      const res = await c.run(undefined);
      expect(res.status, c.name).toBe(400);
      expect(res.body.error, c.name).toMatch(/没带 planRev/);
      expect(htmlOf(1), c.name).toBe(HTML);
    }
  });

  it('版本号对得上时照旧能改（上面两条不能把正常改动也拦掉）', async () => {
    const res = await request(app).post(`/api/ppt/decks/${deckId}/edit-text`).set(user.auth)
      .send({ page: 1, eid, oldText: '原标题', newText: '新标题', planRev: rev });
    expect(res.status).toBe(200);
    expect(htmlOf(1)).toContain('新标题');
  });
});
