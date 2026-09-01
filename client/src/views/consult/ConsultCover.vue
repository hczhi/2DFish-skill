<template>
  <div class="page-wrapper" @scroll="handleScroll" ref="wrapperRef">
    <SiteHeader :class="['dynamic-header', { 'is-scrolled': isScrolled }]" />
    
    <div class="consult-cover">
      <!-- 首屏：全屏背景图 -->
      <section class="hero-section">
        <div class="hero-bg">
          <img src="http://file.qiaonan.vip/uploads/2026/09/01/90892237-f079-493e-b2e4-13c15d0106e5.jpg" alt="Business Strategy" class="bg-img" />
          <!-- 蓝紫渐变遮罩，还原图一质感 -->
          <div class="bg-overlay"></div>
        </div>

        <div class="hero-content">
          <div class="hero-left editorial-layout">
            <div class="hero-kicker">
              <span class="kicker-line"></span>
              <span class="kicker-text">AI-POWERED BRAND CONSULTING</span>
            </div>
            
            <h1 class="main-title">
              让品牌战略<br>决策更简单。
            </h1>
            
            <div class="hero-desc-wrapper">
              <div class="vertical-accent"></div>
              <p class="sub-title">
                基于 AI 的智能品牌咨询框架。<br>
                通过四看、四问、四大成，抛弃写完即焚的报告，<br>
                为你构建坚实的商业事实底座。
              </p>
            </div>
            
            <div class="actions">
              <router-link to="/consult/projects" class="btn-yellow editorial-btn">
                进入工作台
                <span class="icon-arrow">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                </span>
              </router-link>
            </div>
          </div>
          
          <!-- 底部滚动提示 -->
          <div class="scroll-indicator">
            <div class="mouse-icon">
              <div class="wheel"></div>
            </div>
          </div>
        </div>
      </section>

      <!-- 模块一：功能介绍 (Feature Introduction) -->
      <section class="feature-section">
        <div class="section-container">
          <div class="feature-layout">
            <div class="feature-text-side">
              <h2 class="section-title">重塑品牌<br>战略决策流</h2>
              <p class="section-desc">
                我们抛弃了传统“写完即焚”的 PPT 报告，将品牌咨询拆解为结构化的数据与推演。
              </p>
              <div class="feature-decoration-line"></div>
            </div>
            
            <div class="feature-cards-side">
              <!-- Feature 1: 四看 -->
              <div class="feature-card glass-card">
                <div class="fc-number">01</div>
                <h3 class="fc-title">四看分析底座</h3>
                <p class="fc-desc">看自己、看行业、看竞品、看用户。AI 快速阅读你贴入的客户资料，自动生成结构化事实报告，构建坚实的决策基石。</p>
              </div>
              
              <!-- Feature 2: 四问 -->
              <div class="feature-card glass-card offset-card">
                <div class="fc-number">02</div>
                <h3 class="fc-title">四大成占位飞轮</h3>
                <p class="fc-desc">定位、价值、信任、关系。四个判断相互咬合彼此支撑。当你修改其中一个，AI 会自动提示需要同步核对的其他三个方向。</p>
              </div>
              
              <!-- Feature 3: 知识库 -->
              <div class="feature-card glass-card">
                <div class="fc-number">03</div>
                <h3 class="fc-title">企业资产沉淀</h3>
                <p class="fc-desc">每定下一步结论，包括取舍理由、依据来源与置信度，都会自动存入企业知识库，作为下游设计、营销等动作的核心依据。</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- 模块二：服务客户 (Client Logos) -->
      <section class="clients-section">
        <div class="section-container">
          <p class="clients-kicker">TRUSTED BY INNOVATIVE COMPANIES</p>
          
          <div class="logo-carousel">
            <div class="logo-track">
              <!-- 虚构的商业客户Logo (重复两组以实现无缝滚动) -->
              <div class="logo-item"><span class="lg-icon">⬡</span> NEXUS TECH</div>
              <div class="logo-item"><span class="lg-icon">◭</span> QUANTUM</div>
              <div class="logo-item"><span class="lg-icon">⟡</span> AERONAUTICS</div>
              <div class="logo-item"><span class="lg-icon">◈</span> SYNAPSE</div>
              <div class="logo-item"><span class="lg-icon">◮</span> VORTEX</div>
              <div class="logo-item"><span class="lg-icon">⬢</span> CHRONOS</div>
              <!-- 重复组 -->
              <div class="logo-item"><span class="lg-icon">⬡</span> NEXUS TECH</div>
              <div class="logo-item"><span class="lg-icon">◭</span> QUANTUM</div>
              <div class="logo-item"><span class="lg-icon">⟡</span> AERONAUTICS</div>
              <div class="logo-item"><span class="lg-icon">◈</span> SYNAPSE</div>
              <div class="logo-item"><span class="lg-icon">◮</span> VORTEX</div>
              <div class="logo-item"><span class="lg-icon">⬢</span> CHRONOS</div>
            </div>
          </div>
        </div>
      </section>

    </div>
    
    <!-- 引入通用页脚 -->
    <SiteFooter />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import SiteHeader from '../../components/common/SiteHeader.vue';
