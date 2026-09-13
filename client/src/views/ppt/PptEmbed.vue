<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  markEmbedMode, requestEmbedToken, startEmbedHeightReporter, reportEmbedError, embedToken,
  embedTokenError,
} from '../../lib/embed'

// 嵌入模式的引导页（100）：iframe 的 src 指到这里。它自己不画工作台，只做三件事 ——
// 记下宿主 Origin、向宿主要一把短 token、然后跳到 `next`（默认演示稿列表）。之后的页面
// 就是我们自己那套 /ppt/*，一份 UI 不做第二遍（两份必然漂）。
//
// 写法和 `consult/ConsultEmbed.vue` 逐条相同，两处差别：模块名传 'ppt'（消息通道因此是
// `qn-ppt`，见 lib/embed.ts 的头注）、以及 `next` 的白名单是 /ppt 那几条。
//
// 失败必须在这块空白上写出来：拿不到 token 的时候 iframe 里是一片白，宿主那边看到的是
// 「你们的东西没加载出来」，而真正的原因（宿主没接 postMessage / pk 换 token 被拒 /
// 域名白名单没配）解法完全不同。同一句话还要 postMessage 回宿主（onError）。

// 能落到的页面**逐条列**，不放行整个 /ppt：`/ppt/layouts` 上那个停用开关是**账号级**的
// （scope 里就挡着，见 auth/scopeGuard.ts），但它是可以看的参考页，所以在名单里；
// 而 /admin/* 之类绝不能进来 —— 不校验的话宿主传什么路径这个 iframe 就打开什么，
// 而外面看起来还是「你们的工作台」。
const NEXT_OK = /^\/ppt\/(decks(\/|$)|assets$|layouts$)/

const route = useRoute()
const router = useRouter()
const error = ref('')

onMounted(async () => {
  const host = String(route.query.host || '')
  const next = String(route.query.next || '/ppt/decks')

  if (!host) {
    error.value =
      '缺少 host 参数：iframe 的地址要带上宿主页面的 Origin（SDK 的 mountPpt 会自动加）。' +
      '没有它我们不知道该把凭证请求发给谁。'
    return
  }
  // next 必须是我们自己的 /ppt 路径：不校验的话宿主传一个 //evil.com 进来，
  // 这个 iframe 会把用户带到别人的站上，而外面看起来还是「你们的工作台」。
  if (!NEXT_OK.test(next)) {
    error.value = `next 参数只能是 /ppt/decks、/ppt/assets、/ppt/layouts 下的路径，收到的是：${next}`
    return
  }

  markEmbedMode('ppt', host)
  startEmbedHeightReporter()

  const token = await requestEmbedToken()
  if (!token || !embedToken()) {
    // 宿主把服务端那句原文递过来了就直接显示它 —— 泛泛那三条只是它没回应时的兜底。
    const why = embedTokenError()
    error.value = why
      ? `没有拿到访问凭证：${why}`
      : '没有从宿主页面拿到访问凭证。三种可能：① 宿主页面没有回应凭证请求（SDK 版本太老或没挂 message 监听）；' +
        '② pk 换取 token 被拒（域名白名单里没有这个域名，或者 key 已停用）；③ 换取太频繁被限流。' +
        '具体原因在宿主页面的控制台里。'
    reportEmbedError(error.value)
    return
  }

  router.replace(next)
})
</script>

<template>
  <div class="embed-boot">
    <p v-if="!error" class="loading">正在载入展示稿工作台…</p>
    <div v-else class="err">
      <h2>工作台没能载入</h2>
      <p>{{ error }}</p>
    </div>
  </div>
</template>

<style scoped>
.embed-boot { padding: 40px 24px; font-size: 14px; color: var(--text-secondary); }
.loading { color: var(--text-muted); }
.err { max-width: 620px; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 16px 18px; color: #b91c1c; }
.err h2 { font-size: 16px; margin-bottom: 8px; }
</style>
