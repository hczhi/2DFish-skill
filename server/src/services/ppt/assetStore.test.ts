import { describe, it, expect, beforeEach } from 'vitest';
import { initDatabase, getDatabase } from '../../db/index.js';
import { createDeck, platformOwner } from './deckStore.js';
import { listAssets, assetGroups, rememberAsset, getAsset, ASSETS_NO_DECK } from './assetStore.js';

initDatabase();

// 素材库按稿子分 tab 的那两条路：**筛和计数都必须按整张表算**。在「最近 120 张」里
// 分组/过滤的话，每个 tab 上的数字和点进去的那一屏都读起来完全正常（「这个项目 3 张」），
// 而那个项目真正的几十张在这一页之外 —— 手测看不出来，他会以为图丢了。

describe('ppt assetStore 按稿子分组', () => {
  let a: string;
  let b: string;

  beforeEach(() => {
    getDatabase().exec('DELETE FROM ppt_assets; DELETE FROM ppt_deck_pages; DELETE FROM ppt_decks;');
    a = createDeck(platformOwner('u1'), { title: '甲方汇报', outline: 'x' }).id;
    b = createDeck(platformOwner('u1'), { title: '内部复盘', outline: 'y' }).id;
    for (let i = 0; i < 5; i++) rememberAsset(platformOwner('u1'), { url: `https://cos/a${i}.png`, deckId: a, page: i + 1 });
    for (let i = 0; i < 2; i++) rememberAsset(platformOwner('u1'), { url: `https://cos/b${i}.png`, deckId: b, page: i + 1 });
    rememberAsset(platformOwner('u1'), { url: 'https://cos/orphan.png' }); // 没记归属
  });

  it('筛某一份稿子时，total 是这一份的总数而不是这一页装下的张数', () => {
    // 拿到的是 2 张（limit），但 total 必须是 5：total 跟着页大小走的话「这个项目就 2 张」
    // 和「这一屏只装得下 2 张」在界面上是同一句话，而他要重用的那 3 张一处都看不到。
    const r = listAssets(platformOwner('u1'), { deckId: a, limit: 2 });
    expect(r.assets).toHaveLength(2);
    expect(r.total).toBe(5);
    expect(r.assets.every((x) => x.deck_id === a)).toBe(true);
  });

  it('「没记归属」要用哨兵值筛，空串还是全部（否则那个 tab 会显示全库）', () => {
    expect(listAssets(platformOwner('u1'), { deckId: ASSETS_NO_DECK }).total).toBe(1);
    expect(listAssets(platformOwner('u1'), { deckId: '' }).total).toBe(8);
  });

  it('分组张数按整张表算，稿子删了那一组照旧在（图还在库里）', () => {
    getDatabase().prepare('DELETE FROM ppt_decks WHERE id = ?').run(b);

    const g = assetGroups(platformOwner('u1'));
    expect(g.map((x) => [x.deckId, x.count, x.deckGone, x.title])).toEqual(
      expect.arrayContaining([
        [a, 5, false, '甲方汇报'],
        // 删掉的稿子那一组不能消失：过滤掉的话那两张从每个 tab 里都不见了，看起来像被删过。
        [b, 2, true, ''],
        ['', 1, false, ''],
      ])
    );
  });

  // 101：素材库的租户边界是**一家公司**（那把 pk），不是员工。两种改错都不报错：
  // WHERE 里带上 external_uid → 同事刚生成的图在挑图抽屉里一张都看不到（抽屉是空的，
  // 接口 200，他只会再花一次钱生一张几乎一样的图）；只比 user_id → 另一家公司的图
  // （客户的产品图、门店照）出现在这个抽屉里，而它读起来就是一屏正常的素材。
  it('同一家公司的员工共用素材库，另一家公司和平台自己的看不到', () => {
    const she = { userId: 'u1', sdkPk: 'pk_ppt_a', externalUid: 'emp-1' };
    const colleague = { userId: 'u1', sdkPk: 'pk_ppt_a', externalUid: 'emp-2' };
    const otherCompany = { userId: 'u1', sdkPk: 'pk_ppt_b', externalUid: 'emp-1' };
    rememberAsset(she, { url: 'https://cos/company-a.png' });

    const seen = listAssets(colleague);
    expect(seen.assets.map((x) => x.url)).toEqual(['https://cos/company-a.png']);
    // 挑图那一步是按 id 取的，也必须同一个判定（不然抽屉里看得到、点下去说找不到）
    expect(getAsset(seen.assets[0].id, colleague)?.url).toBe('https://cos/company-a.png');

    expect(listAssets(otherCompany).total).toBe(0);
    // 绑定账号自己在网页上的素材库里没有这一张（老素材那 8 张一条不少）
    expect(listAssets(platformOwner('u1')).assets.map((x) => x.url)).not.toContain('https://cos/company-a.png');
    expect(listAssets(platformOwner('u1')).total).toBe(8);
  });
});
