#!/usr/bin/env node
/**
 * Manual integration test against a real FRITZ!Box.
 * Requires FRITZBOX_HOST/USER/PASSWORD in .env or environment.
 *
 * Usage: node scripts/test-fritzbox.js <channelId>
 * Example: node scripts/test-fritzbox.js orf1
 */
require('dotenv').config();

const channels = require('../lib/channels');

async function main() {
  const channelId = process.argv[2];
  if (!channelId) {
    console.error('Usage: node scripts/test-fritzbox.js <channelId>');
    console.error('Available IDs:');
    for (const [group, list] of Object.entries(channels.listChannels())) {
      console.error(`  [${group}]`, list.map(c => c.id).join(', '));
    }
    process.exit(1);
  }

  const ch = channels.findChannelById(channelId);
  if (!ch) {
    console.error(`Channel not found: ${channelId}`);
    process.exit(1);
  }

  console.log(`Resolving stream for ${ch.displayName} (source=${ch.source || (ch.primary?.source + '+fallback')}) ...`);
  const t0 = Date.now();
  const stream = await ch.resolveStream();
  const dt = Date.now() - t0;
  console.log(`OK in ${dt}ms`);
  console.log(`  URL: ${stream.url}`);
  console.log(`  MIME: ${stream.mimeType}`);

  // For FRITZ!Box sources, wait 10 seconds, then stop
  if (ch.source === 'fritzbox' || ch.primary?.source === 'fritzbox') {
    console.log('Streaming for 10 seconds...');
    await new Promise(r => setTimeout(r, 10000));
    const fritzboxSource = require('../lib/sources/fritzboxSource');
    await fritzboxSource.shutdown();
    console.log('Stopped.');
  }
}

main().catch(err => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
