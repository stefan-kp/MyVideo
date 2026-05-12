#!/usr/bin/env node
/**
 * audioPicker test - exercises the pickAudioStream selection logic
 * Run: node test/audioPicker.test.js
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

console.log('\n--- pickAudioStream ---');

// 1. German + not visually-impaired wins
assert(
  pickAudioStream([
    s({ index: 3, lang: 'deu' }),
    s({ index: 4, lang: 'eng' }),
  ]) === 3,
  'picks deu over eng'
);

// 2. AD on deu is skipped in favour of clean deu
assert(
  pickAudioStream([
    s({ index: 3, lang: 'deu', visualImpaired: true }),
    s({ index: 4, lang: 'deu' }),
    s({ index: 5, lang: 'eng' }),
  ]) === 4,
  'skips AD-marked deu, takes clean deu'
);

// 3. If only AD-marked deu and other languages exist, still falls back to deu
//    (better AD than wrong language)
assert(
  pickAudioStream([
    s({ index: 3, lang: 'deu', visualImpaired: true }),
    s({ index: 4, lang: 'eng' }),
  ]) === 3,
  'AD deu beats eng when no clean deu exists'
);

// 4. No deu at all: pick default
assert(
  pickAudioStream([
    s({ index: 3, lang: 'eng' }),
    s({ index: 4, lang: 'fra', default: true }),
  ]) === 4,
  'picks default track when no deu'
);

// 5. No deu, no default: pick first
assert(
  pickAudioStream([
    s({ index: 3, lang: 'eng' }),
    s({ index: 4, lang: 'fra' }),
  ]) === 3,
  'picks first when no deu and no default'
);

// 6. ORF 1 real-world case from this user's setup
assert(
  pickAudioStream([
    s({ index: 3, lang: 'deu' }),
    s({ index: 4, lang: 'eng' }),
  ]) === 3,
  'ORF 1 example: picks AC-3 5.1 deu (index 3) over MP2 stereo eng (index 4)'
);

// 7. Empty list returns null
assert(pickAudioStream([]) === null, 'empty list returns null');
assert(pickAudioStream(null) === null, 'null input returns null');

// 8. Language prefix match (de, deu, ger should all count as German)
//    We only check "de" prefix in audioPicker, which catches deu/ger/de variants
assert(
  pickAudioStream([
    s({ index: 3, lang: 'de' }),
    s({ index: 4, lang: 'eng' }),
  ]) === 3,
  'short "de" language tag still treated as German'
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
