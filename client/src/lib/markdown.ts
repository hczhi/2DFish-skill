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
  const text = (src || '').trim();
  if (!text) return '';
  const html = marked.parse(text, { async: false }) as string;
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
}
