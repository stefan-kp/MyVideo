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

async function testFritzboxMerge() {
  console.log('\n--- FRITZ!Box merge ---');
  // Set FRITZ!Box env so channels.js loads the FRITZ!Box channels
  process.env.FRITZBOX_HOST = '192.168.0.1';
  process.env.FRITZBOX_USER = 'tv';
  process.env.FRITZBOX_PASSWORD = 'fake';

  // Reload module after env change
  delete require.cache[require.resolve('../lib/channels')];
  delete require.cache[require.resolve('../lib/sources/fritzboxSource')];
  delete require.cache[require.resolve('../lib/fritzbox/session')];
  const ch = require('../lib/channels');

  const orf1 = ch.findChannel('orf eins');
  assert(orf1, 'finds ORF 1 by synonym');
  assert(orf1.source === 'fritzbox', 'ORF 1 is FRITZ!Box source');

  const zdf = ch.findChannel('zdf');
  assert(zdf, 'finds ZDF');
  assert(zdf.constructor.name === 'ChannelWithFallback', 'ZDF is wrapped (has fallback)');
  assert(zdf.primary.source === 'fritzbox', 'primary is fritzbox');
  assert(zdf.fallback.source === 'hls', 'fallback is hls');

  const grouped = ch.listChannels();
  const totalCount = Object.values(grouped).flat().length;
  assert(totalCount >= 26, `at least 26 channels (got ${totalCount})`);
}

(async () => {
  console.log('\n--- findChannel ---');
  const zdf = channels.findChannel('zdf');
  assert(zdf, 'finds ZDF by synonym "zdf"');
  assert(zdf.id === 'ZDF_HD', 'returns ZDF_HD');
  assert(typeof zdf.resolveStream === 'function', 'has resolveStream()');
  assert(zdf.logo, 'has logo URL');
  assert(typeof zdf.url === 'string' && zdf.url.startsWith('http'), 'has upstream url (backwards-compat for hlsProxy)');
  assert(zdf.name === 'ZDF HD', 'name getter returns displayName (legacy contract)');

  console.log('\n--- listChannels ---');
  const groups = channels.listChannels();
  assert(Object.keys(groups).length > 0, 'returns at least one group');
  const allChannels = Object.values(groups).flat();
  assert(allChannels.length >= 9, `>= 9 channels (got ${allChannels.length})`);

  console.log('\n--- findChannelById ---');
  const phx = channels.findChannelById('Phoenix_HD');
  assert(phx && phx.id === 'Phoenix_HD', 'finds Phoenix_HD by id');

  await testFritzboxMerge();

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
