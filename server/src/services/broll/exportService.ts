import { spawn } from 'child_process';
import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import type { Browser } from 'playwright';

// 口播动效卡导出：无头浏览器打开前端的 /broll/render（透明底），逐帧 seek + 截图，喂给 ffmpeg 编成
// **ProRes 4444 的 .mov（带透明通道）** —— 剪映 / Pr / FCP 都认的透明格式，拖到口播上面一轨就行。
// 画面完全由 t 决定（卡片不用 CSS 动画），所以逐帧截出来和预览一致。
//
// 三件会「看着成功其实错了」的事，这里都要喊出来：
// ① 渲染页打开的不是新版前端（dev 下 Express 托管的是旧的 client/dist）—— 等不到 __brollReady 就报，说清楚去哪个地址；
// ② 图片在服务器上加载不出来 —— 截出来是个空位，渲染页会报 __brollFail；
// ③ 服务器上没有主题字体 —— 能导出，但字和预览不一样，写进 notes 回给前端显示。

export class BrollExportError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export const MAX_SECONDS = 20;
const FPS = 30;
let running = 0;

export interface ExportCard { template: string; data: Record<string, any>; duration: number; x: number; y: number; s: number }
// 两种都是 .mov。**ffmpeg 编的 ProRes 4444 剪映不认透明**（作者实测：叠在口播上面一层照样是黑底，而文件本身是透明的、
// depth=32），WebM 剪映也读不了，所以只留下面两种：
//   png  = MOV 里装 PNG 帧：兼容最广（Pr / AE / FCP / 达芬奇 / 剪映），无损，约 10MB/秒，长了预览会卡；
//   hevc = 苹果的「HEVC 带透明」：很小、播放轻，但**只能在 Mac 上编**（VideoToolbox），Linux 服务器上没有这个编码器。
export type ExportFormat = 'png' | 'hevc';
export interface ExportSpec { aspect: '16:9' | '9:16'; theme: string; card: ExportCard; format: ExportFormat }

const CODEC: Record<ExportFormat, string[]> = {
  png: ['-c:v', 'png', '-pix_fmt', 'rgba'],
  // -alpha_quality 不给的话默认 0 = 不编透明层，导出来是黑底；-tag:v hvc1 是苹果系认 HEVC 的标记
  hevc: ['-c:v', 'hevc_videotoolbox', '-alpha_quality', '0.9', '-q:v', '70', '-pix_fmt', 'bgra', '-tag:v', 'hvc1'],
};

// 这台机器的 ffmpeg 有没有某个编码器（hevc_videotoolbox 只在 Mac 上有）。查一次缓存住
let encoders: Promise<string> | null = null;
async function hasEncoder(ff: string, name: string) {
  encoders ??= new Promise((resolve) => {
    const p = spawn(ff, ['-hide_banner', '-encoders']);
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.on('close', () => resolve(out));
    p.on('error', () => resolve(''));
  });
  return new RegExp(`\\b${name}\\b`).test(await encoders);
}

function renderOrigin() {
  if (process.env.BROLL_RENDER_ORIGIN) return process.env.BROLL_RENDER_ORIGIN.replace(/\/$/, '');
  // 生产环境前端由同一个 Express 托管；开发时前端在 vite（Express 托管的 client/dist 是上一次构建的旧版本）
  return process.env.NODE_ENV === 'production' ? `http://127.0.0.1:${process.env.PORT || 3001}` : 'http://localhost:5173';
}

async function ffmpegPath(): Promise<string> {
  const mod: any = await import('ffmpeg-static');
  const p = mod.default || mod;
  if (!p) throw new BrollExportError('服务器上找不到 ffmpeg（ffmpeg-static 没装上），在 server 目录下重新 npm install', 500);
  return p;
}

async function launch(): Promise<Browser> {
  try {
    const { chromium } = await import('playwright');
    return await chromium.launch({ headless: true });
  } catch (e: any) {
    throw new BrollExportError(
      `服务器上起不了浏览器，导不了视频：${e?.message || e}。多半是没装 chromium —— 在 server 目录下跑一次 \`npx playwright install chromium\`。`,
      500,
    );
  }
}

interface RenderCard extends ExportCard { id: number; track: number; start: number; end: number }

// 单张卡：放在 0 秒、铺满整段，位置大小照编辑页
export function exportCard(spec: ExportSpec) {
  return render(
    { aspect: spec.aspect, theme: spec.theme, format: spec.format },
    [{ id: 1, track: 0, start: 0, end: spec.card.duration, ...spec.card }],
    spec.card.duration,
  );
}

export const MAX_TIMELINE_SECONDS = 600;
/** PNG 无损，整条太长的话文件上 GB、剪映预览也卡 —— 超过这个长度让他换 HEVC 或分段导单张 */
export const MAX_PNG_TIMELINE_SECONDS = 300;

