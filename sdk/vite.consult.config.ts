import { defineConfig } from 'vite';
import { resolve } from 'path';

// 品牌咨询嵌入 SDK 的第二次 lib 构建（084）：
//   - dist/consult-sdk.js       ESM
//   - dist/consult-sdk.umd.cjs  UMD，<script> 引入后用 window.ConsultSDK
//
// 单独一份配置而不是多入口：UMD 不支持多入口（Vite 会直接报错），而 <script> 引入是纯前端
// 接入方最常用的一种。
//
// **`emptyOutDir: false` 是承重的**：默认会清 dist，于是这一次构建把上一次的 tender-sdk.*
// 抹掉，而两次构建都打印成功 —— 线上那些 <script src=".../tender-sdk.umd.cjs"> 从此 404。
export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/consult.ts'),
      name: 'ConsultSDK',
      fileName: 'consult-sdk',
      formats: ['es', 'umd'],
    },
    sourcemap: true,
    emptyOutDir: false,
  },
});
