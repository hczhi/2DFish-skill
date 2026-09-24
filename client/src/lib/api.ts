import { getToken, clearToken } from './auth';
import { handleQuotaExceeded } from './quota';
import { openLoginModal } from './loginModal';
import { isEmbedMode, clearEmbedToken, requestEmbedToken, reportEmbedError } from './embed';
import { activeKeyApp, activeAppKey, clearAppKey, scheduleKeyInfoRefresh } from './appKey';

export async function api(url: string, options: RequestInit = {}, retried = false): Promise<Response> {
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
    // 嵌入模式（084）：短 token 只活 15 分钟，过期是常态，而**绝不能弹我们的登录框**
    // —— 那个框出现在第三方页面里，用户既没有我们平台的账号，也看不出是凭证过期。
    // 向宿主页面要一把新的，然后把这次请求重放一遍（只重放一次，避免死循环）。
    if (isEmbedMode()) {
      clearEmbedToken();
      if (!retried && (await requestEmbedToken())) {
        return api(url, options, true);
      }
      // 要不到：必须让调用方拿到一个说得清成因的失败，不能静默返回 401
      // （页面上那会儿是一片空白，读起来像功能坏了）。
      reportEmbedError('访问凭证已过期，宿主页面没有换到新的。请刷新页面重试。');
      return new Response(
        JSON.stringify({ error: '访问凭证已过期（嵌入模式），宿主页面没有换到新的凭证。请刷新页面重试。' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }
    // 应用 key（112）：没有登录框可弹，带着服务端给的真实成因（停用 / 查无此 key）回输入页。
    // 弹登录框的话买家面对的是一个他压根没有账号的表单。
    const app = activeKeyApp();
    if (app && activeAppKey()) {
      const data = await response.clone().json().catch(() => ({}));
      clearAppKey(app);
      const q = new URLSearchParams({ reason: data.error || 'key 已失效', next: window.location.pathname });
      window.location.href = `/${app}/key?${q}`;
      return response;
    }
    clearToken();
    openLoginModal(window.location.pathname, 'ai');
  }

  // key 模式下每次改动类请求之后刷一次右上角点数：扣点发生在服务端，不刷的话他看到的余额
  // 一直是进页面那一刻的数，用光时才突然弹「点数不足」。
  if (activeKeyApp() && (options.method || 'GET').toUpperCase() !== 'GET') scheduleKeyInfoRefresh()

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
