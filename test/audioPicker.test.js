#!/usr/bin/env node
/**
 * audioPicker test - exercises the pickAudioStream selection logic
 * Run: node test/audioPicker.test.js
 *
 * Note: pickAudioStream now returns the AUDIO-RELATIVE index (position in
 * the audio-only sub-list), not the container index. So a list of two
 * audio streams at container indices 3 and 4 will return 0 or 1, never 3/4.
 */
const { pickAudioStream } = require('../lib/fritzbox/audioPicker');

let passed = 0, failed = 0;
function assert(c, m) { if (c) { console.log(`  ✓ ${m}`); passed++; } else { console.error(`  ✗ ${m}`); failed++; } }

function s(opts) {
  return {
    index: opts.index,
    tags: { language: opts.lang || '' },
    disposition: {
      default: opts.default ? 1 : 0,
      visual_impaired: opts.visualImpaired ? 1 : 0,
    },
  };
}

console.log('\n--- pickAudioStream (returns audio-relative index) ---');

// 1. German first in list → relative 0
assert(
  pickAudioStream([
    s({ index: 3, lang: 'deu' }),
    s({ index: 4, lang: 'eng' }),
  ]) === 0,
  'deu at audio-position 0 → returns 0'
);

// 2. AD on deu is skipped in favour of clean deu
assert(
  pickAudioStream([
    s({ index: 3, lang: 'deu', visualImpaired: true }),
    s({ index: 4, lang: 'deu' }),
    s({ index: 5, lang: 'eng' }),
  ]) === 1,
  'skips AD-marked deu (rel 0), takes clean deu (rel 1)'
);

// 3. If only AD-marked deu and other languages exist, still falls back to deu
assert(
  pickAudioStream([
    s({ index: 3, lang: 'deu', visualImpaired: true }),
    s({ index: 4, lang: 'eng' }),
  ]) === 0,
  'AD deu (rel 0) beats eng (rel 1) when no clean deu exists'
);

// 4. No deu at all: pick default
assert(
  pickAudioStream([
    s({ index: 3, lang: 'eng' }),
    s({ index: 4, lang: 'fra', default: true }),
  ]) === 1,
  'picks default track (rel 1) when no deu'
);

// 5. No deu, no default: pick first
assert(
  pickAudioStream([
    s({ index: 3, lang: 'eng' }),
    s({ index: 4, lang: 'fra' }),
  ]) === 0,
  'picks first (rel 0) when no deu and no default'
);

// 6. ORF 1 real-world case from this user's setup
// ffprobe returned: index 3 (deu AC-3 5.1), index 4 (eng MP2 stereo)
assert(
  pickAudioStream([
    s({ index: 3, lang: 'deu' }),
    s({ index: 4, lang: 'eng' }),
  ]) === 0,
  'ORF 1: picks AC-3 5.1 deu (rel 0) over MP2 stereo eng (rel 1)'
);

// 7. ORF 2 Tirol real-world case (container indices are different, but the
// audio-relative index is what matters for `-map 0:a:N`)
assert(
  pickAudioStream([
    s({ index: 2, lang: 'deu' }),
    s({ index: 3, lang: 'eng' }),
  ]) === 0,
  'ORF 2 Tirol: deu at container index 2 → audio-relative 0'
);

// 8. Empty list returns null
assert(pickAudioStream([]) === null, 'empty list returns null');
assert(pickAudioStream(null) === null, 'null input returns null');

// 9. Language prefix match
assert(
  pickAudioStream([
    s({ index: 3, lang: 'de' }),
    s({ index: 4, lang: 'eng' }),
  ]) === 0,
  'short "de" language tag still treated as German'
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
