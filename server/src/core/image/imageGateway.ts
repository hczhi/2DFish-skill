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
import { resolveCosTarget, uploadsRoot, cosUnavailableReason, cosPublicUrl, type CosTarget } from '../../api/upload.js';
import { imageSize } from './imageSize.js';

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
  /**
   * 转存到哪个桶。`'ppt'` = 后台配的「PPT 专用桶」，没配齐就照旧写默认桶。
   * 不传的模块（后台上传、ui-review）一律默认桶。
   */
  bucketProfile?: 'ppt';
  /**
   * 参考图（图生图）。给的是**已经转存过的那几张图的地址**：COS 绝对地址，或者 COS 没配时
   * 那种本机 `/uploads/...` 相对地址。
   *
   * 三件事是承重的：
   * ① **图在这边读成字节再上传**（`/images/edits` 的 multipart），不是把地址转给上游 ——
   *    转地址的话本机磁盘那几张上游压根拉不到，而**网关拉不到参考图时基本不报错，直接当
   *    文生图出一张**：接口 200、图也好看，只是跟参考图毫无关系（他会一直重生这一格）。
   * ② **认不了参考图的协议必须抛错**（dashscope 原生文生图端点就是），不许悄悄丢掉这几张 ——
   *    丢掉之后和上面那种「回落成文生图」一模一样，而唯一的线索是图不像。
   * ③ 上游拒了要把原文带出去：`/images/edits` 不存在（网关没转发这个端点）和「这个模型不吃
   *    参考图」解法不同（换网关 / 换模型），合成一句「生图失败」的话两种都只能靠猜。
   */
  refImages?: string[];
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
  /**
   * **真回来的像素**（图片头里读的，认不出格式时 undefined）。调用方要拿它和 `requestedSize`
   * 核一遍：`size` 只是个建议，不认的接入点悄悄按自己的默认出（多半是方图），而那张图贴进
   * 16:9 的图槽会被裁掉上下两条 —— 接口 200、面板写着「已生成」，看起来像模型构图没构好。
   */
  width?: number;
  height?: number;
  /** 这次真发出去的 size（没传就是 undefined）。 */
  requestedSize?: string;
  /** 上游拒了这个 size、已经摘掉它重发过一次时，这里是上游那句原文（调用方必须喊出来）。 */
  sizeRefused?: string;
  /**
   * 这次**真带上去**的参考图张数（没带就是 undefined）。调用方要拿它和自己传的那几张核一遍：
   * 只看「生成成功」的话，参考图被丢在半路和真照着画了在界面上完全一样。
   */
  refCount?: number;
}

const DEFAULT_TIMEOUT_MS = 180_000;

/**
 * 原始产物：各家要么给限时 URL，要么直接给 base64。两种都必须认（见 persistImage）。
 * `bytes` 那一种不来自上游，是用户直接上传的图（见 `storeUploadedImage`）。
 */
type RawImage = { url: string } | { b64: string; mime?: string } | { bytes: Buffer; mime?: string };

/**
 * 把用户上传的图落成永久可访问的图，走的是**和生图完全同一条转存路径**
 * （COS 配了走 COS、没配落本机磁盘并说出为什么、魔术字节核一遍是不是图片）。
 *
 * 各写一份 putObject 的后果是那一份缺哪一件哪一件就静默不生效：不核魔术字节时
 * 一个改名成 .png 的 pdf 会一路 200 存进素材库，卡片上是一张裂图；不带桶域名时图进了
 * PPT 桶而 URL 指着默认桶，同样接口 200、页面裂图。
 *
 * `keyPrefix` 分开存（上传的不进 `ai-images/`）：混在一起的话，将来清生图产物时会
 * 把用户自己上传的原图一起清掉，而库里那几条记录还在、卡片还在，只是点开全是裂图。
 */
