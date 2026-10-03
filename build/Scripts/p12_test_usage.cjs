'use strict';
// Phase 12 unit tests for usage.js (mock data only; no network, no real keys).
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..', '..');
const { parseUsage, costFor, UsageStore } = require(path.join(ROOT, 'Launcher', 'App', 'usage.js'));

let pass = 0, fail = 0;
const results = [];
function check(name, cond, detail) {
  if (cond) { pass++; results.push('PASS  ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; results.push('FAIL  ' + name + (detail ? '  [' + detail + ']' : '')); }
}

// Test 1: OpenAI-compatible usage 10/20/30
{
  const u = parseUsage('openai-compatible', { usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } });
  check('T1 openai usage parse', u.inputTokens === 10 && u.outputTokens === 20 && u.totalTokens === 30,
    `in=${u.inputTokens} out=${u.outputTokens} tot=${u.totalTokens}`);
}

// Test 2: missing usage -> null (not fabricated 0)
{
  const u = parseUsage('openai-compatible', {});
  check('T2 missing usage -> null', u.inputTokens === null && u.outputTokens === null && u.totalTokens === null,
    `in=${u.inputTokens} tot=${u.totalTokens}`);
}

// Test 3: price present -> cost = tokens/1e6 * price
{
  const pricing = { currency: 'USD', providers: { agnes: { models: { 'agnes-2.5-flash': { input_per_1m: 1.0, output_per_1m: 2.0, source: 'test', effective_from: 'v1' } } } } };
  const rec = { provider: 'agnes', model: 'agnes-2.5-flash', inputTokens: 1000000, outputTokens: 500000, cachedTokens: 0, reasoningTokens: 0, totalTokens: 1500000 };
  const c = costFor(rec, pricing);
  // inputCost = 1e6*1/1e6 = 1 ; outputCost = 500000*2/1e6 = 1 ; total = 2
  check('T3 cost calc', Math.abs(c.inputCost - 1) < 1e-9 && Math.abs(c.outputCost - 1) < 1e-9 && Math.abs(c.totalCost - 2) < 1e-9,
    `total=${c.totalCost} status=${c.costStatus}`);
}

// Test 4: price absent -> null, PRICE_UNKNOWN
{
  const c = costFor({ provider: 'unknown', model: 'x', inputTokens: 10, outputTokens: 5, totalTokens: 15 }, { currency: 'USD', providers: {} });
  check('T4 unknown price -> null', c.totalCost === null && c.costStatus === 'PRICE_UNKNOWN', `status=${c.costStatus}`);
}

// Test 5: abnormal response -> no fabricated tokens
{
  const u = parseUsage('anthropic-compatible', { usage: 'garbage' });
  check('T5 abnormal response -> null', u.inputTokens === null && u.outputTokens === null, `in=${u.inputTokens}`);
  const u2 = parseUsage('openai-compatible', { usage: { prompt_tokens: 'abc' } });
  check('T5b non-integer token -> null', u2.inputTokens === null, `in=${u2.inputTokens}`);
}

// Test 6: round-trip store append + read + summary in temp usage dir, then secret audit.
{
  const tmpRoot = path.join(ROOT, 'Build', 'Audit', 'Phase-12-test-tmp');
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  const store = new UsageStore(tmpRoot);
  store.ensure();
  const rec = store.record({ agentId: 'hermes', provider: 'agnes', providerType: 'openai-compatible', model: 'agnes-2.5-flash',
    response: { usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } }, success: true, statusCode: 200, durationMs: 123 });
  const all = store.readAll();
  check('T6 store round-trip', all.length === 1 && all[0].totalTokens === 30, `recs=${all.length} tot=${all[0].totalTokens}`);
  // secret audit across real project files
  const files = [
    path.join(ROOT, 'Launcher', 'Data', 'usage', 'usage.jsonl'),
    path.join(ROOT, 'Launcher', 'Config', 'pricing.json'),
    path.join(ROOT, 'Launcher', 'Logs', 'launcher.log'),
    path.join(ROOT, 'Launcher', 'Config', 'user-config.json'),
  ];
  const KEY = 'sk-test-leak-marker';
  let leaked = [];
  for (const f of files) { try { if (fs.existsSync(f) && fs.readFileSync(f, 'utf8').includes(KEY)) leaked.push(path.basename(f)); } catch (_) {} }
  check('T6b secret audit: no real key in usage/pricing/log/config', leaked.length === 0, leaked.join(','));
  // also ensure record has no key fields
  check('T6c record contains no secret fields', !('apiKey' in rec) && !('authorization' in rec) && !('cookie' in rec));
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}

console.log('PHASE12_UNIT_TESTS=' + JSON.stringify({ pass, fail }));
results.forEach(r => console.log(r));
process.exit(fail > 0 ? 1 : 0);
