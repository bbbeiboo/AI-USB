// ============================================================================
// BOM tolerance test (task 1: "BOM 容错") — standalone, no Electron window.
//
//   run from the project root:
//     node Launcher\App\bom-tolerance_test.cjs
//
// What it proves
//   1. readJsonSafe() (Launcher/App/json-util.js) parses JSON that starts with a
//      UTF-8 BOM; a plain JSON.parse of the same text throws — that difference is
//      the bug this task fixes.
//   2. loadUserConfig() — the REAL one from main.js — loads a BOM'd
//      Launcher/Config/user-config.json with every field intact and writes
//      `[config] stripped BOM from user-config.json` to the launcher log, instead
//      of silently falling back to the empty default configuration.
//   3. The same tolerance holds for the other JSON config read points:
//      loadManifest() (Build/Config/agents.json), bundledProvider()
//      (config/providers.json) and UsageStore.loadPricing()
//      (Launcher/Config/pricing.json).
//   4. A BOM-less file is parsed without a `stripped BOM` log line, and readJsonSafe
//      still behaves like the old try/catch (missing file / invalid JSON ->
//      default value; strict mode throws EUNREADABLE / EINVALIDJSON).
//   5. Every real config file this test rewrites is restored byte-for-byte and is
//      left BOM-free afterwards.
//
// main.js is the Electron main process, so `electron` is stubbed before it is
// required (app.whenReady() deliberately never resolves, so no window is created
// and none of the whenReady side effects run).
// ============================================================================
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const BOM = '\uFEFF';
const BOM_BYTES = Buffer.from([0xEF, 0xBB, 0xBF]);

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; failures.push(name + (detail ? ' -> ' + detail : '')); console.log('  FAIL  ' + name + (detail ? ' -> ' + detail : '')); }
}

// --- stub `electron` so main.js can be required outside Electron -------------
const electronStub = {
  app: {
    isPackaged: false,
    requestSingleInstanceLock: () => true,
    whenReady: () => new Promise(() => {}),   // never resolves: no window, no IPC side effects
    on: () => {}, quit: () => {}, exit: () => {},
  },
  BrowserWindow: Object.assign(function BrowserWindow() { return { on(){}, loadFile(){}, show(){}, focus(){}, isDestroyed: () => true, webContents: { send(){}, on(){} } }; },
                                { getAllWindows: () => [] }),
  ipcMain: { handle: () => {}, on: () => {} },
  shell: { openPath: () => {}, showItemInFolder: () => {} },
  Tray: function Tray() { return { setToolTip(){}, setContextMenu(){}, on(){}, destroy(){} }; },
  Menu: { buildFromTemplate: () => ({}), setApplicationMenu: () => {} },
  nativeImage: { createEmpty: () => ({ isEmpty: () => true }), createFromDataURL: () => ({}) },
};
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return electronStub;
  return origLoad.apply(this, arguments);
};

const main = require('./main.js');
const { readJsonSafe, stripBom } = require('./json-util.js');
const { UsageStore } = require('./usage.js');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-usb-bom-'));
const t = (name, content) => { const p = path.join(tmpDir, name); fs.writeFileSync(p, content, 'utf8'); return p; };

function logText() { try { return fs.readFileSync(main.getLogPath(), 'utf8'); } catch (_) { return ''; } }

// Every file we rewrite is kept as raw bytes and restored in the finally block.
const restores = [];
function snapshot(p) {
  const existed = fs.existsSync(p);
  restores.push({ p, existed, bytes: existed ? fs.readFileSync(p) : null });
}
function restoreOne(p) {
  const r = restores.find((x) => x.p === p);
  if (!r) return false;
  try {
    if (r.existed) fs.writeFileSync(p, r.bytes);
    else if (fs.existsSync(p)) fs.unlinkSync(p);
    return true;
  } catch (e) { console.log('  WARN  restore failed for ' + p + ': ' + e.message); return false; }
}
function restoreAll() { for (const r of restores) restoreOne(r.p); }

