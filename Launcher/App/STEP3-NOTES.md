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
| 设置弹窗 | `renderer/src/components/settings/SettingsModal.tsx` | 弹窗壳 + 三个 tab（API / 用量 / 关于）；用量与关于已由 4.2 / 4.4 落地（见 13.9） |
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
4. ✅【已实点 2026-10-03】设置弹窗 12 个 `cfg-*` 元素完整（含 `cfg-key-status`「已配置（·····9b9d）」徽标），表单回显真实配置（OpenRouter / qwen 3.8 27B / 466 个模型缓存）。
5. 保存自定义 baseUrl → 重开弹窗仍是自定义值（dirty 标记不误清）。
6. 密钥保存后重开：密文态显示、状态徽标正确；清除密钥后回到未配置态。
7. 连接测试按钮：保存配置成功 / 失败两分支均有可读反馈。
8. ✅【已实点 2026-10-03】用量统计 tab 在真实 exe 内显示真实数据（5 请求 / 1,445 输入 / 25 输出 / 费用「—」不伪造 0；hermes / apihub.agnes-ai.com / agnes-2.5-flash 三表）。
9. 关于 tab：产品 / 启动器版本 / 便携根目录 / 日志文件四行只读信息 + 「打开日志文件夹」按钮。
10. ✅【已实点 2026-10-03】WM_CLOSE → `Window Hidden to Tray` + 4 进程存活 + hwnd=0；点任务栏溢出区托盘图标「AI Agent U盘版」→ 窗口恢复（hwnd 复原）。
11. ✅【已实点 2026-10-03，经用户授权】真实 `AI-Agent.exe` 窗口内点开设置弹窗：12 个 `cfg-*` 全渲染、三个 tab 切换、关闭→重开数据重新拉取、表单值回显一致。手段：Windows UIA（`browser_*` 无法附加 Electron，但 UIA 可以；Chromium 首次被 UIA 查询后需再查一次才能拿到完整树）。剩余未实点：第 1/2/3/5/6/7 条（涉及真实保存/Agent 启停/登录长流程）。


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

### 13.8 B2 核实 + B5 死代码清理（2026-10-03）

**B2（进程状态持久化）——经实证核实为「已实现」，纠正扫描报告的误报**：
`agent-process-manager.js` 自早期阶段即具备完整持久化闭环：启动时 `adoptSavedRecords()`
从 `Launcher/Data/agent-state.json`（electron-store，兜底 JSON store）恢复记录并校验 PID 存活，
死 PID 即 `forget()` 清除；运行中每次 start/stop 经 `persist()`/`forget()` 同步落盘
（变更本就是低频事件，无需额外防抖）。隔离烟囱测试证据：
- 预置存活 PID → 重启后 `getAgentStatus` = RUNNING（adopted）；
- 预置死 PID（99999999）→ 状态 STOPPED、pid=null，store 落盘回 `{"agents": {}}`。
**无代码改动，仅记录。**

**B5（死代码清理）**：删除 `agent-process-manager.js` 中 `pidAlive()` 与 `stopTree()`
（两处 `TODO: dead code` 标注 + 头部 TODO 行，共约 40 行）。全库引用核查仅 `_pm_test/harness-manifest.cjs:75`
的日志字符串 `pidAliveAfter` 含同名子串、无实际调用。回归：语法 OK、根单测 36/36、`p16_pm_test.cjs` PASS。

### 13.9 4.2 + 4.4 记录：用量统计面板 + 关于页（2026-10-03）

**新增文件（零新依赖）**：
- `renderer/src/services/usage-client.ts`：usage:dashboard / export / clear 的 safeInvoke 封装；
- `renderer/src/components/settings/UsagePanel.tsx`：天数切换（7/30/90）+ 汇总卡片（请求 / 输入 / 输出 / 费用，
  全部无定价时费用显示「—」而非伪造 0）+ byAgent / byProvider / byModel 三表 + 导出 CSV/JSON + 清空（两步确认）；
- `renderer/src/components/settings/AboutPanel.tsx`：manifest:get 的只读信息（产品 / launcherVersion / 根目录 / 日志路径）+ 打开日志文件夹。

**真实打开验证（vite preview 生产 bundle + 浏览器）**：
- 用量 tab：`读取用量失败：IPC 不可用（preload.js 未加载）` + 重试 —— 与设置面板同一降级设计，无白屏；
- 关于 tab：四行信息完整渲染（浏览器内版本/根目录为「—」属 IPC 降级预期）；
- 三个 tab 来回切换后 `#root` children 恒为 1，关闭弹窗后会话界面完好、弹窗节点全部卸载；
- 截图存证：`browser-screenshots/4.2-usage-tab-degraded.png`、`browser-screenshots/4.4-about-tab.png`。

**四闸门**：语法 8/8、单测 36/36、selftest 4/4（B1 修复保持：中文路径与 `·` 均正确）、构建 EXIT=0 零警告；
asar 检索：`usage-panel` / `about-open-logs` 命中、占位文案 `待 4.2 迁移` 零命中（新代码确认已入包）。
**真实 exe 内的用量数据展示已于 13.10 实点验证。**

### 13.10 真实 exe 实点验证记录（2026-10-03 晚，经用户授权）

**手段**：Computer Use SDK 在本会话不可用（会话级基础设施限制），回退 **PowerShell UIAutomation** +
`capture-window.ps1`（12.8.1）。关键经验：**Electron/Chromium 的可达性树要被 UIA 查询两次才完整**
（首次查询触发渲染进程开启 a11y，第二次才能看到全部 AutomationId），且窗口隐藏进托盘后
`Get-Process().MainWindowHandle` 为 0，UIA 脚本须先经托盘恢复。

**实测通过项**（13.6 清单第 4 / 8 / 9 / 10 / 11 条，见各条 ✅ 标注）：
设置弹窗全链路（打开 → 12 个 `cfg-*` 全渲染 → 三 tab 切换 → 关闭 → 重开重新拉取）、
用量 tab 真实数据、关于 tab 真实 IPC 数据、托盘隐藏/恢复闭环。
截图：`browser-screenshots/4.1-real-exe-{main,settings-api,tray-restored}.png`、
`4.2-real-exe-usage{,-mine}.png`、`4.4-real-exe-about.png`。

**【新发现】单实例锁的日志陷阱**：本次测试预检 `tasklist | grep` 误报"无实例"，
而用户此前手动启动的实例（20:51:20，`Launcher Started`）一直在运行。第二次启动的实例：
module 作用域的 `Auth Ready` / `AuthIpc Registered`（line ~1044，**先于** line 1388 的
`requestSingleInstanceLock`）照常写进共享 `launcher.log`，随后因拿不到锁在 `whenReady` 里静默
`app.quit()`——不写 `Launcher Started`、不建窗口。表现为：日志里出现一对"孤儿 Auth 行"，
其后没有 `Launcher Started` / `Window LoadFile`，极易误判为"窗口日志丢了"。
**对时口诀：Auth 行 ≠ 新窗口；`Launcher Started` 才是新实例的开始标记。**
（可选改进，本轮未做：`!gotLock` 分支补一条 `Event=Second Instance Quit` 日志。）

**预检教训**：本机 `tasklist | grep -ci AI-Agent` 在该环境不可靠（返回 0 但实际有实例）。
以后进程预检改用 `Get-Process -Name AI-Agent -ErrorAction SilentlyContinue` 并显式打印计数。

**清理与残留**：测试零写入（未点保存/清除/清空）；`Launcher/Data` 逐文件体积与基线一致
（usage.jsonl 2184 B 未变、secrets 三 bin 未变、app.db 未变）；
日志 70466 → 71527 B，与两次启动 + 一次 Hidden to Tray 对齐。
`Launcher/Config/user-config.json` / `model-cache.json` 的未提交改动是**用户 20:56 手动配置
Hermes（含 466 个模型缓存）** 所致，与本次测试无关，留待用户处置。

### 13.11 手动清单收尾实测（2026-10-03 晚，经用户授权，接续 13.10）

**基线管理**：开工前全量 SHA256 基线（user-config / providers.example / Data 全部 10 文件）+
日志字节数（71527）+ git 快照 + `user-config.json` 工作区外备份（`%TEMP%\zcode-baseline-20261003-212138`，
哈希校验一致）。测试实例归属：`Get-CimInstance Win32_Process` 核对主进程（无 `--type=` 参数）
CreationTime 与 `Launcher Started` 时间戳吻合（本轮 3944@21:21:48、11336@21:25:56）。

**本轮结果（13.6 清单第 1/2/3/5/6/7 条）**：

| 条目 | 结果 | 证据 |
| --- | --- | --- |
| 5 保存自定义 baseUrl → 重开仍是自定义值 | ✅ 通过 | baseUrl 改 `https://zcode-test.invalid/v1` → 保存 → 关弹窗重开回显测试值（UIA 读回）→ 日志 `ApiConfig Saved id=openclaw hasKey=kept`（密钥未触碰） |
| 6 密钥保存后重开：掩码/徽标/清除 | 部分（见 7） | 密钥全程零接触；掩码留空 = 沿用已保存密钥、徽标「已配置（·····9b9d）」前后一致 |
| 7 连接测试两分支反馈 | **BLOCKED** | masked 密钥清除后无法经 UI 恢复（技术约束而非功能缺陷）→ 需用户手动确认 |
| 1/2/3 登录、Agent 启停 | **BLOCKED（产品缺口）** | 新 UI 未接线启停控件：主界面 UIA 全量 38 元素无任何启动/停止/状态角色；`agent-selector` 下拉仅 4 个切换项（OpenClaw 当前/Hermes/Codex/Claude Code）；`App.tsx` 无 `startAgent/stopAgent` 调用。pm 层启停机制已由 `p16_pm_test.cjs` 实测（PASS），缺的是 UI 接线 |

