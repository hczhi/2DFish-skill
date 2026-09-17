# PPT 模块数据库结构

来源：`server/src/db/migrations/089_ppt_decks.ts` ~ `102_ppt_chart_bar_max.ts`（PPT 相关的迁移就是这 14 个，之后没有）。
现库是 **SQLite（better-sqlite3）**，迁移是手写的、启动时顺序执行；**`PRAGMA foreign_keys` 是关的**，所以 `REFERENCES` 只是注释，级联删除全在代码里手工做。

Python 侧移植时的两个前提：

1. **ID 全是应用层生成的字符串**（不是自增整数），时间列全是 **TEXT**（ISO 字符串），不是 DATETIME。
2. 所有租户过滤都写成 **NULL 安全比较**（SQLite `IS ?`，Postgres 用 `IS NOT DISTINCT FROM`）。写成 `=` 的话平台自己那批 `sdk_pk IS NULL` 的稿子会全部查不出来 —— 列表是空的，接口 200。

---

## 1. 表清单

| 表 | 作用 | 建表迁移 |
| --- | --- | --- |
| `ppt_decks` | 一份演示稿（提纲 + 规划 + 设计规范） | 089，后续 093/096/098/100 加列 |
| `ppt_deck_pages` | 一页幻灯片（html + 配图记录 + 页级设置） | 089，后续 091/092/097 加列 |
| `ppt_assets` | 素材库（生成的图 + 上传的图） | 090，101 加租户列 |
| `ppt_sdk_keys` | 第三方嵌入用的 publishable key 及其配额 | 100 |
| `system_config`（复用平台表） | 只用一个键 `ppt_disabled_layouts` | 平台表 |

外部依赖表（不属于 PPT，但 PPT 调 AI/生图要用）：`ai_providers`、`ai_logs`、`ai_app_quota`、`users`。见 `doc/ppt-contracts.md` 第 6 节。

---

## 2. `ppt_decks`

```sql
CREATE TABLE ppt_decks (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  title         TEXT NOT NULL,
  outline       TEXT NOT NULL DEFAULT '',
  brand_cn      TEXT NOT NULL DEFAULT '',
  brand_en      TEXT NOT NULL DEFAULT '',
  style_id      TEXT NOT NULL DEFAULT '',
  plan_json     TEXT NOT NULL DEFAULT '',
  planned_total INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'active',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  -- 093
  notes         TEXT NOT NULL DEFAULT '',
  -- 096
  design_json   TEXT NOT NULL DEFAULT '',
  -- 098
  plan_rev      INTEGER NOT NULL DEFAULT 0,
  -- 100（可空）
  sdk_pk        TEXT,
  external_uid  TEXT
);
CREATE INDEX idx_ppt_decks_user   ON ppt_decks(user_id, updated_at DESC);
CREATE INDEX idx_ppt_decks_owner  ON ppt_decks(user_id, sdk_pk, external_uid, updated_at DESC); -- 100
CREATE INDEX idx_ppt_decks_tenant ON ppt_decks(user_id, sdk_pk, updated_at DESC);               -- 101
```

| 列 | 说明 |
| --- | --- |
| `id` | 应用层生成的短 id |
| `user_id` | 归属账号。**钱（AI/生图额度）永远记在这个 id 上**，跟 `sdk_pk` 无关 |
| `title` | 列表上那一行。建稿时空则取提纲第一行；上限 80 字 |
| `outline` | 提纲原文。**必须和 `plan_json` 存在同一行**：只存规划结果的话，回来想微调提纲重跑只能凭记忆重打。上限 12000 字 |
| `brand_cn` / `brand_en` | 外壳上的品牌名（页脚、封面占位符）。**逐页 html 里没有它们**，是拼装时注入的。各上限 24 字 |
| `style_id` | 配图画风 id（`styleLibrary` 的 `S-*`）。整份一个画风 |
| `plan_json` | `PlanResult` 的整份 JSON（见 §6.1）。空串 = 还没规划过 |
| `planned_total` | 规划出来的总页数（冗余，列表用） |
| `status` | 目前只写 `'active'`；删除是真删行，不是软删 |
| `notes` | 整份的额外要求（写进每页 prompt）。上限 500 字 |
| `design_json` | `DesignSpec`（见 §6.5）。空串 = 默认那套 |
| `plan_rev` | **乐观锁版本号**。每次页序发生变化（`savePlan` / `deletePage` / `insertPage`）+1。见 `doc/ppt-contracts.md` §4 |
| `sdk_pk` | NULL = 平台自己的稿子；非 NULL = 某把 SDK key（= 某个第三方公司）下的稿子 |
| `external_uid` | 第三方那边的用户标识，**只做记录，永远不进 WHERE**。隔离靠 `sdk_pk`，不靠它 |

`created_at` / `updated_at`：ISO 字符串。列表按 `updated_at DESC` 排。

