import { describe, it, expect } from 'vitest';
import { assertSafeUrl, isSafeUrl, isBlockedIp, UnsafeUrlError } from './safeUrl.js';

describe('isBlockedIp', () => {
  it('拦截云元数据地址（SSRF 最高价值目标）', () => {
    expect(isBlockedIp('169.254.169.254')).toBe(true);
  });

  it('拦截各类私有/回环/保留网段', () => {
    const blocked = [
      '127.0.0.1', '127.1.2.3',
      '10.0.0.1', '10.255.255.255',
      '172.16.0.1', '172.31.255.254',
      '192.168.1.1',
      '100.64.0.1',            // CGNAT
      '0.0.0.0',
      '192.0.0.1',
      '224.0.0.1', '255.255.255.255',
      '::1', '::', 'fe80::1', 'fc00::1', 'fd12::34',
      '::ffff:127.0.0.1',      // IPv4-mapped 回环
      '::ffff:169.254.169.254',
    ];
    for (const ip of blocked) {
      expect(isBlockedIp(ip), `${ip} 应被拦截`).toBe(true);
    }
  });

  it('放行公网地址', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.32.0.1', '2606:4700::1111']) {
      expect(isBlockedIp(ip), `${ip} 应放行`).toBe(false);
    }
  });

  it('非法输入按拦截处理（fail-closed）', () => {
    for (const s of ['', 'not-an-ip', '999.999.999.999']) {
      expect(isBlockedIp(s)).toBe(true);
    }
  });
});

describe('assertSafeUrl', () => {
  it('拒绝非 http(s) 协议', async () => {
    for (const u of ['file:///etc/passwd', 'gopher://x/', 'ftp://a/b', 'javascript:alert(1)']) {
      await expect(assertSafeUrl(u)).rejects.toThrow(UnsafeUrlError);
    }
  });

  it('拒绝 localhost 及内网风格域名（无需 DNS 即可判定）', async () => {
    for (const u of ['http://localhost/', 'http://LOCALHOST:8080/', 'http://foo.local/', 'http://svc.internal/']) {
      await expect(assertSafeUrl(u)).rejects.toThrow(UnsafeUrlError);
    }
  });

  it('拒绝直接指向内网 IP 的 URL', async () => {
    for (const u of [
      'http://169.254.169.254/latest/meta-data/',
      'http://127.0.0.1:3001/api/admin/users',
      'http://10.0.0.5/',
      'http://[::1]/',
    ]) {
      await expect(assertSafeUrl(u)).rejects.toThrow(UnsafeUrlError);
    }
  });

  it('拒绝带内嵌凭据的 URL（用于绕过 host 解析的经典手法）', async () => {
    await expect(assertSafeUrl('http://user:pass@example.com/')).rejects.toThrow(UnsafeUrlError);
  });

  it('拒绝非白名单端口（防内网端口扫描）', async () => {
    await expect(assertSafeUrl('http://example.com:22/')).rejects.toThrow(UnsafeUrlError);
    await expect(assertSafeUrl('http://example.com:6379/')).rejects.toThrow(UnsafeUrlError);
  });

  it('拒绝空/垃圾输入', async () => {
    for (const u of ['', 'not a url', '///']) {
      await expect(assertSafeUrl(u as string)).rejects.toThrow(UnsafeUrlError);
    }
  });
});

describe('isSafeUrl', () => {
  it('对不安全 URL 返回 false 而不是抛错（用于请求拦截热路径）', async () => {
    expect(await isSafeUrl('http://169.254.169.254/')).toBe(false);
    expect(await isSafeUrl('file:///etc/passwd')).toBe(false);
  });
});