**baseUrl 闭环的还原（双路径）**：UI 路径改回原值 → 重开回显 `https://openrouter.ai/api/v1` ✓；
文件级兜底：托盘退出自动化失败（右键菜单 UIA 不可达，两次 `NO_CONTEXT_MENU`）→ 按归属规则
`Stop-Process` 结束自己的实例 → B5 备份覆盖 `user-config.json` → 复算哈希 == 基线 ✓ →
重启确认 UI 显示用户原配置（OpenRouter / qwen 3.8 27B / 466 缓存 / ·····9b9d）✓。
**终态：10/10 哈希一致，测试零净写入。**

**新踩的坑**：
1. `Get-Process().CreationTime` 在本环境可能返回 null（4/4 进程同时），改用
   `Win32_Process.CreationDate` 稳定；主进程识别 = 命令行无 `--type=`。
2. UIA 可达性「温热」会衰减：隔一段时间再点会 `NOT_FOUND`，每次操作批前重跑一遍枚举。
3. 托盘图标**右键**菜单对 UIA 不可达（`#32768` 未捕获，左键 Invoke 正常）→ 程序化托盘退出
   目前做不到，只能 `Stop-Process`（仅限归属明确的自有实例）。
4. 密钥徽标文本经 UIA 读出为 `????9b9d`（UIA 层把 `·` 转义），截图层正常——显示层差异，非数据问题。

**产品缺口（建议排期）**：新 UI 无 Agent 启停/状态入口（第 1/2/3 条的根因）。
建议 4.x 增加卡片式启停 UI 接 `startAgent/stopAgent/getAgentStatuses`（IPC 已就绪），
并把登录层接入新 UI（auth 5 通道已注册但未消费）。

**本轮对用户 Config 文件的处理**：`Launcher/Config/user-config.json`（用户个人配置，
模板=config/providers.example.json）与 `model-cache.json`（「拉取模型」的派生缓存，可再生）
gitignore + 解除跟踪，磁盘内容零改动。**此为建议方案，若用户希望 user-config.json 入库请说一声，需先脱敏审查。**

---

## 13.12 Agent 启停 UI 接线（产品缺口 #1 关闭轮）

### 13.12.1 T1 设计说明（先于代码落盘）

**摸底结论（比任务书预期收窄）**：启停链路的 main/preload/服务层/类型层**全部已存在**，
本轮唯一缺口是 renderer UI 消费端。逐层证据：

| 层 | 现状 | 位置 |
| --- | --- | --- |
| main IPC | `agent:launch` / `agent:stop` / `agent:restart` / `agents:status` / `agent:status` / `agents:start-all` / `agents:stop-all` 已注册，全部接 pm 既有方法，带 `knownAgentId` 校验 | main.js L652-686 |
| 状态推送 | `pm.setStatusHook((p) => broadcastStatus(p))` → `win.webContents.send('agent:status', payload)` 已接线 | main.js L1230-1233 |
| 重同步 | `win.on('show')` → `webContents.send('agent:resync')` 已接线（托盘恢复窗口时触发） | main.js L1403 |
| preload | `launch` / `stopAgent` / `restartAgent` / `getAgentStatuses` / `getAgentStatus` / `startAllAgents` / `stopAllAgents` / `onAgentStatus` / `onAgentResync` 已暴露 | preload.js L5-17 |
| renderer 服务 | `startAgent` / `stopAgent` / `restartAgent` / `getAgentStatuses` / `getAgentStatus` / `onAgentStatus` / `onAgentResync` 已封装（safeInvoke 降级） | services/agent-client.ts L62-135 |
| 类型 | `AgentRuntimeStatus` / `AgentStatusRecord` / `AgentStatusesResult` / `AgentStatusResult` / `AgentStatusEvent` / `AgentActionResult` / `StartAllResult` / `StopAllResult` + `LauncherApi` 方法签名已定义 | types/launcher.d.ts L57-110, L450-460 |
| **UI 消费端** | **零调用**：App.tsx 无任何 startAgent/stopAgent/getAgentStatuses 调用（13.11 实测 38 个 UIA 元素无启停角色） | —— |

因此本轮 **main.js / preload.js / launcher.d.ts 零改动**；任务书预期的 `ProcessControlResult`
等类型不再重复定义（既有 `AgentActionResult` 覆盖同一语义）。

**UI 需要的最小 API 面（全部复用既有，零新增 IPC 通道）**：

- `startAgent(id)` → `agent:launch`（启动；pm 内部：STARTING→spawn→RUNNING，1.5s 后 start-verify 死进程纠偏）
- `stopAgent(id)` → `agent:stop`（tree-kill / taskkill /T /F，返回 `{ ok, stopped, pid, reason? }`）
- `getAgentStatuses()` → `agents:status`（全量对账；注意 `getAllStatuses()` 只含**被跟踪过**的记录，缺席 = 从未启动 = STOPPED）
- `onAgentStatus(cb)` → `agent:status` 推送（pm 五态每次跃迁都会广播）
- `onAgentResync(cb)` → `agent:resync`（窗口重新显示时全量重拉）

**组件改动点**：

1. 新增 `renderer/src/hooks/useAgentRuntime.ts`：状态容器 Hook。
   - 视图模型：`AgentUiStatus = AgentRuntimeStatus | 'UNKNOWN'`（浏览器直开 / 首拉未完成）；
     `AgentRuntimeState { status, pid, startedAt }`；`AgentActionState { busy: 'start'|'stop'|null, error }`。
   - 挂载即 `getAgentStatuses()` 全量拉取（徽标必须与 agent-state.json 持久化态联动，
     含 adoptSavedRecords 恢复的 RUNNING——设置弹窗「打开时才拉」的约束 7 不适用于主界面徽标）。
   - `onAgentStatus` / `onAgentResync` **无法取消订阅**（preload 未暴露 removeListener，
     agent-client.ts L110-119 已有书面约定）→ 模块级 `ensureSubscriptions()` 一次性守卫，
     回调经 dispatcher 引用转发当前实例，StrictMode 双挂载也只注册一条监听。
   - 动作（start/stop）期间 busy 锁按钮；完成后全量 `refresh()` 对账一次（补推送与 invoke 结果之间的窗口期）。
2. 新增 `renderer/src/components/agents/AgentControlStrip.tsx`：顶栏下方 4 张迷你卡片
   （名称 + 状态徽标 + PID + 启动/停止按钮 + 动作错误行），错误走行内可读文案，不用 alert。
   AutomationId 命名：`agent-strip` / `agent-card-<id>` / `agent-badge-<id>` /
   `agent-ctrl-start-<id>` / `agent-ctrl-stop-<id>` / `agent-err-<id>`。
   徽标映射：RUNNING 运行中(绿) / STARTING 启动中(黄) / STOPPING 停止中(黄) /
   STOPPED 已停止(灰) / ERROR 异常(红) / UNKNOWN 未知(灰)。按钮可用矩阵：
   RUNNING/STARTING → 只可停止；STOPPED/ERROR/UNKNOWN → 只可启动；STOPPING → 停止中(禁用)。
3. `App.tsx`：header 与消息区之间挂载 `<AgentControlStrip />`（shrink-0，不挤压滚动语义）。

**Agent 名单来源**：复用 mock-data `AGENTS`（id 与 agents.json 完全一致：
openclaw/hermes/codex/claude-code），与 AgentSelector 同源，不引第二份名单。

**开源参考（只读，零拷贝，零新依赖）**：VS Code `src/vs/base/node/ps.ts`（MIT，文件头可查）。
取其进程展示层级思路——友好名（name）为主属性、PID 作次级元数据、命令行不上 UI
（findName 从命令行推导展示名的做法确认了"命令行属于诊断层而非展示层"）。
未复制任何代码；进程树枚举/查杀不需要参考（pm 层 tree-kill 已实测）。
无依赖申报：本轮零 npm install。

**验收计划**：四闸门 + asar 检索 + 真实 exe UIA（按钮可达 / hermes 启停闭环 / B2 托盘退出回归 /
终态哈希）+ vite preview 浏览器降级。结果待补于 13.12.3。

### 13.12.2 实现记录（改动清单）

| 文件 | 改动 | 说明 |
| --- | --- | --- |
| `renderer/src/hooks/useAgentRuntime.ts` | **新增** | 状态容器：挂载即全量拉取 + 推送订阅（模块级一次性守卫，见 agent-client.ts 不可退订约定）+ resync 重拉 + start/stop 的 busy/error 状态 |
| `renderer/src/components/agents/AgentControlStrip.tsx` | **新增** | 4 卡控制条：名称 + 徽标 + PID + 启动/停止 + 行内错误；AutomationId `agent-card-<id>` / `agent-badge-<id>` / `agent-ctrl-start-<id>` / `agent-ctrl-stop-<id>` / `agent-err-<id>` |
| `renderer/src/App.tsx` | +13 行 | header 与消息区之间挂载 `<AgentControlStrip />`（挂载即拉状态是徽标联动要求，不影响设置弹窗约束 7） |
| `renderer/src/services/usage-client.ts`、`UsagePanel.tsx` | 顺手修 | 4.2 遗留的 3 个 tsc 错误（`reason` → `error`，对齐主进程 usage:* 返回字段）——此前 vite 不做类型检查所以漏网 |
| `main.js` / `preload.js` / `launcher.d.ts` | **零改动** | 启停 IPC / preload 方法 / 类型全部已存在（13.12.1 摸底结论），红线 3「不重构 pm 核心」同时满足：本轮未触碰 agent-process-manager.js |
| `.gitignore` | 1 行修正 | `agents/` → `/agents/`（根锚定）——裸写法在 Windows `core.ignoreCase=true` 下会静默忽略仓库内任意 agents 目录，本次 `components/agents/` 就中招，差点漏提交 |

### 13.12.3 验收结果

**四闸门（窄视口修复后重打包终验）**：
1. 语法 `node --check`：**24/24**（Launcher/App/*.js + src/core/**/*.js 含 adapters）
2. 单测（根 `tests/`，`node --test`）：**36 pass / 0 fail**；Launcher/App 自己的 tests 目录为空（0 条，历来如此）；
   本轮无新增可单测的零依赖 JS 模块（renderer TS 不在 node --test 覆盖面）——数字如实，无硬凑
