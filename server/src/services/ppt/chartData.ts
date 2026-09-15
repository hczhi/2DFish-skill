/**
 * 图表页的「量」由代码算，不由模型算（硬规则 3）。
 *
 * 图表唯一会骗人的地方就是**条长/柱高和它旁边的数字不是同一个数**：那一页排出来是一张干净
 * 完整的图表，颜色、单位、结论条全都在，一处都不报错，而读的人照条长得出的结论是反的。
 * 两条真实事故：
 *
 * ① **轨道上限取了「最大的那个值」**（案例原来就是这么写的），于是最大的那一条永远顶满
 *    整条轨道。数据是百分比时这一条就是致命的：40% 那一行画出来是满格，看起来就是 100%，
 *    而右边印着的仍然是「40%」—— 用户报的就是这个。所以上限在这里算：**一组百分比一律
 *    钉 100**（满格才真的是满），其余向上取一个整齐上限（19 → 20），模型写没写都以这个为准。
 * ② **`--bar-v` 和右边印出来的数字对不上**（模型顺手折算过一次、或者他后来双击把数字改了）。
 *    印出来的那个数是他能看见的、也是他会引用的，所以以它为准把条长改回去，并且要出声。
 *
 * 纯函数、不联网、幂等 —— 生成那一步（`pageService`）和 migration 102（补已生成的页）共用一份：
 * 各写一遍的话老页面永远停在错的条长上，而那一页读起来完全正常。
 *
 * L47（横条）、L52（竖柱）、L53（折线）、L54（环形）走同一套 `--bar-v` / `--bar-max`，所以这里也是
 * 同一段代码，只换类名和话术（「第 3 行」/「第 3 根」/「第 3 个点」/「第 3 块」、「长短」/「高低」/
 * 「大小」）—— 各写一份的话新加的那一档会重新踩「40% 画成满格」这条（环形那一档的同一条是
 * 「四块合计 87% 却铺满整圈」），而它和横条页看起来一样正常。
 *
 * 折线那一档还多算两样：每个点的高度 `--pt-y` 和那条 polyline 的 `points`。**两者必须来自同一次
 * 计算**（③ 第三种事故：模型自己算的线从点旁边穿过去，或者按 `i*100/(n-1)` 把整条线偏了半格
 * —— 出来是一张完整、好看的折线图，一处都不报错，而线的走势和点上印着的数字不是一回事）。
 *
 * 环形那一档多算三样：分母、环那一圈 conic-gradient（`--ring`）、每一块的颜色（`--slice`）。
 * ④ 第四种事故：**环的颜色和图例色片的颜色各算一遍** —— 图例上写着「蓝色 = 直营」而环上那块蓝的
 * 是分销，那一页颜色、单位、结论条全在，一处都不报错，而读的人把每一块认成了别的东西。所以两处
 * 取的是同一份 `SLICE_COLORS` 和同一个分母。
 */

export interface ChartFixResult {
  html: string;
  /** 每一条都是「页面照样渲染出来了，只是条长不是那个数」——手测时看不出来的那些。 */
  problems: string[];
}

/**
 * 一档图表的类名和话术。两档只差这些字 —— 报错里说「第 2 行」而画面上是竖柱的话，
 * 他会照行去找，而那一页上根本没有行。
 */
