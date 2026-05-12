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

  // Identity asserts (no resolveStream call needed)
  const idCh = new HlsSource({
    id: 'Test_HD',
    displayName: 'Test HD',
    upstreamUrl: 'https://example.com/master.m3u8',
    logoUrl: 'http://x/t.png',
    group: 'Test',
  });
  assert(idCh.id === 'Test_HD', 'id stored');
  assert(idCh.source === 'hls', 'source is hls');

  // Success path - inject a checkAvailable that returns available=true
  const okCh = new HlsSource({
    id: 'Test_HD',
    displayName: 'Test HD',
    upstreamUrl: 'https://example.com/master.m3u8',
    logoUrl: 'http://x/t.png',
    group: 'Test',
    checkAvailable: async () => ({ available: true, status: 200 }),
  });
  const stream = await okCh.resolveStream();
  assert(stream.url.includes('/proxy/live/Test_HD/master.m3u8'), 'URL uses proxy route');
  assert(stream.url.includes('token='), 'URL includes token');
  assert(stream.mimeType === 'application/vnd.apple.mpegurl', 'mimeType correct');
  assert(stream.isLive === true, 'isLive true');

  // 403 - geo-block
  const geoCh = new HlsSource({
    id: 'Test_HD', displayName: 'Test HD', upstreamUrl: 'x', logoUrl: '', group: 'g',
    checkAvailable: async () => ({ available: false, status: 403 }),
  });
  let err;
  try { await geoCh.resolveStream(); } catch (e) { err = e; }
  assert(err && err.message.toLowerCase().includes('geo'), 'geo-block error on 403');

  // 5xx - generic unreachable
  const downCh = new HlsSource({
    id: 'Test_HD', displayName: 'Test HD', upstreamUrl: 'x', logoUrl: '', group: 'g',
    checkAvailable: async () => ({ available: false, status: 502 }),
  });
  try { await downCh.resolveStream(); } catch (e) { err = e; }
  assert(err && err.message.toLowerCase().includes('nicht erreichbar'), 'generic error on 5xx');
}

async function testFritzboxSource() {
  console.log('\n--- FritzboxSource ---');
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-1234567890abcdef1234567890abcdef';
  process.env.BASE_URL = 'http://localhost:3000';

  const fritzboxSource = require('../lib/sources/fritzboxSource');
  const fakeStreamer = {
    async start(ch) { this.lastStart = ch; return '/stream/fritzbox/index.m3u8'; },
  };
  fritzboxSource._setStreamerForTest(fakeStreamer);

  const ch = new (fritzboxSource.FritzboxSource)({
    id: 'orf1', displayName: 'ORF 1', synonyms: [],
    tunerId: '40200_1010', logoUrl: '', group: 'ORF',
  });
  const out = await ch.resolveStream();
  assert(out.url.includes('/stream/fritzbox/index.m3u8'), 'returns fritzbox HLS path');
  assert(out.url.includes('token='), 'URL has token');
  assert(fakeStreamer.lastStart.id === 'orf1', 'streamer.start called with channel');

  fritzboxSource._resetForTest();
}

(async () => {
  await testChannelBase();
  await testFallbackPrimarySucceeds();
  await testFallbackPrimaryFails();
  await testFallbackBothFail();
  await testHlsSource();
  await testFritzboxSource();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
