#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ContentIndex } = require('../lib/content/index');

let passed = 0, failed = 0;
function assert(c, m) { if (c) { console.log(`  ✓ ${m}`); passed++; } else { console.error(`  ✗ ${m}`); failed++; } }

function entry(id, overrides = {}) {
  return {
    id, path: '/x/' + id, pathLabel: 'Filme', filename: id + '.mp4',
    ext: '.mp4', size: 5_000_000, mtime: '2026-05-01T00:00:00Z',
    type: 'movie', title: id, codecInfo: null, ...overrides,
  };
}

(async () => {
  console.log('\n--- replaceAll + findById ---');
  const idx = new ContentIndex();
  idx.replaceAll([entry('a'), entry('b'), entry('c')]);
  assert(idx.findById('a').id === 'a', 'finds a');
  assert(idx.findById('missing') == null, 'returns null for missing');
  assert(idx.count() === 3, 'count is 3');

  console.log('\n--- persist + load ---');
  const file = path.join(os.tmpdir(), `idx.${Date.now()}.json`);
  idx.save(file);
  const idx2 = new ContentIndex();
  idx2.load(file);
  assert(idx2.count() === 3, 'persisted count 3');
  assert(idx2.findById('b').title === 'b', 'persisted entry intact');
  fs.unlinkSync(file);

  console.log('\n--- load missing file returns false ---');
  const idx3 = new ContentIndex();
  const ok = idx3.load('/nope/missing.json');
  assert(ok === false, 'load returns false on missing');
  assert(idx3.count() === 0, 'count stays 0');

  console.log('\n--- updateEntryCodec ---');
  const idx4 = new ContentIndex();
  idx4.replaceAll([entry('a')]);
  idx4.updateEntryCodec('a', { video: 'h264', audio: 'aac', directPlay: true });
  assert(idx4.findById('a').codecInfo.directPlay === true, 'codec info persisted');

  console.log('\n--- mergeFromScan - keeps codec cache for unchanged files ---');
  const idx5 = new ContentIndex();
  idx5.replaceAll([entry('a', { codecInfo: { directPlay: true, probedAt: '2026-04-01' } })]);
  idx5.mergeFromScan([
    entry('a'), // re-scanned, codecInfo null
    entry('b'), // new
  ]);
  assert(idx5.count() === 2, 'merged count 2');
  assert(idx5.findById('a').codecInfo?.directPlay === true, 'codec cache preserved');
  assert(idx5.findById('b').codecInfo === null, 'new entry has no codec yet');

  console.log('\n--- mergeFromScan - drops removed files ---');
  idx5.mergeFromScan([entry('a')]);
  assert(idx5.findById('b') == null, 'b dropped after rescan');
  assert(idx5.count() === 1, 'count back to 1');

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
