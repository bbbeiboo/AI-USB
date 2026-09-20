/**
 * 单一版本源：从 package.json 读取版本号。
 * 所有需要展示/上报版本的地方统一走此函数，避免多处硬编码。
 */
import fs from 'node:fs';
import path from 'node:path';
import { resolvePortableRoot } from './portable-root.js';

export function getVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(resolvePortableRoot(), 'package.json'), 'utf8'));
    return pkg.version;
  } catch {
    return 'unknown';
  }
}
