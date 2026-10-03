// TEMP HARNESS (step-2 verification, not part of the deliverable).
// Drives the REAL Build/Config/agents.json through agent-process-manager with the
// same options main.js passes, so PID tracking / stop / persistence can be
// verified without clicking through the GUI.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..', '..'); // _pm_test -> App -> Launcher -> root
const MANIFEST = path.join(ROOT, 'Build', 'Config', 'agents.json');
const agents = JSON.parse(fs.readFileSync(MANIFEST, 'utf8')).agents;

function provEnv() {
  const p = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'providers.json'), 'utf8'));
  const a = p.agnes || {};
  const out = {};
  if (a.apiKey) out.OPENAI_API_KEY = a.apiKey;              // mirrors the DPAPI secret main.js injects
  if (a.baseUrl) out.OPENAI_BASE_URL = a.baseUrl;
  if (a.model) { out.OPENAI_MODEL = a.model; }
  if (a.anthropicBaseUrl) out.ANTHROPIC_BASE_URL = a.anthropicBaseUrl;
  if (a.apiKey) out.ANTHROPIC_API_KEY = a.apiKey;
  if (a.model) out.ANTHROPIC_MODEL = a.model;
  out.CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT = '1';
  return out;
}
function tasklist(pid) {
  try {
    return execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH', '/FO', 'CSV'], { encoding: 'utf8' })
      .split(/\r?\n/).filter(l => l.includes(`"${pid}"`)).map(l => l.split('","')[0].replace(/^"/, ''));
  } catch (_) { return []; }
}
function treePids(pid) {
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-Command',
      `$all=@(${pid}); $q=New-Object System.Collections.Queue; $q.Enqueue(${pid}); $seen=@{}; ` +
      `while($q.Count -gt 0){ $p=$q.Dequeue(); if($seen.ContainsKey($p)){continue}; $seen[$p]=$true; ` +
      `Get-CimInstance Win32_Process -Filter "ParentProcessId=$p" -ErrorAction SilentlyContinue | ForEach-Object { $all+=$_.ProcessId; $q.Enqueue($_.ProcessId) } }; ` +
      `$all -join ','`], { encoding: 'utf8' });
    return out.trim();
  } catch (_) { return ''; }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  const pm = require(path.join(ROOT, 'Launcher', 'App', 'agent-process-manager.js'));
  pm.configure({ root: ROOT });
  const log = (l) => console.log('  ' + l);
  const results = {};

  for (const a of agents) {
    console.log(`\n=== ${a.id} (${a.exePath}) ===`);
    const r = await pm.startAgent(a.id, {
      agent: a,
      exePath: a.exePath || '',
      exeArgs: Array.isArray(a.exeArgs) ? a.exeArgs : [],
      cwd: a.workspace || '',
      resolveScriptAbs: () => null,          // manifest exePath must win
      matchToken: a.processToken || '',
      buildEnv: async () => provEnv(),
      log,
    });
    console.log(`  start -> ${JSON.stringify(r)}`);
    if (!r.ok) { results[a.id] = { started: false, reason: r.reason }; continue; }
    const tracked = r.pid;
    await sleep(12000);
    const st = pm.getAgentStatus(a.id);
    const names = tasklist(tracked);
    const tree = treePids(tracked);
    console.log(`  after12s status=${st.status} trackedPid=${tracked} alive=${names.length > 0} task=${names.join('/') || '-'}`);
    console.log(`  tree pids = ${tree}`);

    const s = await pm.stopAgent(a.id, { log });
    await sleep(1200);
    const after = tasklist(tracked);
    console.log(`  stop -> ${JSON.stringify(s)} ; pidAliveAfter=<${after.join('/') || 'gone'}>`);
    results[a.id] = {
      started: true, pid: tracked, statusAfter12s: st.status,
      taskName: names[0] || null, treePids: tree,
      stop: s.stopped, goneAfterStop: after.length === 0,
    };
  }

  // --- persistence / re-adoption (acceptance 6 + 7) ---
  console.log('\n=== persistence: start hermes, simulate Launcher restart ===');
  const hermes = agents.find(a => a.id === 'hermes');
  const r2 = await pm.startAgent('hermes', {
    agent: hermes, exePath: hermes.exePath, exeArgs: [], cwd: hermes.workspace,
    buildEnv: async () => provEnv(), log,
  });
  console.log(`  start -> ${JSON.stringify(r2)}`);
  await sleep(9000);
  const storeFile = path.join(ROOT, 'Launcher', 'Data', 'agent-state.json');
  console.log(`  state file exists=${fs.existsSync(storeFile)} path=${storeFile}`);
  if (fs.existsSync(storeFile)) console.log('  content=' + fs.readFileSync(storeFile, 'utf8').replace(/\s+/g, ' '));

  const pmPath = path.join(ROOT, 'Launcher', 'App', 'agent-process-manager.js');
  delete require.cache[require.resolve(pmPath)];
  const pm2 = require(pmPath);            // fresh module = fresh Launcher session
  pm2.configure({ root: ROOT });
  const adopted = pm2.getAllStatuses();
  console.log('  adopted statuses -> ' + JSON.stringify(adopted));
  const adoptedRunning = adopted.hermes && adopted.hermes.status === 'RUNNING' && adopted.hermes.pid;

  const s2 = await pm2.stopAgent('hermes', { log });
  await sleep(1200);
  const gone = tasklist(r2.pid).length === 0;
  console.log(`  adopted-stop -> ${JSON.stringify(s2)} gone=${gone}`);
  console.log('  status after adopted-stop -> ' + JSON.stringify(pm2.getAllStatuses()));

  results.persistence = {
    savedFile: fs.existsSync(storeFile), adoptedStatus: adopted.hermes && adopted.hermes.status,
    adoptedPidMatches: !!(adopted.hermes && adopted.hermes.pid === r2.pid),
    adoptedRunning, stopFromAdopted: s2.stopped, goneAfterAdoptedStop: gone,
  };

  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify(results, null, 2));
  const bad = Object.entries(results).filter(([k, v]) =>
    k !== 'persistence' && (!v.started || v.statusAfter12s !== 'RUNNING' || v.stop !== 1 || !v.goneAfterStop));
  console.log(bad.length ? 'HARNESS: FAIL -> ' + bad.map(b => b[0]).join(',') : 'HARNESS: all agents PID-tracked + stopped');
  const pbad = !results.persistence.adoptedRunning || !results.persistence.goneAfterAdoptedStop;
  console.log(pbad ? 'HARNESS: persistence FAIL' : 'HARNESS: persistence OK');
  process.exit(bad.length || pbad ? 1 : 0);
}
main().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
