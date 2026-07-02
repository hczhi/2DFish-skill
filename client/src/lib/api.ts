import { getToken } from './auth';
import { handleQuotaExceeded } from './quota';

export async function api(url: string, options: RequestInit = {}): Promise<Response> {
  const token = getToken();
  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(url, { ...options, headers });

  if (response.status === 429) {
    const data = await response.clone().json().catch(() => ({}));
    if (data.error === 'quota_exceeded') {
      handleQuotaExceeded(data);
    }
  }

  return response;
}

export async function apiGet<T = any>(url: string): Promise<T> {
  const res = await api(url);
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function apiPost<T = any>(url: string, body?: unknown): Promise<T> {
  const res = await api(url, {
    method: 'POST',
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function apiDelete<T = any>(url: string): Promise<T> {
  const res = await api(url, { method: 'DELETE' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return res.json();
}
