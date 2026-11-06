// 引文出处的显示。doc = null 是 BP 本身；否则是「附件K《名》」（用户一起传的补充材料，页码单独一套）。
// 只显示页码的话，附件第 3 页那句会被读成「BP 第 3 页」，他翻 BP 找不到。

/** 「第 6 页」/「附件2《合同.pdf》第 3 页」/「附件2《合同.pdf》」 */
export function whereLong(page: number | null | undefined, doc?: string | null): string {
  if (doc) return `${doc}${page ? ` 第 ${page} 页` : ''}`
  return page ? `第 ${page} 页` : ''
}

/** 「P06」/「附件2·P03」/「附件2」—— 窄的那一栏（交叉表、改写建议右上角）用。 */
export function whereShort(page: number | null | undefined, doc?: string | null): string {
  const p = page ? `P${String(page).padStart(2, '0')}` : ''
  if (doc) {
    const k = doc.match(/^附件\d+/)?.[0] || '附件'
    return p ? `${k}·${p}` : k
  }
  return p
}
