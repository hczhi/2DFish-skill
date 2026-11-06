<script setup lang="ts">
import { computed } from 'vue'
import Num from './Num.vue'
import { PARTS, SHORT, type Slide } from './slides'

// 演示版的一页（固定 1600×900 画布，外面按屏幕等比缩放）。页眉 / 页脚也画在画布里，缩略图看到的和投屏一致。
// 动效：带 .a 的元素按 --i 依次上浮淡入；条形图长出来；数字滚动。`still` = 总览缩略图，全部静止显示终值。
const props = defineProps<{ s: Slide; index: number; total: number; company: string; still?: boolean }>()
const d = computed(() => props.s.d)
const STATUS: Record<string, string> = { 已核实: 'good', 部分核实: 'watch', 存矛盾: 'risk', 未核到: 'info' }
const RATING: Record<string, string> = { 高: 'good', 中: 'watch', 低: 'risk' }
const MS: Record<string, [string, string]> = { met: ['good', '已达到'], gap: ['risk', '有差距'], unknown: ['info', '待补数据'] }
const pageNo = computed(() => `${String(props.index + 1).padStart(2, '0')} / ${String(props.total).padStart(2, '0')}`)
const chrome = computed(() => props.s.kind !== 'cover' && props.s.kind !== 'end')
const ring = (score: number) => 2 * Math.PI * 128 * (1 - Math.max(0, Math.min(100, score)) / 100)
const maxBar = computed(() => Math.max(1, ...((d.value.chart?.bars || []) as { value: number }[]).map((b) => b.value)))

// 十字图：画布内 760×600 的框。
const MX0 = 60, MX1 = 820, MY0 = 30, MY1 = 560
const mx = (x: number) => MX0 + x * (MX1 - MX0)
const my = (y: number) => MY1 - y * (MY1 - MY0)
const ax = (s: string) => { const t = (s || '').replace(/（.*?）|\(.*?\)/g, '').trim() || s; return t.length > 14 ? `${t.slice(0, 14)}…` : t }
</script>

