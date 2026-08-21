<template>
  <div class="page-wrapper">
    <SiteHeader />
    <div class="consult-cover">
      <div class="background-grid"></div>
      <div class="header">
        <div class="header-left">
          <span class="logo-line"></span>
          <span class="logo-text">BRAND CONSULTING · 品牌占位系统</span>
        </div>
        <div class="header-right">
          <span class="collection-text">四看 / 四问 / 四大成</span>
        </div>
      </div>

      <div class="main-content">
        <div class="hero-section">
          <h1 class="hero-title">
            <span class="text-black">不是一次出一份报告，</span><br />
            <span class="text-black">而是</span><span class="text-accent underline">一步一步聊出结论</span>
          </h1>
          <p class="hero-subtitle">
            AI 先给你 2–4 个可选方向，附上选择理由、你手上的现有优势、核心解决方案。<br />
            你可以选一个、改一个，或者继续追问让它去查资料。<br />
            <span class="text-accent">每定下一步，就进企业知识库，成为下一步判断的依据。</span>
          </p>
          <div class="actions">
            <router-link to="/consult/projects" class="btn-start">
              <span class="btn-icon">▶</span>
              进入项目工作台
            </router-link>
            <router-link to="/consult/projects?new=1" class="btn-ghost">
              新建一个品牌项目
            </router-link>
          </div>
        </div>

        <div class="cards-section">
          <div class="cards-wrapper">
            <!-- Card 4 (Bottom-most) -->
            <div class="poster-card card-4">
              <div class="card-inner">
                <div class="card-tag">SEQUENCE</div>
                <h3 class="card-title">先找事实，再做判断</h3>
                <p class="card-desc">没有事实底座的战略判断，读起来一样漂亮，但依据是空的</p>
              </div>
            </div>
            <!-- Card 3 · 四问飞轮 -->
            <div class="poster-card card-3">
              <div class="card-inner">
                <div class="card-tag">四问 · 做判断</div>
                <h3 class="card-title">相互咬合的占位飞轮</h3>
                <p class="card-desc">四个判断彼此支撑，改一个就要回头看另外三个</p>
                <div class="card-graphic">
                  <div class="circle-node center-node">品牌占位</div>
                  <div class="circle-node top-node">定位</div>
                  <div class="circle-node right-node">价值</div>
                  <div class="circle-node bottom-node">信任</div>
                  <div class="circle-node left-node">关系</div>
                </div>
              </div>
            </div>
            <!-- Card 2 · 四看 -->
            <div class="poster-card card-2">
              <div class="card-inner">
                <div class="card-tag">四看 · 找事实</div>
                <h3 class="card-title">战场在哪，我有什么牌</h3>
                <p class="card-desc">快车道：AI 读你贴的资料直接出结论草稿，你 review</p>
                <div class="card-list">
                  <div class="list-item"><span>1</span>看自己 · 基因 / 优势 / 痛点</div>
                  <div class="list-item"><span>2</span>看行业 · 格局 / 空间 / 趋势</div>
                  <div class="list-item"><span>3</span>看竞品 · 对标 / 空位 / 避锋</div>
                  <div class="list-item"><span>4</span>看用户 · 画像 / 真实需求</div>
                </div>
              </div>
            </div>
            <!-- Card 1 (Top-most) · 知识库 -->
            <div class="poster-card card-1">
              <div class="card-inner">
                <div class="card-tag">企业知识库</div>
                <h3 class="card-title">每一步的结论都留下来</h3>
                <p class="card-desc">结论 + 取舍理由 + 依据来源 + 置信度。上游改了，下游会被标出来重跑</p>
                <div class="kb-mock">
                  <div class="kb-row"><span class="kb-name">看自己</span><span class="kb-dot green">🟢</span></div>
                  <div class="kb-row"><span class="kb-name">看行业</span><span class="kb-dot amber">🟡</span></div>
                  <div class="kb-row"><span class="kb-name">品牌定位</span><span class="kb-dot">…</span></div>
                </div>
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
  setTimeout(() => {
    document.querySelector('.consult-cover')?.classList.add('loaded');
  }, 100);
});
</script>

<style scoped>
/* 版式抄 /xhs 的海报封面，配色和字体换成 kimi3 那套（references/kimi3-design-system.css），
   品牌色用 consult 自己那支深蓝 #0B4A6F —— 封面、项目列表、工作台三页必须像同一个产品。
   例外：这一页的卡片保留 3D 位移悬停。工作台那条「悬停只改阴影」的规矩是为了别让
   正在核对的表格行跑掉，而这里卡片上没有要核对的数据。 */
