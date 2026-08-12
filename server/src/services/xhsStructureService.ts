// 新版 AI 辅助写作流程的 prompt 构建 + 数据存取。
// 主旨：人负责洞察/提问/判断，AI 负责结构化/验证/润色。
//
// 流程：引导式五栏 brief → AI 定主题+搭结构（MindNode[]）→ 用户在思维导图上增删改/选中对话
//       → AI 校验（论据够不够/跑题）→ 按结构成文 → 选中片段修改 → 禁用词扫描高亮。
//
// 底层 skill（xhs-structure slot）管思维方法；用户风格 skill 管文字风格；
// 成文阶段两者都进 prompt，风格冲突时以用户 skill 为准。禁用库以「声明」进 prompt + 成文后扫描兜底。

import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../db/index.js';

// ---------- 思维导图节点 ----------

/** 思维导图节点类型。theme=主题/核心判断（唯一树根），point=论点，evidence=论据，detail=细节。 */
export type MindNodeType = 'theme' | 'point' | 'evidence' | 'detail';

/** 可编辑思维导图的一个节点。id 稳定，AI 局部更新靠它，绝不重画整棵树。 */
export interface MindNode {
  id: string;
  parentId: string | null;
  type: MindNodeType;
  text: string;
  order: number;
}

/** 引导式输入的五栏。逼作者交出洞察，避免"素材薄只能写空话"。 */
export interface WriterBrief {
  topic?: string;      // 主题方向
  judgment?: string;   // 核心观点 / 反常识判断
  materials?: string;  // 手上的真实素材、细节、数字
  audience?: string;   // 写给谁看
  goal?: string;       // 想要的效果
}

function briefBlock(brief: WriterBrief): string {
  const lines: string[] = [];
  if (brief.topic) lines.push(`主题方向：${brief.topic}`);
  if (brief.judgment) lines.push(`核心观点/反常识判断：${brief.judgment}`);
  if (brief.materials) lines.push(`手上的真实素材/细节：${brief.materials}`);
  if (brief.audience) lines.push(`写给谁看：${brief.audience}`);
  if (brief.goal) lines.push(`想要的效果：${brief.goal}`);
  return lines.join('\n') || '(作者未填写，请通过提问补齐)';
}

function baseBlock(baseSkill?: string | null): string {
  return baseSkill ? `\n\n## 结构化写作方法（平台底座，必守）\n${baseSkill}` : '';
}

function blocklistBlock(blocklist?: string[]): string {
  if (!blocklist || !blocklist.length) return '';
  return `\n\n## 作者的禁用表达库（务必回避，这些是他明确不喜欢的词/说法，别用、也别用它们的近义变体）\n${blocklist.map((t) => `- ${t}`).join('\n')}`;
}

// ---------- Prompt 构建 ----------

/**
 * 定主题 + 搭结构：把五栏 brief 收敛成一个锋利的核心判断，并搭出撑得住的结构树。
 * 信息不足时不要瞎编，而是用「选项+兜底输入」式提问（Claude 风格，一次问一组）。
 */
export function buildStructurePrompt(brief: WriterBrief, baseSkill?: string | null): string {
  return `你是一个资深内容主编。作者给了你下面的原料，你要帮他把模糊想法理成一棵撑得住的文章结构树。你不替他写文章，也不编造他没提供的真实细节。
${baseBlock(baseSkill)}

## 作者提供的原料
${briefBlock(brief)}

## 你的任务
1. 先收敛出**一个锋利、有立场、能一句话说清的核心判断**（不是"关于XX的分享"这种大而空的题目）。
2. 围绕它搭一棵结构树：一个 theme（核心判断）→ 若干 point（论点，2-5 个）→ 每个 point 下至少一条 evidence（论据，优先用作者给的真实素材；缺素材的地方用 detail 标注"这里需要作者补一个真实例子"，不要编）。
3. 如果原料不足以定出好主题或搭出结构（比如作者没给素材、方向太宽），**不要硬编**，而是提问补齐。

## 输出格式（极其重要，务必严格遵守）
你的回复**必须是且只能是一个 JSON 对象**：不要 markdown 代码块（不要 \`\`\`），不要任何解释文字，不要输出下面的示例，第一个字符就是 {、最后一个字符就是 }。

两种情况二选一：
- 需要向作者提问补齐信息时，形如：{"needsInput":true,"questions":[{"q":"问题文本","options":["选项1","选项2","选项3"]}]}（每个问题 2-4 个具体选项，最多问 4 个）
- 信息足够、直接给结构时，形如：{"needsInput":false,"nodes":[{"id":"n1","parentId":null,"type":"theme","text":"核心判断","order":0},{"id":"n2","parentId":"n1","type":"point","text":"论点","order":0}]}

约束：id 用 n1/n2 这类短稳定串；theme 只有一个且 parentId 为 null；type 只能是 theme/point/evidence/detail；order 是同层排序（从 0 起）。`;
}

