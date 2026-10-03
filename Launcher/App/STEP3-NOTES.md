# 第 3 步（3.1）变更说明

> 背景：`package.json` 是 JSON，不支持注释语法，故把改动理由与命名约定记录在此文件，
> 以满足"所有代码包含中文注释"的约束。本文件不在 electron-builder 的 `files` 白名单内，不会进入 asar。

## 一、scripts 改名对照（3.1）

| 脚本 | 命令 | 说明 |
| --- | --- | --- |
| `start` | `electron .` | 保留原有启动方式（回退路径，3.7 验收 2 依赖它） |
| `dev` | `concurrently "npm run dev:web" "electron ."` | 并行拉起 Vite(5173) 与 Electron 窗口 |
| `dev:web` | `vite --config renderer/vite.config.mts` | 只起前端开发服务器（3.4.1 改名） |
| `build:web` | `vite build --config renderer/vite.config.mts` | 产物输出到 `renderer/dist`（3.4.1 改名） |
| `build:app` | `electron-builder --win portable` | 原 `build` 改名而来，避免与前端构建撞名 |
| `build` | `npm run build:web && npm run build:app` | 先构建前端，再打包，顺序不可颠倒 |
| `test` | `node --test tests/*.test.js` | 按任务书 3.1 保留；注意 36 个用例实际位于**仓库根** `tests/`，app 目录下暂无 `tests/`，此脚本在 app 目录执行会报文件不存在 |

### 为什么 `dev` 不显式传 NODE_ENV
`main.js` 的开发判定为 `process.env.NODE_ENV === 'development' || !app.isPackaged`。
`electron .` 是未打包运行，`app.isPackaged === false`，因此天然进入开发分支，无需额外设环境变量，
避免 Windows 下 `cross-env` 这类额外依赖。

## 二、devDependencies 新增
- `concurrently@^9.2.4`：选 9.x 而非 10.x，因为 10.x 的 `engines.node` 为 `>=22`，
  而仓库根 `package.json` 声明 `engines.node >= 18`，9.x 兼容面更宽。
- `better-sqlite3@13.0.3` 无 `install`/`postinstall` 脚本，`npm install` 不会触发 node-gyp 编译，
  `prebuilds/*.node` 预编译产物保持原样（约束：免编译）。

## 三、build.files 白名单补齐（3.1 一并修复）
补齐前只有 6 项，缺失 `main.js` 实际 `require` 的 3 个模块，打包后必然 `MODULE_NOT_FOUND`：

```javascript
// main.js 内的本地依赖（第 14~17 行、第 1017~1019 行）
const { UsageStore } = require('./usage.js');
const { UsageProxy } = require('./usage-proxy.js');
const pm = require('./agent-process-manager.js');
const { readJsonSafe, stripBom } = require('./json-util.js');   // ← 补齐前缺失
const auth = require('./auth-service.js');                       // ← 补齐前缺失
const { registerAuthIpc } = require('./ipc-auth.js');            // ← 补齐前缺失
```

同时加入 `renderer/dist/**/*`：3.4 生产分支要 `loadFile(renderer/dist/index.html)`，
不加入白名单则打包产物没有前端页面。（`build:web` 尚未执行时该 glob 命中 0 个文件，
electron-builder 仅告警不报错。）

## 四、回退方式
原文件已备份为 `package.json.bak-3.1`，回退只需覆盖回去。

## 五、【重要环境坑】ELECTRON_RUN_AS_NODE=1 由 DSH 宿主注入

**实测事实（2026-10-03）**：在 DSH 的 pwsh 工具里执行命令时，进程环境都带 `ELECTRON_RUN_AS_NODE=1`。

- `[System.Environment]::GetEnvironmentVariable('ELECTRON_RUN_AS_NODE','Process')` = `1`；
  `User` / `Machine` 作用域为空，`HKCU\Environment` 里也没有 → 不是系统持久变量。
- 父进程链：`powershell.exe` ← `"D:\DeepSeek Harness\DeepSeek Harness.exe"`（命令行含 `resources/app.asar/dsh`）← 另一个 Harness 进程 ← `explorer.exe`。
- 在 pwsh 里 `Remove-Item Env:ELECTRON_RUN_AS_NODE` 后，**下一次 pwsh 调用它又回来了**；
  而随手设的探针变量不会跨调用保留 → 是宿主每次 spawn 时注入，不是上一条命令的污染。

**影响**：从这里直接跑 `electron .`、`electron . --selftest`、打包后的 `AI-Agent.exe --selftest`，
都会以 Node 模式运行而非拉起 GUI。实测报错 `AI-Agent.exe: bad option: --selftest`，退出码 9，无任何输出。
这会击穿 3.4 的「npm run dev 打开 Electron 窗口」与 3.7 验收 1/2。

**解法（已实测有效）**：
```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
# 另注：PowerShell 对 GUI 子系统程序用 & 启动不会等待，必须用 Start-Process -Wait
$p = Start-Process -FilePath "<electron.exe 或打包后 exe>" -ArgumentList '.','--selftest' -NoNewWindow -Wait -PassThru `
     -WorkingDirectory "<Launcher\App>" -RedirectStandardOutput out.log -RedirectStandardError err.log
