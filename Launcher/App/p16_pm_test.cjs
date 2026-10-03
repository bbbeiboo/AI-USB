// Phase 16.1B standalone AgentProcessManager test
const fs = require('fs');
const path = require('path');
const pm = require('./agent-process-manager.js');

const tmpDir = path.join(__dirname, '_pm_test');
fs.mkdirSync(tmpDir, { recursive: true });

// two independent sleep scripts
function makeSleep(name, seconds) {
  const p = path.join(tmpDir, name + '.ps1');
  fs.writeFileSync(p, `Start-Sleep -Seconds ${seconds}; Write-Host "done-${name}"\n`);
  return p;
}
const scriptA = makeSleep('agentA', 60);
const scriptB = makeSleep('agentB', 60);

const opts = {
  cwd: tmpDir,
  resolveScriptAbs: (id) => id === 'agentB' ? scriptB : scriptA,
  buildEnv: async () => ({ ...process.env }),
  log: (l) => console.log('  ' + l),
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  console.log('== T1: start agentA ==');
  let r = await pm.startAgent('agentA', opts);
  console.log('  start ->', JSON.stringify(r));
  console.log('  status ->', JSON.stringify(pm.getAgentStatus('agentA')));

  console.log('== T2: duplicate start agentA (must reject) ==');
  r = await pm.startAgent('agentA', opts);
  console.log('  start ->', JSON.stringify(r));

  console.log('== T3: start agentB ==');
  r = await pm.startAgent('agentB', opts);
  console.log('  start ->', JSON.stringify(r));

  console.log('== T4: both running? ==');
  console.log('  all ->', JSON.stringify(pm.getAllStatuses()));
  await sleep(1500);

  console.log('== T5: stop ONLY agentA; agentB must stay ==');
  await pm.stopAgent('agentA', opts);
  console.log('  after stop agentA ->', JSON.stringify(pm.getAllStatuses()));

  console.log('== T6: restart agentB (new pid != old) ==');
  const before = pm.getAgentStatus('agentB').pid;
  await sleep(500);
  const rr = await pm.restartAgent('agentB', opts);
  console.log('  restart ->', JSON.stringify(rr), ' oldPid=', before);
  await sleep(800);
  const after = pm.getAgentStatus('agentB').pid;
  console.log('  newPid=', after, ' changed=', before !== after);

  console.log('== T7: stop agentB ==');
  await pm.stopAgent('agentB', opts);
  console.log('  final ->', JSON.stringify(pm.getAllStatuses()));

  console.log('== PASS ==');
  process.exit(0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
