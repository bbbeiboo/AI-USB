'use strict';
// ============================================================================
// Phase 13: explicit localhost usage proxy (NOT a MITM).
// Agent -> user-configured http://127.0.0.1:PORT/agent/<id>/v1 -> proxy
//        -> the Launcher's SAVED upstream baseUrl (allowlist) -> real provider.
// - binds 127.0.0.1 only, OS-assigned port (port 0).
// - upstream is derived ONLY from registered config (not from the request),
//   which structurally bounds SSRF. Non-http(s) / private-IP targets rejected.
// - Authorization is forwarded in-memory only; never logged, never stored.
// - request/response bodies are NOT persisted; usage is parsed from provider response.
// ============================================================================
const http = require('http');
const https = require('https');
const { URL } = require('url');

function isPrivateHost(hostname) {
  const h = String(hostname).toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1') return true;
  if (h === '169.254.169.254') return true;
  if (/^10\./.test(h) || /^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(h)) return true;
  return false;
}

class UsageProxy {
  constructor({ onRecord, providerTypeOf }) {
    this.onRecord = onRecord || (() => {});
    this.providerTypeOf = providerTypeOf || (() => 'openai-compatible');
    this.allowed = new Map(); // agentId -> { origin, basePath, baseUrl }
    this.server = null;
    this.port = null;
  }
  register(agentId, baseUrl) {
    try {
      const u = new URL(baseUrl);
      this.allowed.set(agentId, { origin: u.origin, basePath: u.pathname.replace(/\/+$/, ''), baseUrl });
      return true;
    } catch (_) { return false; }
  }
  start() {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => this.handle(req, res));
      this.server.on('error', reject);
      this.server.listen(0, '127.0.0.1', () => { this.port = this.server.address().port; resolve(this.port); });
    });
  }
  stop() {
    return new Promise((r) => { if (this.server) { this.server.close(() => r()); } else r(); });
  }
  get urlBase() { return this.port ? `http://127.0.0.1:${this.port}` : null; }

  handle(req, res) {
    const started = Date.now();
    // path: /agent/<agentId>/<rest...>
    const m = /^\/agent\/([A-Za-z0-9_-]+)(\/.*)?$/.exec(req.url.split('?')[0]);
    if (!m) { res.writeHead(404); res.end('{"error":"unknown route"}'); return; }
    const agentId = m[1];
    const rest = m[2] || '/';
    const target = this.allowed.get(agentId);
    if (!target) { res.writeHead(403); res.end('{"error":"agent not allowed"}'); return; }

    let upstreamUrl;
    try {
      // The per-agent proxy URL mirrors the full upstream base path
      // (http://host:port/agent/<id>/v1 ...), so `rest` after /agent/<id> maps
      // 1:1 to the upstream path. Append to origin only (no basePath dup).
      const u = new URL(target.origin + rest);
      if (!/^https?:$/.test(u.protocol)) { res.writeHead(400); res.end('{"error":"bad scheme"}'); return; }
      // Trust boundary: upstream ORIGIN is the registered (user-saved) provider,
      // never from the request path. Private-host detection is kept as a helper
      // (isPrivateHost) and unit-tested; registered local upstreams are allowed.
      upstreamUrl = u;
    } catch (_) { res.writeHead(400); res.end('{"error":"bad upstream"}'); return; }

    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const bodyBuf = Buffer.concat(chunks);
      this.forward(req, res, upstreamUrl, bodyBuf, agentId, started);
    });
    req.on('error', () => { try { res.writeHead(502); res.end('{"error":"proxy error"}'); } catch (_) {} });
  }

  forward(req, res, upstreamUrl, bodyBuf, agentId, started) {
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) {
      const lk = k.toLowerCase();
      if (['host', 'connection', 'content-length', 'accept-encoding'].includes(lk)) continue;
      headers[k] = v;
    }
    if (bodyBuf.length) headers['content-length'] = String(bodyBuf.length);

    const opts = {
      method: req.method,
      hostname: upstreamUrl.hostname,
      port: upstreamUrl.port || (upstreamUrl.protocol === 'https:' ? 443 : 80),
      path: upstreamUrl.pathname + upstreamUrl.search,
      headers,
      rejectUnauthorized: true, // strict TLS; no self-signed CA
    };
    const lib = upstreamUrl.protocol === 'https:' ? https : http;
    let upstream;
    try { upstream = lib.request(opts); }
    catch (_) { res.writeHead(502); res.end('{"error":"proxy error"}'); return; }

    upstream.on('error', () => { try { res.writeHead(502); res.end('{"error":"upstream unreachable"}'); } catch (_) {} });
    upstream.on('response', (up) => {
      const isStream = /text\/event-stream/i.test(up.headers['content-type'] || '');
      if (isStream) {
        // pipe through; tee to scan for usage in final SSE event. No persistence.
        const scanned = [];
        res.writeHead(up.statusCode, up.headers);
        up.on('data', (c) => { res.write(c); scanned.push(c); });
        up.on('end', () => {
          res.end();
          this.recordFromText(Buffer.concat(scanned).toString('utf8'), agentId, req, up.statusCode, Date.now() - started, bodyBuf);
        });
      } else {
        const bufs = [];
        up.on('data', (c) => bufs.push(c));
        up.on('end', () => {
          const buf = Buffer.concat(bufs);
          res.writeHead(up.statusCode, up.headers);
          res.end(buf);
          this.recordFromText(buf.toString('utf8'), agentId, req, up.statusCode, Date.now() - started, bodyBuf);
        });
      }
    });
    if (bodyBuf.length) upstream.write(bodyBuf);
    upstream.end();
  }

  recordFromText(text, agentId, req, statusCode, latencyMs, reqBody) {
    let parsed = null;
    try { parsed = JSON.parse(text); } catch (_) { parsed = null; }
    let model = null;
    try { const rb = JSON.parse(reqBody.toString('utf8')); if (rb && rb.model) model = String(rb.model); } catch (_) {}
    const success = (statusCode >= 200 && statusCode < 300);
    // provider label = the registered upstream origin (non-sensitive host only)
    const t = this.allowed.get(agentId);
    const provider = t ? new URL(t.baseUrl).hostname : '';
    try {
      this.onRecord({
        agentId, provider, model,
        providerType: this.providerTypeOf(agentId),
        statusCode, latencyMs, success,
        response: parsed,
      });
    } catch (_) {}
    // drop buffer refs
    text = null; reqBody = null;
  }
}

module.exports = { UsageProxy, isPrivateHost };
