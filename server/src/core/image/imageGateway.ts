// 生图统一入口。和文本 LLM 是两类能力，各走各的 gateway，但共用同一套
// 「ai_providers 表 + provider 抽象」的模式：文本是 kind='llm'，生图是 kind='image'。
//
// 分派靠 provider.extra_json 的 protocol：
//   - openai    OpenAI 兼容 /images/generations（中转站/new-api/火山方舟都走这条），同步返回
//   - dashscope 阿里百炼通义万相原生异步任务制（提交 → 轮询 task → 拿 results[].url）
// 拿到的原始 URL 多为限时链接，一律下载后转存（COS，没配则落本机磁盘）再返回。

import COS from 'cos-nodejs-sdk-v5';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { resolveImageProvider, getProvider, type AIProvider } from '../../services/aiProviderService.js';
import { getCosConfig, uploadsRoot, cosUnavailableReason, cosPublicUrl } from '../../api/upload.js';

export interface GenerateImageOptions {
  size?: string;          // 如 '1024x1024'，各家默认值不同
  n?: number;             // 生成张数
  extra?: Record<string, any>;
  /** 调用者 user id。该用户开了专属渠道时用他自己的生图 provider（见 migrations/052）。 */
  userId?: string;
  /**
   * 绑死用哪条接入点，跳过「按 kind 解析」（后台连通性测试、以及将来按 deck 固定模型用）。
   *
   * 同 aiGateway 的 providerId（见 migration 082）：按条件解析时同 kind 有第二条记录会挑
   * 「最近更新的那条」，于是管理员点某一行的「测试」，实际测的是另一行 —— 而结果显示
   * 「连通 ✓」，他会以为刚配的这条是好的。
   */
  providerId?: string;
  /** 单次请求超时（毫秒）。生图普遍比文本慢，缺省 180 秒。 */
  timeoutMs?: number;
}

export interface GeneratedImage {
  url: string;            // 转存后的永久 URL（COS 绝对地址，或本机 /uploads/... 相对地址）
  provider: string;       // 用了哪个 provider id
  model: string;
  /** 存哪了。'local' 时图在本机磁盘上，换机器/多实例部署会 404，调用方要说出来。 */
  storage: 'cos' | 'local';
  /** storage==='local' 时，为什么没走 COS（没配 / 配不全 / 凭据解不开）。 */
  storageReason?: string;
  /** 实际用的协议，以及它是不是从 base_url 猜出来的（extra_json 没写 protocol 时）。 */
  protocol: string;
  protocolInferred: boolean;
}

const DEFAULT_TIMEOUT_MS = 180_000;

/** 原始产物：各家要么给限时 URL，要么直接给 base64。两种都必须认（见 persistImage）。 */
type RawImage = { url: string } | { b64: string; mime?: string };

/**
 * 生成图片。失败一律抛错并带上上游原文 —— 生图的每种失败（模型名不对 / 余额不足 /
 * 配的其实是视频模型 / 回了 200 但没有图）解法完全不同，合成一句「生图失败」
 * 会让人一路重试。
 */
