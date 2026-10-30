import { createRequire } from 'module';
import { readFile } from 'fs/promises';
import path from 'path';

// 汉字笔顺骨架（hanzi-writer-data，Arphic Public License，约 9500 字）：每个字是按书写顺序排好的若干条中线，
// 坐标在 1024 见方、y 轴朝上。只回 medians（画面只用中线一笔一笔写），不回轮廓。
// 库里没有的字放进 missing 回给前端 —— 前端那几个字退成普通字体并说出来，不悄悄画成空白。

const require = createRequire(import.meta.url);
const dir = path.dirname(require.resolve('hanzi-writer-data/package.json'));
const cache = new Map<string, number[][][] | null>();

export const MAX_STROKE_CHARS = 400;

async function load(ch: string): Promise<number[][][] | null> {
  if (cache.has(ch)) return cache.get(ch)!;
  let medians: number[][][] | null = null;
  try {
    const j = JSON.parse(await readFile(path.join(dir, `${ch}.json`), 'utf8'));
    if (Array.isArray(j.medians)) medians = j.medians;
  } catch {
    medians = null;
  }
  cache.set(ch, medians);
  return medians;
}

/** 只认单个汉字（CJK 统一表意文字）；数字、字母、标点由前端用字体写，不来这里查。 */
const HAN = /^\p{Script=Han}$/u;

export async function strokesFor(chars: string[]) {
  const unique = [...new Set(chars)].filter((c) => HAN.test(c));
  const out: Record<string, number[][][]> = {};
  const missing: string[] = [];
  await Promise.all(unique.map(async (c) => {
    const m = await load(c);
    if (m) out[c] = m;
    else missing.push(c);
  }));
  return { strokes: out, missing };
}
