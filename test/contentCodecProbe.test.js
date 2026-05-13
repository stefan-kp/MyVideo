#!/usr/bin/env node
const { decidePlayMode, probeIfNeeded } = require('../lib/content/codecProbe');

let passed = 0, failed = 0;
function assert(c, m) { if (c) { console.log(`  ✓ ${m}`); passed++; } else { console.error(`  ✗ ${m}`); failed++; } }

console.log('\n--- decidePlayMode ---');
assert(decidePlayMode({ ext: '.mp4', video: 'h264', audio: 'aac', level: 31 }) === true, 'mp4+h264+aac → direct');
assert(decidePlayMode({ ext: '.m4v', video: 'h264', audio: 'aac', level: 31 }) === true, 'm4v ok too');
assert(decidePlayMode({ ext: '.mkv', video: 'h264', audio: 'aac' }) === false, 'mkv not direct');
assert(decidePlayMode({ ext: '.mp4', video: 'hevc', audio: 'aac' }) === false, 'hevc not direct');
assert(decidePlayMode({ ext: '.mp4', video: 'h264', audio: 'ac3' }) === false, 'ac3 not direct');
assert(decidePlayMode({ ext: '.mp4', video: 'h264', audio: 'aac', level: 51 }) === false, 'level 5.1 too high');

console.log('\n--- probeIfNeeded - existing codecInfo short-circuit ---');
(async () => {
  const cached = { video: 'h264', audio: 'aac', directPlay: true, probedAt: 't' };
  const entry = { id: 'x', path: '/x', ext: '.mp4', codecInfo: cached };
  let called = 0;
  const fakeProbe = async () => { called++; return { video: 'h264', audio: 'aac' }; };
  const out = await probeIfNeeded(entry, { probeFn: fakeProbe });
  assert(out === cached, 'returns cached object as-is');
  assert(called === 0, 'probe not called');

  console.log('\n--- probeIfNeeded - runs probe + sets codecInfo ---');
  const entry2 = { id: 'y', path: '/y/Inception.mp4', ext: '.mp4', codecInfo: null };
  const out2 = await probeIfNeeded(entry2, {
    probeFn: async () => ({ video: 'h264', audio: 'aac', level: 31 }),
  });
  assert(out2.directPlay === true, 'directPlay decided');
  assert(out2.video === 'h264', 'video stored');
  assert(entry2.codecInfo === out2, 'entry.codecInfo populated');
  assert(typeof out2.probedAt === 'string', 'probedAt timestamp set');

  console.log('\n--- probeIfNeeded - probe failure → directPlay false ---');
  const entry3 = { id: 'z', path: '/z/broken.mkv', ext: '.mkv', codecInfo: null };
  const out3 = await probeIfNeeded(entry3, {
    probeFn: async () => { throw new Error('ffprobe boom'); },
  });
  assert(out3.directPlay === false, 'on error, default to transcode');
  assert(out3.error && /boom/.test(out3.error), 'error stored');

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
