/**
 * 生成 doc/ppt-fixtures/golden/ 下那批黄金样本。
 *
 * 跑法（Node 必须 21.7.3；DB_PATH 一定要在命令行前缀里给，不能在脚本里 set —— 那时
 * db 模块已经 import 完了，会写真库）：
 *
 *   nvm use 21.7.3
 *   cd server && DB_PATH=/tmp/ppt-fixture.db npx tsx ../doc/ppt-fixtures/generate.ts
 *
 * 这些样本的用途：Python 版把同一份输入喂给自己的实现，输出跟 golden/ 里的文件做
 * **逐字节对比**。全是纯函数（不联网、不调 AI、不读库），所以对不上就是移植错了。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { assembleDeck, assemblePreview, previewShell, PREVIEW_SLOT, type DeckMeta } from '../../server/src/services/ppt/deckShell.js';
import { designStyleBlock, designPromptBlock, designVars, PALETTES, FONTS, DENSITIES, HEADERS, DEFAULT_DESIGN, type DesignSpec } from '../../server/src/services/ppt/designSpec.js';
import { normalizeChartData, rechartEdited } from '../../server/src/services/ppt/chartData.js';
import { injectEids, eidsIn } from '../../server/src/services/ppt/pageEdit.js';
import { exportDeck } from '../../server/src/services/ppt/exportService.js';
import { layouts, library } from '../../server/src/services/ppt/layoutLibrary.js';
import { demoFragments } from '../../server/src/services/ppt/demoDeck.js';
import { styles, defaultStyleId, deckColors, renderStylePrompt } from '../../server/src/services/ppt/styleLibrary.js';

const OUT = path.resolve(import.meta.dirname, 'golden');
const IN = path.resolve(import.meta.dirname, 'input');
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(IN, { recursive: true });

const written: Record<string, string> = {};
function write(name: string, body: string) {
  const p = path.join(OUT, name);
  fs.writeFileSync(p, body);
  written[name] = crypto.createHash('sha256').update(body).digest('hex').slice(0, 16);
}
function writeInput(name: string, body: string) {
  fs.writeFileSync(path.join(IN, name), body);
}
const json = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;

// ---------------------------------------------------------------- 输入

const META: DeckMeta = {
  brandCn: '示例企业',
  brandEn: 'SAMPLE',
  topic: '2026 年度业务复盘',
  design: { palette: 'P-B', font: 'F-C', density: 'D-C', header: 'H-C' },
};

const frags = demoFragments();
const pick = (id: string): string => {
  const f = frags.get(id);
  if (!f) throw new Error(`demo-slides.html 里没有 ${id}`);
  return f.trim();
};

// L1 = 横向分屏（有 hero 图位）、L47 = 横条图表页、L13 = 全幅封面。
// 三条覆盖了拼装里三种不同分支：普通页 / 图表页 / 全幅页。
const PAGE_L1 = pick('L1');
const PAGE_L47 = pick('L47');
const PAGE_L13 = pick('L13');

writeInput('deck-meta.json', json(META));
writeInput('page-L1.html', `${PAGE_L1}\n`);
writeInput('page-L47.html', `${PAGE_L47}\n`);
writeInput('page-L13.html', `${PAGE_L13}\n`);

// ---------------------------------------------------------------- 1. 外壳拼装

write('assembleDeck.html', assembleDeck([PAGE_L13, PAGE_L1, PAGE_L47], META));
// 单页预览：不带页脚、摘掉页码、贴幕帘。
write('assemblePreview.veil0.html', assemblePreview(PAGE_L1, META, 0));
write('assemblePreview.veil035.html', assemblePreview(PAGE_L13, META, 0.35));
// 前端拿到的那份共享外壳（`GET /decks/:id/pages` 的 `shell`）。
write('previewShell.html', previewShell(META));
write('previewSlot.txt', `${PREVIEW_SLOT}\n`);
// 默认那套规范（老 deck：design_json 为空）
write('assembleDeck.defaultDesign.html', assembleDeck([PAGE_L1], { ...META, design: undefined }));

// ---------------------------------------------------------------- 2. 设计规范 → CSS

const specs: DesignSpec[] = [DEFAULT_DESIGN];
for (const p of PALETTES) specs.push({ ...DEFAULT_DESIGN, palette: p.id });
for (const f of FONTS) specs.push({ ...DEFAULT_DESIGN, font: f.id });
for (const d of DENSITIES) specs.push({ ...DEFAULT_DESIGN, density: d.id });
for (const h of HEADERS) specs.push({ ...DEFAULT_DESIGN, header: h.id });
specs.push({ palette: 'P-D', font: 'F-B', density: 'D-A', header: 'H-C' });
write(
  'designSpec.styleBlocks.json',
  json(
    specs.map((s) => ({
      spec: s,
      vars: designVars(s),
      styleBlock: designStyleBlock(s),
      promptBlock: designPromptBlock(s),
    }))
  )
);

// ---------------------------------------------------------------- 3. 图表量重算

const chart = normalizeChartData(PAGE_L47);
write('chartData.L47.after.html', `${chart.html}\n`);
write('chartData.L47.result.json', json({ problems: chart.problems, changed: chart.html !== PAGE_L47 }));

// 一组百分比：上限必须钉 100（不是取最大那个值）。这是「40% 画成满格」那条事故。
const PCT = `<section class="slide"><div class="slide-inner"><div class="l47-rows" style="--bar-max:40">
<div class="l47-row" style="--bar-v:40"><span class="l47-label">A</span><span class="l47-val">40%</span></div>
<div class="l47-row" style="--bar-v:25"><span class="l47-label">B</span><span class="l47-val">25%</span></div>
</div></div></section>`;
writeInput('chart-percent.html', `${PCT}\n`);
const pct = normalizeChartData(PCT);
write('chartData.percent.result.json', json({ html: pct.html, problems: pct.problems }));

// 一组绝对值 + 上限写错：走 niceMax（NICE_STEPS 里挑第一个 ≥ 最大值的整齐刻度）。
const ABS = `<section class="slide"><div class="slide-inner"><div class="l47-rows" style="--bar-max:1">
<div class="l47-row" style="--bar-v:1"><span class="l47-label">2024</span><span class="l47-val">3.7 亿</span></div>
<div class="l47-row" style="--bar-v:1"><span class="l47-label">2025</span><span class="l47-val">12.4 亿</span></div>
<div class="l47-row" style="--bar-v:1"><span class="l47-label">2026E</span><span class="l47-val">21 亿</span></div>
</div></div></section>`;
writeInput('chart-abs.html', `${ABS}\n`);
const abs = normalizeChartData(ABS);
write('chartData.abs.result.json', json({ html: abs.html, problems: abs.problems }));

// 改完文字之后的那条入口：所有编辑接口都要跑它，回的 notes 必须显示出来。
const edited = ABS.replace('12.4 亿', '30 亿');
const re = rechartEdited(edited);
write('chartData.rechartEdited.result.json', json({ html: re.html, notes: re.notes }));

// ---------------------------------------------------------------- 4. data-eid 注入

const eided = injectEids(PAGE_L1);
write('pageEdit.injectEids.L1.html', `${eided}\n`);
write('pageEdit.injectEids.L1.eids.json', json(eidsIn(eided)));
// 幂等：已经有 eid 的原样返回。
write('pageEdit.injectEids.idempotent.json', json({ same: injectEids(eided) === eided }));

// ---------------------------------------------------------------- 5. 导出

const exp = exportDeck(
  [
    { page: 1, html: PAGE_L13, veil: 0.35 },
    { page: 2, html: PAGE_L1 },
    { page: 3, html: PAGE_L47 },
  ],
  3,
  META,
  'https://example.com'
);
write('export.result.json', json({ filename: exp.filename, warnings: exp.warnings, placeholders: exp.placeholders }));
write('export.html', exp.html);
// localhost 那一档必须多一条 warning。
const expLocal = exportDeck([{ page: 1, html: PAGE_L1 }], 1, META, 'http://localhost:3001');
write('export.localhost.result.json', json({ warnings: expLocal.warnings, placeholders: expLocal.placeholders }));

// ---------------------------------------------------------------- 6. 案例库解析

write(
  'layoutLibrary.index.json',
  json(
    layouts().map((l) => ({
      id: l.id,
      num: l.num,
      name: l.name,
      title: l.title,
      roles: l.roles,
      shape: l.shape,
      imageSlots: l.imageSlots,
      fullbleed: l.fullbleed,
      hasCard: l.hasCard,
      noHeader: l.noHeader,
      hasDetail: l.hasDetail,
      refImage: l.refImage ?? null,
      demoUrl: l.demoUrl,
      selectTextChars: l.selectText.length,
      buildTextChars: l.buildText.length,
    }))
  )
);
// 规划 prompt 里那一整段版式清单（模型真正读到的东西）。
write('layoutLibrary.selectTexts.txt', `${layouts().map((l) => l.selectText).join('\n\n')}\n`);
write(
  'layoutLibrary.meta.json',
  json({
    total: layouts().length,
    templateChars: library().template.length,
    designTokensChars: library().designTokens.length,
    illustrationStyleChars: library().illustrationStyle.length,
    demoIds: [...frags.keys()],
  })
);

// ---------------------------------------------------------------- 7. 画风库与生图提示词

write(
  'styleLibrary.styles.json',
  json({
    defaultStyleId: defaultStyleId(),
    styles: styles().map((s) => ({
      id: s.id,
      name: s.name,
      isDefault: s.isDefault,
      applicable: s.applicable,
      render: s.render,
      composition: s.composition,
      taboo: s.taboo,
      templateChars: {
        concept: s.templates.concept.length,
        case: s.templates.case.length,
        data: s.templates.data.length,
      },
    })),
    colorsDefault: deckColors(),
    colorsPB: deckColors({ palette: 'P-B', font: 'F-A', density: 'D-B', header: 'H-A' }),
  })
);
// 渲染后的生图提示词：模板占位符全部替换掉、色值跟着 deck 规范走。
const s0 = styles()[0];
write(
  'styleLibrary.renderedPrompts.json',
  json(
    (['concept', 'case', 'data'] as const).map((mode) => ({
      styleId: s0.id,
      mode,
      prompt: renderStylePrompt(s0, mode, {
        theme: '算力基础设施的三层结构',
        scene: '等距视角的城市算力机房，蓝紫冷色，数据流从机柜流向城市天际线',
        ratio: '16:9',
        design: META.design,
      }),
    }))
  )
);

// ---------------------------------------------------------------- 清单

// MANIFEST 自己不进 MANIFEST（不然它的哈希永远对不上自己）。
fs.writeFileSync(path.join(OUT, 'MANIFEST.json'), json(written));
console.log(`golden/ 写了 ${Object.keys(written).length} 个文件`);
