#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');
const { decidePipeline, CodecProbe } = require('../lib/fritzbox/codecProbe');

let passed = 0, failed = 0;
function assert(c, m) { if (c) { console.log(`  ✓ ${m}`); passed++; } else { console.error(`  ✗ ${m}`); failed++; } }

function testDecide() {
  console.log('\n--- decidePipeline ---');
  assert(decidePipeline({ video: 'h264', audio: 'aac' }) === 'copy', 'h264 -> copy');
  assert(decidePipeline({ video: 'h264', audio: 'ac3' }) === 'copy', 'h264+ac3 -> copy (audio re-enc anyway)');
  assert(decidePipeline({ video: 'mpeg2video', audio: 'mp2' }) === 'transcode', 'mpeg2 -> transcode');
  assert(decidePipeline({ video: 'hevc', audio: 'aac' }) === 'transcode', 'hevc (no echo show support) -> transcode');
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
  assert(a === 'copy', 'h264 source decided as copy');
  assert(probeCount === 1, 'probe called once');

  // Second call: cache hit
  const b = await cp.getPipeline('40200_1010', 'rtsp://...');
  assert(b === 'copy', 'cached value returned');
  assert(probeCount === 1, 'probe NOT called again');

  // New instance reads cache from disk
  const cp2 = new CodecProbe({ cacheFile, probeFn: fakeProbe });
  const c = await cp2.getPipeline('40200_1010', 'rtsp://...');
  assert(c === 'copy', 'persistent cache survives restart');
  assert(probeCount === 1, 'still no probe call');

  fs.unlinkSync(cacheFile);
}

async function testInvalidate() {
  console.log('\n--- CodecProbe invalidate ---');
  const cacheFile = path.join(os.tmpdir(), `codecProbe.${Date.now()}.${Math.random()}.json`);
  let count = 0;
  const fakeProbe = async () => ({ video: count++ === 0 ? 'h264' : 'mpeg2video', audio: 'aac' });
  const cp = new CodecProbe({ cacheFile, probeFn: fakeProbe });
  const a = await cp.getPipeline('TID', 'rtsp://x');
  cp.invalidate('TID');
  const b = await cp.getPipeline('TID', 'rtsp://x');
  assert(a === 'copy', 'first decision: copy');
  assert(b === 'transcode', 'after invalidate: re-probed, transcode');
  fs.unlinkSync(cacheFile);
}

(async () => {
  testDecide();
  await testCacheRoundtrip();
  await testInvalidate();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
