import { keyFindings, type Light } from '../health'

// 演示版（给客户讲解用）：从已经跑完、核验过的报告数据里由代码挑重点排成一页一页，不调模型、不扣点。
//
// 两条规矩：
//   ① **没核实的条目不上演示版**（`unsourced` 的指标 / 趋势 / 对标、资料里核不到金额的融资轮、别家公司的信用记录）。
//      演示版不显示「单一来源 / 未核到」这类系统提示，只藏提示、照常展示内容的话，客户会把没核实的数字当事实听进去。
//   ② 没有数据的那一页**整页跳过**，跳过了哪几页、为什么，回在 `skipped` 里给总览页显示（讲解人要知道少了什么）。

export const PARTS = ['结论', '你的公司', '外部视角', '融资与行动'] as const

export type SlideKind =
  | 'cover' | 'verdict' | 'dims' | 'top3' | 'divider'
  | 'credibility' | 'consistency' | 'revenue' | 'team' | 'credit'
  | 'industry' | 'map' | 'competitors' | 'benchmarks'
  | 'financing' | 'investors' | 'qa' | 'bpfix' | 'plan' | 'end'

export interface Slide {
  id: string
  kind: SlideKind
  /** 属于第几部分（PARTS 下标）；封面 / 结束页为 -1。 */
  part: number
  /** 页眉小字，如「01 体检结论」。 */
  kicker: string
  /** 这一页的结论句（大标题）。 */
  title: string
  /** 页脚来源。 */
  foot?: string
  d: any
}

export interface DeckMeta { company: string; brandLine: string; date: string }

/** 取第一句（到句号 / 分号），超长截断。 */
export const first = (s: string | undefined | null, n = 64) => {
  const t = (s || '').split(/[。；;！!？?\n]/)[0].trim()
  return t.length > n ? `${t.slice(0, n)}…` : t
}
const cut = (s: string | undefined | null, n: number) => {
  const t = (s || '').trim()
  return t.length > n ? `${t.slice(0, n)}…` : t
}
const wan = (n: number) => (n >= 10000 ? `${+(n / 10000).toFixed(2)} 亿` : `${Math.round(n)} 万`)

type Src = { n: number; domain?: string; title?: string; tier?: number }
/** 页脚来源：被这一页用到的资料编号 → 「36kr.com、caixin.com 等 5 条公开资料」。 */
function footOf(sources: Src[] | undefined, used: number[]): string | undefined {
  const set = new Set(used)
  const hit = (sources || []).filter((s) => set.has(s.n))
  if (!hit.length) return undefined
  const ds = [...new Set(hit.map((s) => (s.tier === 0 ? '用户提供资料' : s.domain || s.title || '')).filter(Boolean))]
  return `来源：${ds.slice(0, 3).join('、')}${hit.length > 3 || ds.length > 3 ? ` 等 ${hit.length} 条` : ''}公开资料`
}
const srcOf = (xs: { src?: number[] }[]) => xs.flatMap((x) => x.src || [])

const LEVEL_LIGHT: Record<string, Light> = { 致命: 'risk', 重要: 'watch', 可选: 'info' }

