<template>
  <footer v-if="!embedded" class="site-footer" :class="{ 'is-home': isHome }">
    <div class="footer-content">
      <div class="brand">QiaoNx.</div>
      <div class="copyright">
        &copy; {{ new Date().getFullYear() }} QiaoNx. All rights reserved.
      </div>
      <div class="links">
        <router-link :to="locale === 'en' ? '/en/about' : '/about'">{{ locale === 'en' ? 'About' : '关于我们' }}</router-link>
        <router-link :to="locale === 'en' ? '/en/privacy' : '/privacy'">{{ locale === 'en' ? 'Privacy' : '隐私政策' }}</router-link>
        <router-link :to="locale === 'en' ? '/en/terms' : '/terms'">{{ locale === 'en' ? 'Terms' : '服务条款' }}</router-link>
        <a href="mailto:364317853@qq.com">{{ locale === 'en' ? 'Contact' : '联系我们' }}</a>
        <a href="/sitemap.xml">{{ locale === 'en' ? 'Sitemap' : '网站地图' }}</a>
      </div>
    </div>
  </footer>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { isEmbedMode } from '../../lib/embed'

// 见 SiteHeader：嵌进第三方页面时页脚整块不出现（我们的备案信息/关于我们/网站地图挂在
// 别人的站点底下，点进去还会把 iframe 导到我们的页面上，而那一页在他们的框里是打不开的）。
const embedded = isEmbedMode()

const route = useRoute()
const isHome = computed(() => route.path === '/')
const locale = computed(() => route.path.startsWith('/en') ? 'en' : 'zh')
</script>

<style scoped>
.site-footer {
  border-top: 1px solid var(--c-grid, rgba(0, 160, 255, 0.15));
  background: #ffffff;
  padding: 32px 40px;
  font-family: var(--font-mono, monospace);
  font-size: 12px;
  color: var(--c-text-sub, #555);
  margin-top: auto;
}

@media (min-width: 769px) {
  .site-footer.is-home {
    margin-left: 360px; /* offset for home left panel */
  }
}

.footer-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
  max-width: 1200px;
  margin: 0 auto;
}

.brand {
  font-family: var(--font-serif, serif);
  font-size: 18px;
  font-weight: bold;
  color: var(--c-text-main, #111);
}

.links {
  display: flex;
  gap: 24px;
}

.links a {
  color: inherit;
  text-decoration: none;
  text-transform: uppercase;
  letter-spacing: 1px;
  transition: color 0.2s;
}

.links a:hover {
  color: #0077FF;
}

@media (max-width: 768px) {
  .site-footer {
    padding: 24px;
  }
  .footer-content {
    flex-direction: column;
    gap: 16px;
    text-align: center;
  }
}
</style>
