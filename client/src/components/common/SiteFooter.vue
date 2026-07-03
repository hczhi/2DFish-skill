<template>
  <footer class="site-footer" :class="{ 'is-home': isHome }">
    <div class="footer-content">
      <div class="brand">QiaoNan.</div>
      <div class="copyright">
        &copy; {{ new Date().getFullYear() }} mmPla Team. All rights reserved.
      </div>
      <div class="links">
        <!-- <a href="#">Privacy</a>
        <a href="#">Terms</a> -->
      </div>
    </div>
  </footer>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const isHome = computed(() => route.path === '/')
</script>

<style scoped>
.site-footer {
  border-top: 1px solid var(--c-grid, rgba(0, 160, 255, 0.15));
  background: #ffffff;
  padding: 32px 40px;
  font-family: var(--font-mono, monospace);
  font-size: 12px;
  color: var(--c-text-sub, #555);
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
