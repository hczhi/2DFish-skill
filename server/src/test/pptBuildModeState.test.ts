import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';

// 生成这一页的响应里有没有「这一页的图」那一栏的状态（`pageModeState`）。
//
// 典型的「出错时伪装成成功」：他点「生成这一页」，接口 200、画面上是一页漂亮的整页背景图
// （L13 这一条版式自带 `默认图模式：背景图`，服务端生成完就地变形了），而右边那一栏写着
// **「这一页的图　分屏」**，底下唯一的按钮是**「改回分屏」** —— 两句话互相矛盾，各自又都是
// 正常文案。少的只是响应里这几个字段：前端那几个 map 上没有这一页，于是标题回落成「分屏」、
// 按钮那边按「不是分屏」画。刷新一下（走 `GET /pages`）就对了，所以症状是「这块状态经常不对」。
//
// 所以这里断言的是**响应体里那几个字段**，不只是状态码。

const PAGE_HTML = `<section class="slide" data-layout="L70">
  <div class="slide-inner">
    <div class="l70-grid">
      <div class="l70-fig"><img src="/ppt-cases/ph-16x9.svg" alt="" data-img-prompt="一位工程师在车间调试设备" data-img-mode="case"></div>
      <div class="l70-say"><h1 class="page-title">我们的能力</h1></div>
    </div>
  </div>
</section>`;

// 生成那一步（真跑要花一次上游调用）换成固定输出：这条测试要看的是**它回来之后**路由怎么拼
// 响应，不是模型排得好不好。`layoutId` 写 L13 —— 就为了拿它那行「默认图模式：背景图」。
vi.mock('../services/ppt/pageService.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/ppt/pageService.js')>();
  return {
    ...actual,
    generatePage: vi.fn(async () => ({
      page: 1,
      layoutId: 'L13',
      html: PAGE_HTML,
      previewHtml: `<html><body>${PAGE_HTML}</body></html>`,
      problems: [],
    })),
  };
});

const { app } = await import('../app.js');
const { createUser } = await import('./helpers.js');
const { createDeck, savePlan, getDeck, platformOwner } = await import('../services/ppt/deckStore.js');
const { layoutById } = await import('../services/ppt/layoutLibrary.js');

let user: Awaited<ReturnType<typeof createUser>>;
let deckId: string;
let rev: number;

beforeAll(() => {
  user = createUser();
  const deck = createDeck(platformOwner(user.id), { title: '图模式状态', outline: '一' });
  deckId = deck.id;
  savePlan(deckId, platformOwner(user.id), {
    pages: [{ page: 1, title: 'P1', section: '一', points: ['要点一'], layoutId: 'L13', images: 1 }],
  });
  rev = getDeck(deckId, platformOwner(user.id))!.plan_rev;
});

describe('生成这一页的响应带着「这一页的图」那一栏', () => {
  it('版式自带背景图模式时，响应里的 imageMode 就是背景图（不是空）', async () => {
    // 前提：L13 那一行还写着「默认图模式：背景图」。它被改掉的话这条测试就测不到东西了
    // （响应里照样是 split，而那时候 split 是对的）—— 所以先断言一句。
    expect(layoutById('L13')?.defaultImageMode).toBe('backdrop');

    const res = await request(app)
      .post(`/api/ppt/decks/${deckId}/pages`)
      .set(user.auth)
      .send({ page: 1, planRev: rev });
    expect(res.status).toBe(200);

    // 这一句是承重的：少了它，界面上那一栏写「分屏」而画面是整页背景图。
    expect(res.body.imageMode).toBe('backdrop');
    // 幕帘浓度一起回（L13 那一行写的是 0%）：不回的话滑块显示 30% 而这一页实际是 0%。
    expect(res.body.backdropMask).toBe(0);
    // 已经是背景图的页不许带「不能改成背景图」的原因：带了的话前端照它画一句
    // 「这一页的版式不做背景图模式」，而这一页恰恰正是背景图。
    expect(res.body.backdropBlock).toBeNull();
    expect(res.body.decor).toBe(false);
  });
});
