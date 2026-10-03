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