.page-wrapper {
  --font-sans: "Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Microsoft YaHei", sans-serif;
  --font-mono: "SF Mono", Menlo, Monaco, "JetBrains Mono", monospace;
  --brand: #0B4A6F;
  --brand-soft: #E7F0F6;
  --brand-ink: #063553;
  --shadow: 0 12px 32px -12px rgba(0, 0, 0, .06), 0 2px 8px rgba(0, 0, 0, .02);
  --shadow-lg: 0 20px 48px -16px rgba(0, 0, 0, .1), 0 4px 16px rgba(0, 0, 0, .04);

  display: flex;
  flex-direction: column;
  min-height: 100vh;
}
.consult-cover {
  position: relative;
  flex: 1;
  background-color: #F5F5F7;
  overflow: hidden;
  font-family: var(--font-sans);
  color: #1D1D1F;
  padding-top: 50px;
}

.background-grid {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(0, 0, 0, 0.03) 1px, transparent 1px),
    linear-gradient(90deg, rgba(0, 0, 0, 0.03) 1px, transparent 1px);
  background-size: 24px 24px;
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
  font-family: var(--font-mono);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 5px;
  text-transform: uppercase;
  color: #86868B;
}
.header-left { display: flex; align-items: center; gap: 12px; }
.logo-line { width: 24px; height: 2px; background-color: var(--brand); }
.header-right .collection-text { color: var(--brand); }

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

.hero-section {
  flex: 1;
  max-width: 620px;
  opacity: 0;
  transform: translateY(20px);
  transition: all 0.8s cubic-bezier(0.16, 1, 0.3, 1);
}
.consult-cover.loaded .hero-section { opacity: 1; transform: translateY(0); }

