// 一份稿子的**设计规范**（096 `ppt_decks.design_json`）：配色 / 字体 / 疏密。
//
// 案例库（layoutLibrary）只管「这一页怎么排」，这一份管「整份长什么样」——
// 案例里的颜色、字号、留白从此只算参考，规范才是硬的。
//
// 三条决定这个文件的形状：
//
// ① **每一项都是枚举，不是自由文本。** 「配色沉稳一点、间距舒展一点」这种话只能靠模型执行，
//    它没执行时出来照样是一页完整正常的幻灯片（硬规则 3）。枚举翻译成 CSS 变量是代码保证的：
//    选了「沉稳蓝」就一定是蓝的，跟模型的心情无关。
//
// ② **靠覆盖 `:root` 变量生效，不靠重新生成。** 页面里的颜色写的都是 `var(--c-*)`
//    （`buildPrompt` 硬规则 3 就在管这件事），所以改一次规范，**已经生成过的十几页刷新就变**，
//    一次调用都不用花。反过来说：把规范写进 prompt 让模型把色值写死，就等于「改配色 =
//    重花十几次钱」，而没改的那几页在界面上看不出任何异常。
//
// ③ **一套配色必须把这一批变量全给齐**（`PALETTE_VARS`）。少给一个不报错：浏览器只是照旧
//    用 template 里那一份默认值 —— 蓝色系的稿子上留着橙色的高亮块和暖色卡片底，
//    每一页单看都正常，翻起来才觉得「这版配色有点脏」，而没有一处会说。
//    变量名拼错更隐蔽：浏览器把**整条声明**丢掉（`templateVars()` 那段注释说的就是这个），
//    现象是「这一版配色好像淡了点」。这两条都有测试盯着。

/** 一套配色要覆盖的全部变量。变量名的 `-o` / `warm` 是**品牌色系**，`-b` / `cool` 是**强调色系**
 *（名字按默认那套橙+蓝取的色相，换成别的色相时含义不变 —— 按名字里的冷暖填的话，
 * 品牌色和它的浅底色会分家，出来是一页配色不成立但完整的幻灯片）。 */
export const PALETTE_VARS = [
  '--c-brand', '--c-brand-deep', '--c-accent', '--c-accent-deep',
  '--c-bg', '--c-bg-alt', '--c-ink', '--c-ink-deep', '--c-ink-soft',
  '--c-card', '--c-hairline',
  '--bg-warm', '--bg-cool', '--bg-plain',
  '--card-o', '--card-b', '--hl-o', '--hl-b',
  '--mask-rgb', '--mask-rgb-alt',
] as const;

export interface DesignOption {
  id: string;
  name: string;
  /** 一句话：他在下拉里就靠这句话判断挑哪个（只有 id 的话得一个个试，每试一次要重看整份）。 */
  hint: string;
  /** 要覆盖的 `:root` 变量。**默认那一套是空的** —— 见 `PALETTES` 上的注释。 */
  vars?: Record<string, string>;
  /**
   * 变量改不了的那些，直接写规则覆盖。
   *
   * 疏密这一档写的是 `:root{--pad-*}` 而**不是** `.slide-inner{padding:…}`：页眉的位置
   * （`.slide-header` 的 `top`/`left`）用的是同一组变量，只压 `.slide-inner` 的话页眉留在
   * 默认那一档上 —— 舒展档的页眉比内容左边 36px、紧凑档的内容起点比页眉还高（两行字叠在一起），
   * 而每一页都是一页正常的幻灯片。
   */
  rules?: string;
  /**
   * 要**顺带告诉模型**的那一句（`designPromptBlock`）。只写「CSS 管不到、但排版得跟着变」的事：
   * 疏密改的是 padding，画面里能用的宽高跟着变 —— 模型不知道的话它照旧按标准那档的容量塞内容，
   * 紧凑档下面留一大块空、舒展档下面挤出画面（`overflow:hidden` 直接切掉，不报错）。
   */
  promptNote?: string;
}

