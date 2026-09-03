import { describe, it, expect, beforeEach } from 'vitest';
import { initDatabase, getDatabase } from '../../db/index.js';
import {
  createDeck, savePlan, savePageHtml, savePageImages, savePendingImages, savePageSetup,
  updatePlanImageSubject, updatePlanPageOutline, listPages, listDecks,
} from './deckStore.js';

initDatabase();

// 这里测的三条都是「出错时界面上一切正常」的路径：重新规划之后旧页留着（版式对不上内容，
// 翻起来完全正常）、重新生成 HTML 之后配图记录留着（界面写着「图配好了」，预览里只是留白）、
// 另一个账号的 deck id 照样读得到。手测全看不出来。

const PAGE_HTML = '<section class="slide"><img data-img-prompt="x" src="/uploads/a.png"></section>';

describe('ppt deckStore', () => {
  let deckId: string;

  beforeEach(() => {
    getDatabase().exec('DELETE FROM ppt_deck_pages; DELETE FROM ppt_decks;');
    deckId = createDeck('u1', { title: '汇报', outline: '一、开头\n二、结尾' }).id;
    savePlan(deckId, 'u1', { pages: [{ page: 1 }, { page: 2 }] });
  });

  it('重新规划会把已生成的页删掉，并说出删了几页', () => {
    savePageHtml(deckId, 'u1', { page: 1, layoutId: 'L1', html: PAGE_HTML });
    savePageHtml(deckId, 'u1', { page: 2, layoutId: 'L4', html: PAGE_HTML });

    const saved = savePlan(deckId, 'u1', { pages: [{ page: 1 }, { page: 2 }, { page: 3 }] });

    // 留着的话新规划的第 1 页会拿到旧内容（版式和内容都不是那一页的），而拼出来的
    // 整份翻起来完全正常；删了不说的话他不知道自己刚扔掉两次已经花掉的调用。
    expect(listPages(deckId, 'u1')).toHaveLength(0);
    expect(saved.clearedPages).toBe(2);
  });

  it('重新生成一页 HTML 会把那一页的配图记录一起清掉', () => {
    savePageHtml(deckId, 'u1', { page: 1, layoutId: 'L1', html: PAGE_HTML });
    savePageImages(deckId, 'u1', {
      page: 1,
      html: PAGE_HTML,
      images: [{ index: 0, url: '/uploads/a.png' }],
      styleId: 'S-A',
    });

    savePageHtml(deckId, 'u1', { page: 1, layoutId: 'L1', html: '<section class="slide">新的一版</section>' });

    // 留着的话界面上那一页照旧显示「1 / 1 张有图、画风 S-A」，而新 html 里图槽位
    // 已经换回占位图 —— 预览里只是「这版设计得比较空」，没有一处报错。
    const row = listPages(deckId, 'u1')[0];
    expect(row.images_json).toBe('');
    expect(row.image_style_id).toBe('');
  });

  it('重新生成一页 HTML 不会动备好的图，重新规划扔掉几张要报出来', () => {
    savePendingImages(deckId, 'u1', { page: 1, images: [{ index: 1, url: '/uploads/p1.png' }] });
    savePendingImages(deckId, 'u1', { page: 2, images: [{ index: 1, url: '/uploads/p2.png' }] });

    savePageHtml(deckId, 'u1', { page: 1, layoutId: 'L1', html: PAGE_HTML });

    // 备好的图是花过真钱的，而它存在于 HTML **之前** —— 跟着配图记录一起被清掉的话，
    // 界面上只是「这一页又要重新配图了」，那几张的钱没有一处会说。
    expect(listPages(deckId, 'u1')[0].pending_images_json).toContain('/uploads/p1.png');

    // 重新规划仍然会连它们一起删（新旧第 1 页压根不是一页内容），但扔了几张必须报出来：
    // 不报的话他只看到「规划好了」，而刚才逐格备的那几张凭空没了。
    expect(savePlan(deckId, 'u1', { pages: [{ page: 1 }] }).clearedImages).toBe(2);
  });

  it('只换版式不会把手写的要求清掉，重新生成 HTML 也不会 —— 重新规划扔掉了几段要报出来', () => {
    savePageSetup(deckId, 'u1', { page: 1, notes: '语气克制，不要感叹号' });
    // 只带 layoutId 的那一次：缺省清空的话这段要求悄悄没了，而两边都回「已保存」，
    // 下一次生成出来照样是一页完整的幻灯片（要求一处都没生效）。
    savePageSetup(deckId, 'u1', { page: 1, layoutId: 'L12' });
    savePageHtml(deckId, 'u1', { page: 1, layoutId: 'L12', html: PAGE_HTML });

    const row = listPages(deckId, 'u1')[0];
    expect(row.setup_notes).toBe('语气克制，不要感叹号');
    expect(row.setup_layout_id).toBe('L12');

    expect(savePlan(deckId, 'u1', { pages: [{ page: 1 }] }).clearedNotes).toBe(1);
  });

  it('改一格图的提示词只动那一格，已生成的页和另一格的改动都留着', () => {
    savePlan(deckId, 'u1', {
      pages: [{ page: 1, imageSpecs: [{ subject: '模型给的一句', mode: 'concept', ratio: '16:9' }, { subject: '第二格', mode: 'case', ratio: '1:1' }] }],
    });
    savePageHtml(deckId, 'u1', { page: 1, layoutId: 'L1', html: PAGE_HTML });

    updatePlanImageSubject(deckId, 'u1', 1, 2, '我自己写的：俯视角，画面里不要出现文字');

    // 走 savePlan 的话这一页会被删掉 —— 改一句提示词就扔掉一次已经花过的调用，
    // 而界面上只是那一页变回「还没生成」。
    expect(listPages(deckId, 'u1')).toHaveLength(1);
    const j = (getDatabase().prepare('SELECT plan_json AS j FROM ppt_decks WHERE id = ?').get(deckId) as { j: string }).j;
    const specs = JSON.parse(j).pages[0].imageSpecs;
    // 只动那一格：整份覆盖的话第 1 格会被顶回旧值，而两处都回「已保存」
    expect(specs[0].subject).toBe('模型给的一句');
    expect(specs[1].subject).toBe('我自己写的：俯视角，画面里不要出现文字');
    // 别人的 deck 改不动（改动了的话下一次生图用的是他的提示词，而响应完全正常）
    expect(updatePlanImageSubject(deckId, 'u2', 1, 1, '别人的').ok).toBe(false);
  });

  it('改这一页的提纲只动那一页，已生成的页和另一页的提纲都留着', () => {
    savePlan(deckId, 'u1', {
      pages: [
        { page: 1, title: '模型给的标题', points: ['旧一', '旧二'] },
        { page: 2, title: '第二页', points: ['别动我'] },
      ],
    });
    savePageHtml(deckId, 'u1', { page: 2, layoutId: 'L1', html: PAGE_HTML });

    updatePlanPageOutline(deckId, 'u1', 1, { title: '我自己写的标题', points: ['新一'] });

    // 走 savePlan 的话第 2 页那份 html 会被删掉 —— 改一句标题就扔掉一次已经花过的调用，
    // 而界面上只是那一页变回「还没生成」。
    expect(listPages(deckId, 'u1')).toHaveLength(1);
    const j = (getDatabase().prepare('SELECT plan_json AS j FROM ppt_decks WHERE id = ?').get(deckId) as { j: string }).j;
    const pages = JSON.parse(j).pages;
    expect(pages[0].title).toBe('我自己写的标题');
    expect(pages[0].points).toEqual(['新一']);
    // 只动这一页：整份覆盖的话第 2 页的提纲会被顶回旧值，而两处都回「已保存」，
    // 下一次生成第 2 页出来是一页照旧提纲排的完整幻灯片。
    expect(pages[1].points).toEqual(['别动我']);
    // 别人的 deck 改不动（改动了的话他下一次生成用的是别人写的提纲，而响应完全正常）
    expect(updatePlanPageOutline(deckId, 'u2', 1, { title: '别人的', points: ['x'] }).ok).toBe(false);
  });

  it('别人的 deck id 读不到，也配不上图', () => {
    savePageHtml(deckId, 'u1', { page: 1, layoutId: 'L1', html: PAGE_HTML });

    expect(listPages(deckId, 'u2')).toEqual([]);
    expect(
      savePageImages(deckId, 'u2', { page: 1, html: PAGE_HTML, images: [], styleId: 'S-A' })
    ).toBe(false);
    expect(listDecks('u2')).toEqual([]);
    // u1 那一页没被动过
    expect(listPages(deckId, 'u1')[0].html).toBe(PAGE_HTML);
  });
});
