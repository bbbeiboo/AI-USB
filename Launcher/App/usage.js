'use strict';
// ============================================================================
// Phase 12: local usage / token / cost statistics.
// Append-only JSONL store. Provider usage adapters parse REAL response payloads
// (never guess fields). Cost uses pricing registry; unknown price -> null, never 0.
// No API keys, prompts, responses, cookies or Authorization headers are stored.
// ============================================================================
const fs = require('fs');
const path = require('path');
const os = require('os');
const { readJsonSafe, stripBom } = require('./json-util.js');

// ---- UsageRecord normalization -------------------------------------------
// Missing fields stay null (never fabricated 0).
function parseOpenAIUsage(resp) {
  const u = (resp && resp.usage) || null;
  if (!u || typeof u !== 'object') {
    return { inputTokens: null, outputTokens: null, totalTokens: null,
             cachedTokens: null, reasoningTokens: null };
  }
  const num = (v) => (Number.isInteger(v) ? v : (typeof v === 'number' && isFinite(v) ? Math.round(v) : null));
  const inputTokens = num(u.prompt_tokens);
  const outputTokens = num(u.completion_tokens);
  const totalTokens = num(u.total_tokens);
  const cachedTokens = (u.prompt_tokens_details && Number.isInteger(u.prompt_tokens_details.cached_tokens))
    ? u.prompt_tokens_details.cached_tokens : null;
  const reasoningTokens = (u.completion_tokens_details && Number.isInteger(u.completion_tokens_details.reasoning_tokens))
    ? u.completion_tokens_details.reasoning_tokens : null;
  return { inputTokens, outputTokens, totalTokens, cachedTokens, reasoningTokens };
}

function parseAnthropicUsage(resp) {
  const u = (resp && resp.usage) || null;
  if (!u || typeof u !== 'object') {
    return { inputTokens: null, outputTokens: null, totalTokens: null,
             cachedTokens: null, reasoningTokens: null };
  }
  const num = (v) => (Number.isInteger(v) ? v : (typeof v === 'number' && isFinite(v) ? Math.round(v) : null));
  const inputTokens = num(u.input_tokens);
  const outputTokens = num(u.output_tokens);
  const totalTokens = (Number.isInteger(inputTokens) && Number.isInteger(outputTokens))
    ? inputTokens + outputTokens : null;
  const cachedTokens = num(u.cache_read_input_tokens);
  return { inputTokens, outputTokens, totalTokens, cachedTokens, reasoningTokens: null };
}

function parseUsage(providerType, resp) {
  const t = String(providerType || '').toLowerCase();
  if (t === 'anthropic-compatible') return parseAnthropicUsage(resp);
  // openai-compatible and custom both speak the OpenAI usage shape when observed.
  return parseOpenAIUsage(resp);
}

// ---- Cost calculation (high precision; unknown price -> null) --------------
// Price maps are per 1,000,000 tokens in `currency`. We compute in floating double
// (integers * small decimals) and do NOT pre-round line items; rounding only at display.
function findPrice(pricing, provider, model) {
  if (!pricing || !pricing.providers) return null;
  const p = pricing.providers[String(provider || '').toLowerCase()];
  if (!p) return null;
  const byModel = p.models || {};
  if (byModel[model]) return byModel[model];
  if (p.default) return p.default;
  return null;
}

function costFor(record, pricing) {
  const price = findPrice(pricing, record.provider, record.model);
  if (!price || record.totalTokens == null) {
    return { inputCost: null, outputCost: null, cachedCost: null,
             reasoningCost: null, totalCost: null, costStatus: 'PRICE_UNKNOWN' };
  }
  const perIn = Number(price.input_per_1m) || 0;
  const perOut = Number(price.output_per_1m) || 0;
  const perCached = Number(price.cached_per_1m) || 0;
  const perReasoning = Number(price.reasoning_per_1m) || perOut;
  const inT = record.inputTokens || 0;
  const outT = record.outputTokens || 0;
  const cachedT = record.cachedTokens || 0;
  const reasonT = record.reasoningTokens || 0;
  const inputCost = (inT - cachedT) * perIn / 1e6;
  const cachedCost = cachedT * perCached / 1e6;
  const outputCost = (outT - reasonT) * perOut / 1e6;
  const reasoningCost = reasonT * perReasoning / 1e6;
  const totalCost = inputCost + cachedCost + outputCost + reasoningCost;
  return { inputCost, outputCost, cachedCost, reasoningCost, totalCost,
           costStatus: 'OK', pricingSource: price.source || '', pricingVersion: price.effective_from || '' };
}

