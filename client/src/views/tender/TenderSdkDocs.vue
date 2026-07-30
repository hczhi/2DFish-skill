<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import SiteHeader from '../../components/common/SiteHeader.vue'
import SiteFooter from '../../components/common/SiteFooter.vue'
import TenderSdkGuide from '../../components/tender/TenderSdkGuide.vue'

const route = useRoute()
const router = useRouter()
const locale = computed(() => route.path.startsWith('/en/') ? 'en' : 'zh')
const t = (zh: string, en: string) => (locale.value === 'en' ? en : zh)

function goBack() {
  router.push(locale.value === 'en' ? '/en/tender' : '/tender')
}
</script>

<template>
  <div>
    <SiteHeader />
    <main class="sdk-docs">
      <div class="docs-container">
        <button class="back-link" @click="goBack">← {{ t('返回标讯推荐', 'Back to Tenders') }}</button>

        <h1>{{ t('标讯智能推荐 · 前端 SDK', 'Tender Recommendation · Frontend SDK') }}</h1>

        <TenderSdkGuide />
      </div>
    </main>
    <SiteFooter />
  </div>
</template>

<style scoped>
.sdk-docs { min-height: 70vh; padding: 32px 16px 64px; background: #f8fafc; }
.docs-container { max-width: 860px; margin: 0 auto; }
.back-link { background: none; border: none; color: #2563eb; cursor: pointer; font-size: 14px; padding: 0; margin-bottom: 16px; }
h1 { font-size: 26px; margin: 0 0 8px; color: #0f172a; }
</style>
