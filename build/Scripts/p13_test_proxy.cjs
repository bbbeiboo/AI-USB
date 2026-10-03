'use strict';
// Phase 13 proxy tests (no real network; local mock upstream).
const path = require('path');
const fs = require('fs');
const http = require('http');
const ROOT = path.resolve(__dirname, '..', '..');
const { UsageProxy, isPrivateHost } = require(path.join(ROOT, 'Launcher', 'App', 'usage-proxy.js'));
const { UsageStore } = require(path.join(ROOT, 'Launcher', 'App', 'usage.js'));

let pass = 0, fail = 0;
const results = [];
function check(name, cond, detail) {
  if (cond) { pass++; results.push('PASS  ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; results.push('FAIL  ' + name + (detail ? '  [' + detail + ']' : '')); }
}

(async () => {
  const tmpRoot = path.join(ROOT, 'Build', 'Audit', 'Phase-13-test-tmp');
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  const store = new UsageStore(tmpRoot); store.ensure();

  // mock upstream returns a fixed chat completion with usage 11/22/33
  const mock = http.createServer((req, res) => {
    let b = []; req.on('data', c => b.push(c));
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 'x', model: 'agnes-2.5-flash',
        usage: { prompt_tokens: 11, completion_tokens: 22, total_tokens: 33 } }));
    });
  });
  await new Promise(r => mock.listen(0, '127.0.0.1', r));
  const mockPort = mock.address().port;

  const proxy = new UsageProxy({
    onRecord: (e) => store.record(e),
    providerTypeOf: () => 'openai-compatible',
  });
  proxy.register('hermes', `http://127.0.0.1:${mockPort}/v1`);
  await proxy.start();
  const pport = proxy.port;

  // T1: proxy binds 127.0.0.1 with OS-assigned port
  check('T1 proxy localhost ephemeral port', proxy.urlBase === `http://127.0.0.1:${pport}`, proxy.urlBase);

  // forward a request through proxy to mock upstream
  const rec = await new Promise((resolve) => {
    const r = http.request({ host: '127.0.0.1', port: pport, path: '/agent/hermes/v1/chat/completions', method: 'POST',
      headers: { 'content-type': 'application/json', 'authorization': 'Bearer sk-test-leak-marker' } }, (res) => {
      const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    r.end(JSON.stringify({ model: 'agnes-2.5-flash', messages: [] }));
  });

  check('T2 response forwarded 200', rec.status === 200, 'status=' + rec.status);
  check('T3 response body passed through', rec.body.includes('"total_tokens":33'), 'bodyLen=' + rec.body.length);

  const all = store.readAll();
  check('T4 usage recorded', all.length === 1, 'records=' + all.length);
  check('T5 token reconciliation in/out/total', all[0] && all[0].inputTokens === 11 && all[0].outputTokens === 22 && all[0].totalTokens === 33,
    all[0] ? `in=${all[0].inputTokens} out=${all[0].outputTokens} tot=${all[0].totalTokens}` : 'no record');
  check('T6 model extracted', all[0] && all[0].model === 'agnes-2.5-flash');
  check('T7 agentId recorded', all[0] && all[0].agentId === 'hermes');

  // T8: unknown agent rejected (SSRF / open-relay guard)
  const rej = await new Promise((resolve) => {
    const r = http.request({ host: '127.0.0.1', port: pport, path: '/agent/nobody/v1/chat/completions', method: 'POST' }, (res) => { res.on('data', ()=>{}); res.on('end', () => resolve(res.statusCode)); });
    r.end();
  });
  check('T8 unknown agent -> 403', rej === 403, 'status=' + rej);

  // T9: private-host helper flags metadata endpoint
  check('T9 isPrivateHost flags cloud metadata', isPrivateHost('169.254.169.254') === true && isPrivateHost('10.0.0.5') === true);

  // T10: no secret in usage record or store files (scanned against a fake marker only)
  let leaked = false;
  for (const f of [path.join(tmpRoot, 'Launcher', 'Data', 'usage', 'usage.jsonl')]) {
    try { if (fs.readFileSync(f, 'utf8').includes('sk-test-leak-marker')) leaked = true; } catch (_) {}
  }
  check('T10 Authorization not persisted to usage store', leaked === false);
  check('T10b record has no authorization field', !(all[0] && ('authorization' in all[0])));

  await proxy.stop();
  mock.close();
  fs.rmSync(tmpRoot, { recursive: true, force: true });

  console.log('PHASE13_UNIT_TESTS=' + JSON.stringify({ pass, fail }));
  results.forEach(r => console.log(r));
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.log('ERROR', e); process.exit(1); });
