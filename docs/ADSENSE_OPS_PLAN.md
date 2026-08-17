# qiaonx.com 运营优化方案（AdSense「内容质量低」诊断）

审计时间：2026-08-14。所有数据用 Googlebot UA 实测线上站点得出。

## 一、结论

**问题不在内容本身，在内容根本没被交付出去。**

站上真的有 22 篇 2000～2500 字、带小标题和数据引用的原创长文，但 Google 一篇都看不到。
sitemap 里 65 个 URL，**53 个返回的是与首页完全相同的一份 HTML**（同一个 ETag
`"6a7d755b-619e"`、同为 24990 字节），并且这 53 个页面的
`<link rel="canonical">` 全部指向 `https://qiaonx.com/`。

也就是说，在 Google 眼里 qiaonx.com = **一个 898 字符的导航卡片页**。
「内容质量低」是这个事实的准确描述，不是误判。

浏览器里访问是正常的（Vue 挂载后会渲染真实页面），所以肉眼自测发现不了 ——
这是一次典型的「失败伪装成成功」。

## 二、证据：Google 抓到的是什么

| 页面 | 可见正文字符数 | canonical |
|---|---|---|
| `/` | 898 | `/` |
| `/en` | 1962 | `/en` |
| `/discover` | 1968 | `/discover` |
| `/en/discover` | 5072 | `/en/discover` |
| `/fish` `/board` `/ui-review` `/synap`（含 /en） | **24 ～ 74** | 各自正确 |
| **22 篇文章 ×2 语言 + /discover/topic/* + /about + /privacy + /terms** | **898（首页副本）** | **`/`** |

补充事实：

- 任意不存在的 URL（如 `/this-page-does-not-exist-12345`）返回 **HTTP 200 + 首页 HTML**。
  软 404，等于对外声明「本站有无限多个内容相同的页面」。
- `/about` `/privacy` `/terms` 三个页面直接抓取拿到的是首页。AdSense 明确要求站点具备
  可访问的隐私政策；抓取层面它等于不存在。
- 文章正文在 API 里是完好的（`/api/discover/articles/china-county-coffee` 返回 2529
  中文字符、9 个 `<h2>`、引用了美团《2024县城咖啡新业态报告》数据）。内容是资产，
  只是没有出口。
- `adsbygoogle.js` 已挂在每个页面 head 里，包括正文 24 字符的 `/fish`。
  「在无内容页面上投放广告」本身是一条独立的拒审理由。

## 三、根因链（每一环都不报错）

1. `npm run build`（根 package.json）先跑 `vite build`，**清空 `client/dist/`** ——
   22 篇文章的静态目录随之消失。
2. 接着跑 `server && npm run ssg` → `server/src/ssg.ts` 只调用
   `generateStaticPages()`。这个函数（`ssgService.ts:359`）只生成首页和 `seo_pages`
   表里登记的路由，**从不重建文章页和专题页**。
3. 文章页只由 `generateArticlePage()` 生成，而它**唯一的调用方**是后台发布接口
   （`api/discover.ts:390` / `:425`）。没人点「重新生成」，文件就永远不回来。
4. 数据库里 `discover_articles.static_generated_at` 仍是 `2026-07-28`，
   后台照旧显示「已生成」。而线上首页 `index.html` 的 `Last-Modified` 是
   **2026-08-13** —— 8 月 13 号那次构建把文章页全清了，后台没有任何提示。
5. 生产环境 nginx 直接托管 `client/dist` 并用 `try_files … /index.html` 兜底
   （证据：`/discover` 返回 nginx 的 **301** 目录跳转，Express 不会产生这个跳转）。
   所以 `app.ts:266` 里那段 `renderDynamicPageHtml()` 动态兜底 —— 本来能救回文章页 ——
   **在生产环境是死代码，一次都没执行过**。
6. 兜底给出的是根 `index.html`，里面硬编码 `canonical=https://qiaonx.com/`；
   而客户端从头到尾没有一处改写 canonical（`client/src/lib/useSeo.ts` 只改
   title/description/og，`ArticleView.vue` 只改 `document.title`）。
   于是 53 个 URL 全部向首页归并，22 篇文章一篇都不会进索引。

## 三点五、已确认的前提

- **变现主体是内容站**：广告收入靠 `/discover` 的文章页，工具是内容的转化出口。
  所以下面 P1/P2 按「把内容做成能吃搜索流量的资产」来排，工具页的免登录介绍页
  （P0 第 8、9 条）目的仅是让审核员能评估站点价值，不是流量主力。
- **nginx 可改**：P0 第 3、4 条按原方案落地，Express 的动态兜底会成为真正的安全网。
- **7 个笔名是同一个人**：按 P1 第 2 条并成一个并建作者页。

## 四、修复路线

### P0 · 恢复可见性（先做这一组，不要碰任何内容）

每条都给了验收命令，跑完能自己确认，不用等 Google。

1. **`npm run ssg` 必须重建全部文章页和专题页。**
   在 `server/src/ssg.ts` 里遍历 `discover_articles` / `discover_topics`（status =
   published）调 `generateArticlePage` / `generateTopicPage`，任何一篇失败就
   `process.exit(1)`。**关键**：不能只在 DB 里置 `static_generated_at` 就算成功 ——
   现在这个字段就是在撒谎，判成功的唯一依据是 `fs.existsSync` 检出文件真的落了盘。
   验收：`ls client/dist/discover/ | wc -l` ≥ 22。

2. **canonical 必须在客户端改写。**
   `useSeo.ts` 增加 `setCanonical()`；`ArticleView.vue` / `TopicView.vue` 在设置
   `document.title` 的同一处写入自己的 canonical。这是唯一能兜住「静态文件又丢一次」
   的防线。
   验收：浏览器控制台 `document.querySelector('link[rel=canonical]').href`
   在文章页上等于文章自己的 URL。

3. **nginx 兜底改成回落到 Express，而不是回落到 `index.html`。**
   把 `try_files $uri $uri/ /index.html;` 改成 `try_files $uri $uri/ @app;`，
   `@app` proxy_pass 到 Node。这样 `renderDynamicPageHtml()` 才真正成为安全网 ——
   静态文件再丢一次，文章页仍然出得来。

4. **404 要返回 404。** `app.ts` 的 `app.get('*')` 兜底分支应对未知路径返回
   `res.status(404)`，NotFound.vue 照常渲染。软 404 是「大量重复低质页面」的直接来源。

5. **`/about` `/privacy` `/terms` 必须有真正的预渲染正文。**
   登记进 `seo_pages`，并让 SSG 输出各自的静态页。隐私政策要写清 Cookie、
   第三方广告（Google 及其合作方）、数据收集与联系方式 —— 这是 AdSense 的硬性门槛。

6. **`http://file.qiaonan.vip` 全部换成 `https://`。**
   该主机已支持 https（实测 200），但库里存的封面和正文内图都是 http，
   在 https 页面上属于混合内容。需要一支迁移把 `discover_article_contents.content`、
   `discover_articles.cover_image`、`home_*` 里的图片 URL 一并洗掉。

7. **sitemap 剔掉 `/synap`。** robots.txt 里 `Disallow: /synap/`，sitemap 里却提交
   `/synap` 和 `/en/synap`，自相矛盾。同时把 `/fish` `/board` `/ui-review`
   （正文 24～74 字符）从 sitemap 移除，直到第 8 条做完 —— 现在提交它们等于主动
   把「空页面」送去评估。

8. **给 4 个工具页各写 300～600 字预渲染介绍。**
   `/fish` `/board` `/ui-review` 现在对爬虫是空白画布。每页需要：这是什么、
   解决什么问题、怎么用（3 步）、常见问题 2～3 条。这些字要进 SSG 的静态 HTML，
   不能只在 Vue 组件里。

9. **登录墙要留一个可评估的出口。** `/xhs` `/feishu` `/tender/browse` 全部
   `requiresAuth`，审核员看不到任何东西。至少给「爆款诊断」和「标讯推荐」各做一个
   免登录的功能介绍页（截图 + 输入输出示例 + 定价/额度说明）。

**P0 做完就去申请复审。** 单是 1、2、5 三条落地，Google 可索引的实质内容会从
1 页变成 24 页、从 898 字符变成约 5 万字符。这一步本身就可能直接过审。

### P1 · 内容收敛（复审期间做，2～3 天）

现在的 22 篇分成三堆互不相干的东西：AI 使用方法（4 篇）、宁波本地人文（5 篇：
天一阁 ×2、东钱湖、南塘老街、象山）、时事评论（13 篇：世界杯 ×2、苹果泄露、
新能源、特朗普账户、香港饮料、韩澳福利、县城咖啡、长安深圳、广州攻略、脆皮中年……）。
一个 AI 工具站上挂着 13 篇随机时事评论，配 7 个不同笔名，这是内容农场的标准画像。

1. **收成三个专题，22 篇全部归位，一篇不删。**
   （既然是内容站为主，内容量本身是资产，删就是自断流量）
   - **「AI 用得好的人在想什么」**（4 篇）：`ai-leverage-bushi-mofa`、
     `ordinary-people-ai-amplify-ability`、`ai-children-questioning-skill`、
     `ai-children-emotion-outsourcing`、`ai-homework-companion-rules`。
     这一簇同时是工具的转化入口，优先扩。
   - **「从长安到深圳：发现真实的中国」**（已有 topic）：宁波那 5 篇 + 长安深圳 +
     广州攻略 + 象山。搜索竞争小、意图明确、有在地信息优势 —— 这是最可能先吃到
     自然流量的一簇。
   - **「数据看时事」**（新建）：剩下的世界杯 ×2、苹果、新能源 ×2、特朗普账户、
     香港饮料、韩澳福利、县城咖啡、脆皮中年。这一簇必须补出处，见下条。
   现在 22 篇文章的**外链数全部是 0** —— 引用了美团《2024县城咖啡新业态报告》、
   OECD、ILO 数据却不给一个出处链接。这是 E-E-A-T 上最容易补、收益最直接的一项，
   尤其对「数据看时事」这一簇：无出处的时事评论正是「无原创价值内容」的典型画像。
   每篇文末加「资料来源」区块，链到原始报告/官方页面。

2. **署名并成 1～2 个，并建作者页。**（已确认 7 个笔名都是同一个人）

   现状分布：周野 9 篇、毕文成 4 篇、小智 2 篇、智成 2 篇、乔南 2 篇、
   阳聪哥 1 篇、极客公园 1 篇，另有 1 篇 **`ai-homework-companion-rules` 作者字段为空**
   （前台不出署名）。

   处置：
   - **`apple-supply-chain-leak-negotiation-leverage` 的署名「极客公园」立刻改掉。**
     极客公园是真实存在的科技媒体品牌，拿它当作者名是冒名风险，与 AdSense 无关也该改。
   - 全部并到 **「周野」** 一个笔名（已占 9 篇，人物感最强，且宁波本地那一簇全在它名下），
     空作者那篇一并补上。同一个人用 7 个笔名，在只有 22 篇的站上是「批量生成内容」的
     强信号；并成一个反而立刻有了连续的创作者形象。
   - 建 `/author/zhouye` 页：是谁、常写什么、凭什么写这些（宁波在地经验 + AI 工具实践者）。
     这一页要进 SSG 静态输出，并从每篇文章的署名链过去 —— 否则等于没建。

3. **英文站要么做对，要么下线。**
   `/en/*` 目前是逐篇机翻的平行版本，把可索引 URL 数量翻倍却不带来新价值，
   在「内容重复/低价值」这条上是负分。建议先给全部 `/en/*` 加
   `noindex`（保留给人看），等中文站过审、有稳定流量后再决定是否重做。

### P2 · 拿流量（过审后 4～8 周）

过审只是及格线，没流量的账号赚不到钱。内容站为主，所以按「哪一簇最快吃到搜索」排：

1. **先把宁波本地簇做深 —— 这是最快见效的一块。**
   天一阁 / 东钱湖 / 南塘老街 / 象山这 4 篇的文章质量已经够，缺的是**实用信息层**：
   怎么去、几点开门、门票多少、附近吃什么、避开哪个时段。
   「天一阁怎么去」这类词竞争极小、意图极明确，而全国性话题（世界杯、新能源）
   你在前 50 名里都排不进去。**本地 + 实用 = 唯一能在没有外链、没有域名权重的
   情况下拿到自然流量的路径。**
2. **围绕产品做关键词，作为转化层。**
   小红书爆款诊断 → 「小红书标题怎么写」「小红书笔记没流量原因」「小红书爆款公式」；
   标讯推荐 → 「招标信息怎么筛」「政府采购公告在哪看」。
   这类词有明确商业意图，文章末尾直接接工具入口 —— 内容吃流量、工具接转化。
3. **用自己的产品做分发。** 站上就有小红书写作台。每篇长文拆 3 条小红书笔记，
   自己的工具跑一遍，既是分发也是产品案例（顺便验证工具是否真的好用）。
4. **提交 Bing 和百度收录**，别只等 Google。中文内容在 Bing 上起量常比 Google 快。
5. **节奏：每周 2 篇，只在三个专题里写，其中至少 1 篇是「本地 + 实用」。**
   宁缺勿滥 —— 现在最不缺的就是话题分散，最缺的是同一个主题下的纵深。
6. **AdSense 广告位先别铺满。** 过审后正文页放 2～3 个位就够；
   一个日均几十 UV 的站铺 6 个广告位，收入不会变多，但「广告多于内容」是复审
   被回退的常见原因。等 UV 上到三位数再加。

## 五、复审前逐项自检

提交前把这些跑一遍，全绿再点：

```bash
# 1. 22 篇文章各自返回自己的 canonical，不是首页
for u in $(curl -s https://qiaonx.com/sitemap.xml | grep -o '<loc>[^<]*' | sed 's/<loc>//'); do
  echo "$u $(curl -s -A Googlebot "$u" | grep -o 'rel="canonical" href="[^"]*"')"
done | grep 'canonical="https://qiaonx.com/"$'   # 期望：无输出

# 2. 不存在的路径返回 404
curl -sI https://qiaonx.com/nope-12345 | head -1   # 期望：404

# 3. 隐私政策抓取层面存在
curl -s -A Googlebot https://qiaonx.com/privacy | grep -c '隐私'   # 期望：> 0

# 4. 无 http:// 图片
curl -s https://qiaonx.com/ | grep -c 'src="http://'   # 期望：0
```

人工确认：Search Console「网页」报告里已收录数 ≥ 20；随机点 3 篇文章看有无出处链接；
「极客公园」这个署名已经不存在。

## 六、上线后必须保持的两条

- **`npm run build` 之后必须验证 `client/dist/discover/` 的目录数等于已发布文章数。**
  忘了这一步，站点会在没有任何报错的情况下退回到今天这个状态 ——
  后台仍然显示「已生成」，浏览器里仍然一切正常，只有 Google 那边悄悄归零。
- **`static_generated_at` 不能当作「文件存在」的依据。** 它只记录「调用过生成」，
  文件被 vite 清掉时它不会变。判定是否需要重建，唯一可信的依据是文件系统。