### 列表视图派生字段（不落库）

`listDecks` 返回的 `PptDeckRow` 里有两个是 SQL 现算的，别建列：

```sql
built_count  = SUM(CASE WHEN p.html <> '' THEN 1 ELSE 0 END)
imaged_count = SUM(CASE WHEN p.html LIKE '%data-img-prompt%'
                          AND p.html NOT LIKE '%/ppt-cases/ph-%' THEN 1 ELSE 0 END)
outline_chars = LENGTH(outline)
```

---

## 3. `ppt_deck_pages`

```sql
CREATE TABLE ppt_deck_pages (
  id                  TEXT PRIMARY KEY,
  deck_id             TEXT NOT NULL REFERENCES ppt_decks(id),
  page                INTEGER NOT NULL,
  layout_id           TEXT NOT NULL DEFAULT '',
  html                TEXT NOT NULL DEFAULT '',
  images_json         TEXT NOT NULL DEFAULT '',
  image_style_id      TEXT NOT NULL DEFAULT '',
  problems_json       TEXT NOT NULL DEFAULT '',
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  -- 091
  pending_images_json TEXT NOT NULL DEFAULT '',
  -- 092
  setup_layout_id     TEXT NOT NULL DEFAULT '',
  setup_notes         TEXT NOT NULL DEFAULT '',
  -- 097
  veil_opacity        REAL NOT NULL DEFAULT 0,
  UNIQUE(deck_id, page)
);
```

| 列 | 说明 |
| --- | --- |
| `page` | 规划里的页码，**1 起**。按它对齐，不按插入顺序 —— 批量生成是逐页异步回来的，按到达顺序拼出来的整份每一页都对而章节全乱，翻起来看不出缺口 |
| `layout_id` | 实际生成用的版式 id（`L1`…`L65`，或空白页的 `BLANK`） |
| `html` | 这一页的 `<section>…</section>` 片段，**不含外壳、不含 `<html>`**。空串 = 还没生成。`html LIKE '%<section%'` 就是"这一页生成过"的判据 |
| `images_json` | `FilledImage[]`（见 §6.2）。逐张结果：哪张成了、哪张还是占位图、图存哪了。只存一个"配了几张"的数字的话，失败的那几格在预览里就是"设计上留白" |
| `image_style_id` | 这一页的图是用哪套画风生成的（换画风不会重做已有的图，不逐页存的话整份两套笔触混着而每张单看都好） |
| `problems_json` | `string[]`，`checkPage` 的"渲染出来了但不对"清单 |
| `pending_images_json` | `PreparedImage[]`（见 §6.3）：已经备好、还没贴进 html 的图 |
| `setup_layout_id` | 用户手动改过的版式。**等于规划里那个时存空串**，这样"跟着规划走"和"我锁死了这个版式"分得开 |
| `setup_notes` | 这一页的额外要求（上限 500 字） |
| `veil_opacity` | 0~1，照片页那层幕帘。**html 一个字都不改**，幕帘是拼装时贴的 —— 写进 html 的话"重新生成这一页"会把它带走而滑块还停在原位 |

### 页码重排是两阶段的

`deletePage` / `insertPage` 要挪页码，而 `UNIQUE(deck_id, page)` 会在中途撞上。做法是**先把要挪的行写成负页码，再写回正数**，整段在一个事务里，且 `plan_json` 和页表**必须同一个事务**。分两次提交的话中间崩掉留下的是"规划说 12 页、页表 11 页"，界面上照旧能翻。

其他约束：最后一页不允许删；插入时 `MAX_PAGES = 45` 上限照旧生效。

---

## 4. `ppt_assets`

```sql
CREATE TABLE ppt_assets (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  url          TEXT NOT NULL,
  prompt       TEXT NOT NULL DEFAULT '',
  mode         TEXT NOT NULL DEFAULT '',
  style_id     TEXT NOT NULL DEFAULT '',
  ratio        TEXT NOT NULL DEFAULT '',
  model        TEXT NOT NULL DEFAULT '',
  storage      TEXT NOT NULL DEFAULT '',
  deck_id      TEXT NOT NULL DEFAULT '',
  page         INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  -- 101（可空）
  sdk_pk       TEXT,
  external_uid TEXT,
  UNIQUE(user_id, url)
);
CREATE INDEX idx_ppt_assets_user   ON ppt_assets(user_id, created_at DESC);
CREATE INDEX idx_ppt_assets_tenant ON ppt_assets(user_id, sdk_pk, created_at DESC); -- 101
```

