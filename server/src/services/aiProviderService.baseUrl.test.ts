import { describe, it, expect, beforeEach } from 'vitest';
import { initDatabase, getDatabase } from '../db/index.js';
import { upsertProvider, getProvider, listProviders, resolveLLMProvider } from './aiProviderService.js';

initDatabase();

// base_url 存成完整的 .../v1/chat/completions 时，OpenAI SDK 会再拼一次，
// 请求打到 /v1/chat/completions/chat/completions，上游回
// 404 «Invalid URL (POST /v1/chat/completions /chat/completions)» ——
// 一个字面上跟地址无关、读起来像 key/模型名问题的报错。
// 各家文档给的都是完整地址，所以这是会重复发生的粘贴错误。
beforeEach(() => {
  getDatabase().prepare('DELETE FROM ai_providers').run();
});

const PASTED = 'https://new-api-test.xiaozanai.com/v1/chat/completions';
const WANT = 'https://new-api-test.xiaozanai.com/v1';

describe('provider 的 base_url 归一化', () => {
  it('写入时截掉粘贴进来的 /chat/completions', () => {
    const p = upsertProvider({
      kind: 'llm', tier: 'default', label: 'x', model: 'm',
      base_url: PASTED, api_key: 'sk-test', enabled: 1,
    });
    expect(p.base_url).toBe(WANT);
    expect(getProvider(p.id)!.base_url).toBe(WANT);
  });

  it('写入时 trim 前后空格', () => {
    // 不 trim 的话请求打到 `/v1%20/chat/completions`，同样 404。
    const p = upsertProvider({
      kind: 'llm', tier: 'default', label: 'x', model: 'm',
      base_url: '  https://host/v1 ', api_key: 'sk-test', enabled: 1,
    });
    expect(p.base_url).toBe('https://host/v1');
  });

  it('读取时也归一化 —— 直接改库/导入进来的脏行同样能用', () => {
    // 迁移 065 洗的是「已经在库里的行」，但没人保证之后不会有别的写入路径
    // （手工 SQL、从别处导数据）。读路径兜住 = 所有取 provider 的地方都拿到可用地址。
    const p = upsertProvider({
      kind: 'llm', tier: 'default', label: 'x', model: 'm',
      base_url: 'https://host/v1', api_key: 'sk-test', enabled: 1,
    });
    getDatabase().prepare('UPDATE ai_providers SET base_url = ? WHERE id = ?').run(PASTED, p.id);

    expect(getProvider(p.id)!.base_url).toBe(WANT);
    expect(listProviders()[0].base_url).toBe(WANT);
    expect(resolveLLMProvider('default')!.base_url).toBe(WANT);
  });

  it('合法前缀原样保留，不会被截坏', () => {
    const p = upsertProvider({
      kind: 'llm', tier: 'default', label: 'x', model: 'm',
      base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', api_key: 'sk-test', enabled: 1,
    });
    expect(p.base_url).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1');
  });

  it('不传 base_url 的编辑不会把已有地址弄丢', () => {
    // upsertProvider 用 `?? existing` 保留旧值；归一化包在外面时
    // 必须仍然拿到 existing 的值，而不是把它归一成空串。
    const p = upsertProvider({
      kind: 'llm', tier: 'default', label: 'x', model: 'm',
      base_url: PASTED, api_key: 'sk-test', enabled: 1,
    });
    const edited = upsertProvider({ id: p.id, label: '改个名字' });
    expect(edited.base_url).toBe(WANT);
  });
});
