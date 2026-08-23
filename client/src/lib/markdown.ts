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

/** markdown → 安全 HTML。空输入回空串（调用方据此显示「这条是旧版定稿」）。 */
export function renderMarkdown(src: string): string {
  // 把模型/后端返回的字面量 `\n` 替换为真实的换行符，确保能被 marked 正确解析
  // 同时修复 AI 常见错误：标题符号 # 后面缺少空格导致无法被识别为标题
  const text = (src || '')
    .trim()
    .replace(/\\n/g, '\n')
    .replace(/(#{1,6})(?=[^\s#])/g, '$1 ');
  
  if (!text) return '';
  const html = wrapTables(marked.parse(text, { async: false }) as string);
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
}

/**
 * 每张表外面套一层 `.md-table`，由 CSS 给它横向滚动。
 *
 * 不套这层的话溢出的是**容器**：正文渲染在右侧抽屉（`overflow-y:auto`，另一轴按
 * CSS 规则跟着变成 auto）和左栏聊天气泡里，一张六列的表会让整块内容横着滚 ——
 * 连按钮和标题一起挪出可视区，读起来像布局坏了。而表格本身宽度收不住时，
 * 列会被挤成一字一行的竖排文字：页面不报错、表格也在，只是没人读得下去，
 * 也就没人去核对里面的数字（竞品对照、痛点优先级矩阵、数据置信度表全是表格）。
 *
 * 用字符串替换而不是 renderer 覆盖：GFM 表格不可能嵌套，而 renderer 的入参形态
 * 在 marked 各大版本之间改过几次（改一次就静默回到没有 wrapper 的老样子）。
 */
function wrapTables(html: string): string {
  return html
    .replace(/<table>/g, '<div class="md-table"><table>')
    .replace(/<\/table>/g, '</table></div>');
}
