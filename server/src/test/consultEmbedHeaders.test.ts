import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';

// iframe 嵌入的响应头（084）。这条链路上的两种失败都不报错：
//   ① /consult 上还挂着 `X-Frame-Options: DENY`（它只有 DENY/SAMEORIGIN 可用）→ 浏览器
//      拦掉整个 frame，第三方页面上是一块白，而我们这边每个接口都 200、后台那行 key 看着好着；
//   ② frame-ancestors 漏到别的路径 / 没有启用的 key 时也放行 → 谁都能把我们的页面套进去
//      钓鱼，同样一句错都不报。
const { app } = await import('../app.js');
const { createUser } = await import('./helpers.js');

const ORIGIN = 'https://partner.example.com';

beforeAll(async () => {
  const admin = createUser('admin');
  const owner = createUser('user');
  const res = await request(app)
    .post('/api/consult/admin/sdk-keys')
    .set(admin.auth)
    .send({ userId: owner.id, name: '某代理商', allowedOrigins: ORIGIN });
  expect(res.status).toBe(200);
});

describe('consult iframe 响应头', () => {
  it('/consult 允许白名单域名嵌入，别的路径照旧 DENY', async () => {
    const consult = await request(app).get('/consult/projects');
    expect(consult.headers['x-frame-options']).toBeUndefined();
    expect(consult.headers['content-security-policy']).toContain(`frame-ancestors ${ORIGIN}`);

    const other = await request(app).get('/xhs');
    expect(other.headers['x-frame-options']).toBe('DENY');
    expect(other.headers['content-security-policy']).not.toContain('frame-ancestors');
  });

  it('嵌入页匿名可取 —— 浏览器的文档请求不带 Authorization 头', async () => {
    // 非 /api/ 的路径原来落到 authMiddleware 的 `return 'protected'`，于是 /consult/embed
    // 回一句 401 JSON：iframe 里是一块白，而 pk / 白名单 / frame-ancestors 全是配好的、
    // 每个接口都 200，看起来就是「嵌入功能没做好」。
    const res = await request(app).get('/consult/embed');
    expect(res.status).not.toBe(401);
  });

  it('我们自己的 CSP 不能把示例页里那层 iframe 拦掉', async () => {
    // `frame-src` 显式写出来之后**不回落到 default-src**，少了 'self' 的话
    // /sdk/consult-demo.html 里那个 iframe 被我们自己的 CSP 拦掉：一块白 + 一行控制台警告，
    // 而 pk / 白名单 / frame-ancestors 全是配对的，只会让人以为嵌入功能没做好。
    const res = await request(app).get('/xhs');
    expect(res.headers['content-security-policy']).toContain("frame-src 'self'");
  });
});