interface ChartKind {
  /** 版式（给报错开头用）。 */
  name: string;
  /** 外层容器类名（`--bar-max` 写在它身上）。 */
  group: string;
  /** 单项类名（`--bar-v` 写在它身上）。 */
  item: string;
  /** 印出数字那一格的类名。 */
  val: string;
  /** 单项的量词：行 / 根 / 个点 / 块。 */
  unit: string;
  /** 这一档「被读错的那个量」叫什么：长短 / 高低 / 高度 / 大小（报错里要说他画面上看的那个量）。 */
  metric: string;
  /** 一项吃满整条轨道时画面上的样子。 */
  overflow: string;
  /** 上限给太大、所有项都很小时画面上的样子。 */
  squashed: string;
  /**
   * 折线那一档：点的高度（`--pt-y`）和那条 polyline 的 points **都**由代码写。
   * `axis` 是横轴标签那一格的类名（它和点在两个不同的 grid 里，条数得对上）。
   */
  line?: { axis: string };
  /**
   * 环形那一档：环那一圈 conic-gradient（`--ring` 写在 `ring` 那个元素上）和图例色片的颜色
   * （`--slice` 写在每一块上）**都**由代码写，且来自同一次计算 —— 各写一份的话图例上写着
   * 「蓝色 = 直营」而环上那块蓝的是分销。
   */
  pie?: { ring: string; chip: string };
}

const KINDS: ChartKind[] = [
  {
    name: '条形图',
    group: 'l47-rows',
    item: 'l47-row',
    val: 'l47-val',
    unit: '行',
    metric: '长短',
    overflow: '顶满整条轨道',
    squashed: '几条会全挤在轨道左端一小截',
  },
  {
    name: '竖柱图',
    group: 'l52-cols',
    item: 'l52-col',
    val: 'l52-val',
    unit: '根',
    metric: '高低',
    overflow: '一直画到轨道最顶上',
    squashed: '几根会全压在轨道最底下一小截',
  },
  {
    name: '折线图',
    group: 'l53-cols',
    item: 'l53-col',
    val: 'l53-val',
    unit: '个点',
    metric: '高度',
    overflow: '画到画面最顶上',
    squashed: '几个点会全贴在横轴上',
    line: { axis: 'l53-name' },
  },
  {
    name: '环形图',
    group: 'l54-plot',
    item: 'l54-item',
    val: 'l54-val',
    unit: '块',
    metric: '大小',
    overflow: '吃掉整个环',
    squashed: '整个环差不多是一块单色',
    pie: { ring: 'l54-ring', chip: 'l54-chip' },
  },
];

/**
 * 环上每一块的颜色，按图例顺序取。**顺序是按「相邻两块的对比」排的**：
 * `--c-brand`(橙) / `--c-brand-deep`(深橙) 只差一档，挨着放的两块在环上看起来是同一块，
 * 于是三块的环读起来像两块 —— 那一页颜色好看、图例齐全，一处都不报错。
 * 超过 6 块要循环取色，必须出声：两块同色时图例读起来完全正常。
 */
const SLICE_COLORS = [
  'var(--c-brand)',
  'var(--c-accent)',
  'var(--c-ink)',
  'var(--c-brand-deep)',
  'var(--c-accent-deep)',
  'var(--c-ink-soft)',
];

function sliceColor(i: number): string {
  return SLICE_COLORS[i % SLICE_COLORS.length];
}

/** 一行条形 / 一根柱：印出来的那个数 + style 里写的那个数。 */
interface BarRow {
  /** 开标签在 html 里的位置（含 `<`）。 */
  start: number;
  /** 开标签结束后一个字符的位置。 */
  end: number;
  attrs: string;
  /** 右边那一格印出来的数字；读不出来时 null。 */
  printed: number | null;
  /** style 里的 `--bar-v`；没写时 null。 */
  written: number | null;
  /** 印出来的那一格里带 `%`。 */
  percent: boolean;
  /** 第几行 / 第几根（1 起，给报错用）。 */
  index: number;
}

/** `<div class="… l47-rows …" …>` 的开标签（组内不许嵌套同名容器）。 */
function openRe(cls: string): RegExp {
  return new RegExp(`<div\\b([^>]*\\bclass="[^"]*\\b${cls}\\b[^"]*"[^>]*)>`, 'g');
}

/** 上限的候选刻度（× 10^k）。19 → 20、0.4 → 0.4、120 → 120。 */
const NICE_STEPS = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];

