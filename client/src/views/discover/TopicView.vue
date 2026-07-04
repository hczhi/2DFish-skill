<template>
  <div class="topic-page">
    <SiteHeader />

    <main class="topic-scroll">
      <div class="topic-two-col">
        <section class="topic-shell">
          <div v-if="loading" class="state-card loading">
            <p>{{ locale === 'en' ? 'Loading topic...' : '专题加载中...' }}</p>
          </div>

          <div v-else-if="!topic" class="state-card not-found">
            <h1>{{ locale === 'en' ? 'Topic Not Found' : '专题未找到' }}</h1>
            <p>{{ locale === 'en' ? 'The topic may have been removed or is temporarily unavailable.' : '该专题可能已下线，或暂时无法访问。' }}</p>
            <router-link :to="locale === 'en' ? '/en' : '/'" class="back-link">
              {{ locale === 'en' ? 'Back to Home' : '返回首页' }}
            </router-link>
          </div>

          <component
            v-else
            :is="templateComponent"
            :topic="topic"
            :articles="topic.articles"
            :locale="locale"
          />
        </section>

        <aside class="topic-sidebar">
          <div class="sidebar-sticky">
            <AdSlot position="sidebar" />
          </div>
        </aside>
      </div>

      <SiteFooter />
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, defineAsyncComponent, shallowRef } from 'vue'
import { useRoute } from 'vue-router'
import SiteHeader from '../../components/common/SiteHeader.vue'
import SiteFooter from '../../components/common/SiteFooter.vue'
import AdSlot from '../../components/common/AdSlot.vue'
import DefaultTopic from './topics/DefaultTopic.vue'

interface TopicArticle {
  slug: string
  icon: string
  bg_color: string
  avatar_color: string
  author: string
  title: string
  summary: string
}

interface TopicData {
  id: string
  slug: string
  cover_image: string
  icon: string
  bg_color: string
  template: string
  title: string
  description: string
  seo_title: string
  seo_description: string
  articles: TopicArticle[]
}

const route = useRoute()
const topic = ref<TopicData | null>(null)
const loading = ref(true)

const locale = computed(() => route.path.startsWith('/en') ? 'en' : 'zh')
const slug = computed(() => route.params.slug as string)

const templateModules: Record<string, ReturnType<typeof defineAsyncComponent>> = {
  default: DefaultTopic as any,
}

const templateComponent = shallowRef<any>(DefaultTopic)

async function loadTopic() {
  loading.value = true
  try {
    const res = await fetch(`/api/discover/topics/${slug.value}?locale=${locale.value}`)
    if (res.ok) {
      topic.value = await res.json()
      resolveTemplate(topic.value!.template || 'default')
      if (topic.value?.seo_title || topic.value?.title) {
        document.title = topic.value.seo_title || topic.value.title
      }
    } else {
      topic.value = null
    }
  } catch {
    topic.value = null
  } finally {
    loading.value = false
  }
}

function resolveTemplate(name: string) {
  if (templateModules[name]) {
    templateComponent.value = templateModules[name]
  } else {
    templateComponent.value = defineAsyncComponent({
      loader: () => import(`./topics/${name}.vue`),
      errorComponent: DefaultTopic as any,
    })
  }
}

watch(() => route.fullPath, loadTopic)
onMounted(loadTopic)
</script>

<style scoped>
.topic-page {
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  background-color: #fafafa;
  background-image:
    linear-gradient(rgba(59, 91, 219, 0.04) 1px, transparent 1px),
    linear-gradient(90deg, rgba(59, 91, 219, 0.04) 1px, transparent 1px);
  background-size: 40px 40px;
}

.topic-scroll {
  flex: 1;
  padding-top: 50px;
}

.topic-two-col {
  display: flex;
  gap: 32px;
  width: 1200px;
  max-width: calc(100% - 48px);
  margin: 0 auto;
  padding: 32px 0 80px;
}

.topic-shell {
  flex: 1;
  min-width: 0;
}

.topic-sidebar {
  width: 300px;
  flex-shrink: 0;
  align-self: flex-start;
  position: sticky;
  top: 100px;
}

.sidebar-sticky {
  position: relative;
}

@media (max-width: 960px) {
  .topic-two-col {
    flex-direction: column;
  }
  .topic-sidebar {
    width: 100%;
    position: static;
  }
}

.state-card {
  padding: 56px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.88);
  box-shadow: 0 24px 48px rgba(15, 23, 42, 0.06), 0 4px 12px rgba(15, 23, 42, 0.03);
  backdrop-filter: blur(18px);
  text-align: center;
}

.loading p,
.not-found p {
  color: #6b7280;
  font-size: 15px;
  line-height: 1.7;
}

.not-found h1 {
  font-size: 36px;
  line-height: 1.1;
  letter-spacing: -0.04em;
  font-family: var(--font-sans, sans-serif);
  font-weight: 700;
  margin: 0 0 12px;
  color: #111827;
}

.back-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-top: 24px;
  padding: 12px 18px;
  border-radius: 999px;
  background: #3b5bdb;
  color: #fff;
  text-decoration: none;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.02em;
  transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.3s cubic-bezier(0.16, 1, 0.3, 1), background 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

.back-link:hover {
  transform: translateY(-2px);
  background: #2b45a8;
  box-shadow: 0 12px 28px rgba(59, 91, 219, 0.28);
}

@media (max-width: 768px) {
  .topic-two-col {
    max-width: calc(100% - 32px);
    padding: 20px 0 56px;
  }

  .state-card {
    padding: 32px 24px;
  }

  .not-found h1 {
    font-size: 28px;
  }
}
</style>
