// AI 配卡用的模版说明：每种卡什么时候用、每个字段按什么规则核。
// 卡片本身（组件、样式、测试数据）在前端 client/src/components/broll/templates.ts，**字段名必须和那边一致** ——
// 对不上的话 AI 填的字段前端不认，卡片照样放上去、那一栏是空的。
// 前端有、这里没有的模版不交给 AI（planService 会在 notes 里说出来，不悄悄不用）。

export type FieldRule =
  /** 本段字幕里出现的整个数（「300」不算出现在「3000」里） */
  | 'number'
  /** 同 number，且在 0–100 之间（占比） */
  | 'percent'
  /** 本段字幕里出现的单位（% 也认「百分之」） */
  | 'unit'
  /** 只许几个符号（「涨了」→ +） */
  | 'prefix'
  /** 摘自本段或前后各一句的原文 */
  | 'verbatim'
  /** 允许 AI 概括（标「AI 概括」给用户看），有字数上限 */
  | 'summary'
  /** 英文小标签：AI 概括，只许大写字母数字空格 */
  | 'label'
  | 'enum'
  /** 多条，每条都 verbatim */
  | 'list'
  /** 多条「名字 数值」：名字摘原话、数值是原话里出现的数（图表用） */
  | 'pairs';

export interface FieldSpec {
  key: string;
  rule: FieldRule;
  desc: string;
  optional?: boolean;
  /** summary 的字数上限 */
  maxLen?: number;
  options?: string[];
  minItems?: number;
  maxItems?: number;
  /** list 的每一条包成 { img: '', name } —— 前端图片组的 items 是这个形状，图片由用户自己上传 */
  asItems?: boolean;
  /** list 每一条核原话之前先去掉的前缀（聊天的「我：」、终端的「$ 」不是原话里的字） */
  stripPrefix?: RegExp;
}

export const CATEGORIES = ['数据', '文字强调', '列表结构', '章节节奏', '界面模拟'] as const;
export type Category = (typeof CATEGORIES)[number];

export interface TemplateSpec {
  id: string;
  /** 目录里的分组：第一步挑卡时 AI 只看「类别 → 卡名 + 什么时候用」，不看字段规则 */
  category: Category;
  name: string;
  when: string;
  fields: FieldSpec[];
  /** 可以跨几句字幕（清单、步骤这类：「三件事」后面连着三句） */
  multiLine?: boolean;
}

const label: FieldSpec = { key: 'label', rule: 'label', optional: true, desc: '英文小标签，2–3 个英文单词概括这张卡（如 GROWTH、COST DOWN、WHO IS STUCK），可留空' };