/** 横条、竖柱、折线、环形依次过一遍（一页正常只有一种，其余会原样返回）。 */
export function normalizeChartData(html: string): ChartFixResult {
  let out = html;
  const problems: string[] = [];
  for (const kind of KINDS) {
    const r = normalizeKind(out, kind);
    out = r.html;
    problems.push(...r.problems);
  }
  return { html: out, problems };
}

/**
 * 编辑之后把这一页的图表量重算一遍（`edit-text` / `delete-node` / `ai-edit` / `ai-remake` 这四条
 * 写 html 的路共用一份；画布那条不在里面 —— `canvasEdit` 按 html 里有没有 `.bl-canvas` 判，
 * 图表页压根进不来）。
 *
 * 生成那一步算对过一次，不等于以后一直对：**改字和删块都会让「印出来的那个数」变，而条长不会
 * 跟着变**。三条真实路径：他双击把「40」改成「85」之后 style 里还是 40（一条短条配一个大数字）；
 * `ai-remake` 重写文案时顺手改了数字；`delete-node` 删掉最长那一行之后轨道上限还是按被删掉那个数
 * 算的，剩下几行永远到不了满格。三种都是接口 200、页面渲染完整、图表颜色单位结论条全在，
 * 只有照条长读出来的结论是错的 —— 本文件头注那两条事故的复发。
 *
 * 各端点自己调 `normalizeChartData` 也能改对，差别在**出声**：重算动了 html 而 `problems` 是空的
 * 时候（删掉最长那一行、上限 20 → 12），剩下几条会当场变长 —— 不说一句的话他以为是自己那一下
 * 把数据改坏了，会回去把数字一个个改回来。而这句话在四条端点里各写一遍的话，下一条新接的编辑路
 * 一定漏掉，那一页就静默停在旧条长上。
 */
export function rechartEdited(html: string): { html: string; notes: string[] } {
  const r = normalizeChartData(html);
  const notes = [...r.problems];
  if (r.html !== html && !notes.length) {
    notes.push(
      '这一页的图表按现在印出来的数字重算了一次（条长/柱高和轨道上限跟着变了，数字一个都没动）。'
    );
  }
  return { html: r.html, notes };
}