import SiteFooter from '../../components/common/SiteFooter.vue';

const isScrolled = ref(false);
const wrapperRef = ref<HTMLElement | null>(null);

function handleScroll() {
  if (!wrapperRef.value) return;
  // 当向下滚动超过 60px 时，改变导航栏状态
  isScrolled.value = wrapperRef.value.scrollTop > 60;
}

onMounted(() => {
  setTimeout(() => {
    document.querySelector('.hero-content')?.classList.add('is-visible');
  }, 100);
  
  // Intersection Observer for scroll animations in lower sections
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
      }
    });
  }, { threshold: 0.15 });

  document.querySelectorAll('.feature-card, .logo-item').forEach((el) => {
    observer.observe(el);
  });
});
</script>

<style scoped>
.page-wrapper {
  --font-sans: "Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Microsoft YaHei", sans-serif;
  --font-mono: "SF Mono", Menlo, Monaco, "JetBrains Mono", monospace;
  --brand-yellow: #FFB800;
  --brand-yellow-hover: #E6A600;
  --text-primary: #FFFFFF;
  --text-secondary: rgba(255, 255, 255, 0.85);
  --bg-color: #12182B; /* 从 #0A0F1E 调亮 */
  
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow-y: auto; /* 开启页面级滚动 */
  overflow-x: hidden;
  font-family: var(--font-sans);
  background: var(--bg-light);
}

/* 动态导航栏：在顶部时透明，向下滚动后恢复实色 */
:deep(.site-header.dynamic-header) {
  position: fixed;
  top: 0;
  width: 100%;
  transition: all 0.3s ease;
  background: transparent !important;
  border-bottom: none !important;
  box-shadow: none !important;
}
:deep(.site-header.dynamic-header *) {
  color: #fff !important;
  transition: color 0.3s ease;
}

/* 滚动后的导航栏状态 */
:deep(.site-header.dynamic-header.is-scrolled) {
  background: rgba(255, 255, 255, 0.9) !important;
  backdrop-filter: blur(12px) !important;
  border-bottom: 1px solid rgba(0,0,0,0.05) !important;
  box-shadow: 0 4px 12px rgba(0,0,0,0.03) !important;
}
:deep(.site-header.dynamic-header.is-scrolled *) {
  color: var(--text-primary) !important;
}

.consult-cover {
  flex: 1;
  display: flex;
  flex-direction: column;
}

/* ==================
   Section 1: Hero
================== */
.hero-section {
  position: relative;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #000;
}

/* 背景图与遮罩 */
.hero-bg {
  position: absolute;
  inset: 0;
  z-index: 0;
}

.bg-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center 30%;
}

.bg-overlay {
  position: absolute;
  inset: 0;
  background: rgba(18, 24, 43, 0.65);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}

/* 主要内容区 */
.hero-content {
  position: relative;
  z-index: 1;
  flex: 1;
  width: 100%;
  max-width: 1400px;
  margin: 0 auto;
  padding: 120px 64px 60px;
  display: flex;
  justify-content: space-between;
  box-sizing: border-box;
  opacity: 0;
  transform: translateY(20px);
  transition: all 1s cubic-bezier(0.16, 1, 0.3, 1);
}

