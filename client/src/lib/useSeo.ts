import { onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'

interface SeoPage {
  title: string
  description: string
  keywords: string
  og_title: string
  og_description: string
  og_image: string
}

interface SeoResponse {
  page: SeoPage | null
  globals: Record<string, string>
}

let cache: Record<string, SeoResponse> = {}

export function useSeo() {
  const route = useRoute()

  async function applySeo(path: string) {
    if (!cache[path]) {
      try {
        const res = await fetch(`/api/seo/page?path=${encodeURIComponent(path)}`)
        if (res.ok) cache[path] = await res.json()
      } catch { return }
    }

    const data = cache[path]
    if (!data?.page) return

    document.title = data.page.title || `${data.globals.site_name || 'QiaoNan'}`

    setMeta('description', data.page.description)
    setMeta('keywords', data.page.keywords)
    setMetaProperty('og:title', data.page.og_title || data.page.title)
    setMetaProperty('og:description', data.page.og_description || data.page.description)
    if (data.page.og_image) setMetaProperty('og:image', data.page.og_image)
  }

  onMounted(() => applySeo(route.path))
  watch(() => route.path, (newPath) => applySeo(newPath))
}

function setMeta(name: string, content: string) {
  if (!content) return
  let el = document.querySelector(`meta[name="${name}"]`)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute('name', name)
    document.head.appendChild(el)
  }
  el.setAttribute('content', content)
}

function setMetaProperty(property: string, content: string) {
  if (!content) return
  let el = document.querySelector(`meta[property="${property}"]`)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute('property', property)
    document.head.appendChild(el)
  }
  el.setAttribute('content', content)
}