function normalizeKind(html: string, kind: ChartKind): ChartFixResult {
  const problems: string[] = [];
  const groups = [...html.matchAll(openRe(kind.group))];
  if (!groups.length) return { html, problems };

  // 一页正常只有一组，但按组处理：两组时各自的上限互不相干（两组用同一个上限的话，
  // 数量级小的那一组几条全挤在左端，看起来像「这几项都接近 0」）。
  //
  // 改动先攒成一张按位置排好的清单再一次性拼回去 —— 折线那一档要改的 polyline 在
  // 每个点的**前面**（svg 是第一层），顺着往下拼的写法会把它跳过去，而那一页的点是对的、
  // 只有那条线连的是模型自己算的坐标：一张完整好看的折线图，没有任何地方报错。
  const edits: Array<{ start: number; end: number; text: string }> = [];
  groups.forEach((g, gi) => {
    const openStart = g.index!;
    const openEnd = openStart + g[0].length;
    const segEnd = gi + 1 < groups.length ? groups[gi + 1].index! : html.length;
    const segment = html.slice(openEnd, segEnd);
    const rows = readRows(segment, openEnd, kind);

    const values = rows.map((r) => (r.printed ?? r.written)).filter((v): v is number => v !== null);
    const unreadable = rows.filter((r) => r.printed === null).length;
    if (unreadable) {
      problems.push(
        `${kind.name}有 ${unreadable} ${kind.unit}的数字格里读不出数字，那几${kind.unit}的${kind.metric}没核对过 —— 它们可能和印出来的数不是一回事。`
      );
    }
    const max = values.length ? Math.max(...values) : 0;
    if (max <= 0) {
      problems.push(`${kind.name}里一个正数都没读到，${kind.metric}没法核对（${kind.squashed}）。`);
      return;
    }

    const percent = isPercentGroup(html, rows);
    // 环形那一档的「上限」是分母（几块的合计，一组百分比钉 100），不是一档整齐刻度 ——
    // 取整齐刻度的话 100% 只画到环的 4/5，剩一段灰缺口，看起来像「还有一份没统计到」。
    const barMax = kind.pie ? pieTotal(values, percent, problems) : niceMax(max, percent);
    if (!kind.pie) {
      // 上限一律按算出来的那个写回去，但**只在画面真的会被读错时出声**：模型写了个
      // 「刚好比最大值大一档」的数时改不改都一样，逐页刷一条警告只会把版式塌了那种真问题冲下去。
      const writtenMax = readVar(attrStyle(g[1]), '--bar-max');
      const misread = misreading(writtenMax, max, barMax, percent, kind);
      if (misread) {
        problems.push(`${kind.name}的轨道上限由代码重算了（${num(writtenMax!)} → ${num(barMax)}）：${misread}`);
      }
    }

    // 组的开标签：写回算出来的上限。折线那一档如果整段里压根没有 polyline，顺手补一层
    // svg —— 缺了它这一页是「几个悬空的点和数字」，看起来像折线图的线没画出来。
    const points = kind.line ? linePoints(rows, barMax) : '';
    const hasLine = kind.line ? new RegExp(POLYLINE.source).test(segment) : false;
    edits.push({
      start: openStart,
      end: openEnd,
      text: `<div${writeVar(g[1], '--bar-max', barMax)}>` + (kind.line && !hasLine ? svgLayer(points) : ''),
    });

    // 每一行 / 每一根 / 每一个点：`--bar-v` 一律对齐印出来的那个数。
    for (const r of rows) {
      const value = r.printed ?? r.written;
      const disagrees = r.printed !== null && r.written !== null && Math.abs(r.written - r.printed) > 1e-9;
      if (disagrees) {
        problems.push(
          `${kind.name}第 ${r.index} ${kind.unit}的${kind.metric}用的不是它印出来的那个数（style 里是 ${num(r.written!)}、` +
            `印出来的是 ${num(r.printed!)}），已按印出来的数字改回来 —— 不改的话它的${kind.metric}是另一个数的${kind.metric}。`
        );
      }
      // 折线的每个点、环形的每一块都要重写（`--pt-y` / `--slice` 是代码算的，模型写没写都以这个
      // 为准）；条形/竖柱只在两个数对不上时才动，省掉一次无谓的 html 改写。
      const needsY = !!kind.line && value !== null;
      const needsSlice = !!kind.pie;
      if (!needsY && !needsSlice && !disagrees) continue;
      let attrs = value === null ? r.attrs : writeVar(r.attrs, '--bar-v', value);
      if (needsY) attrs = writeVar(attrs, '--pt-y', `${num((value! / barMax) * 100)}%`);
      if (needsSlice) attrs = writeVar(attrs, '--slice', sliceColor(r.index - 1));
      edits.push({ start: r.start, end: r.end, text: `<div${attrs}>` });
    }

    if (kind.line) {
      // 那条线的 points 一律重算：点和线必须来自同一次计算，各算一遍的话线从点旁边穿过去。
      for (const m of segment.matchAll(POLYLINE)) {
        edits.push({
          start: openEnd + m.index!,
          end: openEnd + m.index! + m[0].length,
          text: `<polyline${writeAttr(m[1], 'points', points)}${m[2]}>`,
        });
      }
      // 点在 `.l53-cols` 里、横轴标签在 `.l53-axis` 里，是两个等分格数相同的 grid ——
      // 条数不一样时每个点的标签都错一格，而这一页排出来完全正常。
      const axes = [...segment.matchAll(new RegExp(`class="[^"]*\\b${kind.line.axis}\\b`, 'g'))].length;
      if (axes !== rows.length) {
        problems.push(
          `折线图有 ${rows.length} 个点、横轴标签 ${axes} 个 —— 两边条数不一样时每个点的标签都会错一格` +
            '（标签在另一层 grid 里，等分格数按各自的条数算），而这一页看起来完全正常。'
        );
      }
    }

    if (kind.pie) {
      if (rows.length > SLICE_COLORS.length) {
        problems.push(
          `环形图有 ${rows.length} 块，颜色只有 ${SLICE_COLORS.length} 种 —— 第 ${SLICE_COLORS.length + 1} ` +
            '块起会和第 1 块同色，环上那两块认不出是两块（挨着的话看起来就是一整块），而图例读起来完全正常。' +
            '并成「其他」一块，或者改用横条页。'
        );
      }
      const ring = openRe(kind.pie.ring).exec(segment);
      if (!ring) {
        problems.push(
          `环形图这一页没有那个环（.${kind.pie.ring}）—— 只剩右边那份图例，排出来是几行带色片的文字，` +
            '看起来像一页普通清单，而占比这件事一眼都看不出来。'
        );
      } else {
        // 环那一圈和图例的色片来自同一次计算（同一份 SLICE_COLORS + 同一个分母）。
        edits.push({
          start: openEnd + ring.index!,
          end: openEnd + ring.index! + ring[0].length,
          text: `<div${writeVar(ring[1], '--ring', `conic-gradient(${ringStops(rows, barMax)})`)}>`,
        });
      }
    }
  });

  edits.sort((a, b) => a.start - b.start);
  let out = '';
  let cursor = 0;
  for (const e of edits) {
    if (e.start < cursor) continue;
    out += html.slice(cursor, e.start) + e.text;
    cursor = e.end;
  }
  out += html.slice(cursor);
  return { html: out, problems };
}

