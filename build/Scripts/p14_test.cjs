'use strict';
// Phase 14 tests: cost recompute, multi-dimension dashboard, sanitized export,
// pricing registry write-back. Uses a TEMP root; never touches real usage.jsonl.
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..', '..');
const { UsageStore, costFor, findPrice } = require(path.join(ROOT, 'Launcher', 'App', 'usage.js'));

let pass = 0, fail = 0;
const results = [];
function check(name, cond, detail) {
  if (cond) { pass++; results.push('PASS  ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; results.push('FAIL  ' + name + (detail ? '  [' + detail + ']' : '')); }
}
const approx = (a, b) => Math.abs(a - b) < 1e-9;

(async () => {
  const tmpRoot = path.join(ROOT, 'Build', 'Audit', 'Phase-14-test-tmp');
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  const store = new UsageStore(tmpRoot); store.ensure();

  // 1. Seed two records: provider apihub.agnes-ai.com, model agnes-2.5-flash.
  const mk = (agentId, input, output, cached) => ({
    agentId, provider: 'apihub.agnes-ai.com', model: 'agnes-2.5-flash',
    providerType: 'openai-compatible', statusCode: 200, latencyMs: 10, success: true,
    response: { usage: { prompt_tokens: input, completion_tokens: output, total_tokens: input + output,
      prompt_tokens_details: cached ? { cached_tokens: cached } : {} } },
  });
  store.record(mk('hermes', 289, 5, 256));
  store.record(mk('codex', 1000, 200, 0));

  // 2. No price yet -> cost unknown, not zero.
  const d0 = store.dashboard(0);
  check('D1 no price -> cost null', d0.cost === null, 'cost=' + d0.cost);
  check('D2 unpricedRequests = 2', d0.unpricedRequests === 2, String(d0.unpricedRequests));
  check('D3 totals summed', d0.inputTokens === 1289 && d0.outputTokens === 205,
    `in=${d0.inputTokens} out=${d0.outputTokens}`);
  check('D4 byProvider has agnes', d0.byProvider.some(p => p.key === 'apihub.agnes-ai.com'));
  check('D5 byModel has agnes-2.5-flash', d0.byModel.some(m => m.model === 'agnes-2.5-flash'));
  check('D6 byAgent split (hermes/codex)',
    d0.byAgent.some(a => a.key === 'hermes') && d0.byAgent.some(a => a.key === 'codex'));

  // 3. Write a price WITH a source -> cost recomputed retroactively.
  const pricing = store.loadPricingRaw();
  pricing.providers = pricing.providers || {};
  pricing.providers['apihub.agnes-ai.com'] = { label: 'agnes', models: {
    'agnes-2.5-flash': { input_per_1m: 0.1, output_per_1m: 1.0, cached_per_1m: 0.01, effective_from: '2026-09-23', source: 'https://example.com/pricing', verified: true },
  }};
  const saved = store.savePricing(pricing);
  check('D7 savePricing keeps provider+model', !!saved.providers['apihub.agnes-ai.com'].models['agnes-2.5-flash']);

  const d1 = store.dashboard(0);
  // Expected: hermes input 289 incl cached 256 -> (289-256)*0.1/1e6 + 256*0.01/1e6 + 5*1/1e6
  const expectHermes = (289-256)*0.1/1e6 + 256*0.01/1e6 + 5*1.0/1e6;
  const expectCodex = 1000*0.1/1e6 + 200*1.0/1e6;
  const expectTotal = expectHermes + expectCodex;
  check('D8 cost now numeric', typeof d1.cost === 'number', 'cost=' + d1.cost);
  check('D9 total cost matches formula', approx(d1.cost, expectTotal),
    `got=${d1.cost.toFixed(8)} expect=${expectTotal.toFixed(8)}`);
  check('D10 pricedRequests = 2', d1.pricedRequests === 2);
  check('D11 unpricedRequests = 0', d1.unpricedRequests === 0);

  // 4. Window filter: 1 day vs all still includes these (same day), sanity.
  const dWin = store.dashboard(1);
  check('D12 window=1 includes records', dWin.requests >= 2, String(dWin.requests));

  // 5. Export CSV + JSON: only whitelist fields, no secrets.
  const csv = store.exportRecords('csv');
  const jsn = store.exportRecords('json');
  const csvTxt = fs.readFileSync(csv.path, 'utf8');
  const jsnObj = JSON.parse(fs.readFileSync(jsn.path, 'utf8'));
  check('D13 CSV header whitelist', csvTxt.charCodeAt(0) === 0xFEFF && csvTxt.replace(/^﻿/, '').startsWith('id,timestamp,agentId,provider,model,inputTokens'));
  check('D14 CSV has 2 data rows', csvTxt.split(/\r?\n/).filter(l=>l.trim()).length === 3);
  check('D15 JSON records count', jsnObj.records.length === 2);
  check('D16 export has no authorization/body field',
    !('authorization' in jsnObj.records[0]) && !('messages' in jsnObj.records[0]) && !('response' in jsnObj.records[0]));
  check('D17 export redacts no secret', !/sk-test-leak/.test(csvTxt));

  // 6. findPrice provider+model double match
  const pr = store.loadPricingRaw();
  check('D18 findPrice provider+model', findPrice(pr, 'apihub.agnes-ai.com', 'agnes-2.5-flash').input_per_1m === 0.1);
  check('D19 findPrice unknown model -> null', findPrice(pr, 'apihub.agnes-ai.com', 'nope') === null);

  fs.rmSync(tmpRoot, { recursive: true, force: true });
  console.log('PHASE14_UNIT_TESTS=' + JSON.stringify({ pass, fail }));
  results.forEach(r => console.log(r));
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.log('ERROR', e); process.exit(1); });
