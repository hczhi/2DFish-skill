// 报告的「第一层 / 第二层」阅读信息：每章状态灯 + 一句话结论 + 2-3 条要点、每章的数据核验说明、摘要的关键发现、改进清单。
// **全部由代码从已有的章节数据推出来，不调模型**（不多花钱，也不会多出一层编造）：模型写的长文仍在各章明细里，
// 这里只做「挑重点、数个数、排顺序」。数据缺失时返回 null / 空，界面显示「还没跑到」。

export type Light = 'good' | 'watch' | 'risk' | 'info' | 'na'

export interface ChapterHealth {
  light: Light
  headline: string
  points: string[]
  /** 数据核验说明（丢掉了几条、哪些数找不到出处、检索失败…）—— 精简模式下不在正文里出现，收进章节右上角的「数据说明」。 */
  sys: string[]
}

const first = (s: string | undefined, n = 60) => {
  const t = (s || '').split(/[。；;！!？?\n]/)[0].trim()
  return t.length > n ? `${t.slice(0, n)}…` : t
}
const cnt = (arr: unknown[] | undefined) => (Array.isArray(arr) ? arr.length : 0)

export function chapterHealth(id: string, r: any): ChapterHealth | null {
  switch (id) {
    case 'diagnosis': {
      const d = r.diagnosis
      if (!d) return null
      const light: Light = /第一|第二/.test(d.band) ? 'good' : /第三/.test(d.band) ? 'watch' : 'risk'
      return {
        light, headline: `总分 ${d.totalP} · ${d.band} · ${d.quadrant}`,
        points: [first(d.verdict, 70), `改材料就能拿回 ${d.recoverableP} 分`].filter(Boolean),
        sys: [...(d.scoreInText ? ['模型在结论文字里写了分数，以系统算的为准'] : []), ...(d.missingParts?.length ? [`模型这次没给出：${d.missingParts.join('、')}（可重跑）`] : [])],
      }
    }
    case 'dims': {
      const d = r.diagnosis
      if (!d?.dims?.length) return null
      const weakest = [...d.dims].sort((a: any, b: any) => a.factP - b.factP)[0]
      const most = [...d.dims].sort((a: any, b: any) => b.recoverableP - a.recoverableP)[0]
      const fatal = d.dims.flatMap((x: any) => x.deductions).filter((x: any) => x.severity === '致命').length
      return {
        light: fatal ? 'risk' : /第四/.test(d.band) ? 'risk' : /第三/.test(d.band) ? 'watch' : 'good',
        headline: `最弱「${weakest.name}」${weakest.factP} 分 · 最值得改「${most.name}」可回收 +${most.recoverableP}`,
        points: [`标尺：${d.stageLabel || '通用'}`, fatal ? `${fatal} 条致命扣分` : '没有致命扣分'],
        sys: d.dims.flatMap((x: any) => x.deductions).filter((x: any) => x.quoteFound === false).length
          ? [`${d.dims.flatMap((x: any) => x.deductions).filter((x: any) => x.quoteFound === false).length} 条扣分引的原文在 BP 里找不到`] : [],
      }
    }
    case 'bpfix': {
      const a = r.advice
      if (!a) return null
      const fatal = a.fixes.filter((f: any) => f.level === '致命')
      return {
        light: fatal.length ? 'risk' : a.fixes.length ? 'watch' : 'good',
        headline: `${a.fixes.length} 条改写建议，其中 ${fatal.length} 条致命`,
        points: fatal.slice(0, 2).map((f: any) => first(f.problem, 50)),
        sys: a.droppedFixes ? [`${a.droppedFixes} 条改写建议引的原句在 BP 里找不到，已丢掉`] : [],
      }
    }
    case 'qa': {
      const a = r.advice
      if (!a) return null
      return { light: 'info', headline: `投资人大概率会问的 ${a.qa.length} 个问题`, points: a.qa.slice(0, 2).map((q: any) => first(q.q, 50)), sys: [] }
    }
    case 'sec01': {
      const c = r.consistency, v = r.revenue, cr = r.credibility, t = r.team, cd = r.credit
      if (!r.factCard) return null
      const conflicts = c ? c.items.filter((i: any) => i.status === 'conflict') : []
      const fatal = conflicts.filter((i: any) => i.severity === '致命').length
      const risk = v ? v.metrics.filter((m: any) => m.status === 'risk').length : 0
      const gaps = v ? v.gaps.length : 0
      const light: Light = cr?.rating === '低' || fatal ? 'risk' : conflicts.length || gaps >= 4 || cr?.rating === '中' ? 'watch' : 'good'
      const points = [
        cr ? `BP 可信度：${cr.rating}（${cr.ratingBasis.split('（')[0]}）` : '',
        c ? `${conflicts.length} 处口径冲突${fatal ? `，${fatal} 处致命` : ''}` : '',
        v ? `收入质量：${risk} 项风险、${gaps} 项没给数据` : '',
        t && !t.skipped ? `团队：${t.overall.level}（${t.members.filter((m: any) => m.status !== '待外部核实').length}/${t.members.length} 位找到外部印证）` : '',
      ].filter(Boolean)
      const sys = [
        ...(c?.dropped?.length ? [`一致性审计：模型报的 ${c.dropped.length} 条原文核不上，已丢掉（${c.dropped.join('、')}）`] : []),
        ...(v ? v.inputs.filter((i: any) => i.rejected).map((i: any) => `收入质量：「${i.raw}」没采用 —— ${i.rejected}`) : []),
        ...(cr?.droppedClaims ? [`可信度：${cr.droppedClaims} 条声明原文核不上，已丢掉`] : []),
        ...(cr ? cr.claims.filter((x: any) => x.downgraded).map((x: any) => `可信度：「${first(x.claim, 24)}」没引到证据，改成了未核到`) : []),
        ...(t?.droppedSignals ? [`团队：${t.droppedSignals} 条印证的资料里没有这个人的名字，已丢掉`] : []),
        ...(t?.skipped ? [`团队：${t.skipped}`] : []),
        ...(cd?.skipped ? [`信用档案：${cd.skipped}`] : []),
        ...(cd ? cd.items.filter((i: any) => i.otherCompany).map((i: any) => `信用档案：${i.label} 的资料疑似同名公司，没采用`) : []),
      ]
      return { light, headline: points[0] || '企业基本面', points: points.slice(1), sys }
    }
    case 'sec02': {
      const i = r.industry
      if (!i) return null
      const uns = i.kpis.filter((k: any) => k.unsourced).length
      const k0 = i.kpis.find((k: any) => !k.unsourced) || i.kpis[0]
      return {
        light: 'info', headline: k0 ? `${k0.label}：${k0.value}${k0.unit}${k0.delta ? `（${k0.delta}）` : ''}` : `${i.topic}`,
        points: i.trends.slice(0, 2).map((t: any) => `${t.strength} · ${t.title}`),
        sys: [
          ...(uns ? [`${uns} 个关键数字在出处里找不到`] : []), ...(i.keywordNote ? [i.keywordNote] : []),
          ...i.failedQueries.map((f: any) => `检索「${f.q}」失败：${f.error}`), ...(i.trimmed ? [`${i.trimmed} 条检索结果超出容量被裁掉`] : []),
        ],
      }
    }
    case 'sec03': {
      const c = r.competitors
      if (!c) return null
      const funded = c.competitors.filter((x: any) => x.rounds.length).length
      return {
        light: 'info', headline: `${c.competitors.length} 家竞品，${funded} 家查到融资记录`,
        points: [c.positionMap ? first(c.positionMap.conclusion, 70) : (c.positionMapNote || '')].filter(Boolean),
        sys: [...(c.dropped.length ? [`${c.dropped.length} 个名字在资料里找不到，已丢掉（${c.dropped.slice(0, 4).join('、')}${c.dropped.length > 4 ? '…' : ''}）`] : []), ...(c.fundingNote ? [c.fundingNote] : []), ...c.failedQueries.map((f: any) => `检索「${f.q}」失败：${f.error}`)],
      }
    }
    case 'sec04': {
      const c = r.competitors
      if (!c) return null
      return { light: 'info', headline: `${c.benchmarks.length} 家对标企业`, points: c.benchmarks.slice(0, 2).map((b: any) => `${b.name}：${first(b.outlook, 40)}`), sys: [] }
    }
    case 'financing': {
      const f = r.financing
      if (!f) return null
      const gap = f.milestones.filter((m: any) => m.status !== 'met').length
      const light: Light = f.askVerdict === 'low' ? 'risk' : f.askVerdict === 'high' || f.valuationVerdict === 'above' || gap ? 'watch' : f.askVerdict === 'ok' ? 'good' : 'na'
      return {
        light, headline: first(f.askNote, 60) || '融资方案',
        points: [first(f.valuationNote, 60), f.milestones.length ? `到${f.reference?.nextRound || '下一轮'}还有 ${gap} 项门槛未达到` : ''].filter(Boolean),
        sys: f.numbersOutside.length ? [`建议文字里出现了系统没算出来的数字（${f.numbersOutside.join('、')}）`] : [],
      }
    }
    case 'investors': {
      const v = r.investors
      if (!v) return null
      return {
        light: 'info', headline: `${v.investors.length} 家目标机构，${v.investors.filter((x: any) => x.partner).length} 家查到对口人`,
        points: [first(v.approachNote, 70)].filter(Boolean),
        sys: [...(v.dropped.length ? [`${v.dropped.length} 家机构在资料里找不到，已丢掉`] : []), ...v.investors.filter((x: any) => x.partnerRejected).map((x: any) => `${x.name}：模型给的对口人「${x.partnerRejected}」查不到，已去掉`)],
      }
    }
    case 'plan': {
      const p = r.plan
      if (!p) return null
      const n = p.phases.reduce((s: number, x: any) => s + x.items.length, 0)
      return { light: 'info', headline: `${p.quickWins.length} 件一周内能做掉，90 天排了 ${n} 项`, points: p.tradeoffs.slice(0, 2).map((t: any) => `${t.priority ? `[${t.priority}] ` : ''}${first(t.take, 46)}`), sys: [] }
    }
  }
  return null
}

