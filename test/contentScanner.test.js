#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');
const { scanPath } = require('../lib/content/scanner');

let passed = 0, failed = 0;
function assert(c, m) { if (c) { console.log(`  ✓ ${m}`); passed++; } else { console.error(`  ✗ ${m}`); failed++; } }

function mktemp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scantest-'));
  return dir;
}
function touch(p, sizeBytes = 5_000_000) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, Buffer.alloc(sizeBytes));
}

const CFG = {
  extensions: { directPlayCandidates: ['.mp4', '.m4v'], transcodeOnly: ['.mkv', '.avi'] },
  excludePatterns: ['sample', '@eaDir', '.partial', '_UNPACK_'],
};

(async () => {
  const root = mktemp();
  touch(path.join(root, 'Inception (2010).mp4'));
  touch(path.join(root, 'Dune.mkv'));
  touch(path.join(root, 'sample-trailer.mp4'), 500_000); // both: small + match exclude
  touch(path.join(root, '@eaDir/Thumbnails/x.mp4'));
  touch(path.join(root, 'tiny.mp4'), 100); // below 1 MB threshold
  touch(path.join(root, 'notes.txt')); // wrong extension
  touch(path.join(root, '.partial.mp4'));

  console.log('\n--- scanPath - basic walk ---');
  const entries = await scanPath({
    label: 'Filme', path: root, recursive: true, type: 'movie',
  }, CFG);
  const names = entries.map(e => e.filename).sort();
  assert(entries.length === 2, `2 entries (got ${entries.length}: ${names.join(', ')})`);
  assert(names.includes('Inception (2010).mp4'), 'finds Inception');
  assert(names.includes('Dune.mkv'), 'finds Dune');
  assert(!names.find(n => /sample/i.test(n)), 'sample excluded');
  assert(!names.find(n => /tiny/.test(n)), 'tiny file excluded by size');
  assert(!names.find(n => /partial/.test(n)), '.partial excluded');
  assert(!names.find(n => /notes/.test(n)), '.txt excluded');

  console.log('\n--- scanPath - entries have parsed metadata ---');
  const inception = entries.find(e => e.filename.startsWith('Inception'));
  assert(inception.title === 'Inception', 'inception title parsed');
  assert(inception.year === 2010, 'inception year parsed');
  assert(inception.size > 1_000_000, 'size populated');
  assert(typeof inception.mtime === 'string' && inception.mtime.length > 0, 'mtime populated');
  assert(inception.pathLabel === 'Filme', 'pathLabel propagated');
  assert(inception.path === path.join(root, 'Inception (2010).mp4'), 'absolute path');
  assert(inception.id && inception.id.startsWith('filme/'), `slug populated (got ${inception.id})`);

  console.log('\n--- scanPath - recursive false ---');
  const sub = path.join(root, 'inner', 'deep.mp4');
  touch(sub);
  const flat = await scanPath({
    label: 'Filme', path: root, recursive: false, type: 'movie',
  }, CFG);
  assert(!flat.find(e => /deep/.test(e.filename)), 'subdirectory skipped when recursive=false');

  console.log('\n--- scanPath - missing directory tolerated ---');
  const missing = await scanPath({
    label: 'X', path: '/nonexistent/totally', recursive: true, type: 'auto',
  }, CFG);
  assert(Array.isArray(missing) && missing.length === 0, 'returns empty list, no throw');

  fs.rmSync(root, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