3. selftest（`win-unpacked\AI-Agent.exe --selftest`）：**4/4 READY，ExitCode=0**，hermes `·` 无乱码（B1 修复健在）
4. electron-builder --win portable：**EXIT=0**，无 ⨯ 级警告（3 条历轮既有 informational：author 未填/默认图标/ajv 重复引用）

**asar 检索**（win-unpacked/resources/app.asar）：`agent-ctrl-start-` / `agent-ctrl-stop-` /
`agent-badge-` / `agent-card-` / `agent-strip-error` / `min-w-[200px]`（修复标记）/
`index-ClRR4VOx`（新 bundle 哈希）全部命中。

**真实 exe UIA 实测**（归属：Win32_Process 主进程 CreationTime 与日志 Launcher Started 精确吻合，4 次启动均验证）：
- a) 两遍枚举 **55 元素**（13.11 时 38 → +17）：`agent-strip` + 4 卡（名称/徽标文本/PID 行/启动按钮）全部可达 —— **清单第 2 条关闭**
- b) hermes 闭环：点启动 → 日志 `[pm] start` + `start-verify alive=true` → 徽标「运行中」+PID（截图
  `browser-screenshots/13.12-real-exe-hermes-running.png`）→ 点停止 → `[pm] stopped=1` → hermes.exe 残留 **0** →
  徽标「已停止」（截图 `13.12-real-exe-hermes-stopped.png`）—— **清单第 3 条关闭**
  - 额外：Claude Code 启动即退（已知 TUI 约束）→「异常」红标 + 行内文案「进程异常退出，可尝试重新启动」被真实触发并截图
    （`13.12-real-exe-error-path-claudecode.png`）——失败态设计获得生产验证，无 alert
- c) B2 实战回归：hermes RUNNING 态 → 托盘右键 UIA 不可达（上轮已证，未浪费重试）→ 按归属规则 `Stop-Process` 自己的实例 →
  agent-state.json 含 hermes 记录（persist 启动即写盘）→ 重启 → adopt 恢复 → 徽标「运行中」+PID 与落盘记录一致
  **且进程真实存活（无幽灵 RUNNING）** → UI 停止 → `stopped=1` → agent-state.json 回 `{"agents": {}}`（与基线字节级一致）
- d) 终态哈希：见 13.12.4
- 浏览器降级（vite preview，内置浏览器 1280×720，截图 `13.12-browser-degraded.png`）：条级错误
  「Agent 状态读取失败：IPC 不可用（preload.js 未加载）…」+ 4 卡「未知」徽标，无白屏；点启动 → 卡内行内错误
  「IPC 不可用（preload.js 未加载）」，无 alert
  - 【额外收获】首次点击即暴露窄视口缺陷：4 卡 `flex-1 min-w-0` 被压窄后内容外溢、相邻卡片互相遮盖
    （Playwright actionability 检出 hermes 按钮被 claude-code 卡覆盖）→ 改 `flex-wrap` + `min-w-[200px]` →
    重构建重打包重验四闸门 + asar

### 13.12.4 终态哈希（逐文件，基线 21:55 → 终态 22:16）

| 文件 | 基线 SHA256（前 16 位） | 终态 | 结论 |
| --- | --- | --- | --- |
| Launcher/Config/user-config.json | 1b0d1012055c527b | 同 | ✓ |
| Launcher/Config/model-cache.json | 784729643028c1e9 | 同 | ✓ |
| Launcher/Config/pricing.json | 42a8bf4ba1f84710 | 同 | ✓ |
| Launcher/Config/provider-presets.json | 9b312eddadb362f5 | 同 | ✓ |
| config/providers.json | 5f44351ae38e7504 | 同 | ✓（密钥零接触） |
| config/providers.example.json | f0891c5e1a6822ae | 同 | ✓ |
| Build/Config/agents.json | fe0c37ee07519776 | 同 | ✓ |
| Agents/Hermes/config.yaml**.bak** | 08a1425223f7bb70 | 同 | ✓ |
| Launcher/Data/agent-state.json | b7adf94ebd91fc22 | 同 | ✓（`{"agents": {}}` 字节级还原） |
| Launcher/Data/app.db | cc5773446831827d | 同 | ✓ |
| Launcher/Data/secrets/openclaw.bin | 5125efdb9a73634b | 同 | ✓（只取哈希，未读内容） |
| Launcher/Data/secrets/hermes.bin | fc2f965d9f604752 | 同 | ✓ |
| Launcher/Data/secrets/codex.bin | f6382c5eeb9661af | 同 | ✓ |
| Launcher/Data/usage/usage.jsonl | 8c2d8650c7b1badf | 同 | ✓ |
| **Agents/Hermes/config.yaml** | 79646170c30def0d | **6d767fab03a3634d** | ✗ 唯一净写入（见 13.12.5-2） |
| （未入基线）Agents/Codex/config.toml | —— | mtime 22:00 | 基线遗漏，见 13.12.5-2 |
| launcher.log | 73383 字节 | 78760+ 字节 | 1 selftest + 5 启动 + 3 停止 + 用户交互，按先例只解释不还原 |

### 13.12.5 本轮发现（如实披露）

1. **用户实时协同测试**：实测中途用户在真机上亲自点按了 openclaw/codex/claude-code 的启停、并手关了
   hermes/codex 控制台窗（日志原文 "window closed by user"）——新 UI 的首次真人试用顺利；pm 的惰性存活
   复查正确处理了手关窗口（徽标经下次状态读取回落为「已停止」），未产生幽灵状态。
2. **净写入披露**：`Agents/Hermes/config.yaml`（123KB）被 hermes 启动路径的 `syncHermesModelConfig` 重写
   （本轮 3 次启动），哈希变化如上表；核验托管块四行 `default/provider/base_url/key_env` ==
   用户 user-config 值（poolside/laguna-s-2.1:free @ openrouter，provider custom），功能等价、无重复块。
   **无法字节级还原**：git 不跟踪 Agents/、无测试前备份（.bak 是 9/23 的原始版）。留置内容 == 用户下次
   启动的确定性产物，无功能影响。`Agents/Codex/config.toml` 同被启动路径重写但**未纳入基线**——本轮基线
   设计失误（只覆盖了 Launcher 托管存储，漏了 agent 配置同步目标），如实记录。
3. **UIA 显示层怪癖（非缺陷）**：nbsp 被读作 '?'、「停止」偶读为乱码截断（'ֹͣ' 类）——aid 命中与功能均正常，
   与 13.11 的 '·'→'?' 同类显示层差异。
4. **.gitignore 误伤修复**：`agents/` 裸模式 + `core.ignoreCase=true` 会静默忽略仓库内任意 agents 目录，
   本次 `components/agents/` 中招（git status 不显示、add 不进）——已根锚定为 `/agents/`，运行时 `Agents/`
   仍被正确忽略（check-ignore 双向验证）。
5. **开源参考结算**：仅只读研读 VS Code `src/vs/base/node/ps.ts`（MIT，文件头可查），取「友好名为主、
   PID 次级元数据、命令行不上 UI」的展示层级思路；未复制任何代码；**零新依赖**（无 npm install），
   无依赖申报项。进程树枚举/查杀未参考外部实现（pm 层 tree-kill 已实测在案）。
6. **清单状态**：13.6 第 **2/3 条随本轮关闭**（b 项证据）；**第 1 条（登录接线）仍开放**（auth 5 通道已注册
   未消费，下一轮单独做）。OpenClaw 配对仍需用户人工完成。

---

## 13.13 UI 重做 v2 —— Apple 风格 + 全量公共按钮 + stub 服务接口层（草稿，随阶段补全）

### 13.13.0 需求裁决记录（用户原意，不得偏移）

1. 每个按钮点击后有真实可见反馈（状态流转/内容变化/可见结果）——量化标准见按钮清单第三列；
2. 不照搬 Hermes 桌面端，按钮集按用户整理的「行业公共功能按钮清单」实现（12 项）；
3. Apple 设计语言（可执行数值拆解，见《设计规范-v2.md》），Agent 选择器收进右上角图标；
4. **刻意不做**三个 stub 只能造假的按钮：模型切换器、检查更新、帮助——留到真接线轮。

### 13.13.1 阶段 0：来源审计（时间盒内完成，结论如下）

| 对象 | 开源/许可证 | 布局参考价值 |
| --- | --- | --- |
| DeepSeek Harness Desktop（github.com/agent-earth/deepseek-harness-desktop） | 开源，**MIT**（仓库 LICENSE 可查） | 「极简桌面 wrapper」范式：单窗口承载 Web 工作台、免配置开箱即用；与本项目形态同构（Electron 壳 + 本地 Agent）。参考其「壳层让位于内容」的信息层级 |
| Hermes Agent Desktop（Nous Research，hermes-agent.nousresearch.com） | 开源，**MIT**（官网元数据明示 "free under the MIT license"；`hermes desktop` 从源码构建） | 终端 + 原生桌面双形态、单一 Agent 会话工作台、持久记忆/技能面板的信息组织 |

审计方式：公开页面只读（未 clone、未拷任何文件入库）；两项目均为 MIT → 思路与布局皆可参考。
**本任务按钮集不依赖审计结果**（按用户清单实现），审计仅支撑布局决策。
若本轮报告出现「模型切换器/检查更新/帮助」按钮即为越界（用户裁决 4）。

### 13.13.2 阶段 1：设计规范

全文见《`Launcher/App/设计规范-v2.md`》（先于代码落盘）。要点：系统字体栈 + 11/13/15/17/20/28
字号阶梯；中性灰阶 #f5f5f7/#1d1d1f，彩色仅语义（蓝 #0A84FF 主操作、绿 #30D158 RUNNING、
黄 #FFD60A STARTING、红 #FF453A STOP/ERROR）；卡片圆角 10-12px、按钮 6-8px；阴影单档
`0 1px 3px rgba(0,0,0,0.08)`；顶栏/侧栏 `backdrop-filter: blur(20px) saturate(180%)`；
动效 150-200ms ease-out + 按压 scale(0.97)；图标 lucide 1.5px stroke、16/20px 两档。
**禁止拷贝 Apple SF 字体/图标文件**（硬规则 2）——字体走系统栈、图标走 lucide，零新素材。
每个组件的 AutomationId 在规范中逐项标注（沿用既有命名惯例）。

