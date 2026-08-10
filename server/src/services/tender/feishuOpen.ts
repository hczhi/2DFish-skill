import { decryptSecret } from '../../core/secrets.js';

// 飞书开放平台调用的公共底座：tenant_access_token + 统一的接口调用/报错。
//
// 从 feishuBitable.ts 里抽出来，是因为标讯模块现在有**两条**都要用应用凭据的通道：
// 多维表格写记录，和推送卡片到群（feishuNotify.ts）。两条通道共用同一个自建应用，
// 就必须共用同一份 token 缓存 —— 各自缓存一份的后果是后台改了 App Secret 时
// invalidateTokenCache 只清掉其中一个，另一条通道继续拿旧 secret 换来的 token
// 直到两小时后自然过期，期间报的错还是「凭据无效」，看起来像改的没生效。
//
// 这个文件只依赖 core/secrets，不依赖 db，也不认识标讯/表格/卡片任何业务概念。

export const OPEN_BASE = 'https://open.feishu.cn/open-apis';

export interface FeishuAppCred {
  appId: string;
  /** 库里存的密文（migrations/050）。解密只在本文件发生。 */
  appSecret: string;
}

interface TokenCacheEntry {
  token: string;
  expireAtMs: number;
}

// 按 app_id 缓存（每家客户一个自建应用）。token 有效期 2h，提前 5min 过期避免边界失效。
const tokenCache = new Map<string, TokenCacheEntry>();

export async function getTenantToken(appId: string, appSecret: string, nowMs: number): Promise<string> {
  const cached = tokenCache.get(appId);
  if (cached && cached.expireAtMs > nowMs) return cached.token;

  // app_secret 在库里是加密的（migrations/050）。解密收在这一个点上：
  // 它是 secret 唯一真正被使用的地方，各处 SELECT 出来的密文可以照原样传递，
  // 于是 tender.ts 那几个只是把 row 转手传进来的调用点一行都不用改。
  // decryptSecret 对旧明文原样返回，解不开则抛出可读原因。
  const plainSecret = decryptSecret(appSecret);

  const res = await fetch(`${OPEN_BASE}/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ app_id: appId, app_secret: plainSecret }),
    signal: AbortSignal.timeout(15000),
  });

  const data = (await res.json().catch(() => ({}))) as {
    code?: number;
    msg?: string;
    tenant_access_token?: string;
    expire?: number;
  };

  if (data.code !== 0 || !data.tenant_access_token) {
    throw new Error(`获取 tenant_access_token 失败（code=${data.code ?? '?'} ${data.msg ?? ''}）`);
  }

  const ttlSec = typeof data.expire === 'number' ? data.expire : 7200;
  tokenCache.set(appId, {
    token: data.tenant_access_token,
    expireAtMs: nowMs + Math.max(60, ttlSec - 300) * 1000,
  });
  return data.tenant_access_token;
}

// 凭据改了要立刻失效，否则后台换了 secret 还在用旧 token。
export function invalidateTokenCache(appId?: string): void {
  if (appId) tokenCache.delete(appId);
  else tokenCache.clear();
}

/**
 * 飞书的错误码基本都不自解释，而这几个是配置阶段 100% 会撞到的。
 * 不给提示的话，管理员看到的就是一串数字，然后来问「是不是功能坏了」。
 */
function hintFor(code: number | undefined, httpStatus: number, path: string): string {
  if (code === 230013) return '（请把该应用作为机器人拉进这个群，并确认群 ID 填的是这个群）';
  if (code === 230002 || code === 232006) return '（群 ID 不存在或应用不可见，确认 oc_ 开头的 ID 复制完整）';
  if (code === 99991672 || code === 99991679) {
    return path.startsWith('/im/')
      ? '（应用缺少 im:message:send_as_bot 权限，开通后需要重新创建版本并发布）'
      : '（应用缺少所需权限，开通后需要重新创建版本并发布）';
  }
  if (code === 1254302 || httpStatus === 403) {
    return '（请确认应用已被添加为该多维表格的文档应用并授予「可编辑」）';
  }
  return '';
}

export async function callOpenApi(
  token: string,
  path: string,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  body?: unknown
): Promise<any> {
  const res = await fetch(`${OPEN_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${token}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });

  const data = (await res.json().catch(() => ({}))) as { code?: number; msg?: string; data?: any };
  if (data.code !== 0) {
    throw new Error(
      `飞书接口 ${path} 失败（code=${data.code ?? res.status} ${data.msg ?? ''}）${hintFor(data.code, res.status, path)}`
    );
  }
  return data.data ?? {};
}