// 整条叠加层：和口播等长，卡片在各自的时间点上。没有卡的那些帧直接塞一张透明帧，不截图（只花编码时间）
export interface NavSpec { chapters: { index: string; label: string; start: number }[] }
export function exportTimeline(spec: { aspect: '16:9' | '9:16'; theme: string; format: ExportFormat; total: number; cards: RenderCard[]; nav?: NavSpec | null }) {
  return render({ aspect: spec.aspect, theme: spec.theme, format: spec.format }, spec.cards, spec.total, spec.nav || null);
}

async function render(
  base: { aspect: '16:9' | '9:16'; theme: string; format: ExportFormat },
  cards: RenderCard[],
  total: number,
  nav: NavSpec | null = null,
): Promise<{ buffer: Buffer; notes: string[]; frames: number }> {
  if (running >= 1) throw new BrollExportError('已经有一个导出在进行（这一步很吃 CPU，一次只导一个）—— 等它完成再点', 429);
  const W = base.aspect === '9:16' ? 1080 : 1920;
  const H = base.aspect === '9:16' ? 1920 : 1080;
  const frames = Math.round(total * FPS);
  running++;
  const dir = await mkdtemp(path.join(tmpdir(), 'broll-'));
  const out = path.join(dir, 'out.mov');
  let browser: Browser | null = null;
  try {
    const ff = await ffmpegPath();
    if (base.format === 'hevc' && !(await hasEncoder(ff, 'hevc_videotoolbox'))) {
      throw new BrollExportError('这台服务器不是 Mac，编不了「HEVC 透明」（它要用苹果系统自带的编码器）—— 请改选「PNG 透明 MOV」', 400);
    }
    browser = await launch();
    const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    await page.addInitScript((s) => { (window as any).__BROLL_SPEC__ = s; }, { aspect: base.aspect, theme: base.theme, cards, total, nav });
    const url = `${renderOrigin()}/broll/render`;
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    } catch (e: any) {
      throw new BrollExportError(`服务器打不开渲染页 ${url}：${e?.message || e}。开发时要先把前端（vite，5173）跑起来；部署时设 BROLL_RENDER_ORIGIN`, 500);
    }
    try {
      await page.waitForFunction(() => (window as any).__brollReady || (window as any).__brollFail, null, { timeout: 30_000 });
    } catch {
      throw new BrollExportError(`渲染页 ${url} 30 秒没准备好 —— 多半打开的是旧版前端（没有 /broll/render 这个页面），重新构建前端或设 BROLL_RENDER_ORIGIN`, 500);
    }
    const fail = await page.evaluate(() => (window as any).__brollFail);
    if (fail) throw new BrollExportError(`渲染失败：${fail}`, 400);
    const notes: string[] = await page.evaluate(() => (window as any).__brollFontNotes || []);

    // 透明空帧：跳到所有卡之前截一张
    await page.evaluate(() => (window as any).__brollSeek(-1));
    const blank = await page.screenshot({ type: 'png', omitBackground: true });
    // 导航条整条都在：开着时每一帧都要截（省掉空帧的优化不能用，否则导航条在没卡的那几段消失）
    const active = (t: number) => !!nav?.chapters.length || cards.some((c) => t >= c.start && t < c.end);

    const proc = spawn(ff, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-', ...CODEC[base.format], out]);
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d; });
    const exited = new Promise<number>((resolve) => proc.on('close', (code) => resolve(code ?? -1)));
    for (let i = 0; i < frames; i++) {
      const t = i / FPS;
      let png = blank;
      if (i === 0) {
        // 剪映按「第一帧不全空的画面」判断这条是直通还是预乘透明：那一帧里颜色都不超过透明度（全透明，或只有暗色半透明）
        // 就判成预乘，之后每个半透明像素都按满亮度叠上去 —— 光晕、渐变变成实心亮色块，而单张导出（第一帧就有卡）一切正常。
        // 整条前面常是几十秒空帧，所以第一帧左上角放一块白色 4% 的小方块（白 ≫ 透明度 = 只能是直通），肉眼看不见、只有 1/30 秒。
        // 透明度不能再低：HEVC 的透明层会把个位数的值压成 0，那就等于没放。
        await page.evaluate((x) => (window as any).__brollSeek(x), t);
        await page.evaluate(() => {
          const d = document.createElement('div');
          d.id = '__broll_alpha_mark';
          d.style.cssText = 'position:fixed;left:0;top:0;width:8px;height:8px;background:rgba(255,255,255,0.04);z-index:99999';
          document.body.appendChild(d);
        });
        png = await page.screenshot({ type: 'png', omitBackground: true });
        await page.evaluate(() => document.getElementById('__broll_alpha_mark')?.remove());
      } else if (active(t)) {
        await page.evaluate((x) => (window as any).__brollSeek(x), t);
        png = await page.screenshot({ type: 'png', omitBackground: true });
      }
      if (!proc.stdin.write(png)) await new Promise((r) => proc.stdin.once('drain', r));
    }
    proc.stdin.end();
    const code = await exited;
    if (code !== 0) throw new BrollExportError(`ffmpeg 编码失败（退出码 ${code}）：${stderr.slice(-400)}`, 500);
    return { buffer: await readFile(out), notes, frames };
  } finally {
    running--;
    await browser?.close().catch(() => {});
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