(async () => {
  main.ensureLogDir();
  const LOG = main.getLogPath();
  console.log('== BOM tolerance test ==');
  console.log('  root = ' + main.ROOT);
  console.log('  log  = ' + LOG);
  console.log('');

  // --- T1: the bug itself ---------------------------------------------------
  console.log('== T1: a UTF-8 BOM defeats plain JSON.parse (the bug) ==');
  const sample = '{"version":1,"agents":{"codex":{"model":"m"}}}';
  let plainThrew = false;
  try { JSON.parse(BOM + sample); } catch (_) { plainThrew = true; }
  check('JSON.parse(BOM + json) throws', plainThrew);
  const p1 = t('plain.json', BOM + sample);
  const parsed1 = readJsonSafe(p1, { defaultValue: null });
  check('readJsonSafe(BOM + json) parses', !!parsed1 && parsed1.version === 1, JSON.stringify(parsed1));
  check('readJsonSafe keeps nested fields', !!parsed1 && parsed1.agents.codex.model === 'm');

  // --- T2: callback + no-BOM path ------------------------------------------
  console.log('== T2: onStrippedBom fires only for a real BOM ==');
  const seen = [];
  readJsonSafe(p1, { onStrippedBom: (p) => seen.push(p) });
  check('callback called once for BOM file', seen.length === 1 && seen[0] === p1, JSON.stringify(seen));
  const p2 = t('nobom.json', sample);
  const seen2 = [];
  const parsed2 = readJsonSafe(p2, { onStrippedBom: (p) => seen2.push(p) });
  check('BOM-less file parses normally', !!parsed2 && parsed2.version === 1);
  check('no callback for BOM-less file', seen2.length === 0);
  check('stripBom is a no-op without a BOM', stripBom(sample) === sample);

  // --- T3: old try/catch semantics preserved -------------------------------
  console.log('== T3: fallback semantics (missing / invalid / strict) ==');
  const missing = path.join(tmpDir, 'does-not-exist.json');
  check('missing file -> defaultValue', readJsonSafe(missing, { defaultValue: 'D' }) === 'D');
  const p3 = t('broken.json', BOM + '{"version":');
  check('invalid JSON -> defaultValue', readJsonSafe(p3, { defaultValue: 'D' }) === 'D');
  let code = '';
  try { readJsonSafe(missing, { strict: true }); } catch (e) { code = e.code; }
  check('strict + missing -> EUNREADABLE', code === 'EUNREADABLE', code);
  code = '';
  try { readJsonSafe(p3, { strict: true }); } catch (e) { code = e.code; }
  check('strict + invalid JSON -> EINVALIDJSON', code === 'EINVALIDJSON', code);

  // --- T4: the real loadUserConfig() with a BOM'd user-config.json ---------
  console.log('== T4: loadUserConfig() on a BOM\'d user-config.json ==');
  const bakPath = main.USER_CONFIG + '.bak';
  const hadBak = fs.existsSync(bakPath);
  snapshot(main.USER_CONFIG);
  snapshot(bakPath);
  const cfg = { version: 1, agents: {} };
  for (const id of main.CONFIG_IDS) cfg.agents[id] = { provider: '', baseUrl: '', model: '', enabled: false };
  cfg.agents.openclaw = { provider: 'openai-compatible', baseUrl: 'https://openrouter.ai/api/v1', model: 'qwen 3.8 27B', enabled: true };
  cfg.agents.codex = { provider: 'openai-compatible', baseUrl: 'https://bom-marker.invalid/v1', model: 'bom-model-1', enabled: true, apiKey: 'sk-must-not-survive' };
  // Exactly what `Set-Content -Encoding UTF8` (Windows PowerShell 5.1) produces.
  fs.writeFileSync(main.USER_CONFIG, BOM + JSON.stringify(cfg, null, 2), 'utf8');
  const onDisk = fs.readFileSync(main.USER_CONFIG);
  check('file on disk starts with EF BB BF', onDisk.slice(0, 3).equals(BOM_BYTES), onDisk.slice(0, 3).toString('hex'));

  const before = logText().length;
  const loaded = main.loadUserConfig();
  const delta = logText().slice(before);
  check('parse succeeded (not the empty default)', loaded.version === 1 && !!loaded.agents);
  check('codex.model intact', loaded.agents.codex.model === 'bom-model-1', loaded.agents.codex.model);
  check('codex.baseUrl intact', loaded.agents.codex.baseUrl === 'https://bom-marker.invalid/v1', loaded.agents.codex.baseUrl);
  check('codex.enabled intact', loaded.agents.codex.enabled === true);
  check('openclaw entry preserved', loaded.agents.openclaw.model === 'qwen 3.8 27B');
  check('untouched agent keeps its default', loaded.agents.hermes.model === '' && loaded.agents.hermes.enabled === false);
  check('apiKey still stripped defensively', loaded.agents.codex.apiKey === undefined);
  check('log line "[config] stripped BOM from user-config.json"', delta.includes('[config] stripped BOM from user-config.json'), JSON.stringify(delta.trim()));
  check('no corrupt-fallback .bak created', hadBak || !fs.existsSync(bakPath));
  if (delta.trim()) console.log('  log fragment: ' + delta.trim().split('\n').join(' | '));

  // --- T5: a BOM-less user-config.json logs nothing ------------------------
  console.log('== T5: BOM-less user-config.json stays silent ==');
  fs.writeFileSync(main.USER_CONFIG, JSON.stringify(cfg, null, 2), 'utf8');
  const before5 = logText().length;
  const loaded5 = main.loadUserConfig();
  const delta5 = logText().slice(before5);
  check('BOM-less config loads with fields intact', loaded5.agents.codex.model === 'bom-model-1');
  check('no "stripped BOM" line for a BOM-less file', !delta5.includes('stripped BOM'), JSON.stringify(delta5.trim()));

  // --- T6: other read points (manifest / providers / pricing) --------------
  console.log('== T6: other JSON config read points tolerate a BOM ==');
  snapshot(main.AGENTS_JSON);
  const manifestBytes = fs.readFileSync(main.AGENTS_JSON);
  const manifestText = stripBom(manifestBytes.toString('utf8'));
  const manifestExpected = JSON.parse(manifestText);
  fs.writeFileSync(main.AGENTS_JSON, BOM + manifestText, 'utf8');
  const before6 = logText().length;
  let manifest = null, manifestErr = '';
  try { manifest = main.loadManifest(); } catch (e) { manifestErr = main.safe(e); }
  const delta6 = logText().slice(before6);
  check('loadManifest() on BOM\'d agents.json', !!manifest && manifest.agents.length === manifestExpected.agents.length, manifestErr);
  check('log line for agents.json', delta6.includes('[config] stripped BOM from agents.json'), JSON.stringify(delta6.trim()));
  restoreOne(main.AGENTS_JSON);
  restoreOne(main.USER_CONFIG);
  const snapUser = restores.find((r) => r.p === main.USER_CONFIG);
  const snapManifest = restores.find((r) => r.p === main.AGENTS_JSON);
  check('agents.json restored byte-for-byte', !!snapManifest && fs.readFileSync(main.AGENTS_JSON).equals(snapManifest.bytes));
  check('user-config.json restored byte-for-byte', !!snapUser && fs.readFileSync(main.USER_CONFIG).equals(snapUser.bytes));
  check('user-config.json is BOM-free again', !fs.readFileSync(main.USER_CONFIG).slice(0, 3).equals(BOM_BYTES));

  // providers.json (contains the bundled key: only the BOM is added, and the
  // original bytes are restored immediately afterwards)
  const provPath = path.join(main.ROOT, 'config', 'providers.json');
  const provBytes = fs.readFileSync(provPath);
  const provExpected = JSON.parse(stripBom(provBytes.toString('utf8')));
  fs.writeFileSync(provPath, BOM + stripBom(provBytes.toString('utf8')), 'utf8');
  const before6b = logText().length;
  const prov = main.bundledProvider();
  const delta6b = logText().slice(before6b);
  fs.writeFileSync(provPath, provBytes);
  check('bundledProvider() on BOM\'d providers.json', !!prov && prov.baseUrl === provExpected.agnes.baseUrl, prov ? prov.baseUrl : 'null');
  check('log line for providers.json', delta6b.includes('[config] stripped BOM from providers.json'));
  check('providers.json restored byte-for-byte', fs.readFileSync(provPath).equals(provBytes));

  // pricing.json through the real UsageStore (against a temp root, no real file)
  const fakeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-usb-bom-root-'));
  fs.mkdirSync(path.join(fakeRoot, 'Launcher', 'Config'), { recursive: true });
  fs.writeFileSync(path.join(fakeRoot, 'Launcher', 'Config', 'pricing.json'),
                   BOM + JSON.stringify({ version: 1, currency: 'USD', providers: { p: { input: 1 } } }), 'utf8');
  const us = new UsageStore(fakeRoot);
  const pricing = us.loadPricing();
  check('UsageStore.loadPricing() on BOM\'d pricing.json', pricing.providers && pricing.providers.p && pricing.providers.p.input === 1, JSON.stringify(pricing));
  fs.rmSync(fakeRoot, { recursive: true, force: true });

  // --- T7: cleanup ---------------------------------------------------------
  console.log('== T7: cleanup ==');
  fs.rmSync(tmpDir, { recursive: true, force: true });
  check('temp dir removed', !fs.existsSync(tmpDir));
  check('BOM line present in the launcher log', fs.existsSync(LOG) && logText().includes('[config] stripped BOM from user-config.json'));

  console.log('');
  console.log(`  checks: ${pass} passed, ${fail} failed`);
  if (fail) { console.log('  failures: ' + failures.join(' | ')); console.log('== FAIL =='); process.exit(1); }
  console.log('== PASS ==');
  process.exit(0);
})().catch((e) => {
  restoreAll();
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  console.error('FAIL ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
