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

export async function fetchMe(): Promise<AuthUser | null> {
  const token = getToken();
  if (!token) return null;

  const res = await fetch('/api/auth/me', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    clearToken();
    return null;
  }
  return res.json();
}

export function logout(): void {
  clearToken();
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