/* 显式写 font-family：App.vue 里有一条全局 `h1..h6 { font-family: var(--font-serif) }` */
.hero-title {
  font-family: var(--font-sans);
  font-size: 56px;
  font-weight: 800;
  line-height: 1.22;
  letter-spacing: -1px;
  margin-bottom: 36px;
}
.text-black { color: #1D1D1F; }
.text-accent { color: var(--brand); }
.underline { position: relative; display: inline-block; }
.underline::after {
  content: '';
  position: absolute;
  left: 0;
  bottom: -4px;
  width: 100%;
  height: 8px;
  background-color: var(--brand);
  border-radius: 4px;
  opacity: .9;
}

.hero-subtitle {
  font-size: 17px;
  line-height: 1.95;
  color: #434344;
  font-weight: 500;
  margin-bottom: 48px;
}

.actions { display: flex; align-items: center; gap: 20px; flex-wrap: wrap; }

.btn-start {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  background: var(--brand);
  color: #fff;
  padding: 16px 32px;
  border-radius: 9999px;
  font-size: 16px;
  font-weight: 700;
  text-decoration: none;
  box-shadow: 0 8px 24px rgba(11, 74, 111, 0.22);
  transition: box-shadow .3s, background .3s;
}
.btn-start:hover {
  box-shadow: 0 16px 36px rgba(11, 74, 111, 0.32);
  background: var(--brand-ink);
}
.btn-ghost {
  display: inline-flex;
  align-items: center;
  padding: 16px 28px;
  border-radius: 9999px;
  font-size: 16px;
  font-weight: 700;
  text-decoration: none;
  color: var(--brand);
  background: rgba(255, 255, 255, .6);
  border: 2px solid var(--brand);
  transition: box-shadow .3s, background .3s, color .3s;
}
.btn-ghost:hover { background: var(--brand); color: #fff; box-shadow: var(--shadow-lg); }
.btn-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  background: #fff;
  color: var(--brand);
  border-radius: 50%;
  font-size: 12px;
  padding-left: 2px;
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
.cards-wrapper:hover { transform: rotateX(0deg) rotateY(0deg); }

.poster-card {
  position: absolute;
  width: 100%;
  height: 100%;
  background: rgba(255, 255, 255, 0.75);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  border-radius: 16px;
  border: 1px solid rgba(0, 0, 0, 0.07);
  box-shadow: -20px 20px 60px rgba(0, 0, 0, 0.08), 0 4px 12px rgba(0, 0, 0, 0.04);
  padding: 12px;
  transition: all 0.6s cubic-bezier(0.34, 1.56, 0.64, 1);
  opacity: 0;
}
/* 最上面那张（企业知识库）挂 4px 品牌顶边 —— 工作台里的主卡片是同一个记号 */
.card-1 { border-top: 4px solid var(--brand); }
.consult-cover.loaded .poster-card { opacity: 1; }

.card-inner {
  width: 100%;
  height: 100%;
  border: 1px solid rgba(11, 74, 111, 0.14);
  border-radius: 8px;
  padding: 30px 24px;
  background: linear-gradient(135deg, rgba(255, 255, 255, .85) 0%, rgba(231, 240, 246, .5) 100%);
  display: flex;
  flex-direction: column;
}
.card-tag {
  color: var(--brand);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 3px;
  text-transform: uppercase;
  margin-bottom: 20px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.card-tag::before { content: ''; width: 2px; height: 12px; background: var(--brand); flex: 0 0 auto; }
.card-title { font-family: var(--font-sans); font-size: 25px; font-weight: 800; color: #1D1D1F; margin-bottom: 10px; line-height: 1.34; letter-spacing: .3px; }
.card-desc { font-size: 13px; color: #434344; line-height: 1.75; }

.card-4 { transform: translateX(120px) translateY(80px) translateZ(-150px) rotateZ(12deg); z-index: 1; transition-delay: 0.3s; }
.card-3 { transform: translateX(60px) translateY(40px) translateZ(-100px) rotateZ(8deg); z-index: 2; transition-delay: 0.2s; }
.card-2 { transform: translateX(0px) translateY(0px) translateZ(-50px) rotateZ(4deg); z-index: 3; transition-delay: 0.1s; }
.card-1 { transform: translateX(-60px) translateY(-40px) translateZ(0) rotateZ(0deg); z-index: 4; transition-delay: 0s; }

.cards-wrapper:hover .card-4 { transform: translateX(160px) translateY(100px) translateZ(-150px) rotateZ(16deg); }
.cards-wrapper:hover .card-3 { transform: translateX(80px) translateY(50px) translateZ(-80px) rotateZ(10deg); }
.cards-wrapper:hover .card-2 { transform: translateX(0px) translateY(0px) translateZ(-10px) rotateZ(4deg); }
.cards-wrapper:hover .card-1 { transform: translateX(-80px) translateY(-50px) translateZ(60px) rotateZ(-2deg); }

/* Card 3 · 飞轮示意 */
.card-graphic { position: relative; margin-top: 32px; flex: 1; display: flex; align-items: center; justify-content: center; }
.circle-node {
  position: absolute;
  font-size: 12px;
  font-weight: 600;
  background: #fff;
  border: 1px solid rgba(11, 74, 111, .18);
  padding: 8px 12px;
  border-radius: 20px;
  color: var(--brand);
  box-shadow: 0 4px 12px rgba(11, 74, 111, 0.08);
}
.center-node { background: var(--brand); color: #fff; z-index: 2; padding: 12px 16px; font-size: 14px; }
.top-node { transform: translateY(-60px); }
.bottom-node { transform: translateY(60px); }
.left-node { transform: translateX(-70px); }
.right-node { transform: translateX(70px); }

/* Card 2 · 四看清单 */
.card-list { margin-top: 26px; display: flex; flex-direction: column; gap: 14px; }
.list-item { display: flex; align-items: center; gap: 12px; font-size: 13.5px; font-weight: 600; color: #1D1D1F; }
.list-item span {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  background: var(--brand-soft);
  color: var(--brand);
  border-radius: 50%;
  font-size: 12px;
  flex: 0 0 auto;
}

/* Card 1 · 知识库示意 */
.kb-mock { margin-top: 26px; display: flex; flex-direction: column; gap: 10px; }
.kb-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 12px;
  border: 1px solid var(--brand-soft);
  border-radius: 8px;
  background: rgba(255, 255, 255, .7);
  font-size: 13px;
  font-weight: 600;
  color: #1D1D1F;
}
.kb-name { font-family: var(--font-sans); }
.kb-dot { font-size: 12px; color: #98A2B3; }

@media (max-width: 1024px) {
  .main-content { flex-direction: column; padding: 40px 32px; text-align: center; }
  .hero-section { max-width: 100%; margin-bottom: 64px; }
  .hero-title { font-size: 38px; }
  .actions { justify-content: center; }
  .cards-wrapper { transform: scale(0.8) rotateX(0) rotateY(0); }
  .cards-wrapper:hover { transform: scale(0.85) rotateX(0) rotateY(0); }
}
</style>