export const TEMPLATE_SPECS: TemplateSpec[] = [
  {
    id: 'number',
    category: '数据',
    name: '数字冲击',
    when: '这句话明确说出了一个阿拉伯数字，且这个数是观点重点（增长率、金额、人数、倍数）。序号、举例里顺带的数不要',
    fields: [
      label,
      { key: 'prefix', rule: 'prefix', optional: true, desc: '只能是 ""、"+"、"-"、"¥"、"$"、"约"、"超"、"近"；说「涨了」可以用 "+"' },
      { key: 'value', rule: 'number', desc: '原句里的那个数，阿拉伯数字原样照抄（「1,280」「3.5」）；原话是中文数字就换成阿拉伯数字（三百→300、一千二百八十→1280、三点五→3.5），不四舍五入' },
      { key: 'unit', rule: 'unit', optional: true, desc: '紧跟数字的单位，原样照抄（%、倍、万、人、元），「百分之四十」「四成」写 %，没有就留空' },
      { key: 'title', rule: 'verbatim', optional: true, desc: '说明，4–12 字，原话里连续的一段，不要再出现这个数字和单位' },
    ],
  },
  {
    id: 'compare',
    category: '数据',
    name: '对比条',
    // 两个数常常分在相邻两句字幕里（「我们涨了 300%」/「同行才 20%」）
    multiLine: true,
    when: '同一段话里拿两个数比大小（「同行 20%，我们 300%」）。两个数单位必须一样 ——「以前 3 天，现在 2 小时」这种不要',
    fields: [
      label,
      { key: 'title', rule: 'summary', maxLen: 10, optional: true, desc: '比的是什么，≤10 字，可概括' },
      { key: 'aName', rule: 'verbatim', desc: '第一项的名字，原话' },
      { key: 'aValue', rule: 'number', desc: '第一项的数，原样照抄' },
      { key: 'bName', rule: 'verbatim', desc: '第二项的名字，原话' },
      { key: 'bValue', rule: 'number', desc: '第二项的数，原样照抄' },
      { key: 'unit', rule: 'unit', optional: true, desc: '两个数共同的单位' },
      { key: 'highlight', rule: 'enum', options: ['a', 'b'], desc: '要突出哪一项（通常是「我们」那项），a 或 b' },
    ],
  },
  {
    id: 'ring',
    category: '数据',
    name: '占比环',
    when: '说了一个占比（「40% 的用户」「百分之四十」「四成」……）',
    fields: [
      label,
      { key: 'value', rule: 'percent', desc: '那个百分数，只写阿拉伯数字不写 %，0–100（百分之四十→40，四成→40）' },
      { key: 'title', rule: 'verbatim', desc: '这个比例说的是什么，原话（如「的用户会复购」）' },
      { key: 'sub', rule: 'verbatim', optional: true, desc: '补充一句，原话，可留空' },
    ],
  },
  {
    id: 'chapter',
    category: '章节节奏',
    name: '章节标题',
    when: '话题明显切换、开始讲一个新部分（「接下来说说……」「第二个问题是……」）。整条视频 2–5 张就够',
    fields: [
      label,
      { key: 'title', rule: 'summary', maxLen: 12, desc: '这一部分的标题，≤12 字，可概括' },
      { key: 'highlight', rule: 'summary', maxLen: 6, optional: true, desc: '标题里要高亮的那一段，必须是 title 里的连续几个字' },
    ],
  },
  {
    id: 'countbadge',
    category: '章节节奏',
    name: '开场承诺条数',
    when: '开场或一段开头，说接下来要讲几条（「今天分享三个方法」「这 5 个坑千万别踩」），数字是条数。整条视频最多 1–2 张；增长率、金额、人数这种数用数字冲击',
    fields: [
      label,
      { key: 'lead', rule: 'verbatim', optional: true, desc: '数字前面的字，原话（如「今天分享」），可留空' },
      { key: 'value', rule: 'number', desc: '条数，写成阿拉伯数字（三→3）' },
      { key: 'unit', rule: 'verbatim', desc: '数字后面的量词 + 名词，原话（如「个方法」「个坑」）' },
      { key: 'title', rule: 'summary', maxLen: 12, optional: true, desc: '第二行副标题，≤12 字，可概括，可留空' },
    ],
  },
  {
    id: 'titledemote',
    category: '章节节奏',
    name: '标题降格成标签',
    when: '教程 / 方法论里开始讲其中一点（「第一点……」「第二个方法是……」），这一点要讲好几句。和章节标题二选一：章节标题是整屏翻页，这张是标题缩进角落一直挂着',
    // 卡片停留 = 讲这一点的那几句，所以要跨句
    multiLine: true,
    fields: [
      label,
      { key: 'title', rule: 'summary', maxLen: 12, desc: '这一点的标题，≤12 字，可概括' },
    ],
  },
  {
    id: 'keyword',
    category: '文字强调',
    name: '关键词大字',
    when: '一句观点鲜明的金句、结论，适合把重点几个字放大',
    fields: [
      label,
      { key: 'lead', rule: 'verbatim', optional: true, desc: '引子，原话（如「提示词是改」），可留空' },
      { key: 'key', rule: 'verbatim', desc: '要放大的重点，原话，2–10 字（如「一版又一版」）' },
    ],
  },
  {
    id: 'altlines',
    category: '文字强调',
    name: '对句反色',
    multiLine: true,
    when: '两句结构对仗、意思反差的短句（「你以为在努力 / 其实在消耗」「慢 / 才是最快的路」），两句可能分在相邻两句字幕里。纠正误区用正误对比，只换一个词用删除线改写',
    fields: [
      label,
      { key: 'a', rule: 'verbatim', desc: '第一句，原话，2–12 字' },
      { key: 'b', rule: 'verbatim', desc: '第二句，原话，2–12 字' },
    ],
  },
  {
    id: 'slab',
    category: '文字强调',
    name: '斜切色块标题',
    when: '一句话能拆成「话题 + 很短的结论/口号」两截（「做内容，先做减法」「想涨粉，先学会讲故事」），结论像封面大字一样砸出来。整句都是重点、没有话题那一截的用关键词大字',
    fields: [
      { key: 'lead', rule: 'verbatim', optional: true, desc: '话题那一截，原话，可留空' },
      { key: 'key', rule: 'verbatim', desc: '结论/口号，原话，2–8 字' },
      { key: 'style', rule: 'enum', optional: true, options: ['punch', 'speed'], desc: 'punch = 中心撑开砸字（默认）；speed = 从左冲入带速度线，语气急、带「赶紧」「马上」意味时用' },
    ],
  },
  {
    id: 'turn',
    category: '章节节奏',
    name: '叙事转折',
    multiLine: true,
    when: '叙事里的大转折：先说一个大家以为的 / 过去的情况，紧接着用「但」「可是」「直到」翻过来（「多年以来大家都以为流量最重要 / 但真正留下来的是信任」）。动静大，一条视频最多一两次，只在整段论述的转折点用',
    fields: [
      { key: 'before', rule: 'verbatim', desc: '转折前那句，原话，≤18 字' },
      { key: 'after', rule: 'verbatim', desc: '转折后那句，原话（带上「但」「可是」），≤18 字' },
    ],
  },
  {
    id: 'collapse',
    category: '文字强调',
    name: '一句话坍缩成一个词',
    when: '一句话最后收束成一两个字的结论（「说白了就一个字：卷」「拼到最后拼的就是真诚」），那个词就在这句里',
    fields: [
      { key: 'sentence', rule: 'verbatim', desc: '那个词前面的整句，原话，≤20 字，不要再包含那个词' },
      { key: 'word', rule: 'verbatim', desc: '收束成的那个词，原话，1–4 字' },
    ],
  },
  {
    id: 'flywords',
    category: '章节节奏',
    name: '关键词穿越',
    multiLine: true,
    when: '一口气列了一大串名词（工具、环节、平台、概念 —— 至少 4 个），重点是「很多」而不是每一个的细节，适合做背景。要逐条讲清楚的用要点清单',
    fields: [
      { key: 'words', rule: 'list', minItems: 4, maxItems: 16, desc: '每个关键词，原话，每个 1–8 字' },
      { key: 'title', rule: 'summary', maxLen: 12, optional: true, desc: '压在中间的一行标题，≤12 字，可概括，可留空' },
    ],
  },
  {
    id: 'agenda',
    category: '章节节奏',
    name: '章节目录',
    multiLine: true,
    when: '开头报这期要讲哪几部分（「今天聊四件事：选题、开头、拍摄、复盘」），2–5 部分',
    fields: [
      label,
      { key: 'title', rule: 'summary', maxLen: 12, optional: true, desc: '目录的标题，≤12 字，可概括（如「今天聊四件事」）' },
      { key: 'items', rule: 'list', minItems: 2, maxItems: 5, desc: '每一部分，原话，每条 2–12 字' },
    ],
  },
  {
    id: 'flipcards',
    category: '数据',
    name: '功能卡翻面出数字',
    multiLine: true,
    when: '「做了 A，结果涨了多少；做了 B，结果涨了多少」—— 2–4 个动作各自带一个结果数字，单位相同',
    fields: [
      label,
      { key: 'title', rule: 'summary', maxLen: 12, optional: true, desc: '标题，≤12 字，可概括' },
      { key: 'rows', rule: 'pairs', minItems: 2, maxItems: 4, desc: '每一张写「动作 数值」，动作和数值都摘原话（中文数字换成阿拉伯数字）' },
      { key: 'prefix', rule: 'prefix', optional: true, desc: '只能是 ""、"+"、"-"、"约"、"超"、"近"；说「涨了」可以用 "+"' },
      { key: 'unit', rule: 'unit', optional: true, desc: '共同的单位，原话' },
    ],
  },
  {
    id: 'breakout',
    category: '数据',
    name: '增长爆框',
    multiLine: true,
    when: '前后几个数里**最后一个**比前面大得多（至少 1.5 倍，「去年才 3 万，今年 40 万」「涨到原来的十倍」），重点是「暴涨」。几个数差不多的用柱状图',
    fields: [
      label,
      { key: 'title', rule: 'summary', maxLen: 12, desc: '比的是什么，≤12 字，可概括' },
      { key: 'rows', rule: 'pairs', minItems: 2, maxItems: 6, desc: '按时间先后每一项写「名字 数值」，最后一项是最大的那个；名字和数值都摘原话（中文数字换成阿拉伯数字）' },
      { key: 'unit', rule: 'unit', optional: true, desc: '共同的单位，原话' },
    ],
  },
  {
    id: 'datestamp',
    category: '章节节奏',
    name: '时间地点戳',
    when: '讲故事起头交代时间 / 地点（「2019 年冬天，在深圳」「那是凌晨三点」）',
    fields: [
      { key: 'when', rule: 'verbatim', desc: '时间，原话照抄（不换算、不补年份）' },
      { key: 'where', rule: 'verbatim', optional: true, desc: '地点，原话，可留空' },
      { key: 'note', rule: 'verbatim', optional: true, desc: '紧跟着的一句交代（如「我刚辞职的第三天」），原话，可留空' },
    ],
  },
  {
    id: 'list',
    category: '列表结构',
    name: '要点清单',
    multiLine: true,
    when: '列了几点 / 几类 / 几个原因（「三件事：……」「有这几种人：……」），条目可能分布在后面几句字幕里',
    fields: [
      label,
      { key: 'title', rule: 'summary', maxLen: 12, desc: '清单的标题，≤12 字，可概括' },
      { key: 'items', rule: 'list', minItems: 2, maxItems: 5, desc: '每一条，原话，每条 2–10 字' },
      { key: 'conclusion', rule: 'verbatim', optional: true, desc: '如果最后有一句结论，原话；没有留空' },
    ],
  },
  {
    id: 'steps',
    category: '列表结构',
    name: '步骤流程',
    multiLine: true,
    when: '讲做事的先后顺序（「先……然后……最后……」「第一步……」），2–5 步',
    fields: [
      label,
      { key: 'title', rule: 'summary', maxLen: 10, optional: true, desc: '流程的名字，≤10 字，可概括' },
      { key: 'steps', rule: 'list', minItems: 2, maxItems: 5, desc: '每一步的名字，原话，每步 2–6 字' },
    ],
  },
  {
    id: 'rightwrong',
    category: '列表结构',
    name: '正误对比',
    multiLine: true,
    when: '纠正一个常见误区：先说错误做法，再说正确做法（「不是……而是……」「很多人……其实应该……」）',
    fields: [
      label,
      { key: 'title', rule: 'summary', maxLen: 10, optional: true, desc: '说的是哪件事，≤10 字，可概括' },
      { key: 'wrong', rule: 'verbatim', desc: '错误做法，原话' },
      { key: 'right', rule: 'verbatim', desc: '正确做法，原话' },
    ],
  },
  {
    id: 'question',
    category: '章节节奏',
    name: '提问卡',
    when: '抛出一个问题引出下文（「为什么……？」「你有没有想过……」）',
    fields: [
      label,
      { key: 'question', rule: 'summary', maxLen: 16, desc: '问题，≤16 字，可概括，带问号' },
      { key: 'hint', rule: 'verbatim', optional: true, desc: '紧接着给出的答案提示，原话，可留空' },
    ],
  },
  {
    id: 'term',
    category: '文字强调',
    name: '词语标注',
    when: '强调一个更准确的叫法 / 专有名词（「与其说是博主，不如说是内容创作者」）',
    fields: [
      { key: 'from', rule: 'verbatim', optional: true, desc: '普通说法，原话，可留空' },
      { key: 'to', rule: 'verbatim', desc: '要标注的那个词，原话' },
    ],
  },
  {
    id: 'imagegroup',
    category: '界面模拟',
    name: '图片组',
    multiLine: true,
    when: '列举了几个具体的产品 / 工具 / 品牌 / App / 平台的名字（「豆包、WorkBuddy、GPT 都能用」）。图片由用户上传，你只填名字',
    fields: [
      { key: 'kicker', rule: 'summary', maxLen: 12, optional: true, desc: '一行小字，≤12 字，可概括（如「同一卡库，换模型」）' },
      { key: 'title', rule: 'summary', maxLen: 10, desc: '大标题，≤10 字，可概括' },
      { key: 'items', rule: 'list', minItems: 2, maxItems: 5, asItems: true, desc: '每一个的名字，原话，原样照抄' },
    ],
  },
  {
    id: 'stamp',
    category: '文字强调',
    name: '印章',
    when: '一个要重重强调的短词 / 本片的主题标签 / 一句话的结论词（2–8 个字或一个英文词）。整条最多 2 张',
    fields: [
      { key: 'text', rule: 'verbatim', desc: '章上的字，原话，2–8 字' },
      { key: 'sub', rule: 'summary', maxLen: 6, optional: true, desc: '下面一行小字，≤6 字，可概括，可留空' },
    ],
  },
  {
    id: 'beforeafter',
    category: '数据',
    name: '前后变化',
    multiLine: true,
    when: '同一件事前后两个数的变化（「团队从 12 个人扩到了 86 个人」「成本从 3 天降到半天」）',
    fields: [
      label,
      { key: 'title', rule: 'summary', maxLen: 8, optional: true, desc: '变化的是什么，≤8 字，可概括' },
      { key: 'before', rule: 'number', desc: '以前的数，原话（中文数字换成阿拉伯数字）' },
      { key: 'after', rule: 'number', desc: '现在的数，原话（中文数字换成阿拉伯数字）' },
      { key: 'unit', rule: 'unit', optional: true, desc: '单位，原话' },
    ],
  },
  {
    id: 'ranking',
    category: '列表结构',
    name: '排行榜',
    multiLine: true,
    when: '明确给出了名次 / 排序（「第一是……第二是……」「最多的是 A，其次是 B」），2–5 名',
    fields: [
      label,
      { key: 'title', rule: 'summary', maxLen: 12, desc: '排的是什么，≤12 字，可概括' },
      { key: 'items', rule: 'list', minItems: 2, maxItems: 5, desc: '按名次从第 1 名往后排，每一项原话' },
    ],
  },
  {
    id: 'timeline',
    category: '列表结构',
    name: '时间线',
    multiLine: true,
    when: '按年份 / 时间点讲经历（「2019 年创立，2021 年融资……」），2–5 个时间点',
    fields: [
      label,
      { key: 'title', rule: 'summary', maxLen: 10, optional: true, desc: '这段经历的标题，≤10 字，可概括' },
      { key: 'events', rule: 'list', minItems: 2, maxItems: 5, desc: '每个节点写「年份 事件」，年份和事件都摘原话，中间空一格（如「2019年 创立公司」）' },
    ],
  },
  {
    id: 'quote',
    category: '文字强调',
    name: '引用卡',
    when: '引用了别人说过的话（「巴菲特说过……」「我导师有句话……」）',
    fields: [
      { key: 'quote', rule: 'verbatim', desc: '被引用的那句话，原话，≤40 字' },
      { key: 'source', rule: 'verbatim', optional: true, desc: '谁说的，原话里提到的名字；原话没说是谁就留空，不许猜' },
    ],
  },
  {
    id: 'define',
    category: '文字强调',
    name: '名词解释',
    multiLine: true,
    when: '说话人解释了一个专业名词 / 概念（「所谓 A-roll，就是……」）。说话人没解释的不要配，不许自己补定义',
    fields: [
      { key: 'term', rule: 'verbatim', desc: '那个名词，原话' },
      { key: 'en', rule: 'label', optional: true, desc: '英文名（如 COMPLETION RATE），可留空' },
      { key: 'definition', rule: 'verbatim', desc: '说话人自己的解释，原话，≤50 字' },
    ],
  },
  {
    id: 'pictogram',
    category: '数据',
    name: '象形图',
    when: '「每 10 个人里有 3 个」「100 个观众里有 37 个」这种几个里有几个的说法（总数 ≤ 100）',
    fields: [
      label,
      { key: 'title', rule: 'summary', maxLen: 10, optional: true, desc: '≤10 字，可概括（如「每 10 个观众」）' },
      { key: 'total', rule: 'number', desc: '总数，原话（≤100）' },
      { key: 'value', rule: 'number', desc: '其中几个，原话' },
      { key: 'caption', rule: 'verbatim', optional: true, desc: '这几个怎么了，原话（如「会看完」）' },
    ],
  },
  {
    id: 'bubbles',
    category: '列表结构',
    name: '气泡逐条',
    multiLine: true,
    when: '一连串的抱怨 / 吐槽 / 痛点 / 心声，像在聊天（2–4 句）',
    fields: [
      label,
      { key: 'items', rule: 'list', minItems: 2, maxItems: 4, desc: '每一条，原话' },
    ],
  },
  {
    id: 'slotcycle',
    category: '列表结构',
    name: '词槽轮换',
    // 「它能帮你写脚本、配动效、出字幕」常常一句说不完，后面几项在下一两句里
    multiLine: true,
    when: '同一个句式后面接了几个短的并列项（「它能帮你写脚本、配动效、出字幕」「不管是 A、B 还是 C」），每项 2–8 字。条目长、或各自是完整的一句话的用要点清单',
    fields: [
      label,
      { key: 'stem', rule: 'verbatim', optional: true, desc: '固定不动的句干，原话（如「它能帮你」），可留空' },
      { key: 'items', rule: 'list', minItems: 2, maxItems: 5, desc: '轮换的每一项，原话，每项 2–8 字' },
      { key: 'conclusion', rule: 'verbatim', optional: true, desc: '如果最后有一句收束（如「一个人搞定」），原话，≤8 字；没有留空' },
    ],
  },
  {
    id: 'choose',
    category: '列表结构',
    name: '五选一',
    multiLine: true,
    when: '从几个候选里挑出一个（「试了剪映、PR、达芬奇，最后留下的是剪映」「这几个里我选 B」），候选和选中的那个都在原话里',
    fields: [
      label,
      { key: 'title', rule: 'summary', maxLen: 10, optional: true, desc: '在选什么，≤10 字，可概括' },
      { key: 'options', rule: 'list', minItems: 2, maxItems: 6, desc: '每个候选，原话，每个 ≤8 字' },
      { key: 'pick', rule: 'verbatim', desc: '选中的那个，必须和 options 里的某一项一字不差' },
      { key: 'note', rule: 'verbatim', optional: true, desc: '选它的理由，原话，可留空' },
    ],
  },
  {
    id: 'converge',
    category: '列表结构',
    name: '多源汇聚',
    multiLine: true,
    when: '几样东西最后都落到同一个结果上（「选题、表达、节奏，最后都落到完播率」「三个渠道的流量都导进私域」），多对一。有先后传导的用因果链，相加相乘的用公式卡',
    fields: [
      label,
      { key: 'title', rule: 'summary', maxLen: 12, optional: true, desc: '≤12 字，可概括' },
      { key: 'sources', rule: 'list', minItems: 2, maxItems: 4, desc: '每个来源，原话，每个 ≤8 字' },
      { key: 'result', rule: 'verbatim', desc: '汇成的那个结果，原话' },
    ],
  },
  {
    id: 'search',
    category: '界面模拟',
    name: '搜索框',
    when: '说要去搜什么（「搜一下 xx」「去搜转场」「在搜索框里输入 xx」）',
    fields: [
      { key: 'hint', rule: 'summary', maxLen: 10, optional: true, desc: '上方一行小字，≤10 字，可概括（如「第一招 · 画面切换」）' },
      { key: 'query', rule: 'verbatim', desc: '搜索词 = 原话里「搜」后面的那个词（「画面切换搜转场」→「转场」），≤14 字' },
      { key: 'results', rule: 'list', minItems: 0, maxItems: 4, desc: '紧接着说出来的搜索结果 / 同类词，原话；原话没说就给空数组，不许编' },
    ],
  },
  {
    id: 'notify',
    category: '界面模拟',
    name: '手机通知',
    when: '讲到收到一条消息 / 通知 / 提醒（「突然收到一条消息说……」「后台提示……」）',
    fields: [
      { key: 'app', rule: 'verbatim', optional: true, desc: '哪个 App，原话里提到的才填，没提到留空' },
      { key: 'title', rule: 'verbatim', optional: true, desc: '发消息的人 / 标题，原话，可留空' },
      { key: 'body', rule: 'verbatim', desc: '消息内容，原话，≤40 字' },
    ],
  },
  {
    id: 'chat',
    category: '界面模拟',
    name: '聊天对话',
    multiLine: true,
    when: '复述了一段你来我往的对话（「客户问我……我说……他又说……」），2–5 条',
    fields: [
      { key: 'name', rule: 'verbatim', optional: true, desc: '对方是谁，原话里提到的（如「客户」）' },
      { key: 'messages', rule: 'list', minItems: 2, maxItems: 5, stripPrefix: /^(我|对方)\s*[:：]\s*/, desc: '每条消息一行，我说的以「我：」开头，对方说的直接写；内容摘原话' },
    ],
  },
  {
    id: 'terminal',
    category: '界面模拟',
    name: '终端',
    multiLine: true,
    when: '讲到输入命令 / 提示词 / 代码，以及它返回了什么（AI 工具、编程类口播）',
    fields: [
      { key: 'title', rule: 'label', optional: true, desc: '窗口标题（如 TERMINAL），可留空' },
      { key: 'lines', rule: 'list', minItems: 1, maxItems: 5, stripPrefix: /^\$\s*/, desc: '一行一条：输入的内容以「$ 」开头，返回的结果直接写；都摘原话' },
    ],
  },
  {
    id: 'click',
    category: '界面模拟',
    name: '点击按钮',
    when: '「点这里」「点一下 xx」「打开 xx 开关」这种操作指引',
    fields: [
      { key: 'button', rule: 'verbatim', desc: '按钮 / 开关上的字，原话，≤10 字' },
      { key: 'result', rule: 'verbatim', optional: true, desc: '点完之后的结果，原话，可留空' },
    ],
  },
  {
    id: 'barchart',
    category: '数据',
    name: '柱状图',
    multiLine: true,
    when: '一口气报了 3 个以上的数做比较（「抖音 120 万、视频号 45 万、小红书 30 万」）',
    fields: [
      label,
      { key: 'title', rule: 'summary', maxLen: 12, desc: '比的是什么，≤12 字，可概括' },
      { key: 'rows', rule: 'pairs', minItems: 3, maxItems: 6, desc: '每一项写「名字 数值」，名字和数值都摘原话（中文数字换成阿拉伯数字）' },
      { key: 'unit', rule: 'unit', optional: true, desc: '共同的单位，原话' },
    ],
  },
  {
    id: 'metric',
    category: '数据',
    name: '数字带趋势',
    multiLine: true,
    when: '重点是「现在是多少」，同时说了它是一路怎么变过来的（报了 3 个以上的时间点，最后一个就是要强调的数）。只讲趋势形状、不突出某个数的用折线趋势',
    fields: [
      label,
      { key: 'title', rule: 'summary', maxLen: 10, optional: true, desc: '≤10 字，可概括' },
      { key: 'rows', rule: 'pairs', minItems: 3, maxItems: 8, desc: '每个点写「时间 数值」，都摘原话，按时间先后排，最后一个是要强调的那个数' },
      { key: 'unit', rule: 'unit', optional: true, desc: '单位，原话' },
    ],
  },
  {
    id: 'linechart',
    category: '数据',
    name: '折线趋势',
    multiLine: true,
    when: '讲一个数随时间的变化，报了 3 个以上的时间点（「1 月 2 万，3 月 5 万，6 月 15 万」）',
    fields: [
      label,
      { key: 'title', rule: 'summary', maxLen: 12, desc: '≤12 字，可概括' },
      { key: 'rows', rule: 'pairs', minItems: 3, maxItems: 8, desc: '每个点写「时间 数值」，都摘原话' },
      { key: 'unit', rule: 'unit', optional: true, desc: '单位，原话' },
    ],
  },
  {
    id: 'progress',
    category: '数据',
    name: '进度条',
    multiLine: true,
    when: '说了目标和已经完成了多少（「目标 100 万，已经做到 70 万」）',
    fields: [
      label,
      { key: 'title', rule: 'summary', maxLen: 10, desc: '≤10 字，可概括' },
      { key: 'current', rule: 'number', desc: '已完成的数，原话' },
      { key: 'target', rule: 'number', desc: '目标数，原话' },
      { key: 'unit', rule: 'unit', optional: true, desc: '单位，原话' },
    ],
  },
  {
    id: 'gauge',
    category: '数据',
    name: '评分仪表盘',
    when: '给某个东西打分（「我给它打 8.5 分」「满分 10 分能打 9 分」）',
    fields: [
      label,
      { key: 'title', rule: 'summary', maxLen: 10, optional: true, desc: '给什么打分，≤10 字，可概括' },
      { key: 'score', rule: 'number', desc: '分数，原话' },
      { key: 'max', rule: 'enum', options: ['5', '10', '100'], desc: '满分：原话说了就照抄，没说按常识选 10（百分制选 100，五星选 5）' },
      { key: 'caption', rule: 'verbatim', optional: true, desc: '评语，原话，可留空' },
    ],
  },
  {
    id: 'price',
    category: '数据',
    name: '价格对比',
    multiLine: true,
    when: '说了原价和现价 / 优惠前后的价格（「原价 999，现在只要 199」）',
    fields: [
      label,
      { key: 'currency', rule: 'enum', options: ['¥', '$', ''], desc: '货币符号：人民币 ¥，美元 $，原话没说钱就留空' },
      { key: 'oldPrice', rule: 'number', desc: '原价，原话' },
      { key: 'newPrice', rule: 'number', desc: '现价，原话' },
    ],
  },
  {
    id: 'countdown',
    category: '数据',
    name: '倒计时',
    when: '「还剩 3 天」「只有 5 个名额」这种制造紧迫感的剩余数量',
    fields: [
      { key: 'lead', rule: 'verbatim', optional: true, desc: '前面的字，原话（如「还剩」）' },
      { key: 'value', rule: 'number', desc: '那个整数，原话' },
      { key: 'unit', rule: 'verbatim', optional: true, desc: '后面的字，原话（如「天」「个名额」）' },
    ],
  },
  {
    id: 'twocol',
    category: '列表结构',
    name: '两栏对比',
    multiLine: true,
    when: '分两边各列几条（「自己剪：慢、不稳定；用工具：快、统一」「方案 A……方案 B……」）',
    fields: [
      label,
      { key: 'title', rule: 'summary', maxLen: 10, optional: true, desc: '≤10 字，可概括' },
      { key: 'tone', rule: 'enum', options: ['proscons', 'neutral'], desc: '右边是推荐的那一边选 proscons，两边平等选 neutral' },
      { key: 'leftTitle', rule: 'verbatim', desc: '左栏名，原话' },
      { key: 'left', rule: 'list', minItems: 1, maxItems: 4, desc: '左栏条目，原话' },
      { key: 'rightTitle', rule: 'verbatim', desc: '右栏名，原话' },
      { key: 'right', rule: 'list', minItems: 1, maxItems: 4, desc: '右栏条目，原话' },
    ],
  },
  {
    id: 'quadrant',
    category: '列表结构',
    name: '四象限',
    multiLine: true,
    when: '用两个维度把事情分成四类（「重要紧急的马上做，重要不紧急的计划做……」），四格都说到了才配',
    fields: [
      label,
      { key: 'title', rule: 'summary', maxLen: 10, optional: true, desc: '≤10 字，可概括' },
      { key: 'xLabel', rule: 'verbatim', desc: '横轴维度，原话（如「紧急」）' },
      { key: 'yLabel', rule: 'verbatim', desc: '纵轴维度，原话（如「重要」）' },
      { key: 'q1', rule: 'verbatim', desc: '右上（横轴高、纵轴高），原话' },
      { key: 'q2', rule: 'verbatim', desc: '左上（横轴低、纵轴高），原话' },
      { key: 'q3', rule: 'verbatim', desc: '左下（都低），原话' },
      { key: 'q4', rule: 'verbatim', desc: '右下（横轴高、纵轴低），原话' },
      { key: 'highlight', rule: 'enum', options: ['0', '1', '2', '3', '4'], desc: '重点说的是哪一格（1 右上 2 左上 3 左下 4 右下），没有重点选 0' },
    ],
  },
  {
    id: 'funnel',
    category: '数据',
    name: '漏斗',
    multiLine: true,
    when: '一层层流失的数字（「1000 人看到，100 人点进来，10 人下单」），2–5 层',
    fields: [
      label,
      { key: 'title', rule: 'summary', maxLen: 10, optional: true, desc: '≤10 字，可概括' },
      { key: 'rows', rule: 'pairs', minItems: 2, maxItems: 5, desc: '每层写「名称 数值」，从大到小，都摘原话' },
      { key: 'unit', rule: 'unit', optional: true, desc: '单位，原话' },
    ],
  },
  {
    id: 'pyramid',
    category: '列表结构',
    name: '金字塔',
    multiLine: true,
    when: '讲层级 / 基础和上层（「最底层是……往上是……最顶上是……」），2–5 层',
    fields: [
      label,
      { key: 'title', rule: 'summary', maxLen: 10, optional: true, desc: '≤10 字，可概括' },
      { key: 'levels', rule: 'list', minItems: 2, maxItems: 5, desc: '从塔尖往下排，每层原话' },
    ],
  },
  {
    id: 'causechain',
    category: '列表结构',
    name: '因果链',
    multiLine: true,
    when: '一环扣一环的因果推理（「因为 A，所以 B，最后导致 C」），2–4 环',
    fields: [
      label,
      { key: 'title', rule: 'summary', maxLen: 10, optional: true, desc: '≤10 字，可概括' },
      { key: 'nodes', rule: 'list', minItems: 2, maxItems: 4, desc: '从原因到结果依次写，每环原话' },
    ],
  },
  {
    id: 'formula',
    category: '列表结构',
    name: '公式卡',
    multiLine: true,
    when: '说话人自己给出了一个「A + B = C」式的公式（「好内容 = 选题 + 表达 + 节奏」）',
    fields: [
      label,
      { key: 'parts', rule: 'list', minItems: 2, maxItems: 4, desc: '各项，原话' },
      { key: 'op', rule: 'enum', options: ['+', '×', '−'], desc: '各项之间的关系，原话说「乘」选 ×' },
      { key: 'result', rule: 'verbatim', desc: '等于什么，原话' },
    ],
  },
  {
    id: 'venn',
    category: '列表结构',
    name: '维恩图',
    multiLine: true,
    when: '两件事的交集（「既要 A 又要 B」「A 和 B 重叠的地方就是 C」），三个都说到了才配',
    fields: [
      label,
      { key: 'a', rule: 'verbatim', desc: '左圆，原话' },
      { key: 'b', rule: 'verbatim', desc: '右圆，原话' },
      { key: 'both', rule: 'verbatim', desc: '交集，原话，≤5 字' },
    ],
  },
  {
    id: 'marker',
    category: '文字强调',
    name: '荧光笔',
    when: '一句话里有一两个词特别要强调（观点句、结论句），想像划重点一样涂出来',
    fields: [
      { key: 'sentence', rule: 'verbatim', desc: '整句话，原话，≤24 字' },
      { key: 'marks', rule: 'verbatim', desc: '要涂的词，句子里连续的几个字；两处就用「、」隔开（每处都要是原话）' },
    ],
  },
  {
    id: 'rewrite',
    category: '文字强调',
    name: '删除线改写',
    when: '「不是 xx，而是 yy」「与其说 xx 不如说 yy」只换一个词的纠正',
    fields: [
      { key: 'lead', rule: 'verbatim', optional: true, desc: '前面的字，原话（如「你缺的不是」），可留空' },
      { key: 'from', rule: 'verbatim', desc: '被划掉的词，原话' },
      { key: 'to', rule: 'verbatim', desc: '改成的词，原话' },
      { key: 'style', rule: 'enum', optional: true, options: ['strike', 'retype'], desc: 'strike = 划掉改写（默认）；retype = 删掉重打，只在口语里真的「先说了一个、又改口」时用（「其实不是…准确说是…」）' },
    ],
  },
  {
    id: 'warning',
    category: '文字强调',
    name: '警告牌',
    when: '提醒 / 警告 / 避坑（「注意」「千万别」「这里有个坑」）',
    fields: [
      { key: 'title', rule: 'verbatim', desc: '大字，原话（如「注意」「千万别」）' },
      { key: 'text', rule: 'verbatim', optional: true, desc: '要注意的是什么，原话，≤16 字' },
    ],
  },
  {
    id: 'emoji',
    category: '文字强调',
    name: '表情贴纸',
    when: '语气很强的一句（惊讶、搞笑、赞叹、疑问），配一个表情加强情绪。整条最多 3 张，别滥用',
    fields: [
      { key: 'emoji', rule: 'enum', options: ['🔥', '👍', '😱', '🤔', '💯', '❤️', '👏', '🎉', '😂', '🙈', '💡', '✅', '❌'], desc: '选一个最贴合语气的表情' },
      { key: 'text', rule: 'verbatim', optional: true, desc: '旁边一行字，原话，≤8 字，可留空' },
    ],
  },
  {
    id: 'opening',
    category: '章节节奏',
    name: '开场标题',
    when: '视频最开头点题（「今天聊聊……」「这期讲……」），整条只用一张，放在第 1–3 句',
    fields: [
      { key: 'kicker', rule: 'label', optional: true, desc: '上方英文小字（如 EP.01），可留空' },
      { key: 'title', rule: 'summary', maxLen: 10, desc: '片名，≤10 字，可概括' },
      { key: 'subtitle', rule: 'summary', maxLen: 14, optional: true, desc: '副标题，≤14 字，可概括' },
    ],
  },
  {
    id: 'cta',
    category: '章节节奏',
    name: '关注引导',
    when: '视频结尾求关注 / 点赞 / 收藏（「觉得有用就点个关注」「记得一键三连」），整条只用一张',
    fields: [
      { key: 'text', rule: 'verbatim', desc: '引导语，原话' },
      { key: 'buttons', rule: 'enum', options: ['like,fav,follow', 'like,follow', 'follow', 'like,fav,share'], desc: '原话提到了哪些就选哪组（只说关注选 follow）' },
    ],
  },
];

/**
 * 只能手动加、不交给 AI 的模版。上线了也不在「还不支持 AI 配」里提醒。
 * 人名条：名字、头衔编错了读起来完全正常；窗口截图：AI 拿不到截图；
 * 弹幕 / 社交帖子：AI 编的评论、用户名、点赞数和真的一模一样，观众会当成真实反馈。
 */
// 画面标注四种：位置只有他知道（标在口播画面里的某样东西上），AI 配不了
export const MANUAL_ONLY = new Set(['lowerthird', 'window', 'danmaku', 'post', 'circlemark', 'arrowmark', 'reticle', 'callout', 'magnifier', 'scrolltour', 'newsdesk', 'slider', 'shapewipe', 'inkbleed', 'crashzoom', 'scanmark', 'textmask', 'portrait', 'rackfocus']);

export const specById = (id: string) => TEMPLATE_SPECS.find((t) => t.id === id);