/** 摘要页的「关键发现」：按严重程度挑 3 条（致命冲突 → 可信度矛盾 → 融资额判断 → 最大可回收维度）。 */
export function keyFindings(r: any): { light: Light; text: string; to: string }[] {
  const out: { light: Light; text: string; to: string }[] = []
  for (const i of (r.consistency?.items || []).filter((x: any) => x.status === 'conflict' && x.severity === '致命')) out.push({ light: 'risk', text: `${i.metric}：BP 自己前后矛盾 —— ${first(i.impact, 60)}`, to: 'sec01' })
  for (const c of (r.credibility?.claims || []).filter((x: any) => x.status === '存矛盾')) out.push({ light: 'risk', text: `「${first(c.claim, 30)}」与核验发现矛盾：${first(c.finding, 40)}`, to: 'sec01' })
  if (r.financing?.askVerdict === 'low' || r.financing?.askVerdict === 'high') out.push({ light: r.financing.askVerdict === 'low' ? 'risk' : 'watch', text: first(r.financing.askNote, 80), to: 'financing' })
  const dims = r.diagnosis?.dims || []
  if (dims.length) {
    const m = [...dims].sort((a: any, b: any) => b.recoverableP - a.recoverableP)[0]
    if (m.recoverableP > 0) out.push({ light: 'watch', text: `「${m.name}」事实 ${m.factP} 分、BP 只证明了 ${m.proofP} 分 —— 改材料就能拿回 ${m.recoverableP} 分`, to: 'dims' })
  }
  if (r.revenue?.gaps?.length >= 3) out.push({ light: 'watch', text: `收入质量有 ${r.revenue.gaps.length} 项 BP 没给数据（${r.revenue.gaps.slice(0, 3).map((g: any) => g.item).join('、')}…），投资人会先追问`, to: 'sec01' })
  return out.slice(0, 3)
}