| 列 | 说明 |
| --- | --- |
| `url` | 图的最终地址（COS CDN 或本地 `/uploads/...`） |
| `prompt` | 生成用的提示词；上传的图这里是空的 |
| `mode` | `'concept' \| 'case' \| 'data'`（`ImageMode`），上传的图为空 |
| `ratio` | `'16:9' \| '1:1' \| '3:4'`，上传的图按像素取最近的那一档（`nearestRatio`） |
| `storage` | `'cos' \| 'local'` |
| `deck_id` / `page` | 这张图第一次是在哪份稿子的哪一页出现的（空串 / 0 = 散图）。素材库分组用它 |

**`UNIQUE(user_id, url)` 是刻意保留的**（没有改成带 `sdk_pk` 的三列唯一）：SQLite 里 NULL 不参与唯一去重，所以平台那批 `sdk_pk IS NULL` 的行原样共存。移植到 Postgres 时这一条**行为一致**（Postgres 唯一索引里 NULL 同样不冲突），但如果换成 `UNIQUE(user_id, sdk_pk, url)` 就要注意 NULL 语义。

---

## 5. `ppt_sdk_keys`

```sql
CREATE TABLE ppt_sdk_keys (
  pk              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  name            TEXT NOT NULL DEFAULT '',
  allowed_origins TEXT NOT NULL DEFAULT '[]',
  enabled         INTEGER NOT NULL DEFAULT 1,
  rate_limit      INTEGER NOT NULL DEFAULT 60,
  daily_ai_limit  INTEGER NOT NULL DEFAULT 120,
  max_decks       INTEGER NOT NULL DEFAULT 50,
  ai_used_today   INTEGER NOT NULL DEFAULT 0,
  ai_used_date    TEXT,
  created_at      TEXT NOT NULL,
  last_used_at    TEXT
);
CREATE INDEX idx_ppt_sdk_keys_user ON ppt_sdk_keys(user_id);
```

| 列 | 说明 |
| --- | --- |
| `pk` | `pk_ppt_` + 24 字节随机 hex。**这是可公开字符串**，会写进第三方页面的 JS 里 —— 所以保护只能靠下面这几个上限和 `allowed_origins`，不能靠"别泄露" |
| `user_id` | 这把 key 的稿子和花费都记在这个账号上 |
| `allowed_origins` | JSON 字符串数组。既做 token 交换的来源校验，**又做 CSP `frame-ancestors`** |
| `enabled` | 0 = 关。关掉之后所有业务接口回 403 `sdk_key_disabled`，**但稿子不删** |
| `rate_limit` | token 交换的每分钟次数上限（默认 60，内存滑窗） |
| `daily_ai_limit` | 每天 AI 调用次数上限（默认 120，按服务器本地日期） |
| `max_decks` | 这把 key 名下的稿子总数上限（默认 50） |
| `ai_used_today` / `ai_used_date` | 当天已用次数 + 日期戳。`ai_used_date != 今天` 时读作 0（不必写回） |
| `last_used_at` | 最近一次成功换 token 的时间 |

`rate_limit` / `daily_ai_limit` / `max_decks` **允许填 0**（= 完全禁用那一类操作），所以校验函数必须把 0 当合法值，只拒非整数和负数。

---

## 6. JSON 列的载荷结构

这些列是"一份完整对象的 JSON"，不是散字段。Python 侧建议原样保留成 JSON/JSONB 列 + Pydantic 模型，不要拆表。

### 6.1 `ppt_decks.plan_json` → `PlanResult`

```ts
interface PlanResult {
  pages: PlannedPage[];
  problems: string[];
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

interface PlannedPage {
  page: number;                          // 1 起
  section: string;                       // 章节名
  kind: '封面'|'章节'|'内容'|'结尾'|'';   // 老行里可能存着 '目录'，读出来按认不出来处理（空串）
  title: string;
  points: string[];
  layoutId: string;                      // L1…L65 / BLANK
  why: string;                           // 选这条版式的理由（界面上要显示）
  alts: string[];                        // 备选版式 id，最多 3 个
  images: number;                        // 图位数量 = imageSpecs.length
  imageSpecs: PlannedImage[];            // 见 6.4
  outlineText: string;                   // 这一页对应的提纲原文
  outlineRange: [number, number] | null; // 提纲第几行到第几行
  coverNote?: string;
  layoutName: string;                    // 以下四个是从案例库补上的展示字段
  layoutTitle: string;
  fullbleed: boolean;
  demoUrl: string;
}
```

`layoutName` / `layoutTitle` / `fullbleed` / `demoUrl` 是**代码从案例库补的**，不是模型给的。

### 6.2 `ppt_deck_pages.images_json` → `FilledImage[]`

```ts
interface FilledImage {
  index: number;      // 1 起，按图槽在 html 里出现的顺序
  prompt: string;
  mode: 'concept'|'case'|'data';
  ratio: '16:9'|'1:1'|'3:4';
  url?: string;       // 成了才有
  error?: string;     // 失败原因（必须原样显示，不能合成一句"配图失败"）
  skipped?: boolean;  // 这一格本来就有图、这次跳过了
  storage?: 'cos'|'local';
  model?: string;
}
```

