#!/usr/bin/env node
/**
 * content/paths test - config loading and validation
 * Run: node test/contentPaths.test.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadPathsConfig, validateConfig } = require('../lib/content/paths');

let passed = 0, failed = 0;
function assert(c, m) { if (c) { console.log(`  ✓ ${m}`); passed++; } else { console.error(`  ✗ ${m}`); failed++; } }

function tmpConfig(content) {
  const file = path.join(os.tmpdir(), `pathsconf.${Date.now()}.${Math.random()}.json`);
  fs.writeFileSync(file, JSON.stringify(content));
  return file;
}

(async () => {
  console.log('\n--- loadPathsConfig ---');
  const f = tmpConfig({
    paths: [
      { label: 'Filme', path: '/x/movies', newerThanDays: 90, recursive: true, type: 'movie' },
    ],
    extensions: { directPlayCandidates: ['.mp4'], transcodeOnly: ['.mkv'] },
    excludePatterns: ['sample'],
  });
  const cfg = loadPathsConfig(f);
  assert(cfg.paths.length === 1, 'loads one path');
  assert(cfg.paths[0].label === 'Filme', 'label preserved');
  assert(cfg.extensions.directPlayCandidates[0] === '.mp4', 'extensions preserved');
  assert(cfg.excludePatterns[0] === 'sample', 'excludePatterns preserved');
  fs.unlinkSync(f);

  console.log('\n--- loadPathsConfig with defaults ---');
  const f2 = tmpConfig({ paths: [{ label: 'Filme', path: '/x', newerThanDays: 30 }] });
  const cfg2 = loadPathsConfig(f2);
  assert(cfg2.paths[0].recursive === true, 'recursive default true');
  assert(cfg2.paths[0].type === 'auto', 'type default auto');
  assert(Array.isArray(cfg2.extensions.directPlayCandidates), 'extensions default present');
  fs.unlinkSync(f2);

  console.log('\n--- loadPathsConfig - missing file returns null ---');
  const cfg3 = loadPathsConfig('/nonexistent/path/whatever.json');
  assert(cfg3 === null, 'returns null when missing');

  console.log('\n--- validateConfig ---');
  let err;
  try { validateConfig({ paths: [{ path: '/x' }] }); } catch (e) { err = e; }
  assert(err && /label/.test(err.message), 'rejects path entry without label');

  try { validateConfig({ paths: [{ label: 'X' }] }); } catch (e) { err = e; }
  assert(err && /path/.test(err.message), 'rejects entry without path');

  try { validateConfig({}); } catch (e) { err = e; }
  assert(err && /paths/.test(err.message), 'rejects config without paths array');

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