export async function storeUploadedImage(
  bytes: Buffer,
  opts: { mime?: string; bucketProfile?: 'ppt'; keyPrefix?: string } = {}
): Promise<{ url: string; storage: 'cos' | 'local'; reason?: string }> {
  return persistImage({ bytes, mime: opts.mime }, resolveCosTarget(opts.bucketProfile), opts.keyPrefix);
}

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

  // 转存目标**在调上游之前先解析出来**：桶配错了要在花钱之前就抛（见 resolveCosTarget）。
  const target = resolveCosTarget(opts.bucketProfile);

  const { protocol, inferred } = readProtocol(provider);

  // 参考图**在调上游之前读进来**：这一步（下载 / 读磁盘 / 核魔术字节）失败是免费的，
  // 而放到后面失败时上游已经出过一张图、钱已经花了。
  const refs = opts.refImages?.length ? await loadRefImages(opts.refImages) : [];
  const refMode = refs.length ? readRefMode(provider) : 'edits';

  // 分段计时打进日志：生图有两段（上游生成、把图搬回来），只有一个总耗时的话
  // 「上游慢」和「下载拉不动」看起来一模一样 —— 而后者时上游已经扣了费。
  const t0 = Date.now();
  const call = (o: GenerateImageOptions): Promise<RawImage[]> => {
    switch (protocol) {
      case 'dashscope':
        // 悄悄按文生图发出去的话回来的是一张漂亮的、跟参考图毫无关系的图（接口 200）。
        if (refs.length) {
          throw new Error(
            `接入点「${provider.label || provider.id}」走的是通义万相原生异步接口（protocol=dashscope），` +
              '它的文生图端点不接参考图（参考图得走 qwen-image-edit 那个多模态端点，目前没接）。' +
              '请换一条 OpenAI 兼容的生图接入点，或者把参考图清掉再生成。'
          );
        }
        return callDashscope(provider, prompt, o);
      case 'openai':
        if (refs.length) return callOpenAIWithRefs(provider, prompt, o, refs, refMode);
        return callOpenAI(provider, prompt, o);
      default:
        throw new Error(`未知的生图协议 protocol="${protocol}"，请在 provider 的 extra_json 里指定 protocol（openai/dashscope）。`);
    }
  };
  let raw: RawImage[];
  let sizeRefused: string | undefined;
  try {
    raw = await call(opts);
  } catch (e: any) {
    const msg = String(e?.message || e);
    // **「这个 size 我不认」要摘掉 size 重发一次，不能让整条配图链挂在它上面。**
    // 不重发的话症状是「这一页一张图都没生成出来」，而那条接入点本身是好的（只是不吃 size
    // 这个参数或者不吃这个具体值）；反过来悄悄重发不说一句也不行 —— 回来的是一张默认尺寸
    // （多半是方图）的图，贴进 16:9 的图槽被裁掉两条，看起来像模型构图没构好。
    if (!opts.size || !refusedSize(msg)) throw e;
    console.warn(`[imageGateway] 上游拒了 size=${opts.size}，摘掉重发一次：${msg}`);
    sizeRefused = msg;
    raw = await call({ ...opts, size: undefined });
  }
  const t1 = Date.now();
  console.log(
    `[imageGateway] ${provider.model} 上游生成完成 ${t1 - t0}ms，${raw.length} 张，` +
      `形式=${raw.map((r) => ('b64' in r ? 'base64' : 'url')).join('/')}` +
      (refs.length ? `，参考图 ${refs.length} 张（${refMode}）` : '')
  );

  const stored = await Promise.all(raw.map((r) => persistImage(r, target)));
  console.log(
    `[imageGateway] 转存完成 ${Date.now() - t1}ms → ${stored.map((s) => s.storage).join('/')}` +
      (target ? ` bucket=${target.Bucket}` : '')
  );
  return stored.map((s) => ({
    url: s.url,
    provider: provider.id,
    model: provider.model,
    storage: s.storage,
    storageReason: s.reason,
    protocol,
    protocolInferred: inferred,
    width: s.width,
    height: s.height,
    requestedSize: opts.size,
    sizeRefused,
    refCount: refs.length || undefined,
  }));
}

/**
 * 上游那句 400 是不是在说「这个 size 不行」。
 *
 * 认得太宽（比如只看 400）的话「余额不足」「模型名不对」也会被摘掉 size 重发一次 ——
 * 第二次一样失败，只是把时间和一次真实调用花了两遍；认得太窄的话那一页一张图都没有，
 * 而成因只是一个参数。碰到新的网关文案往这里加，不要改成「一律摘掉重发」。
 */
function refusedSize(msg: string): boolean {
  if (!/HTTP 4\d\d/.test(msg)) return false;
  return /\bsize\b|尺寸|分辨率|resolution|width.*height|invalid_size/i.test(msg);
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

  return readImages(await postJson(endpoint, provider.api_key, body, opts.timeoutMs));
}

