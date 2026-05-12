#!/usr/bin/env node
/**
 * FritzboxStreamer test - mocks spawn() and filesystem events
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { EventEmitter } = require('events');
const { Streamer } = require('../lib/fritzbox/streamer');

let passed = 0, failed = 0;
function assert(c, m) { if (c) { console.log(`  ✓ ${m}`); passed++; } else { console.error(`  ✗ ${m}`); failed++; } }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function makeFakeProc() {
  const proc = new EventEmitter();
  proc.killed = false;
  proc.kill = (sig) => { proc.killed = sig; setTimeout(() => proc.emit('exit', 0, sig), 5); };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  return proc;
}

async function testStartTransitionsToPlaying() {
  console.log('\n--- start() -> PLAYING when segment appears ---');
  const streamDir = fs.mkdtempSync(path.join(os.tmpdir(), 'streamertest-'));
  let spawned = null;
  const s = new Streamer({
    streamDir,
    spawnFn: (cmd, args) => { spawned = { cmd, args }; return makeFakeProc(); },
    waitForSegmentFn: async () => { await sleep(5); return true; },
    resolveRtsp: async (tunerId) => `rtsp://fake/${tunerId}`,
    getPipeline: async () => 'copy',
  });

  const channel = { id: 'orf1', tunerId: '40200_1010', displayName: 'ORF 1' };
  const url = await s.start(channel);
  assert(spawned.cmd === 'ffmpeg', 'ffmpeg spawned');
  assert(spawned.args.includes('rtsp://fake/40200_1010'), 'rtsp URL passed');
  assert(spawned.args.includes('-c:v') && spawned.args.includes('copy'), 'copy codec path used');
  assert(url.endsWith('/stream/fritzbox/index.m3u8'), 'returns HLS URL path');
  assert(s.getCurrent()?.channelId === 'orf1', 'state reflects PLAYING(orf1)');

  await s.stop();
  fs.rmSync(streamDir, { recursive: true, force: true });
}

async function testSwitchChannelTerminatesPrevious() {
  console.log('\n--- start(B) while PLAYING(A) terminates A ---');
  const streamDir = fs.mkdtempSync(path.join(os.tmpdir(), 'streamertest-'));
  const procs = [];
  const s = new Streamer({
    streamDir,
    spawnFn: () => { const p = makeFakeProc(); procs.push(p); return p; },
    waitForSegmentFn: async () => { await sleep(5); return true; },
    resolveRtsp: async (t) => `rtsp://fake/${t}`,
    getPipeline: async () => 'copy',
  });

  await s.start({ id: 'a', tunerId: 't1', displayName: 'A' });
  await s.start({ id: 'b', tunerId: 't2', displayName: 'B' });

  assert(procs.length === 2, 'two ffmpeg processes spawned');
  assert(procs[0].killed === 'SIGTERM', 'first process received SIGTERM');
  assert(s.getCurrent()?.channelId === 'b', 'current is B');

  await s.stop();
  fs.rmSync(streamDir, { recursive: true, force: true });
}

async function testStartSameChannelNoOp() {
  console.log('\n--- start(A) while PLAYING(A) is no-op ---');
  const streamDir = fs.mkdtempSync(path.join(os.tmpdir(), 'streamertest-'));
  const procs = [];
  const s = new Streamer({
    streamDir,
    spawnFn: () => { const p = makeFakeProc(); procs.push(p); return p; },
    waitForSegmentFn: async () => { await sleep(5); return true; },
    resolveRtsp: async (t) => `rtsp://fake/${t}`,
    getPipeline: async () => 'copy',
  });

  await s.start({ id: 'a', tunerId: 't1', displayName: 'A' });
  await s.start({ id: 'a', tunerId: 't1', displayName: 'A' });

  assert(procs.length === 1, 'only one ffmpeg process spawned');

  await s.stop();
  fs.rmSync(streamDir, { recursive: true, force: true });
}

async function testWaitTimeoutFails() {
  console.log('\n--- start() rejects when segment never appears ---');
  const streamDir = fs.mkdtempSync(path.join(os.tmpdir(), 'streamertest-'));
  const s = new Streamer({
    streamDir,
    spawnFn: () => makeFakeProc(),
    waitForSegmentFn: async () => false,  // timeout
    resolveRtsp: async (t) => `rtsp://fake/${t}`,
    getPipeline: async () => 'copy',
  });

  let err;
  try { await s.start({ id: 'x', tunerId: 'tx', displayName: 'X' }); } catch (e) { err = e; }
  assert(err && /no segment/i.test(err.message), 'rejects with no-segment error');
  assert(s.getCurrent() === null, 'state back to IDLE');
  fs.rmSync(streamDir, { recursive: true, force: true });
}

async function testTranscodePipelineArgs() {
  console.log('\n--- transcode pipeline uses libx264 ---');
  const streamDir = fs.mkdtempSync(path.join(os.tmpdir(), 'streamertest-'));
  let spawned = null;
  const s = new Streamer({
    streamDir,
    spawnFn: (cmd, args) => { spawned = args; return makeFakeProc(); },
    waitForSegmentFn: async () => true,
    resolveRtsp: async () => 'rtsp://x',
    getPipeline: async () => 'transcode',
  });

  await s.start({ id: 'q', tunerId: 'tq', displayName: 'Q' });
  assert(spawned.includes('libx264'), 'libx264 in args');
  assert(spawned.includes('-vf'), '-vf scale arg present');

  await s.stop();
  fs.rmSync(streamDir, { recursive: true, force: true });
}

(async () => {
  await testStartTransitionsToPlaying();
  await testSwitchChannelTerminatesPrevious();
  await testStartSameChannelNoOp();
  await testWaitTimeoutFails();
  await testTranscodePipelineArgs();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
