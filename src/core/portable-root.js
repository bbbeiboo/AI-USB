/**
 * PORTABLE_ROOT —— 便携根目录动态推导。
 *
 * 规则（禁止硬编码盘符 E:\ F:\ C:\）：
 *   1. 环境变量 PORTABLE_ROOT 显式覆盖（测试/调试用）。
 *   2. 打包发布（AI_USB_PACKAGED=1）：根目录 = 可执行文件所在目录。
 *      - Windows NSIS/portable：exe 就在 <root>/ 下 → dirname(exe)
 *      - macOS：<root>/AI-USB.app/Contents/MacOS/AI-USB → 往上 3 级
 *      - Linux AppImage：实际路径在 $APPIMAGE，挂载点是临时的 → dirname(APPIMAGE)
 *   3. 开发态：本文件位于 <root>/src/core/portable-root.js，根目录向上两级。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * 打包态根目录推导（可注入参数以便跨平台单元测试）。
 * @param {object} o { execPath, platform, appimage, portableDir, pathMod }
 */
export function resolvePackagedRoot({
  execPath = process.execPath,
  platform = process.platform,
  appimage = process.env.APPIMAGE,
  portableDir = process.env.PORTABLE_EXECUTABLE_DIR,
  pathMod = path,
} = {}) {
  // Windows NSIS portable：自解压到 %TEMP%，PORTABLE_EXECUTABLE_DIR 指向用户放置 exe 的真实目录
  if (portableDir) {
    return pathMod.resolve(portableDir);
  }
  if (platform === 'linux' && appimage) {
    return pathMod.dirname(appimage);
  }
  if (platform === 'darwin') {
    // <root>/AI-USB.app/Contents/MacOS/AI-USB → 向上 3 级到 .app 的父目录
    return pathMod.resolve(pathMod.dirname(execPath), '..', '..', '..');
  }
  // Windows 安装版 / Linux 其他：exe 就在 <root>/ 下
  return pathMod.dirname(execPath);
}

export function resolvePortableRoot() {
  if (process.env.PORTABLE_ROOT) {
    return path.resolve(process.env.PORTABLE_ROOT);
  }
  if (process.env.AI_USB_PACKAGED === '1') {
    return resolvePackagedRoot();
  }
  // 开发态：本文件 <root>/src/core/ → 根目录向上两级
  return path.resolve(__dirname, '..', '..');
}

/** 以 PORTABLE_ROOT 为基准拼出子路径。 */
export function portablePath(...segments) {
  return path.join(resolvePortableRoot(), ...segments);
}