（阶段 2-5 结果待补于 13.13.3+。）

### 13.13.3 阶段 2：服务接口层（先于 UI 落地）

| 文件 | 内容 |
| --- | --- |
| `services/agent-control-types.ts` | 纯类型：`AgentStatus`（pm 同名五态）/ `AgentSummary` / `SessionMeta` / `OutputEntry`（含 streaming 分片语义）/ `ExportedSession` / `AgentControlService` 全按钮集接口 |
| `services/agent-control-stub.ts` | stub 内存状态机：start 800ms STARTING→RUNNING、stop 500ms、restart 串联（可注入延时供单测）；每 Agent 3 条种子会话+演示输出；sendInput 回显+2 行模拟响应（1 行打字机分片，同 id 原位更新）；exportSession 生成真实 md/json 字符串；`__calls` 记录全部调用；订阅返回**真实退订函数** |
| `services/agent-control-real.ts` | 下一轮骨架：每方法 `throw not-wired-yet`；文件头 = **通道映射表**（listAgents→manifest+probe、start→agent:launch、stop→agent:stop、restart→agent:restart、状态→agents:status 推送 + agent:status；会话/输出/输入/导出需新增 agent:sessions|output|input|export 通道——这些依赖「Agent 会话数据源」裁决，接线前需与用户确认） |
| `services/agent-control.ts` | 工厂 `getAgentControlService()` 唯一切换点：`useRealService()` 函数返回 false（**故意用函数而非常量**——esbuild 对常量做折叠+DCE 会把 real 骨架整支从 bundle 删掉，实测切换前后 `not-wired-yet` asar 命中 0→1） |
| `tests/agent-control.test.js` | **14 条新单测**（Node strip-types 直载 TS 源码——stub 仅 import type 无运行时依赖，Node 24 原生支持）：工厂契约/名单对齐/start-stop-restart 事件序列/会话切换/清空撤销/流式响应/导出格式/pin 排序/__calls/防呆/real 骨架契约 |

接口相对任务书的唯一补充：`undoClearOutput(id)`（清空输出的「可撤销提示」需要恢复入口，
5s 窗口由 UI 计时；real 实现可映射为重新拉取或 throw）。已如实标注。

### 13.13.4 阶段 3：UI 实现与改动清单

- **令牌层**（index.css）：:root 换 Apple 灰阶（#f5f5f7 窗口底/#1d1d1f 主文字/#6e6e73 次要文字/
  #0A84FF 主操作蓝）；新增状态语义令牌 status-running/starting/stopped/error（绿#30D158/黄#FFD60A/
  灰#8e8e93/红#FF453A）映射为 `bg-status-*` 等工具类；`--shadow-apple: 0 1px 3px rgba(0,0,0,0.08)`
  单档阴影；`.glass` 毛玻璃工具类（blur(20px) saturate(180%)）；body 系统字体栈。
  `.dark` 保留旧 slate 值作为暗色预留（本轮不交付切换）。
- **新组件**：`ui/toast.tsx`（统一 Toast：模块级 store、3-5s 自动消失、可带撤销动作）、
  `ui/status-badge.tsx`（StatusDot/StatusBadge，200ms 颜色过渡）、`ui/agent-avatar.tsx`（字母头像
  O/H/C/CC，中性灰渐变）、`ui/popover.tsx`（radix-ui 统一包 Popover 封装——**零新依赖**）、
  `layout/TopBar.tsx`（毛玻璃顶栏：产品名+当前会话名+agent-switcher+app-settings）、
  `layout/SideBar.tsx`（Agent 列表+会话列表）、`layout/StatusBar.tsx`（状态+baseUrl 摘要+stub 标识）、
  `workbench/Workbench.tsx`（头部生命周期组/输出工具条/输出流/输入行）、`hooks/use-workbench.ts`（编排）、
  `lib/clipboard.ts`（clipboard API + execCommand 兜底）。
- **按钮按压反馈**（ui/button.tsx 基类）：`duration-150 ease-out active:scale-[0.97]`。
- **主进程一行**（main.js）：窗口 backgroundColor #0f172a→#f5f5f7（亮色 UI 前的暗色闪烁消除；
  不触及托盘/日志/单实例/pm）。
- **删除旧壳**（git rm 10 文件）：AgentSelector/ModelSelector/SettingsButton/ConversationList/
  NewChatButton/ChatInput/MessageBubble/MessageList/AgentControlStrip(13.12)/useAgentRuntime(13.12)/
  mock-data.ts。13.12 的真接线成果由 real 骨架映射表继承（start/stop 通道已实测在案）。

### 13.13.5 阶段 4：验收结果

**四闸门**：语法 24/24；单测 **50/50**（36 旧 + 14 新，0 fail）；selftest **4/4 READY** ExitCode=0
（修复后重打包再验）；electron-builder **EXIT=0** 无 ⨯ 级警告。
tsc：`--noEmit` 零错误（allowImportingTsExtensions 下服务层 .ts 显式扩展名导入全通过）。

**asar 检索**（win-unpacked/resources/app.asar）：
- 新 AutomationId 全命中：agent-switcher / agent-ctrl-start|stop|restart|new-session|clear|copy|
  export(-md/-json)|send|logs|pin / app-settings / status-bar / output-area / input-box / toast-host
- `not-wired-yet` = 1（real 骨架在包内——esbuild DCE 修复后）
- 新 bundle index-Dfe1xKwb.js 命中
- 旧 id **零命中**：agent-selector / model-selector / new-chat-btn / chat-input / agent-strip 全 0

**真实 exe UIA 全按钮走查**（实例 23152：Win32_Process CreationTime 23:34:06 == 日志 Launcher Started
15:34:06 UTC；收尾 Stop-Process 自己的实例）：

| # | 按钮 | AutomationId | 实测反馈 | 证据 |
| --- | --- | --- | --- | --- |
| 1 | 启动 | agent-ctrl-start | 徽标 已停止→运行中（绿点三处同步：徽标/侧栏/状态栏）；按钮翻转为停止、重启解禁 | 截图 13.13-real-exe-running.png |
| 2 | 停止 | agent-ctrl-stop | 运行中→已停止；按钮回启动、重启禁用 | 截图 13.13-real-exe-stopped.png |
| 3 | 重启 | agent-ctrl-restart | 点击成功（stop→start 流转后仍运行中） | UIA Invoke |
| 4 | 新建会话 | agent-ctrl-new-session | 输出清空+侧栏新条目「新会话 23:41:01」置顶高亮 | UIA 枚举 |
| 5 | 清空输出 | agent-ctrl-clear | 输出清空 + toast 带撤销 | 截图 13.13-real-exe-clear-toast.png |
| 6 | （撤销） | toast 内 | 点撤销 → 输出完整恢复（剪贴板复核 8 行=清空前全部条目） | Get-Clipboard |
| 7 | 复制输出 | agent-ctrl-copy | 剪贴板=全部条目文本（7 行逐字核对） | Get-Clipboard |
| 8 | 导出 md | agent-ctrl-export-md | 真实文件落盘（md 结构完整含时间戳条目）→ 核对后删除 | Downloads 核对 |
| 9 | 导出 json | agent-ctrl-export-json | 真实文件落盘（JSON.parse 通过，7 entries）→ 核对后删除 | Downloads 核对 |
| 10 | 发送 | agent-ctrl-send | 回显+模拟响应+流式行完整渲染 | 截图 13.13-real-exe-send.png |
| 11 | 打开日志 | agent-ctrl-logs | toast「日志路径已复制（stub）」，剪贴板=`<便携根>/Launcher/Logs/launcher.log（stub 演示）` | Get-Clipboard |
| 12 | 置顶 | agent-ctrl-pin | Toggle 态翻转；侧栏置顶排首+「已置顶」图标（agent-list-pin-hermes） | UIA 枚举 |
| 13 | Agent 切换 | agent-switcher-item-codex | 三处同步：顶栏头像 O→C、工作台 Codex、侧栏高亮（截图还捕到毛玻璃 Popover 展开态） | 截图 13.13-real-exe-switch-codex.png |
| 14 | 设置 | app-settings | 既有弹窗完整回归：三 tab + 全 cfg-* + 关闭重开数据重拉 | UIA 枚举 |

**浏览器降级**（vite preview，1280×720）：stub 在纯浏览器环境完整演示——发消息、回显、流式响应、
徽标/列表/状态栏全部正常，无任何 Electron 依赖。截图 13.13-browser-stub-demo.png。

**终态哈希**：15/15 与基线**逐一一致**（user-config/model-cache/pricing/provider-presets/
providers.json/example/agents.json/hermes config.yaml(+.bak)/agent-state.json/app.db/3×secrets/
usage.jsonl）——**stub 模式真·零净写入**；launcher.log 81649→82408（+759，1 次启动+关闭）。
导出的 2 个临时文件核对后即删（不入库）。

### 13.13.6 本轮发现（如实披露）

1. **用户再次实时协同测试**：走查期间用户在真机上切换 Agent、给四个 Agent 全点了启动、在种子会话里
   发了「nihao」、手动输入了「niha」——stub UI 经受了真人多点并行操作，全部按钮反馈正常。
2. **Electron blob 下载怪癖**：`URL.revokeObjectURL` 1s 后触发会把下载永久卡在 `.tmp`（内容已完整
   落盘但改名事件不再发生）——revoke 放宽到 30s 修复（本轮导出核对用的是卡住前的完整 .tmp 内容）。
3. **esbuild DCE 坑**：`const USE_STUB = true` 会让 real 骨架被 tree-shake 出 bundle（`not-wired-yet`
   asar 命中 0）——切换点改为函数返回值后命中 1。这对「下一轮真接线只改一处」的目标至关重要：
   骨架必须在包里等着被切换。
4. **uiaclick.ps1 修复**：`-Aid ''` 时旧脚本仍按空 AutomationId 查找（匹配到第一个无 id 元素即返回），
   导致按 Name 找「撤销」按钮失败——已修为 Aid 为空时跳过第一段查找（工作区外脚本，不入库）。