/** OpenAI 兼容响应（generations / edits 同一个形状）里的图。 */
function readImages(text: string): RawImage[] {
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

/** 参考图怎么发。`edits` = multipart 传文件；`body` = 塞进 generations 的 body（data URI）。 */
type RefMode = 'edits' | 'body';

/**
 * 参考图走哪条路。缺省 `edits`（OpenAI 官方那条：gpt-image 系列的图生图是
 * `POST /images/edits` multipart），少数网关只认「generations 的 body 里塞一个 image 字段」
 * （火山 seedream、部分 new-api 的 gemini 通道），那种在 extra_json 里写 `{"ref_mode":"body"}`。
 *
 * **拼错的值直接抛错**，不按缺省算：extra_json 是个自由文本框（见 readProtocol），
 * `{"ref_mode":"bodys"}` 静默回落成 edits 的话，他会以为「参考图这功能在这条接入点上就是没用」，
 * 而真正的动作只是改一个字。
 */
function readRefMode(provider: AIProvider): RefMode {
  let declared = '';
  try {
    declared = String(JSON.parse(provider.extra_json || '{}').ref_mode || '').toLowerCase().trim();
  } catch {
    declared = '';
  }
  if (!declared) return 'edits';
  if (declared === 'edits' || declared === 'body') return declared;
  throw new Error(`接入点「${provider.label || provider.id}」的 extra_json 里 ref_mode="${declared}" 认不出来，只能是 "edits" 或 "body"。`);
}

/** OpenAI 兼容的图生图：两种形状（见 readRefMode），回来的东西和文生图一样。 */
async function callOpenAIWithRefs(
  provider: AIProvider,
  prompt: string,
  opts: GenerateImageOptions,
  refs: RefImageBytes[],
  mode: RefMode
): Promise<RawImage[]> {
  const base = trimTrailingSlash(provider.base_url || 'https://api.openai.com/v1');
  if (mode === 'body') {
    const dataUris = refs.map((r) => `data:${r.mime};base64,${r.buffer.toString('base64')}`);
    return readImages(
      await postJson(
        `${base}/images/generations`,
        provider.api_key,
        {
          model: provider.model,
          prompt,
          n: opts.n ?? 1,
          ...(opts.size ? { size: opts.size } : {}),
          image: dataUris.length === 1 ? dataUris[0] : dataUris,
          ...(opts.extra || {}),
        },
        opts.timeoutMs
      )
    );
  }

  const form = new FormData();
  form.append('model', provider.model);
  form.append('prompt', prompt);
  form.append('n', String(opts.n ?? 1));
  if (opts.size) form.append('size', opts.size);
  for (const [k, v] of Object.entries(opts.extra || {})) form.append(k, String(v));
  // **一张用 `image`、多张用 `image[]`**：单张写成 `image[]` 的话 dall-e-2 那一档的网关
  // 直接 400，而多张写成 `image` 时多数网关只取最后一张 —— 少看的那几张不会报错。
  const field = refs.length === 1 ? 'image' : 'image[]';
  refs.forEach((r, i) => {
    form.append(field, new Blob([new Uint8Array(r.buffer)], { type: r.mime }), `ref${i + 1}${extFromContentType(r.mime)}`);
  });
  return readImages(await postForm(`${base}/images/edits`, provider.api_key, form, opts.timeoutMs));
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

/**
 * multipart 版（`/images/edits`）。**不许自己写 Content-Type**：写了就没有 boundary，
 * 上游只会回一句 400「无法解析请求体」，而那句话读起来像 key 或者模型名的问题。
 */
async function postForm(url: string, apiKey: string, form: FormData, timeoutMs?: number): Promise<string> {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal: AbortSignal.timeout(timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });
  const text = await resp.text();
  if (!resp.ok) {
    // 404 在这条路上是常见的一种：网关压根没转发 /images/edits（解法是换网关或换 ref_mode），
    // 和「这个模型不吃参考图」不是一回事 —— 所以原文照带。
    throw new Error(`带参考图的生图接口报错 HTTP ${resp.status}（${url}）：${snippet(text)}`);
  }
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
async function persistImage(
  raw: RawImage,
  target: CosTarget | null,
  keyPrefix = 'ai-images'
): Promise<{ url: string; storage: 'cos' | 'local'; reason?: string; width?: number; height?: number }> {
  let buffer: Buffer;
  let contentType: string;

  if ('bytes' in raw) {
    buffer = raw.bytes;
    // 上传来的 mime 是浏览器按扩展名猜的，所以魔术字节优先 —— 反过来的话一个
    // 改名成 .png 的文件会以 image/png 存进去，卡片上是一张裂图而接口 200。
    contentType = sniffImageType(buffer) || raw.mime || '';
  } else if ('b64' in raw) {
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
      // 成因分两种，说错的那一句会把人指反方向：上传来的是「这个文件不是图」，
      // 上游给的是「接入点配成了视频模型」。
      throw new Error(
        'bytes' in raw
          ? `这个文件不是 PNG / JPG / GIF / WebP 图片（浏览器说它是 ${raw.mime || '未知类型'}，${buffer.length} 字节）。` +
              '改扩展名不管用 —— 请用图片编辑器/截图工具另存成 PNG 或 JPG 再传。'
          : `上游返回的不是图片（content-type=${contentType || '未知'}，${buffer.length} 字节）。` +
              `如果配的是视频模型（如 doubao-seedance），请换成生图模型（如 doubao-seedream）。`
      );
    }
    contentType = sniffed;
  }

  // 真实像素在这里读一次（buffer 就在手上）。**认不出格式时不回这两个数**，调用方按
  // 「没核对」处理 —— 兜一个 0 或者上游宣称的尺寸的话，「这条接入点不吃 size」这件事就
  // 永远不会被说出来（而它的症状只是「图怎么被裁掉一块」）。
  const px = imageSize(buffer);

  const ext = extFromContentType(contentType);
  const now = new Date();
  const datePath = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}`;
  const key = `${keyPrefix}/${datePath}/${uuidv4()}${ext}`;

  if (target) {
    const cos = new COS({ SecretId: target.SecretId, SecretKey: target.SecretKey });
    await new Promise<void>((resolve, reject) => {
      cos.putObject(
        { Bucket: target.Bucket, Region: target.Region, Key: key, Body: buffer, ContentType: contentType },
        (err) => (err ? reject(err) : resolve())
      );
    });
    // 域名跟着桶走：这里套默认域名的话图进了新桶而 URL 指着老桶，接口全程 200、页面上是裂图。
    return { url: cosPublicUrl(key, target.publicBase), storage: 'cos', ...px };
  }

  // 退回本机磁盘时必须说出**为什么**没走 COS：「没配」和「配了但凭据解不开」
  // 解法相反，而两种都只表现成一张存在本机的图。
  const reason = cosUnavailableReason();
  console.warn(`[imageGateway] 未转存到 COS，图落在本机磁盘：${reason}`);
  const abs = path.join(uploadsRoot(), key);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, buffer);
  return { url: `/uploads/${key}`, storage: 'local', reason, ...px };
}

/** 一张读进内存的参考图。 */
type RefImageBytes = { buffer: Buffer; mime: string };

/**
 * 把参考图的地址读成字节。**每一种读不到都抛错**，不跳过那一张：跳过之后剩下的照样生成，
 * 回来一张跟参考图无关的图（接口 200、界面上那一格挂着新缩略图），他只会一直重生。
 *
 * 两种地址：COS 那种绝对地址（下载回来）、COS 没配时那种 `/uploads/...`（从本机磁盘读）。
 * 后者在多实例/换过机器之后读不到，而那正是「这张参考图在这台机器上不存在」这句话要说的事。
 */
async function loadRefImages(list: string[]): Promise<RefImageBytes[]> {
  const out: RefImageBytes[] = [];
  for (const raw of list) {
    const u = (raw || '').trim();
    if (!u) continue;
    let buffer: Buffer;
    if (/^https?:\/\//i.test(u)) {
      try {
        const resp = await fetch(u, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        buffer = Buffer.from(await resp.arrayBuffer());
      } catch (e: any) {
        // 这一步在花钱之前，必须和 downloadImage 那句「上游已经生成成功（费用已产生）」分开说 ——
        // 说成后者的话他以为钱已经扣了，不敢重试。
        throw new Error(`参考图下载不回来：${u} —— ${String(e?.message || e)}（还没调生图，这次没有产生费用）。`);
      }
    } else if (u.startsWith('/uploads/')) {
      const root = path.resolve(uploadsRoot());
      const abs = path.resolve(path.join(root, u.slice('/uploads/'.length)));
      // 地址是从库里来的，但拼路径这件事一旦被别处复用就变成「读任意文件」。
      if (abs !== root && !abs.startsWith(root + path.sep)) throw new Error(`参考图地址不合法：${u.slice(0, 120)}`);
      if (!fs.existsSync(abs)) {
        throw new Error(
          `参考图在这台服务器上找不到：${u} —— 这张图当时落在本机磁盘（COS 没配），` +
            '换机器或多实例部署之后就读不到了。请重新上传一张参考图，或者给服务器配上 COS。'
        );
      }
      buffer = fs.readFileSync(abs);
    } else {
      throw new Error(`参考图的地址认不出来（${u.slice(0, 120)}）：只认 http(s) 绝对地址和本机 /uploads/... 地址。`);
    }
    // 魔术字节核一遍：不是图的话上游多半回一句语焉不详的 400，而成因在我们这边。
    const mime = sniffImageType(buffer);
    if (!mime) throw new Error(`参考图不是 PNG / JPG / GIF / WebP 图片（${u.slice(0, 120)}，${buffer.length} 字节）。`);
    out.push({ buffer, mime });
  }
  return out;
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