/**
 * 选中节点 + 用户消息 → 只针对这个节点返回局部 patch（补充子节点/改写本节点/拆分）。
 * 前端按 id 合并，保护用户手改过的其它节点。
 */
export function buildNodeChatPrompt(
  node: MindNode,
  allNodes: MindNode[],
  message: string,
  baseSkill?: string | null
): string {
  return `你是一个资深内容主编，正在和作者一起打磨文章结构里的某一个节点。你只动这个节点及其子节点，别碰别的。
${baseBlock(baseSkill)}

## 当前完整结构（供你理解上下文，不要整体重画）
${JSON.stringify(allNodes)}

## 作者选中的节点
${JSON.stringify(node)}

## 作者的诉求
${message}

## 你的任务
根据作者诉求，对**这一个节点**做处理：改写它的 text、或给它补几个子节点（论据/细节）、或建议拆分。只返回受影响的节点，不要返回整棵树。别编造作者没提供的真实事实——缺就用 detail 标注"需要作者补"。

## 输出格式（务必严格遵守）
只返回一个 JSON 对象：不要 markdown 代码块、不要解释、不要输出示例，第一个字符是 {、最后一个字符是 }。
形如：{"reply":"一句话说明你做了什么","updateNode":{"id":"被选中节点id","text":"改写后的文本，不改就照原样"},"addNodes":[{"id":"tmp-1","parentId":"父节点id","type":"evidence","text":"...","order":0}]}
updateNode 和 addNodes 都可为空（不需要就设为 null 或空数组）。`;
}

/**
 * 校验结构：当挑剔的主编，不打分，只输出具体可执行的问题清单（空论点/跑题/逻辑断/该补细节处）。
 */
export function buildValidatePrompt(nodes: MindNode[], baseSkill?: string | null): string {
  return `你是一个极挑剔的资深主编，正在审一篇文章的结构树。你不打分（分数是伪精确），只挑出具体、可执行的结构问题。
${baseBlock(baseSkill)}

## 待审结构
${JSON.stringify(nodes)}

## 审查清单（逐条查）
- 哪个 point 没有 evidence 撑着（空论点）？
- 哪个 point 其实没在为 theme 服务（跑题）？
- 哪里逻辑断了、哪里重复了？
- 哪里最该补一个真实细节/例子才有说服力（说明补什么方向）？

## 输出格式（务必严格遵守）
只返回一个 JSON 对象：不要 markdown 代码块、不要解释、不要输出示例，第一个字符是 {、最后一个字符是 }。
形如：{"ok":true,"issues":[{"nodeId":"相关节点id，没有就填 null","problem":"具体问题","fix":"怎么改的建议"}]}
结构确实扎实时给 ok:true、issues 为空数组，别为凑数硬挑。`;
}

/**
 * 按确认后的结构树成文。底层方法 skill + 用户风格 skill + 禁用库一起进 prompt。
 * 用户风格 skill 冲突时优先。这是"结构→正文"，不是无中生有的泛写。
 */
