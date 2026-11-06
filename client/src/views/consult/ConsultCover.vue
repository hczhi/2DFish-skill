<template>
  <div :class="['cv', { embedded }]">
    <SiteHeader />

    <!-- ===== 首屏 ===== -->
    <section class="hero">
      <div class="hero-bg" aria-hidden="true">
        <div class="hb-grid" />
        <div class="hb-glow g1" /><div class="hb-glow g2" />
        <svg class="hb-orbit" viewBox="0 0 600 600">
          <circle cx="300" cy="300" r="250" class="o1" />
          <circle cx="300" cy="300" r="180" class="o2" />
          <circle cx="300" cy="300" r="110" class="o3" />
          <g class="spin"><circle cx="550" cy="300" r="4" /></g>
          <g class="spin rev"><circle cx="300" cy="120" r="3" /></g>
        </svg>
      </div>
      <div class="in hero-in">
        <div class="hero-copy">
          <div v-reveal class="over"><i />FOUNDER CHECK-UP · 创业者体检咨询</div>
          <h1 v-reveal style="--d:80ms">融资之前，<br />先给公司做一次<span>体检</span>。</h1>
          <p v-reveal class="lede" style="--d:160ms">
            商业计划智能体 + 品牌营销智能体：一个替你像投资人那样把 BP 读一遍，一个陪你把品牌战略一步步推演清楚。
            每一个结论都带出处，每一个分数都由系统计算。
          </p>
          <div v-reveal class="hero-entries" style="--d:240ms">
            <a v-if="showBp" href="#bp" class="he" @click.prevent="jump('bp')">
              <span class="he-k">商业计划智能体</span>
              <b>BP 体检分析</b>
              <em>上传 BP，直接出 11 章报告</em>
              <i class="he-arrow">↓</i>
            </a>
            <a href="#brand" class="he" @click.prevent="jump('brand')">
              <span class="he-k">品牌营销智能体</span>
              <b>品牌咨询工作台</b>
              <em>四看 · 四问 · 四大成</em>
              <i class="he-arrow">↓</i>
            </a>
          </div>
        </div>
      </div>
      <div class="hero-foot in" aria-hidden="true">
        <span v-for="t in TICKER" :key="t">{{ t }}</span>
      </div>
    </section>

    <!-- ===== 01 BP 体检：深色整段，文档扫描 ===== -->
    <section v-if="showBp" id="bp" class="bp">
      <div class="bp-bg" aria-hidden="true"><span class="bp-big">BP</span></div>
      <div class="in bp-in">
        <div class="bp-copy">
          <div v-reveal class="over"><i />01 · 商业计划智能体</div>
          <h2 v-reveal style="--d:60ms">BP 体检分析</h2>
          <p v-reveal class="bp-lede" style="--d:120ms">像投资人一样，先把你的 BP 读一遍。上传商业计划书和补充材料，不需要任何对话 —— 系统逐句读、逐条核，直接交给你一份 11 章体检报告。</p>
          <ol class="ed-list dark">
            <li v-for="(f, i) in BP_FEATS" :key="f[0]" v-reveal :style="{ '--d': `${160 + i * 80}ms` }">
              <span class="ed-no">{{ String(i + 1).padStart(2, '0') }}</span>
              <div><b>{{ f[0] }}</b><p>{{ f[1] }}</p></div>
            </li>
          </ol>
          <div v-reveal class="acts" style="--d:500ms">
            <router-link to="/consult/bp" class="btn-gold">开始 BP 体检 <span>→</span></router-link>
            <span class="note">提交后在后台跑完，可以关掉页面</span>
          </div>
        </div>

        <!-- 主视觉：一页 BP 被金色扫描线扫过，扫到的句子亮起标注，右侧批注同步弹出 -->
        <div v-reveal="startScore" class="scan" style="--d:120ms" aria-hidden="true">
          <div class="doc">
            <div class="doc-h"><span>商业计划书.pdf</span><em>P05 / 18</em></div>
            <div class="doc-body">
              <div class="db k" style="top:4%">04 · 市场验证</div>
              <div class="db t" style="top:10%">已服务 9 家行业头部客户，<br />单台年化价值 126 万元</div>
              <p class="db" style="top:27%">截至 2026 年 Q1，公司<mark class="mk-good" style="--t:.29">累计交付 5000 台</mark>设备，覆盖华东、华南 6 个省份，核心场景复购率 87%。</p>
              <p class="db" style="top:44%">其中<mark class="mk-risk" style="--t:.46">6 家客户</mark>已在用公司大脑沉淀业务规则，3 家处于试点期。</p>
              <div class="db chart" style="top:59%">
                <mark class="mk-info ch-t" style="--t:.6">中国宠物智能用品市场规模（亿元）</mark>
                <div class="ch-bars"><span v-for="b in DOC_BARS" :key="b[0]" :style="{ '--h': `${b[1]}%` }"><em>{{ b[2] }}</em><i /><small>{{ b[0] }}</small></span></div>
              </div>
              <div class="db foot" style="top:92%">数据来源：公司内部统计、行业研究报告</div>
            </div>
            <div class="beam" />
          </div>
          <div v-for="n in NOTES" :key="n.text" :class="['note-c', n.cls]" :style="{ top: n.top, '--t': n.t }">
            <i class="lt" /><span><b>{{ n.k }}</b>{{ n.text }}</span>
          </div>
          <div class="score-chip">
            <small>BP 五维总分</small>
            <b>{{ score.toFixed(1) }}</b>
            <em>可回收 +21.6</em>
          </div>
        </div>
      </div>

    </section>

    <!-- ===== 02 品牌咨询：同心圆飞轮 ===== -->
    <section id="brand" class="brand">
      <div class="in brand-in">
        <div v-reveal class="wheel" style="--d:100ms" aria-hidden="true">
          <svg viewBox="0 0 600 600">
            <defs>
              <radialGradient id="core-g" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#13305A" /><stop offset="1" stop-color="#0B1F3A" /></radialGradient>
              <radialGradient id="halo-g" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#C9A86A" stop-opacity=".22" /><stop offset="1" stop-color="#C9A86A" stop-opacity="0" /></radialGradient>
            </defs>
            <circle cx="300" cy="300" r="290" fill="url(#halo-g)" class="halo" />
            <circle cx="300" cy="300" r="250" class="ring r1" />
            <circle cx="300" cy="300" r="175" class="ring r2" />
            <circle cx="300" cy="300" r="100" class="ring r3" />
            <circle cx="300" cy="300" r="250" class="ring-dash d1" />
            <circle cx="300" cy="300" r="175" class="ring-dash d2" />
            <line v-for="a in [45, 135, 225, 315, 0, 90, 180, 270]" :key="`ray${a}`" x1="300" y1="300" :x2="300 + Math.cos(a * Math.PI / 180) * 250" :y2="300 + Math.sin(a * Math.PI / 180) * 250" class="ray" />
            <!-- 光点：从外圈沿半径流向核心 -->
            <circle v-for="(p, i) in PARTICLES" :key="`pt${i}`" r="3.2" class="particle" opacity="0">
              <animateMotion :dur="`${p.dur}s`" repeatCount="indefinite" :begin="`${p.begin}s`" :path="p.path" />
              <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;.15;.8;1" :dur="`${p.dur}s`" repeatCount="indefinite" :begin="`${p.begin}s`" />
            </circle>
            <g v-for="(n, i) in NODES" :key="n.t" class="node" :class="n.ring" :style="{ '--k': i }">
              <rect :x="n.x - n.w / 2" :y="n.y - 15" :width="n.w" height="30" rx="15" />
              <text :x="n.x" :y="n.y + 1">{{ n.t }}</text>
            </g>
            <circle cx="300" cy="300" r="50" fill="url(#core-g)" class="core" />
            <circle cx="300" cy="300" r="50" class="core-ring" />
            <text x="300" y="296" class="core-t">品牌</text>
            <text x="300" y="316" class="core-s">知识库</text>
          </svg>
          <div class="legend">
            <span><i class="lg1" />外圈 · 四看<small>建事实底座</small></span>
            <span><i class="lg2" />中圈 · 四问<small>做战略判断</small></span>
            <span><i class="lg3" />内圈 · 四大成<small>成品牌体系</small></span>
          </div>
          <div class="kb">
            <div v-for="(k, i) in KB" :key="k" class="kb-i" :style="{ '--i': i }"><i class="lt good" />{{ k }}</div>
          </div>
        </div>

        <div class="brand-copy">
          <div v-reveal class="over dark"><i />{{ showBp ? '02' : '01' }} · 品牌营销智能体</div>
          <h2 v-reveal style="--d:60ms">品牌咨询工作台</h2>
          <p v-reveal class="brand-lede" style="--d:120ms">抛弃写完即焚的 PPT 报告，把品牌咨询拆成结构化的事实与推演：从外到内，先看清事实，再做判断，最后长成一套品牌体系 —— 每一步的结论都沉淀进企业知识库。</p>
          <ol class="ed-list">
            <li v-for="(f, i) in BRAND_FEATS" :key="f[0]" v-reveal :style="{ '--d': `${160 + i * 80}ms` }">
              <span class="ed-no">{{ String(i + 1).padStart(2, '0') }}</span>
              <div><b>{{ f[0] }}</b><p>{{ f[1] }}</p></div>
            </li>
          </ol>
          <div v-reveal class="acts" style="--d:500ms">
            <router-link to="/consult/projects" class="btn-navy">进入品牌工作台 <span>→</span></router-link>
            <span class="note dark">项目随时回来接着做</span>
          </div>
        </div>
      </div>
    </section>

    <!-- ===== 原则 ===== -->
    <section class="band">
      <div class="in">
        <div v-reveal class="sec-h">
          <div class="over"><i />PRINCIPLES</div>
          <h2>为什么可以放心拿去用</h2>
        </div>
        <div class="pr-grid">
          <div v-for="(p, i) in PRINCIPLES" :key="p[0]" v-reveal class="pr" :style="{ '--d': `${i * 90}ms` }">
            <span class="pr-no">{{ String(i + 1).padStart(2, '0') }}</span>
            <h3>{{ p[0] }}</h3>
            <p>{{ p[1] }}</p>
          </div>
        </div>
      </div>
    </section>

    <!-- ===== 结尾 ===== -->
    <section class="in end">
      <div v-reveal>
        <h2>从一份体检开始。</h2>
        <p>{{ showBp ? '上传 BP 直接出报告，或者进工作台开一个品牌项目。' : '进工作台开一个品牌项目，随时回来接着做。' }}</p>
      </div>
      <div v-reveal class="end-acts" style="--d:100ms">
        <router-link v-if="showBp" to="/consult/bp" class="btn-gold">开始 BP 体检</router-link>
        <router-link to="/consult/projects" :class="showBp ? 'btn-line' : 'btn-gold'">进入品牌工作台</router-link>
      </div>
    </section>

    <SiteFooter v-if="!embedded" />
    <AppKeyModal v-if="!embedded" :model-value="keyOpen" app="consult" :next="q('next')" :reason="q('reason')" @update:model-value="onKeyModal" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onUnmounted, type Directive } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import SiteHeader from '../../components/common/SiteHeader.vue';
