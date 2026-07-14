<template>
  <div class="page-wrapper">
    <SiteHeader />
    <div class="xhs-home">
      <div class="background-grid"></div>
      <div class="header">
        <div class="header-left">
          <span class="logo-line"></span>
          <span class="logo-text">AI WORKPLACE · AGENCY SIGNAL</span>
        </div>
        <div class="header-right">
          <span class="collection-text">POSTER COLLECTION / 04</span>
        </div>
      </div>

      <div class="main-content">
        <div class="hero-section">
          <h1 class="hero-title">
            <span class="text-black">AI 时代最重要的</span><br />
            <span class="text-black">能力是</span><span class="text-accent underline">个人能动性</span>
          </h1>
          <p class="hero-subtitle">
            不是谁懂最多技术细节，谁就一定赢。<br />
            更关键的是谁能主动使用 AI，<br />
            <span class="text-accent">把它变成自己的工作流、学习工具和创造工具。</span>
          </p>
          <div class="actions">
            <router-link to="/xhs/studio" class="btn-start">
              <span class="btn-icon">▶</span>
              进入小红书爆款写作台
            </router-link>
          </div>
        </div>

        <div class="cards-section">
          <div class="cards-wrapper">
            <!-- Card 4 (Bottom-most) -->
            <div class="poster-card card-4">
              <div class="card-inner">
                <div class="card-tag">ACTION LAYER</div>
                <h3 class="card-title">差距从“我不会”开始拉开</h3>
              </div>
            </div>
            <!-- Card 3 -->
            <div class="poster-card card-3">
              <div class="card-inner">
                <div class="card-tag">PERSONAL AGENCY</div>
                <h3 class="card-title">高能动性的通才</h3>
                <p class="card-desc">不是什么都会，而是能快速组装能力</p>
                <div class="card-graphic">
                  <div class="circle-node center-node">问题解决者</div>
                  <div class="circle-node top-node">AI 赋能</div>
                  <div class="circle-node right-node">工具矩阵</div>
                  <div class="circle-node bottom-node">快速迭代</div>
                  <div class="circle-node left-node">跨域连接</div>
                </div>
              </div>
            </div>
            <!-- Card 2 -->
            <div class="poster-card card-2">
              <div class="card-inner">
                <div class="card-tag">MOMENTUM</div>
                <h3 class="card-title">从执行者，到推进者</h3>
                <p class="card-desc">AI 剥夺低级工作，放大高级能动性</p>
                <div class="card-list">
                  <div class="list-item"><span>1</span>拒绝被动等待</div>
                  <div class="list-item"><span>2</span>主动构建系统</div>
                  <div class="list-item"><span>3</span>利用 AI 杠杆</div>
                </div>
              </div>
            </div>
            <!-- Card 1 (Top-most) -->
            <div class="poster-card card-1">
              <div class="card-inner">
                <div class="card-tag">DEEP EXPERTISE</div>
                <h3 class="card-title">极深的顶层思考</h3>
                <p class="card-desc">AI 能写代码，但代替不了业务直觉</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <SiteFooter />
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import SiteHeader from '../../components/common/SiteHeader.vue';
import SiteFooter from '../../components/common/SiteFooter.vue';

onMounted(() => {
  // Add some entrance animation classes after mount
  setTimeout(() => {
    document.querySelector('.xhs-home')?.classList.add('loaded');
  }, 100);
});
</script>

<style scoped>
.page-wrapper {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}
.xhs-home {
  position: relative;
  flex: 1;
  background-color: #FDFBF7; /* 暖白底色 */
  overflow: hidden;
  font-family: "Inter", -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif;
  color: #1A1A1A;
  padding-top: 50px;
}

/* 极致淡雅网格线背景 */
.background-grid {
  position: absolute;
  inset: 0;
  background-image: 
    linear-gradient(rgba(0, 0, 0, 0.04) 1px, transparent 1px), 
    linear-gradient(90deg, rgba(0, 0, 0, 0.04) 1px, transparent 1px);
  background-size: 48px 48px;
  background-position: center center;
  z-index: 0;
  pointer-events: none;
}

.header {
  position: relative;
  z-index: 10;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 32px 48px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 2px;
  color: #8C8C8C;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.logo-line {
  width: 24px;
  height: 2px;
  background-color: #E24A29;
}

.header-right .collection-text {
  color: #E24A29;
}

.main-content {
  position: relative;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: space-between;
  max-width: 1400px;
  margin: 0 auto;
  padding: 80px 64px;
  min-height: calc(100vh - 100px);
}

