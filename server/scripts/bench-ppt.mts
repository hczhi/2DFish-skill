// 性能实测脚本（只读，不写库、不调 AI）：/ppt 的两处开销。
//
// ① `GET /decks/:id/pages` 的响应有多大 —— 它给**每一页**都回一份 `previewHtml`，
//    而每份 previewHtml 是「整份 template.html + 这一页」，所以页数越多它越是同一份外壳
//    抄 N 遍。这件事在界面上完全看不出来（打开慢一点而已）。
// ② 左边那条缩略图轨道挂 N 个 srcdoc iframe 的真实代价（挂完要多久、主线程被堵多久、
//    浏览器里多出几个 document）。挂多少个是 `PptPlan.vue` 里 `RAIL_SIZE` 定的，
//    改那个数之前先跑这个。
//
// 用法（DB_PATH 必须写在命令行前缀 —— 在脚本里 set 是无效的，import 已经先跑了；
// 建议指向一份拷贝，别对着生产库跑）：
//   cp data/app.db /tmp/ppt-bench.db
//   DB_PATH=/tmp/ppt-bench.db ./node_modules/.bin/tsx scripts/bench-ppt.mts [deckId]
import { initDatabase, getDatabase } from '../src/db/index.js';
import { assemblePreview } from '../src/services/ppt/deckShell.js';
import { chromium } from 'playwright';

initDatabase();
const db = getDatabase();

const arg = process.argv[2];
const deckId =
  arg ||
  (db.prepare('SELECT deck_id FROM ppt_deck_pages GROUP BY deck_id ORDER BY COUNT(*) DESC LIMIT 1').get() as any)?.deck_id;
if (!deckId) {
  console.error('库里一份 deck 都没有（ppt_deck_pages 是空的）—— 先在 /ppt 生成几页，或者传一个 deckId。');
  process.exit(1);
}
const deck: any = db.prepare('SELECT * FROM ppt_decks WHERE id = ?').get(deckId);
if (!deck) {
  console.error(`找不到这份 deck：${deckId}`);
  process.exit(1);
}
const rows: any[] = db.prepare('SELECT * FROM ppt_deck_pages WHERE deck_id = ? ORDER BY page').all(deckId);
const meta: any = { brandCn: deck.brand_cn || '', brandEn: deck.brand_en || '', topic: deck.title || '' };

// ── ① 列表接口的体积 ────────────────────────────
const t0 = performance.now();
const payload = rows.map((p) => ({
  page: p.page,
  html: p.html,
  previewHtml: p.html ? assemblePreview(p.html, meta, p.veil_opacity || 0) : '',
}));
const t1 = performance.now();
const json = JSON.stringify({ pages: payload });
const t2 = performance.now();
const previews = payload.map((p) => p.previewHtml).filter(Boolean);
const htmlKB = rows.reduce((a, r) => a + (r.html?.length || 0), 0) / 1024;

console.log(`deck ${deckId}：${rows.length} 页，其中 ${previews.length} 页生成过`);
console.log(`  库里那几页 html 合计    ${htmlKB.toFixed(1)} KB`);
console.log(`  单页 previewHtml        ${(previews[0]?.length ?? 0) / 1024 > 0 ? ((previews[0].length / 1024).toFixed(1) + ' KB（整份 template.html 套一页）') : '(没有生成过的页)'}`);
console.log(`  GET /pages 响应         ${(Buffer.byteLength(json) / 1024).toFixed(1)} KB（拼装 ${(t1 - t0).toFixed(0)}ms + JSON ${(t2 - t1).toFixed(0)}ms）`);
console.log(`  换成「外壳只回一份」    ${((Buffer.byteLength(JSON.stringify({ pages: rows.map((p) => ({ page: p.page, html: p.html })) })) + (previews[0]?.length ?? 0)) / 1024).toFixed(1)} KB`);

if (!previews.length) process.exit(0);

// ── ② 缩略图轨道 ────────────────────────────
const harness = (docs: string[]) => `<!doctype html><meta charset="utf-8"><style>
body{margin:0;font:12px system-ui} .rail{width:260px;height:100vh;overflow:auto}
.item{height:120px;margin:6px;border:1px solid #ddd} iframe{width:100%;height:100%;border:0}</style>
<div class="rail" id="rail"></div>
<script type="application/json" id="payload">${JSON.stringify(docs).replace(/</g, '\\u003c')}</script>
<script>
window.__docs = JSON.parse(document.getElementById('payload').textContent);
window.__long = [];
new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push(e.duration); }).observe({ entryTypes: ['longtask'] });
window.mount = () => new Promise((resolve) => {
  const t0 = performance.now();
  let loaded = 0;
  window.__loaded = () => loaded;
  const rail = document.getElementById('rail');
  for (const d of window.__docs) {
    const wrap = document.createElement('div'); wrap.className = 'item';
    const f = document.createElement('iframe');
    f.addEventListener('load', () => { if (++loaded === window.__docs.length) resolve(performance.now() - t0); });
    f.srcdoc = d; wrap.appendChild(f); rail.appendChild(wrap);
  }
});
</script>`;

const pick = (n: number) => Array.from({ length: n }, (_, i) => previews[i % previews.length]);
const browser = await chromium.launch();
console.log(`\n缩略图轨道（每个 iframe 一份 ${(previews[0].length / 1024).toFixed(1)} KB 的完整文档）：`);
for (const cpu of [1, 4]) {
  for (const n of [15, 41, 60]) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    // 4 倍限速 ≈ 一台低配笔记本。他说的「卡」在这一档才看得出来。
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
    await page.setContent(harness(pick(n)));
    const ms = (await Promise.race([
      page.evaluate('mount()'),
      new Promise((r) => setTimeout(() => r(-1), 60000)),
    ])) as number;
    const done = (await page.evaluate('window.__loaded()')) as number;
    const long = (await page.evaluate('window.__long')) as number[];
    // 长任务超出 50ms 的那部分累加 = 这段时间里点击是排在队列里不动的。
    const blocked = long.reduce((a, d) => a + Math.max(0, d - 50), 0);
    const metrics = await cdp.send('Performance.getMetrics');
    const heap = (metrics.metrics.find((m: any) => m.name === 'JSHeapUsedSize')?.value || 0) / 1048576;
    const docs = metrics.metrics.find((m: any) => m.name === 'Documents')?.value;
    console.log(
      `  CPU x${cpu} | ${String(n).padStart(2)} 个: 全部 load ${ms < 0 ? `>60s（只 load 了 ${done}/${n}）` : `${ms.toFixed(0)}ms`}` +
        ` | 主线程阻塞 ${blocked.toFixed(0)}ms（最长一个 ${Math.max(0, ...long).toFixed(0)}ms）` +
        ` | JS 堆 ${heap.toFixed(1)}MB | document ${docs} 个`
    );
    await page.close();
  }
}
await browser.close();
