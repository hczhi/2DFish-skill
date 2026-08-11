import { describe, it, expect, vi, afterEach } from 'vitest';
import { setTenantReadable } from './feishuBitable.js';

// 链接分享这一步的失败方式全是「静默」的：飞书对不认识的字段不报错，
// 照样返回 code=0，于是接口说成功、可见范围其实没变。管理员在后台看到
// 「✅ 已设为企业内可阅读」，真实情况可能是表还关着（企业内的人打开是
// 「无权限访问」），或者还能转发到组织外。手测唯一能发现的办法是换一个
// 同事的账号去点链接 —— 所以这里断言**发出去的请求体**。

vi.mock('./feishuOpen.js', () => ({
  getTenantToken: vi.fn(async () => 'tok'),
  callOpenApi: vi.fn(async (...args: any[]) => {
    calls.push({ path: args[1], method: args[2], body: args[3] });
    return {};
  }),
}));

const calls: any[] = [];
const cfg = { appId: 'cli_x', appSecret: 'sec_x' };

afterEach(() => {
  calls.length = 0;
});

describe('多维表格可见范围：企业内可阅读', () => {
  it('发的是 tenant_readable + external_access:false（v1 的字段名）', async () => {
    const ok = await setTenantReadable(cfg, 'bascnAAA', 0);
    expect(ok).toBe(true);

    // link_share_entity 少了或写成 closed，企业内全员就打不开 —— 这是本次要修的行为。
    expect(calls[0].body.link_share_entity).toBe('tenant_readable');

    // 这个端点是 drive **v1**，要的是布尔 external_access；
    // v2 那个 external_access_entity 枚举传过来会被静默忽略，
    // 于是「可转发到组织外」悄悄留着，而表里是全部投标信息（预算/评分/AI 策略）。
    expect(calls[0].body.external_access).toBe(false);
    expect(calls[0].body).not.toHaveProperty('external_access_entity');
  });

  it('失败返回 false 而不是抛异常', async () => {
    // 建表流程里这一步在最后：抛出去会留下一张孤儿表格，而下次重建又是新的一张。
    const { callOpenApi } = await import('./feishuOpen.js');
    vi.mocked(callOpenApi).mockRejectedValueOnce(new Error('权限不足'));
    await expect(setTenantReadable(cfg, 'bascnAAA', 0)).resolves.toBe(false);
  });
});