### 6.3 `ppt_deck_pages.pending_images_json` → `PreparedImage[]`

```ts
interface PreparedImage {
  index: number;               // 1 起，对应 imageSpecs 的第几格
  url: string;
  prompt: string;
  mode: 'concept'|'case'|'data';
  ratio: '16:9'|'1:1'|'3:4';
  styleId?: string;
  model?: string;
  storage?: 'cos'|'local';
  from: 'ai' | 'library';
  at: string;                  // 备好的时间
}
```

图槽数量变少时，落在新清单外面那几张**已经花过钱的**备图要当场点名（`orphanedPreparedNotes`）—— 备图面板按新清单画，它们从界面上消失而库里还留着。

### 6.4 `imageSpecs` 的元素 → `PlannedImage`

```ts
interface PlannedImage {
  subject: string;   // 画什么，上限 300 字
  mode: 'concept'|'case'|'data';
  ratio: '16:9'|'1:1'|'3:4';
}
```
一页最多 `MAX_SLOTS_PER_PAGE = 6` 格；超出的格子备不了图（只能走"配全部图"）。

### 6.5 `ppt_decks.design_json` → `DesignSpec`

```ts
interface DesignSpec {
  palette: 'P-A'|'P-B'|'P-C'|'P-D';  // 想象橙(默认) / 沉稳蓝 / 墨绿 / 党建红
  font:    'F-A'|'F-B'|'F-C';        // 宋标黑正(默认) / 全黑体 / 全宋体
  density: 'D-A'|'D-B'|'D-C';        // 舒展 / 标准(默认) / 紧凑
  header:  'H-A'|'H-B'|'H-C'|'H-D';  // 小字宽字距(默认) / 细宋 / 品牌色块 / 不显示
}
```

两条读写规则不能合并成一条：

- **写入路径（`readDesignSpec`）认不出一律抛错**，不回落。回落的话他选了"墨绿"存下来是橙的，而界面上那个下拉还显示着"墨绿"。
- **读取路径（`parseDesignSpec`）认不出回落成默认并附一条 `problems`**（这时通常是手改过库或某套配色下线了）。096 那批老 deck 的 `design_json` 里**压根没有 `header` 键** —— 缺键静静回默认，**不报问题**。

### 6.6 `ppt_deck_pages.problems_json` → `string[]`

纯字符串数组，每条是一句给用户看的中文。**每条都要原样显示**：合成一句"这一页有问题"等于指错方向。

### 6.7 `system_config.ppt_disabled_layouts` → `string[]`（JSON 字符串）

被停用的版式 id 列表，**全站生效，不分用户**。值坏了要抛 `LayoutStateError`（不能当成"没停用任何一条"）。
`setLayoutEnabled` 拒绝停掉任一 `PageRole`（封面/章节/内容/结尾）的最后一条版式，并在某个内容页版型（聚焦/分屏/并列/对比/数据/时序）整类消失时返回 warning。

---

## 7. 迁移逐条清单（移植时的建表顺序）

| 迁移 | 干了什么 |
| --- | --- |
| 089 | 建 `ppt_decks` + `idx_ppt_decks_user`；建 `ppt_deck_pages`（含 `UNIQUE(deck_id,page)`） |
| 090 | 建 `ppt_assets`（含 `UNIQUE(user_id,url)`）+ `idx_ppt_assets_user` |
| 091 | `ppt_deck_pages.pending_images_json` |
| 092 | `ppt_deck_pages.setup_layout_id` / `setup_notes` |
| 093 | `ppt_decks.notes` |
| 094 | 数据迁移：从 `problems_json` 里剔掉一类已经作废的提示文案 |
| 095 | 数据迁移：给历史页面 html 补 `data-eid`（`injectEids`） |
| 096 | `ppt_decks.design_json` |
| 097 | `ppt_deck_pages.veil_opacity` |
| 098 | `ppt_decks.plan_rev` |
| 099 | 数据迁移：`ppt_assets.url` 和页面 html 里的源站域名改写成 CDN 域名。**先删掉会撞 `UNIQUE(user_id,url)` 的重复行再改写** —— 迁移抛异常 = 服务起不来 |
| 100 | 建 `ppt_sdk_keys`；`ppt_decks` 加 `sdk_pk` / `external_uid` + `idx_ppt_decks_owner` |
| 101 | `ppt_assets` 加 `sdk_pk` / `external_uid`；加 `idx_ppt_assets_tenant`、`idx_ppt_decks_tenant` |
| 102 | 数据迁移：对含 `l47-rows` / `l52-cols` 的页面重跑 `normalizeChartData`（纯函数、幂等） |

新库直接建最终结构即可，094/095/099/102 是历史数据修补，不用移植。