export async function generateImage(prompt: string, opts: GenerateImageOptions = {}): Promise<GeneratedImage[]> {
  const provider = opts.providerId ? pinnedProvider(opts.providerId) : resolveImageProvider(opts.userId);
  if (!provider) {
    throw new Error('未配置生图 provider，请在后台「AI 模型 Provider」里新增一条 kind=image 的记录。');
  }
  if (!provider.api_key) {
    throw new Error(`生图接入点「${provider.label || provider.id}」的 API Key 未设置或无法解密。`);
  }

  const { protocol, inferred } = readProtocol(provider);
  // 分段计时打进日志：生图有两段（上游生成、把图搬回来），只有一个总耗时的话
  // 「上游慢」和「下载拉不动」看起来一模一样 —— 而后者时上游已经扣了费。
  const t0 = Date.now();
  let raw: RawImage[];
  switch (protocol) {
    case 'dashscope':
      raw = await callDashscope(provider, prompt, opts);
      break;
    case 'openai':
      raw = await callOpenAI(provider, prompt, opts);
      break;
    default:
      throw new Error(`未知的生图协议 protocol="${protocol}"，请在 provider 的 extra_json 里指定 protocol（openai/dashscope）。`);
  }
  const t1 = Date.now();
  console.log(
    `[imageGateway] ${provider.model} 上游生成完成 ${t1 - t0}ms，${raw.length} 张，` +
      `形式=${raw.map((r) => ('b64' in r ? 'base64' : 'url')).join('/')}`
  );

  const stored = await Promise.all(raw.map((r) => persistImage(r)));
  console.log(`[imageGateway] 转存完成 ${Date.now() - t1}ms → ${stored.map((s) => s.storage).join('/')}`);
  return stored.map((s) => ({
    url: s.url,
    provider: provider.id,
    model: provider.model,
    storage: s.storage,
    storageReason: s.reason,
    protocol,
    protocolInferred: inferred,
  }));
}

function pinnedProvider(id: string): AIProvider {
  const p = getProvider(id);
  if (!p) throw new Error(`接入点 ${id} 不存在。`);
  if (p.kind !== 'image') throw new Error(`接入点「${p.label || p.id}」的 kind 是 ${p.kind}，不是 image。`);
  if (!p.enabled) throw new Error(`接入点「${p.label || p.id}」已停用。`);
  return p;
}

/**
 * 取 protocol。extra_json 是个自由文本框，键名拼错完全静默（保存成功、界面上和填对了
 * 一模一样），所以没填/拼错时**按 base_url 猜一个并把「猜的」这件事回给调用方**，
 * 而不是抛一句「未知协议」—— 绝大多数接入点都是 OpenAI 兼容的，为一个拼写错误让整条
 * 链路不可用不划算；但猜错了必须能在界面上看出来。
 */
function readProtocol(provider: AIProvider): { protocol: string; inferred: boolean } {
  let declared = '';
  try {
    const extra = JSON.parse(provider.extra_json || '{}');
    declared = String(extra.protocol || '').toLowerCase().trim();
  } catch {
    declared = '';
  }
  if (declared) return { protocol: declared, inferred: false };

  const base = (provider.base_url || '').toLowerCase();
  // dashscope 的 OpenAI 兼容端点（/compatible-mode/v1）走 openai 那条，原生 /api/v1 才是异步任务制。
  const isNativeDashscope = base.includes('dashscope') && !base.includes('compatible-mode');
  return { protocol: isNativeDashscope ? 'dashscope' : 'openai', inferred: true };
}

// ---------- 各家适配器 ----------

/** OpenAI 兼容 images.generate：同步返回 data[].url 或 data[].b64_json。 */
async function callOpenAI(provider: AIProvider, prompt: string, opts: GenerateImageOptions): Promise<RawImage[]> {
  const endpoint = `${trimTrailingSlash(provider.base_url || 'https://api.openai.com/v1')}/images/generations`;
  const body: Record<string, any> = {
    model: provider.model,
    prompt,
    n: opts.n ?? 1,
    ...(opts.size ? { size: opts.size } : {}),
    ...(opts.extra || {}),
  };

  const text = await postJson(endpoint, provider.api_key, body, opts.timeoutMs);
  const json = parseJsonOrThrow(text);
  const items: any[] = Array.isArray(json?.data) ? json.data : [];
  const out: RawImage[] = [];
  for (const it of items) {
    // **b64_json 优先于 url**：两者都给时走 base64 能整条跳过下载那一步。
    // 上游返回的 url 往往在 Azure blob / 上游自己的 CDN 上，国内机器经常拉不动 ——
    // 而那时候钱**已经扣了**，失败读起来却像「生图没成功」。
    if (typeof it?.b64_json === 'string' && it.b64_json) out.push({ b64: it.b64_json });
    else if (typeof it?.url === 'string' && it.url) out.push({ url: it.url });
  }
  if (!out.length) {
    throw new Error(`生图接口回了 200 但没有图片（data 里既没有 url 也没有 b64_json）：${snippet(text)}`);
  }
  return out;
}