/**
 * 模型写的那个上限会让画面被读错吗？读得对就返回 null（静默改掉，不占一条 problems）。
 *
 * 三种会被读错的写法，说法必须分开 —— 「吃满整条轨道」和「几项全挤成一小截」的成因和观感
 * 完全不同，合成一句「上限不对」的话他根本不知道画面上该看什么。
 */
function misreading(
  written: number | null,
  max: number,
  barMax: number,
  percent: boolean,
  kind: ChartKind
): string | null {
  if (written === null || Math.abs(written - barMax) < 1e-9) return null;
  if (percent && written < 100) {
    return (
      `这一组是百分比，上限只有 ${num(written)} —— 最大的那一${kind.unit}（${num(max)}%）会${kind.overflow}，` +
      `看起来就是 100%，而它旁边印着的还是 ${num(max)}%。百分比的满格必须是 100。`
    );
  }
  if (written < max) {
    return (
      `上限 ${num(written)} 比最大的那个数 ${num(max)} 还小，那一${kind.unit}的 calc() 变负数被夹成 0，` +
      `于是它${kind.overflow}，读起来像「这一项到顶了」。`
    );
  }
  if (written > barMax * 2) {
    return (
      `上限 ${num(written)} 是最大那个数（${num(max)}）的两倍多，${kind.squashed}，` +
      '读起来像「这几项都接近 0」，而项与项的差别看不出来。'
    );
  }
  return null;
}

/** 段落里的每一行 / 每一根。`offset` 是这一段在整份 html 里的起点（位置要还原成全局的）。 */
function readRows(segment: string, offset: number, kind: ChartKind): BarRow[] {
  const opens = [...segment.matchAll(openRe(kind.item))];
  const valRe = new RegExp(`class="[^"]*\\b${kind.val}\\b[^"]*"[^>]*>([\\s\\S]*?)</div>`);
  return opens.map((m, i) => {
    const from = m.index! + m[0].length;
    const to = i + 1 < opens.length ? opens[i + 1].index! : segment.length;
    const val = segment.slice(from, to).match(valRe);
    const raw = val ? val[1] : '';
    return {
      start: offset + m.index!,
      end: offset + from,
      attrs: m[1],
      printed: parseNumber(raw),
      written: readVar(attrStyle(m[1]), '--bar-v'),
      percent: /[%％]/.test(raw),
      index: i + 1,
    };
  });
}

