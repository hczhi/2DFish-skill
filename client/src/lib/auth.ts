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

export function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = getToken();
  const headers = new Headers(options.headers);
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return fetch(url, { ...options, headers });
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
