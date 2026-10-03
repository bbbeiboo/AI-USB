// Vite 构建配置 —— 由 Launcher/App/package.json 的 dev:web / build:web 脚本调用。
// 注意：本文件位于 renderer/ 下，但所有依赖与 node_modules 都在上一级 App/，
//       因此 renderer/ 内【不放 package.json】，保证全项目只有一份 package.json。
//
// 为什么文件名是 .mts 而不是 .ts：
//   Launcher/App/package.json 是 CommonJS（main.js 需要 CJS），renderer/ 下又没有 package.json，
//   若用 .ts，Vite 会按 CJS 上下文加载本文件，其中的 ESM import 语法会被判定为
//   "future native loader 不支持"并打印 configLoader 告警；改用 .mts 即按原生 ESM 加载，告警消除。
//   同理把 __dirname 换成 import.meta.dirname（native loader 不支持 __dirname）。
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite'; // Tailwind v4 官方 Vite 插件（不需要 postcss 配置文件）
import path from 'path'; // Node 内置模块：拼接 outDir / alias 绝对路径

export default defineConfig({
  // React 插件：JSX 转换 + 开发期 Fast Refresh
  // Tailwind v4 插件：直接接管 CSS 处理与按需生成原子类（内部用 Lightning CSS，自带前缀处理）
  plugins: [react(), tailwindcss()],

  // 路径别名：'@/xxx' 指向 renderer/src/xxx
  // 需与 tsconfig.app.json 的 paths 保持一致，否则编辑器与构建行为不一致
  resolve: {
    alias: {
      '@': path.join(import.meta.dirname, 'src'),
    },
  },

  // base 必须是相对路径 './'：Electron 生产环境用 file:// 协议加载
  // renderer/dist/index.html，若用默认的 '/' 会去请求磁盘根目录（file:///assets/...），
  // 结果就是白屏。这一条是 Electron 打包场景的关键。
  base: './',

  // 站点根目录 = 本配置文件所在目录（即 renderer/，index.html 就在这一层）
  root: import.meta.dirname,

  build: {
    // 产物输出到 renderer/dist —— main.js 的生产分支正是 loadFile 到这里
    outDir: path.join(import.meta.dirname, 'dist'),
    // 每次构建先清空 dist，避免上一版残留文件混进 asar
    emptyOutDir: true,
  },

  server: {
    // 固定 5173 且 strictPort：端口被占用时直接报错而不是悄悄换端口，
    // 因为 main.js 的开发分支硬编码了 http://localhost:5173
    port: 5173,
    strictPort: true,
  },
});