/**
 * 这一组是不是百分比。单位可能写在每行的 `<i>%</i>` 里，也可能只在 `.dt-unit` 那一行里
 * 统一写一次（案例的 V3 变体），所以两处都要认 —— 只认一处的话另一种写法照旧按「最大值
 * 顶满」排，而那一页看起来完全正常。
 */
function isPercentGroup(html: string, rows: BarRow[]): boolean {
  if (rows.some((r) => r.percent)) return true;
  const unit = html.match(/class="[^"]*\bdt-unit\b[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?:<div|$)/);
  const text = unit ? unit[1].replace(/<[^>]*>/g, '') : '';
  return /[%％]|百分比|占比/.test(text);
}

/**
 * 折线那一层：`<polyline …>`（属性串里不含 `>`）。第二个捕获组是自闭合的那个斜杠 ——
 * **必须原样留着**：`<polyline …/>` 被改写成 `<polyline …>` 之后它在 svg 里一直开着，
 * 后面的兄弟节点全变成它的子节点，那一页的折线图会少掉一整块，而 html 是「合法」的。
 */
const POLYLINE = /<polyline\b([^>]*?)(\/?)>/g;

/**
 * 折线的 points（viewBox 是 `0 0 100 100` + `preserveAspectRatio:none`，所以直接用百分比当坐标）。
 *
 * x 取**格子中心** `(i+0.5)*100/n`：点是 `.l53-col` 这一等分格里 `left:50%` 的 HTML 元素，
 * 写成 `i*100/(n-1)`（0 / 25 / 50 / 100 那种一眼看着对的写法）的话整条线比点阵偏半格，
 * 首尾还会贴到画面边缘 —— 出来是一张完整的折线图，只是「线画得有点飘」。
 * y 是 `100 - 值/上限*100`（基线一律 0：抬基线的折线图能把 2% 的波动画成断崖，
 * 而每个点旁边印着的数字都是对的）。
 */
function linePoints(rows: BarRow[], barMax: number): string {
  const n = rows.length;
  const out: string[] = [];
  rows.forEach((r, i) => {
    const v = r.printed ?? r.written;
    if (v === null) return; // 读不出数的那个点已经在 problems 里点过名了
    const x = ((i + 0.5) * 100) / n;
    const y = 100 - (v / barMax) * 100;
    out.push(`${num(x)},${num(y)}`);
  });
  return out.join(' ');
}

/**
 * 环的分母。一组百分比一律以 100 为分母 —— 按「几块的合计」切的话，合计 87% 的四块会各自被
 * 放大到刚好凑满一圈，每一块都比它旁边印着的数字大一截，而那一页是一张完整的环形图，
 * 一处都不报错（这和横条页「上限取最大值」是同一种事故）。所以合计不是 100 时按成因出声：
 * **少了**（留灰缺口）和**多了**（一圈只有 360 度，每块反而被压小）画面上的观感完全不同。
 */
function pieTotal(values: number[], percent: boolean, problems: string[]): number {
  const sum = values.reduce((a, b) => a + b, 0);
  if (!percent) return sum;
  if (sum < 99.5) {
    problems.push(
      `环形图几块印出来的百分比合计只有 ${num(sum)}%，环上留了 ${num(100 - sum)}% 的灰色缺口 —— ` +
        '按合计切的话这几块会各自被放大到刚好凑满一圈，每一块都比它旁边印着的数字大一截，' +
        '而那一页看起来完全正常。缺的那一份补一块「其他」，或者在结论条里说清它是什么。'
    );
    return 100;
  }
  if (sum > 100.5) {
    problems.push(
      `环形图几块印出来的百分比合计 ${num(sum)}%，超过 100 —— 一圈只有 360 度，环只能按合计切，` +
        '于是每一块都比它印着的数字小一点（多出来的那部分不占地方，画面上完全看不出来）。' +
        '这几个数字要核一遍：占比通常不能重叠。'
    );
    return sum;
  }
  return 100;
}

