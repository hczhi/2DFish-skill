/**
 * 品牌咨询 嵌入 SDK（084）
 * ------------------------------------------------------------------
 * 第三方**纯前端**页面用这个把品牌咨询工作台挂进自己的站点：
 *
 *   import { mountConsult } from '@qiaonan/tender-sdk/consult'   // ESM
 *   // 或 <script src=".../consult-sdk.umd.cjs"></script> 后用 window.ConsultSDK
 *
 *   const consult = mountConsult({
 *     pk: 'pk_consult_xxx',
 *     baseUrl: 'https://your.host',
 *     externalUid: 'your-end-user-id',     // 必填，见下
 *     target: '#consult',
 *     onError: (msg) => alert(msg),
 *   })
 *
 * 工作台本体是我们自己那套页面，跑在一个 iframe 里（一份 UI 不做第二遍）。这个文件只做
 * 三件事：建 iframe、**在宿主页面这一侧**用 pk 换短 token 递进去、按 iframe 报上来的高度
 * 拉高容器。
 *
 * ## 为什么换 token 必须在这一侧发
 *
 * pk 绑着一份域名白名单，服务端校验的是**请求的 Origin**。让 iframe 里的页面自己去换的话，
 * 那个 Origin 是**我们的**域名，白名单于是对每个 pk 都成立 —— 后台看着配了，实际任何域名
 * 都能用。所以 iframe 只会发一句 `token-request`，真正的换取在这里。
 *
 * ## externalUid 是展示隔离，不是安全边界
 *
 * 它是「这些项目属于你哪个终端用户」的键，必填。但它是从这个页面传出去的，纯前端下
 * 你的用户改一下就能读到同一把 key 下别人的项目和客户原始资料。**别用它装真客户的
 * 品牌资料**；要真隔离，你得出一个最小后端来签这个值。
 */

/** 宿主 ⇄ iframe 之间所有消息都带这个字段，避免和页面里别的 postMessage 混起来。 */
const CHANNEL = 'qn-consult';

export interface MountConsultOptions {
  /** 平台签发的 publishable key（pk_consult_...）。公开值，写在页面 JS 里没问题。 */
  pk: string;
  /** 平台地址，如 https://your.host（不含末尾 /api）。 */
  baseUrl: string;
  /** 你这边终端用户的稳定 id。必填 —— 不传的话所有用户共用一个工作台。 */
  externalUid: string;
  /** 挂载容器（选择器或元素）。 */
  target: string | HTMLElement;
  /** 打开哪一页，默认项目列表。只能是 /consult/projects 下的路径。 */
  path?: string;
  /** iframe 初始高度（px），默认 900。之后按内容自动调整。 */
  height?: number;
  /** 关掉自动调高（自己给容器定高时用）。默认开。 */
  autoHeight?: boolean;
  /**
   * 出错时的回调。**强烈建议接上**：不接的话失败只会写进控制台，
   * 而页面上是一块空白的 iframe，读起来像「你们的东西坏了」。
   */
  onError?: (message: string) => void;
}

export interface ConsultEmbedHandle {
  /** 底层 iframe，需要自己调样式时用。 */
  readonly iframe: HTMLIFrameElement;
  /** 拆掉 iframe 和消息监听（SPA 里换页时记得调，不然监听会一直挂着）。 */
  destroy(): void;
}

interface TokenResponse {
  token: string;
  expires_in: number;
}