5. **导出文件落点**：本机 Downloads 重定向到 `E:\下载`（注册表 shell folders），Electron 下载照常跟随。
6. **依赖申报**：无（radix-ui 统一包自带 Popover；lucide 已有；毛玻璃纯 CSS）。零 npm install。
7. **下一轮清单**：真接线（realAgentControlService 逐方法实现 + 新增 agent:sessions/output/input/export
   通道，**接线前需与用户确认 Agent 会话数据源**）→ 模型切换器/检查更新/帮助（真功能轮）→
   登录接线（13.6 第 1 条）→ OpenClaw 配对（用户人工）。

---

## 13.14 追加裁决：官方 logo + 切换器集成到工作台 logo（用户看图点单）

### 13.14.1 需求与实现

用户在看板截图上标注两条（原图 `E:\桌面\result-image-1.jpg`）：
1. 「把这个切换按钮集成到 logo 上，并且使用哪个 agent 就显示哪个 agent 的 logo」（指向右上角切换钮）；
2. 「把这个功能集中到 logo 上」（圈住工作台头部 logo 区）+ 文字「要官方 logo」。

落地（12 文件，含 4 个资产）：
- **切换器迁移**：`agent-switcher` 从顶栏移到**工作台头部 logo**——官方 logo + Agent 名 + chevron
  组成一个按钮，点击 Popover 列出四 Agent（官方 logo + 状态点 + 置顶标记）切换；顶栏右侧只留设置齿轮。
  侧栏/菜单内头像全部换官方 logo。`agent-switcher` / `agent-switcher-item-*` AutomationId 不变（位置变了）。
- **新组件 `ui/agent-logo.tsx`**：`AgentLogo({agentId, short, size})` → `public/logos/<id>` 资产，
  加载失败/未知 id 回退字母头像（离线不断图）。**坑**：vite `base: './'` 且 Electron 生产走 file://，
  logo 路径必须**相对**（`logos/x.svg`）——首版写 `/logos/x.svg` 在 exe 里 404 全部回退字母
  （file:// 下解析到盘根），浏览器 http 预览却正常——正是 file:// 特有陷阱，记入 13.14.3。
- **资产**（public/logos/，共 ~21KB，全部来自官方渠道）：

| Agent | 文件 | 官方来源 |
| --- | --- | --- |
| OpenClaw | openclaw.svg（龙虾渐变标，120 viewBox） | openclaw.ai 官网 favicon.svg |
| Hermes | hermes.png（48×48） | hermes-agent.nousresearch.com 官网 icon |
| Codex | codex.svg（OpenAI 结花 mark，currentColor） | github.com/openai/codex 官方仓库内 assets（SSH 克隆取件） |
| Claude Code | claude-code.ico（Anthropic 标，48/32/16 三帧） | anthropic.com 官网 favicon.ico |

**商标归属声明**：OpenClaw/Hermes(Nous Research)/Codex(OpenAI)/Claude Code(Anthropic) 的 logo
版权与商标归各自项目所有；本工具为本地便携启动器，按用户明确要求以官方图标**指示性标识**对应
Agent，不做品牌宣传、不修改再创作。13.13 硬规则 2「不拷第三方 logo」自本轮起被用户裁决显式取代
（仅限这四个 Agent 标识；SF 字体/系统音效等其余红线不变）。

### 13.14.2 验收

- 四闸门：tsc 零错误、vite 构建成功、单测 50/50、打包 EXIT=0（selftest 未重跑——本轮只改渲染层资产与
  组件，主进程零改动；打包后 asar 检索通过即代表产物完整）。
- asar：`logos/openclaw.svg|hermes.png|codex.svg|claude-code.ico` 四路径全部命中；`not-wired-yet`=1；
  新 bundle index-CaNcKQY3 在。
- **真实 exe 实测**（实例 17796，归属吻合后操作）：
  截图 13.14-real-exe-logos.png（OpenClaw 龙虾标上工作台+侧栏，顶栏仅品牌名+齿轮）→
  点工作台 logo（UIA Expand）→ 点 agent-switcher-item-claude-code →
  截图 13.14-real-exe-switched-claude.png（头部变 Anthropic 标；Popover 展开态四官方 logo +
  状态点同框；侧栏/状态栏/输入框占位符同步为 Claude Code）。
- **终态哈希 15/15 与 13.13 终态一致**（diff 仅 launcher.log +1722 字节 = 1 启动 + 1 关闭）——零净写入。
- 浏览器侧未单独重截：本轮改动是资产路径与组件替换，http/file 两种协议下相对路径行为一致，
  file://（更严格的一侧）已在 exe 实测覆盖；13.13 的浏览器 stub 演示结论不受影响。
- 临时克隆（/tmp/codex-repo、claude-code-repo）用后即删，未拷任何仓库文件入库（logo 资产除外，
  为用户裁决所需，来源已列）。

### 13.14.3 新坑记录

1. **file:// 相对路径陷阱**：vite `base:'./'` 下构建产物全部相对路径，但手写代码里的 `/logos/...`
   绝对引用在 http 预览正常、file:// 生产 404——渲染层引用 public 资产一律写相对路径。
2. **打包 EBUSY/EPERM**：electron-builder 清理 win-unpacked 前，必须先结束仍在运行的 exe 实例
  （本轮 ffmpeg.dll EPERM 即此因）；目录本身被 shell 占用时改名绕过再重建（见 13.13 收尾）。

## 13.15 追加裁决：顶栏 logo 即切换器 + 删侧栏 Agent 列表 + 左下用户卡（用户口述点单）

### 13.15.1 需求与实现

用户原话：「我的意思是把AI Agent这个logo换成正在使用的agent logo，并且做到一个按钮点击左键点击可选择切换agent，
把logo下方的agent列表删掉，只用这一个按钮去切换选择agent，还有设置按钮放到左下方，并且在左下方做一个个人用户界面」。

对 13.14 的再裁决（13.14 把切换器放到了工作台头部 logo，本轮纠正为顶栏品牌位）：
1. **顶栏「AI Agent」品牌位 = 当前 Agent 官方 logo + 名称 + chevron，左键弹出切换菜单**——全应用唯一切换入口；
2. **侧栏 Agent 列表整段删除**（`agent-list` / `agent-list-item-*` / `agent-list-pin-*` 不复存在），
   只留新建会话 + 会话列表；置顶/状态点在切换菜单与工作台头部保留，无功能损失；
3. **设置齿轮从顶栏移到侧栏左下**，并入新增的**个人用户卡**：圆形头像（User 图标）+「本地用户」+
   「stub 演示账户」+ 齿轮（`app-settings` Aid 不变，设置弹窗三组件逻辑不动）。

改动 4 个组件 + 2 个文档：`TopBar.tsx`（切换器 + 受控 Popover 选中即收起 + 加载期回退「AI Agent」文案）、
`SideBar.tsx`（删 agent 列表 + 用户卡）、`Workbench.tsx`（头部回归纯展示 `workbench-agent`，输入框补动态
`aria-label`）、`App.tsx`（重新接线 + 布局注释）。**用户卡为展示态**：真实身份来自登录接线轮（13.6 第 1 条），
stub 阶段不做点击行为、不伪造个人中心弹窗（同 13.13 砍按钮逻辑）。

### 13.15.2 验收

- 四闸门：tsc 零错误、vite 构建成功（index-YCay8mMG.js）、单测 50/50、打包 EXIT=0。
- asar（asar1315 提取后即删）：`agent-switcher`=2、`agent-switcher-item`=1、`user-card`=1、`user-name`=1、
  `app-settings`=1、`not-wired-yet`=1、四 logo 资产在；**`agent-list`=0（删除达成）**。
- **真实 exe 实测**（实例 2952）：
  截图 13.15-real-exe-initial.png（顶栏 OpenClaw 龙虾标+chevron，顶栏无齿轮，侧栏仅会话列表，
  左下用户卡「本地用户/stub 演示账户」+齿轮）→ 点 `agent-switcher` →
  截图 13.15-real-exe-switcher-open.png（菜单自顶栏左上下落，四官方 logo + 状态点）→
  点 `agent-switcher-item-claude-code` → 截图 13.15-real-exe-switched-claude.png（顶栏/工作台头部/状态栏/
  输出/占位符全部变 Claude Code，**菜单已自动收起**）→ 点左下 `app-settings` →
  截图 13.15-real-exe-settings-from-usercard.png（设置弹窗正常打开，cfg-* 11 项命中，密钥仍掩码）。
- **中途发现并修复两处**（修复后重打包重走查）：
  1. Popover 选中后不收起（radix 默认行为）——菜单挂顶栏后会挡住侧栏，改受控 `open/onOpenChange`，
     选中即 `setMenuOpen(false)`；UIA 菜单残留 0 验证；
  2. 输入框占位符切 Agent 后 UIA Name 恒为「向 OpenClaw 发送消息」（截图像素证明 DOM 占位符实际正确，
     Chromium 对 placeholder 派生的可访问名不刷新）——补动态 `aria-label="向 ${agent.name} 发送消息"`，
     UIA Name 恢复随 Agent 更新。
- **零净写入：15/15 哈希与基线一致**（diff 仅 launcher.log +1518 字节 = 两次启动关闭的正常日志）。
- 浏览器侧未单独重截：本轮为组件重排 + Props 接线，无资产路径改动，file://（更严一侧）已在 exe 覆盖。

### 13.15.3 新坑记录

1. **Chromium UIA Name 缓存**：`placeholder` 动态变化后，UIA 树里 Edit 的 Name 恒停留首挂载值
   （两次走查确认非树滞后），像素截图证明真实 DOM 已更新——动态占位符一律补 `aria-label` 作可访问名主源。
2. **`Launcher/App` 的 `npm test` 脚本指向不存在的本地 `tests/`**（一直静默跑 0 个）——修正为
   `node --test ../../tests/*.test.js`（根目录 50/50 与从 Launcher/App 运行结果一致，cwd 无关）。
3. **用户开着实例来提需求**：app.db 被运行中实例独占锁定 → 基线哈希 `Get-FileHash` 读不了；
   打包也会 ffmpeg.dll EPERM。流程改为：先关实例（无持久状态，stub 轮安全）→ 基线 → 打包 → 实测 → 关 → 终检。
