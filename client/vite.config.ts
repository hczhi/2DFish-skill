import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
      '/uploads': 'http://localhost:3001',
      // 对外接入 SDK 的产物（sdk/dist）由 Node 发，dev server 自己没有这个目录。
      // 不代理的话请求落到 SPA fallback，回的是我们自己那张 **404 页面**（HTTP 200 + HTML）
      // —— 后台「接入代码」里那行 `<script src="{location.origin}/sdk/ppt-sdk.umd.cjs">`
      // 在 5173 上就变成「加载了一个 HTML」，控制台只有一句 `PptSDK is not defined`，
      // 读起来像 SDK 没构建出来。
      '/sdk': 'http://localhost:3001'
    }
  }
})