import SiteFooter from '../../components/common/SiteFooter.vue';
import AppKeyModal from '../../components/common/AppKeyModal.vue';
import { fetchMe, isAdmin, getToken } from '../../lib/auth';
import { hasAppKey } from '../../lib/appKey';
import { isEmbedMode } from '../../lib/embed';

// /consult：创业者体检咨询的总入口 —— 商业计划智能体（BP 分析）+ 品牌营销智能体（品牌咨询）。
// 第三方 iframe 的落地页也是这里（ConsultEmbed 把 next=/consult/projects 改送过来）。
// BP 段必须对嵌入用户显示：漏了的话第三方用户只看得到品牌咨询，而服务端是放行 BP 的。
// 嵌入时不调 fetchMe：consult:embed 的短 token 调 /api/auth/me 会被 scopeGuard 拒掉。
const embedded = isEmbedMode();
const route = useRoute();
const router = useRouter();

const admin = ref(false);
if (getToken() && !embedded) fetchMe().then((u) => { admin.value = isAdmin(u) }).catch(() => {});
// 普通账号（非管理员、没有 key）服务端对 BP 会 403，所以对它不显示；没登录的访客点进去会弹 key 输入框。
const showBp = computed(() => embedded || admin.value || hasAppKey('consult') || !getToken());