/**
 * 阿里百炼通义万相原生接口：文生图是异步任务制。
 * 提交 → 轮询 /tasks/{id} → 拿 output.results[].url。
 */
async function callDashscope(provider: AIProvider, prompt: string, opts: GenerateImageOptions): Promise<RawImage[]> {
  const base = trimTrailingSlash(provider.base_url || 'https://dashscope.aliyuncs.com/api/v1');
  const submitText = await postJson(
    `${base}/services/aigc/text2image/image-synthesis`,
    provider.api_key,
    {
      model: provider.model,
      input: { prompt },
      parameters: { n: opts.n ?? 1, ...(opts.size ? { size: opts.size.replace('x', '*') } : {}), ...(opts.extra || {}) },
    },
    opts.timeoutMs,
    { 'X-DashScope-Async': 'enable' }
  );
  const submitted = parseJsonOrThrow(submitText);
  const taskId = submitted?.output?.task_id;
  if (!taskId) throw new Error(`提交生图任务后没拿到 task_id：${snippet(submitText)}`);

  const deadline = Date.now() + (opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  while (Date.now() < deadline) {
    await sleep(2000);
    const pollText = await getText(`${base}/tasks/${taskId}`, provider.api_key, 30_000);
    const poll = parseJsonOrThrow(pollText);
    const status = poll?.output?.task_status;
    if (status === 'SUCCEEDED') {
      const results: any[] = poll?.output?.results || [];
      const out = results.filter((r) => typeof r?.url === 'string' && r.url).map((r) => ({ url: r.url as string }));
      if (!out.length) throw new Error(`生图任务成功但结果里没有 url：${snippet(pollText)}`);
      return out;
    }
    if (status === 'FAILED' || status === 'CANCELED' || status === 'UNKNOWN') {
      throw new Error(`生图任务失败（task_status=${status}）：${snippet(pollText)}`);
    }
  }
  throw new Error(`生图任务在 ${Math.round((opts.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000)} 秒内没有完成（task_id=${taskId}）。`);
}

// ---------- HTTP 小工具 ----------

async function postJson(
  url: string,
  apiKey: string,
  body: Record<string, any>,
  timeoutMs?: number,
  extraHeaders: Record<string, string> = {}
): Promise<string> {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`, ...extraHeaders },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });
  const text = await resp.text();
  // 上游原文必须带出去：「模型名不对」「余额不足」「这个模型不支持 images 端点」
  // 三种解法完全不同，只回一句「生图失败」的话它们在界面上长得一模一样。
  if (!resp.ok) throw new Error(`生图接口报错 HTTP ${resp.status}（${url}）：${snippet(text)}`);
  return text;
}

async function getText(url: string, apiKey: string, timeoutMs: number): Promise<string> {
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`查询生图任务失败 HTTP ${resp.status}：${snippet(text)}`);
  return text;
}

function parseJsonOrThrow(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`生图接口返回的不是 JSON：${snippet(text)}`);
  }
}

function snippet(text: string): string {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  return t.length > 400 ? `${t.slice(0, 400)}…` : t || '（空响应体）';
}

function trimTrailingSlash(s: string): string {
  return s.replace(/\/+$/, '');
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------- 转存 ----------

/**
 * 把一张原始产物（限时 URL 或 base64）落成永久可访问的图。
 *
 * COS 配了走 COS；**没配就落本机磁盘**（`data/uploads/ai-images/...`，由 app.ts 的
 * `/uploads` 静态挂载提供）。原来这里在 COS 缺失时直接返回上游的限时 URL —— 那是个
 * 定时炸弹：生成当天一切正常，几小时/几天后整份演示稿的图全变成裂图，而没有任何一处报错。
 */
async function persistImage(raw: RawImage): Promise<{ url: string; storage: 'cos' | 'local'; reason?: string }> {
  let buffer: Buffer;
  let contentType: string;

  if ('b64' in raw) {
    buffer = Buffer.from(raw.b64, 'base64');
    contentType = raw.mime || sniffImageType(buffer) || 'image/png';
  } else {
    const got = await downloadImage(raw.url);
    contentType = got.contentType;
    buffer = got.buffer;
  }

  if (!contentType.startsWith('image/')) {
    // 认不出就按魔术字节再判一次；确实不是图片的必须抛错。典型成因是把**视频**模型
    // （火山的 seedance 系列）配成了生图接入点：接口一路 200，最后存进去一个 mp4，
    // 页面上是个放不出来的裂图，而后台显示「已生成」。
    const sniffed = sniffImageType(buffer);
    if (!sniffed) {
      throw new Error(
        `上游返回的不是图片（content-type=${contentType || '未知'}，${buffer.length} 字节）。` +
          `如果配的是视频模型（如 doubao-seedance），请换成生图模型（如 doubao-seedream）。`
      );
    }
    contentType = sniffed;
  }

  const ext = extFromContentType(contentType);
  const now = new Date();
  const datePath = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}`;
  const key = `ai-images/${datePath}/${uuidv4()}${ext}`;

  const cosConfig = getCosConfig();
  if (cosConfig) {
    const cos = new COS({ SecretId: cosConfig.SecretId, SecretKey: cosConfig.SecretKey });
    await new Promise<void>((resolve, reject) => {
      cos.putObject(
        { Bucket: cosConfig.Bucket, Region: cosConfig.Region, Key: key, Body: buffer, ContentType: contentType },
        (err) => (err ? reject(err) : resolve())
      );
    });
    return { url: cosPublicUrl(key), storage: 'cos' };
  }

  // 退回本机磁盘时必须说出**为什么**没走 COS：「没配」和「配了但凭据解不开」
  // 解法相反，而两种都只表现成一张存在本机的图。
  const reason = cosUnavailableReason();
  console.warn(`[imageGateway] 未转存到 COS，图落在本机磁盘：${reason}`);
  const abs = path.join(uploadsRoot(), key);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, buffer);
  return { url: `/uploads/${key}`, storage: 'local', reason };
}