/**
 * 配色。
 *
 * **默认那一套（P-A）故意不写任何覆盖**，直接用 template.html 的 `:root`：在这里再抄一份
 * 色值的话，设计改了 template 而这里照旧，于是「默认」这一套和案例库里每个 demo 都不是
 * 同一个颜色 —— 两边各自都好看，只有摆在一起才看得出，而没有一处会报错。
 */
export const PALETTES: DesignOption[] = [
  {
    id: 'P-A',
    name: '想象橙（默认）',
    hint: '橙 + 天青，暖底。案例库里所有 demo 就是这一套',
  },
  {
    id: 'P-B',
    name: '沉稳蓝',
    hint: '深蓝 + 琥珀，冷底。政企、方案汇报',
    vars: {
      '--c-brand': '#2A5DB0', '--c-brand-deep': '#1E4585',
      '--c-accent': '#E8A33D', '--c-accent-deep': '#CE8A26',
      '--c-bg': '#F7F8FA', '--c-bg-alt': '#EDF2F9',
      '--c-ink': '#4A5260', '--c-ink-deep': '#1F2733', '--c-ink-soft': '#8B93A1',
      '--c-card': '#FFFFFF', '--c-hairline': 'rgba(16,24,40,.10)',
      '--bg-warm': '#EEF3FA', '--bg-cool': '#FDF6EA', '--bg-plain': '#F7F8FA',
      '--card-o': '#E9F0FA', '--card-b': '#FDF3E3',
      '--hl-o': 'rgba(42,93,176,.14)', '--hl-b': 'rgba(232,163,61,.14)',
      '--mask-rgb': '247,248,250', '--mask-rgb-alt': '237,242,249',
    },
  },
  {
    id: 'P-C',
    name: '墨绿',
    hint: '墨绿 + 陶土，米白底。文旅、健康、国货',
    vars: {
      '--c-brand': '#2F6B52', '--c-brand-deep': '#235340',
      '--c-accent': '#C4703A', '--c-accent-deep': '#A85A2A',
      '--c-bg': '#F8F7F2', '--c-bg-alt': '#EDF3EF',
      '--c-ink': '#4C534E', '--c-ink-deep': '#232A26', '--c-ink-soft': '#8D948F',
      '--c-card': '#FFFFFF', '--c-hairline': 'rgba(20,30,25,.10)',
      '--bg-warm': '#EDF3EF', '--bg-cool': '#FBF2EB', '--bg-plain': '#F8F7F2',
      '--card-o': '#E9F1EC', '--card-b': '#FAEFE7',
      '--hl-o': 'rgba(47,107,82,.14)', '--hl-b': 'rgba(196,112,58,.14)',
      '--mask-rgb': '248,247,242', '--mask-rgb-alt': '237,243,239',
    },
  },
];

/**
 * 字体。只换 `--serif` / `--sans` 这两个字族（template 里标题类用的是 `var(--serif)`，
 * 正文跟 body 走 `var(--sans)`），**不去按元素指定字体**：那要靠猜每条版式的标题类名，
 * 而猜错的那一条不报错 —— 只是那一页的标题字体和别的页不一样。
 */
export const FONTS: DesignOption[] = [
  { id: 'F-A', name: '宋体标题 + 黑体正文（默认）', hint: '标题有笔锋，正文清楚。通用' },
  {
    id: 'F-B',
    name: '全黑体',
    hint: '标题也用黑体，更硬朗。科技、数据类',
    vars: { '--serif': '"Noto Sans SC",system-ui,sans-serif' },
    promptNote: '标题也是黑体（`var(--serif)` 已经换成黑体了，别自己写 font-family）—— 黑体标题看起来比宋体重，标题字号取阶梯里偏小的那一档。',
  },
  {
    id: 'F-C',
    name: '全宋体',
    hint: '正文也用宋体，更斯文。文旅、品牌故事',
    vars: { '--sans': '"Noto Serif SC",serif' },
    promptNote: '正文也是宋体（`var(--sans)` 已经换成宋体了，别自己写 font-family）—— 宋体小字发虚，正文字号取阶梯里偏大的那一档，行高也松一点。',
  },
];

