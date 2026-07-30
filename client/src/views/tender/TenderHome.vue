<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import SiteHeader from '../../components/common/SiteHeader.vue'
import SiteFooter from '../../components/common/SiteFooter.vue'

const route = useRoute()
const locale = computed(() => route.path.startsWith('/en/') ? 'en' : 'zh')
const t = (zh: string, en: string) => (locale.value === 'en' ? en : zh)
const prefix = computed(() => locale.value === 'en' ? '/en/tender' : '/tender')

onMounted(() => {
  setTimeout(() => {
    document.querySelector('.tender-home')?.classList.add('loaded')
  }, 100)
})
</script>

<template>
  <div class="page-wrapper">
    <SiteHeader />
    <div class="tender-home">
      <div class="background-grid"></div>

      <div class="topbar">
        <div class="topbar-left">
          <span class="logo-line"></span>
          <span class="logo-text">AI TENDER SIGNAL · MATCHING ENGINE</span>
        </div>
        <div class="topbar-right">
          <span class="collection-text">BID INTELLIGENCE / 01</span>
        </div>
      </div>

      <div class="main-content">
        <!-- 左侧介绍 -->
        <div class="hero-section">
          <h1 class="hero-title">
            <span class="text-dark">{{ t('别再逐条翻公告，', 'Stop scrolling notices,') }}</span><br />
            <span class="text-dark">{{ t('让 AI 只把', 'let AI surface only') }}</span><span class="text-accent underline">{{ t('该投的标', 'the bids worth bidding') }}</span><span class="text-dark">{{ t('推给你', '') }}</span>
          </h1>
          <p class="hero-subtitle">
            {{ t('平台每天自动抓取各招标源的新公告，', 'The platform crawls new notices from bid sources every day,') }}<br />
            {{ t('用你的关键词、预算区间、地区偏好、客户关系逐条打分，', 'scores each one against your keywords, budget range, regions and client relationships,') }}<br />
            <span class="text-accent">{{ t('再由 AI 给出推荐理由、投标思路与风险提示。', 'then has AI write the reason, bidding angle and risk notes.') }}</span>
          </p>

          <div class="actions">
            <router-link :to="`${prefix}/browse`" class="btn-start">
              <span class="btn-icon">▶</span>
              {{ t('查看标讯', 'Browse Tenders') }}
            </router-link>
            <router-link :to="`${prefix}/settings`" class="btn-ghost">
              {{ t('配置设定', 'Configuration') }}
            </router-link>
          </div>

          <div class="hero-notes">
            <div class="note-item">
              <strong>{{ t('查看标讯', 'Browse Tenders') }}</strong>
              <span>{{ t('我的推荐 · 全部标讯', 'My Recommendations · All Tenders') }}</span>
            </div>
            <div class="note-item">
              <strong>{{ t('配置设定', 'Configuration') }}</strong>
              <span>{{ t('个人配置 · 获取 SDK', 'My Preferences · Get SDK') }}</span>
            </div>
          </div>
        </div>

        <!-- 右侧卡片 -->
        <div class="cards-section">
          <div class="cards-wrapper">
            <!-- Card 4 (最底) -->
            <div class="poster-card card-4">
              <div class="card-inner">
                <div class="card-tag">SDK EMBED</div>
                <h3 class="card-title">{{ t('推荐结果可外嵌', 'Embed anywhere') }}</h3>
                <p class="card-desc">{{ t('一段 script 就能把推荐挂到自己站点', 'One script tag mounts it on your own site') }}</p>
              </div>
            </div>

            <!-- Card 3 -->
            <div class="poster-card card-3">
              <div class="card-inner">
                <div class="card-tag">FEEDBACK LOOP</div>
                <h3 class="card-title">{{ t('越用越准', 'Sharper over time') }}</h3>
                <p class="card-desc">{{ t('标记适合 / 不适合并写原因，AI 记住你的口味', 'Mark suitable / not suitable with a reason — AI remembers your taste') }}</p>
                <div class="card-list">
                  <div class="list-item"><span>👍</span>{{ t('这类我们擅长', 'We are strong here') }}</div>
                  <div class="list-item"><span>👎</span>{{ t('预算太低不值得投', 'Budget too low') }}</div>
                </div>
              </div>
            </div>

            <!-- Card 2 -->
            <div class="poster-card card-2">
              <div class="card-inner">
                <div class="card-tag">SCORING</div>
                <h3 class="card-title">{{ t('六维匹配打分', 'Six-axis scoring') }}</h3>
                <p class="card-desc">{{ t('每条标讯都算得出为什么推给你', 'Every tender explains its own score') }}</p>
                <div class="score-bars">
                  <div class="bar-row"><span>{{ t('业务', 'Biz') }}</span><i style="width: 88%"></i><b>88</b></div>
                  <div class="bar-row"><span>{{ t('预算', 'Budget') }}</span><i style="width: 76%"></i><b>76</b></div>
                  <div class="bar-row"><span>{{ t('地区', 'Region') }}</span><i style="width: 92%"></i><b>92</b></div>
                  <div class="bar-row"><span>{{ t('关系', 'Rel') }}</span><i style="width: 64%"></i><b>64</b></div>
                </div>
              </div>
            </div>

            <!-- Card 1 (最上) -->
            <div class="poster-card card-1">
              <div class="card-inner">
                <div class="card-tag">TRIAGE</div>
                <h3 class="card-title">{{ t('分档送到眼前', 'Triaged for you') }}</h3>
                <p class="card-desc">{{ t('高分自动推飞书，低分直接过滤掉', 'High scores push to Feishu, low ones get filtered out') }}</p>
                <div class="tier-chips">
                  <span class="chip priority">🔥 {{ t('优先跟', 'Priority') }}</span>
                  <span class="chip consider">🟡 {{ t('可考虑', 'Consider') }}</span>
                  <span class="chip watch">⚠️ {{ t('观望', 'Watch') }}</span>
                  <span class="chip filter">❌ {{ t('过滤', 'Filtered') }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 工作流程 -->
      <div class="flow-section">
        <div class="flow-head">
          <h2>{{ t('它是怎么跑起来的', 'How it works') }}</h2>
          <p>{{ t('你只需要做第 1 步，其余全自动。', 'You only do step 1 — the rest is automatic.') }}</p>
        </div>
        <div class="flow-steps">
          <div class="flow-step">
            <div class="step-no">01</div>
            <h4>{{ t('配置你的偏好', 'Configure preferences') }}</h4>
            <p>{{ t('选关键词、填预算区间、加优先地区、录客户关系与不接类型。', 'Pick keywords, set budget range, add preferred regions, record client relationships and excluded types.') }}</p>
          </div>
          <div class="flow-step">
            <div class="step-no">02</div>
            <h4>{{ t('平台自动抓取', 'Automatic crawling') }}</h4>
            <p>{{ t('后台按计划抓取各招标平台新公告，抽取预算、采购人、地区等结构化字段。', 'The backend crawls bid platforms on schedule and extracts budget, purchaser, region and other structured fields.') }}</p>
          </div>
          <div class="flow-step">
            <div class="step-no">03</div>
            <h4>{{ t('打分 + AI 分析', 'Scoring + AI analysis') }}</h4>
            <p>{{ t('六维加权得出总分与档位，AI 补上推荐理由、投标思路和风险提示。', 'Six weighted axes produce a total score and tier; AI adds the reason, bidding angle and risk notes.') }}</p>
          </div>
          <div class="flow-step">
            <div class="step-no">04</div>
            <h4>{{ t('看结果 + 给反馈', 'Review + feedback') }}</h4>
            <p>{{ t('在「我的推荐」里逐条判断，标记结果会回流到下一轮打分。', 'Judge each one under "My Recommendations" — your marks feed back into the next scoring round.') }}</p>
          </div>
        </div>
      </div>
    </div>
    <SiteFooter />
  </div>
</template>

<style scoped>
.page-wrapper {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

.tender-home {
  position: relative;
  flex: 1;
  background-color: #f8fafc;
  overflow: hidden;
  font-family: "Inter", -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif;
  color: #0f172a;
  padding-top: 50px;
}

.background-grid {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(15, 23, 42, 0.035) 1px, transparent 1px),
    linear-gradient(90deg, rgba(15, 23, 42, 0.035) 1px, transparent 1px);
  background-size: 48px 48px;
  background-position: center center;
  z-index: 0;
  pointer-events: none;
}

.topbar {
  position: relative;
  z-index: 10;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 32px 48px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 2px;
  color: #94a3b8;
}

.topbar-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.logo-line {
  width: 24px;
  height: 2px;
  background-color: #2563eb;
}

.topbar-right .collection-text {
  color: #2563eb;
}

.main-content {
  position: relative;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 48px;
  max-width: 1400px;
  margin: 0 auto;
  padding: 56px 64px 80px;
}

/* 左侧 */
.hero-section {
  flex: 1;
  max-width: 620px;
  opacity: 0;
  transform: translateY(20px);
  transition: all 0.8s cubic-bezier(0.16, 1, 0.3, 1);
}

.tender-home.loaded .hero-section {
  opacity: 1;
  transform: translateY(0);
}

.hero-title {
  font-size: 54px;
  font-weight: 900;
  line-height: 1.18;
  letter-spacing: -1.5px;
  margin: 0 0 32px;
}

.text-dark { color: #0f172a; }
.text-accent { color: #2563eb; }

.underline {
  position: relative;
  display: inline-block;
}

.underline::after {
  content: '';
  position: absolute;
  left: 0;
  bottom: -2px;
  width: 100%;
  height: 8px;
  background-color: rgba(37, 99, 235, 0.22);
  border-radius: 4px;
}

.hero-subtitle {
  font-size: 18px;
  line-height: 1.85;
  color: #475569;
  font-weight: 500;
  margin: 0 0 44px;
}

.actions {
  display: flex;
  align-items: center;
  gap: 20px;
  flex-wrap: wrap;
}

.btn-start {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  background: #0f172a;
  color: #fff;
  padding: 15px 30px;
  border-radius: 9999px;
  font-size: 16px;
  font-weight: 700;
  text-decoration: none;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.2);
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

.btn-start:hover {
  transform: translateY(-4px);
  box-shadow: 0 16px 32px rgba(15, 23, 42, 0.28);
  background: #1e293b;
}

.btn-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  background: #fff;
  color: #0f172a;
  border-radius: 50%;
  font-size: 11px;
  padding-left: 2px;
}

.btn-ghost {
  display: inline-flex;
  align-items: center;
  padding: 15px 28px;
  border-radius: 9999px;
  font-size: 16px;
  font-weight: 700;
  text-decoration: none;
  color: #0f172a;
  background: #fff;
  border: 2px solid #0f172a;
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

.btn-ghost:hover {
  transform: translateY(-4px);
  background: #0f172a;
  color: #fff;
}

.hero-notes {
  display: flex;
  gap: 40px;
  margin-top: 32px;
  flex-wrap: wrap;
}

.note-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.note-item strong {
  font-size: 13px;
  font-weight: 700;
  color: #0f172a;
}

.note-item span {
  font-size: 13px;
  color: #94a3b8;
}

/* 右侧卡片 */
.cards-section {
  flex: 1;
  position: relative;
  height: 600px;
  display: flex;
  justify-content: center;
  align-items: center;
  perspective: 1200px;
}

.cards-wrapper {
  position: relative;
  width: 380px;
  height: 500px;
  transform-style: preserve-3d;
  transform: rotateX(5deg) rotateY(-5deg);
  transition: transform 0.6s cubic-bezier(0.16, 1, 0.3, 1);
}

.cards-wrapper:hover {
  transform: rotateX(0deg) rotateY(0deg);
}

.poster-card {
  position: absolute;
  width: 100%;
  height: 100%;
  background: #fff;
  border-radius: 16px;
  border: 1px solid rgba(37, 99, 235, 0.1);
  box-shadow:
    -20px 20px 60px rgba(15, 23, 42, 0.1),
    0 4px 12px rgba(15, 23, 42, 0.05);
  padding: 12px;
  transition: all 0.6s cubic-bezier(0.34, 1.56, 0.64, 1);
  opacity: 0;
}

.tender-home.loaded .poster-card {
  opacity: 1;
}

.card-inner {
  width: 100%;
  height: 100%;
  border: 1px solid rgba(37, 99, 235, 0.14);
  border-radius: 8px;
  padding: 30px 24px;
  background: linear-gradient(135deg, #fff 0%, #f4f8ff 100%);
  display: flex;
  flex-direction: column;
}

.card-tag {
  color: #2563eb;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 1.5px;
  margin-bottom: 20px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.card-tag::before {
  content: '';
  width: 2px;
  height: 12px;
  background: #2563eb;
}

.card-title {
  font-size: 26px;
  font-weight: 800;
  color: #0f172a;
  margin: 0 0 10px;
  line-height: 1.3;
}

.card-desc {
  font-size: 13px;
  color: #64748b;
  line-height: 1.6;
  margin: 0;
}

/* 卡片位置 */
.card-4 {
  transform: translateX(120px) translateY(80px) translateZ(-150px) rotateZ(12deg);
  z-index: 1;
  transition-delay: 0.3s;
}
.card-3 {
  transform: translateX(60px) translateY(40px) translateZ(-100px) rotateZ(8deg);
  z-index: 2;
  transition-delay: 0.2s;
}
.card-2 {
  transform: translateX(0px) translateY(0px) translateZ(-50px) rotateZ(4deg);
  z-index: 3;
  transition-delay: 0.1s;
}
.card-1 {
  transform: translateX(-60px) translateY(-40px) translateZ(0) rotateZ(0deg);
  z-index: 4;
  transition-delay: 0s;
}

.cards-wrapper:hover .card-4 {
  transform: translateX(160px) translateY(100px) translateZ(-150px) rotateZ(16deg);
}
.cards-wrapper:hover .card-3 {
  transform: translateX(80px) translateY(50px) translateZ(-80px) rotateZ(10deg);
}
.cards-wrapper:hover .card-2 {
  transform: translateX(0px) translateY(0px) translateZ(-10px) rotateZ(4deg);
}
.cards-wrapper:hover .card-1 {
  transform: translateX(-80px) translateY(-50px) translateZ(60px) rotateZ(-2deg);
}

/* 分档 chips */
.tier-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 28px;
}

.chip {
  display: inline-flex;
  align-items: center;
  height: 28px;
  padding: 0 12px;
  border-radius: 14px;
  font-size: 12px;
  font-weight: 600;
  background: #f1f5f9;
  color: #64748b;
}

.chip.priority { background: #fef2f2; color: #ef4444; }
.chip.consider { background: #fffbeb; color: #d97706; }
.chip.watch { background: #f1f5f9; color: #64748b; }
.chip.filter { background: #f8fafc; color: #94a3b8; }

/* 打分条 */
.score-bars {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 28px;
}

.bar-row {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
}

.bar-row span {
  width: 32px;
  color: #64748b;
  font-weight: 600;
  flex-shrink: 0;
}

.bar-row i {
  height: 6px;
  border-radius: 3px;
  background: #2563eb;
  opacity: 0.75;
}

.bar-row b {
  color: #0f172a;
  font-weight: 700;
  margin-left: auto;
}

/* 反馈列表 */
.card-list {
  margin-top: 28px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.list-item {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
  font-weight: 600;
  color: #334155;
}

.list-item span {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  background: #eff6ff;
  border-radius: 50%;
  font-size: 12px;
  flex-shrink: 0;
}

/* 流程 */
.flow-section {
  position: relative;
  z-index: 10;
  max-width: 1400px;
  margin: 0 auto;
  padding: 0 64px 96px;
}

.flow-head {
  margin-bottom: 32px;
}

.flow-head h2 {
  margin: 0 0 8px;
  font-size: 28px;
  font-weight: 800;
  letter-spacing: -0.5px;
  color: #0f172a;
}

.flow-head p {
  margin: 0;
  font-size: 15px;
  color: #64748b;
}

.flow-steps {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 20px;
}

.flow-step {
  padding: 24px;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

.flow-step:hover {
  transform: translateY(-3px);
  box-shadow: 0 10px 20px rgba(15, 23, 42, 0.07);
  border-color: #cbd5e1;
}

.step-no {
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 1px;
  color: #2563eb;
  margin-bottom: 12px;
}

.flow-step h4 {
  margin: 0 0 8px;
  font-size: 16px;
  font-weight: 700;
  color: #0f172a;
}

.flow-step p {
  margin: 0;
  font-size: 13px;
  line-height: 1.65;
  color: #64748b;
}

@media (max-width: 1024px) {
  .main-content {
    flex-direction: column;
    padding: 32px 32px 56px;
  }
  .hero-section {
    max-width: 100%;
  }
  .hero-title {
    font-size: 40px;
  }
  .cards-section {
    height: 520px;
  }
  .cards-wrapper {
    transform: scale(0.8) rotateX(0) rotateY(0);
  }
  .cards-wrapper:hover {
    transform: scale(0.85) rotateX(0) rotateY(0);
  }
  .flow-section {
    padding: 0 32px 64px;
  }
}

@media (max-width: 640px) {
  .topbar {
    padding: 24px 20px;
    font-size: 10px;
  }
  .main-content {
    padding: 24px 20px 40px;
  }
  .hero-title {
    font-size: 32px;
  }
  .flow-section {
    padding: 0 20px 48px;
  }
}
</style>