/* 左侧文本区 */
.hero-section {
  flex: 1;
  max-width: 600px;
  opacity: 0;
  transform: translateY(20px);
  transition: all 0.8s cubic-bezier(0.16, 1, 0.3, 1);
}

.xhs-home.loaded .hero-section {
  opacity: 1;
  transform: translateY(0);
}

.hero-title {
  font-size: 64px;
  font-weight: 900;
  line-height: 1.15;
  letter-spacing: -1.5px;
  margin-bottom: 40px;
}

.text-black {
  color: #111;
}

.text-accent {
  color: #E24A29;
}

.underline {
  position: relative;
  display: inline-block;
}

.underline::after {
  content: '';
  position: absolute;
  left: 0;
  bottom: -4px;
  width: 100%;
  height: 8px;
  background-color: #E24A29;
  border-radius: 4px;
}

.hero-subtitle {
  font-size: 20px;
  line-height: 1.8;
  color: #4A4A4A;
  font-weight: 500;
  margin-bottom: 56px;
}

.actions {
  display: flex;
  align-items: center;
  gap: 24px;
}

.btn-start {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  background: #E24A29;
  color: #fff;
  padding: 16px 32px;
  border-radius: 9999px;
  font-size: 16px;
  font-weight: 700;
  text-decoration: none;
  box-shadow: 0 8px 24px rgba(226, 74, 41, 0.25);
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

.btn-start:hover {
  transform: translateY(-4px);
  box-shadow: 0 16px 32px rgba(226, 74, 41, 0.35);
  background: #f05431;
}

.btn-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  background: #fff;
  color: #E24A29;
  border-radius: 50%;
  font-size: 12px;
  padding-left: 2px; /* 光学对齐居中 */
}

/* 右侧卡片区 */
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
  height: 520px;
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
  background: #FFF;
  border-radius: 16px;
  border: 1px solid rgba(226, 74, 41, 0.1);
  box-shadow: 
    -20px 20px 60px rgba(0, 0, 0, 0.08),
    0 4px 12px rgba(0, 0, 0, 0.04);
  padding: 12px;
  transition: all 0.6s cubic-bezier(0.34, 1.56, 0.64, 1);
  opacity: 0;
}

.xhs-home.loaded .poster-card {
  opacity: 1;
}

.card-inner {
  width: 100%;
  height: 100%;
  border: 1px solid rgba(226, 74, 41, 0.15);
  border-radius: 8px;
  padding: 32px 24px;
  background: linear-gradient(135deg, #fff 0%, #FEF8F6 100%);
  display: flex;
  flex-direction: column;
}

.card-tag {
  color: #E24A29;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 1.5px;
  margin-bottom: 24px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.card-tag::before {
  content: '';
  width: 2px;
  height: 12px;
  background: #E24A29;
}

.card-title {
  font-size: 28px;
  font-weight: 800;
  color: #1A1A1A;
  margin-bottom: 12px;
  line-height: 1.3;
}

.card-desc {
  font-size: 14px;
  color: #666;
  line-height: 1.6;
}

/* Specific Card Positions & Delays */
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

/* Hover Parallax Spread */
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

/* Card 3 Graphic Mockup */
.card-graphic {
  position: relative;
  margin-top: 40px;
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
.circle-node {
  position: absolute;
  font-size: 12px;
  font-weight: 600;
  background: #fff;
  border: 1px solid #FFE4DF;
  padding: 8px 12px;
  border-radius: 20px;
  color: #E24A29;
  box-shadow: 0 4px 12px rgba(226, 74, 41, 0.08);
}
.center-node {
  background: #E24A29;
  color: #fff;
  z-index: 2;
  padding: 12px 16px;
  font-size: 14px;
}
.top-node { transform: translateY(-60px); }
.bottom-node { transform: translateY(60px); }
.left-node { transform: translateX(-70px); }
.right-node { transform: translateX(70px); }

/* Card 2 List Mockup */
.card-list {
  margin-top: 32px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.list-item {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 15px;
  font-weight: 600;
  color: #333;
}
.list-item span {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  background: #FFE4DF;
  color: #E24A29;
  border-radius: 50%;
  font-size: 12px;
}

@media (max-width: 1024px) {
  .main-content {
    flex-direction: column;
    padding: 40px 32px;
    text-align: center;
  }
  .hero-section {
    max-width: 100%;
    margin-bottom: 64px;
  }
  .actions {
    justify-content: center;
  }
  .cards-wrapper {
    transform: scale(0.8) rotateX(0) rotateY(0);
  }
  .cards-wrapper:hover {
    transform: scale(0.85) rotateX(0) rotateY(0);
  }
}
</style>
