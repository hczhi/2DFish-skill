import { Request, Response, NextFunction } from 'express';

const buckets = new Map<string, { count: number; resetAt: number }>();

setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt < now) buckets.delete(key);
  }
}, 60_000);

/**
 * 清空所有计数桶。**只给测试用。**
 *
 * 单个测试文件里所有用例共用同一个进程和同一批测试用户，于是它们共用一个桶：
 * 一个路由的用例攒到 60 个请求之后，后面新加的用例会莫名收到 429 —— 而现象是
 * 「一个和限流毫无关系的断言突然红了」，且**红的是最后添加的那个用例**，
 * 看起来像是新代码的 bug。测试文件在 beforeEach 里调一次它，就没有这个耦合。
 */
export function resetRateLimits(): void {
  buckets.clear();
}

let limiterSeq = 0;

export function rateLimit(maxRequests = 60, windowMs = 60_000, keyOf?: (req: Request) => string) {
  // 每条规则各记各的：只按「谁」分桶的话，所有规则共用一个计数，登录那条「5 次/分钟」
  // 数的是这个 IP 这一分钟里**所有**限流路由的请求（一次登录还同时过 /api/auth/login 和
  // /api/auth 两道 = 算两次）—— 于是密码明明对，点第三下就是「请求太频繁」。
  const ns = ++limiterSeq;
  return (req: Request, res: Response, next: NextFunction) => {
    const who = req.authMethod === 'api_token'
      ? `token:${req.headers.authorization?.slice(7, 19)}`
      : `user:${req.user?.id || req.ip}`;
    const key = `${ns}:${keyOf ? keyOf(req) : who}`;

    const now = Date.now();
    let bucket = buckets.get(key);

    if (!bucket || bucket.resetAt < now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }

    bucket.count++;

    res.setHeader('X-RateLimit-Limit', String(maxRequests));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, maxRequests - bucket.count)));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > maxRequests) {
      const secs = Math.ceil((bucket.resetAt - now) / 1000);
      res.status(429).json({ error: 'rate_limit_exceeded', detail: `请求太频繁，请 ${secs} 秒后再试`, retry_after_ms: bucket.resetAt - now });
      return;
    }

    next();
  };
}