export function buildWriteFromStructurePrompt(
  nodes: MindNode[],
  opts: {
    baseSkill?: string | null;      // xhs-structure：思维方法
    styleSkill?: string | null;     // 用户风格 skill：文字风格（冲突时优先）
    persona?: string;
    niche?: string;
    blocklist?: string[];
  } = {}
): string {
  const parts: string[] = [
    `你是一个真实的小红书创作者（不是 AI 助手）。作者已经和你一起确认了下面这棵文章结构树，现在你要严格按这个结构把整篇写出来。
产出要求：
- 直接输出成品笔记（标题 + 正文），不要解释、不要"以下是"。标题单独一行放最前面。
- **严格按结构树来**：theme 是全文核心判断，每个 point 是一段的骨架，evidence/detail 是这段要用的真实素材。别加结构树里没有的新论点，别漏掉任何一个 point。
- 优先用结构里已有的真实素材（数字、场景、对话、细节），照实展开成流畅的段落，不要用通用空话填充。
- **遇到占位提示**——比如"这里需要作者补一个…""这里需要你补…"，或形如【…】的括注、以及内容为空的 evidence/detail——**绝不要把这些占位文字原样写进正文**。要按当前 point 的语境，自己补写一个具体、可信、贴合作者人设与赛道的例子/场景/清单，把这一段自然写完整，让读者读不出这里曾经是空的。
- 补写的内容要具体、落地、口语，像真人随手举的例子，别写成"以某某为例"式的空泛模板。`,
  ];
  parts.push(`## 已确认的文章结构树\n${JSON.stringify(nodes)}`);
  if (opts.persona) parts.push(`## 作者人设（全程用这个人的口吻和立场）\n${opts.persona}`);
  if (opts.niche) parts.push(`## 赛道/目标人群（贴合这群人）\n${opts.niche}`);
  // 底座在前、风格在后：方法打底，用户风格覆盖个性，冲突以风格为准。
  if (opts.baseSkill) parts.push(`## 结构化写作方法（平台底座）\n${opts.baseSkill}`);
  if (opts.styleSkill) parts.push(`## 作者的写作风格规范（在方法之上，风格冲突时以本节为准）\n${opts.styleSkill}`);
  const bl = blocklistBlock(opts.blocklist);
  if (bl) parts.push(bl.trim());
  return parts.join('\n\n');
}

/**
 * 全文改写：整篇正文 + 诉求（+ 一个风格 skill）→ 重写后的整篇正文。
 *
 * 和 buildRevisePrompt 的区别不只是范围：这个是**流式**的，所以输出必须是纯正文，
 * 不能包 JSON（流式下 JSON 只有收完才能解析，等于白费流式）。也因此**不要标题** ——
 * 标题在编辑器里是单独一个输入框，混进流里前端就得猜第一行是不是标题，猜错的表现是
 * 标题被塞进正文第一段、而原标题还在框里，看着像"AI 多写了一句"。
 */
export function buildRewritePrompt(
  fullBody: string,
  message: string,
  opts: { styleSkill?: string | null; persona?: string; niche?: string; blocklist?: string[] } = {}
): string {
  const parts: string[] = [
    `你是一个文字功底极强的资深写作者，正在帮作者重写一篇小红书笔记的**整篇正文**。
产出要求：
- 直接输出重写后的正文全文，不要解释、不要"以下是"、不要 markdown 代码块、**不要写标题**。
- 段落之间用空行分隔，保持原文的段落节奏。
- **不许编造作者没提供的事实**（数字、案例、对话都不能新造）。原文里的真实素材要全部保留下来，只改表达。
- 论点、结论、立场不许换，篇幅不要明显缩水 —— 作者要的是同一篇文章的另一种写法。`,
  ];
  parts.push(`## 原文（要重写的就是这篇）\n${fullBody}`);
  parts.push(`## 作者的诉求\n${message}`);
  if (opts.persona) parts.push(`## 作者人设\n${opts.persona}`);
  if (opts.niche) parts.push(`## 赛道/人群\n${opts.niche}`);
  if (opts.styleSkill) parts.push(`## 作者的写作风格规范（冲突以本节为准）\n${opts.styleSkill}`);
  const bl = blocklistBlock(opts.blocklist);
  if (bl) parts.push(bl.trim());
  return parts.join('\n\n');
}