.hero-content.is-visible {
  opacity: 1;
  transform: translateY(0);
}

/* 左侧排版 - 杂志化重构 */
.hero-left.editorial-layout {
  display: flex;
  flex-direction: column;
  justify-content: center;
  max-width: 800px;
  padding-bottom: 80px;
}

.hero-kicker {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 32px;
}

.kicker-line {
  width: 48px;
  height: 2px;
  background: var(--brand-yellow);
}

.kicker-text {
  font-family: var(--font-mono);
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.2em;
  color: var(--brand-yellow);
}

.main-title {
  font-size: 88px;
  font-weight: 800;
  color: #fff;
  line-height: 1.1;
  letter-spacing: -0.04em;
  margin: 0 0 40px;
  text-shadow: 0 8px 24px rgba(0,0,0,0.2);
}

.hero-desc-wrapper {
  display: flex;
  gap: 24px;
  margin-bottom: 56px;
}

.vertical-accent {
  width: 3px;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 2px;
}

.sub-title {
  font-size: 20px;
  color: rgba(255, 255, 255, 0.85);
  margin: 0;
  line-height: 1.8;
  font-weight: 300;
  letter-spacing: 0.02em;
}

/* 黄色按钮 */
.actions {
  margin-bottom: auto;
}

.btn-yellow {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  background: var(--brand-yellow);
  color: #111;
  padding: 16px 36px;
  border-radius: 999px;
  font-size: 16px;
  font-weight: 700;
  text-decoration: none;
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  box-shadow: 0 8px 24px rgba(255, 184, 0, 0.25);
}

.btn-yellow:hover {
  background: var(--brand-yellow-hover);
  transform: translateY(-2px);
  box-shadow: 0 12px 32px rgba(255, 184, 0, 0.35);
}

.btn-yellow:active {
  transform: translateY(0) scale(0.98);
}

.icon-arrow {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  background: #fff;
  border-radius: 50%;
  color: var(--brand-yellow);
}

.icon-arrow svg {
  width: 14px;
  height: 14px;
}

/* 左下角轮播点 */
.slider-dots {
  display: flex;
  gap: 12px;
  align-items: center;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.3);
  transition: all 0.3s;
  cursor: pointer;
}

.dot.active {
  width: 24px;
  border-radius: 4px;
  background: var(--brand-yellow);
}

/* 右侧排版 */
.hero-right {
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  padding-bottom: 40px;
}

.stats-block {
  text-align: right;
}

.stats-label {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.8);
  margin: 0 0 8px;
  letter-spacing: 0.05em;
}

.stats-number {
  font-family: var(--font-mono);
  font-size: 88px;
  font-weight: 800;
  color: #fff;
  line-height: 1;
  letter-spacing: -0.04em;
  text-shadow: 0 8px 24px rgba(0,0,0,0.2);
}

/* 底部居中滚动指示器 */
.scroll-indicator {
  position: absolute;
  bottom: 40px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  opacity: 0.7;
}

.mouse-icon {
  width: 26px;
  height: 40px;
  border: 2px solid #fff;
  border-radius: 14px;
  position: relative;
  display: flex;
  justify-content: center;
}

.wheel {
  width: 4px;
  height: 8px;
  background: #fff;
  border-radius: 2px;
  margin-top: 6px;
  animation: scroll 2s cubic-bezier(0.15, 0.41, 0.69, 0.94) infinite;
}

@keyframes scroll {
  0% { transform: translateY(0); opacity: 1; }
  100% { transform: translateY(12px); opacity: 0; }
}

/* ==================
   Section 2 & 3: Content
================== */
.feature-section {
  padding: 140px 0;
  background: #111; /* 深色背景提升高级感 */
  color: #fff;
}

.clients-section {
  padding: 80px 0 120px;
  background: #000;
  overflow: hidden;
}

.section-container {
  max-width: 1400px;
  margin: 0 auto;
  padding: 0 64px;
}

