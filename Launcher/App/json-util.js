// ============================================================================
// Shared tolerant JSON reader (BOM-safe).
//
// Why this exists: a JSON config file saved by a Windows editor/script with a
// UTF-8 BOM ("UTF-8 with BOM" in Notepad, `Set-Content -Encoding UTF8` in
// Windows PowerShell 5.1) starts with U+FEFF. Node's
// `fs.readFileSync(p, 'utf8')` does NOT strip it, so `JSON.parse` throws
// "Unexpected token '\uFEFF'" and every caller silently fell back to its
// default value — a BOM'd user-config.json therefore looked like "no API
// configuration" instead of an error (this really happened; it produced
// `Env SKIP reason=user-config-incomplete` for every agent).
//
// Every JSON config read point goes through readJsonSafe()/stripBom() so a BOM
// is tolerated identically everywhere and is never silent: callers pass an
// onStrippedBom callback that writes a `[config] stripped BOM from <file>` line
// to the launcher log.
//
// Scope: reads only. The write path stays BOM-free (fs.writeFileSync with
// 'utf8' never emits a BOM), so files this app writes never need this.
// ============================================================================
'use strict';

const fs = require('fs');

const BOM_CHAR_CODE = 0xFEFF;

// Returns `text` without a leading UTF-8 BOM (byte-identical when there is none).
function stripBom(text) {
  if (typeof text === 'string' && text.charCodeAt(0) === BOM_CHAR_CODE) return text.slice(1);
  return text;
}

// Read + parse a JSON file, tolerating a leading BOM.
//
//   filePath                absolute path
//   opts.defaultValue       returned when the file is missing/unreadable or its
//                           content is not valid JSON (default: null)
//   opts.onStrippedBom(p)   called only when a BOM was actually removed
//   opts.strict             when true, throw instead of returning defaultValue:
//                           err.code === 'EUNREADABLE' (fs error) or
//                           err.code === 'EINVALIDJSON' (parse error), with the
//                           original error attached as err.cause
function readJsonSafe(filePath, opts) {
  const o = opts || {};
  const defaultValue = Object.prototype.hasOwnProperty.call(o, 'defaultValue') ? o.defaultValue : null;
  const onStrippedBom = typeof o.onStrippedBom === 'function' ? o.onStrippedBom : null;
  const strict = !!o.strict;

  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    if (strict) {
      const err = new Error('unreadable');
      err.code = 'EUNREADABLE';
      err.cause = e;
      throw err;
    }
    return defaultValue;
  }

  if (raw.charCodeAt(0) === BOM_CHAR_CODE) {
    raw = raw.slice(1);
    if (onStrippedBom) { try { onStrippedBom(filePath); } catch (_) { /* logging must never break loading */ } }
  }

  try {
    return JSON.parse(raw);
  } catch (e) {
    if (strict) {
      const err = new Error('invalid JSON');
      err.code = 'EINVALIDJSON';
      err.cause = e;
      throw err;
    }
    return defaultValue;
  }
}

module.exports = { BOM_CHAR_CODE, stripBom, readJsonSafe };
