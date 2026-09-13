import { defineConfig } from 'vite';
import { resolve } from 'path';

// 展示稿嵌入 SDK 的第三次 lib 构建（100）：
//   - dist/ppt-sdk.js       ESM
//   - dist/ppt-sdk.umd.cjs  UMD，<script> 引入后用 window.PptSDK
//
// 单独一份配置而不是多入口：UMD 不支持多入口（Vite 会直接报错），而 <script> 引入是纯前端
// 接入方最常用的一种。
//
// **`emptyOutDir: false` 是承重的**：默认会清 dist，于是这一次构建把前两次的 tender-sdk.*
// 和 consult-sdk.* 抹掉，而三次构建都打印成功 —— 线上那些 <script src="…"> 从此 404。
export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/ppt.ts'),
      name: 'PptSDK',
      fileName: 'ppt-sdk',
      formats: ['es', 'umd'],
    },
    sourcemap: true,
    emptyOutDir: false,
  },
});