// ---- Store (append-only JSONL, read-only fallback) ------------------------
class UsageStore {
  constructor(rootDir) {
    this.dir = path.join(rootDir, 'Launcher', 'Data', 'usage');
    this.file = path.join(this.dir, 'usage.jsonl');
    this.pricingFile = path.join(rootDir, 'Launcher', 'Config', 'pricing.json');
    this.writable = true;
  }
  ensure() {
    try { fs.mkdirSync(this.dir, { recursive: true }); const t = path.join(this.dir, '.wtest'); fs.writeFileSync(t, 'x'); fs.unlinkSync(t); this.writable = true; }
    catch (_) { this.writable = false; }
  }
  append(record) {
    if (!this.writable) this.ensure();
    if (!this.writable) return false;
    try { fs.appendFileSync(this.file, JSON.stringify(record) + '\n'); return true; }
    catch (_) { this.writable = false; return false; }
  }
  readAll() {
    try { if (!fs.existsSync(this.file)) return [];
      // stripBom: a BOM would otherwise invalidate the FIRST JSONL record.
      return stripBom(fs.readFileSync(this.file, 'utf8')).split(/\r?\n/).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean);
    } catch (_) { return []; }
  }
  clear() { try { if (fs.existsSync(this.file)) fs.unlinkSync(this.file); return true; } catch (_) { return false; } }
  loadPricing() {
    // BOM-tolerant config read; falls back to the built-in pricing defaults for a
    // missing, unreadable, BOM-less-invalid or non-object file.
    const pricing = readJsonSafe(this.pricingFile, { defaultValue: null });
    if (pricing && typeof pricing === 'object') return pricing;
    return { version: 1, currency: 'USD', providers: {} };
  }
  record(entry) {
    const usage = parseUsage(entry.providerType, entry.response);
    const now = new Date();
    const rec = {
      id: 'u_' + now.getTime().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
      timestamp: now.toISOString(),
      agentId: String(entry.agentId || ''),
      provider: String(entry.provider || ''),
      model: String(entry.model || ''),
      requestTokens: usage.inputTokens,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      cachedTokens: usage.cachedTokens,
      reasoningTokens: usage.reasoningTokens,
      durationMs: Number.isInteger(entry.durationMs) ? entry.durationMs : null,
      success: !!entry.success,
      statusCode: Number.isInteger(entry.statusCode) ? entry.statusCode : null,
    };
    const pricing = this.loadPricing();
    const c = costFor(rec, pricing);
    rec.cost = c.totalCost;
    rec.costStatus = c.costStatus;
    rec.currency = pricing.currency || 'USD';
    this.append(rec);
    return rec;
  }
  summarize(days) {
    const all = this.readAll();
    const cutoff = days > 0 ? Date.now() - days * 86400000 : 0;
    const agents = {};
    let requests = 0, successfulRequests = 0, failedRequests = 0;
    let inputTokens = 0, outputTokens = 0, totalTokens = 0;
    let pricedCostSum = 0, pricedRequests = 0, unpricedRequests = 0;
    for (const r of all) {
      const ts = Date.parse(r.timestamp || '');
      if (cutoff && ts < cutoff) continue;
      requests++;
      if (r.success) successfulRequests++; else failedRequests++;
      if (Number.isInteger(r.inputTokens)) inputTokens += r.inputTokens;
      if (Number.isInteger(r.outputTokens)) outputTokens += r.outputTokens;
      if (Number.isInteger(r.totalTokens)) totalTokens += r.totalTokens;
      if (typeof r.cost === 'number') { pricedCostSum += r.cost; pricedRequests++; }
      else if (r.costStatus === 'PRICE_UNKNOWN') { unpricedRequests++; }
      const a = (agents[r.agentId] = agents[r.agentId] || { agentId: r.agentId, requests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, cost: 0 });
      a.requests++;
      if (Number.isInteger(r.inputTokens)) a.inputTokens += r.inputTokens;
      if (Number.isInteger(r.outputTokens)) a.outputTokens += r.outputTokens;
      if (Number.isInteger(r.totalTokens)) a.totalTokens += r.totalTokens;
      if (typeof r.cost === 'number') a.cost += r.cost;
    }
    const estimatedCost = pricedRequests > 0 ? pricedCostSum : null;
    const estimatedCostStatus = unpricedRequests > 0 ? 'PARTIAL' : (requests > 0 ? 'OK' : 'EMPTY');
    return { days, requests, successfulRequests, failedRequests, inputTokens, outputTokens,
             totalTokens, estimatedCost, estimatedCostStatus, pricedRequests, unpricedRequests,
             currency: (all[0] && all[0].currency) || 'USD',
             byAgent: Object.values(agents) };
  }

  // --- Phase 14: recompute cost from CURRENT pricing (price additions retroactively
  // price history). Never fabricate: unknown price -> null, never 0. ----------------
  computeCost(record) {
    return costFor(record, this.loadPricing());
  }

  _bucket() {
    return { requests: 0, success: 0, fail: 0, inputTokens: 0, outputTokens: 0,
             cachedTokens: 0, reasoningTokens: 0, totalTokens: 0, pricedRequests: 0,
             unpricedRequests: 0, cost: 0 };
  }
  _acc(b, r, c) {
    b.requests++;
    if (r.success) b.success++; else b.fail++;
    const num = (v) => (Number.isInteger(v) ? v : 0);
    b.inputTokens += num(r.inputTokens);
    b.outputTokens += num(r.outputTokens);
    b.cachedTokens += num(r.cachedTokens);
    b.reasoningTokens += num(r.reasoningTokens);
    b.totalTokens += num(r.totalTokens);
    if (typeof c.totalCost === 'number') { b.cost += c.totalCost; b.pricedRequests++; }
    else if (c.costStatus === 'PRICE_UNKNOWN') { b.unpricedRequests++; }
    return b;
  }

  // Rich dashboard: by window + by agent/provider/model, with per-line cost recomputed.
  dashboard(days) {
    const all = this.readAll();
    const cutoff = days > 0 ? Date.now() - days * 86400000 : 0;
    const total = this._bucket();
    const byAgent = {}, byProvider = {}, byModel = {};
    let observed = 0;
    for (const r of all) {
      const ts = Date.parse(r.timestamp || '');
      if (cutoff && ts < cutoff) continue;
      observed++;
      const c = this.computeCost(r);
      this._acc(total, r, c);
      const a = this._acc(byAgent[r.agentId || 'unknown'] = this._bucket(), r, c);
      const pKey = r.provider || 'unknown';
      byProvider[pKey] = byProvider[pKey] || { key: pKey, ...this._bucket(), currency: this.loadPricing().currency || 'USD' };
      this._acc(byProvider[pKey], r, c);
      const mKey = (r.provider || 'unknown') + ' / ' + (r.model || 'unknown');
      byModel[mKey] = byModel[mKey] || { key: mKey, provider: r.provider || '', model: r.model || '', ...this._bucket() };
      this._acc(byModel[mKey], r, c);
    }
    const pricing = this.loadPricing();
    return {
      days, observedRequests: observed,
      requests: total.requests, success: total.success, fail: total.fail,
      inputTokens: total.inputTokens, outputTokens: total.outputTokens,
      cachedTokens: total.cachedTokens, reasoningTokens: total.reasoningTokens,
      totalTokens: total.totalTokens,
      cost: total.pricedRequests > 0 ? total.cost : null,
      costStatus: total.requests === 0 ? 'EMPTY' : (total.unpricedRequests > 0 ? 'PARTIAL' : 'OK'),
      pricedRequests: total.pricedRequests, unpricedRequests: total.unpricedRequests,
      currency: pricing.currency || 'USD',
      byAgent: Object.entries(byAgent).map(([k, v]) => ({ key: k, ...v })),
      byProvider: Object.values(byProvider),
      byModel: Object.values(byModel),
    };
  }

  // --- Phase 14: export (sanitized, whitelist-only; never secrets/bodies) --------
  exportRecords(format) {
    const all = this.readAll();
    const FIELDS = ['id','timestamp','agentId','provider','model','inputTokens','outputTokens',
                    'cachedTokens','reasoningTokens','totalTokens','durationMs','success',
                    'statusCode','cost','costStatus','currency'];
    const clean = all.map((r) => {
      const o = {}; for (const f of FIELDS) o[f] = (f in r) ? r[f] : null; return o;
    });
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').split('.')[0];
    if (format === 'csv') {
      const esc = (v) => (typeof v === 'string' ? '"' + v.replace(/"/g, '""') + '"' : (v == null ? '' : v));
      const lines = [FIELDS.join(',')].concat(clean.map((o) => FIELDS.map((f) => esc(o[f])).join(',')));
      const file = path.join(this.dir, 'export-' + stamp + '.csv');
      fs.writeFileSync(file, '﻿' + lines.join('\n'), 'utf8');
      return { path: file, count: clean.length };
    }
    // default JSON
    const file = path.join(this.dir, 'export-' + stamp + '.json');
    fs.writeFileSync(file, JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), records: clean }, null, 2), 'utf8');
    return { path: file, count: clean.length };
  }

  // --- Phase 14: pricing registry read/write (prices REQUIRE a source string) ----
  loadPricingRaw() { return this.loadPricing(); }
  savePricing(pricing) {
    // Defensive normalize + strip any accidental secret-like fields.
    const out = { version: 1, currency: String(pricing.currency || 'USD').toUpperCase(), providers: {} };
    for (const [pname, pval] of Object.entries(pricing.providers || {})) {
      const pKey = String(pname).toLowerCase();
      const prov = { label: String((pval && pval.label) || pKey), models: {} };
      for (const [mname, mval] of Object.entries(((pval && pval.models) || {}))) {
        if (!mval || typeof mval !== 'object') continue;
        const entry = {
          input_per_1m: Number(mval.input_per_1m),
          output_per_1m: Number(mval.output_per_1m),
          cached_per_1m: (mval.cached_per_1m == null || mval.cached_per_1m === '') ? null : Number(mval.cached_per_1m),
          reasoning_per_1m: (mval.reasoning_per_1m == null || mval.reasoning_per_1m === '') ? null : Number(mval.reasoning_per_1m),
          effective_from: String(mval.effective_from || ''),
          source: String(mval.source || ''),
          verified: !!mval.verified,
        };
        prov.models[mname] = entry;
      }
      out.providers[pKey] = prov;
    }
    fs.mkdirSync(path.dirname(this.pricingFile), { recursive: true });
    fs.writeFileSync(this.pricingFile, JSON.stringify(out, null, 2), 'utf8');
    return out;
  }
}

module.exports = { parseUsage, parseOpenAIUsage, parseAnthropicUsage, costFor, findPrice, UsageStore };
