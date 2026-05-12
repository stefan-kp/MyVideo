#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');
const { decidePipeline, CodecProbe } = require('../lib/fritzbox/codecProbe');

let passed = 0, failed = 0;
function assert(c, m) { if (c) { console.log(`  ✓ ${m}`); passed++; } else { console.error(`  ✗ ${m}`); failed++; } }

function testDecide() {
  console.log('\n--- decidePipeline ---');
  // Default: transcode for everything (UDP/SAT-IP is too lossy for stream-copy)
  const savedEnv = process.env.FRITZBOX_PIPELINE;
  delete process.env.FRITZBOX_PIPELINE;

  assert(decidePipeline({ video: 'h264', audio: 'aac' }) === 'transcode', 'h264 default -> transcode (robustness)');
  assert(decidePipeline({ video: 'h264', audio: 'ac3' }) === 'transcode', 'h264+ac3 default -> transcode');
  assert(decidePipeline({ video: 'mpeg2video', audio: 'mp2' }) === 'transcode', 'mpeg2 -> transcode');
  assert(decidePipeline({ video: 'hevc', audio: 'aac' }) === 'transcode', 'hevc -> transcode');

  // Opt-in copy mode for stable wired LAN with H.264 sources
  process.env.FRITZBOX_PIPELINE = 'copy';
  assert(decidePipeline({ video: 'h264', audio: 'aac' }) === 'copy', 'FRITZBOX_PIPELINE=copy + h264 -> copy');
  assert(decidePipeline({ video: 'mpeg2video', audio: 'mp2' }) === 'transcode', 'FRITZBOX_PIPELINE=copy + mpeg2 still transcode');

  // Restore env
  if (savedEnv === undefined) delete process.env.FRITZBOX_PIPELINE;
  else process.env.FRITZBOX_PIPELINE = savedEnv;
}

async function testCacheRoundtrip() {
  console.log('\n--- CodecProbe cache roundtrip ---');
  const cacheFile = path.join(os.tmpdir(), `codecProbe.${Date.now()}.json`);
  let probeCount = 0;
  const fakeProbe = async (rtspUrl) => {
    probeCount++;
    return { video: 'h264', audio: 'ac3' };
  };
  const cp = new CodecProbe({ cacheFile, probeFn: fakeProbe });
  const a = await cp.getPipeline('40200_1010', 'rtsp://...');
  assert(a === 'transcode', 'h264 source decided as transcode (default)');
  assert(probeCount === 1, 'probe called once');

  // Second call: cache hit
  const b = await cp.getPipeline('40200_1010', 'rtsp://...');
  assert(b === 'transcode', 'cached value returned');
  assert(probeCount === 1, 'probe NOT called again');

  // New instance reads cache from disk
  const cp2 = new CodecProbe({ cacheFile, probeFn: fakeProbe });
  const c = await cp2.getPipeline('40200_1010', 'rtsp://...');
  assert(c === 'transcode', 'persistent cache survives restart');
  assert(probeCount === 1, 'still no probe call');

  fs.unlinkSync(cacheFile);
}

async function testInvalidate() {
  console.log('\n--- CodecProbe invalidate ---');
  const cacheFile = path.join(os.tmpdir(), `codecProbe.${Date.now()}.${Math.random()}.json`);
  let count = 0;
  // Both probes return codecs whose default decision is 'transcode' now.
  // To verify invalidate forces a re-probe, return different audio codecs and check
  // that the cached value (which would otherwise be reused) actually changed.
  const fakeProbe = async () => ({ video: 'h264', audio: count++ === 0 ? 'ac3' : 'aac' });
  const cp = new CodecProbe({ cacheFile, probeFn: fakeProbe });
  await cp.getPipeline('TID', 'rtsp://x');
  const firstAudio = cp.cache['TID'].audio;
  cp.invalidate('TID');
  await cp.getPipeline('TID', 'rtsp://x');
  const secondAudio = cp.cache['TID'].audio;
  assert(firstAudio === 'ac3', 'first probe: audio ac3');
  assert(secondAudio === 'aac', 'after invalidate: re-probed, audio aac');
  assert(count === 2, 'probe called twice (first + after invalidate)');
  fs.unlinkSync(cacheFile);
}

(async () => {
  testDecide();
  await testCacheRoundtrip();
  await testInvalidate();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