/* 核心功能：双栏布局 */
.feature-layout {
  display: flex;
  align-items: flex-start;
  gap: 80px;
}

.feature-text-side {
  flex: 0 0 40%;
  position: sticky;
  top: 140px;
}

.section-title {
  font-size: 56px;
  font-weight: 800;
  color: #fff;
  margin: 0 0 32px;
  letter-spacing: -0.02em;
  line-height: 1.15;
}

.section-desc {
  font-size: 20px;
  color: rgba(255,255,255,0.7);
  line-height: 1.6;
  margin: 0 0 48px;
}

.feature-decoration-line {
  width: 60px;
  height: 4px;
  background: var(--brand-yellow);
  border-radius: 2px;
}

/* 核心功能：右侧卡片瀑布流 */
.feature-cards-side {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 32px;
}

.feature-card {
  padding: 48px;
  border-radius: 24px;
  transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
  opacity: 0;
  transform: translateY(40px);
}

.glass-card {
  background: rgba(255, 255, 255, 0.03);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.glass-card:hover {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.15);
  transform: translateY(-8px) !important; /* 覆盖默认 transform */
}

.feature-card.is-visible {
  opacity: 1;
  transform: translateY(0);
}

.offset-card {
  margin-left: 80px; /* 错落排版 */
}

.fc-number {
  font-family: var(--font-mono);
  font-size: 16px;
  color: var(--brand-yellow);
  font-weight: 700;
  margin-bottom: 24px;
  letter-spacing: 2px;
}

.fc-title {
  font-size: 32px;
  font-weight: 800;
  color: #fff;
  margin: 0 0 20px;
  letter-spacing: -0.02em;
}

.fc-desc {
  font-size: 18px;
  color: rgba(255,255,255,0.6);
  line-height: 1.7;
  margin: 0;
}

/* 客户 Logo 墙 */
.clients-kicker {
  text-align: center;
  font-family: var(--font-mono);
  font-size: 13px;
  letter-spacing: 4px;
  color: rgba(255,255,255,0.4);
  margin-bottom: 64px;
}

.logo-carousel {
  position: relative;
  width: 100%;
  overflow: hidden;
  /* 左右边缘渐变遮罩，制造空间感 */
  mask-image: linear-gradient(to right, transparent, black 10%, black 90%, transparent);
  -webkit-mask-image: linear-gradient(to right, transparent, black 10%, black 90%, transparent);
}

.logo-track {
  display: flex;
  gap: 80px;
  align-items: center;
  width: max-content;
  animation: carousel-scroll 30s linear infinite;
}

.logo-track:hover {
  animation-play-state: paused;
}

@keyframes carousel-scroll {
  0% { transform: translateX(0); }
  100% { transform: translateX(calc(-50% - 40px)); /* 一半的宽度减去gap的一半 */ }
}

.logo-item {
  display: flex;
  align-items: center;
  gap: 12px;
  font-family: var(--font-mono);
  font-size: 24px;
  font-weight: 800;
  color: rgba(255,255,255,0.3);
  letter-spacing: -0.5px;
  white-space: nowrap;
  transition: color 0.3s;
  cursor: default;
}

.logo-item:hover {
  color: #fff;
}

.lg-icon {
  font-size: 32px;
  color: rgba(255,255,255,0.2);
  transition: color 0.3s;
}

.logo-item:hover .lg-icon {
  color: var(--brand-yellow);
}

/* 响应式 */
@media (max-width: 1024px) {
  .main-title { font-size: 64px; }
  .hero-content { padding: 100px 40px 40px; }
  
  .feature-layout { flex-direction: column; gap: 40px; }
  .feature-text-side { position: relative; top: 0; }
  .offset-card { margin-left: 0; }
}

@media (max-width: 768px) {
  .hero-content {
    flex-direction: column;
    padding: 100px 24px 40px;
  }
  .hero-left.editorial-layout { padding-bottom: 40px; }
  .main-title { font-size: 48px; }
  
  .section-container { padding: 0 24px; }
  .feature-card { padding: 32px; }
  .fc-title { font-size: 24px; }
}
</style>
