#!/usr/bin/env node
/**
 * channels.js registry test - verifies HLS sources still resolve correctly
 * Run: node test/channelsRegistry.test.js
 */
process.env.JWT_SECRET = 'test-secret-1234567890abcdef1234567890abcdef';
process.env.BASE_URL = 'http://localhost:3000';

const channels = require('../lib/channels');

let passed = 0, failed = 0;
function assert(c, m) { if (c) { console.log(`  ✓ ${m}`); passed++; } else { console.error(`  ✗ ${m}`); failed++; } }

(async () => {
  console.log('\n--- findChannel ---');
  const zdf = channels.findChannel('zdf');
  assert(zdf, 'finds ZDF by synonym "zdf"');
  assert(zdf.id === 'ZDF_HD', 'returns ZDF_HD');
  assert(typeof zdf.resolveStream === 'function', 'has resolveStream()');
  assert(zdf.logo, 'has logo URL');

  console.log('\n--- listChannels ---');
  const groups = channels.listChannels();
  assert(Object.keys(groups).length > 0, 'returns at least one group');
  const allChannels = Object.values(groups).flat();
  assert(allChannels.length >= 9, `>= 9 channels (got ${allChannels.length})`);

  console.log('\n--- findChannelById ---');
  const phx = channels.findChannelById('Phoenix_HD');
  assert(phx && phx.id === 'Phoenix_HD', 'finds Phoenix_HD by id');

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
