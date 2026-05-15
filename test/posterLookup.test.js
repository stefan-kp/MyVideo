#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');

let passed = 0, failed = 0;
function assert(c, m) { if (c) { console.log(`  ✓ ${m}`); passed++; } else { console.error(`  ✗ ${m}`); failed++; } }

function touch(p) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, 'fakejpg'); }

(async () => {
  const { findPosterForEntry } = require('../lib/posterLookup');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'poster-'));

  console.log('\n--- cover.jpg in same dir wins ---');
  const vid = path.join(root, 'Show', 'Season 1', 'S01E01.mp4');
  touch(vid);
  touch(path.join(root, 'Show', 'Season 1', 'cover.jpg'));
  let res = findPosterForEntry({ path: vid });
  assert(res === path.join(root, 'Show', 'Season 1', 'cover.jpg'), `cover.jpg picked (got ${res})`);

  console.log('\n--- poster.jpg picked over folder.jpg ---');
  const root2 = fs.mkdtempSync(path.join(os.tmpdir(), 'poster-'));
  const vid2 = path.join(root2, 'S.mp4');
  touch(vid2);
  touch(path.join(root2, 'folder.jpg'));
  touch(path.join(root2, 'poster.jpg'));
  res = findPosterForEntry({ path: vid2 });
  assert(res === path.join(root2, 'poster.jpg'), `poster.jpg over folder (got ${res})`);

  console.log('\n--- falls back to parent dir ---');
  const root3 = fs.mkdtempSync(path.join(os.tmpdir(), 'poster-'));
  const vid3 = path.join(root3, 'Show', 'Season 2', 'S02E01.mp4');
  touch(vid3);
  touch(path.join(root3, 'Show', 'poster.jpg')); // one level up
  res = findPosterForEntry({ path: vid3 });
  assert(res === path.join(root3, 'Show', 'poster.jpg'), `parent-dir poster (got ${res})`);

  console.log('\n--- nothing found returns null ---');
  const root4 = fs.mkdtempSync(path.join(os.tmpdir(), 'poster-'));
  const vid4 = path.join(root4, 'x.mp4');
  touch(vid4);
  res = findPosterForEntry({ path: vid4 });
  assert(res === null, `no poster (got ${res})`);

  for (const r of [root, root2, root3, root4]) {
    try { fs.rmSync(r, { recursive: true, force: true }); } catch (_) {}
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
