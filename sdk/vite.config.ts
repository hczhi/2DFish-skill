import { defineConfig } from 'vite';
import { resolve } from 'path';

// 打包成 ESM + UMD 两种产物：
//   - dist/tender-sdk.js       ESM，供 import 使用
//   - dist/tender-sdk.umd.cjs  UMD，<script> 直接引入后用 window.TenderSDK
// widget 通过动态 import 分包，只用数据 SDK 时不会加载 UI 代码。
export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'TenderSDK',
      fileName: 'tender-sdk',
      formats: ['es', 'umd'],
    },
    sourcemap: true,
    emptyOutDir: true,
  },
});
