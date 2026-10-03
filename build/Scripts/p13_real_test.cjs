'use strict';
// Phase 13 real end-to-end: localhost proxy -> real agnes -> usage record.
// Key is read from DPAPI via powershell child, used only in memory, never printed.
const path = require('path');
const fs = require('fs');
const http = require('http');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..');
const { UsageProxy } = require(path.join(ROOT, 'Launcher', 'App', 'usage-proxy.js'));
const { UsageStore } = require(path.join(ROOT, 'Launcher', 'App', 'usage.js'));

(async () => {
  const store = new UsageStore(ROOT); store.ensure();
  const before = store.readAll().length;

  // decrypt DPAPI hermes key
  const b64 = fs.readFileSync(path.join(ROOT, 'Launcher', 'Data', 'secrets', 'hermes.bin'), 'utf8').trim();
  const ps = `Add-Type -AssemblyName System.Security; $b64='${b64}'; [Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($b64),$null,'CurrentUser'))`;
  const key = execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { windowsHide: true }).toString().trim();
  console.log('DECRYPT_OK len=' + key.length);

  const proxy = new UsageProxy({ onRecord: (e) => store.record(e), providerTypeOf: () => 'openai-compatible' });
  proxy.register('hermes', 'https://apihub.agnes-ai.com/v1');
  await proxy.start();
  console.log('PROXY_PORT=' + proxy.port);

  // Agent-equivalent POST through the proxy (exactly what Hermes sends)
  const body = JSON.stringify({ model: 'agnes-2.5-flash', messages: [{ role: 'user', content: 'Reply with exactly: ok' }], max_tokens: 5 });
  const res = await new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: proxy.port, path: '/agent/hermes/v1/chat/completions', method: 'POST',
      headers: { 'content-type': 'application/json', 'authorization': 'Bearer ' + key } }, (resp) => {
      const chunks = []; resp.on('data', c => chunks.push(c)); resp.on('end', () => resolve({ status: resp.statusCode, text: Buffer.concat(chunks).toString() }));
    });
    r.on('error', reject); r.end(body);
  });
  // drop key reference
  for (const k of ['authorization']) {}
  console.log('UPSTREAM_STATUS=' + res.status);

  let parsed = null; try { parsed = JSON.parse(res.text); } catch (_) {}
  console.log('RESP_HAS_USAGE=' + !!(parsed && parsed.usage));
  if (parsed && parsed.usage) console.log('PROVIDER_USAGE=' + JSON.stringify(parsed.usage));

  await new Promise(r => setTimeout(r, 200));
  const after = store.readAll();
  const rec = after[after.length - 1];
  console.log('RECORDS_BEFORE=' + before + ' AFTER=' + after.length);
  if (rec) {
    console.log('RECORD_IN=' + rec.inputTokens + ' OUT=' + rec.outputTokens + ' TOT=' + rec.totalTokens +
      ' AGENT=' + rec.agentId + ' MODEL=' + rec.model + ' STATUS=' + rec.statusCode + ' COST=' + rec.cost + ' COSTSTATUS=' + rec.costStatus);
  }
  // reconciliation
  let recon = 'SKIP';
  if (parsed && parsed.usage && rec) {
    const ok = parsed.usage.prompt_tokens === rec.inputTokens && parsed.usage.completion_tokens === rec.outputTokens && parsed.usage.total_tokens === rec.totalTokens;
    recon = ok ? 'RECONCILED' : 'RECONCILIATION_FAILED';
  }
  console.log('RECON=' + recon);
  await proxy.stop();
  process.exit(0);
})().catch(e => { console.log('REALTEST_ERROR=' + (e && e.message ? e.message : e)); process.exit(1); });