/**
 * 选中正文片段 + 用户消息 → 给这段的修改建议（成文阶段的"选中→对话→采纳"）。
 * 只改选中片段，返回可直接替换的新文本。
 */
export function buildRevisePrompt(
  fullBody: string,
  selection: string,
  message: string,
  opts: { styleSkill?: string | null; persona?: string; niche?: string; blocklist?: string[] } = {}
): string {
  const parts: string[] = [
    `你是一个文字功底极强的资深写作者，正在帮作者修改一篇小红书笔记里他选中的一段。你只改这一段，保持它和全文的衔接，别动别的地方。`,
  ];
  parts.push(`## 全文（供你理解上下文）\n${fullBody}`);
  parts.push(`## 作者选中的片段（你只改这段）\n${selection}`);
  parts.push(`## 作者的诉求\n${message}`);
  if (opts.persona) parts.push(`## 作者人设\n${opts.persona}`);
  if (opts.niche) parts.push(`## 赛道/人群\n${opts.niche}`);
  if (opts.styleSkill) parts.push(`## 作者的写作风格规范（冲突以本节为准）\n${opts.styleSkill}`);
  const bl = blocklistBlock(opts.blocklist);
  if (bl) parts.push(bl.trim());
  parts.push(`## 输出格式（只返回合法 JSON，不要 markdown 代码块）
{ "reply": "<一句话说明你改了什么>", "revised": "<改写后的片段，可直接替换原片段>" }
别编造作者没提供的事实；保持原意和口吻，只按诉求调整。`);
  return parts.join('\n\n');
}

/**
 * ① 头脑风暴发散：基于选题抛一批"角度各异、带反常识点"的观点初稿，帮作者跳出烂大街说法。
 * 抛的是初稿供作者挑/改，不是替作者下定论。
 */
export function buildBrainstormPrompt(brief: WriterBrief, baseSkill?: string | null): string {
  return `你是一个擅长逼出独特角度的选题教练。作者要写一篇小红书笔记，下面是他目前的想法。请就这个选题，抛出 6-8 个**角度互不重复**的切入观点，帮他跳出人人都在说的那套。

## 作者的想法
${briefBlock(brief)}${baseBlock(baseSkill)}

要求：
- 每个观点是一句话的、有立场、可能引发讨论的判断，不要中庸的正确废话。
- **刻意避开这个选题最烂大街、最容易想到的那几个说法**，往反常识、被忽略的侧面、具体人群的真实处境上找。
- 每个观点附一句"为什么它不一样"——点出它的反常识点或独特切入。
- 这是供作者挑选和改写的初稿，不是定论；不要编造具体的数字、案例当事实。

## 输出格式（只返回合法 JSON，不要 markdown 代码块）
{ "ideas": [ { "point": "<一句话观点>", "why": "<为什么这个角度不一样>" } ] }`;
}

/**
 * ① AI 调研用户 / 用户洞察：产出受众角色/痛点/盲区/渴望/问题+方案，作为写作素材脚手架。
 * ⚠️ 这些是 AI 基于常识的**假设**，非真实用户数据——prompt 里明确要求作者核实，前端也会标「待核实」。
 */
