// 第三方 iframe 嵌入模式（084）。这份文件只管一件事：iframe 里的工作台怎么拿到、
// 怎么续上那个 15 分钟的短 token —— 换 token 这一下**只能由宿主页面发**（在 iframe 里发的话
// Origin 是我们自己的域名，pk 的域名白名单对每个 pk 都成立，等于没配），所以 token 只能靠
// postMessage 从宿主那边要过来。
//
// token **只放在内存里**，绝不 setToken()：那把短 token 会盖掉 localStorage 里用户自己的
// 登录态（iframe 和我们自己的站点同源，共用一份 localStorage）—— 他在另一个标签页里会突然
// 变成一个只能碰 /consult 的账号，界面上看起来就是「莫名其妙被降权/退出了」。
//
// 是不是嵌入模式记在 sessionStorage（按标签页 + 按源，宿主那个标签页和用户自己浏览我们站点的
// 标签页互不影响）：刷新 iframe 之后内存里的 token 没了，只有这个标记能让我们重新去要一次，
// 而不是在别人的页面里弹出我们的登录框。

const FLAG_KEY = 'qn-consult-embed';
const HOST_KEY = 'qn-consult-embed-host';
/** 宿主 ⇄ iframe 之间所有消息都带这个字段，避免和宿主页面里别的 postMessage 混起来。 */
export const EMBED_CHANNEL = 'qn-consult';

let memToken: string | null = null;
let tokenExpiresAt = 0;
let pending: Promise<string | null> | null = null;
let lastError = '';

export function isEmbedMode(): boolean {
  try {
    return sessionStorage.getItem(FLAG_KEY) === '1';
  } catch {
    return false; // 无痕/禁用存储：当成普通模式，登录框至少是能看懂的失败
  }
}

/** 记下「这一页是被嵌进去的」+ 宿主的 Origin（postMessage 的目标，必须精确到源）。 */
export function markEmbedMode(hostOrigin: string): void {
  try {
    sessionStorage.setItem(FLAG_KEY, '1');
    sessionStorage.setItem(HOST_KEY, hostOrigin);
  } catch {
    /* 存不上也照跑：这一次能用，刷新之后会退化成要重新握手 */
  }
}

export function embedHostOrigin(): string | null {
  try {
    return sessionStorage.getItem(HOST_KEY);
  } catch {
    return null;
  }
}

export function embedToken(): string | null {
  return memToken;
}

export function setEmbedToken(token: string, expiresInSeconds: number): void {
  memToken = token;
  tokenExpiresAt = Date.now() + expiresInSeconds * 1000;
}

export function clearEmbedToken(): void {
  memToken = null;
  tokenExpiresAt = 0;
}

/** 快到期了（留 90 秒余量）。到期前主动换，省掉一次必然失败的请求。 */
export function embedTokenStale(): boolean {
  return !memToken || Date.now() > tokenExpiresAt - 90_000;
}

/**
 * 向宿主页面要一个新的短 token。并发调用共享同一次握手 —— 各自要一份的话
 * 宿主那边会连着换好几次 token（换取接口有每分钟限流，撞上就整个工作台 429，
 * 而那句话说的是「换取太频繁」，接入方看不出是我们自己刷的）。
 */
export function requestEmbedToken(timeoutMs = 10_000): Promise<string | null> {
  if (pending) return pending;
  const host = embedHostOrigin();
  pending = new Promise<string | null>((resolve) => {
    if (!host || window.parent === window) {
      resolve(null);
      return;
    }
    let done = false;
    const finish = (v: string | null) => {
      if (done) return;
      done = true;
      window.removeEventListener('message', onMessage);
      clearTimeout(timer);
      pending = null;
      resolve(v);
    };
    const onMessage = (ev: MessageEvent) => {
      // 源必须对得上：不校验的话页面上任何一个第三方脚本都能塞一个 token 进来。
      if (ev.origin !== host) return;
      const data = ev.data;
      if (!data || data.channel !== EMBED_CHANNEL || data.type !== 'token') return;
      if (!data.token) {
        // 宿主换 token 失败时会把服务端那句原文带过来（域名白名单 / key 停用 / 限流，
        // 三种解法完全不同）。存下来给引导页显示 —— 只显示我们自己那句泛泛的
        // 「没拿到凭证」的话，接入方得去翻宿主页面的控制台才知道到底是哪一种。
        lastError = String(data.error || '');
        finish(null);
        return;
      }
      lastError = '';
      setEmbedToken(String(data.token), Number(data.expiresIn) || 900);
      finish(String(data.token));
    };
    window.addEventListener('message', onMessage);
    const timer = setTimeout(() => finish(null), timeoutMs);
    window.parent.postMessage({ channel: EMBED_CHANNEL, type: 'token-request' }, host);
  });
  return pending;
}

/** 宿主上次换 token 时报回来的原因（没有就是空串：它压根没回应）。 */
export function embedTokenError(): string {
  return lastError;
}

/** 把当前高度告诉宿主，让它把 iframe 拉到内容那么高（不然内容被裁掉，看起来像页面没画完）。 */
export function startEmbedHeightReporter(): void {
  const host = embedHostOrigin();
  if (!host || window.parent === window) return;
  let last = 0;
  const report = () => {
    const h = Math.ceil(document.documentElement.scrollHeight);
    if (Math.abs(h - last) < 8) return;
    last = h;
    window.parent.postMessage({ channel: EMBED_CHANNEL, type: 'height', height: h }, host);
  };
  new ResizeObserver(report).observe(document.documentElement);
  window.addEventListener('load', report);
  setInterval(report, 1000);
}

/** 把一句人能读的失败原因送到宿主页面（onError 回调）—— 只在 iframe 里显示的话接入方看不到。 */
export function reportEmbedError(message: string): void {
  const host = embedHostOrigin();
  if (!host || window.parent === window) return;
  window.parent.postMessage({ channel: EMBED_CHANNEL, type: 'error', message }, host);
}
