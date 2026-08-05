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

export function rateLimit(maxRequests = 60, windowMs = 60_000) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.authMethod === 'api_token'
      ? `token:${req.headers.authorization?.slice(7, 19)}`
      : `user:${req.user?.id || req.ip}`;

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
      res.status(429).json({ error: 'rate_limit_exceeded', retry_after_ms: bucket.resetAt - now });
      return;
    }

    next();
  };
}
