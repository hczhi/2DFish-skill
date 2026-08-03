export interface AuthUser {
  id: string;
  username: string;
  role: 'admin' | 'user';
  model?: string | null;
  apiBaseUrl?: string | null;
}

const TOKEN_KEY = 'mmPla_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

// 登录/注册/取当前用户这三个刻意不走 api()：
// 前两个此时还没有 token，且它们的 401 意思是"密码错误"，
// 交给 api() 会清 token 再弹登录框——而调用方本身就是登录框。
// fetchMe 有自己的 401 语义（清 token 但保留 meCache 兜底）。
export async function login(username: string, password: string): Promise<{ token: string; user: AuthUser }> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Login failed');
  }
  const data = await res.json();
  setToken(data.token);
  return data;
}

export async function register(username: string, password: string): Promise<{ token: string; user: AuthUser }> {
  const res = await fetch('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Registration failed');
  }
  const data = await res.json();
  setToken(data.token);
  return data;
}

let meCache: { user: AuthUser; ts: number } | null = null;
const ME_CACHE_TTL = 30_000;

export async function fetchMe(): Promise<AuthUser | null> {
  const token = getToken();
  if (!token) return null;

  if (meCache && Date.now() - meCache.ts < ME_CACHE_TTL) {
    return meCache.user;
  }

  const res = await fetch('/api/auth/me', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    if (res.status === 401) {
      clearToken();
      meCache = null;
    }
    return meCache?.user || null;
  }
  const user = await res.json();
  meCache = { user, ts: Date.now() };
  return user;
}

export function clearMeCache(): void {
  meCache = null;
}

export function logout(): void {
  clearToken();
  clearMeCache();
  window.location.href = '/';
}

export function isAdmin(user: AuthUser | null): boolean {
  return user?.role === 'admin';
}

/**
 * 带 token 的 fetch。返回原始 Response（调用方自己判 res.ok），
 * 和 apiGet/apiPost 那套"非 2xx 直接抛"的语义不同，所以保留成独立入口。
 *
 * 实现委托给 api()：原来它只拼一个 Authorization 头就直接 fetch，
 * 于是 40 多个后台页面的请求全都绕开了 401 清 token + 弹登录、
 * 429 弹额度这两层处理——token 过期时页面只会静默变空白。
 *
 * 动态 import 是为了断开 auth.ts ⇄ api.ts 的循环依赖
 * （api.ts 顶层就要 import getToken）。
 */
export async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const { api } = await import('./api');
  return api(url, options);
}

/**
 * Check if user is logged in. If not, open login modal and return false.
 * Usage: if (!await requireAuth()) return;
 */
export async function requireAuth(reason = 'ai'): Promise<boolean> {
  const token = getToken();
  if (token) {
    const user = await fetchMe();
    if (user) return true;
  }
  const { openLoginModal } = await import('./loginModal');
  openLoginModal(window.location.pathname, reason);
  return false;
}