const DOWNLOAD_TIMEOUT_MS = 25_000;

/**
 * 下载上游给的限时图片 URL，失败重试一次。
 *
 * 这一步失败必须和「生图失败」分开说：走到这里时上游**已经生成成功、已经扣费**
 * （中转站后台看到的是一条成功记录 + 一笔费用），而合成一句「生图失败」会让人
 * 一路重试 —— 每重试一次都是一次真实付费调用，而每次都在同一个地方断掉。
 * 常见成因就是那个 URL 在 Azure blob / 上游自建 CDN 上，服务器这边拉不通。
 */
async function downloadImage(url: string): Promise<{ buffer: Buffer; contentType: string }> {
  let lastErr = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
      if (!resp.ok) {
        lastErr = `HTTP ${resp.status}`;
      } else {
        return {
          buffer: Buffer.from(await resp.arrayBuffer()),
          contentType: resp.headers.get('content-type') || '',
        };
      }
    } catch (e: any) {
      lastErr = String(e?.message || e);
    }
    if (attempt === 1) console.warn(`[imageGateway] 下载生图结果失败，重试一次：${lastErr}`);
  }
  throw new Error(
    `上游已经生成成功（费用已产生），但把图片下载回来这一步失败了：${lastErr}。` +
      `图片地址 ${url} —— 这台服务器访问不到它（常见于 Azure blob / 上游 CDN 被墙或超时）。` +
      `重试不会好转，请让中转站直接回 base64（部分网关支持 response_format=b64_json），或给服务器配代理。`
  );
}

/** 魔术字节嗅探。中转站经常不带或带错 content-type。 */
function sniffImageType(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 3).toString('latin1') === 'GIF') return 'image/gif';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

function extFromContentType(ct: string): string {
  if (ct.includes('jpeg') || ct.includes('jpg')) return '.jpg';
  if (ct.includes('webp')) return '.webp';
  if (ct.includes('gif')) return '.gif';
  return '.png';
}