export function mountConsult(opts: MountConsultOptions): ConsultEmbedHandle {
  const pk = String(opts.pk || '');
  const baseUrl = String(opts.baseUrl || '').replace(/\/$/, '');
  const externalUid = String(opts.externalUid || '').trim();

  if (!pk) throw new Error('[ConsultSDK] pk is required');
  if (!baseUrl) throw new Error('[ConsultSDK] baseUrl is required');
  // 这里直接抛而不是兜一个缺省值：默认成空串的话你所有终端用户共用一个归属键，
  // A 客户的品牌资料会出现在 B 客户的项目列表里，而那个列表读起来完全正常。
  if (!externalUid) {
    throw new Error(
      '[ConsultSDK] externalUid is required — 它是「项目属于你哪个终端用户」的键。' +
        '所有人真的共用一个工作台时，才传一个固定值。'
    );
  }

  const container = resolveTarget(opts.target);
  const path = opts.path || '/consult/projects';
  const autoHeight = opts.autoHeight !== false;

  const report = (message: string) => {
    if (opts.onError) opts.onError(message);
    else console.error('[ConsultSDK]', message);
  };

  const embedOrigin = originOf(baseUrl);
  const iframe = document.createElement('iframe');
  iframe.src =
    `${baseUrl}/consult/embed` +
    `?host=${encodeURIComponent(window.location.origin)}` +
    `&next=${encodeURIComponent(path)}`;
  iframe.style.width = '100%';
  iframe.style.height = `${opts.height || 900}px`;
  iframe.style.border = '0';
  iframe.setAttribute('title', '品牌咨询工作台');
  // 允许剪贴板：工作台里有「复制正文」这类按钮，不给的话点下去静默无事发生。
  iframe.setAttribute('allow', 'clipboard-write');

  let token: string | null = null;
  let expiresAt = 0;
  let pending: Promise<TokenResponse | null> | null = null;

  /**
   * 换一把短 token。并发共享同一次请求，且没过期就复用 —— 每次 `token-request`
   * 都真发一次的话，iframe 一刷新就多一次，撞上换取接口的每分钟限流之后整个工作台
   * 429，而那句话说的是「换取太频繁」，你只会以为是自己的用户点太快了。
   */
  const exchange = async (): Promise<TokenResponse | null> => {
    if (token && Date.now() < expiresAt - 90_000) {
      return { token, expires_in: Math.round((expiresAt - Date.now()) / 1000) };
    }
    if (pending) return pending;
    pending = (async () => {
      try {
        const res = await fetch(`${baseUrl}/api/consult/sdk/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pk, externalUid }),
        });
        if (!res.ok) {
          // 把服务端那句原文带出去：403 是域名白名单没配这个域名、401 是 key 停用了、
          // 429 是换太频繁，三种解法完全不同，合成一句「加载失败」等于指错方向。
          throw new Error(`换取访问凭证失败（HTTP ${res.status}）：${await safeErr(res)}`);
        }
        const data = (await res.json()) as TokenResponse;
        token = data.token;
        expiresAt = Date.now() + (Number(data.expires_in) || 900) * 1000;
        return data;
      } finally {
        pending = null;
      }
    })();
    return pending;
  };

  const onMessage = async (ev: MessageEvent) => {
    // 两道都要：源对不上说明不是我们的 iframe 发的；source 对不上说明是页面上
    // 另一个同源 iframe（比如挂了两个工作台）—— 不判的话 token 会递给另一个。
    if (ev.origin !== embedOrigin) return;
    if (iframe.contentWindow && ev.source !== iframe.contentWindow) return;
    const data = ev.data;
    if (!data || data.channel !== CHANNEL) return;

    if (data.type === 'token-request') {
      try {
        const t = await exchange();
        post({ type: 'token', token: t?.token || null, expiresIn: t?.expires_in || 0 });
      } catch (e: any) {
        const msg = e?.message || '换取访问凭证失败';
        // 失败也要**回一条**：不回的话 iframe 会干等 10 秒超时，然后显示一句泛泛的
        // 「没拿到凭证」，而真实成因（域名/停用/限流）只在这里。
        post({ type: 'token', token: null, error: msg });
        report(msg);
      }
      return;
    }
    if (data.type === 'height' && autoHeight) {
      const h = Number(data.height);
      if (h > 0) iframe.style.height = `${h}px`;
      return;
    }
    if (data.type === 'error') {
      report(String(data.message || '工作台报了一个错误'));
    }
  };

  const post = (payload: Record<string, unknown>) => {
    iframe.contentWindow?.postMessage({ channel: CHANNEL, ...payload }, embedOrigin);
  };

  window.addEventListener('message', onMessage);
  container.appendChild(iframe);

  return {
    iframe,
    destroy() {
      window.removeEventListener('message', onMessage);
      iframe.remove();
    },
  };
}

function resolveTarget(target: string | HTMLElement): HTMLElement {
  const el = typeof target === 'string' ? document.querySelector<HTMLElement>(target) : target;
  if (!el) throw new Error(`[ConsultSDK] target not found: ${String(target)}`);
  return el;
}

function originOf(baseUrl: string): string {
  try {
    return new URL(baseUrl, window.location.href).origin;
  } catch {
    throw new Error(`[ConsultSDK] baseUrl is not a valid URL: ${baseUrl}`);
  }
}

async function safeErr(res: Response): Promise<string> {
  try {
    const d = await res.json();
    return (d && (d.error || d.message)) || res.statusText;
  } catch {
    return res.statusText;
  }
}
