// BP 原文引用核验：模型抄的原文必须在 BP 里找得到，页码由这里按位置算（不信模型报的）。
// 事实卡和后面各章共用这一份 —— 各写一份的话归一化规则迟早不一样，同一句引文一章核得上、一章核不上。

/** 去空白、统一大小写和全半角标点。PDF 文字层常在中文之间插空格，不去掉的话真引文也对不上。 */
export function norm(s: string): string {
  return s
    .replace(/[\s　]+/g, '')
    .replace(/[，]/g, ',').replace(/[：]/g, ':').replace(/[（]/g, '(').replace(/[）]/g, ')')
    .replace(/[；]/g, ';').replace(/[％]/g, '%')
    .toLowerCase();
}

export interface PageSeg { page: number | null; doc: string | null; norm: string }

// 附件（用户和 BP 一起传的补充材料）在原文里的分隔：`composeBpText` 写、这里认，两边必须一致。
export const ATTACH_HEAD = (k: number, name: string, kind: string) => `===== 附件${k}《${name}》（${kind}） =====`;
const RE_MARK = /^(?:--- 第 (\d+) 页 ---|===== 附件(\d+)《(.+?)》（.*?） =====|--- 附件(\d+) 第 (\d+) 页 ---)$/gm;

/**
 * 按分页标记切段：BP 本身的 `--- 第 N 页 ---`，附件的 `===== 附件K《名》 =====` 和 `--- 附件K 第 N 页 ---`。
 * 每段记 page（页码）+ doc（null = BP 本身，否则「附件K《名》」）。附件页码单独一套 —— 混成一套的话
 * 附件第 3 页的那句会被标成「BP 第 3 页」，他翻 BP 第 3 页找不到。
 * 第一个标记之前的文字（扫描页没读到时常见）也算一段（page = null），不丢。
 */
export function splitPages(text: string): PageSeg[] {
  const marks = [...text.matchAll(RE_MARK)];
  if (!marks.length) return [{ page: null, doc: null, norm: norm(text) }];
  const segs: PageSeg[] = [];
  const pre = text.slice(0, marks[0].index!);
  if (pre.trim()) segs.push({ page: null, doc: null, norm: norm(pre) });
  let doc: string | null = null;
  const names = new Map<string, string>();
  marks.forEach((m, i) => {
    let page: number | null = null;
    if (m[1]) page = Number(m[1]);
    else if (m[2]) { doc = `附件${m[2]}《${m[3]}》`; names.set(m[2], doc); }
    else if (m[4]) { doc = names.get(m[4]) || `附件${m[4]}`; page = Number(m[5]); }
    const start = m.index! + m[0].length;
    const end = i + 1 < marks.length ? marks[i + 1].index! : text.length;
    segs.push({ page, doc, norm: norm(text.slice(start, end)) });
  });
  return segs;
}

/** 找到 → { page, doc }；找不到 → undefined。 */
export function locateAt(quote: string, pages: PageSeg[]): { page: number | null; doc: string | null } | undefined {
  const q = norm(quote);
  if (q.length < 2) return undefined;
  const hit = pages.find((p) => p.norm.includes(q));
  return hit ? { page: hit.page, doc: hit.doc } : undefined;
}

/** 找到 → 页码（无分页时 null）；找不到 → undefined。只要页码时用；要区分 BP / 附件用 `locateAt`。 */
export function locate(quote: string, pages: PageSeg[]): number | null | undefined {
  return locateAt(quote, pages)?.page;
}

/** 「第 6 页」/「附件2《合同.pdf》第 3 页」/「附件2《合同.pdf》」—— 写进服务端拼的说明文字里用。 */
export function whereText(at: { page: number | null; doc: string | null } | null | undefined): string {
  if (!at) return '';
  if (at.doc) return `${at.doc}${at.page ? ` 第 ${at.page} 页` : ''}`;
  return at.page ? `第 ${at.page} 页` : '';
}