4. **visual-judge 子代理不可用**（provider 未配置）：按协议降级为本体查验截图（四张全过：
   官方 logo 均渲染、无字母回退、无遮挡错位）。

## 13.16 追加裁决：开机自启全部 Agent + 删工作台启停栏 + 对标市面补全功能按钮

### 13.16.1 需求与实现

用户原话：「删除中间的agent启动状态栏，做成打开软件即开启所有agent，然后再对比市面上其他agent设置里
的内容去做功能按钮，内容要全」。

三段裁决：
1. **工作台头部启停栏整体删除**（logo/名称/状态徽标/启动/停止/重启/日志/置顶）——Agent 身份由顶栏
   切换器承担。两个功能性出口迁移：日志路径复制移到状态栏右侧（`app-open-logs`，应用级工具）；
   Agent 级置顶按钮随栏删除（由新增的**会话级置顶**取代，置顶逻辑服务层保留不删）。
2. **打开软件即开启全部 Agent**：hook 挂载后在 listAgents 之后对全部 Agent 逐个调用 `startAgent`
   （stub 状态机 800ms 后转 RUNNING，绿点全程可见）。**关键架构决策：自启走与手动启动完全相同的
   服务调用路径**——真接线轮服务层切 real 后，这段代码零改动即真实启动（进程归 pm 管）。
   stub 状态不冒充真实：状态栏「stub 演示模式」标识保留。
3. **对标市面补全功能按钮**（Cherry Studio / LobeChat / Chatbox 三款桌面客户端的会话管理标配 +
   ChatGPT/Claude Desktop 的应用级按钮，来源见下表）：

| 功能 | 对标来源 | 本轮落地 |
| --- | --- | --- |
| 会话搜索 | 三家标配（ChatGPT/Claude 同） | 侧栏搜索框 `session-search`，实时过滤，Ctrl+K 聚焦 |
| 会话重命名 | Cherry Studio 右键 / LobeChat | ⋯ 菜单 → 行内编辑（Enter/失焦提交，Esc 取消） |
| 会话置顶 | LobeChat 官方 RFC：置顶排顶部 | ⋯ 菜单 → pinSession，列表稳定排序置顶优先 |
| 会话删除 | 三家标配 | ⋯ 菜单 → **二次确认武装态**（首点变「再点一次确认删除」且菜单保持开） |
| 重新生成 | 三家标配 | 工具条 `agent-ctrl-regenerate`：重发最后一条用户消息，stub 流式出新回复 |
| 模型快速切换 | Chatbox/Cherry Studio 模型管理 | 工具条 chip `model-selector`，每 Agent 演示清单 3 项，切换即 toast |
| 检查更新 | ChatGPT/Claude Desktop | 顶栏 `app-check-updates`：图标旋转 800ms → toast「v1.0.0 已是最新（stub）」，不伪造更新内容 |
| 帮助/快捷键 | 主流客户端通用 | 顶栏 `app-help` Popover：Enter/Shift+Enter/Ctrl+N/Ctrl+K |
| 无会话时发送自动建会话 | ChatGPT 行为 | hook send 无 sessionId 时先 newSession |

**13.13 砍按钮裁决被本轮显式取代**：模型切换器/检查更新/帮助按用户「内容要全」要求回归（stub 形态，
反馈全部可见且带 stub 标识）。**刻意仍不做**：语音输入、附件上传（stub 无法给出有意义反馈，伪装即撒谎）；
主题切换（.dark 暗色 token 未按 Apple 规范补齐，草率上马会破坏已验收的浅色观感，列为候选）。

服务层新增（相对任务书接口的补充 #2~#7，全部进 real 骨架 throw not-wired-yet + 单测覆盖）：
`renameSession` / `deleteSession` / `pinSession`（会话三操作）、`listModels` / `getModel` / `setModel`
（模型切换）；`SessionMeta` 增 `pinned` 字段。真实通道映射：会话三操作 → agent:sessions 写操作；
模型三方法 → 既有 cfg 通道（接线轮）。

### 13.16.2 验收

- 四闸门：tsc 零错误、vite 构建成功（index-CQYFP8Fj.js）、**单测 52/52**（+2：会话管理、模型切换）、打包 EXIT=0。
- asar：**旧启停 Aid 六项零命中**（agent-ctrl-start/stop/restart/logs/pin、status-badge）——删除达成；
  新 Aid 全在（agent-ctrl-regenerate=1、model-selector=2、session-search=1、session-menu=4、
  app-check-updates=1、app-help=1、app-open-logs=1）；not-wired-yet=1。
- **真实 exe 实测**（实例 29568，启动后 ~2.5s 走查）：
  状态栏「OpenClaw · 运行中」（自启生效）；切换菜单四项全「运行中」（截图 13.16-real-exe-autostart-menu.png）；
  模型 chip 点击 → 三项菜单 → 选 llama-4-maverick → chip 与 aria 同步（13.16-real-exe-model-switched.png）；
  重新生成点击后同回复追加一组（UIA 文本计数）；
  会话 ⋯ 菜单置顶「示例任务」→ 跳顶带图钉（13.16-real-exe-session-pinned.png）；
  行内重命名（UIA SetValue + 失焦提交）→「日志体检（已改名）」；
  删除「日志走查」：首点武装成「再点一次确认删除」且菜单保持开（13.16-real-exe-delete-armed.png），
  再点确认 → 条目消失，当前会话自动落到剩余第一条（置顶的示例任务）；
  帮助 Popover 四快捷键（13.16-real-exe-help.png）；
  检查更新 → toast「v1.0.0 已是最新（stub 演示，未联网检查）」（13.16-real-exe-check-updates-toast.png，
  同框可见：无启停栏的工具条、置顶会话、模型 chip、状态栏日志钮）。
- **零净写入：15/15 哈希与基线一致**（diff 仅 launcher.log +759 字节 = 一次启动关闭 + 用户实测日志）。
- **用户实测插曲（如实记录）**：走查期间用户在真 exe 里手动发送了「1」，stub 正常回显+响应——发送链路
  被真实用户操作二次验证。另：走查脚本一次「点击搜索框」的坐标落在了当时展开的切换菜单 Hermes 项上，
  意外完成了一次 Agent 切换——反向验证了跨 Agent 模型态隔离（chip 正确切到 hermes-4-405b）。

### 13.16.3 新坑记录

1. **UIA 坐标点击撞上瞬时弹层**：uiaclick 的坐标兜底点击前必须先确认目标弹层已收起——本轮点击
   「搜索框」时切换菜单仍开着，(526,386) 恰落在 Hermes 菜单项上。后续走查脚本应先 Escape/收起再点坐标。
2. **UIA SetValue 对 React 受控输入有效**（Chromium 把 ValuePattern 转成 input 事件），行内重命名
   的提交（Enter/失焦）在 UIA 驱动下正常触发——可复用的测试手法。
3. **radix DropdownMenuItem 的 onSelect preventDefault** 可保持菜单打开——「二次确认删除」武装态
   依此实现，无需自建弹层。

## 13.17 UI 重构 + 功能接口预留（先 UI 后真实 Agent；任务书 45 条全量落地）

**输入**：用户提供的《AI Agent 母盘——UI 重构与功能接口预留任务》（豆包任务书格式，45 节）。
与 13.15/13.16 已完成项高度重叠（Logo=切换器、开机自启、无启停栏、会话管理、模型切换），
本轮落地其新增裁决并把全部按钮/页面/数据结构/服务接口补齐。

### 需求与实现
| 任务书条款 | 实现 |
| --- | --- |
| §五 切换器菜单=logo+名+描述+选中态 | AgentSummary 增加 `desc`；菜单项双行+「当前」勾标；在线状态点移除（§六禁令） |
| §七 顶栏右=🔍🔔⋯ | `app-search`（会话/任务/文件分组结果）+ `app-notifications`（Mock 通知+蓝点）+ `app-more`（检查更新/快捷键子菜单/导入/导出配置/打开日志/关于）；中部会话名移除（§八：归工作台） |
| §八/§九 工作台顶部只留会话名+⋯ | `workbench-menu`：重命名（行内 input）/导出 md/json（子菜单）/清空/删除（二次确认）；模型 chip 与 regenerate 从工具条移除 |
| §十/§十一 侧栏导航+左下用户区 | `side-nav` 四入口（会话/任务/文件/队列）→ 主区视图切换；用户块弹出 个人资料/账户/使用情况/退出登录（stub toast，使用情况→设置弹窗）+ 设置行 |
| §十二 删底部 StatusBar | StatusBar.tsx 删除，`status-bar*` 零命中；日志入口迁 ⋯ 菜单；stub 标识迁通知中心首条 + 各 toast |
| §十三~§十六 输入框重做 | ChatInput 组件：＋菜单（上传文件/文件夹/图片/代码，stub toast）、📎、dragover/drop 接口（drop→内存附件 chips，不读内容）、model-selector 入框右下角、发送 ↑ ⇄ 生成中 ■ |
| §十七~§二十三 每轮回复带转交 | RecommendationCard（推荐目标+匹配度+理由+转交钮，stub 确定性映射）+ TransferDialog（radio 组：推荐星标默认选中/当前 Agent disabled 明示禁令 §二十一/三附带 checkbox；状态机 idle→submitting→success→error）；TransferPayload 结构定死服务层 |
| §二十四~§二十六 任务/队列/文件 | TaskPanel（五状态徽标+打开会话跳转）、QueuePanel（队列位置+规则说明）、FilePanel（7 列+行菜单 5 操作 stub toast）；种子数据演示全部状态 |
| §二十七 Settings | 既有设置弹窗三组件 **不动**（13.13 硬规则 6）；入口映射：账户→用户菜单(stub)、API→弹窗、模型→输入框、任务/文件→面板、快捷键→⋯子菜单、关于→⋯→设置弹窗 |
| §三十四/§三十五 类型+服务 | agent-control-types 增 Task/QueueEntry/FileItem/TransferPayload/AgentRecommendation/AppNotification/TaskStatus/NotificationKind；服务接口 +8 方法（listTasks/listQueue/listFiles/getRecommendation/transferTask/listNotifications/stopGeneration + listModels 组已存）；stub 实现 + real 骨架 notWired + 通道映射表新行（task:list/queue、file:list、agent:transfer/recommend、task:events、agent:input stop） |
| §十六 停止生成 | stub sendInput 改「代数戳 + 可中断 sleepGen」：stopGeneration 自增 genSeq，打字机分片在下一轮询片退出并落定「（已停止生成（stub））」；hook 暴露 generating + stopGeneration，send/regenerate 共用 |
| §三十一 响应式 | 默认窗口 1281×801（>720 最低要求），全 flex+min-w-0 布局，输入框 max-h-40 自适应 |

