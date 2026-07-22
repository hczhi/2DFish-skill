<template>
  <div class="legal-page">
    <SiteHeader />
    <main class="legal-main">
      <h1>{{ locale === 'en' ? 'About Us' : '关于我们' }}</h1>
      <p class="updated">{{ locale === 'en' ? 'Last updated: July 2026' : '最后更新：2026年7月' }}</p>

      <template v-if="locale === 'en'">
        <section>
          <h2>Who We Are</h2>
          <p>QiaoNan is an independent product built by a small team of developers who use AI-assisted engineering to create practical online tools. We started as our own first users — building the features we genuinely needed, then opening them up to everyone.</p>
        </section>

        <section>
          <h2>What This Platform Does</h2>
          <p>QiaoNan is a multi-module platform. Each module is an independent, fully functional tool, brought together under one unified navigation and account system. Our current modules include:</p>
          <ul>
            <li><strong>Tender Recommendation</strong> — an AI-driven engine that matches public bidding notices to your business profile and surfaces the ones worth pursuing.</li>
            <li><strong>Xiaohongshu Writing Studio</strong> — a diagnosis and AI co-writing workbench for creating high-performing social content.</li>
            <li><strong>Discover</strong> — freely readable articles and topics on building tools, going global, and independent development.</li>
            <li>… and more tools added over time.</li>
          </ul>
        </section>

        <section>
          <h2>Who It's For</h2>
          <p>The platform is built for independent developers, small teams, and business professionals who want practical, AI-powered tools without a steep learning curve. If you do bidding work, create content, or simply want useful utilities in one place, QiaoNan is for you.</p>
        </section>

        <section>
          <h2>Our Approach</h2>
          <p>We build in the open and iterate quickly. Every feature ships because it solves a real problem we or our users have faced. We care about being useful, honest, and easy to work with.</p>
        </section>

        <section>
          <h2>Contact Us</h2>
          <p>Questions, feedback, or partnership ideas? Reach us at <a href="mailto:364317853@qq.com">364317853@qq.com</a>. We read every message.</p>
        </section>
      </template>

      <template v-else>
        <section>
          <h2>我们是谁</h2>
          <p>QiaoNan（巧楠）是一个由小团队打造的独立产品。我们用 AI 辅助编程的方式，做真正实用的在线工具。我们自己就是产品的第一批用户——先做出自己真正需要的功能，再把它们开放给所有人。</p>
        </section>

        <section>
          <h2>这个平台是做什么的</h2>
          <p>QiaoNan 是一个多模块平台。每个模块都是一个独立、完整可用的工具，统一在一套导航和账号体系下聚合。目前的模块包括：</p>
          <ul>
            <li><strong>标讯智能推荐</strong>——AI 驱动的招投标匹配引擎，把公开招标公告与你的业务画像匹配，帮你筛出值得跟进的项目。</li>
            <li><strong>小红书写作台</strong>——爆款诊断 + AI 陪写的创作工作台，帮你产出高表现的社交内容。</li>
            <li><strong>发现</strong>——关于做工具、出海和独立开发的公开文章与话题，任何人都可免费阅读。</li>
            <li>……以及后续不断增加的更多工具。</li>
          </ul>
        </section>

        <section>
          <h2>它适合谁</h2>
          <p>本平台为独立开发者、小团队以及商务从业者而打造——他们希望用上实用的、AI 加持的工具，而不必付出高昂的学习成本。无论你在做招投标、做内容创作，还是只想把好用的小工具集中在一处，QiaoNan 都适合你。</p>
        </section>

        <section>
          <h2>我们的理念</h2>
          <p>我们公开地做产品，快速迭代。每一个功能之所以上线，都是因为它解决了我们或用户真实遇到的问题。我们在意的是——有用、真诚、好打交道。</p>
        </section>

        <section>
          <h2>联系我们</h2>
          <p>有问题、建议或合作想法？欢迎联系我们：<a href="mailto:364317853@qq.com">364317853@qq.com</a>。每一条消息我们都会认真阅读。</p>
        </section>
      </template>
    </main>
    <SiteFooter />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import SiteHeader from '../components/common/SiteHeader.vue'
import SiteFooter from '../components/common/SiteFooter.vue'

const route = useRoute()
const locale = computed(() => route.path.startsWith('/en') ? 'en' : 'zh')
</script>

<style scoped>
.legal-page {
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  background: #fafafa;
  overflow-x: clip;
}

.legal-main {
  flex: 1;
  max-width: 800px;
  margin: 0 auto;
  padding: 100px 24px 80px;
  line-height: 1.8;
  color: #374151;
}

.legal-main h1 {
  font-size: 36px;
  font-weight: 800;
  color: #111827;
  margin-bottom: 8px;
}

.updated {
  color: #6b7280;
  font-size: 14px;
  margin-bottom: 40px;
}

.legal-main h2 {
  font-size: 20px;
  font-weight: 700;
  color: #111827;
  margin: 32px 0 12px;
}

.legal-main p {
  margin-bottom: 12px;
}

.legal-main ul {
  padding-left: 24px;
  margin-bottom: 12px;
}

.legal-main li {
  margin-bottom: 8px;
}

.legal-main a {
  color: #4361EE;
  text-decoration: none;
}
.legal-main a:hover {
  text-decoration: underline;
}

section {
  margin-bottom: 24px;
}

@media (max-width: 768px) {
  .legal-main {
    padding: 88px 16px 56px;
  }

  .legal-main h1 {
    font-size: 28px;
  }

  .legal-main h2 {
    font-size: 18px;
  }
}
</style>
