<template>
  <div class="legal-page">
    <SiteHeader />
    <main class="legal-main">
      <h1>{{ locale === 'en' ? 'Terms of Service' : '服务条款' }}</h1>
      <p class="updated">{{ locale === 'en' ? 'Last updated: July 2026' : '最后更新：2026年7月' }}</p>

      <template v-if="locale === 'en'">
        <section>
          <h2>1. Acceptance of Terms</h2>
          <p>By accessing and using QiaoNan ("the Platform"), you agree to be bound by these Terms of Service. If you do not agree to these terms, please do not use our services.</p>
        </section>

        <section>
          <h2>2. Description of Service</h2>
          <p>QiaoNan provides AI-powered web tools and a content publishing platform. Our services include but are not limited to:</p>
          <ul>
            <li>AI interactive tools (Fish Tank, Wisdom Board, Chat, Consultant)</li>
            <li>Content articles and topic collections</li>
            <li>User workspace and file management</li>
          </ul>
        </section>

        <section>
          <h2>3. User Accounts</h2>
          <ul>
            <li>You must provide accurate information when creating an account.</li>
            <li>You are responsible for maintaining the security of your account credentials.</li>
            <li>You must be at least 13 years old to create an account.</li>
            <li>We reserve the right to suspend or terminate accounts that violate these terms.</li>
          </ul>
        </section>

        <section>
          <h2>4. AI Service Usage</h2>
          <ul>
            <li>AI features are subject to daily usage quotas.</li>
            <li>AI-generated content is provided "as is" without guarantees of accuracy.</li>
            <li>You may not use AI features for illegal, harmful, or abusive purposes.</li>
            <li>We reserve the right to modify or discontinue AI features at any time.</li>
          </ul>
        </section>

        <section>
          <h2>5. Content</h2>
          <ul>
            <li>Content published on the platform is for informational purposes only.</li>
            <li>We do not guarantee the accuracy or completeness of any content.</li>
            <li>Users may not reproduce, distribute, or modify platform content without permission.</li>
          </ul>
        </section>

        <section>
          <h2>6. Prohibited Conduct</h2>
          <p>You agree not to:</p>
          <ul>
            <li>Use the platform for any illegal purpose.</li>
            <li>Attempt to gain unauthorized access to our systems.</li>
            <li>Interfere with or disrupt the platform's operation.</li>
            <li>Use automated tools to scrape or collect data without permission.</li>
            <li>Upload malicious code or content.</li>
          </ul>
        </section>

        <section>
          <h2>7. Disclaimer</h2>
          <p>The platform is provided "as is" without warranties of any kind. We do not guarantee uninterrupted or error-free service.</p>
        </section>

        <section>
          <h2>8. Limitation of Liability</h2>
          <p>To the maximum extent permitted by law, QiaoNan shall not be liable for any indirect, incidental, or consequential damages arising from your use of the platform.</p>
        </section>

        <section>
          <h2>9. Changes to Terms</h2>
          <p>We reserve the right to modify these terms at any time. Continued use of the platform after changes constitutes acceptance of the updated terms.</p>
        </section>

        <section>
          <h2>10. Contact</h2>
          <p>For questions about these Terms of Service, contact us at: <a href="mailto:364317853@qq.com">364317853@qq.com</a></p>
        </section>
      </template>

      <template v-else>
        <section>
          <h2>1. 条款接受</h2>
          <p>访问和使用 QiaoNan（"本平台"）即表示您同意受本服务条款的约束。如果您不同意这些条款，请勿使用我们的服务。</p>
        </section>

        <section>
          <h2>2. 服务说明</h2>
          <p>QiaoNan 提供 AI 驱动的 Web 工具和内容发布平台。我们的服务包括但不限于：</p>
          <ul>
            <li>AI 交互工具（鱼缸、智慧板、对话、顾问）</li>
            <li>内容文章和专题合集</li>
            <li>用户工作区和文件管理</li>
          </ul>
        </section>

        <section>
          <h2>3. 用户账户</h2>
          <ul>
            <li>创建账户时必须提供准确的信息。</li>
            <li>您有责任维护账户凭据的安全。</li>
            <li>您必须年满 13 周岁才能创建账户。</li>
            <li>我们保留暂停或终止违反条款的账户的权利。</li>
          </ul>
        </section>

        <section>
          <h2>4. AI 服务使用</h2>
          <ul>
            <li>AI 功能受每日使用配额限制。</li>
            <li>AI 生成的内容按"原样"提供，不保证其准确性。</li>
            <li>您不得将 AI 功能用于非法、有害或滥用目的。</li>
            <li>我们保留随时修改或停止 AI 功能的权利。</li>
          </ul>
        </section>

        <section>
          <h2>5. 内容</h2>
          <ul>
            <li>平台发布的内容仅供参考。</li>
            <li>我们不保证任何内容的准确性或完整性。</li>
            <li>未经许可，用户不得复制、分发或修改平台内容。</li>
          </ul>
        </section>

        <section>
          <h2>6. 禁止行为</h2>
          <p>您同意不会：</p>
          <ul>
            <li>将平台用于任何非法目的。</li>
            <li>试图未经授权访问我们的系统。</li>
            <li>干扰或破坏平台的运行。</li>
            <li>未经许可使用自动化工具抓取或收集数据。</li>
            <li>上传恶意代码或内容。</li>
          </ul>
        </section>

        <section>
          <h2>7. 免责声明</h2>
          <p>本平台按"原样"提供，不提供任何形式的保证。我们不保证服务不间断或无错误。</p>
        </section>

        <section>
          <h2>8. 责任限制</h2>
          <p>在法律允许的最大范围内，QiaoNan 不对因使用本平台而产生的任何间接、偶然或后果性损害承担责任。</p>
        </section>

        <section>
          <h2>9. 条款变更</h2>
          <p>我们保留随时修改本条款的权利。在变更后继续使用本平台即表示接受更新后的条款。</p>
        </section>

        <section>
          <h2>10. 联系方式</h2>
          <p>如对本服务条款有任何疑问，请联系我们：<a href="mailto:364317853@qq.com">364317853@qq.com</a></p>
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
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  background: #fafafa;
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
</style>