### 刻意的设计取舍
- **帮助并入「快捷键」子菜单 +「关于」**：任务书 §七 列了 快捷键 与 帮助 两项，内容完全重叠
  （13.16 帮助=快捷键面板），合并避免重复入口；「关于」直接打开既有设置弹窗（about 面板在其中）。
- **消息级 ⋯ 不做**：任务书 §十七 mockup 有「复制 重新生成 ⋯」但未定义 ⋯ 内容（§三十八-10 禁止
  自定需求），只做 复制/重新生成，且仅挂在最后一条 agent 消息下（stub regenerate 只能重发最后输入）。
- **当前 Agent 用 disabled 而非隐藏**（§二十一允许二选一）：disabled 能把规则「看得见」。
- **转交成功后不切 Agent**：任务书语义是任务进入目标队列，不是切换工作上下文；通知+任务页可查。
- **面板挂载即拉数据**（svc.listTasks 等）：视图切换即刷新，转交后重进任务页可见新任务；
  通知列表在 hook 持有，转交后即时刷新。

### 走查中发现并修复
1. **stub listAgents 映射漏 desc**：首包真机走查发现切换菜单只有名称没有描述行（类型有字段、
   种子有文案、映射漏字段）。修复+补单测断言（desc 非空）→ 重建重打包复验通过。
   教训：UIA 可访问名是逐字拼接的文本，缺一行在 walk 输出里一目了然。

### 新坑
1. **radix Popover 的 UIA ExpandCollasePattern Expand() 不总即时生效**：首次 Expand 后 0.6s walk
   可能仍无菜单项，再 Expand 一次（幂等）后出现——走查脚本对 Popover 触发钮固定「点两次+walk」。
2. **UIA SetValue 写入会被受控重渲染清空**：textarea 的 value 被下一次 React 渲染重置为 state（''），
   SetValue→延迟点击发送 会发空消息。可靠做法=SetFocus+SendKeys 真实键入。
3. **截图进程启动耗时 ~1s 吃掉 stub 1.1s 生成窗口**：抓「生成中」画面必须预编译捕获类型并在
   同一 PS 进程内 SendKeys→立即 Cap（capture-during-1317.ps1）。
4. **.ps1 UTF-8 BOM 老坑复发**：无 BOM 的中文脚本在 PS5.1 下按 ANSI 解析直接语法错误（再入规范）。

### 验收（对照任务书 §四十一 checklist 全绿 + §四十二 质量项）
- tsc 0 错误；vite build 通过（index-joduMSl7.js 441.33KB）；node --test 57/57（含 13.17 五个新测试组：
  任务/队列/文件种子、推荐映射、转交登记+禁自转交、stopGeneration 中断/幂等、工厂契约 +8 方法、
  real 骨架 +8 notWired）。
- asar 核查：新 Aid 全命中（app-search/app-notifications/app-more/transfer-dialog/agent-ctrl-stop/
  view-task|queue|files/recommendation-card/workbench-menu/chat-add-*/attachment-chip/…，nav-* 为动态
  模板 `nav-${id}` 已确认）；禁令 Aid 零命中（status-bar*/agent-ctrl-start|restart|pin|logs/agent-list-item）。
- 真机 exe（1281×801）UIA 走查：切换器菜单(desc+当前)→切换→aria-label 跟随；发送→回显→流式→
  推荐卡→转交弹窗→确认转交→成功态+toast；通知中心蓝点+转交通知；任务页 5 状态演示+打开会话跳转；
  队列页位置连续；文件页行菜单；顶栏搜索分组命中；⋯ 六项+检查更新 toast+快捷键子菜单；＋菜单 4 项；
  模型切换入框生效；发送→■ 停止（生成中截图实锤，中断逻辑单测覆盖）；用户菜单 4 项。截图 15 张
  于 _verify/1317-real-exe-*.png（gitignore）。
- 零净写入：15 文件基线前后一致（providers.json 两轮均 MISSING 一致）；launcher.log +1518B=本次
  启停事件日志（既有豁免）。走查期间任务页出现 3 条转交记录（本脚本 1 条 + 疑似用户同时在实机上
  点击 2 条），应用状态全程一致，恰为「每轮回复可转交」的真实多用户验证。
- 打包前后均需 Stop-Process AI-Agent（用户实例 5 PID / 本轮复验 1 PID）。

### 未完成 / Mock 清单（任务书 §四十四.5，下一轮接线）
- 全部面板与通知为 stub 内存数据：任务/队列/文件的真实来源（Agent 工作目录、任务状态机）待接线轮；
- 附件上传/＋菜单/文件面板操作均为 stub toast 或内存登记，真实文件管线待接线轮；
- 转交只登记 stub 任务，不向真实 Agent 发送；推荐为确定性映射，真实推荐待接线轮；
- 新通道 task:list/queue、file:list/export、agent:transfer/recommend、task:events、agent:input-stop
  均未在 preload/main 实现（real 骨架 throw not-wired-yet）；
- 用户身份为 stub 展示（登录接线轮 13.6-1 会把用户菜单变成真实身份）。

## 13.18 设置中心（任务书全量：18 项导航 + 模型页全量 + stub 接口预留）

**输入**：用户下发的《13.18 轮任务书：设置中心（Settings）》——只做设置弹窗 UI 重构 + 服务接口
预留，数据全 stub，延续 13.17「先 UI 后真实 Agent」。

### 需求与实现
| 任务书条款 | 实现 |
| --- | --- |
| §一 入口与容器 | SideBar 设置行 → SettingsDialog（React 覆盖层，非 BrowserWindow）；左 200px 导航 + 右滚动内容；顶边居中「搜索 Ctrl K」玻璃胶囊；✕/Esc/点遮罩三等效；关闭不丢改动（状态在服务层内存态，重开即恢复） |
| §二 左导航 18 项 | SettingsNav：模型/对话/外观/工作区/安全/Browser/记忆与上下文/语音/高级/通知/账单/提供方/网关/键盘快捷键/工具与密钥/插件/已归档对话/关于，图标语义相近，AID=settings-nav-<id>，默认落 models |
| §3.1 模型页全量 | 说明文字；提供方/模型下拉（随提供方联动）+ 蓝色「应用」；「默认值 推理 低/中/高」；辅助模型区块（8 行：视觉/压缩/技能中心/审批/MCP/标题生成/评审/维护器，状态行 自动·使用主模型 ⇄ 已指定·<模型>，行内 设为主模型/更改，顶部 全部重置为主模型）；Mixture of Agents（英文说明 + 预设下拉） |
| §3.1.4 双层隔离 | 「应用」只写 settings 层 stub；对话级 setModel（输入框切换器）不受影响——真机实证：应用后 toast 出现且输入框 chip 仍 qwen 3.8 27B；双向单测钉死 |
| §3.2 其余 17 页 | 已归档对话（恢复/删除即移除+toast）、键盘快捷键（只读表格，只列真实存在的 5 条）、关于（名称/版本 1.0.0/构建时间 stub/开源致谢）；其余 14 页统一 PlaceholderPage（图标+标题+「本页将在后续版本提供」，零假控件） |
| §3.3 顶部搜索 | 胶囊点击或 Ctrl+K 展开 SearchOverlay；范围=18 导航项+8 辅助任务+MoA；分组 设置页/模型设置；辅助任务命中→跳模型页+该行高亮 2s（真机跳转已验证，2s 高亮窗口短于截图链路延迟，代码路径与单元逻辑由 jumpTo+timeout 保证） |
| §四 服务接口 | +10 方法：listSettingsSections（18 id 顺序契约）/listSettingsProviders（模型名复用 13.17 STUB_MODELS，无第二套名字）/get-setMainModelConfig（校验 提供方存在/模型属方/推理枚举）/listAuxModels/setAuxModel(null=重置)/resetAllAuxModels/listArchivedSessions/restore/delete。real 骨架全部 notWired；通道表补 settings:get/update、archive:list/restore/delete |
| §五 组件结构 | settings/：SettingsDialog/SettingsNav/SearchOverlay/pages/{Models,Archived,Hotkeys,About,Placeholder}Page；零新依赖（radix DropdownMenu + 手写控件沿用） |

### 关键裁决与最小改动
- **既有 SettingsModal（API/用量/关于三组件）原样保留**：新设置中心无 API/用量页，真实用量数据
  只在旧 modal —— 用户菜单「使用情况」改指旧 modal（SideBar 新增 onOpenUsage 一个 prop，除此
  外 13.17 交付组件零改动）；顶栏 ⋯「关于」改指新弹窗 about 页。
- **Ctrl+K 双语义**：主界面=会话搜索（SideBar），设置弹窗内=设置搜索。实现=dialog 以 capture 阶段
  window 监听 + stopPropagation 抢在 SideBar 的 bubble 监听之前；同时屏蔽 Ctrl+N（下层交互锁死）。
- **Esc 归属**：radix 弹层开着时（检测 [data-radix-popper-content-wrapper]）Esc 先归菜单；
  否则先收搜索再关弹窗。
- **辅助「更改」取值域=当前主提供方模型清单**（任务书「与主模型同源」），stub 校验拒绝外方模型。

### 新坑
1. **TS 收窄进不了函数声明**：ModelsPage 的 `if (!draft) return` 守卫对后续 function 声明内的
   state 引用无效（TS2345）——收窄后先落到局部常量（saved/d）再写闭包。
