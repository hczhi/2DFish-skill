// 第三方 iframe 嵌入模式（084 咨询 / 100 展示稿）。这份文件只管一件事：iframe 里的工作台
// 怎么拿到、怎么续上那个 15 分钟的短 token —— 换 token 这一下**只能由宿主页面发**（在 iframe
// 里发的话 Origin 是我们自己的域名，pk 的域名白名单对每个 pk 都成立，等于没配），所以 token
// 只能靠 postMessage 从宿主那边要过来。
//
// token **只放在内存里**，绝不 setToken()：那把短 token 会盖掉 localStorage 里用户自己的
// 登录态（iframe 和我们自己的站点同源，共用一份 localStorage）—— 他在另一个标签页里会突然
// 变成一个只能碰 /consult 的账号，界面上看起来就是「莫名其妙被降权/退出了」。
//
// 是不是嵌入模式记在 sessionStorage（按标签页 + 按源，宿主那个标签页和用户自己浏览我们站点的
// 标签页互不影响）：刷新 iframe 之后内存里的 token 没了，只有这个标记能让我们重新去要一次，
// 而不是在别人的页面里弹出我们的登录框。
//
// **消息通道按模块分（`qn-consult` / `qn-ppt`）**，两个模块共用一个的话：宿主页面上同时嵌了
// 两个工作台时，展示稿 iframe 那句 `token-request` 会被咨询那个 SDK 接住并回一把
// `consult:embed` 的 token —— 展示稿这边拿到 token 当成握手成功，然后每个接口都 403，
// 现象是「整个模块坏了」，而 pk、白名单、限额全是配好的。

type EmbedModule = 'consult' | 'ppt';

const MODULE_KEY = 'qn-embed-module';
const HOST_KEY = 'qn-embed-host';
/** 084 那版只有咨询，键名是写死的。留着读一次：升级那一刻宿主页面里已经打开的 iframe
 *  刷新之后读不到新键，会在第三方页面里弹出我们的登录框（用户压根没有我们的账号）。 */
const LEGACY_CONSULT_FLAG = 'qn-consult-embed';
const LEGACY_CONSULT_HOST = 'qn-consult-embed-host';

/** 本次页面加载记住的模块。内存优先于 sessionStorage：无痕/禁用存储时写不进去，
 *  只读存储的话展示稿这一页会回落成 consult 通道 —— 宿主换到的 token 被当成「不是给我的」
 *  丢掉，现象是干等 10 秒后一句「没拿到凭证」，而宿主那边一切正常。 */
let memModule: EmbedModule | null = null;
let memHost: string | null = null;
let memToken: string | null = null;
let tokenExpiresAt = 0;
let pending: Promise<string | null> | null = null;
let lastError = '';

/** 这个标签页嵌的是哪个模块（不是嵌入模式就是 null）。 */
export function embedModule(): EmbedModule | null {
  if (memModule) return memModule;
  try {
    const m = sessionStorage.getItem(MODULE_KEY);
    if (m === 'consult' || m === 'ppt') return m;
    return sessionStorage.getItem(LEGACY_CONSULT_FLAG) === '1' ? 'consult' : null;
  } catch {
    return null; // 无痕/禁用存储：当成普通模式，登录框至少是能看懂的失败
  }
}

export function isEmbedMode(): boolean {
  return embedModule() !== null;
}

/** 宿主 ⇄ iframe 之间所有消息都带这个字段，避免和宿主页面里别的 postMessage 混起来。 */
export function embedChannel(): string {
  return `qn-${embedModule() || 'consult'}`;
}

/** 记下「这一页是被嵌进去的、嵌的是哪个模块」+ 宿主的 Origin（postMessage 的目标，必须精确到源）。 */
export function markEmbedMode(module: EmbedModule, hostOrigin: string): void {
  memModule = module;
  memHost = hostOrigin;
  try {
    sessionStorage.setItem(MODULE_KEY, module);
    sessionStorage.setItem(HOST_KEY, hostOrigin);
  } catch {
    /* 存不上也照跑：这一次能用，刷新之后会退化成要重新握手 */
  }
}

export function embedHostOrigin(): string | null {
  if (memHost) return memHost;
  try {
    return sessionStorage.getItem(HOST_KEY) || sessionStorage.getItem(LEGACY_CONSULT_HOST);
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
  // 发出去和收回来必须是同一个通道值（下面全程用它）。
  const channel = embedChannel();
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
      if (!data || data.channel !== channel || data.type !== 'token') return;
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
    window.parent.postMessage({ channel, type: 'token-request' }, host);
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
    window.parent.postMessage({ channel: embedChannel(), type: 'height', height: h }, host);
  };
  new ResizeObserver(report).observe(document.documentElement);
  window.addEventListener('load', report);
  setInterval(report, 1000);
}

/** 把一句人能读的失败原因送到宿主页面（onError 回调）—— 只在 iframe 里显示的话接入方看不到。 */
export function reportEmbedError(message: string): void {
  const host = embedHostOrigin();
  if (!host || window.parent === window) return;
  window.parent.postMessage({ channel: embedChannel(), type: 'error', message }, host);
}
