import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { initDatabase, getDatabase } from '../../db/index.js';
import { upsertProvider } from '../../services/aiProviderService.js';
import { generateImage } from './imageGateway.js';

initDatabase();

// 生图的三种失败**全部**伪装成成功：接口 200、后台显示「已生成」、
// 而拿回来的东西是空的/是视频/在磁盘上根本不存在。手测测不出来（那张缩略图
// 要么不显示要么是裂图，都会被当成「网络慢」），所以这三条必须有测试。

let tmpRoot: string;

beforeEach(() => {
  getDatabase().prepare("DELETE FROM ai_providers WHERE id LIKE 'img-test-%'").run();
  upsertProvider({
    id: 'img-test-1',
    kind: 'image',
    tier: 'default',
    label: '测试生图',
    model: 'some-image-model',
    base_url: 'https://img.example.test/v1',
    api_key: 'sk-test',
    enabled: 1,
    owner_user_id: null,
    scope_app: '',
    extra_json: '{"protocol":"openai"}',
  });
  // COS 没配 → 落本机磁盘。用临时目录，别往仓库 data/ 里写测试产物。
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'imgtest-'));
  process.env.UPLOADS_DIR = tmpRoot;
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.UPLOADS_DIR;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

/** 只回一个 JSON 响应的 fetch。 */
function stubJson(body: unknown, status = 200) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })));
}

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

describe('生图网关', () => {
  it('只回 b64_json 的中转站也要落盘并给出可访问 URL', async () => {
    // 只读 data[].url 的话这里返回空数组，上层拿到「成功 + 0 张图」——
    // 界面上和「生成好了但没显示出来」完全一样。
    stubJson({ data: [{ b64_json: PNG.toString('base64') }] });

    const [img] = await generateImage('一个图标', { providerId: 'img-test-1' });

    expect(img.url).toMatch(/^\/uploads\/ai-images\//);
    expect(img.storage).toBe('local');
    expect(fs.existsSync(path.join(tmpRoot, img.url.replace('/uploads/', '')))).toBe(true);
  });

  it('上游 200 但 data 里没有图时抛错，并带上原文', async () => {
    stubJson({ data: [], message: 'model not permitted' });

    await expect(generateImage('一个图标', { providerId: 'img-test-1' }))
      .rejects.toThrow(/model not permitted/);
  });

  it('上游回的不是图片（配成了视频模型）要抛错并点名 content-type', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: any) => {
      calls.push(String(url));
      if (calls.length === 1) {
        return new Response(JSON.stringify({ data: [{ url: 'https://cdn.example.test/x.mp4' }] }), {
          status: 200, headers: { 'content-type': 'application/json' },
        });
      }
      // 下载那一步：seedance 这类视频模型返回的是 mp4，存下来页面上就是个裂图。
      return new Response(Buffer.from('ftypisom-not-an-image'), {
        status: 200, headers: { 'content-type': 'video/mp4' },
      });
    }));

    await expect(generateImage('一个图标', { providerId: 'img-test-1' }))
      .rejects.toThrow(/video\/mp4[\s\S]*seedream/);
  });

  // 参考图（图生图）这条路上的失败全是一句「生成成功」：参考图被丢在半路之后回来的是一张
  // 漂亮的、跟参考图毫无关系的图 —— 接口 200、那一格挂着新缩略图，他只会一直重生（每次真扣额度）。
  it('带参考图时发的是 /images/edits 的 multipart（照旧发 generations = 参考图被无声丢掉）', async () => {
    const calls: { url: string; isForm: boolean }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: any, init: any) => {
      calls.push({ url: String(url), isForm: init?.body instanceof FormData });
      return new Response(JSON.stringify({ data: [{ b64_json: PNG.toString('base64') }] }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    }));
    // 参考图用本机磁盘那种地址（COS 没配时素材库里就是这种），图必须由我们读成字节传上去 ——
    // 把地址转给上游的话它拉不到，而拉不到时多数网关不报错，直接当文生图出一张。
    fs.mkdirSync(path.join(tmpRoot, 'ppt-uploads'), { recursive: true });
    fs.writeFileSync(path.join(tmpRoot, 'ppt-uploads/ref.png'), PNG);

    const [img] = await generateImage('照着这张图画', {
      providerId: 'img-test-1',
      refImages: ['/uploads/ppt-uploads/ref.png'],
    });

    expect(calls.map((c) => c.url)).toEqual(['https://img.example.test/v1/images/edits']);
    expect(calls[0].isForm, '不是 multipart = 参考图没真发出去').toBe(true);
    expect(img.refCount).toBe(1);
  });

  it('参考图读不到时抛错，不许少一张照样生成（少的那张不报错 = 图跟参考图无关）', async () => {
    stubJson({ data: [{ b64_json: PNG.toString('base64') }] });
    await expect(
      generateImage('照着这张图画', { providerId: 'img-test-1', refImages: ['/uploads/ppt-uploads/gone.png'] })
    ).rejects.toThrow(/找不到/);
  });
});
