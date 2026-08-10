import { describe, it, expect } from 'vitest';
import { normalizeBaseUrl } from './baseUrl.js';

// 这个函数存在的唯一理由：SDK 的 baseURL 是前缀、自己会拼 /chat/completions，
// 而各家文档给的示例是完整的 .../v1/chat/completions。粘完整地址进来
// 会请求到 /v1/chat/completions/chat/completions，上游回 404 «Invalid URL» ——
// 一个长得像「key 错了」的报错。
describe('normalizeBaseUrl', () => {
  it('截掉粘贴进来的 /chat/completions 后缀', () => {
    expect(normalizeBaseUrl('https://new-api-test.xiaozanai.com/v1/chat/completions')).toBe(
      'https://new-api-test.xiaozanai.com/v1'
    );
  });

  it('后缀带尾随斜杠也认得出来', () => {
    expect(normalizeBaseUrl('https://host/v1/chat/completions/')).toBe('https://host/v1');
  });

  it('大小写不敏感', () => {
    expect(normalizeBaseUrl('https://host/v1/Chat/Completions')).toBe('https://host/v1');
  });

  it('trim 掉复制粘贴带来的前后空格', () => {
    // 不 trim 的话请求会打到 `/v1%20/chat/completions`，同样是 404。
    expect(normalizeBaseUrl('  https://host/v1/chat/completions ')).toBe('https://host/v1');
    expect(normalizeBaseUrl(' https://host/v1 ')).toBe('https://host/v1');
  });

  it('正确的前缀地址原样保留', () => {
    expect(normalizeBaseUrl('https://api.openai.com/v1')).toBe('https://api.openai.com/v1');
    expect(normalizeBaseUrl('https://dashscope.aliyuncs.com/compatible-mode/v1')).toBe(
      'https://dashscope.aliyuncs.com/compatible-mode/v1'
    );
  });

  it('只截末尾那一段，不动其他路径', () => {
    // 网关自定义前缀里出现 chat 字样是合法的，多截一层会把能用的配置改坏。
    expect(normalizeBaseUrl('https://host/chat/v1')).toBe('https://host/chat/v1');
    expect(normalizeBaseUrl('https://host/completions/v1')).toBe('https://host/completions/v1');
  });

  it('不重复截：只有一段 /chat/completions 会被去掉', () => {
    // 已经被截过一次的值再进来一次，结果必须稳定（幂等），
    // 否则「保存两次」和「保存一次」得到不同的地址。
    const once = normalizeBaseUrl('https://host/v1/chat/completions/chat/completions');
    expect(once).toBe('https://host/v1/chat/completions');
    expect(normalizeBaseUrl(once)).toBe('https://host/v1');
  });

  it('空值 / null / undefined 归一成空串', () => {
    // 空串在 gateway 里会回落到 https://api.openai.com/v1，是既有行为。
    expect(normalizeBaseUrl('')).toBe('');
    expect(normalizeBaseUrl('   ')).toBe('');
    expect(normalizeBaseUrl(null)).toBe('');
    expect(normalizeBaseUrl(undefined)).toBe('');
  });
});
