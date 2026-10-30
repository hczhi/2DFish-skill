// 新卡共用的两个小工具（旧卡里各有一份同样的写法，没动它们）。

/** 固定种子的伪随机（0–1）：同一个 (i, k) 永远同一个数。带随机感的效果一律用它，不用 Math.random —— 导出逐帧截图时整屏乱跳。 */
export const hash = (i: number, k: number) => { const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return x - Math.floor(x) }

/** 「名字 数值」一行一项，数值读不出来时 v = NaN（卡片画 ?，由模版的 check 报出来，不当成 0） */
export interface Row { name: string; raw: string; v: number }
export const parseRows = (rows: unknown): Row[] =>
  (Array.isArray(rows) ? rows : []).filter((s) => typeof s === 'string' && s.trim()).map((s: string) => {
    const m = s.trim().match(/^(.*?)\s+([\d,.]+)$/)
    return m ? { name: m[1], raw: m[2], v: Number(m[2].replace(/,/g, '')) } : { name: s.trim(), raw: '?', v: NaN }
  })
/** 跳数时按原值的小数位数显示（「3.5」跳的时候不显示成「3.4999」） */
export const fmtLike = (raw: string, v: number) => v.toFixed((raw.replace(/,/g, '').split('.')[1] || '').length)
