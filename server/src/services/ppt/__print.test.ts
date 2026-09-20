import { it } from 'vitest';
import { demoFragments } from './demoDeck.js';
import { layouts } from './layoutLibrary.js';
import { computeSpaceHints } from './imageSpace.js';
it('print', () => {
  const frags = demoFragments();
  const rows: string[] = [];
  for (const l of layouts()) {
    const html = frags.get(l.id);
    if (!html) continue;
    const imgs = (html.match(/<img|url\(/g) || []).length;
    if (!imgs) continue;
    const hints = computeSpaceHints(html);
    rows.push(`${l.id}\tfb=${l.fullbleed ? 1 : 0}\timgs=${imgs}\t${[...hints.entries()].map(([k, v]) => `${k}:${v.where}/${v.pct}`).join(' ') || '(none)'}`);
  }
  console.log(rows.join('\n'));
});