<template>
  <div :class="['dk-slide', `k-${s.kind}`, { still }]">
    <!-- 页眉：四部分导航 -->
    <header v-if="chrome" class="dk-top">
      <span class="dk-brand">BP 体检报告</span>
      <nav class="dk-parts">
        <span v-for="(p, i) in PARTS" :key="p" :class="{ on: s.part === i }">{{ ['一', '二', '三', '四'][i] }} · {{ p }}</span>
      </nav>
      <span class="dk-page">{{ pageNo }}</span>
    </header>

    <!-- 封面 -->
    <template v-if="s.kind === 'cover'">
      <div class="cv-l">
        <div class="cv-tag a" style="--i:0">BP 体检报告 · 创业者版</div>
        <h1 class="a" style="--i:1">{{ s.title }}</h1>
        <div v-if="d.brandLine" class="cv-line a" style="--i:2">{{ d.brandLine }}</div>
        <div class="cv-rule a" style="--i:3" />
        <div class="cv-date a" style="--i:3">{{ d.date }}</div>
      </div>
      <div v-if="d.score !== null" class="cv-r a" style="--i:2">
        <div class="cv-ringbox">
          <svg viewBox="0 0 300 300" class="cv-ring">
            <circle cx="150" cy="150" r="128" class="trk" />
            <circle cx="150" cy="150" r="128" class="val" :style="{ '--off': ring(d.score) }" />
          </svg>
          <div class="cv-score"><Num :v="d.score" :still="still" :delay="400" /><small>/ 100</small></div>
        </div>
        <div class="cv-band">{{ d.band }}</div>
        <div v-if="d.quadrant" class="cv-q">{{ d.quadrant }}</div>
      </div>
    </template>

    <!-- 部分分隔页 -->
    <template v-else-if="s.kind === 'divider'">
      <div class="dv">
        <div class="dv-no a" style="--i:0">{{ d.no }}</div>
        <div class="dv-body">
          <div class="dv-k a" style="--i:1">PART {{ s.part + 1 }}</div>
          <h2 class="a" style="--i:1">{{ s.title }}</h2>
          <ul class="dv-list">
            <li v-for="(id, i) in d.items" :key="id" class="a" :style="{ '--i': i + 2 }">{{ SHORT[id] || id }}</li>
          </ul>
        </div>
      </div>
    </template>

    <!-- 结束页 -->
    <template v-else-if="s.kind === 'end'">
      <div class="end">
        <div class="end-k a" style="--i:0">{{ d.company }} · BP 体检报告</div>
        <h1 class="a" style="--i:1">谢谢</h1>
        <div v-if="d.next.length" class="end-next a" style="--i:2">
          <div class="end-h">接下来先做</div>
          <ol><li v-for="(n, i) in d.next" :key="i">{{ n }}</li></ol>
        </div>
        <div class="end-date a" style="--i:3">{{ d.date }}</div>
      </div>
    </template>

    <!-- 内容页 -->
    <template v-else>
      <div class="dk-head">
        <div class="dk-kicker a" style="--i:0"><b>{{ s.kicker }}</b>{{ SHORT[s.id] || '' }}</div>
        <h2 class="dk-title a" style="--i:1">{{ s.title }}</h2>
      </div>

      <div class="dk-body">
        <!-- 体检结论 -->
        <div v-if="s.kind === 'verdict'" class="g-verdict">
          <div class="vd-score a" style="--i:2">
            <div class="vd-big"><Num :v="d.total" :still="still" :delay="300" /><small>分</small></div>
            <div class="vd-band">{{ d.band }}</div>
            <div class="vd-q">{{ d.quadrant }}</div>
            <div class="vd-sub">
              <div><span>举证分</span><b><Num :v="d.proof" :still="still" :delay="450" /></b></div>
              <div><span>改材料可回收</span><b class="gold">+<Num :v="d.recoverable" :still="still" :delay="600" /></b></div>
            </div>
          </div>
          <div class="vd-find">
            <div class="col-h a" style="--i:2">关键发现</div>
            <div v-for="(f, i) in d.findings" :key="i" :class="['vd-item', 'a', f.light]" :style="{ '--i': i + 3 }">
              <i class="lt" /><span>{{ f.text }}</span>
            </div>
            <div v-if="!d.findings.length" class="vd-item a info" style="--i:3"><i class="lt" /><span>没有需要特别标出的硬伤。</span></div>
          </div>
        </div>

        <!-- 五维评分 -->
        <div v-else-if="s.kind === 'dims'" class="g-dims">
          <div class="dm-legend a" style="--i:2"><span><i class="f" />事实分 · 真实水平</span><span><i class="p" />举证分 · BP 能证明的</span></div>
          <div v-for="(x, i) in d.dims" :key="x.name" class="dm-row a" :style="{ '--i': i + 2 }">
            <div class="dm-name">{{ x.name }}</div>
            <div class="dm-bars">
              <div class="bar f"><i :style="{ '--w': `${x.fact}%`, '--d': `${300 + i * 120}ms` }" /><b><Num :v="x.fact" :still="still" :delay="300 + i * 120" /></b></div>
              <div class="bar p"><i :style="{ '--w': `${x.proof}%`, '--d': `${380 + i * 120}ms` }" /><b><Num :v="x.proof" :still="still" :delay="380 + i * 120" /></b></div>
            </div>
            <div class="dm-rec"><template v-if="x.rec > 0">可回收 <b>+{{ x.rec }}</b></template></div>
          </div>
        </div>

        <!-- 三件事 -->
        <div v-else-if="s.kind === 'top3'" class="g-cards3">
          <div v-for="(t, i) in d.items" :key="i" class="c3 a" :style="{ '--i': i + 2 }">
            <div class="c3-no">0{{ i + 1 }}</div>
            <h3>{{ t.title }}</h3>
            <p class="c3-why">{{ t.why }}</p>
            <div class="c3-fix"><span>怎么改</span>{{ t.fix }}</div>
          </div>
        </div>

        <!-- 可信度 -->
        <div v-else-if="s.kind === 'credibility'" class="g-split">
          <div class="cr-l a" style="--i:2">
            <div :class="['cr-rate', RATING[d.rating]]">{{ d.rating }}</div>
            <div class="cr-cap">BP 可信度</div>
            <div class="stack">
              <i class="good" :style="{ '--w': `${(d.counts.ok / d.total) * 100}%` }" />
              <i class="watch" :style="{ '--w': `${(d.counts.part / d.total) * 100}%` }" />
              <i class="risk" :style="{ '--w': `${(d.counts.bad / d.total) * 100}%` }" />
              <i class="info" :style="{ '--w': `${(d.counts.none / d.total) * 100}%` }" />
            </div>
            <div class="stack-k">
              <span class="good">已核实 {{ d.counts.ok }}</span><span class="watch">部分核实 {{ d.counts.part }}</span>
              <span class="risk">存矛盾 {{ d.counts.bad }}</span><span class="info">未核到 {{ d.counts.none }}</span>
            </div>
          </div>
          <div class="cr-r">
            <div v-for="(c, i) in d.claims" :key="i" class="row-card a" :style="{ '--i': i + 3 }">
              <span :class="['chip', STATUS[c.status]]">{{ c.status }}</span>
              <div><b>{{ c.claim }}</b><p>{{ c.finding }}</p></div>
            </div>
          </div>
        </div>

        <!-- 一致性 -->
        <div v-else-if="s.kind === 'consistency'" class="g-split">
          <div class="cs-l">
            <div class="stat a risk" style="--i:2"><b><Num :v="d.counts.conflict" :still="still" /></b><span>处前后不一致</span></div>
            <div class="stat a good" style="--i:3"><b><Num :v="d.counts.consistent" :still="still" /></b><span>项前后一致</span></div>
            <div class="stat a info" style="--i:4"><b><Num :v="d.counts.single" :still="still" /></b><span>项只出现一次</span></div>
          </div>
          <div class="cs-r">
            <div v-for="(c, i) in d.conflicts" :key="i" class="cf a" :style="{ '--i': i + 3 }">
              <div class="cf-h"><span :class="['chip', c.light]">{{ c.severity || '冲突' }}</span><b>{{ c.metric }}</b></div>
              <div class="cf-vs">
                <div v-for="(v, j) in c.values" :key="j" class="cf-v">「{{ v.quote }}」<small v-if="v.page">{{ v.doc ? `${v.doc} ` : '' }}第 {{ v.page }} 页</small></div>
              </div>
              <p>{{ c.impact }}</p>
            </div>
            <div v-if="!d.conflicts.length" class="empty a" style="--i:3">BP 里同一个数字在不同页的写法都对得上。</div>
          </div>
        </div>

        <!-- 收入质量 -->
        <div v-else-if="s.kind === 'revenue'" class="g-rev">
          <div class="mgrid">
            <div v-for="(m, i) in d.metrics" :key="m.name" :class="['metric', 'a', m.status]" :style="{ '--i': i + 2 }">
              <div class="mt-k">{{ m.name }}</div>
              <div class="mt-v"><Num :v="m.value" :still="still" :delay="200 + i * 80" /></div>
              <div class="mt-b">{{ m.basis }}</div>
            </div>
          </div>
          <div v-if="d.gaps.length" class="gaps a" :style="{ '--i': d.metrics.length + 2 }"><span>BP 尚未提供</span>{{ d.gaps.join('　·　') }}</div>
        </div>

        <!-- 团队 -->
        <div v-else-if="s.kind === 'team'" class="g-team">
          <div class="tm-dims a" style="--i:2">
            <span v-for="x in d.dims" :key="x.name" class="tm-dim"><small>{{ x.name }}</small><b>{{ x.level }}</b></span>
          </div>
          <div class="tm-grid">
            <div v-for="(m, i) in d.members" :key="m.name" class="person a" :style="{ '--i': i + 3 }">
              <div class="ps-av">{{ m.name.slice(0, 1) }}</div>
              <div class="ps-b">
                <div class="ps-n">{{ m.name }}<span v-if="m.verified" class="ps-ok">已核实</span></div>
                <div class="ps-r">{{ m.role }}</div>
                <p>{{ m.bio }}</p>
              </div>
            </div>
          </div>
          <div v-if="d.gap" class="gaps a" :style="{ '--i': d.members.length + 3 }"><span>团队缺口</span>{{ d.gap }}</div>
        </div>

        <!-- 信用 -->
        <div v-else-if="s.kind === 'credit'" class="g-list">
          <div v-for="(x, i) in d.items" :key="i" class="row-card a" :style="{ '--i': i + 2 }">
            <span class="chip risk">{{ x.label }}</span>
            <div><b>{{ x.value }}</b><p v-if="x.bp">{{ x.bp }}</p></div>
          </div>
        </div>

        <!-- 行业 -->
        <div v-else-if="s.kind === 'industry'" class="g-ind">
          <div class="ind-l">
            <div v-if="d.kpis.length" class="kpis">
              <div v-for="(k, i) in d.kpis" :key="i" class="kpi a" :style="{ '--i': i + 2 }">
                <div class="kpi-v"><Num :v="k.value" :still="still" :delay="300 + i * 120" /><small>{{ k.unit }}</small></div>
                <div class="kpi-k">{{ k.label }}</div>
                <div v-if="k.delta" class="kpi-d">{{ k.delta }}</div>
              </div>
            </div>
            <div v-if="d.chart" class="chart a" :style="{ '--i': d.kpis.length + 2 }">
              <div class="chart-h">{{ d.chart.title }}<small v-if="d.chart.unit">（{{ d.chart.unit }}）</small></div>
              <div class="cols">
                <div v-for="(b, i) in d.chart.bars" :key="i" class="col">
                  <b>{{ b.value }}</b>
                  <i :style="{ '--h': `${(b.value / maxBar) * 100}%`, '--d': `${400 + i * 90}ms` }" />
                  <span>{{ b.label }}</span>
                </div>
              </div>
            </div>
          </div>
          <div class="ind-r">
            <div class="col-h a" style="--i:2">关键趋势</div>
            <div v-for="(t, i) in d.trends" :key="i" class="trend a" :style="{ '--i': i + 3 }">
              <div class="tr-no">{{ i + 1 }}</div>
              <div><b>{{ t.title }}</b><p>{{ t.meaning || t.judge }}</p></div>
            </div>
          </div>
        </div>

        <!-- 十字图 -->
        <div v-else-if="s.kind === 'map'" class="g-map">
          <svg viewBox="0 0 880 620" class="map a" style="--i:2">
            <rect :x="MX0" :y="MY0" :width="(MX1 - MX0) / 2" :height="(MY1 - MY0) / 2" fill="#EEF3F9" />
            <rect :x="(MX0 + MX1) / 2" :y="MY0" :width="(MX1 - MX0) / 2" :height="(MY1 - MY0) / 2" fill="#EAF4F1" />
            <rect :x="MX0" :y="(MY0 + MY1) / 2" :width="(MX1 - MX0) / 2" :height="(MY1 - MY0) / 2" fill="#F3F4F6" />
            <rect :x="(MX0 + MX1) / 2" :y="(MY0 + MY1) / 2" :width="(MX1 - MX0) / 2" :height="(MY1 - MY0) / 2" fill="#FAF4EA" />
            <line :x1="(MX0 + MX1) / 2" :y1="MY0" :x2="(MX0 + MX1) / 2" :y2="MY1" stroke="#B9C6D6" stroke-dasharray="6 6" />
            <line :x1="MX0" :y1="(MY0 + MY1) / 2" :x2="MX1" :y2="(MY0 + MY1) / 2" stroke="#B9C6D6" stroke-dasharray="6 6" />
            <text :x="(MX0 + MX1) / 2" :y="MY0 - 10" text-anchor="middle" class="axt">↑ {{ ax(d.yTop) }}</text>
            <text :x="(MX0 + MX1) / 2" :y="MY1 + 26" text-anchor="middle" class="axt">↓ {{ ax(d.yBottom) }}</text>
            <text :x="MX0 - 14" :y="(MY0 + MY1) / 2" text-anchor="middle" class="axt" :transform="`rotate(-90 ${MX0 - 14} ${(MY0 + MY1) / 2})`">← {{ ax(d.xLeft) }}</text>
            <text :x="MX1 + 22" :y="(MY0 + MY1) / 2" text-anchor="middle" class="axt" :transform="`rotate(90 ${MX1 + 22} ${(MY0 + MY1) / 2})`">{{ ax(d.xRight) }} →</text>
            <g v-for="(p, i) in d.points" :key="p.name" class="pt" :style="{ '--i': i + 3 }">
              <circle :cx="mx(p.x)" :cy="my(p.y)" :r="p.self ? 22 : 16" :class="{ self: p.self }" />
              <text :x="mx(p.x)" :y="my(p.y) + 1" text-anchor="middle" dominant-baseline="central">{{ p.no }}</text>
            </g>
          </svg>
          <div class="map-list">
            <div v-for="(p, i) in d.points" :key="p.name" :class="['ml', 'a', { self: p.self }]" :style="{ '--i': i + 3 }">
              <i>{{ p.no }}</i><span>{{ p.name }}<small v-if="p.self">本标的</small></span>
            </div>
          </div>
        </div>

        <!-- 竞品 -->
        <div v-else-if="s.kind === 'competitors'" class="g-table">
          <div class="tb-h a" style="--i:2"><span>公司</span><span>定位</span><span>最近融资</span><span>和你相比</span></div>
          <div v-for="(c, i) in d.rows" :key="c.name" class="tb-r a" :style="{ '--i': i + 3 }">
            <b>{{ c.name }}</b><span>{{ c.positioning }}</span><span class="tb-round">{{ c.round }}<small v-if="c.lead">领投 {{ c.lead }}</small></span><span>{{ c.diff }}</span>
          </div>
        </div>

        <!-- 对标 -->
        <div v-else-if="s.kind === 'benchmarks'" :class="['g-bm', `n${d.items.length}`]">
          <div v-for="(b, i) in d.items" :key="b.name" class="bm a" :style="{ '--i': i + 2 }">
            <h3>{{ b.name }}</h3>
            <dl>
              <dt>融资</dt><dd>{{ b.funding || '未披露' }}</dd>
              <dt>营收</dt><dd>{{ b.revenue || '未披露' }}</dd>
              <dt>盈利</dt><dd>{{ b.profit || '未披露' }}</dd>
            </dl>
            <p>{{ b.outlook }}</p>
          </div>
        </div>

        <!-- 融资方案 -->
        <div v-else-if="s.kind === 'financing'" class="g-fin">
          <div class="fin-cards">
            <div v-for="(c, i) in d.cards" :key="c.k" :class="['fin', 'a', c.light]" :style="{ '--i': i + 2 }">
              <div class="fin-k">{{ c.k }}</div>
              <div class="fin-v"><Num :v="c.v" :still="still" :delay="300 + i * 120" /></div>
              <div v-if="c.tag" class="fin-t">{{ c.tag }}</div>
            </div>
          </div>
          <div v-if="d.advice.length" class="fin-adv">
            <div v-for="(x, i) in d.advice" :key="x.k" class="a" :style="{ '--i': i + 6 }"><b>{{ x.k }}</b>{{ x.v }}</div>
          </div>
          <div v-if="d.milestones.length" class="fin-ms" style="margin-top:26px">
            <div class="col-h a" style="--i:6">{{ d.next ? `下一轮（${d.next}）门槛` : '下一轮门槛' }}</div>
            <div v-for="(m, i) in d.milestones" :key="m.label" class="ms a" :style="{ '--i': i + 7 }">
              <span :class="['chip', MS[m.status][0]]">{{ MS[m.status][1] }}</span>
              <b>{{ m.label }}</b><span class="ms-t">目标 {{ m.target }}</span><span class="ms-c">现在 {{ m.current }}</span>
            </div>
          </div>
        </div>

        <!-- 目标投资人 -->
        <div v-else-if="s.kind === 'investors'" class="g-list">
          <div v-for="(x, i) in d.items" :key="x.name" class="inv a" :style="{ '--i': i + 2 }">
            <div class="inv-no">{{ i + 1 }}</div>
            <div class="inv-n"><b>{{ x.name }}</b><small>{{ x.type }}</small></div>
            <div class="inv-d"><span>相关案例</span>{{ x.deal || '—' }}</div>
            <div class="inv-w">{{ x.why }}</div>
          </div>
        </div>

        <!-- 追问 -->
        <div v-else-if="s.kind === 'qa'" class="g-list">
          <div v-for="(q, i) in d.items" :key="i" class="qa a" :style="{ '--i': i + 2 }">
            <div class="qa-q"><i>Q{{ i + 1 }}</i>{{ q.q }}</div>
            <div class="qa-a">{{ q.answer }}</div>
          </div>
        </div>

        <!-- BP 改写 -->
        <div v-else-if="s.kind === 'bpfix'" class="g-list">
          <div v-for="(f, i) in d.items" :key="i" class="fix a" :style="{ '--i': i + 2 }">
            <div class="fix-was"><span :class="['chip', f.light]">{{ f.level }}</span><s>「{{ f.quote }}」</s><p>{{ f.problem }}</p></div>
            <div class="fix-arrow">→</div>
            <div class="fix-new"><span>建议写法</span>{{ f.rewrite }}</div>
          </div>
        </div>

        <!-- 90 天 -->
        <div v-else-if="s.kind === 'plan'" class="g-plan">
          <div class="phases">
            <div v-for="(p, i) in d.phases" :key="p.label" class="phase a" :style="{ '--i': i + 2 }">
              <div class="ph-h"><b>{{ p.label }}</b></div>
              <div v-for="(it, j) in p.items" :key="j" class="ph-i"><b>{{ it.task }}</b><small v-if="it.deliverable">交付：{{ it.deliverable }}</small></div>
            </div>
          </div>
          <div v-if="d.review" class="gaps a" style="--i:5"><span>复盘节点</span>{{ d.review }}</div>
        </div>
      </div>
    </template>

    <footer v-if="chrome" class="dk-foot">
      <span>{{ s.foot || '' }}</span>
      <span>{{ company }}</span>
    </footer>
  </div>
</template>