// 滚动进场：用指令登记，**不能**在 onMounted 里一次性 querySelectorAll —— BP 段要等 fetchMe 回来
// （管理员）才渲染，晚出现的元素没被登记的话会一直停在 opacity:0：占着位置、看不见。
// 绑定值是函数时，进场那一刻调它（总分滚动）。
const io = typeof IntersectionObserver !== 'undefined'
  ? new IntersectionObserver((es) => es.forEach((e) => {
      if (!e.isIntersecting) return;
      e.target.classList.add('on');
      ((e.target as any).__onReveal as (() => void) | undefined)?.();
      io?.unobserve(e.target);
    }), { threshold: 0.12, rootMargin: '0px 0px -40px 0px' })
  : null;
const vReveal: Directive<HTMLElement, (() => void) | undefined> = {
  mounted(el, b) {
    el.classList.add('reveal');
    (el as any).__onReveal = b.value;
    if (io) io.observe(el);
    else { el.classList.add('on'); b.value?.() }
  },
  unmounted(el) { io?.unobserve(el) },
};
onUnmounted(() => io?.disconnect());

const score = ref(0);
let raf = 0;
function startScore() {
  // 系统设置了「减少动态效果」时直接给终值（否则那张卡停在 0.0）。
  if (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches) { score.value = 61.8; return }
  const t0 = performance.now();
  const step = (t: number) => {
    const p = Math.min(1, Math.max(0, (t - t0 - 500) / 1500));
    score.value = 61.8 * (1 - Math.pow(1 - p, 3));
    if (p < 1) raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
}
onUnmounted(() => cancelAnimationFrame(raf));

function jump(id: string) { document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }

const TICKER = ['五维评分', '一致性审计', '可信度核验', '收入质量', '竞品与对标', '融资方案', '四看', '四问', '四大成', '企业知识库'];

// top = 文档顶 30 + 页眉 46 + t × 正文高 434 − 半张卡：批注和被标的那句对齐。
const NOTES = [
  { k: '引文定位', text: '第 5 页原文', cls: 'good', t: 0.29 },
  { k: '前后矛盾', text: '第 2 页写的是 9 家', cls: 'risk', t: 0.46 },
  { k: '多源印证', text: '3 个独立来源', cls: 'info', t: 0.6 },
].map((n) => ({ ...n, top: `${Math.round(30 + 46 + n.t * 434 - 16)}px` }));
const DOC_BARS: [string, number, string][] = [['2023', 45, '29'], ['2024', 59, '38.6'], ['2025', 82, '53'], ['2026E', 100, '65']];
const BP_FEATS: [string, string][] = [
  ['五维评分 · 事实与举证双轨', '每一维拆成真实水平和 BP 能证明的部分，差额就是改材料就能拿回的分。'],
  ['BP 自身逐条核验', '数字前后对不对得上、关键声明有没有外部证据、收入口径算不算得通。'],
  ['行业、竞品、对标企业', '联网检索，来源按等级排序并逐条标注，多源印证的数字单独标出。'],
  ['融资方案与行动清单', '融多少、值多少、下一轮门槛，投资人会追问什么，接下来 90 天做什么。'],
];

// 飞轮：外圈四看（45° 起）、中圈四问（0° 起）、内圈四大成（45° 起）。
// 阶段名照 server/src/services/consult/stages.ts（改了那边要同步这里，否则封面讲的和工作台里做的对不上）。
const pos = (r: number, deg: number) => ({ x: 300 + Math.cos((deg * Math.PI) / 180) * r, y: 300 + Math.sin((deg * Math.PI) / 180) * r });
const NODES = [
  ...['看自己', '看行业', '看竞品', '看用户'].map((t, i) => ({ t, ring: 'n1', w: 78, ...pos(250, -135 + i * 90) })),
  ...['品牌定位', '价值主张', '品牌信任', '用户关系'].map((t, i) => ({ t, ring: 'n2', w: 90, ...pos(175, -90 + i * 90) })),
  ...['品牌理想', '品牌屋', '关系图谱', '沟通创意'].map((t, i) => ({ t, ring: 'n3', w: 84, ...pos(100, -135 + i * 90) })),
];
const PARTICLES = [45, 135, 225, 315, 0, 90, 180, 270].map((a, i) => {
  const r = i < 4 ? 250 : 175;
  const p = pos(r, a);
  return { path: `M${p.x.toFixed(1)} ${p.y.toFixed(1)} L300 300`, dur: i < 4 ? 3.6 : 2.8, begin: (i * 0.45).toFixed(2) };
});
const KB = ['品牌定位 · 已定稿', '价值主张 · 含取舍理由', '用户关系 · 依据 3 条'];
const BRAND_FEATS: [string, string][] = [
  ['四看 · 建事实底座', '看自己、看行业、看竞品、看用户。AI 快速阅读你贴入的资料，先出结构化事实报告。'],
  ['四问 · 做战略判断', '品牌定位、价值主张、品牌信任、用户关系，四个判断相互咬合，改一处提示同步核对。'],
  ['四大成 · 成品牌体系', '品牌理想、品牌屋、用户关系图谱、核心沟通创意，再往下落到内容与数字化营销。'],
  ['企业知识库', '每个结论连同取舍理由、依据来源与置信度沉淀下来，作为设计、营销的依据。'],
];
const PRINCIPLES: [string, string][] = [
  ['每个结论都有出处', 'BP 里的引文逐条在原文定位到页；联网资料按编号引用，来源可点开核对。'],
  ['数字由系统计算', '分数、梯队、融资额区间、估值都按公式由代码算，不让模型编数字。'],
  ['核不上的会说出来', '找不到出处、只有单一来源、前后矛盾的内容会单独标出，不混进结论。'],
  ['告诉你怎么改', '不止打分：哪些分改材料就能拿回、哪些必须靠做事，每条都给改法。'],
];

// 「进入工作台」没 key 时守卫送到 /consult/key，它带着 ?key=1 回这里打开弹窗（同 PptCover）。
const keyOpen = ref(false);
watch(() => route.query.key, (v) => { keyOpen.value = !!v }, { immediate: true });
const q = (k: string) => (typeof route.query[k] === 'string' ? (route.query[k] as string) : undefined);
function onKeyModal(open: boolean) {
  keyOpen.value = open;
  if (!open && route.query.key) router.replace({ path: '/consult' });
}
</script>

<style scoped>
.cv {
  --navy: #0B1F3A; --navy-2: #13305A; --gold: #C9A86A; --gold-d: #A8864A; --paper: #F7F5F0;
  --ink: #1b2230; --ink2: #4a5263; --mute: #858b97; --hair: #e5e0d4;
  --good: #3BA27A; --risk: #D0564C; --info: #6E93C4;
  --serif: "Songti SC", "Noto Serif SC", "Source Han Serif SC", "STSong", Georgia, serif;
  min-height: 100vh; background: var(--paper); color: var(--ink); overflow-x: hidden;
  font-family: -apple-system, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
}
.cv.embedded { min-height: 0; }
.in { max-width: 1200px; margin: 0 auto; padding: 0 40px; }

.reveal { opacity: 0; transform: translateY(26px); transition: opacity .9s ease, transform .9s cubic-bezier(.2,.7,.2,1); transition-delay: var(--d, 0ms); }
.reveal.on { opacity: 1; transform: none; }

.over { display: inline-flex; align-items: center; gap: 12px; font-size: 13px; letter-spacing: .2em; color: var(--gold); font-weight: 600; }
.over i { width: 28px; height: 1px; background: currentColor; }
.over.dark { color: var(--gold-d); }
.lt { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--info); flex: none; }
.lt.good, .good > .lt { background: var(--good); } .risk > .lt { background: var(--risk); } .info > .lt { background: var(--info); }

