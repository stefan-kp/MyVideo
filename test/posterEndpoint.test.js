#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');

let passed = 0, failed = 0;
function assert(c, m) { if (c) { console.log(`  ✓ ${m}`); passed++; } else { console.error(`  ✗ ${m}`); failed++; } }

function touch(p) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, 'fakejpg'); }

(async () => {
  const { resolvePosterPath } = require('../lib/posterLookup');

  console.log('\n--- resolvePosterPath: returns null when content service disabled ---');
  let r = resolvePosterPath('foo/bar', { isEnabled: () => false });
  assert(r === null, `disabled -> null (got ${r})`);

  console.log('\n--- resolvePosterPath: returns null when entry unknown ---');
  r = resolvePosterPath('nope', {
    isEnabled: () => true,
    getIndex: () => ({ findById: () => null }),
  });
  assert(r === null, `unknown -> null (got ${r})`);

  console.log('\n--- resolvePosterPath: returns poster path when found ---');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'poster-ep-'));
  const vid = path.join(root, 'Show', 'S1', 'ep.mp4');
  touch(vid);
  const poster = path.join(root, 'Show', 'S1', 'cover.jpg');
  touch(poster);
  r = resolvePosterPath('show/s1/ep', {
    isEnabled: () => true,
    getIndex: () => ({ findById: (id) => id === 'show/s1/ep' ? { path: vid } : null }),
  });
  assert(r === poster, `found poster (got ${r})`);

  fs.rmSync(root, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
