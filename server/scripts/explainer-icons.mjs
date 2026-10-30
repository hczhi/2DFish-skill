// 从前端的图标表生成服务端用的图标清单（只要 id + 中文关键词，发给 AI 挑、服务端核）。
// 前端 client/src/components/broll/iconLibrary.ts 或 explainer/geometry.ts 的 PROPS 改了之后重新跑：
//   node server/scripts/explainer-icons.mjs
// 不同步的后果不是静默的：AI 挑了前端没有的图标，画面上是问号框、编译提示里会报。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const parse = (file, re) => {
  const src = fs.readFileSync(path.join(root, file), 'utf8');
  return [...src.matchAll(re)].map((m) => ({ id: m[1], tags: [...m[2].matchAll(/'([^']+)'/g)].map((t) => t[1]) }));
};
const props = parse('client/src/components/explainer/geometry.ts', /\{ id: '([a-z]+)', tags: \[([^\]]*)\], draw:/g);
const icons = parse('client/src/components/broll/iconLibrary.ts', /\{ id: '([A-Za-z0-9]+)', node: [A-Za-z0-9]+, tags: \[([^\]]*)\] \}/g);
if (!props.length || icons.length < 50) throw new Error(`解析出来的图标太少（自定义 ${props.length} / Lucide ${icons.length}），多半是源文件格式变了`);
const out = path.join(root, 'server/src/services/explainer/iconCatalog.json');
fs.writeFileSync(out, JSON.stringify([...props, ...icons], null, 1) + '\n');
console.log(`写入 ${out}：自定义 ${props.length} 个 + Lucide ${icons.length} 个`);