/**
 * 疏密。改的是 template 里那组 `--pad-*` 变量（**不是** `.slide-inner{padding}`）——
 * 页眉的 `top`/`left` 用的是同一组变量，所以它跟着一起走；写成压 `.slide-inner` 的话
 * 页眉留在默认那一档上，横向对不齐、紧凑档还会被内容压住（见 `rules` 上那段）。
 * 一起注在同一段 `<style>` 里，它在 head 那份之后，所以压得住。
 */
export const DENSITIES: DesignOption[] = [
  { id: 'D-B', name: '标准（默认）', hint: '上下 100 / 左右 140' },
  {
    id: 'D-A',
    name: '舒展',
    hint: '留白更多，一页少放点东西',
    rules: ':root{--pad-x:176px;--pad-top:118px;--pad-bottom:126px}',
    promptNote: '这份稿子的页边距更大（左右各 176px），可用宽度比案例窄 —— 每页的内容块比案例少一点，宁可空着也不要挤。',
  },
  {
    id: 'D-C',
    name: '紧凑',
    hint: '内容多的稿子用它，别让文字挤出画面',
    rules: ':root{--pad-x:108px;--pad-top:88px;--pad-bottom:104px}',
    promptNote: '这份稿子的页边距更小（左右各 108px），可用宽度比案例宽 —— 内容多的那几页可以比案例多排一块，字号按阶梯里偏小的那一档。',
  },
];

/**
 * 页眉（左上角那行模块名）的样子。**做成这里的第四档，而不是让模型写页眉代码**：
 * 页眉一进 prompt，模型就会顺手改写模块名、换字号，于是每页左上角那行字都不太一样
 * （硬规则 3，`pageService.applyHeader` 第 ① 条说的就是这件事）。放在这里的好处是
 * 它和配色一样**靠覆盖 CSS 生效** —— 改完已经生成的十几页刷新就变，一次调用都不花。
 *
 * 每一档都要把 `.slide-header .kicker` 那几个属性**写全**（字号 / 字重 / 字距 / 颜色 /
 * 字族）：只改字号的话别的属性留在 template 的默认值上，出来是一档「有点像默认那档
 * 但又不一样」的页眉，而每一页都正常、没有一处会说。`H-D` 是整档不显示（`display:none`）——
 * 这时页眉的 div 照旧贴（去重照旧跑），只是不画出来：不贴的话切回别的档要重新生成才有。
 */
export const HEADERS: DesignOption[] = [
  { id: 'H-A', name: '小字加宽字距（默认）', hint: '17px 黑体加粗、字距拉开，强调色。通用' },
  {
    id: 'H-B',
    name: '细宋体',
    hint: '20px 宋体常规、浅墨色，克制。品牌故事、文旅',
    rules: '.slide-header .kicker{font-family:var(--serif);font-size:20px;font-weight:400;letter-spacing:.02em;color:var(--c-ink-soft)}',
  },
  {
    id: 'H-C',
    name: '品牌色块',
    hint: '白字压在品牌色小色块上，最显眼。政企、方案汇报',
    rules: '.slide-header .kicker{font-size:15px;font-weight:700;letter-spacing:.1em;color:var(--c-card);background:var(--c-brand);padding:7px 16px;border-radius:8px;display:inline-block}',
  },
  {
    id: 'H-D',
    name: '不显示',
    hint: '整份都不要左上角那行模块名',
    rules: '.slide-header{display:none}',
  },
];

export interface DesignSpec {
  palette: string;
  font: string;
  density: string;
  header: string;
}

export const DEFAULT_DESIGN: DesignSpec = { palette: 'P-A', font: 'F-A', density: 'D-B', header: 'H-A' };

export function designOptions() {
  const strip = (o: DesignOption) => ({ id: o.id, name: o.name, hint: o.hint });
  return {
    palettes: PALETTES.map(strip),
    fonts: FONTS.map(strip),
    densities: DENSITIES.map(strip),
    headers: HEADERS.map(strip),
    default: DEFAULT_DESIGN,
  };
}

