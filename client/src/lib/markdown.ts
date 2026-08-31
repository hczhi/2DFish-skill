import { marked } from 'marked';
import DOMPurify from 'dompurify';

// 咨询正文（consult 的定稿 body）是 AI 生成的 markdown，里面最要紧的是表格 ——
// 企业现状卡、痛点优先级矩阵、数据置信度表都是表格，用 <pre> 原样显示的话
// 一屏里全是竖线，用户读不下去也就不会去核对里面的数字。
//
// **必须过一遍 DOMPurify**：这段 markdown 来自模型，而模型的输入里有用户自己贴的
// 客户资料 —— 资料里带一段 <img onerror=...> 就是一次自己打自己的 XSS，
// 而页面渲染出来完全正常，没有任何一处报错。

marked.setOptions({
  // GFM 表格是这里唯一非可选的特性；breaks 让模型常写的单换行也成行
  gfm: true,
  breaks: true,
});

/**
 * 给每张 `<table>` 套一层 `.md-table`，横向滚动挂在这一层。
 *
 * 不套的话溢出的是**容器**（`.drawer-body` / 聊天气泡：一轴 auto 另一轴就跟着 auto），
 * 连按钮和标题一起横着滚出可视区；而表格宽度收得住时，五六列的表在窄气泡里被挤成
 * 一字一行的竖排文字 —— 两种都不报错、表格也在，只是没人读得下去，也就没人去核对
 * 里面的数字。类名和 `ConsultProject.vue` 的 `.md :deep(.md-table)` 是**一对**，
 * 改一边就静默回到上面那两种样子（`td` 的 `min-width` 也在那份 CSS 里，
 * 少了它这层滚动永远不会真的滚）。
 */
function wrapTables(html: string): string {
  return html.replace(/<table>[\s\S]*?<\/table>/g, (t) => `<div class="md-table">${t}</div>`);
}

/** 一行里有几格：按未转义的 `|` 切，去掉首尾那两个空格子（GFM 的算法）。 */
function cellCount(line: string): number {
  return splitCells(line).length;
}

function splitCells(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map((c) => c.trim());
}

/** 只含 `-` `:` `|` 和空格、且至少有一段 `-` 的那一行（表格的分隔行）。 */
const DELIM_ROW = /^\s*\|[\s:|-]*-[\s:|-]*$/;

/**
 * 把分隔行的格数**补成表头的格数**。
 *
 * GFM 要求两者严格相等，差一格整张表就不是表 —— marked 把它当普通段落，
 * 于是十几行、七八列的内容在页面上变成一大片竖线（实测「触点地图」那张表：
 * 表头 7 格、模型给了 8 个 `---`）。这是**这条链路上唯一一种「内容全在、
 * 一个字都没丢、但没人读得下去」的失败**：不报错、不缺节、复制出去还是好数据，
 * 而顾问不会去核一片竖线里的数字。靠 prompt 让模型数对格数是数不对的
 * （同一份正文里前一张表对、后一张表错），所以在渲染前修。
 *
 * 只修分隔行：数据行多给少给 GFM 自己会截断/补空。要求这一行本身带 `|`，
 * 否则 `---` 这种分割线会被误认成表格（它上一行只要有个竖线就会中）。
 */
function fixTableDelimiters(text: string): string {
  const lines = text.split('\n');
  for (let i = 1; i < lines.length; i++) {
    if (!DELIM_ROW.test(lines[i])) continue;
    const head = lines[i - 1];
    if (!head.includes('|')) continue;
    const want = cellCount(head);
    const given = splitCells(lines[i]);
    if (given.length === want) continue;
    // 对齐标记（`:---` / `---:` / `:---:`）照抄，多出来的那几格丢掉、缺的补 `---`
    const cells = Array.from({ length: want }, (_, j) => given[j] || '---');
    lines[i] = `| ${cells.join(' | ')} |`;
  }
  return lines.join('\n');
}

/** markdown → 安全 HTML。空输入回空串（调用方据此显示「这条是旧版定稿」）。 */
export function renderMarkdown(src: string): string {
  // 把模型/后端返回的字面量 `\n` 替换为真实的换行符，确保能被 marked 正确解析
  // 同时修复 AI 常见错误：标题符号 # 后面缺少空格导致无法被识别为标题
  const text = fixTableDelimiters(
    (src || '')
      .trim()
      .replace(/\\n/g, '\n')
      .replace(/(#{1,6})(?=[^\s#])/g, '$1 ')
  );

  if (!text) return '';
  const html = marked.parse(text, { async: false }) as string;
  // 先 sanitize 再套 wrapper：反过来的话那层 div 也要过一遍 DOMPurify，
  // 而它是我们自己拼的，没必要，也多一次全文替换。
  return wrapTables(DOMPurify.sanitize(html, { USE_PROFILES: { html: true } }));
}
