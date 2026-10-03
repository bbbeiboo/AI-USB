// 统一的 className 合并工具。
//
// 说明：shadcn 新版 registry 直接依赖官方发布的 npm 包 "cn"
// （仓库 github.com/shadcn-ui/cn，是 clsx + tailwind-merge 的编译版替代品），
// 生成的组件里写的是 `import { cn } from "cn"`，因此不再需要手写 clsx+tailwind-merge 实现。
// 这里再导出一层，保证 `@/lib/utils` 这个约定路径始终可用：
// 后续自己写的组件统一从这里 import，将来若更换实现只需改这一处。
export { cn } from 'cn'
