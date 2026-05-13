#!/usr/bin/env node
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-1234567890abcdef1234567890abcdef';
process.env.BASE_URL = 'http://localhost:3000';

const contentSource = require('../lib/content/contentSource');

let passed = 0, failed = 0;
function assert(c, m) { if (c) { console.log(`  ✓ ${m}`); passed++; } else { console.error(`  ✗ ${m}`); failed++; } }

(async () => {
  console.log('\n--- direct-play returns /content/<id>/file.mp4 ---');
  const entry = {
    id: 'filme/inception-2010', path: '/x/Inception.mp4', ext: '.mp4', codecInfo: null,
  };
  const index = { findById: id => id === entry.id ? entry : null };
  const fakeProbe = { probeIfNeeded: async (e) => ({ directPlay: true, video: 'h264', audio: 'aac' }) };
  const fakeStreamer = { start: async () => { throw new Error('streamer must not be called for direct-play'); } };

  contentSource._setDepsForTest({ index, probe: fakeProbe, streamer: fakeStreamer });

  const out = await contentSource.resolveStream(entry.id);
  assert(out.url.includes('/content/filme/inception-2010/file.mp4'), `URL has /content/ path (got ${out.url})`);
  assert(out.url.includes('token='), 'URL has token');
  assert(out.mimeType === 'video/mp4', 'mimeType mp4');
  assert(out.isLive === false, 'isLive false');

  console.log('\n--- transcode returns /stream/fritzbox/index.m3u8 ---');
  const entry2 = {
    id: 'serien/x/s01e01', path: '/x/show.mkv', ext: '.mkv', codecInfo: null,
    displayName: 'X', title: 'X',
  };
  const index2 = { findById: id => id === entry2.id ? entry2 : null };
  const fakeProbe2 = { probeIfNeeded: async () => ({ directPlay: false, video: 'hevc' }) };
  let started = null;
  const fakeStreamer2 = { start: async (channel) => { started = channel; } };

  contentSource._setDepsForTest({ index: index2, probe: fakeProbe2, streamer: fakeStreamer2 });
  const out2 = await contentSource.resolveStream(entry2.id);
  assert(out2.url.includes('/stream/fritzbox/index.m3u8'), 'transcode URL is the streamer playlist');
  assert(out2.mimeType === 'application/vnd.apple.mpegurl', 'mimeType m3u8');
  assert(started && started.source === 'local', 'streamer.start called with source local');
  assert(started.inputPath === entry2.path, 'inputPath passed');

  console.log('\n--- unknown id throws ---');
  contentSource._setDepsForTest({ index: { findById: () => null }, probe: fakeProbe, streamer: fakeStreamer });
  let err;
  try { await contentSource.resolveStream('missing'); } catch (e) { err = e; }
  assert(err && /unknown/.test(err.message.toLowerCase()), 'throws for unknown id');

  contentSource._resetDepsForTest();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
