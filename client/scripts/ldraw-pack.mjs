// 把用到的 LDraw 官方零件连同全部子文件打成一个 .mpd，放进 public/ 跟着前端构建走。
// 不在运行时从 LDraw 库逐个拉：一个零件就是几十个小文件请求，而且线上不一定连得到那个站。
//
//   node scripts/ldraw-pack.mjs public/mech/parts.mpd 3648b 10928 3649 32524 32525 4519 3707 3713 6632 3673 2850a 2851 2852 2853a 2854 3704 3705 3737 32316 2819 6592 6536 32005 6628 2736 55982 56891 32278 40490 62520 62519 3706 3708
//
// 零件表在 src/components/mech/mechParts.ts 的 PARTS，加零件时两边一起改（缺了的话页面会点名报错）。
//
// 主文件里每个零件放一行（原点、单位矩阵、颜色 16），前端按 userData.fileName 认零件、
// 自己摆位置 —— 位置由代码算，不写进这个文件。
// 零件授权 CC BY 2.0 / 4.0（LDraw.org），页面上要署名。
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

const BASE = 'https://library.ldraw.org/library/official/'
const CACHE = join(tmpdir(), 'ldraw-cache')
mkdirSync(CACHE, { recursive: true })

const [out, ...ids] = process.argv.slice(2)
if (!out || ids.length === 0) {
  console.error('用法: node scripts/ldraw-pack.mjs <输出.mpd> <零件编号...>')
  process.exit(1)
}

async function get(path) {
  const cached = join(CACHE, path.replace(/\//g, '__'))
  if (existsSync(cached)) return readFileSync(cached, 'utf8')
  let res
  for (;;) {
    res = await fetch(BASE + path)
    // 那个站限流很紧。429 当成「不在这个目录」的话会报一句找不到零件，指错方向。
    if (res.status !== 429) break
    const wait = Number(res.headers.get('retry-after') || 10)
    console.log(`限流，${wait} 秒后重试 ${path}`)
    await new Promise((r) => setTimeout(r, wait * 1000 + 500))
  }
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`)
  const text = await res.text()
  writeFileSync(cached, text)
  return text
}

// 引用写法是 `s\3648s01.dat` / `48\1-4cyli.dat` / `stud.dat`，和加载器一样先试 parts/ 再试 p/。
async function resolve(ref) {
  for (const dir of ['parts/', 'p/']) {
    const text = await get(dir + ref)
    if (text !== null) return text
  }
  throw new Error(`LDraw 库里找不到 ${ref}（parts/ 和 p/ 都试过了）`)
}

const files = new Map() // 规范化文件名 -> 内容
async function walk(ref) {
  const name = ref.toLowerCase().replace(/\\/g, '/')
  if (files.has(name)) return
  files.set(name, '')
  const text = await resolve(name)
  files.set(name, text)
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim().split(/\s+/)
    if (t[0] === '1' && t.length >= 15) await walk(t.slice(14).join(' '))
  }
}

for (const id of ids) await walk(`${id}.dat`)

const main = ids.map((id) => `1 16 0 0 0 1 0 0 0 1 0 0 0 1 ${id}.dat`)
const parts = [`0 FILE main.ldr`, `0 packed by scripts/ldraw-pack.mjs: ${ids.join(' ')}`, ...main, '']
// 内嵌文件名必须和加载器查缓存的键一致：它把 `s/` 改写成 `parts/s/`、`48/` 改写成 `p/48/`
// （LDrawLoader 解析 type 1 行那段）。对不上的话它不报错，而是去 parts/ 下逐个 fetch，
// 线上那个路径不存在，于是零件永远加载不完。
const embedName = (n) => (n.startsWith('s/') ? 'parts/' + n : n.startsWith('48/') ? 'p/' + n : n)
for (const [name, text] of files) parts.push(`0 FILE ${embedName(name)}`, text.replace(/\r/g, '').trimEnd(), '')

mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, parts.join('\n'))
console.log(`${out}: ${ids.length} 个零件，${files.size} 个文件，${(Buffer.byteLength(parts.join('\n')) / 1024).toFixed(0)} KB`)