export class DesignSpecError extends Error {}

/**
 * 校验前端传来的那三个 id（**认不出一律抛**，不回落成默认那套）。
 *
 * 回落的话他在下拉里选了「墨绿」、存下来是橙的，而每一页都是一页正常的幻灯片 ——
 * 界面上那个下拉还显示着「墨绿」（前端存的是自己那份），两处对不上而一处都不报错。
 */
export function readDesignSpec(raw: unknown): DesignSpec {
  const pick = (list: DesignOption[], v: unknown, label: string): string => {
    const id = String(v ?? '').trim().toUpperCase();
    if (!id) throw new DesignSpecError(`设计规范里少了${label}，没存 —— 缺一项的话那一项会悄悄回到默认那套。`);
    if (!list.some((x) => x.id === id)) {
      throw new DesignSpecError(
        `${label} ${id} 不在库里（只有 ${list.map((x) => x.id).join(' / ')}）—— 存下来的话整份会用默认那套，而界面上显示的是你挑的这个。`
      );
    }
    return id;
  };
  return {
    palette: pick(PALETTES, (raw as any)?.palette, '配色'),
    font: pick(FONTS, (raw as any)?.font, '字体'),
    density: pick(DENSITIES, (raw as any)?.density, '疏密'),
    header: pick(HEADERS, (raw as any)?.header, '页眉'),
  };
}

/**
 * 读库里那一列（老 deck 是空的 = 默认那套）。
 *
 * 认不出的 id **回落成默认那一档并出声**（写入路径已经卡过一次，所以到这里通常是手改过库、
 * 或者某一套配色从库里删了）：不出声的话他打开一份「墨绿」的稿子看到的是橙的，
 * 而设置面板里那个下拉也显示成默认那档 —— 他会以为自己从来没选过。
 */
export function parseDesignSpec(json: string | null | undefined): { spec: DesignSpec; problems: string[] } {
  if (!json || !json.trim()) return { spec: { ...DEFAULT_DESIGN }, problems: [] };
  let raw: any;
  try {
    raw = JSON.parse(json);
  } catch {
    return {
      spec: { ...DEFAULT_DESIGN },
      problems: ['这份稿子存着的设计规范读不出来（design_json 坏了），现在用的是默认那套 —— 在「提纲与设置」里重新选一次会存回去。'],
    };
  }
  const problems: string[] = [];
  const one = (list: DesignOption[], v: unknown, fallback: string, label: string): string => {
    const id = String(v ?? '').trim().toUpperCase();
    if (!id) return fallback;
    if (list.some((x) => x.id === id)) return id;
    problems.push(
      `这份稿子存的${label} ${id} 不在库里了，现在用的是「${list.find((x) => x.id === fallback)?.name || fallback}」——` +
        '在「提纲与设置」里重新选一次会存回去（已经生成的页会跟着变，不用重新生成）。'
    );
    return fallback;
  };
  return {
    spec: {
      palette: one(PALETTES, raw?.palette, DEFAULT_DESIGN.palette, '配色'),
      font: one(FONTS, raw?.font, DEFAULT_DESIGN.font, '字体'),
      density: one(DENSITIES, raw?.density, DEFAULT_DESIGN.density, '疏密'),
      // 096 那批老 deck 的 design_json 里压根没有这个键 —— 缺键走 `!id` 那条，
      // 静静回到默认那档（那正是它们现在的样子），**不报问题**：报的话每份老稿子
      // 打开都挂一句红字，而它一个字都没错。
      header: one(HEADERS, raw?.header, DEFAULT_DESIGN.header, '页眉'),
    },
    problems,
  };
}

/**
 * 这份规范实际覆盖掉的那些 `:root` 变量（配色 + 字体，不含疏密那条规则）。
 *
 * 生图提示词要用它（`styleLibrary.deckColors`）：**图的颜色必须跟着这份稿子的规范走** ——
 * 一直读 template 那份默认值的话，蓝色系的稿子配出来的图全是橙的，而每张图单看都不错、
 * 没有一处报错，他只会以为「这个模型画不了蓝色」。默认那套返回空对象（就是 template 那份）。
 */
