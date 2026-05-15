#!/usr/bin/env node
let passed = 0, failed = 0;
function assert(c, m) { if (c) { console.log(`  ✓ ${m}`); passed++; } else { console.error(`  ✗ ${m}`); failed++; } }

// We need to control process.env BEFORE require-time inside the helper, so
// the helper must read env lazily (every call). Verify that contract too.

(async () => {
  console.log('\n--- getTopChannelIds: default (AT) ---');
  delete process.env.LAUNCH_COUNTRY;
  const { getTopChannelIds, AT_TOP, DE_TOP } = require('../lib/launchChannels');
  let ids = getTopChannelIds();
  assert(Array.isArray(ids) && ids.length === 3, `3 ids (got: ${ids.length})`);
  assert(ids[0] === 'orf1', `first AT id orf1 (got: ${ids[0]})`);

  console.log('\n--- getTopChannelIds: AT explicit ---');
  process.env.LAUNCH_COUNTRY = 'AT';
  ids = getTopChannelIds();
  assert(JSON.stringify(ids) === JSON.stringify(AT_TOP), `AT set matches (got: ${JSON.stringify(ids)})`);

  console.log('\n--- getTopChannelIds: DE ---');
  process.env.LAUNCH_COUNTRY = 'DE';
  ids = getTopChannelIds();
  assert(JSON.stringify(ids) === JSON.stringify(DE_TOP), `DE set matches (got: ${JSON.stringify(ids)})`);
  assert(ids.includes('dasErsteHd'), 'DE includes dasErsteHd');
  assert(ids.includes('zdfHd'), 'DE includes zdfHd');

  console.log('\n--- getTopChannelIds: unknown country falls back to AT ---');
  process.env.LAUNCH_COUNTRY = 'XX';
  ids = getTopChannelIds();
  assert(JSON.stringify(ids) === JSON.stringify(AT_TOP), 'unknown -> AT fallback');

  delete process.env.LAUNCH_COUNTRY;

  console.log('\n--- AT_TOP / DE_TOP are frozen (cannot be mutated) ---');
  let threwOnPush = false;
  try {
    AT_TOP.push('hacked');
  } catch (e) {
    threwOnPush = true;
  }
  // In strict mode this throws; in non-strict mode the push silently fails.
  // Either way, the array must remain unchanged.
  assert(AT_TOP.length === 3, `AT_TOP still has 3 entries (got: ${AT_TOP.length})`);
  assert(Object.isFrozen(AT_TOP), 'AT_TOP is frozen');
  assert(Object.isFrozen(DE_TOP), 'DE_TOP is frozen');

  // getTopChannelIds() should still return mutable copies, not the frozen array
  process.env.LAUNCH_COUNTRY = 'AT';
  const returned = getTopChannelIds();
  assert(!Object.isFrozen(returned), 'returned array is a mutable copy (not the frozen original)');
  returned.push('caller-mutated');
  assert(returned.length === 4 && AT_TOP.length === 3, 'mutating returned array does not affect AT_TOP');
  delete process.env.LAUNCH_COUNTRY;

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
