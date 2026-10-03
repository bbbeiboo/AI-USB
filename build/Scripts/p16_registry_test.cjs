// Phase 16.1A registry load/validate test (standalone, mirrors loadManifest rules)
const fs = require('fs');
const path = require('path');
const ROOT = process.argv[2] || process.cwd();
const AGENTS_JSON = path.join(ROOT, 'Build', 'Config', 'agents.json');

function isSafeRel(p) {
  return typeof p === 'string' &&
    !/^[a-zA-Z]:[\\/]/.test(p) && !/^\/\//.test(p) &&
    !p.split(/[\\/]/).includes('..');
}

function loadManifest() {
  const raw = fs.readFileSync(AGENTS_JSON, 'utf8');
  const m = JSON.parse(raw);
  if (!m || m.version !== 1 || !Array.isArray(m.agents)) throw new Error('bad structure');
  const ids = new Set();
  for (const a of m.agents) {
    if (!a.id || !a.name) throw new Error('missing id/name');
    if (!isSafeRel(a.launcher) || !isSafeRel(a.checker)) throw new Error('unsafe path ' + a.id);
    if (!a.workspace || !isSafeRel(a.workspace)) throw new Error('bad workspace ' + a.id);
    if (a.configPath !== null && (typeof a.configPath !== 'string' || !isSafeRel(a.configPath))) throw new Error('bad configPath ' + a.id);
    if (!a.configAdapter) throw new Error('missing configAdapter ' + a.id);
    if (!a.desktopAdapter) throw new Error('missing desktopAdapter ' + a.id);
    if (ids.has(a.id)) throw new Error('dup ' + a.id);
    ids.add(a.id);
  }
  return m;
}

const m = loadManifest();
console.log('Loaded agents.json OK, agents =', m.agents.length);
for (const a of m.agents) {
  console.log('---');
  console.log('id            =', a.id);
  console.log('displayName   =', a.name);
  console.log('launcher(rel) =', a.launcher);
  console.log('workspace     =', a.workspace, '(exists:', fs.existsSync(path.join(ROOT, a.workspace)) + ')');
  console.log('configPath    =', a.configPath, '(exists:', a.configPath ? fs.existsSync(path.join(ROOT, a.configPath)) : 'n/a)');
  console.log('configAdapter =', a.configAdapter);
  console.log('desktopAdapter=', a.desktopAdapter);
}
const expected = ['openclaw','hermes','codex','claude-code'];
const got = m.agents.map(a => a.id).sort().join(',');
console.log('---');
console.log('expected ids match:', got === expected.slice().sort().join(','), '(' + got + ')');
