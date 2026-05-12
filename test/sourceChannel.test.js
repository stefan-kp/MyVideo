#!/usr/bin/env node
/**
 * Channel + ChannelWithFallback Test
 * Run: node test/sourceChannel.test.js
 */
const { Channel, ChannelWithFallback } = require('../lib/sources/Channel');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) { console.log(`  ✓ ${message}`); passed++; }
  else { console.error(`  ✗ ${message}`); failed++; }
}

async function testChannelBase() {
  console.log('\n--- Channel base ---');
  const ch = new Channel({
    id: 'foo', displayName: 'Foo', synonyms: ['foo'],
    logoUrl: 'http://x/foo.png', group: 'Test', source: 'test'
  });
  assert(ch.id === 'foo', 'id stored');
  assert(ch.displayName === 'Foo', 'displayName stored');
  assert(ch.source === 'test', 'source stored');
  let threw = false;
  try { await ch.resolveStream(); } catch (e) { threw = true; }
  assert(threw, 'base resolveStream() throws (must be subclassed)');
}

async function testFallbackPrimarySucceeds() {
  console.log('\n--- Fallback: primary succeeds ---');
  const primary = new Channel({ id: 'p', displayName: 'P', synonyms: [], logoUrl: '', group: 'g', source: 's' });
  primary.resolveStream = async () => ({ url: 'PRIMARY', mimeType: 'm', isLive: true });
  const fallback = new Channel({ id: 'f', displayName: 'F', synonyms: [], logoUrl: '', group: 'g', source: 's' });
  fallback.resolveStream = async () => ({ url: 'FALLBACK', mimeType: 'm', isLive: true });
  const ch = new ChannelWithFallback(primary, fallback);
  const out = await ch.resolveStream();
  assert(out.url === 'PRIMARY', 'primary URL returned');
}

async function testFallbackPrimaryFails() {
  console.log('\n--- Fallback: primary fails, fallback succeeds ---');
  const primary = new Channel({ id: 'p', displayName: 'P', synonyms: [], logoUrl: '', group: 'g', source: 's' });
  primary.resolveStream = async () => { throw new Error('primary down'); };
  const fallback = new Channel({ id: 'f', displayName: 'F', synonyms: [], logoUrl: '', group: 'g', source: 's' });
  fallback.resolveStream = async () => ({ url: 'FALLBACK', mimeType: 'm', isLive: true });
  const ch = new ChannelWithFallback(primary, fallback);
  const out = await ch.resolveStream();
  assert(out.url === 'FALLBACK', 'fallback URL returned');
}

async function testFallbackBothFail() {
  console.log('\n--- Fallback: both fail ---');
  const primary = new Channel({ id: 'p', displayName: 'P', synonyms: [], logoUrl: '', group: 'g', source: 's' });
  primary.resolveStream = async () => { throw new Error('primary down'); };
  const fallback = new Channel({ id: 'f', displayName: 'F', synonyms: [], logoUrl: '', group: 'g', source: 's' });
  fallback.resolveStream = async () => { throw new Error('fallback down'); };
  const ch = new ChannelWithFallback(primary, fallback);
  let err;
  try { await ch.resolveStream(); } catch (e) { err = e; }
  assert(err && err.message.includes('primary down'), 'primary error propagated when both fail');
}

(async () => {
  await testChannelBase();
  await testFallbackPrimarySucceeds();
  await testFallbackPrimaryFails();
  await testFallbackBothFail();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
