// 「同一组图必须是同一个高度」这一条（`checkPage` ⑦ 和案例库那条测试共用这一份）。
//
// 这是这一步最典型的一种「渲染完全正常、只是不对」：一行三张图，其中一张比另两张矮 40px，
// 图下面那三行小字于是错开一行的高度。每一格单看都排得很好、`overflow:hidden` 没触发、
// 类名全对、图位数也对，`problems` 里一个字都没有 —— 他要把三格摆在一起看才发现那一行是斜的。
//
// 两种成因，报的话不一样：
//   ① **模型自己写的高度不一致**。prompt 第 8 条明说「单元数量变了就用 inline style 顺手调
//      宽度/间距」，于是它 4 栏里给 3 栏写了 `height:240px`、漏掉第 4 栏（或者第 4 栏写 260）。
//      这一条在生成那一刻就能看出来。
//   ② **占位图比例不一致 + 这一组没钉死高度**。比例是规划那一步由模型逐格挑的（`imageSpec`
//      里那三档），同一行里混着 16:9 和 3:4 完全可能。而库里有几条版式（`.gallery` 那一路、
//      L9 的前后对比）的图是 `width:100%` 不给高度的 —— **占位图阶段三格一样高（占位图都是
//      同一个文件），等真图配上来才参差**，而那时钱已经花掉了。所以这一条必须在生成那一刻
//      就喊，不能等到看见图。
//
// 「钉死高度」认三种写法：inline 写了 height/aspect-ratio、骨架里那条类给了 height/aspect-ratio、
// 或者这一层是 `inset:0` 的绝对定位（尺寸由外面那个格子给，同一组的格子等高）。认宽了不认窄了：
// 少报一次是回到今天的样子，多报一次会挤掉那一页真正要看的那条（migration 094 就是在删这种噪音）。

import { library } from './layoutLibrary.js';
import { isVoidTag } from './pageEdit.js';

const TAG_RE = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>])*)>/g;

/** 决定「这一格多高」的那几个声明。`width` 不算：同一行里各栏宽度不同是常见的正常排版
 *  （1.34fr + 1fr），而高度不同没有一条版式是故意的。 */
const SIZE_PROPS = ['height', 'min-height', 'max-height', 'aspect-ratio'];

interface El {
  name: string;
  classes: string[];
  /** 这一层 inline style 里那几个尺寸声明（原样，用来比对「是不是同一个值」）。 */
  size: string[];
  /** 这一层底下有几个图元素（用来找「这一组」的容器）。 */
  imgs: number;
}

interface Member {
  /** 从最外层到图元素自己那一层（最后一个就是它自己）。 */
  chain: El[];
  /** 用的哪个占位图文件（`ph-16x9.svg`）—— 真图的比例跟着它，见 `imageService.ratioOf`。 */
  ph: string;
}

function sizeDecls(attrs: string): string[] {
  const style = /style="([^"]*)"/.exec(attrs)?.[1] || '';
  const out: string[] = [];
  for (const decl of style.split(';')) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    const prop = decl.slice(0, i).trim().toLowerCase();
    if (SIZE_PROPS.includes(prop)) out.push(`${prop}:${decl.slice(i + 1).trim()}`);
  }
  return out;
}

/** `<img src="/ppt-cases/ph-3x4.svg">` 和 `background-image:url(/ppt-cases/ph-3x4.svg)` 都要认：
 *  两种写法在库里各有一半版式在用（L11 那路整格铺底的是后者）。**比对的是文件名本身**，
 *  不在这里再解析一遍 `16x9 → 16:9`（那份换算在 imageService 里，各写一份的话改了一边
 *  另一边照旧，而症状是「这条提示有时不出现」）。 */
function placeholderOf(attrs: string): string {
  return /(?:src\s*=|url\()\s*["']?[^"')\s]*\/(ph-[^"')\s/]+)/.exec(attrs)?.[1] || '';
}

/**
 * 这一页里的「图组」：每一组是**同一个容器底下的那几张图**（深度最深、底下有 2 张以上图的
 * 那一层就是这一组的容器）。
 *
 * **按结构分组，不按类名分组**：库里有一半的图组是写在 inline `display:grid` 的匿名 div 里的
 * （L8 图廊、L9 前后对比、L10 图标行都是），按类名分的话这几条一律落到 `.slide-inner` 上 ——
 * 于是页面上唯一真的会参差的那几条版式，一条都扫不到，而测试和 `problems` 全是绿的。
 */
