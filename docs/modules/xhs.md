# 小红书写作台

> 平台级约定（协作方式 / 三条硬规则 / 架构与约定 / AI 网关与配额 / 对外中转接口 / 环境变量）
> 在 `CLAUDE.md`，这里只记本模块的坑，不重复。

- **风格下拉只出现在真的会把它传给接口的地方。** `SelectionChat` 的 `skills`/`skillId` 是可选 prop，结构
  阶段**故意不传**（`/structure/node-chat` 只吃 `xhs-structure` 底座，读不到 styleSkill）。摆一个没人读的下拉
  出来，用户换了风格、AI 照旧改法，返回的东西看着完全正常 —— 他只会以为这个 skill 没什么效果。浮层里选的
  风格存在 `reviseSkillId`，空值 = 跟随①，且**从不回写①的 `skillId`**：改一段用了别的风格不该悄悄换掉下次
  「重新成文」的风格。
- **全文改写走流式，所以必须自己接住两件事。** 一是**截断**：`streamToSSE` 在 `finish_reason === 'length'`
  时补一个 `{"truncated":true}` 事件，成文和改写两处都要提示 —— 结尾断在半句话上的稿子和写完的长得一模一样，
  用户会直接采纳/发布。二是**回滚**：改写结果先进预览等采纳（流式 `setContent` 会冲掉 TipTap 的撤销栈），
  采纳时把旧正文存进 `preRewriteBody` 供「↩ 撤销改写」还原，而**换稿/新建/重新成文时必须清掉它**，否则那个
  按钮会把上一篇的正文贴进这一篇，两边都不报错。
- **内置 skill 模板（`services/xhs/skillTemplates.ts`）只能是一个主文件。** `uws.assembleSkillBody` 把**没被
  `{{ref}}` 引用的引用文件也全部拼在末尾**，所以在这个平台上拆多文件不是懒加载，只是让人误以为省了 token。
  导入时 `setMainBody` 失败要把空壳 `deleteSkill` 掉：列表里留一个空 skill，用户选它去生成，出来的东西和没挂
  skill 一模一样，没有任何一处会报错。`GET /skills/templates` 必须注册在 `/skills/:id` **之前**（Express 按
  注册顺序匹配，否则回一句「模板不存在」，读起来像模板没了而不是路由写错了）。模板里那个出处字段叫 `origin`
  不叫 `source` —— `aiAppRegistry.test.ts` 全仓扫 `source: '…'` 字面量核 AI 应用白名单，占这个键名会让那个守卫
  报假失败。
- **吐 JSON 的那几个端点的 `max_tokens` 集中在 `api/xhs.ts:JSON_BUDGET` 一处给值**（背景见硬规则 2）。实测
  同一个 deepseek-v4-flash：revise 那次 `output_tokens=1501` 而 content 只有 57 字，consult 的 draft:audience
  是 11757 对 3024 字 —— 所以「发散观点」原来那 2000 经常在写出第一个 `}` 之前就顶格，而思维链短的那几次又
  正常出来了。
- **「拿不到 JSON」不能回 200 带空数组，必须 502。** `ideas: []` 在面板上显示的是「还没有结果，点上面「帮我
  发散观点」」（像没点过）、`nodes: []` 是一张空画布（像要自己从零搭）、`issues: []` + `validated=true` 直接
  就是「结构没问题，可以成文」、node-chat 三样全空显示「(AI 未提出修改)」（像 AI 看过觉得没问题）。自检那条
  判的是**形状**（`ok` 是不是 boolean / `issues` 是不是数组）而不是空不空 —— 「没有问题」本身是合法结果。
  `xhsBrainstorm.test.ts` 守发散那两条。