export function designVars(spec: DesignSpec): Record<string, string> {
  const pal = PALETTES.find((x) => x.id === spec.palette);
  const font = FONTS.find((x) => x.id === spec.font);
  return { ...(pal?.vars || {}), ...(font?.vars || {}) };
}

/**
 * 规范那一段**发给模型的话**（接在 `design-tokens.md` 后面，见 `pageService.buildPrompt`）。
 *
 * 只说「CSS 覆盖不到的部分」：颜色和字族已经靠 `:root` 变量生效了，所以这里**一个色值都不给**
 * —— 给了它就会写死在 inline style 里，那一块换配色那天不会跟着变（而它读起来完全正常）。
 * 要说的是排版层面的后果：疏密改了可用宽度、字体改了视觉重量，模型不知道的话它照旧按案例那档
 * 的容量排，紧凑档下面空一块、舒展档被 `overflow:hidden` 切掉一行 —— 两种都不报错。
 */
export function designPromptBlock(spec: DesignSpec): string {
  const pal = PALETTES.find((x) => x.id === spec.palette);
  const font = FONTS.find((x) => x.id === spec.font);
  const den = DENSITIES.find((x) => x.id === spec.density);
  const notes = [font?.promptNote, den?.promptNote].filter(Boolean);
  return `
## 这份稿子的设计规范（**比上面的通用令牌优先**）
- 配色：${pal?.name || spec.palette}（${pal?.hint || ''}）。这套色已经注进 \`:root\` 了 —— 你只要照旧写 \`var(--c-brand)\` / \`var(--c-accent)\` / \`var(--bg-*)\` 这些**角色变量**，颜色自然就是这一套。**一个具体色值都不要写**（写死的那一处换配色时不会跟着变，而它看起来完全正常）。
- 字体：${font?.name || spec.font}。标题用 \`var(--serif)\`、正文跟 \`var(--sans)\`，**不要自己写 font-family**。
- 疏密：${den?.name || spec.density}（${den?.hint || ''}）。\`.slide-inner\` 的内边距由外壳决定，**不要自己写页面级 padding**。
${notes.length ? notes.map((n) => `- ${n}`).join('\n') : ''}`;
}

/**
 * 规范那一段 `<style>`（`assembleDeck` 把它和幻灯片一起插进 body）。
 *
 * **插 body 不去找 `</head>`**：找不到那个标签时 replace 什么都不做，而现象是「配色没变」
 * —— 和「我是不是没点保存」分不开。插在 body 里的 `<style>` 一样是全局生效的，
 * 而且它在 head 那份之后，所以压得住 template 里的默认值。
 */
export function designStyleBlock(spec: DesignSpec): string {
  const vars = designVars(spec);
  const decl = Object.entries(vars)
    .map(([k, v]) => `${k}:${v}`)
    .join(';');
  // 疏密和页眉两档的规则**都要注**（顺序按 DesignSpec 的字段顺序，页眉在后 —— 页眉那档
  // 只碰 `.slide-header`，和疏密的 `:root{--pad-*}` 不重叠，所以谁在前都一样）。
  // 漏一档不报错：下拉里选着「细宋体」而每页左上角还是加粗小字，界面上和存进去的对不上，
  // 而每一页都是一页正常的幻灯片（`designSpec.test.ts` 按「每档 rules 都出现在块里」对账）。
  const den = DENSITIES.find((x) => x.id === spec.density);
  const head = HEADERS.find((x) => x.id === spec.header);
  const rules = (den?.rules || '') + (head?.rules || '');
  if (!decl && !rules) return '';
  // id 写出来：导出的 .html 里有人要找「这份稿子的配色是哪来的」，没有标记的话
  // 那一段看起来像手改进去的。
  return `<style id="deck-design" data-design="${spec.palette}/${spec.font}/${spec.density}/${spec.header}">${decl ? `:root{${decl}}` : ''}${rules}</style>\n`;
}