Write-Output ("ExitCode=" + $p.ExitCode); Get-Content out.log
```

**3.4 落地时必须处理**：`dev` 脚本要显式清掉该变量，否则窗口永远开不出来。

## 六、【重要环境坑】electron-builder 在"unpacking default Electron distribution"处僵死

**现象**：`npm run build:app -- --dir` 卡在该日志行不动，两次复现。诊断结果：
- 进程对 `objects.githubusercontent.com` 有一条 Established 连接，但 Win32_Process 的
  `ReadTransferCount` / `WriteTransferCount` 在 10 秒内增量均为 **0**（僵死，非慢速）。
- `%LOCALAPPDATA%\electron\Cache` 里没有 `electron-v44.4.4-*.zip`（只有别的项目留下的 v31.7.7）。
- 设 `ELECTRON_MIRROR` 为 npmmirror 后仍然僵死，且连 HTTP 请求都没发出。
- 最终该连接以 `Timeout awaiting 'request' for 600000ms` 失败（正好 10 分钟）。

**解法（已实测成功）**：加 `--config.electronDist=node_modules/electron/dist` 走本地 dist（367MB，`electron.exe` 存在），
彻底跳过下载判定；同时保留 `ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/`
（winCodeSign 等小资源走镜像，实测 <400ms）。

```powershell
$env:ELECTRON_BUILDER_BINARIES_MIRROR='https://npmmirror.com/mirrors/electron-builder-binaries/'
npm run build:app -- --dir --config.electronDist=node_modules/electron/dist
```

**注意**：`electron-builder --win portable --dir` 里的 `--dir` **不会**屏蔽配置中的 `portable` 目标，
实测它同时产出了 `win-unpacked\` 与便携版 `AI-Agent.exe`。后续若要严格只出目录，需显式覆盖 target。

## 七、3.1 实跑验证结果

| 闸门 | 命令 | 结果 |
| --- | --- | --- |
| 语法 | `node --check` × 8 个后端 js | 8/8 OK |
| 单测 | `node --test tests/*.test.js`（仓库根） | **36 tests / 36 pass / 0 fail**，19.6s |
| 自检（源头） | `electron . --selftest` | ExitCode=0，**4/4 READY** |
| 自检（打包后） | `win-unpacked\AI-Agent.exe --selftest` | ExitCode=0，**4/4 READY** |
| 打包 | `npm run build:app -- --dir --config.electronDist=...` | EXIT=0，产出 `win-unpacked` + `AI-Agent.exe`(108MB) |
| **约束 4** | asar 内 better-sqlite3 prebuilds | ✅ `app.asar.unpacked\node_modules\better-sqlite3\prebuilds\win32-x64.node` = 1,989,632 字节（本次构建 16:39:41） |
| 原生模块端到端 | 用 Electron 运行时从 `app.asar` 里 `require('better-sqlite3')` | ✅ 建表/写入/查询成功，SQLite 3.53.4 |
| 前端构建 | `npm run build:web` | ⛔ 预期失败：`'vite' is not recognized`（vite 属 3.2/3.3，本步尚未安装） |

`build:web` 的失败是**预期的、由任务顺序决定**：3.1 先改脚本，3.2/3.3 才创建 renderer 与 vite 配置。
8 个原生 .node 全部走 `app.asar.unpacked`（日志：`not packed into asar archive ... reason=contains executable code`）。


## 八、3.2 + 3.3 变更记录

### 8.1 create-vite 版本与模板
`npm create vite@latest renderer -- --template react-ts` 拉到的是 **create-vite 9.2.1**，模板内容与任务书假设的旧版不同：
React **19.2.8** / Vite **8.3.0** / @vitejs/plugin-react **6.1.1** / TypeScript **~6.0.2**，
且新版模板已用 **oxlint** 取代 eslint（生成 `.oxlintrc.json` 而非 `eslint.config.js`）。

### 8.2 删除计划（先落盘，后执行）
为满足"避免多 package.json"，以下由脚手架生成的文件在本步被删除，理由逐条如下：

| 待删除文件 | 理由 |
| --- | --- |
| `renderer/package.json` | 依赖已合并进 `Launcher/App/package.json` 的 devDependencies；保留会产生第二份 package.json，且会让 renderer/ 下的模块解析绕开 App/node_modules |
| `renderer/README.md` | create-vite 的通用模板说明，与本项目无关 |
| `renderer/.oxlintrc.json` | 本步未引入 oxlint（任务书未要求 lint），对应依赖不安装，配置文件留着会误导 |

**不删除**：`renderer/.gitignore`（继续忽略 renderer/dist）、`renderer/public/*`、`renderer/src/*`（3.6 会重写 App.tsx）。

### 8.3 依赖归属决策
前端依赖全部放 **devDependencies**（而非 template 默认的 dependencies）：
`react`、`react-dom`、`vite`、`@vitejs/plugin-react`、`typescript`、`@types/node`、`@types/react`、`@types/react-dom`、
以及新增的 `cross-env`。
理由：渲染层已被 Vite 打包成自包含的 `renderer/dist`，运行时不需要 node_modules 里的 react；
放 devDependencies 可让 electron-builder 把它们排除在 asar 之外，显著减小包体。

### 8.4 其他配套改动
- `renderer/tsconfig.app.json` / `tsconfig.node.json`：`tsBuildInfoFile` 从 `./node_modules/.tmp/...` 改为 `../node_modules/.tmp/...`，
  否则 tsc 会在 renderer/ 下新建一个 node_modules；并把 `module` 从 `nodenext` 改为 `esnext` + `moduleResolution: bundler`
  （3.4.1 起配置文件名已改为 `vite.config.mts`，按原生 ESM 加载）。
- `renderer/index.html`：`lang` 改 `zh-CN`，标题改「AI Agent 启动器」。
- `scripts/dev-launcher.ps1`（新增）：统一启动入口，清 `ELECTRON_RUN_AS_NODE` + 用 `Start-Process -Wait` 采集输出。
  npm 脚本 `launch` / `selftest` / `dev:electron` 都走它。
- `build:app` 固化 `ELECTRON_BUILDER_BINARIES_MIRROR`（用 `cross-env` 跨平台传递）；
  `build.electronDist = "node_modules/electron/dist"` 写进 package.json 的 build 字段，不再靠命令行传参。
- `dev` 脚本：按批准方案改为 `concurrently "npm run dev:web" "npm run dev:electron"`。

### 8.5 【已完成】窗口尺寸方案（3.4.2 执行）
现 `main.js` 窗口为 `width:720, height:560, resizable:false`（三栏布局塞不下）。3.4 改为：
`width: 1280, height: 800, resizable: true, minWidth: 960, minHeight: 600`。

### 8.6 【已完成】isDev 判定修正（3.4.2 执行）
```javascript
const forceProd = process.env.NODE_ENV === 'production';
const isDev = !forceProd && (process.env.NODE_ENV === 'development' || !app.isPackaged);
```
原式 `NODE_ENV==='development' || !app.isPackaged` 在未打包时恒为 true，与 3.7 验收 2 冲突。
最终落地写法（与上式逻辑等价，仅调整了 `||` 两侧顺序以便阅读）：
```javascript
const isDev = !forceProd && (!app.isPackaged || process.env.NODE_ENV === 'development');
```

### 8.7 【已解决】Vite 配置加载器警告 —— 采用方案 A（改 .mts）
`npm run build:web` / `dev:web` 会打印：
```
(!) Your Vite config uses features that are unsupported by configLoader: 'native',
    which is planned to become the default in a future major version of Vite:
  - ESM syntax in a file loaded as CommonJS (renderer/vite.config.ts:4:1).
    Use a `.mjs` extension or set "type": "module" in the closest package.json
```
**成因**：renderer/ 下没有 package.json（按"避免多 package.json"删掉了），
于是最近的 package.json 是 Launcher/App/package.json，而它是 CommonJS
（因为 main.js 是 CJS，App 不能设 `"type": "module"`）。
Vite 便把 `vite.config.ts` 按 CJS 上下文打包，文件里的 ESM `import` 语法因此被标记。

**实测**：在配置里写 `configLoader: 'bundle'` **无效** —— 该选项在"加载配置之前"被读取，
写在配置文件内部管不到自己（已实测，警告照旧，故未保留该行）。当前 Vite 8 默认就是 bundle loader，功能完全正常。

**三种修法**：
| 方案 | 做法 | 代价 |
| --- | --- | --- |
| A（推荐） | 把文件改名 `renderer/vite.config.mts`，同步改两个 npm 脚本的 `--config` 路径与 `tsconfig.node.json` 的 include | 偏离任务书里写死的文件名 `vite.config.ts` |
| B | 新增 `renderer/package.json`，内容仅 `{"type":"module"}`（不含任何依赖） | 与"避免多 package.json"的要求冲突 |
| C | 保持现状，在脚本里设 `VITE_CONFIG_NATIVE_IGNORE_WARNING=true` 静音 | 只是消音，未解决根因；未来 Vite 大版本升级仍需处理 |

**→ 决策：采用方案 A，已于第 3.4 步执行并验证通过（见第九节）。**

### 8.8 3.2 + 3.3 实跑验证结果（全部通过）
| 闸门 | 命令 | 结果 |
| --- | --- | --- |
| 脚手架 | `npm create vite@latest renderer -- --template react-ts` | create-vite 9.2.1，非交互完成 |
| 依赖合并 | `npm install`（21 包） | vite 8.3.2 / react 19.3.0 / react-dom 19.3.0 / typescript 6.0.3 / @types/node 24.13.6 |
| **构建** | `npm run build:web` | **EXIT=0**，131ms，产出 `renderer/dist/index.html` + assets（js 222.58 kB / css 4.10 kB） |
| **相对路径** | 检查 dist/index.html | ✅ `./assets/index-*.js`、`./assets/index-*.css`、`./favicon.svg` 全为相对路径 |
| **dev server** | `npm run dev:web` + HTTP 探测 | ✅ `http://localhost:5173/` → **HTTP 200**；`/src/main.tsx` → HTTP 200（2180 字节） |
| 启动器 | `npm run selftest`（走 dev-launcher.ps1） | ✅ 自动清除 `ELECTRON_RUN_AS_NODE=1`，**4/4 READY**，退出码 0 |
| 打包 | `npm run build:app -- --dir` | ✅ EXIT=0，日志 `using custom unpacked Electron distribution electronDist=node_modules\electron\dist` |
| asar 内容 | 列举 app.asar | ✅ `renderer/dist/index.html` + 5 个 assets 已入包；顶层 9 个白名单 js 齐全 |
| 体积收益 | 检查 asar 是否混入前端依赖 | ✅ react/react-dom/vite/typescript/cross-env **均未入包**（devDependencies 正确排除） |
| 打包后回归 | `win-unpacked\AI-Agent.exe --selftest` | ✅ ExitCode=0，**4/4 READY** |
| 语法 | `node --check` × 8 个后端 js | ✅ 全通过 |
| 单测 | `node --test tests/*.test.js` | ✅ **36 tests / 36 pass / 0 fail** |
| 约束 4 | asar 内 better-sqlite3 prebuilds | ✅ 8 个 .node 仍全部登记并解包至 `app.asar.unpacked` |

### 8.9 【新环境坑】.ps1 脚本必须带 UTF-8 BOM
本机 `npm` 脚本调用的 `powershell` 是 **Windows PowerShell 5.1**，它读取**无 BOM 的 UTF-8** 文件时按
系统 ANSI 代码页（GBK）解码。中文注释会被撕成乱码字节，其中某个字节可能被当成引号，
**导致字符串提前闭合、整份脚本语法错误**。实测报错：
```
Array index expression is missing or not valid.
At dev-launcher.ps1:68 char:15
+ Write-Host ("[dev-launcher] 鍚姩锛歿0} {1}" -f $Electron, ...
```
**修法**：把文件重存为 **UTF-8 with BOM**：
```powershell
$c = Get-Content -LiteralPath $f -Raw -Encoding UTF8
[System.IO.File]::WriteAllText($f, $c, (New-Object System.Text.UTF8Encoding($true)))
```
加 BOM 后用 `[System.Management.Automation.Language.Parser]::ParseFile()` 复检为 `PARSE OK`。
**后续所有 .ps1 交付物都要带 BOM**（写入工具默认无 BOM，必须补这一步）。

### 8.10 【新环境坑】Vite 开发服务器只绑 IPv6 回环
实测 `Get-NetTCPConnection -LocalPort 5173 -State Listen` 显示 `LocalAddress = ::1`，
即 Vite 8 只监听 IPv6 回环。用 `http://127.0.0.1:5173` 探测会得到"无法连接到远程服务器"（假故障），
必须用 `http://localhost:5173` 或 `http://[::1]:5173`（两者实测均 HTTP 200）。
`dev-launcher.ps1` 的 5173 预检已据此从 `127.0.0.1` 改为 `localhost`。
`main.js` 的开发分支用的是 `http://localhost:5173`，不受影响。

## 九、3.4 变更记录：Electron 加载 Vite 产物

### 9.1 3.4.1 改名 vite.config.ts → vite.config.mts（方案 A）
| 引用位置 | 改前 | 改后 |
| --- | --- | --- |
| 文件本身 | `renderer/vite.config.ts` | `renderer/vite.config.mts` |
| `package.json` 的 `dev:web` | `vite --config renderer/vite.config.ts` | `vite --config renderer/vite.config.mts` |
| `package.json` 的 `build:web` | `vite build --config renderer/vite.config.ts` | `vite build --config renderer/vite.config.mts` |
| `renderer/tsconfig.node.json` | `"include": ["vite.config.ts"]` | `"include": ["vite.config.mts"]` |
| `main.js` / `scripts/dev-launcher.ps1` | 无引用 | 无需改动 |

改名后**并非一次到位**，Vite 又报出第二条警告，一并修掉才算真正解决：
1. 改名后 `ESM syntax in a file loaded as CommonJS` 警告消失；
2. 但出现新警告 `- __dirname (renderer/vite.config.mts:24:22). Use import.meta.dirname instead`
   （native loader 不支持 `__dirname`）；
3. 于是把 `path.resolve(__dirname)` 改为 `import.meta.dirname`、`outDir` 改为 `path.join(import.meta.dirname, 'dist')`。
4. 最终 `npm run build:web` **零警告**，且产物路径仍为 `renderer/dist` ——
   这反过来证明 `import.meta.dirname` 正确解析到了 `renderer/`（否则 root 会错、构建会失败）。

### 9.2 3.4.2 main.js 窗口创建逻辑
原来是无条件 `win.loadFile(path.join(APP_DIR, 'index.html'))`。现改为按分支解析（新增 `resolveLoadTarget()`，位于 main.js 第 1152~1167 行）：
```javascript
const forceProd = process.env.NODE_ENV === 'production';
const isDev = !forceProd && (!app.isPackaged || process.env.NODE_ENV === 'development');
if (isDev) return { dev: true, url: 'http://localhost:5173' };
const distIndex = path.join(APP_DIR, 'renderer', 'dist', 'index.html');
if (fs.existsSync(distIndex)) return { dev: false, file: distIndex, fallback: false };
return { dev: false, file: path.join(APP_DIR, 'index.html'), fallback: true };  // 回退旧原生 UI
```
与任务书片段的差异（按实际代码适配）：
- 变量名是 `win` 而非 `mainWindow`；
- 用常量 `APP_DIR`（= `__dirname`）而非直接写 `__dirname`；
- `loadFile` 与 `loadURL` 分支各补一条日志，另加 `openDevTools({ mode: 'detach' })` 仅在 dev 分支。

**窗口尺寸**（第 3 步 8.5 待办，已执行）：
`720×560, resizable:false` → `width:1280, height:800, minWidth:960, minHeight:600, resizable:true`。

**新增加载事件日志**（原代码没有，属实用诊断）：
`did-finish-load` / `did-fail-load` 各写一行到 `Launcher/Logs/launcher.log`，
渲染层白屏时可直接判断是"未加载完"还是"加载失败"。

### 9.3 3.4.3 实跑验证结果（全部通过）
验证手段：读 `Launcher/Logs/launcher.log` 中 main.js 自己写的 `Event=Window ...` 行（Electron 自报，最可靠）。

| 场景 | 命令 | 日志证据 | 结果 |
| --- | --- | --- | --- |
| **生产分支** | `dev-launcher.ps1 -Mode prod`（NODE_ENV=production） | `Window LoadFile file=...\renderer\dist\index.html fallback=false` + `DidFinishLoad url=file:///.../renderer/dist/index.html` | ✅ |
| **回退分支** | 临时移走 `renderer/dist` 后再跑 prod | `Window LoadFile file=...\App\index.html fallback=true` + `DidFinishLoad url=file:///.../App/index.html` | ✅（测完已恢复 dist） |
| **开发分支** | `npm run dev`（concurrently） | `Window LoadURL url=http://localhost:5173` + `DidFinishLoad url=http://localhost:5173/` | ✅ |
| **DevTools** | 同上 | 进程窗口标题出现 `Developer Tools - http://localhost:5173/` | ✅ |
| **窗口尺寸** | 同上 | `Window Bounds width=1281 height=801 resizable=true` | ✅（实测 1281×801，比设定值各多 1px，是 Windows 窗口边框/DPI 取整，非配置错误） |
| 构建 | `npm run build:web` | 过滤 `configLoader\|native\|ESM\|warning` 关键词**零命中** | ✅ EXIT=0 |
| 语法 | `node --check` × 8 | — | ✅ 8/8 |
| 自检 | `npm run selftest` | 自动清 `ELECTRON_RUN_AS_NODE=1`，4/4 READY | ✅ 退出码 0 |
| 单测 | `node --test tests/*.test.js` | 36 pass / 0 fail | ✅ |

**测试残留清理**：prod / 回退 / dev 三个窗口的 electron 进程与 vite 进程均已停止，5173 端口已释放，临时移走的 dist 已恢复。

## 十、第 3 步剩余待办
- 3.5 安装 Tailwind + shadcn/ui
- 3.6 三栏布局骨架（假数据，组件拆分）
- 3.7 保持旧启动流程可用（本步 3.4 已把回退逻辑做完并验证，3.7 主要做整体复核）

## 十一、3.5 + 3.6 变更记录：Tailwind v4 + shadcn/ui + 三栏布局

### 11.1 Tailwind 版本与配置方案（v4）
实际安装 **tailwindcss 4.3.3**（主版本 4）→ 采用 **v4 方案**：
- 入口：`renderer/src/index.css` 用 `@import "tailwindcss";`（**不生成 tailwind.config.js**，内容扫描自动进行）
- 主题：用 `@theme inline` 指令把 CSS 变量映射成 Tailwind 颜色工具类
- 接线：**`@tailwindcss/vite` 插件**（Q1 选 A），在 `vite.config.mts` 的 `plugins: [react(), tailwindcss()]`；
  因此**没有 postcss 配置文件**
- Q3 已卸载 v4 下多余的 `postcss` / `autoprefixer` / `@tailwindcss/postcss`
  （`node_modules/postcss` 仍在，但那是 **vite 自己的传递依赖**，package.json 里已不直接声明）
- 额外安装 **`tw-animate-css@1.4.0`**：v4 版的 tailwindcss-animate，
  提供 shadcn 组件用到的 `animate-in / fade-in-0 / zoom-in-95 / slide-in-from-top-2` 等类

### 11.2 shadcn/ui：CLI 在本项目布局下走不通（重要）
**实测结论**：`shadcn@2.10.0` 的 `init` 与 `add` **都要求"当前目录存在 package.json"**。
我们的布局是 package.json 在 `Launcher/App/`、而 tsconfig 与 src 在 `Launcher/App/renderer/`，
所以 CLI 直接拒绝并转为询问"是否新建 Next.js 项目"（首次执行零改动，已用 git status 核对）。

**采用的做法**：
1. 先按"避免多 package.json"的约束，**手写 `renderer/components.json`**（等价于 init 在 Tailwind v4 + slate + CSS variables 下会生成的内容）
2. 为了让 `add` 通过检查，**临时**在 renderer/ 放一个最小 `package.json`，并用 registry 拉取 6 个组件
3. 组件落盘到正确位置后，**删除临时 package.json 与其带出的 renderer/node_modules**，把新依赖合并进 `Launcher/App/package.json`
4. 复查：`Launcher/` 下**仍然只有一份 package.json**（已用文件枚举验证）

**安装的 6 个组件**（`renderer/src/components/ui/`）：
`button.tsx`(2382B) · `input.tsx`(952B) · `dropdown-menu.tsx`(8394B) · `scroll-area.tsx`(1629B) · `separator.tsx`(670B) · `avatar.tsx`(2906B)

### 11.3 与任务书预期不符的 3 处（新版 shadcn 已换代）
| 项 | 任务书预期 | 实际（shadcn 新版） | 处理 |
| --- | --- | --- | --- |
| Style | `Default` | Tailwind v4 下只有 `new-york` 一种风格 | components.json 用 `"style": "new-york"` |
| cn 工具 | 生成 `src/lib/utils.ts`（clsx + tailwind-merge） | 组件直接 `import { cn } from "cn"`，`cn` 是 **shadcn 官方发布的 npm 包**（repo `github.com/shadcn-ui/cn`，clsx+tailwind-merge 的编译替代品） | 两存：保留官方用法，**另外补一份 `src/lib/utils.ts` 做转发导出**（`export { cn } from 'cn'`），既满足验收"utils.ts 存在"，也给自写组件一个固定的 `@/lib/utils` 导入路径 |
| 主题 CSS | init 注入 `:root { --background: oklch(...) }` 大块 | 新 registry 改为 `@import "shadcn/tailwind.css"`，且该文件**只含工具类/变体/关键帧、不含任何颜色令牌** | 为让主题在本仓库内**可审计、零运行时依赖**，显式写全 classic v4 slate 主题块（`:root` / `.dark` / `@theme inline` / `@layer base`） |

**结论**：旧 CLI 的交互项（Style / Base color）与 `lib/utils.ts` 约定均已过时；
本次交付的等价物是 `components.json`（baseColor=slate、cssVariables=true）+ 显式主题块 + `@/lib/utils` 转发层。

### 11.4 三栏布局与组件清单（3.6.1 / 3.6.2）
```
renderer/src/
├── App.tsx                     三栏骨架 + 全部前端状态
├── data/mock-data.ts           假数据与共享类型（后续整体替换为真实数据源）
├── lib/utils.ts                cn 转发导出
└── components/
    ├── sidebar/  ConversationList.tsx · NewChatButton.tsx
    ├── topbar/   AgentSelector.tsx · ModelSelector.tsx · SettingsButton.tsx
    ├── chat/     MessageList.tsx · MessageBubble.tsx · ChatInput.tsx
    └── ui/       shadcn 的 6 个基础组件
```
- 布局：侧栏 `w-[260px] shrink-0` + 主区 `flex-1 min-w-0`；
  主区内部 `h-14` 顶栏 + `flex-1 min-h-0` 消息区 + `shrink-0` 输入区
- `SettingsButton` 用 `showLabel` 一个组件覆盖布局图里的 **⚙（顶栏图标）** 与 **[设置]（侧栏整行）** 两处入口
- `min-h-0` 是让内部 `overflow-y-auto` 真正生效的关键（flex 子项默认不收缩）

### 11.5 交互实测（3.6.3，全部前端状态，未连任何 IPC）
| 交互 | 验证方式 | 结果 |
| --- | --- | --- |
| Agent 下拉 | 浏览器真实点击 `#agent-selector` → 菜单出现 4 项且当前项标"当前" → 点 Hermes | ✅ 按钮文本 OpenClaw → Hermes，菜单关闭 |
| 模型下拉 | 点 `#model-selector` → 点 local-qwen | ✅ cloud-deepseek → local-qwen |
| 会话高亮 | 点第 3 条会话，读各条 `background-color`/`font-weight` | ✅ 高亮从第 1 条迁移到第 3 条（accent 底色 + 500 字重） |
| Enter 发送 | 输入文本后程序化点击 `#send-btn` | ✅ 消息数 2 → 4（user + assistant） |
| 模拟流式 | 发送后 0.7s 抓取末条 AI 消息 | ✅ 仅渲染出前 30 余字，逐字追加生效；结束后为完整文案、输入框已清空 |
| 窗口缩放 | 把根容器强制为 960px 后测元素边界 | ✅ 侧栏 260 + 主区 700 = 960，`main` 右边界未越界、输入框/发送键仍在主区内、消息区无横向滚动 |

**960×600 是否够用**：够用。侧栏固定 260px，主区最小 700px；顶栏 56px，剩余高度给消息区（可滚动）与输入区，
在 960×600 下不出现横向溢出。已在 3.4 把窗口下限设为 `minWidth: 960, minHeight: 600` 与之匹配。

### 11.6 3.5 + 3.6 验证结果（闸门表）
| 闸门 | 命令 | 结果 |
| --- | --- | --- |
| 语法 | `node --check` × 8 个后端 js | ✅ 8/8 |
| 构建 | `npm run build:web` | ✅ EXIT=0，2015 modules，CSS 33.05 kB / JS 356.69 kB，零警告 |
| 主题生效 | 浏览器读计算样式 | ✅ `--primary=oklch(0.208 0.042 265.755)`、按钮底色=primary、按钮文字=primary-foreground、输入框边框=`--border`、body 白底 + slate-950 文字 |
| 自检 | `npm run selftest` | ✅ 4/4 READY，退出码 0 |
| 单测 | `node --test tests/*.test.js` | ✅ 36 tests / 36 pass / 0 fail |
| 端到端 | `npm run dev` | ✅ Electron 日志 `Window LoadURL http://localhost:5173` + `DidFinishLoad` + `Bounds 1281×801 resizable=true` |
| 截图存证 | `browser-screenshots/step3-6-layout.png` | ✅ 1280×800，三栏布局与假数据渲染正常 |

### 11.7 本步删除的文件（均为 create-vite 脚手架遗留、已无任何引用）
| 文件 | 理由 |
| --- | --- |
| `renderer/package.json`（临时） | 仅为让 shadcn CLI 通过检查而建，用后即删，已把依赖合并进 App |
| `renderer/node_modules/`（临时） | 上者带出的安装产物 |
| `renderer/src/App.css` | create-vite 演示样式，3.6 重写 App.tsx 后无引用 |
| `renderer/src/assets/{hero.png,react.svg,vite.svg}` | 模板演示图片，重写后无引用（已 grep 确认零引用） |

### 11.8 【环境坑】Vite CSS 变化后 dev server 可能提供陈旧样式
实测：改完 `index.css`（新增 `tw-animate-css` 与主题块）后，**仍在运行的旧 dev server 向浏览器提供了不含主题变量的 CSS**
（表现为 `getComputedStyle(document.documentElement).getPropertyValue('--primary')` 为空、身体背景透明），
而**同一份代码 `vite build` 的产物是正确的**。重启 dev server 后一切正常。
**排查口诀**：主题/样式异常时，先把 dev server 重启一遍，再怀疑代码；并可用"构建产物里有没有该变量"来区分是代码问题还是服务陈旧。

---

## 十二、第3.7步：保持旧启动流程可用 + 整体复核 + 真打包验证

### 12.1 旧启动流程复核（3.7.1）

| 复核项 | 结果 |
| --- | --- |
| 旧 UI 入口文件 | ✅ `Launcher/App/index.html` 仍在，35,741 B，未被本次改动触碰 |
| 后端 8 个 js | ✅ main.js / preload.js / auth-service.js / ipc-auth.js / json-util.js / agent-process-manager.js / usage.js / usage-proxy.js 全部存在 |
| `resolveLoadTarget()` 三分支 | ✅ dev(5173) / prod(distIndex, fallback=false) / prod(dist 缺失 → 旧 index.html, fallback=true) |
| 两个生产分支都落日志 | ✅ `Event=Window LoadFile file=<f> fallback=<bool>` |
| preload IPC 暴露 | ✅ 共 41 个方法；其中 auth 5 个（register/login/verify/logout/status） |
| auth 初始化 | ✅ `auth.init({root, log})` + `registerAuthIpc({ipcMain, auth, log})`，包在 try/catch 内，失败只记日志不阻塞启动 |
| 打包白名单 | ✅ `build.files` 同时含 `index.html` 与 `renderer/dist/**/*`，两条分支打包后都可用 |

### 12.2 打包与 asar 内容核查（3.7.2 / 3.7.3）

- 命令：`npm run build:app -- --dir` → **EXIT=0**
- 产物：`Build/Release/Windows-x64/win-unpacked/`（AI-Agent.exe 245,956,608 B）、`app.asar` **2,697,596 B**、portable 单文件 `AI-Agent.exe` **108,517,940 B**
- asar 条目总数 **826**，顶层仅 11 项：
  `agent-process-manager.js / auth-service.js / index.html / ipc-auth.js / json-util.js / main.js / package.json / preload.js / renderer / usage.js / usage-proxy.js`
- `renderer/` 下只有 `dist/`：`index.html`(631 B) · `favicon.svg` · `icons.svg` · `assets/index-Bcf-m93q.css` · `assets/index-Dv0T4jAM.js`
  → 与 `npm run build:web` 重新产出的文件名**完全一致**，说明 asar 内的前端产物就是当前源码的构建结果

**✅ 应存在（全部命中）**

| 条目 | 结果 |
| --- | --- |
| `renderer/dist/index.html` + `assets/*.js` + `assets/*.css` | ✅ 1 js / 1 css |
| 9 个后端入口 js（含旧 `index.html`） | ✅ 10/10 |
| `node_modules/better-sqlite3` | ✅ 92 个文件 |
| `node_modules/bcryptjs` | ✅ 8 |
| `node_modules/jsonwebtoken` | ✅ 15 |
| `node_modules/electron-store` | ✅ 3 |
| `node_modules/tree-kill` | ✅ 4 |
| 传递依赖 | ✅ 共 **39** 个顶层包：ajv · ajv-formats · atomically · buffer-equal-constant-time · conf · debounce-fn · dot-prop · ecdsa-sig-formatter · env-paths · fast-deep-equal · fast-uri · json-schema-traverse · json-schema-typed · jwa · jws · lodash.includes/isboolean/isinteger/isnumber/isplainobject/isstring/once · mimic-function · ms · node-addon-api · require-from-string · safe-buffer · semver · stubborn-fs · stubborn-utils · tagged-tag · type-fest · uint8array-extras · when-exit |

**❌ 不应存在（全部确认不存在）**

`renderer/src` · `renderer/node_modules` · `node_modules/react` · `node_modules/react-dom` · `node_modules/vite` ·
`node_modules/typescript` · `node_modules/tailwindcss` · `node_modules/@tailwindcss` · `node_modules/cn` ·
`node_modules/radix-ui` · `node_modules/lucide-react` · `node_modules/tw-animate-css` ·
`node_modules/class-variance-authority` · `node_modules/@vitejs` · `node_modules/electron` · `node_modules/electron-builder` —— **16/16 全部 ABSENT**。

> **修正一条原本写错的验收清单**：最初的 3.7.3 清单把 `cn` / `radix-ui` / `lucide-react` / `tw-animate-css`
> 列为"asar 内应存在"，同时又要求"node_modules/react 不应存在"。这两条互相矛盾——React 与上述四者
> **都是 devDependencies**，会被 Vite 打包进 `renderer/dist/assets/*.js`，因此**都不应出现在 asar 里**。
> 判定标准即：asar 内只应有 `dependencies`（及其传递依赖）。

### 12.3 asar.unpacked 原生模块校验（3.7.4）

路径 `win-unpacked/resources/app.asar.unpacked/node_modules/better-sqlite3/prebuilds/`，共 **8** 个平台文件：

| 文件 | 字节 |
| --- | --- |
| darwin-arm64.node | 1,980,736 |
| darwin-x64.node | 1,982,880 |
| linux-arm64.node | 2,066,328 |
| linux-x64.node | 2,226,168 |
| linuxmusl-arm64.node | 2,312,112 |
| linuxmusl-x64.node | 2,435,680 |
| win32-arm64.node | 1,903,104 |
| **win32-x64.node** | **1,989,632** ✅ 与预期一致 |

unpacked 下除 better-sqlite3 外无其他目录，即没有把无关模块误外置。

### 12.4 打包产物自检（3.7.5）

`win-unpacked/AI-Agent.exe --selftest` → **EXIT=0**，`SELFTEST_JSON.ok=true`，4/4 **READY**
（OpenClaw 2026.9.5 / Hermes v0.21.4 / codex-cli 0.156.1 / claude-code portable-env）。
> 注：控制台回显里 `PORTABLE_ROOT` 一行出现乱码，是 PowerShell 以 GBK 读取子进程 UTF-8 重定向文件导致的**显示乱码**，
> 不是路径错误；同一路径在主进程日志与 UI 中均正常（非 ASCII 工作目录下的已知回显问题）。

**portable 单文件 `AI-Agent.exe` 的补充结论**：它同样能执行 `--selftest` 并以 **EXIT=0** 退出
（日志可见 `Event=Auth Ready` + `Event=AuthIpc Registered`，ROOT 也正确解析到 U 盘目录），
但 electron-builder 的 portable bootstrap **不转发子进程 stdout**，因此 `SELFTEST_JSON` 捕获不到，
包装进程的退出码也不等于内层进程的退出码。**要拿到可断言的自检输出，必须用 `win-unpacked/AI-Agent.exe`。**

### 12.5 产物启动 + 三栏布局（3.7.6）

两条路径都验证了：

1. **真打包产物** `win-unpacked/AI-Agent.exe`（`app.isPackaged=true`）：
```
Event=Window LoadFile file=...\resources\app.asar\renderer\dist\index.html fallback=false
Event=Window Bounds width=1281 height=801 resizable=true
Event=Window DidFinishLoad url=file:///E:/.../app.asar/renderer/dist/index.html
```
2. **源码树 prod 分支** `scripts/dev-launcher.ps1 -Mode prod`（`NODE_ENV=production`）：
```
Event=Window LoadFile file=...\Launcher\App\renderer\dist\index.html fallback=false
```

两种情况下 `Event=Auth Ready` 与 `Event=AuthIpc Registered channels=...` 均照常输出，说明打包后登录层仍然装配成功。
视觉存证：`browser-screenshots/step3-7-packaged-prod.png` —— 标题栏「AI Agent 启动器」、
左栏（新建会话 + 今天/昨天/更早分组 + 底部设置）、顶栏（Agent ▼ / 模型 ▼ / ⚙）、
消息区（用户右侧深色气泡 + AI 左侧浅色气泡）、底栏输入框「输入消息，Enter 发送，Shift+Enter 换行」+ 发送按钮，全部正常。

**窗口尺寸 1281×801 的解释（与 3.4 结论一致）**：`getBounds()` 返回的是 DIP。本机为 **150% 缩放**，
因此窗口物理表面是 1921×1201，DIP 即 1281×801 —— 属于 DPI 换算而非布局错误。

### 12.6 回退分支验证（3.7.7）

> 注意：`renderer/dist` 已打进 asar，**改磁盘上的 dist 不会影响已打包产物**。
> 因此回退分支必须用源码树 prod 模式验证（`app.isPackaged=false` + `NODE_ENV=production`），代码路径与打包后完全一致。

| 步骤 | 结果 |
| --- | --- |
| 基线 | `renderer/dist` 存在、`dist.bak` 不存在 |
| `Rename-Item renderer\dist → renderer\dist.bak` | ✅ dist_exists=False / bak_exists=True |
| `dev-launcher.ps1 -Mode prod` | `Event=Window LoadFile file=...\Launcher\App\index.html fallback=true` ✅ |
| 窗口标题 | `AI Agent U盘版`（旧页面的 `<title>`）→ 证明旧 HTML 真正解析并渲染 |
| `DidFinishLoad` | ✅ `file:///.../Launcher/App/index.html` |
| 视觉存证 | `browser-screenshots/step3-7-fallback-old-index.png`（旧版 Agent 聚合台完整可用） |
| **恢复** | ✅ `dist.bak → dist`，dist_exists=True / bak_exists=False / dist/index.html 存在 |

**结论**：新前端缺失时旧启动器可无缝顶上，两条 UI 路径互不破坏。

### 12.7 四闸门复跑（3.7.8）

| 闸门 | 命令 | 结果 |
| --- | --- | --- |
| 语法 | `node --check` × 8 个后端 js | ✅ 8/8 EXIT=0 |
| 构建 | `npm run build:web` | ✅ EXIT=0，2015 modules，CSS 33.05 kB / JS 356.69 kB，零警告 |
| 自检 | `npm run selftest` | ✅ 4/4 READY，退出码 0 |
| 单测 | `node --test tests/*.test.js` | ✅ 36 tests / 36 pass / 0 fail |

打包 → 重建 → 复跑闭环，三项历史指标（8/8、4/4、36/36）全部保持。

### 12.8 【环境坑合集】

#### 12.8.1 150% DPI 下截取 Electron 窗口会被裁剪

用 `GetWindowRect` + `PrintWindow` 抓窗口时，若不先声明进程 DPI 感知：
- 未感知的 PowerShell 拿到的是**虚拟化后的 DIP 矩形**（1281×801），
- 而 `PrintWindow` 实际写入的是**物理像素**，
- 结果只截到窗口左上角 1281×801 的物理区域（150% 下相当于裁剪掉右侧与底部各约 1/3），
  表现为"侧栏看起来有 390px 宽""底部输入框不见了"这类假故障。

**解决**：抓图前先 `[user32]::SetProcessDPIAware()`，再取矩形，得到的 1921×1201 才是完整窗口。
留存的工具脚本：`Build/Release/Windows-x64/_verify/capture-window.ps1`（第一个参数=输出 png，第二个参数=进程名）。

#### 12.8.2 【后续 CI 固定约定】自检断言入口必须是 `win-unpacked/AI-Agent.exe`

electron-builder 的 **portable 单文件**（`Build/Release/Windows-x64/AI-Agent.exe`）在启动时会先自解包、
再由 bootstrap 拉起内层进程，这条链路有两个不可控点：
1. **bootstrap 不转发内层进程的 stdout** —— 因此 `SELFTEST_JSON` 采集不到；
2. **bootstrap 的退出码 ≠ 内层进程的退出码** —— 实测无论内层结果如何都可能返回 0。

所以：**凡是需要断言 `SELFTEST_JSON` 的场景（CI、闸门、回归），一律用 `win-unpacked/AI-Agent.exe --selftest`**；
portable 单文件只做「能启动 + 日志出现 `Event=Auth Ready` / `Event=AuthIpc Registered`」这类弱断言。
另需注意：运行前必须清除 DSH 宿主注入的 `ELECTRON_RUN_AS_NODE`（见第五节），并用 `Start-Process -Wait` 采集退出码。

#### 12.8.3 selftest 控制台里 `PORTABLE_ROOT` 显示乱码是显示层问题（勿重复排查）

现象：`SELFTEST_JSON` 经 `Start-Process -RedirectStandardOutput` 写入临时文件后，
PowerShell 5.1 的 `Get-Content` 以系统 ANSI（中文机器=GBK）解码 UTF-8 内容，
于是 `E:\桌面\AI Agent 母盘` 显示成 `E:\妗岄潰\AI Agent 姣嶇洏` / `锟斤拷` 一类乱码。
**这是回显编码问题，不是路径错误、不是 selftest 失败**：同一时刻 `Launcher/Logs/launcher.log` 与 UI 中的路径均完全正常。
排查时不要据此怀疑便携根目录解析逻辑；要看真实路径，请直接读 `launcher.log` 或用 `-Encoding UTF8` 显式解码。

### 12.9 遗留约定与注意事项

1. **`renderer/components.json` 是手写的**（shadcn CLI 因 `renderer/` 下无 `package.json` 而拒绝执行）。
   内容对齐 `style=new-york` / `baseColor=slate` / `cssVariables=true` / `iconLibrary=lucide` / `@/` 别名。
   **未来升级 shadcn（`npx shadcn@latest`）时，必须人工比对该文件与新版 CLI 生成的默认值**，
   不要直接让 CLI 覆写，否则会丢掉本仓库的别名与 Tailwind v4 约定。
2. **cn 导入约定**：自写组件统一从 **`@/lib/utils`** 导入（转发层 `export { cn } from 'cn'`）；
   第三方 shadcn 组件保留其原始的 **包导入 `import { cn } from "cn"`**。
   新增自写组件时请沿用前者，重新 `add` 的 shadcn 组件不要手改其导入，避免未来两套风格混乱。
3. **旧 `index.html` 必须继续留在 `build.files` 白名单里**——它是回退分支的唯一 UI，
   任何"清理陈旧文件"的动作都不要删它。
4. `build:web` 后 `renderer/dist` 的文件名带内容哈希；asar 内的哈希与重新构建一致，
   可作为"打包产物是否对应当前源码"的快速校验手段。

---

## 十三、4.1.x：设置弹窗 + IPC 服务层 + P0 白屏修复记录（4.1.6 汇总）

> 本节汇总第 4 步 4.1.x 的交付物与 4.1.5.4.4.5 / 4.1.5.4.5 两次验证的完整记录。
> 4.1.x 改动同时覆盖渲染层（设置弹窗 3 组件 + IPC 服务层）与旧架构 `src/core` 的缺陷修复
> （console 启动模式 + `findAgentBySignature` 签名找 PID、单窗口直拉、BOM 容错、密钥治理、CI 修复）。

### 13.1 本步交付物一览

| 类别 | 文件 | 说明 |
| --- | --- | --- |
| 设置弹窗 | `renderer/src/components/settings/SettingsModal.tsx` | 弹窗壳 + 三个 tab（API / 用量 / 关于）；用量统计与关于页为占位，待 4.2 / 4.4 |
| API 表单 | `renderer/src/components/settings/ApiConfigForm.tsx` | 预设/自定义切换、模型拉取、密钥校验；**P0 修复所在（13.2）** |
| 连接测试 | `renderer/src/components/settings/ConnectionTestButton.tsx` | 保存配置 + 连通性测试 |
| IPC 服务层 | `renderer/src/services/ipc.ts` · `config-client.ts` · `agent-client.ts` | `hasLauncher` 判空 + `safeInvoke` 统一兜底：IPC 未注入或主进程抛异常时返回 fallback，**绝不把异常抛给 React 组件** |
| 类型 | `renderer/src/types/launcher.d.ts` | preload 41 个 IPC 的 TS 类型 |
| 接线 | `renderer/src/App.tsx` | 设置按钮 → 弹窗开关 |
| 密钥治理 | `config/providers.json` 删除（staged）+ `config/providers.example.json` 新增（apiKey 置空）+ `.gitignore` 追加 | 4.1.4.6 B+ 方案：真实 API Key 不再入库 |
| CI | `.github/workflows/build.yml` | test 步骤补 `CI: 'true'` env |

### 13.2 P0 白屏完整记录（4.1.5.4）

**现象**：在生产 bundle（`vite preview` 托管 asar 内同一份产物）中点击设置按钮，
整个应用白屏——`#root` children 从 1 变 0，整棵 React 树被卸载。

**根因**：`ApiConfigForm.tsx:135-142` 裸读 `presets.openai.baseUrl`。
预设表为空（纯浏览器内 IPC 不可用 → presets 兜底为空对象）时抛
`Uncaught TypeError: Cannot read properties of undefined (reading 'baseUrl')`，
错误在渲染期抛出且无错误边界，React 随即卸载整棵根树。

**修复**：改为 `presets.openai?.baseUrl || ''` 判空读法，并顺带排查全部 26 处裸读，
确认无同类隐患（含隔离容器 4 场景、空预设表不崩用例）。

**双重验证**：

| 验证 | 修复前（旧 hash `index-CXz9f620.js`） | 修复后（`index-eExaiHHn.js`） |
| --- | --- | --- |
| `#root` children | **0（树被卸载，白屏）** | **1（始终 ≥1）** |
| 设置面板 | 无 | 12 个 `cfg-*` 表单元素全部渲染，随后按设计降级 |
| 抛错 | `TypeError: ... reading 'baseUrl'` | 无 TypeError，仅 3 条设计内降级 `console.error` |

1. **前后对照**（同运行时）：`npx vite preview --config renderer/vite.config.mts --port 4174 --strictPort`
   托管与 asar 内同一份产物，修复前后各跑一遍，观测项如上表——证明因果关系，而非"修完能跑"。
2. **asar 检索**：直接在 `app.asar` 内检索 `openai?.baseUrl` 命中（旧写法 `presets.openai.baseUrl` 零命中），
   证明修复代码确实进了打包产物——比检索组件 id 更强的打包一致性证据。

**生产 bundle 实点完整观测**：MutationObserver 瞬时捕获 25 个 id 全部命中
（`settings-modal*` / `settings-tab-*` ×3 / `api-config-form` / `agent-tab-*` ×4 / `cfg-*` ×12 / `conn-test-saved` / `settings-error` / `settings-retry`）；
随后按设计降级：`#api-config-form` 卸载 → `#settings-error` 显示
`读取配置失败：IPC 不可用（preload.js 未加载）` + 重试按钮。
关闭弹窗后会话界面完好还原（agent-selector / model-selector / chat-input / 消息均在），
错误数保持 3 条零新增。
**降级本身是预期边界**（ipc.ts 在模块加载期固化 `hasLauncher`，纯浏览器注入不了 preload），
真实 Electron 壳内 IPC 正常，由真实窗口日志 `AuthIpc Registered` + `LoadFile fallback=false` 佐证。

### 13.3 流程改进 6 条（自 4.1.5.4 起固化）

1. **编译通过 ≠ 首帧不崩**。构建零警告、tsc 全绿都不代表运行期不白屏；每个可交互 UI 必须真实打开后以 DOM 观测为准。
2. **每个 UI 组件必须真实打开验证**：以 MutationObserver 瞬时捕获元素 id（渲染后立即卸载的降级态也能抓到），不能只看"没报错"。
3. **修复代码必须在 asar 内检索确认已打包**：检索修复表达式（如 `openai?.baseUrl`）比检索组件 id 更强——id 相同不代表代码已更新。
4. **每轮验证后做清理比对**：进程数 / 端口 LISTENING / `Launcher/Data/` 逐文件快照比对（体积 + SHA256 + mtime）/ git 状态逐行比对，确保零测试残留。
5. **修复必须做前后对照**：同一运行时、同一观测手段跑"修复前 vs 修复后"，才能证明因果；只跑修复后无法排除"本来就没问题"。
6. **环境陷阱必须固化为工具/脚本对策**：如 `scripts/dev-launcher.ps1` 自动清除 `ELECTRON_RUN_AS_NODE`，而不是每次靠人记住。

### 13.4 环境陷阱（本次新增 / 精确化）

1. **`ELECTRON_RUN_AS_NODE=1` 由 DSH 宿主注入**（第五节已溯源，本步补充两个新事实）：
   - 打包 exe 在该变量下**秒退、日志零增长、`-PassThru` 退出码为空**（读 stdin 遇 EOF 以 code 0 退出），
     表现极易误判为"应用坏了"；清除变量后同一 exe 立刻正常起窗。
   - **探测手段也有坑**：`& $exe --version` 对 Electron 不生效而是直接起窗，会一直挂到工具超时并留下额外启动实例。
     正确做法：`Start-Process` + 逐秒有界轮询 + 上限，跑完强制结束并核对 `launcher.log` 增量与启动次数一一对齐。
2. **portable 单文件 exe 不转发 stdout、退出码不可信**（12.8.2 已立约定，本步再次确认）：
   需要断言 `SELFTEST_JSON` 的场景一律用 `win-unpacked/AI-Agent.exe --selftest`。
3. **应用日志写 UTC，文件系统 mtime 是本地时间（UTC+8）**：`Get-Date = 19:53:42` 对应日志 `11:53:05`，
   差值恰 8 小时且与 mtime 自洽。对时间轴时**勿再误判成"日志没写"**。
   —— 顺带把 12.8.3 的 claude-code 版本串乱码精确化到字节级：该段原始字节含 `EF BF BD`×4
   （U+FFFD 的 UTF-8 编码），说明**损坏发生在写入文件之前**（子进程 stdout 按 GBK 输出、父进程按 UTF-8 解码），
   与读取方式、文件编码均无关。**已于 B1 专项根修（见 13.7）**。
4. **点关闭按钮 = 隐藏进托盘，进程不退出**（`main.js` close→hide 设计）：验证收尾必须强制结束进程，
   否则会留下 4 个常驻进程污染下一轮观测。

### 13.5 验证证据与清理比对（4.1.5.4.4.5 + 4.1.5.4.5）

| 证据 | 结果 |
| --- | --- |
| ① 真实窗口启动 | `Auth Ready` + `AuthIpc Registered`（5 channel）+ `LoadFile ... app.asar\renderer\dist\index.html fallback=false` + `DidFinishLoad` 全命中；进程稳定 4 个 |
| ② `--selftest` | `ok:true`，4/4 READY（openclaw / hermes / codex / claude-code），约 2 s 退出，不开窗（日志无 `Window LoadFile`） |
| ③ vite preview 实点 | 见 13.2 双重验证表 |
| 清理比对 | AI-Agent / electron 进程 0；4174 TimeWait 无 LISTENING；`Launcher/Data/` 与快照逐文件一致（三个 secrets .bin 体积+SHA256 未变、`app.db` 45,056 B 未变、`agent-state.json` 内容逐字节一致仅 mtime 刷新、`app.db-shm/wal` 被 SQLite 正常收尾）；git 状态与开始时逐行一致 |

### 13.6 11 项手动清单（交付前人工过一遍）

1. 登录层：注册新账号 → 登出 → 重新登录，密码错误分支有提示。
2. 四个 Agent（OpenClaw / Hermes / Codex / ClaudeCode）逐个启动，确认单窗口、进程可见、停止按钮真正结束进程。
3. Agent 启动后停止，确认无残留进程、无多余窗口。
4. 设置弹窗内 API 配置表单 12 个 `cfg-*` 元素完整（provider / baseurl / model / fetch-models / model-list / key / toggle-key / key-status / validate / test-form / save / clear-key）。
5. 保存自定义 baseUrl → 重开弹窗仍是自定义值（dirty 标记不误清）。
6. 密钥保存后重开：密文态显示、状态徽标正确；清除密钥后回到未配置态。
7. 连接测试按钮：保存配置成功 / 失败两分支均有可读反馈。
8. 用量统计 tab：显示占位（待 4.2 迁移）不报错。
9. 关于 tab：显示占位（待 4.4 补）不报错。
10. 托盘：图标存在、菜单可恢复窗口；点关闭按钮 → 窗口隐藏进托盘、进程仍在（按设计）。
11. **真实 `AI-Agent.exe` 窗口内点开设置弹窗，观察表单出现并可保存/重开** —— `browser_*` 工具无法附加 Electron 窗口，**「未实点，需用户手动确认」**。


### 13.7 B1 根修记录：selftest 版本串 GBK/UTF-8 混流乱码（2026-10-03）

**根因（两层）**：
1. `probeVersion`（Launcher/App/main.js）按 `encoding:'utf8'` 解码 PowerShell 5.1 子进程输出，
   而 PS 5.1 向重定向管道输出用系统 ANSI（GBK）→ 中文路径变 U+FFFD（写盘即 EF BF BD）。
2. 单流改 GBK 解码也不行：check 脚本输出是**混流编码**——PS 自身字符串 GBK（`桌面`=d7c0c3e6）
   + 内部 Agent exe 透传的 UTF-8（hermes 的 `·`=c2b7），任一单一解码都会毁掉另一半
   （实测 GBK 兜底会把 hermes 的 `·` 变成 `路`）。

**修法（统一子进程输出编码，零新依赖）**：
- 调用侧改为 `-Command` 包装：先设 `[Console]::OutputEncoding=UTF8` 再 `& '脚本' --version`，
  使整条输出流统一为 UTF-8（含 PS 自身字符串与 exe 透传字节）。
- 父进程 `decodeConsoleOutput()`：Buffer 捕获 → 严格 UTF-8（fatal）→ GBK 兜底，
  仅作非 PS 子进程（直接输出 GBK 的 CLI）的保险。旧架构 `runCommand`（src/core/process-manager.js）同款修复。

**验收**：重建 asar 后 `win-unpacked/AI-Agent.exe --selftest` → 4/4 READY、ExitCode=0、stderr 空；
claude-code = `E:\桌面\AI Agent 母盘`（正确）、hermes `·` 保持正确（无回归）、
原始输出字节 `U+FFFD` 计数 = **0**；单测 36/36、语法 8/8、构建零警告。
