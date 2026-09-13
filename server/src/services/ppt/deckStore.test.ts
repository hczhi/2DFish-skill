import { describe, it, expect, beforeEach } from 'vitest';
import { initDatabase, getDatabase } from '../../db/index.js';
import {
  createDeck, savePlan, savePageHtml, savePageImages, savePendingImages, savePageSetup,
  savePageVeil, updatePlanImageSubject, updatePlanPageOutline, listPages, listDecks,
  getDeck, deletePage, insertPage,
  platformOwner,
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
    deckId = createDeck(platformOwner('u1'), { title: '汇报', outline: '一、开头\n二、结尾' }).id;
    savePlan(deckId, platformOwner('u1'), { pages: [{ page: 1 }, { page: 2 }] });
  });

  it('重新规划会把已生成的页删掉，并说出删了几页', () => {
    savePageHtml(deckId, platformOwner('u1'), { page: 1, layoutId: 'L1', html: PAGE_HTML });
    savePageHtml(deckId, platformOwner('u1'), { page: 2, layoutId: 'L4', html: PAGE_HTML });

    const saved = savePlan(deckId, platformOwner('u1'), { pages: [{ page: 1 }, { page: 2 }, { page: 3 }] });

    // 留着的话新规划的第 1 页会拿到旧内容（版式和内容都不是那一页的），而拼出来的
    // 整份翻起来完全正常；删了不说的话他不知道自己刚扔掉两次已经花掉的调用。
    expect(listPages(deckId, platformOwner('u1'))).toHaveLength(0);
    expect(saved.clearedPages).toBe(2);
  });

  it('重新生成一页 HTML 会把那一页的配图记录一起清掉', () => {
    savePageHtml(deckId, platformOwner('u1'), { page: 1, layoutId: 'L1', html: PAGE_HTML });
    savePageImages(deckId, platformOwner('u1'), {
      page: 1,
      html: PAGE_HTML,
      images: [{ index: 0, url: '/uploads/a.png' }],
      styleId: 'S-A',
    });

    savePageHtml(deckId, platformOwner('u1'), { page: 1, layoutId: 'L1', html: '<section class="slide">新的一版</section>' });

    // 留着的话界面上那一页照旧显示「1 / 1 张有图、画风 S-A」，而新 html 里图槽位
    // 已经换回占位图 —— 预览里只是「这版设计得比较空」，没有一处报错。
    const row = listPages(deckId, platformOwner('u1'))[0];
    expect(row.images_json).toBe('');
    expect(row.image_style_id).toBe('');
  });

  it('重新生成一页 HTML 不会动备好的图，重新规划扔掉几张要报出来', () => {
    savePendingImages(deckId, platformOwner('u1'), { page: 1, images: [{ index: 1, url: '/uploads/p1.png' }] });
    savePendingImages(deckId, platformOwner('u1'), { page: 2, images: [{ index: 1, url: '/uploads/p2.png' }] });

    savePageHtml(deckId, platformOwner('u1'), { page: 1, layoutId: 'L1', html: PAGE_HTML });

    // 备好的图是花过真钱的，而它存在于 HTML **之前** —— 跟着配图记录一起被清掉的话，
    // 界面上只是「这一页又要重新配图了」，那几张的钱没有一处会说。
    expect(listPages(deckId, platformOwner('u1'))[0].pending_images_json).toContain('/uploads/p1.png');

    // 重新规划仍然会连它们一起删（新旧第 1 页压根不是一页内容），但扔了几张必须报出来：
    // 不报的话他只看到「规划好了」，而刚才逐格备的那几张凭空没了。
    expect(savePlan(deckId, platformOwner('u1'), { pages: [{ page: 1 }] }).clearedImages).toBe(2);
  });

  it('只换版式不会把手写的要求清掉，重新生成 HTML 也不会 —— 重新规划扔掉了几段要报出来', () => {
    savePageSetup(deckId, platformOwner('u1'), { page: 1, notes: '语气克制，不要感叹号' });
    // 只带 layoutId 的那一次：缺省清空的话这段要求悄悄没了，而两边都回「已保存」，
    // 下一次生成出来照样是一页完整的幻灯片（要求一处都没生效）。
    savePageSetup(deckId, platformOwner('u1'), { page: 1, layoutId: 'L12' });
    savePageHtml(deckId, platformOwner('u1'), { page: 1, layoutId: 'L12', html: PAGE_HTML });

    const row = listPages(deckId, platformOwner('u1'))[0];
    expect(row.setup_notes).toBe('语气克制，不要感叹号');
    expect(row.setup_layout_id).toBe('L12');

    expect(savePlan(deckId, platformOwner('u1'), { pages: [{ page: 1 }] }).clearedNotes).toBe(1);
  });

  it('改一格图的提示词只动那一格，已生成的页和另一格的改动都留着', () => {
    savePlan(deckId, platformOwner('u1'), {
      pages: [{ page: 1, imageSpecs: [{ subject: '模型给的一句', mode: 'concept', ratio: '16:9' }, { subject: '第二格', mode: 'case', ratio: '1:1' }] }],
    });
    savePageHtml(deckId, platformOwner('u1'), { page: 1, layoutId: 'L1', html: PAGE_HTML });

    updatePlanImageSubject(deckId, platformOwner('u1'), 1, 2, '我自己写的：俯视角，画面里不要出现文字');

    // 走 savePlan 的话这一页会被删掉 —— 改一句提示词就扔掉一次已经花过的调用，
    // 而界面上只是那一页变回「还没生成」。
    expect(listPages(deckId, platformOwner('u1'))).toHaveLength(1);
    const j = (getDatabase().prepare('SELECT plan_json AS j FROM ppt_decks WHERE id = ?').get(deckId) as { j: string }).j;
    const specs = JSON.parse(j).pages[0].imageSpecs;
    // 只动那一格：整份覆盖的话第 1 格会被顶回旧值，而两处都回「已保存」
    expect(specs[0].subject).toBe('模型给的一句');
    expect(specs[1].subject).toBe('我自己写的：俯视角，画面里不要出现文字');
    // 别人的 deck 改不动（改动了的话下一次生图用的是他的提示词，而响应完全正常）
    expect(updatePlanImageSubject(deckId, platformOwner('u2'), 1, 1, '别人的').ok).toBe(false);
  });

  it('改这一页的提纲只动那一页，已生成的页和另一页的提纲都留着', () => {
    savePlan(deckId, platformOwner('u1'), {
      pages: [
        { page: 1, title: '模型给的标题', points: ['旧一', '旧二'] },
        { page: 2, title: '第二页', points: ['别动我'] },
      ],
    });
    savePageHtml(deckId, platformOwner('u1'), { page: 2, layoutId: 'L1', html: PAGE_HTML });

    updatePlanPageOutline(deckId, platformOwner('u1'), 1, { title: '我自己写的标题', points: ['新一'] });

    // 走 savePlan 的话第 2 页那份 html 会被删掉 —— 改一句标题就扔掉一次已经花过的调用，
    // 而界面上只是那一页变回「还没生成」。
    expect(listPages(deckId, platformOwner('u1'))).toHaveLength(1);
    const j = (getDatabase().prepare('SELECT plan_json AS j FROM ppt_decks WHERE id = ?').get(deckId) as { j: string }).j;
    const pages = JSON.parse(j).pages;
    expect(pages[0].title).toBe('我自己写的标题');
    expect(pages[0].points).toEqual(['新一']);
    // 只动这一页：整份覆盖的话第 2 页的提纲会被顶回旧值，而两处都回「已保存」，
    // 下一次生成第 2 页出来是一页照旧提纲排的完整幻灯片。
    expect(pages[1].points).toEqual(['别动我']);
    // 别人的 deck 改不动（改动了的话他下一次生成用的是别人写的提纲，而响应完全正常）
    expect(updatePlanPageOutline(deckId, platformOwner('u2'), 1, { title: '别人的', points: ['x'] }).ok).toBe(false);
  });

  it('没带提纲原文的那次编辑不会把原文清掉，带了就换成新的那一段', () => {
    savePlan(deckId, platformOwner('u1'), {
      pages: [{ page: 1, title: '一', points: ['旧一'], outlineText: '1.1 地产板块\n营收 12.4 亿，同比 +8%' }],
    });
    const outlineOf = () => {
      const j = (getDatabase().prepare('SELECT plan_json AS j FROM ppt_decks WHERE id = ?').get(deckId) as { j: string }).j;
      return JSON.parse(j).pages[0].outlineText;
    };

    // 只改了标题（老前端不带这个字段）：清掉的话生成出来照样是一页完整的幻灯片，
    // 只是内容退回 points 那几句摘要，提纲上的「12.4 亿」一个字都不在，一处都不会说。
    updatePlanPageOutline(deckId, platformOwner('u1'), 1, { title: '我写的标题', points: ['旧一'] });
    expect(outlineOf()).toBe('1.1 地产板块\n营收 12.4 亿，同比 +8%');

    // 带了就换：不换的话下一次生成用的还是老原文，而界面上他改过的那一段已经在框里了。
    updatePlanPageOutline(deckId, platformOwner('u1'), 1, { title: '我写的标题', points: ['旧一'], outlineText: '我粘进去的补充材料' });
    expect(outlineOf()).toBe('我粘进去的补充材料');
  });

  it('删中间一页之后，剩下每一页身上的画面/备图/蒙版/要求还跟着它自己', () => {
    savePlan(deckId, platformOwner('u1'), { pages: [{ page: 1, title: '一' }, { page: 2, title: '二' }, { page: 3, title: '三' }] });
    for (const n of [1, 2, 3]) {
      savePageHtml(deckId, platformOwner('u1'), { page: n, layoutId: `L${n}`, html: `<section class="slide">第${n}页</section>` });
      savePendingImages(deckId, platformOwner('u1'), { page: n, images: [{ index: 1, url: `/uploads/p${n}.png` }] });
      savePageSetup(deckId, platformOwner('u1'), { page: n, notes: `第${n}页的要求` });
      savePageVeil(deckId, platformOwner('u1'), { page: n, opacity: n / 10 });
    }

    const r = deletePage(deckId, platformOwner('u1'), 2);

    // 搬的是「行的页码」，所以一整页的状态整体跟着走。挨个搬内容的话漏掉哪一列都是
    // 「那一页的图/蒙版/要求留在了原地」，而每一页显示出来都是一页正常的幻灯片。
    const rows = listPages(deckId, platformOwner('u1'));
    expect(rows.map((p) => p.page)).toEqual([1, 2]);
    expect(rows[0].html).toContain('第1页');
    expect(rows[1].html).toContain('第3页');
    expect(rows[1].pending_images_json).toContain('/uploads/p3.png');
    expect(rows[1].setup_notes).toBe('第3页的要求');
    expect(rows[1].veil_opacity).toBeCloseTo(0.3);
    // 规划和页表必须在同一个事务里对齐：错开一位的话生成第 2 页拿的是第 3 页的提纲，
    // 出来是一页完整的幻灯片而标题对不上内容。
    const deck = getDeck(deckId, platformOwner('u1'))!;
    const plan = JSON.parse(deck.plan_json);
    expect(plan.pages.map((p: any) => [p.page, p.title])).toEqual([[1, '一'], [2, '三']]);
    expect(deck.planned_total).toBe(2);
    // 版本号不 +1 的话 098 那道保护形同不存在：上一刻发出去的「生成第 3 页」回来时会写到
    // 现在的第 2 页上（一次真实花费，换来一页照着别的提纲排的幻灯片）。
    expect(deck.plan_rev).toBe(r.planRev);
    expect(deck.plan_rev).toBe(3); // 建稿 0 + 两次 savePlan + 这次删页
    // 扔掉的东西要逐类报数（每一项都是花过真钱的）
    expect(r.removed).toEqual({ html: true, images: 0, prepared: 1, notes: true, veil: true });
    expect(r.shifted).toBe(1);
  });

  it('在中间插一页，后面每一页的画面/备图/要求跟着自己往后挪一位（新那一页是空的）', () => {
    savePlan(deckId, platformOwner('u1'), {
      pages: [
        { page: 1, title: '一', section: '第一章', layoutId: 'L1' },
        { page: 2, title: '二', section: '第二章', layoutId: 'L4' },
      ],
    });
    for (const n of [1, 2]) {
      savePageHtml(deckId, platformOwner('u1'), { page: n, layoutId: `L${n}`, html: `<section class="slide">第${n}页</section>` });
      savePendingImages(deckId, platformOwner('u1'), { page: n, images: [{ index: 1, url: `/uploads/p${n}.png` }] });
      savePageSetup(deckId, platformOwner('u1'), { page: n, notes: `第${n}页的要求` });
    }

    const r = insertPage(deckId, platformOwner('u1'), { after: 1, title: '插进来的', points: ['一条'] });

    // 不搬（或搬错方向）的话：新的第 2 页身上挂着原来第 2 页的画面和备好的图，翻起来
    // 就是一页正常的幻灯片，只是标题写着「插进来的」而画面是别人的内容。
    const rows = listPages(deckId, platformOwner('u1'));
    expect(rows.map((p) => p.page)).toEqual([1, 3]);
    expect(rows[1].html).toContain('第2页');
    expect(rows[1].pending_images_json).toContain('/uploads/p2.png');
    expect(rows[1].setup_notes).toBe('第2页的要求');
    // 新那一页在库里**没有行**：建一行空 html 的话它在「已生成」那几处算生成过，预览里是一块白。
    expect(rows.some((p) => p.page === 2)).toBe(false);

    const plan = JSON.parse(getDeck(deckId, platformOwner('u1'))!.plan_json);
    expect(plan.pages.map((p: any) => [p.page, p.title])).toEqual([[1, '一'], [2, '插进来的'], [3, '二']]);
    expect(getDeck(deckId, platformOwner('u1'))!.planned_total).toBe(3);
    // 版本号 +1（在路上那次生成必须被 409 拒掉），版式和模块名跟着前一页并如实报出来
    expect(getDeck(deckId, platformOwner('u1'))!.plan_rev).toBe(r.planRev);
    expect(r).toMatchObject({ page: 2, shifted: 1, layoutId: 'L1', section: '第一章', layoutInherited: true });
  });

  it('插一页空白页：库里当场就有 html（否则「生成剩下的 N 页」会花一次真调用把画布换掉）', () => {
    savePlan(deckId, platformOwner('u1'), { pages: [{ page: 1, title: '一', section: '第一章', layoutId: 'L1' }] });

    const r = insertPage(deckId, platformOwner('u1'), { after: 1, title: '这里自己排', blank: true });

    // 不落 html 的话它在界面上是「未生成」，`runAll` 只挑没生成的那几页 —— 那一次真实调用
    // 出来是一页按案例库版式排的幻灯片，读起来完全正常，只是他摆的东西全没了。
    const row = listPages(deckId, platformOwner('u1')).find((p) => p.page === 2)!;
    expect(row.html).toContain('<section');
    expect(row.html).toContain('bl-canvas');
    expect(row.layout_id).toBe('BLANK');
    // demo 必须是空的：随手指一条的话点开是别人的版式，而他会以为空白页就长那样
    expect(r.blank).toBe(true);
    expect(JSON.parse(getDeck(deckId, platformOwner('u1'))!.plan_json).pages[1]).toMatchObject({
      layoutId: 'BLANK', demoUrl: '', section: '',
    });
  });

  it('空白页不收要点 —— 静默扔掉的话他写的那几条从此不存在，而这一页插得好好的', () => {
    expect(() => insertPage(deckId, platformOwner('u1'), { after: 1, title: '自己排', points: ['一条'], blank: true })).toThrow(
      /不吃要点/
    );
    expect(listPages(deckId, platformOwner('u1'))).toHaveLength(0);
  });

  it('删过页之后，规划里那几条跨页提示会被标成「可能已经不准」', () => {
    savePlan(deckId, platformOwner('u1'), {
      pages: [{ page: 1 }, { page: 2 }, { page: 3 }],
      problems: ['第 1–2 页连续 2 页都是 L2（规范是连续 ≤2 页），翻起来会很单调。'],
    });

    deletePage(deckId, platformOwner('u1'), 1);

    // 不标的话这句话读起来仍然像是这份稿子现在的问题，而它说的那两页已经不在那儿了
    // （页码对不上，也没有一处会说）。
    const problems = JSON.parse(getDeck(deckId, platformOwner('u1'))!.plan_json).problems;
    expect(problems[0]).toContain('改过页数/页序');
    expect(problems).toHaveLength(2);

    // 再删一次不会又攒一条一样的提示
    savePlan(deckId, platformOwner('u1'), { pages: [{ page: 1 }, { page: 2 }, { page: 3 }], problems: ['连续同版式那句'] });
    deletePage(deckId, platformOwner('u1'), 1);
    deletePage(deckId, platformOwner('u1'), 1);
    expect(JSON.parse(getDeck(deckId, platformOwner('u1'))!.plan_json).problems).toHaveLength(2);
  });

  it('别人的 deck id 读不到，也配不上图', () => {
    savePageHtml(deckId, platformOwner('u1'), { page: 1, layoutId: 'L1', html: PAGE_HTML });

    expect(listPages(deckId, platformOwner('u2'))).toEqual([]);
    expect(
      savePageImages(deckId, platformOwner('u2'), { page: 1, html: PAGE_HTML, images: [], styleId: 'S-A' })
    ).toBe(false);
    expect(listDecks(platformOwner('u2'))).toEqual([]);
    // u1 那一页没被动过
    expect(listPages(deckId, platformOwner('u1'))[0].html).toBe(PAGE_HTML);
  });

  // 100/101：租户 = **一家公司** = `(绑定账号, 那把 pk)`。三条都手测不出来：
  //   ① WHERE 里带上 external_uid → 同一家公司的两个员工各自一个空工作台，同事建的稿子
  //      看不到，而每个接口都是 200（他们只会说「我们的东西丢了」）；
  //   ② 只比 user_id → 另一把 pk（另一家公司）的稿子出现在这份列表里，读起来完全正常；
  //   ③ 比较写成 `= ?` → NULL 永不相等，平台自己那些老稿子一条都列不出来。
  it('同一家公司（同一把 pk）的员工互相看得到，另一家公司和平台自己的看不到', () => {
    const she = { userId: 'u1', sdkPk: 'pk_ppt_a', externalUid: 'emp-1' };
    const colleague = { userId: 'u1', sdkPk: 'pk_ppt_a', externalUid: 'emp-2' };
    const otherCompany = { userId: 'u1', sdkPk: 'pk_ppt_b', externalUid: 'emp-1' };
    const hers = createDeck(she, { title: '公司 A 的稿子', outline: 'x' }).id;

    // 同事打得开、列得出（素材库同一份判定，见 assetStore）
    expect(listDecks(colleague).map((d) => d.id)).toEqual([hers]);
    expect(getDeck(hers, colleague)?.title).toBe('公司 A 的稿子');
    // 另一家公司、以及绑定账号自己在网页上的工作台，都看不到它
    expect(listDecks(otherCompany).map((d) => d.id)).toEqual([]);
    expect(getDeck(hers, otherCompany)).toBeFalsy();
    expect(listDecks(platformOwner('u1')).map((d) => d.id)).toEqual([deckId]);
  });
});