2. **UIA FindFirst 偶发竞态**：主界面元素明明在树里，首次 FindFirst NOT_FOUND、复跑即中——
   走查脚本对「NOT_FOUND 但应存在」一律先重跑一次再下结论。
3. 2s 高亮窗口短于「点击→截图」链路延迟（~3s），真机截图抓不到高亮帧；高亮为纯 CSS 类切换，
   由 jumpTo 的 setTimeout 保证——后续如需可视化，把窗口放宽到 3s 即可。

### 验收（任务书 §七 全绿）
- tsc 0 错误；build 通过（index-D1qhP5bx.js 470.90KB）；node --test 61/61（新增 4 组：18 项顺序
  契约、主模型校验+同源+**双层隔离双向断言**、辅助 8 行固定+指定/重置/全重置+同源拒绝、归档恢复/
  删除+防呆；real 骨架 +10 notWired；工厂契约 +10 方法）。
- asar 核查：settings-dialog/settings-nav/settings-provider-select/settings-model-select/settings-apply/
  settings-reasoning-select/aux-reset-all/archived-restore/moa-preset-select/settings-search-*/
  hotkey-row/about-version 全命中；动态模板 settings-nav-${id}/aux-row-${taskId}/
  settings-placeholder-${sectionId} 确认存在。
- 真机 exe（PID 6376，1281×801）走查：设置打开落 models 页；18 项导航齐全且顺序正确；提供方
  sensenova→anthropic 联动模型清单；选 opus→应用→toast+输入框 chip 不变（隔离实锤）；推理 中→应用；
  视觉任务 更改→claude-haiku-4→状态「已指定」→设为主模型→恢复「自动」；归档恢复→行移除+toast；
  Ctrl+K→搜「评审」→跳模型页；14 占位页逐一渲染；快捷键/关于页正常；✕ 与 Esc 均可关闭。
  截图 10 张于 _verify/1318-settings-*.png。
- 零净写入：15 文件基线前后一致；launcher.log +759B=本次启停事件（既有豁免）。

### 未完成 / Mock（下一轮接线）
- 设置 10 方法全 stub 内存态：主模型配置/辅助绑定不落盘、不写 providers.json；重启应用即回默认；
- 提供方清单为演示分组（模型名与 13.17 同源），真实 provider 缓存接线轮统一；
- MoA 预设为演示值；占位 14 页待后续版本逐页实装；构建时间为 stub 注入。

## 13.19 更换 Codex / Claude Code logo（用户提供图）

- 用户给图：Codex=蓝云+终端符（下载.jpg，JPG 棋盘格假透明）；Claude Code=橙色星芒（PNG 白底不透明）。
- 处理：PIL 从边缘 BFS 泛洪抠底 → 真透明 PNG（codex.png 119×118、claude-code.png 148×148）。
  阈值：codex 浅色中性（≥205 且 RGB 差≤30，棋盘白/浅灰全吃掉、蓝云保留）；claude 近白（≥235）。
  云朵内部的白色终端符不与边缘连通，泛洪不会吃掉。
- 变更：LOGO_SRC 指向新 PNG；删除 codex.svg / claude-code.ico。唯 13.14「官方站点获取」来源说明
  自本轮起按用户裁决覆盖（NOTES 留痕）。
- 验收：tsc/build 通过（index-CDYPHL0F.js）；真机走查——切换菜单(xs)、顶栏(md)、推荐卡(xs) 三处
  渲染干净（无字母回退、无棋盘格残留、透明底正常），截图 3 张 _verify/1319-*.png；
  零净写入基线一致。commit 12d2b4c。
- 注意：pip 装了 pillow（12.3.0）仅作一次性资产处理工具，非项目依赖（package.json 零变化）。

## 13.20 四 Agent 全量能力接口兼容层 + Hermes 全量设置映射（任务书全量）

> 注：任务书原文自标题为「13.19 轮」，但 13.19 已被 logo 更换轮占用，本轮按序记为 13.20。

### 需求与实现
| 任务书要求 | 实现 |
| --- | --- |
| §二 AGENT-SOURCES | docs/AGENT-SOURCES.md：四 Agent 官方仓库/文档/锁定版本/入口/配置面；版本全部实测取证（openclaw 2026.9.5、hermes 0.21.4 upstream c0d7294、codex 0.156.1、claude-code 2.1.288） |
| §三 Capability Matrix | docs/AGENT-CAPABILITY-MATRIX.md + capabilities/*.ts：20 组 × 133 条能力 id 四 Agent 同名同义（单测钉死），五态 native/adapter/permission-required/sandbox-only/unsupported，每条带官方 source |
| §四 Capability 类型 | services/agent-capability-types.ts（纯类型） |
| §五 统一接口 | agent-control-types.ts +11 方法：getInfo/getCapabilities/archiveSession/checkUpdate/testProvider/getSettingsSchema/get/set/reset/export/importSettings；stub 全实现、real 全 notWired（通道表补 6 行） |
| §六 每 Agent Adapter | 适配现有 services/ 结构：services/capabilities/{hermes,openclaw,codex,claude-code,index,info}.ts（不重构 agents/ 目录；src/core/adapters/*.js 零改动） |
| §七/§八 Hermes 设置 | docs/HERMES-SETTINGS-MATRIX.md：25 类 451 条（官方 Key/类型/默认值/可选值/作用/文件/Secret/Runtime/Restart/Source），数据源=本地官方源码包 config_defaults.py + cli-config.yaml.example + 本机 config.yaml diff（仅 6 处差异） |
| §九 三层分离 | 矩阵文档列清 Hermes 原生 / 聚合器 / 聚合器安全 三清单 |
| §十 Secret | CredentialService 接口 + stub（内存态）：getCredential 只回 configured+掩码；单测断言序列化结果不含明文；testCredential 明确报「未真实校验」 |
| §十一 状态标记 | AgentSettingsField.status = implemented/planned/advanced/native-only；本轮 UI 零改动（任务书允许） |
| §十二 显隐裁决 | 统一裁决=「显示但明确标记不支持」（docs/AGENT-CAPABILITY-UI-MAP.md §0，三条理由） |
| §十三 Transfer 能力化 | canAcceptTransfer 门控：transferTask 按目标能力拒绝（含人话 reason）；getRecommendation 按「全部附带内容」最坏假设过滤 |
| §十四 UI 映射 | docs/AGENT-CAPABILITY-UI-MAP.md：能力组→UI 落点全表 + 新增 Agent 五步操作顺序 |
| §十八/§十九 | 四份 MD 全部产出；按报告格式输出 |

### 关键裁决
1. **能力基线=锁定版本**，官方最新（openclaw 2026.9.8 / codex 0.160.0 / claude-code 2.1.289 / hermes 上游 7900+ commits）只记差异注记。
2. **Hermes 依据=本地官方源码**（最可靠）；其余三家=官方文档；第三方教程一律不作依据。
3. **unsupported 不伪造**：testProvider/checkUpdate/凭据 test 的 stub 一律 ok=false+说明，绝不伪造成功。
4. 接口按矩阵裁剪：任务书 §五 清单中 listProviders≈已有 listSettingsProviders、createSession≈newSession 等，不重复造方法（任务书授权「不得为接口数量制造无意义方法」）。

### 调研反直觉发现（官方文档明确，已写入矩阵）
- Claude Code **有** /voice 听写（需 claude.ai 账户）与 channels（Telegram/Discord 预览版）；macOS CLI 有内置 computer-use MCP（research preview）——Windows CLI 才是键鼠屏幕 ✗。
- OpenClaw 配置官方格式是 **JSON5 openclaw.json**（非 yaml）；桌面控制是真原生 computer.act 视觉循环（Windows 为实验性 cua-computer）；transfer.receive 是 native（webhooks/A2A/RPC）。
- Codex CLI 沙箱只覆盖 shell/文件系统/网络；浏览器/GUI 属 Codex App；有官方 config-schema.json。
- Hermes 本机 config.yaml **零明文密钥**：Launcher 经 DPAPI 解密后以 HERMES_LAUNCHER_API_KEY 环境变量注入，config 只引用变量名。

### 新坑
- 并发子代理限额：同时跑 5 个（后 3 个）/4 个（后 2 个）都会「user concurrency limit exceeded」——≥3 并发即失败，2 并发安全；失败任务需串行重发。
- capabilities/ 子目录 import 路径：'./agent-capability-types.ts' 应为 '../'（tsc TS2307）。
- ConfigFileLocation 需补 'openclaw.json' 枚举（OpenClaw 官方格式纠偏的连锁）。
- 描述写「同上」会挂测试非空断言（≥6 字符）——描述必须自包含。

### 验收
- 单测 77/77（61 旧不降 + 16 新：20 组顺序契约、133 id 四家一致、unsupported 如实性锚点、adapter 锚点、门控拦截/放行、Hermes Schema、Secret 拒入+导出剔除、凭据明文零出口、archiveSession、checkUpdate/testProvider 防伪）。
- tsc 0 errors；vite build 通过（index-BvxTiZVC.js）；重打包后 asar 内 grep 到 transfer.receive×6/not-wired-yet/新文案，logo 齐全。
- 真机：PID 23368 启动，UIA 关键 Aid（agent-switcher/model-selector/agent-ctrl-send/app-settings/input-box/side-nav）全在；设置中心开/关（app-settings 点击→settings-dialog→Esc）正常；同帧截图可见双层隔离未破（设置层 glm-5.3 vs 输入框 qwen 3.8 27B）。
- 零净写入：14 文件基线前后一致（launcher.log 豁免=本次启停事件）。

### 未完成 / Stub 边界（下一轮接线）
- capabilities 数据为「静态知识层」：真接线轮按 AGENT-CAPABILITY-MATRIX 通道表接入真实探测（agent:info、update:check、provider:test、settings:native、credential:*）。
- CredentialService stub 仅内存；真实实现走系统安全存储（DPAPI 已有先例）。
- 14 个占位设置页待后续版本；设置页字段级渲染（implemented/planned/advanced）按 UI-MAP 在接线轮落地。
- codex/claude-code 最新版本号会漂移，接线轮应改为动态探测。
