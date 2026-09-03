import type { Migration } from '../migrator.js';

/**
 * HTML 展示稿（/ppt）落库：一份演示稿 = 一行 `ppt_decks` + 每页一行 `ppt_deck_pages`。
 *
 * 为什么必须落库：一份 12 页的 deck 是**十几次真实 AI 调用**（每页一次 + 每张图一次），
 * 而在这之前全部状态都在 PptPlan.vue 的内存里 —— 刷新、切到别的模块、手滑关掉标签页，
 * 整份就没了，而界面上一句错都没有（回来就是一个空的提纲框）。用户唯一的出路是把
 * 十几次额度再花一遍，而他不会知道是「没保存」还是「本来就该这样」。
 *
 * 三件事故意**不**落库，它们都是 `deckShell` 现拼的派生物：
 * ① 每页的 `previewHtml`、② 拼好的整份 deck html、③ 版式 demo。存下来的话改过
 * `library/template.html` 之后打开一份老 deck 看到的是**旧骨架**，而这时导出/拼整份走的是
 * 新骨架 —— 两边都不报错，而案例库的全部作用就是「照我们的骨架跑出来长这样」。
 * 所以读的时候现拼（同一份 `assembleDeck`）。
 *
 * `plan_json` 存 planService 回的整份规划（pages + problems 原样）：拆成一行一页的话
 * 「模型给了什么理由 / 这次规划有哪几处要注意」会散在两处，而那两样是判断「挑得准不准」
 * 的唯一依据。`planned_total` 另存一列，因为页脚那个「N / 总页数」是按它写的。
 *
 * `ppt_deck_pages` 按 `(deck_id, page)` 唯一。**重新规划必须先把这张表清空**：不清的话
 * 旧的第 3 页会照旧挂在新规划的第 3 页下面（版式和内容都不是那一页的），预览里翻起来
 * 完全正常，两边都不报错 —— 前端原来就是靠 `built = {}` 做这件事的，落库之后同一条
 * 规则要落在库上。
 *
 * db/index.ts 没开 PRAGMA foreign_keys，REFERENCES 只是注释：删 deck 必须自己把
 * 页那张表清掉（见 services/ppt/deckStore.ts:deleteDeck），留下的孤儿页不报错，
 * 但会被「已生成几页」这类计数查询一直算进去。
 */
export const migration_089: Migration = {
  id: '089_ppt_decks',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS ppt_decks (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        -- 演示稿名字（列表上那一行）。默认取提纲第一行，用户可改。
        title TEXT NOT NULL,
        -- 提纲原文。规划是照它跑的，所以它必须和 plan_json 存在同一行里 ——
        -- 只存规划结果的话，回来想微调提纲重跑只能凭记忆重打一遍。
        outline TEXT NOT NULL DEFAULT '',
        -- deck 外壳上的品牌名/主题（页脚、封面那几个占位符），逐页 HTML 里没有它
        brand_cn TEXT NOT NULL DEFAULT '',
        brand_en TEXT NOT NULL DEFAULT '',
        -- 配图画风（S-A ~ S-F，styleLibrary 里的 id）。整份一个画风。
        style_id TEXT NOT NULL DEFAULT '',
        -- planService 的整份返回（JSON）。空串 = 还没规划过。
        plan_json TEXT NOT NULL DEFAULT '',
        planned_total INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_ppt_decks_user
         ON ppt_decks(user_id, updated_at DESC)`
    );

    db.exec(`
      CREATE TABLE IF NOT EXISTS ppt_deck_pages (
        id TEXT PRIMARY KEY,
        deck_id TEXT NOT NULL REFERENCES ppt_decks(id),
        -- 规划里的页码（1 起）。**按它对齐，不按插入顺序** —— 批量生成是逐页回来的，
        -- 按到达顺序拼出来的 deck 每一页都对而章节全乱，翻起来看不出缺口。
        page INTEGER NOT NULL,
        layout_id TEXT NOT NULL DEFAULT '',
        -- 这一页的 <section>…</section>。图配好之后要用新 html **覆盖**这里，
        -- 不覆盖的话拼整份用的还是占位图那一版，而预览里刚刚明明看到图了。
        html TEXT NOT NULL DEFAULT '',
        -- imageService 回的逐张结果（JSON）：哪张成了、哪张还是占位图、图存哪了。
        -- 只存一个「配了几张」的数字的话，失败的那几格在预览里就是「设计上留白」。
        images_json TEXT NOT NULL DEFAULT '',
        -- 这一页的图是用哪套画风生成的。换画风不会自动重做已有的图，
        -- 不逐页存的话整份翻下来两套笔触混着，而每张单看都好、没有一处报错。
        image_style_id TEXT NOT NULL DEFAULT '',
        -- checkPage 的「渲染出来了但不对」清单（JSON 数组）
        problems_json TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(deck_id, page)
      );
    `);
  },
};