export function buildResearchPrompt(brief: WriterBrief, baseSkill?: string | null): string {
  return `你现在是「用户洞察专家」，请基于下面信息生成深度用户洞察，输出可直接用于写文案的素材，每条都用完整一句话描述，流畅自然、场景化、真实可感，无需二次整理：

## 选题信息
${briefBlock(brief)}${baseBlock(baseSkill)}

1) 生成 2 个受众角色，每个用一句话描述典型场景和当前困境（姓名可选）。
2) 列出 3 个具体痛点，按触发优先级排序，每个痛点用 1-2 个场景化例子描述，并附用户内心独白或情绪感，同时给出对应短句勾子（≤15 字）。
3) 列出 3 个认知盲区，每条用反常识短句加一行解释，让人产生认知升级或"哇"感。
4) 列出 3 个最迫切的渴望，用一句话描绘用户希望实现的结果、状态或生活方式，从现实目标到可视化生活场景。
5) 列出 5 个急需解决的问题和对应解决方案，每条问题用用户可能提出的具体疑问或困惑来描述，每条解决方案都要给出可操作的方法或经验，用场景化、易理解的语言呈现。

重要：以上都是你基于常识对目标用户的**假设**，不是真实用户调研数据。作者需要据此核对、替换成真实的用户与痛点，别把它当既定事实。

## 输出格式（只返回合法 JSON，不要 markdown 代码块）
{
  "personas": [ "<一句话角色描述>" ],
  "painPoints": [ { "desc": "<痛点+场景化例子+内心独白>", "hook": "<≤15字勾子>" } ],
  "blindSpots": [ { "claim": "<反常识短句>", "explain": "<一行解释>" } ],
  "desires": [ "<一句话渴望>" ],
  "problems": [ { "question": "<用户会问的具体疑问>", "solution": "<可操作的方法/经验>" } ]
}`;
}

/**
 * ③ AI 通读诊断：对成稿做六维度体检，只给诊断建议、**不改稿**（把判断权留给作者）。
 */
export function buildDiagnosePrompt(fullText: string, baseSkill?: string | null): string {
  return `你是一个资深小红书内容编辑，正在帮作者体检一篇已经写好的笔记。请只做**分析和建议，不要直接改写正文**，把修改的判断权留给作者。

## 待诊断的笔记全文
${fullText}${baseBlock(baseSkill)}

请从以下六个维度逐一诊断，每个维度给出具体、可落地的建议（指名道姓地说哪里、怎么改），没有问题的维度就如实说"这块没大问题"：
1. 逻辑检查：内容逻辑是否清晰？有没有跳跃或矛盾的地方？
2. 疑问预判：读者可能会有什么疑问？哪些地方需要补充解释？
3. 案例补强：哪些观点需要更多具体案例支撑？
4. 语言优化：哪些表达太书面化？怎么改得更口语化？
5. 冗余删减：哪些内容重复啰嗦，可以删掉？
6. 传播优化：标题、开头、结尾哪里可以更吸引人？

## 输出格式（只返回合法 JSON，不要 markdown 代码块）
{ "diagnostics": [ { "dimension": "逻辑检查", "finding": "<发现的问题，没问题就说没大问题>", "suggestion": "<具体怎么改的建议>" } ] }
diagnostics 必须按上面 1-6 的顺序、恰好 6 条。`;
}

// ---------- 禁用库 ----------

export type BlockKind = 'word' | 'phrase';

export interface BlockItem {
  id: string;
  user_id: string;
  term: string;
  kind: BlockKind;
  note: string;
  created_at: string;
}

export function listBlocklist(userId: string): BlockItem[] {
  const db = getDatabase();
  return db
    .prepare('SELECT * FROM xhs_blocklist WHERE user_id = ? ORDER BY created_at DESC')
    .all(userId) as BlockItem[];
}

export function addBlockItem(userId: string, term: string, kind: BlockKind, note = ''): BlockItem {
  const db = getDatabase();
  const id = uuidv4();
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO xhs_blocklist (id, user_id, term, kind, note, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, userId, term, kind, note, now);
  return { id, user_id: userId, term, kind, note, created_at: now };
}

export function updateBlockItem(
  userId: string,
  id: string,
  patch: { term?: string; kind?: BlockKind; note?: string }
): void {
  const db = getDatabase();
  const cur = db
    .prepare('SELECT * FROM xhs_blocklist WHERE id = ? AND user_id = ?')
    .get(id, userId) as BlockItem | undefined;
  if (!cur) return;
  db.prepare('UPDATE xhs_blocklist SET term = ?, kind = ?, note = ? WHERE id = ? AND user_id = ?').run(
    patch.term ?? cur.term,
    patch.kind ?? cur.kind,
    patch.note ?? cur.note,
    id,
    userId
  );
}

