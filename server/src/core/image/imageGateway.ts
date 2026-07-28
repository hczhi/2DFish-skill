// 生图统一入口（地基）。和文本 LLM 是两类能力，各走各的 gateway，但共用同一套
// 「ai_providers 表 + provider 抽象」的模式：文本是 kind='llm'，生图是 kind='image'。
//
// 本文件现在只搭骨架 + 占位：
//   - generateImage() 定义统一接口，按 provider.extra_json.protocol 分派到各家适配器；
//   - 各家适配器（dashscope / openai）先留 TODO，真接某家时填「提交 → 拿原始图 URL」这一步；
//   - 拿到原始（多为限时）URL 后统一走 transferToCos() 转存，返回永久 URL。
// 不加路由、不接前端——纯地基。真接生图业务时再写 api/xhs 或独立路由调 generateImage()。

import COS from 'cos-nodejs-sdk-v5';
import { v4 as uuidv4 } from 'uuid';
import { resolveImageProvider, type AIProvider } from '../../services/aiProviderService.js';
import { getCosConfig } from '../../api/upload.js';

export interface GenerateImageOptions {
  size?: string;          // 如 '1024x1024'，各家默认值不同
  n?: number;             // 生成张数
  extra?: Record<string, any>;
}

export interface GeneratedImage {
  url: string;            // 转存后的永久 URL
  provider: string;       // 用了哪个 provider id
  model: string;
}

/**
 * 生成图片。当前没有任何生图 provider 被配置/实现，会抛错——这是预期的地基状态。
 * 接入某家时：在下面 switch 里实现对应 protocol 的适配器函数即可。
 */
export async function generateImage(prompt: string, opts: GenerateImageOptions = {}): Promise<GeneratedImage[]> {
  const provider = resolveImageProvider();
  if (!provider) {
    throw new Error('未配置生图 provider，请在后台「AI 模型 Provider」里新增一条 kind=image 的记录。');
  }

  const protocol = readProtocol(provider);
  let rawUrls: string[];
  switch (protocol) {
    case 'dashscope':
      rawUrls = await callDashscope(provider, prompt, opts);
      break;
    case 'openai':
      rawUrls = await callOpenAI(provider, prompt, opts);
      break;
    default:
      throw new Error(`未知的生图协议 protocol="${protocol}"，请在 provider 的 extra_json 里指定 protocol（dashscope/openai）。`);
  }

  // 生图家返回的 URL 多为限时链接，统一转存 COS 拿永久 URL。
  const permanent = await Promise.all(rawUrls.map((u) => transferToCos(u)));
  return permanent.map((url) => ({ url, provider: provider.id, model: provider.model }));
}

function readProtocol(provider: AIProvider): string {
  try {
    const extra = JSON.parse(provider.extra_json || '{}');
    return String(extra.protocol || '').toLowerCase();
  } catch {
    return '';
  }
}

// ---------- 各家适配器（占位，接入时填实现） ----------

// 阿里百炼通义万相：文生图是异步任务制（提交任务 → 轮询 task 状态 → 拿 results[].url）。
// 接入时用 provider.base_url + api_key 调 /api/v1/services/aigc/text2image/image-synthesis，
// header 带 X-DashScope-Async，再轮询 /api/v1/tasks/{task_id}。
async function callDashscope(_provider: AIProvider, _prompt: string, _opts: GenerateImageOptions): Promise<string[]> {
  throw new Error('DashScope 生图适配器尚未实现（地基占位）。');
}

// OpenAI 兼容 images.generate：同步返回 data[].url 或 b64_json。
async function callOpenAI(_provider: AIProvider, _prompt: string, _opts: GenerateImageOptions): Promise<string[]> {
  throw new Error('OpenAI 生图适配器尚未实现（地基占位）。');
}

// ---------- COS 转存 ----------

/** 把一个外部图片 URL 下载后转存到腾讯云 COS，返回永久 URL。复用 upload.ts 的 COS 配置。 */
export async function transferToCos(srcUrl: string): Promise<string> {
  const cosConfig = getCosConfig();
  if (!cosConfig) {
    // COS 没配就退化为直接返回原始 URL（限时，但不至于整个流程挂掉）。
    console.warn('[imageGateway] COS 未配置，生图 URL 未转存，将返回原始限时链接。');
    return srcUrl;
  }

  const resp = await fetch(srcUrl);
  if (!resp.ok) throw new Error(`下载生图结果失败：HTTP ${resp.status}`);
  const contentType = resp.headers.get('content-type') || 'image/png';
  const buffer = Buffer.from(await resp.arrayBuffer());

  const ext = extFromContentType(contentType);
  const now = new Date();
  const datePath = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}`;
  const key = `ai-images/${datePath}/${uuidv4()}${ext}`;

  const cos = new COS({ SecretId: cosConfig.SecretId, SecretKey: cosConfig.SecretKey });
  await new Promise<void>((resolve, reject) => {
    cos.putObject(
      { Bucket: cosConfig.Bucket, Region: cosConfig.Region, Key: key, Body: buffer, ContentType: contentType },
      (err) => (err ? reject(err) : resolve())
    );
  });

  return `http://file.qiaonan.vip/${key}`;
}

function extFromContentType(ct: string): string {
  if (ct.includes('jpeg') || ct.includes('jpg')) return '.jpg';
  if (ct.includes('webp')) return '.webp';
  if (ct.includes('gif')) return '.gif';
  return '.png';
}