function imageGroups(html: string): { owner: El; members: Member[] }[] {
  const stack: El[] = [];
  const members: Member[] = [];
  TAG_RE.lastIndex = 0;
  for (let m = TAG_RE.exec(html); m; m = TAG_RE.exec(html)) {
    if (m[0].startsWith('<!--')) continue;
    const name = m[2].toLowerCase();
    const attrs = m[3] || '';
    if (m[1] === '/') {
      // 闭合到栈里最近的同名开标签（同 `domTree`：配不上就当这个闭标签不存在 ——
      // 抛错的话一处手写的 `</div>` 会让整页一条检查都不跑）。
      const at = [...stack].reverse().findIndex((n) => n.name === name);
      if (at >= 0) for (let k = 0; k <= at; k++) stack.pop();
      continue;
    }
    const el: El = {
      name,
      classes: (/class="([^"]*)"/.exec(attrs)?.[1] || '').trim().split(/\s+/).filter(Boolean),
      size: sizeDecls(attrs),
      imgs: 0,
    };
    const ph = placeholderOf(attrs);
    if (name === 'img' || (ph && /background-image:/.test(attrs))) {
      members.push({ chain: [...stack, el], ph });
      for (const a of stack) a.imgs++;
    }
    if (!/\/\s*$/.test(attrs) && !isVoidTag(name)) stack.push(el);
  }
  const groups = new Map<El, Member[]>();
  for (const mem of members) {
    // 自己那一层不算容器（整格铺底的那种 `background-image` 元素底下可能还有别的图）。
    const owner = [...mem.chain.slice(0, -1)].reverse().find((a) => a.imgs >= 2);
    if (!owner) continue;
    groups.set(owner, [...(groups.get(owner) || []), mem]);
  }
  return [...groups].filter(([, g]) => g.length >= 2).map(([owner, members]) => ({ owner, members }));
}

/** 骨架里有没有哪条规则（按这一路上的类名选中的）把高度钉死了。 */
function fixedByTemplate(tokens: Set<string>): boolean {
  const css = library().template.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = m[1].trim();
    if (!sel || /[:#[@,]/.test(sel)) continue; // 伪类/id/属性/多选择器一律不算（认窄不认宽）
    const parts = sel.replace(/\s*>\s*/g, ' ').split(/\s+/);
    const hit = parts.every(
      (p) => p === 'img' || (p.startsWith('.') && p.slice(1).split('.').every((t) => tokens.has(t)))
    );
    if (!hit) continue;
    if (/(?:^|;)\s*(?:height|min-height|aspect-ratio)\s*:/.test(m[2])) return true;
    if (/(?:^|;)\s*inset\s*:\s*0/.test(m[2])) return true;
  }
  return false;
}

/**
 * 这一页的图组有没有「这一行会参差」的问题（文案就是给他看的那几句）。
 *
 * 案例库那份 md / demo 是干净的（有测试盯着）—— 所以这里报出来的一律是模型这一次自己排的。
 */
export function imageGroupProblems(html: string): string[] {
  const problems: string[] = [];
  for (const { owner, members } of imageGroups(html)) {
    // 这一组容器**自己那一层不算**（它给的高度是三格共用的），从它里面第一层壳开始比。
    const below = (m: Member) => m.chain.slice(m.chain.indexOf(owner) + 1);
    // 一张图的高度由它自己和它上面那几层壳（到这一组的容器为止）决定 —— 只看 `<img>` 自己的话
    // 「三个格子里两个写了 height」这种最常见的写法一处都扫不到。
    const sigs = new Set(members.map((m) => below(m).flatMap((e) => e.size).sort().join(' ')));
    if (sigs.size > 1) {
      problems.push(
        `这一页同一组的 ${members.length} 张图高度不是同一个（${[...sigs].map((s) => s || '没写高度').join(' ／ ')}）——` +
          '这一行会参差不齐，图下面那几行小字跟着错开，而页面照样渲染、一处都不报错。' +
          '同一组的图要么都不写高度（跟版式骨架走），要么全部写同一个值。'
      );
      continue; // 高度已经对不上了，比例那条再报一遍只是噪音
    }
    const phs = new Set(members.map((m) => m.ph).filter(Boolean));
    if (phs.size < 2) continue;
    // 骨架里那条规则可能挂在这一组的容器上（`.gallery img{aspect-ratio}`），所以类名要连容器
    // 那一层一起给 —— 只给里面几层的话 `.gallery` 那一路永远判成「没钉死高度」，每一页都多一句。
    const fixed = members.every((m) => {
      if (below(m).some((e) => e.size.length)) return true;
      return fixedByTemplate(new Set([owner, ...below(m)].flatMap((e) => e.classes)));
    });
    if (!fixed) {
      problems.push(
        `这一页同一组的 ${members.length} 张图用了不同比例的占位图（${[...phs].join(' ／ ')}），而这一组没有钉死高度 ——` +
          '现在看占位图看不出来，等真图配上来这一行才会参差不齐（那时图已经生成过、钱已经花了）。' +
          '要么这几张都用同一个比例的占位图，要么给这一组写同一个 `aspect-ratio` 或 `height`。'
      );
    }
  }
  return problems;
}
