import { describe, it, expect } from 'vitest';
import { normalizeChartData } from './chartData.js';

/**
 * 这里测的全是「页面照样渲染出来了、读起来完全正常，只是条长不是那个数」的路 ——
 * 手测时看到的是一张干净完整的图表，条、单位、结论条全在。
 */

function bars(rows: Array<{ v: string; printed: string }>, rowsStyle = '', unit = '单位：%'): string {
  const body = rows
    .map(
      (r) =>
        `<div class="l47-row" style="--bar-v:${r.v}">` +
        `<div class="l47-name">渠道</div>` +
        `<div class="l47-track"><div class="l47-fill"></div><div class="l47-gap"></div></div>` +
        `<div class="l47-val">${r.printed}</div></div>`
    )
    .join('');
  return (
    `<section class="slide"><div class="slide-inner">` +
    `<div class="dt-unit"><span>${unit}</span></div>` +
    `<div class="l47-rows"${rowsStyle}>${body}</div>` +
    `</div></section>`
  );
}

/** 折线页：`axisCount` 单独给，是为了造出「标签比点少一个」那种看起来完全正常的页。 */
function line(
  rows: Array<{ v: string; printed: string }>,
  axisCount: number,
  polylineAttrs = ' points=""'
): string {
  const pts = rows
    .map(
      (r) =>
        `<div class="l53-col" style="--bar-v:${r.v}">` +
        `<b class="l53-dot"></b><div class="l53-val">${r.printed}</div></div>`
    )
    .join('');
  const axis = Array.from({ length: axisCount }, () => `<div class="l53-name">三月</div>`).join('');
  return (
    `<section class="slide"><div class="slide-inner">` +
    `<div class="dt-unit"><span>单位：%</span></div>` +
    `<div class="l53-plot"><div class="l53-cols">` +
    `<svg class="l53-svg" viewBox="0 0 100 100" preserveAspectRatio="none">` +
    `<polyline class="l53-line"${polylineAttrs}></svg>${pts}</div>` +
    `<div class="l53-axis">${axis}</div></div>` +
    `</div></section>`
  );
}

