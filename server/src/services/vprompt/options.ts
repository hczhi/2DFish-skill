// 风格 / 题材两组选项。都可以不选（id = 'auto'）：不选时风格由模型判断并说出来，
// 题材由代码按原文关键词决定加载哪几份附加规范 —— 也要说出来，否则用户看到一份很正常的
// 结果，却不知道打斗戏是按日常戏的规则改的。

export interface StyleOption {
  id: string;
  label: string;
  /** 写进 prompt 的风格画质句；auto 没有 */
  render?: string;
}

export const STYLES: StyleOption[] = [
  { id: 'auto', label: '不指定（按原文或 AI 判断）' },
  {
    id: 'realistic',
    label: '写实真人电影',
    render: '电影级写实摄影、真实皮肤纹理与毛孔、自然光比、硬光有明确方向、材质新旧有差别、构图打破完全对称；可用浅景深与轻微胶片颗粒',
  },
  {
    id: 'cg3d',
    label: '3D 动画电影',
    render: '高端 3D CGI 动画电影渲染、风格化比例但材质与光影走真实质感、色彩通透饱和、高光干净锐利；禁止写大气透视、体积灰尘、胶片颗粒、灰雾、雾霾、做旧、脏污、塑料感高光',
  },
  {
    id: 'guoman',
    label: '国漫动画电影',
    render: '东方审美的 3D 国漫电影质感、服饰纹样与材质细腻、光影有层次、色彩通透；禁止写胶片颗粒、灰雾、做旧、脏污、塑料感高光',
  },
  {
    id: 'anime',
    label: '二次元动漫',
    render: '日式赛璐璐动画、干净线稿、平涂分色加少量阴影层、高光呈块面；不写皮肤毛孔、胶片颗粒这类写实词',
  },
  { id: 'painterly', label: '厚涂 / 游戏原画', render: '厚涂笔触、体积感强、光影戏剧化、边缘保留笔触感' },
  { id: 'cyberpunk', label: '赛博朋克', render: '霓虹品红与青色对冲、潮湿反光地面、高密度招牌与全息投影、夜景高反差' },
  {
    id: 'semireal',
    label: '半写实数字概念',
    render: '介于写实与插画之间的数字概念艺术、暖灰底色、皮肤保留质感但略理想化、光影电影化',
  },
];

export interface GenreOption {
  id: string;
  label: string;
  /** skills/video-prompt/<pack>.md；日常对话只用基础规范 */
  pack?: string;
  /** 不选题材时，原文命中这些词就加载这份附加规范 */
  keywords?: RegExp;
}

export const GENRES: GenreOption[] = [
  { id: 'auto', label: '不指定（按原文判断）' },
  { id: 'daily', label: '日常 / 对话' },
  {
    id: 'acting',
    label: '情绪表演',
    pack: 'acting',
    keywords: /哭|眼泪|落泪|台词|对白|争吵|吵架|质问|表白|告白|崩溃|哽咽|委屈|愤怒/,
  },
  {
    id: 'fight',
    label: '打斗动作',
    pack: 'fight',
    keywords: /打斗|打架|出拳|挥拳|拳头|一拳|踢|格挡|对决|交手|过招|厮杀|搏斗|拔剑|挥剑|挥刀|武功|武术|肘击|对打|击飞|一掌/,
  },
  {
    id: 'chase',
    label: '追逐 / 悬疑',
    pack: 'chase',
    keywords: /追|逃|奔跑|狂奔|躲进|躲藏|悬疑|惊悚|恐怖|跟踪|偷看|窥视|坠落|身后|黑影/,
  },
  {
    id: 'stage',
    label: '舞台表演',
    pack: 'stage',
    keywords: /舞台|演唱|唱歌|跳舞|舞蹈|走秀|典礼|颁奖|灯光秀|演出/,
  },
];

export function styleById(id: string): StyleOption | undefined {
  return STYLES.find((s) => s.id === id);
}

export function genreById(id: string): GenreOption | undefined {
  return GENRES.find((g) => g.id === id);
}

export interface LoadedPack {
  pack: string;
  label: string;
  /** 为什么加载：用户选的，或原文里命中的那个词 */
  reason: string;
}

/** 决定加载哪几份附加规范。选了题材就只用那一份；没选就按关键词，可能命中多份。 */
export function resolvePacks(genreId: string, prompt: string): LoadedPack[] {
  const chosen = genreById(genreId);
  if (chosen && chosen.id !== 'auto') {
    return chosen.pack ? [{ pack: chosen.pack, label: chosen.label, reason: '你选的题材' }] : [];
  }
  const packs: LoadedPack[] = [];
  for (const g of GENRES) {
    const hit = g.keywords && prompt.match(g.keywords);
    if (g.pack && hit) packs.push({ pack: g.pack, label: g.label, reason: `原文里有「${hit[0]}」` });
  }
  return packs;
}
