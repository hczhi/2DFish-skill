import dns from 'dns/promises';
import net from 'net';

// ============================================================================
// SSRF 防护：凡是"URL 由用户提供、服务端主动去请求"的地方都必须先过这里。
//
// 为什么不能只做字符串校验：`http://internal.example.com` 看起来是公网域名，
// 但它的 A 记录可以指向 127.0.0.1 / 169.254.169.254。所以必须解析 DNS 后
// 校验真实 IP，而不是看域名长什么样。
//
// 三道关：
//   1. 协议白名单 —— 挡掉 file:// gopher:// dict:// 等
//   2. DNS 解析后逐个 IP 校验 —— 挡掉指向内网的公网域名
//   3. 端口白名单 —— 挡掉拿 HTTP 去打 Redis(6379)/MySQL(3306) 这类协议混淆
//
// 注意：DNS 解析和实际请求之间存在 TOCTOU 窗口（DNS rebinding）。真正堵死
// 需要在连接层锁定已校验的 IP。对 Playwright 我们额外在请求拦截里逐个请求
// 复核（见 assertSafeUrl 在 crawlerService 的用法），把重定向/子资源也盖住。
// ============================================================================

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

// 允许的端口：常规 web 端口 + 常见自建端口。空端口(默认 80/443)自然通过。
const ALLOWED_PORTS = new Set(['', '80', '443', '8080', '8443', '3000', '5000']);

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeUrlError';
  }
}

/**
 * 判断一个 IP 是否属于不该被服务端主动访问的网段。
 * 覆盖回环、私有、链路本地(含云元数据 169.254.169.254)、CGNAT、保留段。
 */
export function isBlockedIp(ip: string): boolean {
  const type = net.isIP(ip);
  if (type === 0) return true; // 解析不出合法 IP，一律拒绝

  if (type === 4) {
    const parts = ip.split('.').map(Number);
    const [a, b] = parts;
    if (a === 0) return true;                          // 0.0.0.0/8
    if (a === 10) return true;                         // 10.0.0.0/8 私有
    if (a === 127) return true;                        // 127.0.0.0/8 回环
    if (a === 169 && b === 254) return true;           // 169.254.0.0/16 链路本地 + 云元数据
    if (a === 172 && b >= 16 && b <= 31) return true;  // 172.16.0.0/12 私有
    if (a === 192 && b === 168) return true;           // 192.168.0.0/16 私有
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
    if (a === 192 && b === 0) return true;             // 192.0.0.0/24, 192.0.2.0/24
    if (a >= 224) return true;                         // 组播 224+ / 保留 240+
    return false;
  }

  // IPv6
  const lower = ip.toLowerCase();
  if (lower === '::' || lower === '::1') return true;              // 未指定 / 回环
  if (lower.startsWith('fe80')) return true;                      // 链路本地
  if (/^f[cd]/.test(lower)) return true;                          // fc00::/7 唯一本地地址
  // IPv4-mapped (::ffff:127.0.0.1) —— 递归用 v4 规则判断，否则可绕过
  const mapped = lower.match(/^::ffff:(.+)$/);
  if (mapped) {
    const inner = mapped[1];
    if (net.isIP(inner) === 4) return isBlockedIp(inner);
    // ::ffff:7f00:1 这种十六进制写法
    const hex = inner.split(':');
    if (hex.length === 2 && /^[0-9a-f]{1,4}$/.test(hex[0]) && /^[0-9a-f]{1,4}$/.test(hex[1])) {
      const n = (parseInt(hex[0], 16) << 16) | parseInt(hex[1], 16);
      const v4 = [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
      return isBlockedIp(v4);
    }
    return true;
  }
  return false;
}

/**
 * 校验用户提供的 URL 可以安全地被服务端请求。不安全则抛 UnsafeUrlError。
 * 返回归一化后的 URL 字符串和已解析出的 IP 列表。
 */
export async function assertSafeUrl(raw: string): Promise<{ url: string; addresses: string[] }> {
  if (!raw || typeof raw !== 'string') {
    throw new UnsafeUrlError('URL 不能为空');
  }

  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new UnsafeUrlError('URL 格式不合法');
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new UnsafeUrlError(`不支持的协议 ${parsed.protocol}，仅允许 http/https`);
  }

  if (!ALLOWED_PORTS.has(parsed.port)) {
    throw new UnsafeUrlError(`不允许访问端口 ${parsed.port}`);
  }

  // 凭据混在 URL 里(http://user:pass@host)常被用来绕过解析器差异，直接拒。
  if (parsed.username || parsed.password) {
    throw new UnsafeUrlError('URL 不允许包含用户名/密码');
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, ''); // 去掉 IPv6 字面量的方括号

  // 主机名本身就是 IP：不用查 DNS，直接判。
  if (net.isIP(hostname)) {
    if (isBlockedIp(hostname)) {
      throw new UnsafeUrlError('不允许访问内网或保留地址');
    }
    return { url: parsed.toString(), addresses: [hostname] };
  }

  // localhost 及其变体在部分解析器下不会被上面的 isIP 命中，显式拦一道。
  if (/^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(hostname)) {
    throw new UnsafeUrlError('不允许访问内网主机名');
  }

  let addresses: string[];
  try {
    const records = await dns.lookup(hostname, { all: true, verbatim: true });
    addresses = records.map((r) => r.address);
  } catch {
    throw new UnsafeUrlError('域名解析失败');
  }

  if (addresses.length === 0) {
    throw new UnsafeUrlError('域名未解析到任何地址');
  }

  // 任意一个解析结果落在内网就整体拒绝——多 A 记录里混一条 127.0.0.1
  // 是常见绕过手法，不能只看第一条。
  for (const addr of addresses) {
    if (isBlockedIp(addr)) {
      throw new UnsafeUrlError('不允许访问内网或保留地址');
    }
  }

  return { url: parsed.toString(), addresses };
}

/** 只判断安全与否、不抛异常的版本，用于请求拦截这类热路径。 */
export async function isSafeUrl(raw: string): Promise<boolean> {
  try {
    await assertSafeUrl(raw);
    return true;
  } catch {
    return false;
  }
}
