// 渲染层入口：把 React 根组件挂载到 index.html 的 #root 上
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'   // 全局样式
import App from './App.tsx'

// StrictMode 只在开发期生效：帮助发现副作用问题，不影响生产构建
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