function maxOf(html: string): string | null {
  return html.match(/l47-rows"[^>]*--bar-max:([\d.]+)/)?.[1] ?? null;
}

describe('normalizeChartData · 条形图的量由代码算', () => {
  it('一组百分比的上限钉 100 —— 模型按最大值写的 40 会让 40% 那一条顶满轨道', () => {
    const html = bars(
      [
        { v: '40', printed: '40<i>%</i>' },
        { v: '30', printed: '30<i>%</i>' },
        { v: '20', printed: '20<i>%</i>' },
      ],
      ' style="--bar-max:40"'
    );
    const r = normalizeChartData(html);
    expect(maxOf(r.html)).toBe('100');
    // 出声，且说出真实成因（他看到的是「40% 却满格」，不是一句「上限不对」）
    expect(r.problems.join(' ')).toContain('40%');
    expect(r.problems.join(' ')).toContain('100');
  });

  it('条长用的数和右边印出来的数字对不上时，按印出来的那个改回去并出声', () => {
    const html = bars(
      [
        { v: '80', printed: '40<i>%</i>' },
        { v: '30', printed: '30<i>%</i>' },
      ],
      ' style="--bar-max:100"'
    );
    const r = normalizeChartData(html);
    const first = r.html.match(/--bar-v:([\d.]+)/)![1];
    expect(first).toBe('40');
    expect(r.problems.some((p) => p.includes('第 1 行'))).toBe(true);
  });

  it('不是百分比时取整齐刻度（19 → 20），且这种改动不占一条 problems', () => {
    const html = bars(
      [
        { v: '19', printed: '19<i>分钟</i>' },
        { v: '3', printed: '3<i>分钟</i>' },
      ],
      ' style="--bar-max:19"',
      '单位：分钟'
    );
    const r = normalizeChartData(html);
    expect(maxOf(r.html)).toBe('20');
    expect(r.problems).toEqual([]);
  });

  it('百分号只写在 .dt-unit 里（每行不带 <i>）也认得出是百分比', () => {
    const html = bars(
      [
        { v: '40', printed: '40' },
        { v: '25', printed: '25' },
      ],
      '',
      '单位：%'
    );
    expect(maxOf(normalizeChartData(html).html)).toBe('100');
  });

  it('竖柱页同一套算法，且报错说的是「第 N 根」不是「第 N 行」', () => {
    // 画面上一根柱都没有「行」；说成行的话他会照行去找，而那一页上根本没有行。
    const html =
      `<section class="slide"><div class="slide-inner">` +
      `<div class="dt-unit"><span>单位：%</span></div>` +
      `<div class="l52-plot"><div class="l52-cols" style="--bar-max:40">` +
      `<div class="l52-col" style="--bar-v:80"><div class="l52-track"><div class="l52-gap"></div>` +
      `<div class="l52-fill"><div class="l52-val">40<i>%</i></div></div></div>` +
      `<div class="l52-name">三月</div></div>` +
      `<div class="l52-col" style="--bar-v:30"><div class="l52-track"><div class="l52-gap"></div>` +
      `<div class="l52-fill"><div class="l52-val">30<i>%</i></div></div></div>` +
      `<div class="l52-name">四月</div></div>` +
      `</div></div></div></section>`;
    const r = normalizeChartData(html);
    expect(r.html.match(/l52-cols"[^>]*--bar-max:([\d.]+)/)![1]).toBe('100');
    expect(r.html.match(/l52-col"[^>]*--bar-v:([\d.]+)/)![1]).toBe('40');
    expect(r.problems.some((p) => p.includes('第 1 根'))).toBe(true);
    expect(r.problems.join(' ')).not.toContain('行');
  });

  it('折线页：模型自己算的 points 一律重算成格子中心，点和线来自同一次计算', () => {
    // 模型按 `i*100/(n-1)` 写坐标（0 / 50 / 100 一眼看着对），整条线比点阵偏半格、首尾贴边，
    // 而那一页是一张完整好看的折线图，一处都不报错。
    const html = line(
      [
        { v: '40', printed: '40<i>%</i>' },
        { v: '60', printed: '60<i>%</i>' },
        { v: '100', printed: '100<i>%</i>' },
      ],
      3,
      ' points="0,60 50,40 100,0"/'
    );
    const r = normalizeChartData(html);
    expect(r.html.match(/<polyline[^>]*points="([^"]*)"/)![1]).toBe('16.6667,60 50,40 83.3333,0');
    expect([...r.html.matchAll(/--pt-y:([\d.]+%)/g)].map((m) => m[1])).toEqual(['40%', '60%', '100%']);
    // 自闭合的斜杠要原样留着：改成 `<polyline …>` 之后它在 svg 里一直开着，后面的兄弟节点
    // 全变成它的子节点，那一页少掉一整块而 html 仍然「合法」。
    expect(/<polyline[^>]*\/>/.test(r.html)).toBe(true);
  });

  it('折线页横轴标签少一个时出声 —— 每个点的标签都会错一格', () => {
    const html = line([{ v: '40', printed: '40<i>%</i>' }, { v: '60', printed: '60<i>%</i>' }], 1);
    const r = normalizeChartData(html);
    expect(r.problems.some((p) => p.includes('2 个点') && p.includes('1 个'))).toBe(true);
  });

  it('环形页：几块合计 87% 时以 100 为分母、留灰缺口并出声，图例色片和环取同一份色序', () => {
    // 按「几块的合计」切的话这三块正好铺满一圈，每一块都比它印着的数字大一截 ——
    // 那一页是一张完整的环形图，颜色、单位、结论条全在，一处都不报错。
    const items = [
      { v: '46', printed: '46<i>%</i>' },
      { v: '27', printed: '27<i>%</i>' },
      { v: '14', printed: '14<i>%</i>' },
    ]
      .map(
        (r) =>
          `<div class="l54-item" style="--bar-v:${r.v}">` +
          `<b class="l54-chip"></b><div class="l54-label">渠道</div>` +
          `<div class="l54-val">${r.printed}</div></div>`
      )
      .join('');
    const html =
      `<section class="slide"><div class="slide-inner">` +
      `<div class="dt-unit"><span>单位：%</span></div>` +
      `<div class="l54-plot"><div class="l54-ring"><div class="l54-hole"><b>46<i>%</i></b></div></div>` +
      `<div class="l54-legend">${items}</div></div>` +
      `</div></section>`;
    const r = normalizeChartData(html);
    const ring = r.html.match(/l54-ring"[^>]*--ring:([^"]*)"/)![1];
    // 46% → 165.6deg，三块累加到 313.2deg，剩下的 13% 是灰缺口（不留的话最后一块自己延伸到 360）
    expect(ring).toBe(
      'conic-gradient(var(--c-brand) 0deg 165.6deg, var(--c-accent) 165.6deg 262.8deg, ' +
        'var(--c-ink) 262.8deg 313.2deg, var(--c-hairline) 313.2deg 360deg)'
    );
    // 图例色片的颜色必须和环上那几块同序（各写一份的话图例说蓝色是直营、环上那块蓝的是分销）
    expect([...r.html.matchAll(/--slice:(var\(--c-[a-z-]+\))/g)].map((m) => m[1])).toEqual([
      'var(--c-brand)',
      'var(--c-accent)',
      'var(--c-ink)',
    ]);
    expect(r.problems.some((p) => p.includes('87') && p.includes('13'))).toBe(true);
  });

  it('跑两遍结果一样（migration 102 会重复跑）', () => {
    const html = bars([{ v: '40', printed: '40<i>%</i>' }], ' style="--bar-max:40"');
    const once = normalizeChartData(html).html;
    expect(normalizeChartData(once).html).toBe(once);
  });
});
