<template>
  <div class="legal-page">
    <SiteHeader />
    <main class="legal-main">
      <h1>{{ locale === 'en' ? 'Privacy Policy' : '隐私政策' }}</h1>
      <p class="updated">{{ locale === 'en' ? 'Last updated: July 2026' : '最后更新：2026年7月' }}</p>

      <template v-if="locale === 'en'">
        <section>
          <h2>1. Information We Collect</h2>
          <p>When you use QiaoNan, we may collect the following information:</p>
          <ul>
            <li><strong>Account Information:</strong> Username and password when you register an account.</li>
            <li><strong>Usage Data:</strong> Pages visited, features used, and interaction patterns to improve our services.</li>
            <li><strong>Device Information:</strong> Browser type, operating system, screen resolution, and IP address.</li>
            <li><strong>Cookies:</strong> We use cookies and similar technologies for session management and analytics.</li>
          </ul>
        </section>

        <section>
          <h2>2. How We Use Your Information</h2>
          <ul>
            <li>To provide and maintain our services.</li>
            <li>To improve user experience and develop new features.</li>
            <li>To display relevant advertisements through Google AdSense.</li>
            <li>To ensure the security and integrity of our platform.</li>
          </ul>
        </section>

        <section>
          <h2>3. Third-Party Advertising</h2>
          <p>We use Google AdSense to serve advertisements on our website. Google may use cookies and web beacons to collect information about your visits to this and other websites in order to provide relevant advertisements. You can learn more about how Google uses data at <a href="https://policies.google.com/technologies/partner-sites" target="_blank" rel="noopener">Google's Partner Sites Policy</a>.</p>
          <p>You may opt out of personalized advertising by visiting <a href="https://www.google.com/settings/ads" target="_blank" rel="noopener">Google Ads Settings</a>.</p>
        </section>

        <section>
          <h2>4. Cookies</h2>
          <p>We use cookies to:</p>
          <ul>
            <li>Maintain your login session.</li>
            <li>Remember your language preferences.</li>
            <li>Analyze website traffic and usage patterns.</li>
            <li>Serve personalized advertisements via Google AdSense.</li>
          </ul>
          <p>You can control cookies through your browser settings. Disabling cookies may affect the functionality of some features.</p>
        </section>

        <section>
          <h2>5. Data Security</h2>
          <p>We implement industry-standard security measures to protect your personal information. However, no method of transmission over the internet is 100% secure.</p>
        </section>

        <section>
          <h2>6. Data Retention</h2>
          <p>We retain your account information as long as your account is active. You may request deletion of your account and associated data by contacting us.</p>
        </section>

        <section>
          <h2>7. Children's Privacy</h2>
          <p>Our services are not directed to children under 13. We do not knowingly collect personal information from children under 13.</p>
        </section>

        <section>
          <h2>8. Changes to This Policy</h2>
          <p>We may update this privacy policy from time to time. Changes will be posted on this page with an updated revision date.</p>
        </section>

        <section>
          <h2>9. Contact Us</h2>
          <p>If you have any questions about this Privacy Policy, please contact us at: <a href="mailto:364317853@qq.com">364317853@qq.com</a></p>
        </section>
      </template>

      <template v-else>
        <section>
          <h2>1. 我们收集的信息</h2>
          <p>当您使用 QiaoNan 时，我们可能收集以下信息：</p>
          <ul>
            <li><strong>账户信息：</strong>注册时提供的用户名和密码。</li>
            <li><strong>使用数据：</strong>访问的页面、使用的功能和交互模式，用于改进服务。</li>
            <li><strong>设备信息：</strong>浏览器类型、操作系统、屏幕分辨率和 IP 地址。</li>
            <li><strong>Cookie：</strong>我们使用 Cookie 和类似技术进行会话管理和数据分析。</li>
          </ul>
        </section>

        <section>
          <h2>2. 信息使用方式</h2>
          <ul>
            <li>提供和维护我们的服务。</li>
            <li>改善用户体验并开发新功能。</li>
            <li>通过 Google AdSense 展示相关广告。</li>
            <li>确保平台的安全性和完整性。</li>
          </ul>
        </section>

        <section>
          <h2>3. 第三方广告</h2>
          <p>我们使用 Google AdSense 在网站上展示广告。Google 可能使用 Cookie 和网络信标收集您访问本网站及其他网站的信息，以提供相关广告。您可以在 <a href="https://policies.google.com/technologies/partner-sites" target="_blank" rel="noopener">Google 合作伙伴网站政策</a> 了解更多信息。</p>
          <p>您可以访问 <a href="https://www.google.com/settings/ads" target="_blank" rel="noopener">Google 广告设置</a> 退出个性化广告。</p>
        </section>

        <section>
          <h2>4. Cookie 政策</h2>
          <p>我们使用 Cookie 用于：</p>
          <ul>
            <li>维持您的登录会话。</li>
            <li>记住您的语言偏好。</li>
            <li>分析网站流量和使用模式。</li>
            <li>通过 Google AdSense 提供个性化广告。</li>
          </ul>
          <p>您可以通过浏览器设置控制 Cookie。禁用 Cookie 可能会影响部分功能的使用。</p>
        </section>

        <section>
          <h2>5. 数据安全</h2>
          <p>我们采用行业标准的安全措施保护您的个人信息。但互联网传输方式无法保证 100% 安全。</p>
        </section>

        <section>
          <h2>6. 数据保留</h2>
          <p>只要您的账户处于活跃状态，我们就会保留您的账户信息。您可以联系我们请求删除账户及相关数据。</p>
        </section>

        <section>
          <h2>7. 儿童隐私</h2>
          <p>我们的服务不面向 13 岁以下的儿童。我们不会故意收集 13 岁以下儿童的个人信息。</p>
        </section>

        <section>
          <h2>8. 政策变更</h2>
          <p>我们可能会不定期更新本隐私政策。更新后的政策将在此页面发布，并标注修订日期。</p>
        </section>

        <section>
          <h2>9. 联系我们</h2>
          <p>如您对本隐私政策有任何疑问，请联系我们：<a href="mailto:364317853@qq.com">364317853@qq.com</a></p>
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