.btn-gold, .btn-navy, .btn-line { display: inline-flex; align-items: center; gap: 10px; padding: 14px 30px; font-size: 15px; font-weight: 600; text-decoration: none; transition: all .25s; }
.btn-gold span, .btn-navy span { transition: transform .25s; }
.btn-gold:hover span, .btn-navy:hover span { transform: translateX(5px); }
.btn-gold { background: var(--gold); color: var(--navy); }
.btn-gold:hover { background: #d8ba80; box-shadow: 0 10px 30px rgba(201,168,106,.3); }
.btn-navy { background: var(--navy); color: #fff; }
.btn-navy:hover { background: var(--navy-2); box-shadow: 0 10px 26px rgba(11,31,58,.25); }
.btn-line { border: 1px solid var(--navy); color: var(--navy); }
.btn-line:hover { background: var(--navy); color: #fff; }
.acts { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; }
.note { font-size: 13px; color: #8597b2; }
.note.dark { color: var(--mute); }

/* 编辑式编号列表（两段共用） */
.ed-list { list-style: none; margin: 36px 0 40px; padding: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 0 36px; }
.ed-list li { position: relative; display: flex; gap: 16px; padding: 20px 0 22px; border-top: 1px solid var(--hair); }
.ed-list li::before { content: ""; position: absolute; left: 0; top: -1px; height: 1px; width: 0; background: var(--gold); transition: width .5s ease; }
.ed-list li:hover::before { width: 100%; }
.ed-no { flex: none; font-family: var(--serif); font-size: 26px; line-height: 1; color: var(--gold-d); width: 36px; }
.ed-list b { display: block; font-size: 15.5px; color: var(--navy); margin-bottom: 6px; }
.ed-list p { margin: 0; font-size: 13.5px; line-height: 1.8; color: var(--ink2); }
.ed-list.dark li { border-top-color: rgba(255,255,255,.12); }
.ed-list.dark .ed-no { color: var(--gold); }
.ed-list.dark b { color: #fff; }
.ed-list.dark p { color: #a8b6ca; }

/* ===== 首屏 ===== */
.hero { position: relative; overflow: hidden; color: #fff; padding: 110px 0 0; background: linear-gradient(180deg, #091a31 0%, #0D2445 70%, #0B1F3A 100%); }
.cv.embedded .hero { padding-top: 72px; }
.hero-bg { position: absolute; inset: 0; pointer-events: none; }
.hb-grid { position: absolute; inset: -80px; background-image: linear-gradient(rgba(255,255,255,.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.035) 1px, transparent 1px); background-size: 80px 80px; animation: drift 40s linear infinite; }
@keyframes drift { to { transform: translate(80px, 80px); } }
.hb-glow { position: absolute; border-radius: 50%; filter: blur(80px); }
.hb-glow.g1 { width: 520px; height: 520px; right: -120px; top: -140px; background: rgba(201,168,106,.16); animation: breathe 9s ease-in-out infinite; }
.hb-glow.g2 { width: 420px; height: 420px; left: -160px; bottom: -200px; background: rgba(79,111,153,.28); animation: breathe 11s ease-in-out infinite reverse; }
@keyframes breathe { 50% { transform: scale(1.15); opacity: .7; } }
.hb-orbit { position: absolute; right: -60px; top: 40px; width: 600px; height: 600px; }
.hb-orbit circle { fill: none; }
.hb-orbit .o1 { stroke: rgba(201,168,106,.16); }
.hb-orbit .o2 { stroke: rgba(201,168,106,.12); stroke-dasharray: 3 7; }
.hb-orbit .o3 { stroke: rgba(255,255,255,.07); }
.hb-orbit .spin { transform-origin: 300px 300px; animation: spin 28s linear infinite; }
.hb-orbit .spin circle { fill: #C9A86A; }
.hb-orbit .spin.rev { animation-duration: 20s; animation-direction: reverse; }
@keyframes spin { to { transform: rotate(360deg); } }
.hero-in { position: relative; }
.hero-copy { max-width: 760px; }
.hero h1 { position: relative; z-index: 0; margin: 26px 0 0; font-family: var(--serif); font-size: 60px; line-height: 1.24; font-weight: 700; }
.hero h1 span { color: var(--gold); background: linear-gradient(transparent 72%, rgba(201,168,106,.22) 72%); }
.lede { margin: 26px 0 0; max-width: 640px; font-size: 17px; line-height: 1.9; color: #c6d0de; }
.hero-entries { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; margin-top: 44px; max-width: 700px; }
.he { position: relative; display: flex; flex-direction: column; gap: 4px; padding: 20px 24px 22px; text-decoration: none; color: #fff; border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.04); backdrop-filter: blur(6px); transition: all .3s; overflow: hidden; }
.he::before { content: ""; position: absolute; left: 0; top: 0; height: 2px; width: 0; background: var(--gold); transition: width .4s; }
.he:hover { border-color: rgba(201,168,106,.6); background: rgba(255,255,255,.08); transform: translateY(-3px); }
.he:hover::before { width: 100%; }
.he-k { font-size: 12px; letter-spacing: .14em; color: var(--gold); }
.he b { font-family: var(--serif); font-size: 22px; }
.he em { font-style: normal; font-size: 13px; color: #a9b6c9; }
.he-arrow { position: absolute; right: 22px; bottom: 20px; font-style: normal; color: var(--gold); animation: bob 2s ease-in-out infinite; }
@keyframes bob { 50% { transform: translateY(4px); } }
.hero-foot { position: relative; display: flex; flex-wrap: wrap; gap: 10px 28px; padding-top: 70px; padding-bottom: 26px; font-size: 13px; color: #7f8fa8; letter-spacing: .08em; }
.hero-foot span::before { content: "◆"; font-size: 8px; color: var(--gold); margin-right: 10px; vertical-align: 2px; }

/* ===== 01 BP：深色整段 ===== */
.bp { position: relative; overflow: hidden; color: #fff; padding: 120px 0 90px; background: #0A1A30; scroll-margin-top: 0; border-top: 1px solid rgba(201,168,106,.25); }
.bp-bg { position: absolute; inset: 0; pointer-events: none; background: radial-gradient(circle at 78% 40%, rgba(79,111,153,.25), transparent 50%), radial-gradient(circle at 10% 90%, rgba(201,168,106,.08), transparent 40%); }
.bp-big { position: absolute; right: -40px; bottom: -110px; font-family: Georgia, var(--serif); font-size: 460px; font-weight: 700; line-height: 1; color: transparent; -webkit-text-stroke: 1px rgba(255,255,255,.05); letter-spacing: -.04em; }
.bp-in { position: relative; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 80px; align-items: center; }
.bp h2 { margin: 16px 0 18px; font-family: var(--serif); font-size: 48px; color: #fff; }
.bp-lede { margin: 0; font-size: 16px; line-height: 1.95; color: #b9c5d6; }

/* 文档扫描主视觉 */
.scan { position: relative; height: 560px; }
.doc { color: #1b2230; position: absolute; left: 40px; top: 30px; width: 360px; height: 480px; background: #FBFAF6; box-shadow: 0 40px 90px rgba(0,0,0,.45); overflow: hidden; transform: perspective(1400px) rotateY(-8deg) rotateX(2deg); transform-origin: left center; }
.doc-h { display: flex; justify-content: space-between; padding: 14px 22px; border-bottom: 1px solid #ece6d8; font-size: 12px; color: #8c8577; }
.doc-h em { font-style: normal; color: var(--gold-d); }
.doc-body { position: relative; height: calc(100% - 46px); padding: 0 22px; }
.db { position: absolute; left: 24px; right: 24px; margin: 0; }
.db.k { font-size: 11px; letter-spacing: .16em; color: var(--gold-d); font-weight: 600; }
.db.t { font-family: var(--serif); font-size: 18px; line-height: 1.45; color: #1b2230; font-weight: 700; }
p.db { font-size: 12.5px; line-height: 1.9; color: #4a5263; }
.db mark { position: relative; background: none; color: inherit; padding: 0 2px; border-radius: 2px; }
.db mark::after { content: ""; position: absolute; left: -2px; right: -2px; top: 1px; bottom: 1px; border-radius: 2px; opacity: 0; }
.mk-good::after { background: rgba(59,162,122,.22); box-shadow: inset 0 -2px 0 #3BA27A; }
.mk-risk::after { background: rgba(208,86,76,.20); box-shadow: inset 0 -2px 0 #D0564C; }
.mk-info::after { background: rgba(110,147,196,.22); box-shadow: inset 0 -2px 0 #6E93C4; }
.scan.on .db mark::after { animation: hl 6s linear infinite; animation-delay: calc(var(--t) * 6s - 6s); }
.chart { border: 1px solid #ece6d8; background: #fff; padding: 10px 12px 8px; }
.ch-t { display: inline-block; font-size: 11.5px; color: #4a5263; font-weight: 600; }
.ch-bars { display: flex; align-items: flex-end; gap: 14px; height: 84px; margin-top: 8px; }
.ch-bars span { flex: 1; height: 100%; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; gap: 3px; }
.ch-bars i { display: block; width: 100%; max-width: 34px; height: var(--h); background: linear-gradient(180deg, #4f6f99, #0B1F3A); }
.ch-bars span:last-child i { background: linear-gradient(180deg, #e4c48e, #A8864A); }
.ch-bars em { font-style: normal; font-size: 10.5px; color: #1b2230; }
.ch-bars small { font-size: 10px; color: #858b97; }
.db.foot { font-size: 10.5px; color: #a09a8c; border-top: 1px solid #ece6d8; padding-top: 6px; }
.beam { position: absolute; left: 0; right: 0; top: 46px; height: 70px; margin-top: -60px; background: linear-gradient(180deg, transparent, rgba(201,168,106,.10) 70%, rgba(201,168,106,.55) 98%, #C9A86A 100%); opacity: 0; }
.scan.on .beam { opacity: 1; animation: beam 6s linear infinite; }
@keyframes beam { 0% { transform: translateY(0); } 100% { transform: translateY(434px); } }
.note-c { position: absolute; left: 440px; display: flex; gap: 10px; align-items: center; padding: 8px 14px; white-space: nowrap; background: rgba(19,48,90,.72); backdrop-filter: blur(10px); border: 1px solid rgba(255,255,255,.12); font-size: 13px; line-height: 1.55; color: #dfe6f0; opacity: 0; transform: translateX(-12px); }
.note-c::before { content: ""; position: absolute; left: -40px; top: 50%; width: 40px; height: 1px; background: rgba(201,168,106,.6); }
.note-c .lt { margin-top: 0; }
.note-c b { font-size: 12px; letter-spacing: .1em; color: var(--gold); margin-right: 8px; }
.scan.on .note-c { animation: pop 6s cubic-bezier(.2,.7,.2,1) infinite; animation-delay: calc(var(--t) * 6s - 6s + .15s); }
@keyframes pop { 0% { opacity: 0; transform: translateX(-12px); } 5% { opacity: 1; transform: none; } 78% { opacity: 1; transform: none; } 90%, 100% { opacity: 0; transform: translateX(6px); } }
.score-chip { position: absolute; left: -10px; bottom: -36px; display: flex; flex-direction: column; padding: 16px 22px 14px; background: var(--gold); color: var(--navy); box-shadow: 0 20px 40px rgba(0,0,0,.35); }
.score-chip small { font-size: 12px; letter-spacing: .1em; }
.score-chip b { font-family: var(--serif); font-size: 44px; line-height: 1.1; font-variant-numeric: tabular-nums; }
.score-chip em { font-style: normal; font-size: 12px; font-weight: 600; }


/* ===== 02 品牌：同心圆飞轮 ===== */
.brand { position: relative; padding: 120px 0 120px; background: var(--paper); overflow: hidden; scroll-margin-top: 0; }
.brand::before { content: ""; position: absolute; left: -200px; top: 50%; width: 900px; height: 900px; margin-top: -450px; border-radius: 50%; background: radial-gradient(circle, rgba(201,168,106,.10), transparent 60%); pointer-events: none; }
.brand-in { position: relative; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 70px; align-items: center; }
.brand h2 { margin: 16px 0 18px; font-family: var(--serif); font-size: 48px; color: var(--navy); }
.brand-lede { margin: 0; font-size: 16px; line-height: 1.95; color: var(--ink2); }
.wheel { position: relative; }
.wheel svg { width: 100%; height: auto; display: block; overflow: visible; }
.halo { animation: halo 6s ease-in-out infinite; transform-origin: 300px 300px; }
@keyframes halo { 50% { transform: scale(1.05); opacity: .6; } }
.ring { fill: none; stroke: #d9cfba; stroke-width: 1; }
.ring.r3 { stroke: #c9b994; }
.ring-dash { fill: none; stroke: var(--gold); stroke-width: 1.2; stroke-dasharray: 2 10; transform-origin: 300px 300px; opacity: .7; }
.d1 { animation: spin 60s linear infinite; }
.d2 { animation: spin 45s linear infinite reverse; }
.ray { stroke: #e2d9c6; stroke-width: 1; stroke-dasharray: 3 5; }
.particle { fill: var(--gold); filter: drop-shadow(0 0 4px rgba(201,168,106,.9)); }
.ring-lb { font-size: 13px; fill: var(--gold-d); text-anchor: middle; letter-spacing: .14em; font-weight: 600; }
.ring-lb.in3 { fill: var(--navy); }
.node rect { fill: #fff; stroke: #d8cdb6; stroke-width: 1; transition: all .3s; }
.node text { font-size: 13px; fill: var(--ink); text-anchor: middle; dominant-baseline: central; }
.node.n3 rect { fill: var(--navy); stroke: var(--navy); }
.node.n3 text { fill: #fff; }
.wheel.on .node rect { animation: npulse 6s ease-in-out infinite; animation-delay: calc(var(--k) * .5s); }
.wheel.on .node.n3 rect { animation-name: npulse3; }
@keyframes npulse { 0%, 14%, 100% { fill: #fff; stroke: #d8cdb6; } 5%, 9% { fill: #FBF3E3; stroke: var(--gold); } }
@keyframes npulse3 { 0%, 14%, 100% { stroke: var(--navy); } 5%, 9% { stroke: var(--gold); } }
.core { filter: drop-shadow(0 10px 20px rgba(11,31,58,.35)); }
.core-ring { fill: none; stroke: var(--gold); stroke-width: 2; transform-origin: 300px 300px; animation: corePulse 3s ease-out infinite; }
@keyframes corePulse { 0% { transform: scale(1); opacity: .9; } 100% { transform: scale(1.5); opacity: 0; } }
.core-t { font-family: var(--serif); font-size: 20px; font-weight: 700; fill: #fff; text-anchor: middle; }
.core-s { font-size: 11px; fill: var(--gold); text-anchor: middle; letter-spacing: .2em; }
.legend { display: flex; justify-content: center; gap: 18px; margin-top: 18px; font-size: 12.5px; color: var(--ink); font-weight: 600; flex-wrap: wrap; }
.legend span { display: flex; align-items: center; gap: 8px; }
.legend small { font-weight: 400; color: var(--mute); margin-left: 4px; }
.legend i { width: 14px; height: 14px; border-radius: 50%; border: 1.5px solid #d9cfba; }
.legend .lg2 { border-color: #c9b994; border-style: dashed; }
.legend .lg3 { background: var(--navy); border-color: var(--navy); }
.kb { display: flex; justify-content: center; flex-wrap: wrap; gap: 8px; margin-top: 16px; min-height: 40px; }
.kb-i { display: flex; align-items: center; gap: 8px; padding: 9px 14px; background: #fff; border: 1px solid var(--hair); box-shadow: 0 10px 26px rgba(11,31,58,.10); font-size: 12.5px; color: var(--ink); opacity: 0; }
.wheel.on .kb-i { animation: kb 9s ease-in-out infinite; animation-delay: calc(var(--i) * 1.4s + .8s); }
@keyframes kb { 0% { opacity: 0; transform: translateY(10px); } 6%, 70% { opacity: 1; transform: none; } 80%, 100% { opacity: 0; transform: translateY(-6px); } }

/* ===== 原则 ===== */
.band { padding: 100px 0; color: #fff; background: linear-gradient(180deg, #0B1F3A, #0D2445); position: relative; overflow: hidden; }
.band::before { content: ""; position: absolute; left: 0; right: 0; top: 0; height: 1px; background: linear-gradient(90deg, transparent, var(--gold), transparent); opacity: .6; }
.sec-h { max-width: 720px; margin-bottom: 36px; }
.sec-h h2 { margin: 16px 0 0; font-family: var(--serif); font-size: 36px; color: #fff; }
.pr-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border-top: 1px solid rgba(255,255,255,.12); }
.pr { position: relative; padding: 30px 26px 10px 0; }
.pr + .pr { padding-left: 26px; border-left: 1px solid rgba(255,255,255,.08); }
.pr::before { content: ""; position: absolute; left: 0; top: -1px; width: 0; height: 2px; background: var(--gold); transition: width .6s ease .4s; }
.pr.on::before { width: 48px; }
.pr + .pr::before { left: 26px; }
.pr-no { font-family: var(--serif); font-size: 15px; color: var(--gold); }
.pr h3 { margin: 12px 0 10px; font-family: var(--serif); font-size: 20px; color: #fff; }
.pr p { margin: 0; font-size: 14px; line-height: 1.85; color: #aebbd0; }

/* ===== 结尾 ===== */
.end { display: flex; align-items: center; justify-content: space-between; gap: 30px; padding: 80px 40px 90px; }
.end h2 { margin: 0 0 8px; font-family: var(--serif); font-size: 32px; color: var(--navy); }
.end p { margin: 0; font-size: 15px; color: var(--ink2); }
.end-acts { display: flex; gap: 14px; flex: none; }

@media (prefers-reduced-motion: reduce) {
  .reveal { opacity: 1; transform: none; transition: none; }
  .cv *, .cv *::before { animation: none !important; }
  .note-c, .kb-i { opacity: 1; transform: none; }
  .db mark::after { opacity: 1; }
}
@media (max-width: 1080px) {
  .note-c { left: auto; right: 0; width: 210px; }
}
@media (max-width: 960px) {
  .in { padding: 0 20px; }
  .hero { padding-top: 70px; }
  .hero h1 { font-size: 38px; }
  .hb-orbit { width: 380px; height: 380px; right: -160px; }
  .bp, .brand { padding: 70px 0; }
  .bp-in, .brand-in { grid-template-columns: 1fr; gap: 40px; }
  .bp h2, .brand h2 { font-size: 34px; }
  .bp-big { font-size: 240px; bottom: -50px; }
  .ed-list { grid-template-columns: 1fr; }
  .scan { height: 480px; max-width: 420px; }
  .doc { left: 0; width: 300px; height: 420px; transform: none; }
  @keyframes beam { 100% { transform: translateY(374px); } }
  .note-c { width: 180px; font-size: 12px; padding: 10px 12px; }
  .note-c::before { display: none; }
  .brand-in .wheel { order: 2; }
  .pr-grid { grid-template-columns: 1fr 1fr; }
  .pr { padding: 24px 16px 6px 0 !important; border-left: 0 !important; }
  .pr::before { left: 0 !important; }
  .end { flex-direction: column; align-items: flex-start; padding: 56px 20px 64px; }
}
</style>
