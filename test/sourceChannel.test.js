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
  assert(ch.name === 'Foo', 'name getter returns displayName');
  assert(ch.logo === 'http://x/foo.png', 'logo getter returns logoUrl');
  let threw = false;
  try { await ch.resolveStream(); } catch (e) { threw = true; }
  assert(threw, 'base resolveStream() throws (must be subclassed)');
}

async function testFallbackPrimarySucceeds() {
  console.log('\n--- Fallback: primary succeeds ---');
  const primary = new Channel({ id: 'p', displayName: 'Primary', synonyms: ['psyn'], logoUrl: 'http://x/p.png', group: 'gp', source: 's' });
  primary.resolveStream = async () => ({ url: 'PRIMARY', mimeType: 'm', isLive: true });
  const fallback = new Channel({ id: 'f', displayName: 'Fallback', synonyms: ['fsyn'], logoUrl: 'http://x/f.png', group: 'gf', source: 's' });
  fallback.resolveStream = async () => ({ url: 'FALLBACK', mimeType: 'm', isLive: true });
  const ch = new ChannelWithFallback(primary, fallback);

  // Identity inherits from primary, not fallback
  assert(ch.id === 'p', 'wrapped id inherits from primary');
  assert(ch.displayName === 'Primary', 'wrapped displayName inherits from primary');
  assert(ch.synonyms[0] === 'psyn', 'wrapped synonyms inherit from primary');
  assert(ch.logoUrl === 'http://x/p.png', 'wrapped logoUrl inherits from primary');
  assert(ch.group === 'gp', 'wrapped group inherits from primary');

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

async function testHlsSource() {
  console.log('\n--- HlsSource ---');
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-1234567890abcdef1234567890abcdef';
  process.env.BASE_URL = 'http://localhost:3000';
  const { HlsSource } = require('../lib/sources/hlsSource');

  const ch = new HlsSource({
    id: 'Test_HD',
    displayName: 'Test HD',
    upstreamUrl: 'https://example.com/master.m3u8',
    logoUrl: 'http://x/t.png',
    group: 'Test',
  });
  assert(ch.id === 'Test_HD', 'id stored');
  assert(ch.source === 'hls', 'source is hls');

  // Mock the availability check via dependency injection
  ch._checkAvailable = async () => ({ available: true, status: 200 });
  const stream = await ch.resolveStream();
  assert(stream.url.includes('/proxy/live/Test_HD/master.m3u8'), 'URL uses proxy route');
  assert(stream.url.includes('token='), 'URL includes token');
  assert(stream.mimeType === 'application/vnd.apple.mpegurl', 'mimeType correct');
  assert(stream.isLive === true, 'isLive true');

  ch._checkAvailable = async () => ({ available: false, status: 403 });
  let err;
  try { await ch.resolveStream(); } catch (e) { err = e; }
  assert(err && err.message.toLowerCase().includes('geo'), 'geo-block error on 403');

  ch._checkAvailable = async () => ({ available: false, status: 502 });
  try { await ch.resolveStream(); } catch (e) { err = e; }
  assert(err && err.message.toLowerCase().includes('nicht erreichbar'), 'generic error on 5xx');
}

(async () => {
  await testChannelBase();
  await testFallbackPrimarySucceeds();
  await testFallbackPrimaryFails();
  await testFallbackBothFail();
  await testHlsSource();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