export function buildSlides(r: any, meta: DeckMeta): { slides: Slide[]; skipped: string[] } {
  const slides: Slide[] = []
  const skipped: string[] = []
  let partSeen = -1
  let chap = 0
  const add = (s: Omit<Slide, 'kicker'> & { kicker?: string }) => {
    if (s.part >= 0 && s.part !== partSeen) {
      if (s.part > 0) slides.push({ id: `part-${s.part}`, kind: 'divider', part: s.part, kicker: '', title: PARTS[s.part], d: { no: ['一', '二', '三', '四'][s.part], items: [] as string[] } })
      partSeen = s.part
    }
    if (s.kind !== 'cover' && s.kind !== 'end') chap++
    slides.push({ kicker: s.kicker ?? `${String(chap).padStart(2, '0')}`, ...s } as Slide)
  }
  const skip = (what: string, why: string) => skipped.push(`${what}：${why}`)

  const dg = r.diagnosis
  // ---------- 封面 ----------
  slides.push({ id: 'cover', kind: 'cover', part: -1, kicker: '', title: meta.company || 'BP 体检报告', d: { ...meta, score: dg?.totalP ?? null, band: dg?.band || '', quadrant: dg?.quadrant || '' } })

  // ---------- 一 · 结论 ----------
  if (dg) {
    add({
      id: 'verdict', kind: 'verdict', part: 0, title: first(dg.verdict, 70) || `总分 ${dg.totalP}，${dg.band}`,
      d: { total: dg.totalP, proof: dg.proofP, recoverable: dg.recoverableP, band: dg.band, quadrant: dg.quadrant, findings: keyFindings(r) },
    })
    const dims = dg.dims || []
    if (dims.length) {
      const weakest = [...dims].sort((a: any, b: any) => a.factP - b.factP)[0]
      const rec = [...dims].sort((a: any, b: any) => b.recoverableP - a.recoverableP)[0]
      add({
        id: 'dims', kind: 'dims', part: 0,
        title: rec.recoverableP > 0 && rec.key !== weakest.key
          ? `短板在「${weakest.name}」；「${rec.name}」改材料就能拿回 ${rec.recoverableP} 分`
          : `短板在「${weakest.name}」（${weakest.factP} 分）`,
        d: { dims: dims.map((x: any) => ({ name: x.name, fact: x.factP, proof: x.proofP, rec: x.recoverableP, note: first(x.note, 40) })) },
      })
    }
    if (dg.top3?.length) {
      add({ id: 'top3', kind: 'top3', part: 0, title: '最该先改的三件事', d: { items: dg.top3.slice(0, 3).map((t: any) => ({ title: t.title, why: cut(t.why, 90), fix: cut(t.fix, 110) })) } })
    } else skip('最该改的三件事', '评分章没给出')
  } else skip('体检结论 / 五维评分 / 三件事', '评分还没跑完')

  // ---------- 二 · 你的公司 ----------
  const cr = r.credibility
  if (cr?.claims?.length) {
    const c = (st: string) => cr.claims.filter((x: any) => x.status === st).length
    const counts = { ok: c('已核实'), part: c('部分核实'), bad: c('存矛盾'), none: c('未核到') }
    const order: Record<string, number> = { 存矛盾: 0, 未核到: 1, 部分核实: 2, 已核实: 3 }
    add({
      id: 'credibility', kind: 'credibility', part: 1,
      title: `BP 可信度「${cr.rating}」：${cr.claims.length} 条关键声明，${counts.ok} 条经外部核实${counts.bad ? `，${counts.bad} 条与公开信息矛盾` : ''}`,
      d: { rating: cr.rating, counts, total: cr.claims.length, claims: [...cr.claims].sort((a: any, b: any) => order[a.status] - order[b.status]).slice(0, 4).map((x: any) => ({ claim: cut(x.claim, 46), status: x.status, finding: cut(x.finding, 64) })) },
      foot: '来源：BP 原文 + 本报告各章核验结果',
    })
  } else skip('BP 可信度', '这一章没跑出声明')

  const cs = r.consistency
  if (cs?.items?.length) {
    const sevOrder: Record<string, number> = { 致命: 0, 重要: 1, 可选: 2 }
    const conflicts = cs.items.filter((x: any) => x.status === 'conflict').sort((a: any, b: any) => (sevOrder[a.severity] ?? 3) - (sevOrder[b.severity] ?? 3))
    const fatal = conflicts.filter((x: any) => x.severity === '致命').length
    add({
      id: 'consistency', kind: 'consistency', part: 1,
      title: conflicts.length ? `BP 里有 ${conflicts.length} 处数字前后不一致${fatal ? `，其中 ${fatal} 处投资人会直接追问` : ''}` : `${cs.counts.consistent} 项关键数字前后一致，经得起交叉翻看`,
      d: {
        counts: cs.counts,
        conflicts: conflicts.slice(0, 3).map((x: any) => ({
          metric: x.metric, light: LEVEL_LIGHT[x.severity] || 'info', severity: x.severity,
          values: x.values.slice(0, 2).map((v: any) => ({ quote: cut(v.quote, 26), page: v.page, doc: v.doc })), impact: cut(x.impact, 70),
        })),
      },
      foot: '来源：BP 原文（每条引文都已在 BP 中定位）',
    })
  } else skip('一致性', '这一章没跑出结果')

  const rv = r.revenue
  if (rv?.metrics?.length) {
    // 「未披露 / 不可计算」也上页（灰显）：对客户来说「BP 没给这个数」本身就是要讲的重点。
    const hasNum = (v: string) => /\d/.test(v || '')
    const metrics = rv.metrics.slice(0, 8).map((m: any) => ({ name: m.name, value: m.value || '—', status: hasNum(m.value) ? m.status || 'info' : 'na', basis: cut(m.basis, 34) }))
    const shown = metrics.filter((m: any) => m.status !== 'na').length
    add({
      id: 'revenue', kind: 'revenue', part: 1,
      title: shown * 2 < metrics.length
        ? `收入数据披露不足：${metrics.length} 项投资人必看的指标，BP 只能算出 ${shown} 项`
        : first(rv.verdict, 70) || '收入质量',
      d: { metrics, gaps: (rv.gaps || []).slice(0, 5).map((g: any) => g.item) },
      foot: '来源：BP 原文数字，指标由系统按公式计算',
    })
  } else skip('收入质量', 'BP 里没有可计算的收入数字')

  const tm = r.team
  if (tm && !tm.skipped && tm.members?.length) {
    add({
      id: 'team', kind: 'team', part: 1, title: first(tm.overall?.note, 70) || `团队整体：${tm.overall?.level || ''}`,
      d: {
        level: tm.overall?.level || '', dims: (tm.dims || []).map((x: any) => ({ name: x.name, level: x.level })),
        members: tm.members.slice(0, 4).map((m: any) => ({ name: m.name, role: m.role, bio: cut(m.bio, 70), verified: m.status !== '待外部核实', signal: cut(m.signals?.[0]?.text, 40) })),
        gap: first((tm.dims || []).map((x: any) => x.gap).find(Boolean), 60),
      },
      foot: footOf(tm.sources, tm.members.flatMap((m: any) => (m.signals || []).flatMap((s: any) => s.src || []))) || '来源：BP 原文',
    })
  } else skip('团队', tm?.skipped || '这一章没跑')

  const ct = r.credit
  const risks = (ct?.items || []).filter((i: any) => i.risk && i.found && !i.unsourced && !i.otherCompany)
  if (risks.length) {
    add({
      id: 'credit', kind: 'credit', part: 1, title: `公开记录里有 ${risks.length} 项需要提前准备解释`,
      d: { company: ct.company, items: risks.slice(0, 6).map((i: any) => ({ label: i.label, value: cut(i.value, 70), bp: cut(i.bpCheck, 50) })) },
      foot: footOf(ct.sources, srcOf(risks)),
    })
  } else skip('信用档案', ct ? '没查到风险记录（演示版只在有风险时出这一页）' : '这一章没跑')

  // ---------- 三 · 外部视角 ----------
  const ind = r.industry
  if (ind) {
    const kpis = (ind.kpis || []).filter((k: any) => !k.unsourced).slice(0, 3)
    const bars = (ind.marketChart?.bars || []).filter((b: any) => !b.unsourced)
    const trends = (ind.trends || []).filter((t: any) => !t.unsourced).slice(0, 3)
    if (kpis.length || bars.length || trends.length) {
      add({
        id: 'industry', kind: 'industry', part: 2,
        title: trends[0] ? `${ind.topic ? `${ind.topic}：` : ''}${first(trends[0].title, 50)}` : ind.topic || '行业格局',
        d: {
          kpis: kpis.map((k: any) => ({ label: k.label, value: k.value, unit: k.unit, delta: k.delta })),
          chart: bars.length >= 2 ? { title: ind.marketChart.title, unit: ind.marketChart.unit, bars: bars.map((b: any) => ({ label: b.label, value: b.value })) } : null,
          trends: trends.map((t: any) => ({ title: t.title, judge: cut(t.judge, 70), meaning: cut(t.meaning, 70) })),
        },
        foot: footOf(ind.sources, [...srcOf(kpis), ...srcOf(bars), ...srcOf(trends)]),
      })
    } else skip('宏观分析', '没有核实过的行业数字')
  } else skip('宏观分析', '这一章没跑')

  const cp = r.competitors
  if (cp?.positionMap?.points?.length >= 2) {
    const m = cp.positionMap
    const self = m.points.filter((p: any) => p.self)
    const rest = m.points.filter((p: any) => !p.self)
    add({
      id: 'map', kind: 'map', part: 2, title: first(m.conclusion, 70) || '企业生态位',
      d: { ...m, points: [...self, ...rest].map((p: any, i: number) => ({ ...p, no: i + 1 })) },
      foot: footOf(cp.sources, srcOf(cp.competitors)),
    })
  } else if (cp) skip('生态位十字图', cp.positionMapNote || '能核实的竞品不到 2 家')

  if (cp?.competitors?.length) {
    const rows = cp.competitors.slice(0, 6).map((c: any) => {
      const last = [...(c.rounds || [])].sort((a: any, b: any) => String(b.date).localeCompare(String(a.date)))[0]
      return {
        name: c.name, positioning: cut(c.positioning, 40), diff: cut(c.diff, 60),
        round: last ? `${last.round}${last.amount && !last.amountUnsourced ? ` · ${last.amount}` : ''}${last.date ? ` · ${last.date}` : ''}` : c.stage && !/未覆盖/.test(c.stage) ? c.stage : '—',
        lead: last?.lead || '',
      }
    })
    const funded = cp.competitors.filter((c: any) => c.rounds?.length).length
    add({
      id: 'competitors', kind: 'competitors', part: 2,
      title: `同一个客户问题上有 ${cp.competitors.length} 家在做${funded ? `，${funded} 家已拿到公开融资` : ''}`,
      d: { rows }, foot: footOf(cp.sources, srcOf(cp.competitors)),
    })
  } else skip('竞品', '这一章没跑出竞品')

  const bms = (cp?.benchmarks || []).filter((b: any) => !b.unsourced)
  if (bms.length) {
    add({
      id: 'benchmarks', kind: 'benchmarks', part: 2, title: `${bms.map((b: any) => b.name).slice(0, 3).join('、')}走过的路，就是这条赛道的发展预期`,
      d: { items: bms.slice(0, 4).map((b: any) => ({ name: b.name, funding: cut(b.funding, 40), revenue: cut(b.revenue, 40), profit: cut(b.profit, 40), outlook: cut(b.outlook, 80) })) },
      foot: footOf(cp.sources, srcOf(bms)),
    })
  } else skip('对标企业', cp ? '没有核实过的对标企业' : '这一章没跑')

  // ---------- 四 · 融资与行动 ----------
  const fn = r.financing
  if (fn) {
    const AV: Record<string, string> = { low: '融少了', ok: '合理', high: '偏多', unknown: '' }
    add({
      id: 'financing', kind: 'financing', part: 3, title: first(fn.advice?.summary, 70) || first(fn.askNote, 70) || '融资方案',
      d: {
        stage: fn.stageLabel,
        cards: [
          { k: 'BP 计划融资', v: fn.ask?.value != null ? wan(fn.ask.value) : '未写明', tag: AV[fn.askVerdict] || '', light: fn.askVerdict === 'ok' ? 'good' : fn.askVerdict === 'unknown' ? 'info' : 'watch' },
          { k: '建议融资额', v: fn.suggestedAsk ? `${wan(fn.suggestedAsk[0])}–${wan(fn.suggestedAsk[1])}` : '—', tag: '18–24 个月跑道', light: 'info' },
          { k: '当前跑道', v: fn.runwayMonths != null ? `${fn.runwayMonths} 个月` : '—', tag: '', light: fn.runwayMonths != null && fn.runwayMonths < 12 ? 'risk' : 'info' },
          { k: '隐含投前估值', v: fn.impliedPre ? `${wan(fn.impliedPre[0])}–${wan(fn.impliedPre[1])}` : fn.disclosedValuation?.value != null ? wan(fn.disclosedValuation.value) : '—', tag: fn.disclosedValuation?.value != null ? 'BP 披露' : '按出让比例反推', light: 'info' },
        ],
        milestones: (fn.milestones || []).slice(0, 4).map((m: any) => ({ label: m.label, target: m.target, current: m.current, status: m.status })),
        next: fn.reference?.nextRound || '',
        // 只有没有门槛对照时才放建议文字（两样都放一页装不下）。
        advice: (fn.milestones || []).length ? [] : ([['融多少', fn.advice?.ask], ['估值', fn.advice?.valuation], ['股权', fn.advice?.equity], ['节奏', fn.advice?.sequencing]] as [string, string][])
          .filter(([, v]) => v && !/系统/.test(v)).map(([k, v]) => ({ k, v: first(v, 70) })), // 提到「系统算不出…」的是给读报告的人看的说明，不上演示
      },
      foot: '数字由系统按公式计算；估值区间、门槛为平台参考口径',
    })
  } else skip('融资方案', '这一章没跑')

  const iv = r.investors
  if (iv?.investors?.length) {
    const list = iv.investors.slice(0, 5)
    add({
      id: 'investors', kind: 'investors', part: 3, title: `优先接触 ${list.length} 家在本赛道有出资记录的机构`,
      d: { items: list.map((x: any) => ({ name: x.name, type: x.type, deal: cut(x.deal, 40), why: first(x.why, 56), approach: first(x.approach, 40) })) },
      foot: footOf(iv.sources, srcOf(list)),
    })
  } else skip('目标融资对象', iv ? '没查到有本赛道出资记录的机构' : '这一章没跑')

  const ad = r.advice
  if (ad?.qa?.length) {
    add({ id: 'qa', kind: 'qa', part: 3, title: `投资人读完这份 BP，最可能追问这 ${Math.min(ad.qa.length, 5)} 个问题`, d: { items: ad.qa.slice(0, 5).map((q: any) => ({ q: cut(q.q, 60), answer: first(q.answer, 70) })) } })
  } else skip('追问预演', '这一章没跑')
  if (ad?.fixes?.length) {
    add({
      id: 'bpfix', kind: 'bpfix', part: 3, title: `BP 有 ${ad.fixes.length} 处值得改写，先改这 ${Math.min(ad.fixes.length, 3)} 处`,
      d: { items: ad.fixes.slice(0, 3).map((f: any) => ({ level: f.level, light: LEVEL_LIGHT[f.level] || 'info', quote: cut(f.quote, 56), problem: cut(f.problem, 60), rewrite: cut(f.rewrite, 90) })) },
      foot: '来源：BP 原文（引文已在 BP 中定位）',
    })
  } else skip('BP 优化', '这一章没跑')

  const pl = r.plan
  if (pl?.phases?.length) {
    const t = pl.tradeoffs?.[0]
    add({
      id: 'plan', kind: 'plan', part: 3, title: t ? `90 天：先做「${cut(t.take, 24)}」，暂不做「${cut(t.drop, 20)}」` : '90 天行动计划',
      d: { phases: pl.phases.slice(0, 3).map((p: any) => ({ label: p.label, items: p.items.slice(0, 3).map((i: any) => ({ task: cut(i.task, 44), deliverable: cut(i.deliverable, 28) })) })), review: first(pl.reviewPoint, 60) },
    })
  } else skip('90 天计划', '这一章没跑')

  slides.push({ id: 'end', kind: 'end', part: -1, kicker: '', title: '谢谢', d: { company: meta.company, date: meta.date, next: (dg?.top3 || []).slice(0, 3).map((x: any) => x.title) } })

  // 部分分隔页上列出这一部分有哪几页。
  for (const s of slides) if (s.kind === 'divider') s.d.items = slides.filter((x) => x.part === s.part && x.kind !== 'divider').map((x) => x.id)
  return { slides, skipped }
}

/** 分隔页 / 总览用的短名。 */
export const SHORT: Record<string, string> = {
  verdict: '体检结论', dims: '五维评分', top3: '三件事', credibility: 'BP 可信度', consistency: '数字一致性', revenue: '收入质量',
  team: '团队', credit: '信用档案', industry: '行业格局', map: '生态位', competitors: '竞品', benchmarks: '对标企业',
  financing: '融资方案', investors: '目标投资人', qa: '投资人追问', bpfix: 'BP 改写', plan: '90 天计划',
}
