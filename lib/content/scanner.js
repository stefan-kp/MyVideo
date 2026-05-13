const fs = require('fs');
const path = require('path');
const { parseContentFile } = require('./parser');
const { makeSlug } = require('./slug');

const MIN_SIZE_BYTES = 1_000_000;  // ignore <1 MB to skip samples/teasers

/**
 * Walk a single configured path and return ContentEntry objects.
 * Tolerant of missing directories (logs + returns []) so a disconnected
 * NAS mount doesn't break server startup.
 *
 * @param {{label, path, recursive, type, newerThanDays}} pathConfig
 * @param {{extensions, excludePatterns}} globalConfig
 */
async function scanPath(pathConfig, globalConfig) {
  if (!fs.existsSync(pathConfig.path)) {
    console.warn(`[content] scan: ${pathConfig.label}: path missing: ${pathConfig.path}`);
    return [];
  }
  const knownExts = new Set([
    ...globalConfig.extensions.directPlayCandidates,
    ...globalConfig.extensions.transcodeOnly,
  ].map(e => e.toLowerCase()));

  const excludeRe = new RegExp(
    globalConfig.excludePatterns.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
    'i',
  );

  const entries = [];
  const slugs = new Set();

  function walk(dir) {
    let dirents;
    try {
      dirents = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      console.warn(`[content] scan: cannot read ${dir}: ${err.message}`);
      return;
    }
    for (const d of dirents) {
      const full = path.join(dir, d.name);
      if (excludeRe.test(full)) continue;
      if (d.isDirectory()) {
        if (pathConfig.recursive) walk(full);
        continue;
      }
      if (!d.isFile()) continue;
      const ext = path.extname(d.name).toLowerCase();
      if (!knownExts.has(ext)) continue;
      let stat;
      try { stat = fs.statSync(full); } catch { continue; }
      if (stat.size < MIN_SIZE_BYTES) continue;

      const parsed = parseContentFile(full, {
        type: pathConfig.type,
        label: pathConfig.label,
        basePath: pathConfig.path,
      });
      const entry = {
        ...parsed,
        path: full,
        pathLabel: pathConfig.label,
        size: stat.size,
        mtime: stat.mtime.toISOString(),
        codecInfo: null,
      };
      entry.id = makeSlug(entry, slugs);
      slugs.add(entry.id);
      entries.push(entry);
    }
  }

  walk(pathConfig.path);
  return entries;
}

/**
 * Scan all configured paths. Returns combined entry list and a per-path summary.
 */
async function scanAll(pathsConfig) {
  const all = [];
  const summary = [];
  for (const p of pathsConfig.paths) {
    const before = all.length;
    const entries = await scanPath(p, pathsConfig);
    all.push(...entries);
    summary.push({ label: p.label, path: p.path, count: entries.length });
    console.log(`[content] scan: ${p.label} → ${entries.length} entries`);
  }
  return { entries: all, summary };
}

module.exports = { scanPath, scanAll };