/**
 * 环那一圈的 conic-gradient 色标：角度**从 0 依次累加**（`0→a→a+b→…`），每一块的颜色取
 * 和图例色片同一份 `SLICE_COLORS`。用 `deg` 不用 `%`：conic-gradient 里两种都合法，但百分比
 * 那一版在旧一点的渲染引擎上会被整段丢掉（那一页的环变成纯色一块，读起来像「只有一项」）。
 * 读不出数 / 非正数的那一块跳过（已经点过名了），于是末尾差的那一段补一圈发丝色的缺口 ——
 * 不补的话最后一块会自己延伸到 360 度，凭空吃掉别人的份额。
 */
function ringStops(rows: BarRow[], denom: number): string {
  const out: string[] = [];
  let acc = 0;
  rows.forEach((r, i) => {
    const v = r.printed ?? r.written;
    if (v === null || v <= 0) return;
    const from = acc;
    acc = Math.min(360, acc + (v / denom) * 360);
    out.push(`${sliceColor(i)} ${num(from)}deg ${num(acc)}deg`);
  });
  if (acc < 359.9) out.push(`var(--c-hairline) ${num(acc)}deg 360deg`);
  return out.join(', ');
}

/** 模型没写 svg 那一层时补一份（类名和 template.html 里的 CSS 对齐）。 */
function svgLayer(points: string): string {
  return (
    '<svg class="l53-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">' +
    `<polyline class="l53-line" points="${points}"></polyline></svg>`
  );
}

/** 比 `max` 大（或相等）的最小一档整齐刻度。百分比一律 100 —— 满格才真的是满。 */
export function niceMax(max: number, percent: boolean): number {
  if (percent && max <= 100) return 100;
  const exp = Math.pow(10, Math.floor(Math.log10(max)));
  for (const s of NICE_STEPS) {
    const cand = Number((s * exp).toPrecision(12));
    if (cand >= max) return cand;
  }
  return max;
}

/** 从 `.l47-val` 那一格的 html 里读出印出来的那个数（`1,250`、`3.2`、`约 40%` 都认）。 */
function parseNumber(rawHtml: string): number | null {
  const text = rawHtml.replace(/<[^>]*>/g, ' ');
  const m = text.match(/-?\d[\d,]*(?:\.\d+)?/);
  if (!m) return null;
  const v = Number(m[0].replace(/,/g, ''));
  return Number.isFinite(v) ? v : null;
}

function attrStyle(attrs: string): string {
  const m = attrs.match(/\bstyle="([^"]*)"/);
  return m ? m[1] : '';
}

function readVar(style: string, name: string): number | null {
  const m = style.match(new RegExp(`${name}\\s*:\\s*(-?[\\d.]+)`));
  if (!m) return null;
  const v = Number(m[1]);
  return Number.isFinite(v) ? v : null;
}

/** 往开标签的属性串里写一个 css 变量（有 style 就改那一条，没有就补一个 style）。 */
function writeVar(attrs: string, name: string, value: number | string): string {
  const decl = `${name}:${typeof value === 'number' ? num(value) : value}`;
  const style = attrStyle(attrs);
  if (!style) return `${attrs} style="${decl}"`;
  const re = new RegExp(`${name}\\s*:\\s*[^;]*`);
  const next = re.test(style) ? style.replace(re, decl) : `${style.replace(/;\s*$/, '')};${decl}`;
  return attrs.replace(/\bstyle="[^"]*"/, `style="${next}"`);
}

/** 往开标签的属性串里写一个普通属性（有就换掉，没有就补一个）。 */
function writeAttr(attrs: string, name: string, value: string): string {
  const re = new RegExp(`\\s*\\b${name}="[^"]*"`);
  const rest = attrs.replace(re, '');
  return `${rest.replace(/\s+$/, '')} ${name}="${value}"`;
}

function num(v: number): string {
  return String(Number(v.toFixed(4)));
}
