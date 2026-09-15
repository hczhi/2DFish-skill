import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { createUser, type TestUser } from './helpers.js';
import {
  createDeck, savePlan, savePageHtml, getDeck, listPages, platformOwner,
} from '../services/ppt/deckStore.js';
import { injectEids, eidsIn } from '../services/ppt/pageEdit.js';

// 编辑之后图表的「量」有没有跟着重算（`chartData.rechartEdited`）。
//
// 典型的「出错时伪装成成功」：他在一页横条图上删掉最长那一行，接口 200、界面上「已删掉」、
// 剩下那几行照样是一页干净完整的条形图 —— 只是轨道上限还是按**被删掉那个数**算的，于是
// 剩下的最大值也只画到轨道的一小截，读起来像「这几项都还差得远」。手测测不出来：一处都不报错。
//
// 所以这里断言的是**库里那一页的 `--bar-max`**（拼整份和导出用的都是它），不只是状态码。

const HTML = injectEids(
  '<section class="slide"><div class="slide-inner">' +
    '<div class="dt-unit"><span>单位：分钟</span></div>' +
    '<div class="l47-rows" style="--bar-max:20">' +
    '<div class="l47-row" style="--bar-v:19"><div class="l47-name">旧流程</div>' +
    '<div class="l47-track"><div class="l47-fill"></div></div>' +
    '<div class="l47-val">19<i>分钟</i></div></div>' +
    '<div class="l47-row" style="--bar-v:3"><div class="l47-name">现在</div>' +
    '<div class="l47-track"><div class="l47-fill"></div></div>' +
    '<div class="l47-val">3<i>分钟</i></div></div>' +
    '</div></div></section>'
);

let user: TestUser;
let deckId: string;
let rev: number;

beforeAll(() => {
  user = createUser();
  const deck = createDeck(platformOwner(user.id), { title: '图表编辑', outline: '一' });
  deckId = deck.id;
  savePlan(deckId, platformOwner(user.id), { pages: [{ title: 'P1' }] });
  savePageHtml(deckId, platformOwner(user.id), { page: 1, layoutId: 'L47', html: HTML });
  rev = getDeck(deckId, platformOwner(user.id))!.plan_rev;
});

describe('ppt 编辑之后图表的量由代码重算', () => {
  it('删掉最长那一行之后，库里那一页的轨道上限跟着降，并且出声', async () => {
    const res = await request(app)
      .post(`/api/ppt/decks/${deckId}/delete-node`)
      .set(user.auth)
      // `eids` 是这一块里那几段字的编号，服务端要拿它和库里交叉核对（选中的是不是同一块）。
      .send({ page: 1, path: [0, 1, 0], eids: eidsIn(HTML.split('<div class="l47-row"')[1]), planRev: rev });
    expect(res.status).toBe(200);

    const saved = listPages(deckId, platformOwner(user.id)).find((p) => p.page === 1)!.html;
    // 19 那一行删掉了，剩下的最大值是 3 —— 上限还留着 20 的话，唯一那一根条只画到 15%。
    expect(saved).toContain('--bar-max:3');
    expect(saved).not.toContain('--bar-max:20');
    // 别的条会当场变长，不说一句他会以为是自己那一下把数据删坏了。
    expect(res.body.chartNotes?.length).toBeGreaterThan(0);
  });
});
