import { getToken, clearToken } from './auth';
import { handleQuotaExceeded } from './quota';
import { openLoginModal } from './loginModal';

export async function api(url: string, options: RequestInit = {}): Promise<Response> {
  const token = getToken();
  const headers = new Headers(options.headers);
  // FormData 必须让浏览器自己写 Content-Type —— 它要在里面附上 multipart 的
  // boundary。手动盖成 application/json 的话后端解析不出任何字段，上传直接失败。
  if (!(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(url, { ...options, headers });

  if (response.status === 401) {
    clearToken();
    openLoginModal(window.location.pathname, 'ai');
  }

  if (response.status === 429) {
    const data = await response.clone().json().catch(() => ({}));
    if (data.error === 'quota_exceeded') {
      handleQuotaExceeded(data);
    }
  }

  return response;
}

export async function apiGet<T = any>(url: string, params?: Record<string, any>): Promise<T> {
  let fullUrl = url;
  if (params) {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') {
        searchParams.set(key, String(value));
      }
    }
    const qs = searchParams.toString();
    if (qs) fullUrl += `?${qs}`;
  }
  const res = await api(fullUrl);
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

export async function apiPut<T = any>(url: string, body?: unknown): Promise<T> {
  const res = await api(url, {
    method: 'PUT',
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function apiPatch<T = any>(url: string, body?: unknown): Promise<T> {
  const res = await api(url, {
    method: 'PATCH',
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

// ===== 流式接口 =====
//
// 各页面原来是自己 fetch + 手拼 Authorization 头来读 SSE 流的（xhs 3 处、
// XhsWriter/XhsSkills/DiscoverManagement 各 1 处）。绕开 api() 的直接后果是：
// AI 额度用光时后端返回 429 quota_exceeded，但这些页面只会 throw '生成失败'
// —— 额度弹窗永远不出现，用户看到的是"功能坏了"而不是"额度用完了"。
// token 过期(401)同理：不会触发登录弹窗。
//
// 这两个 helper 走同一个 api()，因此 401/429 的处理和普通请求完全一致。

/** 打开一个 POST 流并返回 Response。错误已按 api() 的规则处理过。 */
export async function apiStream(
  url: string,
  body?: unknown,
  options: { signal?: AbortSignal; failMessage?: string } = {}
): Promise<Response> {
  const res = await api(url, {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: options.signal,
  });
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || options.failMessage || `HTTP ${res.status}`);
  }
  return res;
}

/**
 * 逐条读出 SSE 的 data: 负载。
 *
 * 分帧按空行（\n\n）切，而不是按单个 \n —— 后端的 detail 字段里可能带换行，
 * 按 \n 切会把一帧劈成两半导致 JSON.parse 失败。
 * '[DONE]' 这个哨兵直接吞掉，调用方不用各自判一遍。
 */
export async function* streamSSEData(res: Response): AsyncGenerator<any> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split('\n\n');
    buffer = frames.pop() || '';
    for (const frame of frames) {
      const m = frame.match(/^data: (.+)$/m);
      if (!m || m[1] === '[DONE]') continue;
      let parsed: any;
      try { parsed = JSON.parse(m[1]); } catch { continue; }
      yield parsed;
    }
  }
}
