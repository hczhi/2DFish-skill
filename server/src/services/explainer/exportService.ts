import { spawn } from 'child_process';
import { mkdtemp, rename, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import type { Browser } from 'playwright';
import { ExplainerError, type StyleId } from './scriptService.js';

// 代码动画视频导出：无头浏览器打开前端的 /explainer/render，逐帧 seek + 截图，喂给 ffmpeg 编成 H.264 MP4。
// 画面只由 t 决定（和预览同一套编译 + 渲染器），所以截出来和预览一致。
// 会「看着成功其实错了」的几件事都要喊出来：渲染页打不开 / 不是新版前端（等不到 __explainerReady）、
// 渲染页自己报画不出来（__explainerFail）、字体没加载上之类（__explainerNotes，回给前端显示）。

/** 白板 / 白纸手绘 30 帧；蓝图按风格文档「一拍一帧」24 帧。缺一个风格的话 TS 报错（漏了 = 帧数 NaN，导出 0 帧却「成功」） */
export const FPS: Record<StyleId, number> = { whiteboard: 30, blueprint: 24, sketch: 30 };
let running = 0;

function renderOrigin() {
  // 和动效卡共用这个地址：生产环境前端由同一个 Express 托管；开发时 Express 托管的 client/dist 是旧的，走 vite
  if (process.env.BROLL_RENDER_ORIGIN) return process.env.BROLL_RENDER_ORIGIN.replace(/\/$/, '');
  return process.env.NODE_ENV === 'production' ? `http://127.0.0.1:${process.env.PORT || 3001}` : 'http://localhost:5173';
}

async function ffmpegPath(): Promise<string> {
  const mod: any = await import('ffmpeg-static');
  const p = mod.default || mod;
  if (!p) throw new ExplainerError('服务器上找不到 ffmpeg（ffmpeg-static 没装上），在 server 目录下重新 npm install', 500);
  return p;
}

async function launch(): Promise<Browser> {
  try {
    const { chromium } = await import('playwright');
    // 蓝图是 WebGL2：Mac 上用 GPU（Metal）快很多；Linux 服务器上默认的软件渲染（SwiftShader）也能画，只是慢
    const args = process.platform === 'darwin' ? ['--use-gl=angle', '--use-angle=metal', '--ignore-gpu-blocklist'] : [];
    return await chromium.launch({ headless: true, args });
  } catch (e: any) {
    throw new ExplainerError(`服务器上起不了浏览器，导不了视频：${e?.message || e}。多半是没装 chromium —— 在 server 目录下跑一次 \`npx playwright install chromium\`。`, 500);
  }
}

/** 有没有正在导出的（接口在冻结点数之前先问一句，忙就直接 429，不先冻住再解） */
export const exportBusy = () => running >= 1;

/**
 * 渲染成 MP4，写到 `outFile`（调用方负责删）。`onProgress(done, total)` 每帧回一次。
 */
export async function exportVideo(
  spec: { scene: any; style: StyleId },
  outFile: string,
  onProgress: (done: number, total: number) => void = () => {},
): Promise<{ notes: string[]; frames: number; ms: number }> {
  if (running >= 1) throw new ExplainerError('已经有一个视频在导出（这一步很吃 CPU，一次只导一个）—— 等它完成再点', 429);
  running++;
  const started = Date.now();
  const fps = FPS[spec.style];
  const frames = Math.round(Number(spec.scene.duration) * fps);
  const dir = await mkdtemp(path.join(tmpdir(), 'explainer-'));
  const out = path.join(dir, 'out.mp4');
  let browser: Browser | null = null;
  try {
    const ff = await ffmpegPath();
    browser = await launch();
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    await page.addInitScript((s) => { (window as any).__EXPLAINER_SPEC__ = s; }, spec);
    const url = `${renderOrigin()}/explainer/render`;
    // 只放行渲染页自己那个域名：index.html 里挂着 Google Fonts / 广告 / 统计，服务器连不上 Google 时
    // 截图会一直「等字体」直到超时（实测），而导出要的东西（前端代码、内置字体、笔顺接口）全在同一个域名下。
    const origin = new URL(url).origin;
    await page.route('**/*', (route) => (new URL(route.request().url()).origin === origin ? route.continue() : route.abort('blockedbyclient')));
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    } catch (e: any) {
      throw new ExplainerError(`服务器打不开渲染页 ${url}：${e?.message || e}。开发时要先把前端（vite，5173）跑起来；部署时设 BROLL_RENDER_ORIGIN`, 500);
    }
    try {
      await page.waitForFunction(() => (window as any).__explainerReady || (window as any).__explainerFail, null, { timeout: 30_000 });
    } catch {
      throw new ExplainerError(`渲染页 ${url} 30 秒没准备好 —— 多半打开的是旧版前端（没有 /explainer/render 这个页面），重新构建前端或设 BROLL_RENDER_ORIGIN${pageErrors.length ? `。页面报错：${pageErrors[0]}` : ''}`, 500);
    }
    const fail = await page.evaluate(() => (window as any).__explainerFail);
    if (fail) throw new ExplainerError(`渲染失败：${fail}`, 400);
    const notes: string[] = await page.evaluate(() => (window as any).__explainerNotes || []);

    const proc = spawn(ff, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-i', '-',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out]);
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d; });
    const exited = new Promise<number>((resolve) => proc.on('close', (code) => resolve(code ?? -1)));
    for (let i = 0; i < frames; i++) {
      await page.evaluate((t) => (window as any).__explainerSeek(t), i / fps);
      const jpg = await page.screenshot({ type: 'jpeg', quality: 92 });
      if (!proc.stdin.write(jpg)) await new Promise((r) => proc.stdin.once('drain', r));
      onProgress(i + 1, frames);
    }
    proc.stdin.end();
    const code = await exited;
    if (code !== 0) throw new ExplainerError(`ffmpeg 编码失败（退出码 ${code}）：${stderr.slice(-400)}`, 500);
    if (pageErrors.length) throw new ExplainerError(`渲染途中页面报错，导出的画面可能不完整：${pageErrors[0]}`, 500);
    await rename(out, outFile);
    return { notes, frames, ms: Date.now() - started };
  } finally {
    running--;
    await browser?.close().catch(() => {});
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