export function deleteBlockItem(userId: string, id: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM xhs_blocklist WHERE id = ? AND user_id = ?').run(id, userId);
}

/** 成文后扫描兜底：返回禁用词在正文里的所有命中位置，供前端高亮 + 一键换。 */
export function scanBlocklist(
  body: string,
  items: Array<{ term: string; kind: BlockKind }>
): Array<{ term: string; index: number; length: number }> {
  const hits: Array<{ term: string; index: number; length: number }> = [];
  for (const it of items) {
    const term = it.term.trim();
    if (!term) continue;
    // word 类做精确子串扫描；phrase 类语义化、无法精确匹配，只靠 prompt 声明，不在此扫描。
    if (it.kind !== 'word') continue;
    let from = 0;
    for (;;) {
      const idx = body.indexOf(term, from);
      if (idx === -1) break;
      hits.push({ term, index: idx, length: term.length });
      from = idx + term.length;
    }
  }
  return hits.sort((a, b) => a.index - b.index);
}

// ---------- 草稿 ----------

export interface DraftRow {
  id: string;
  user_id: string;
  title: string;
  brief_json: string;
  structure_json: string;
  body: string;
  stage: string;
  created_at: string;
  updated_at: string;
}

export function listDrafts(userId: string): Array<Omit<DraftRow, 'brief_json' | 'structure_json' | 'body'>> {
  const db = getDatabase();
  return db
    .prepare(
      'SELECT id, user_id, title, stage, created_at, updated_at FROM xhs_drafts WHERE user_id = ? ORDER BY updated_at DESC'
    )
    .all(userId) as Array<Omit<DraftRow, 'brief_json' | 'structure_json' | 'body'>>;
}

export function getDraft(userId: string, id: string): DraftRow | undefined {
  const db = getDatabase();
  return db.prepare('SELECT * FROM xhs_drafts WHERE id = ? AND user_id = ?').get(id, userId) as
    | DraftRow
    | undefined;
}

export function createDraft(
  userId: string,
  data: { title?: string; brief?: WriterBrief; nodes?: MindNode[]; body?: string; stage?: string }
): DraftRow {
  const db = getDatabase();
  const id = uuidv4();
  const now = new Date().toISOString();
  const row: DraftRow = {
    id,
    user_id: userId,
    title: data.title ?? '',
    brief_json: JSON.stringify(data.brief ?? {}),
    structure_json: JSON.stringify(data.nodes ?? []),
    body: data.body ?? '',
    stage: data.stage ?? 'brief',
    created_at: now,
    updated_at: now,
  };
  db.prepare(
    `INSERT INTO xhs_drafts (id, user_id, title, brief_json, structure_json, body, stage, created_at, updated_at)
     VALUES (@id, @user_id, @title, @brief_json, @structure_json, @body, @stage, @created_at, @updated_at)`
  ).run(row);
  return row;
}

export function updateDraft(
  userId: string,
  id: string,
  data: { title?: string; brief?: WriterBrief; nodes?: MindNode[]; body?: string; stage?: string }
): DraftRow | undefined {
  const db = getDatabase();
  const cur = getDraft(userId, id);
  if (!cur) return undefined;
  const now = new Date().toISOString();
  const next: DraftRow = {
    ...cur,
    title: data.title ?? cur.title,
    brief_json: data.brief !== undefined ? JSON.stringify(data.brief) : cur.brief_json,
    structure_json: data.nodes !== undefined ? JSON.stringify(data.nodes) : cur.structure_json,
    body: data.body ?? cur.body,
    stage: data.stage ?? cur.stage,
    updated_at: now,
  };
  db.prepare(
    `UPDATE xhs_drafts SET title=@title, brief_json=@brief_json, structure_json=@structure_json,
       body=@body, stage=@stage, updated_at=@updated_at WHERE id=@id AND user_id=@user_id`
  ).run(next);
  return next;
}

export function deleteDraft(userId: string, id: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM xhs_drafts WHERE id = ? AND user_id = ?').run(id, userId);
}
