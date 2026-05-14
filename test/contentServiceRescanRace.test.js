#!/usr/bin/env node
/**
 * Content-service rescan() race conditions:
 *
 * 1. Two parallel rescan() calls share the same in-flight scan (no skip).
 * 2. If a call arrives while one is in flight AND its data isn't visible
 *    yet (file appeared after scanAll() started), a follow-up scan runs.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

let passed = 0, failed = 0;
function assert(c, m) { if (c) { console.log(`  ✓ ${m}`); passed++; } else { console.error(`  ✗ ${m}`); failed++; } }

// ----- stub scanner with adjustable delay + sequence-tracking
let scanCallCount = 0;
let scanResults = []; // each: { delayMs, entries }
let scanLog = [];

function stubScanner(scenarios) {
  scanCallCount = 0;
  scanResults = scenarios;
  scanLog = [];
  require.cache[require.resolve('../lib/content/scanner')] = {
    exports: {
      scanAll: async () => {
        const callIdx = scanCallCount++;
        const { delayMs, entries } = scanResults[callIdx] || { delayMs: 10, entries: [] };
        scanLog.push({ at: 'start', callIdx, ts: Date.now() });
        await new Promise(r => setTimeout(r, delayMs));
        scanLog.push({ at: 'end', callIdx, ts: Date.now() });
        return { entries, summary: [{ label: 'Test', count: entries.length, path: '/tmp' }] };
      },
    },
  };
}

require.cache[require.resolve('../lib/content/codecProbe')] = {
  exports: { probeIfNeeded: async () => null },
};
require.cache[require.resolve('../lib/content/contentSource')] = {
  exports: { init: () => {}, _setStreamerForBootstrap: () => {} },
};

async function initService() {
  // Force a fresh require so module-level state resets between scenarios.
  delete require.cache[require.resolve('../lib/content/service')];
  delete require.cache[require.resolve('../lib/content/index')];
  const service = require('../lib/content/service');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'svc-race-'));
  await service.init({
    configPath: path.join(tmpDir, 'nope.json'),
    indexFile: path.join(tmpDir, 'idx.json'),
    streamer: { kind: 'fake' },
  });
  // Wait for the auto-startup rescan (kicked via setImmediate in init).
  await new Promise(r => setImmediate(r));
  return { service, tmpDir };
}

async function cleanup(svc, tmpDir) {
  svc.shutdown();
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
}

(async () => {
  console.log('\n--- two parallel rescan() share the same scan ---');
  stubScanner([
    { delayMs: 50, entries: [{ id: 'a', path: '/a.mp4', codecInfo: null }] },
    { delayMs: 50, entries: [{ id: 'a', path: '/a.mp4', codecInfo: null }] },
  ]);
  const { service, tmpDir } = await initService();
  // The init-time setImmediate already triggered one rescan. Let it start.
  await new Promise(r => setTimeout(r, 5));
  // Now two concurrent calls land while the startup scan is in flight.
  const [r1, r2] = await Promise.all([service.rescan(), service.rescan()]);
  // After both return, the index MUST include the entries (no skip).
  assert(service.getIndex().count() === 1, `index has 1 entry (got ${service.getIndex().count()})`);
  assert(!r1.skipped, 'r1 not skipped');
  assert(!r2.skipped, 'r2 not skipped');
  // Both callers either share the startup scan OR trigger one follow-up.
  // We accept any of: 1 scan total (everybody piggybacked) or 2 scans total
  // (startup + one follow-up that covered both). We do NOT want 3+ scans.
  assert(scanCallCount <= 2, `at most 2 scan() calls (got ${scanCallCount})`);
  await cleanup(service, tmpDir);

  console.log('\n--- rescan() awaited after init guarantees fresh data ---');
  // This is the actual user scenario: a file appears between two scans,
  // and the caller awaits rescan() expecting to see it afterwards.
  stubScanner([
    { delayMs: 50, entries: [] }, // startup scan: file not there yet
    { delayMs: 50, entries: [{ id: 'youtube/snl/v1', path: '/data/youtube/snl/v1.mp4', codecInfo: null }] },
  ]);
  const { service: svc2, tmpDir: t2 } = await initService();
  // The init-time setImmediate already triggered scan #0 (empty).
  // Wait a tick so it actually starts.
  await new Promise(r => setTimeout(r, 5));
  // "Download finishes" → caller awaits rescan(). At this point scan #0
  // is in flight, so naively returning it would NOT include the new file.
  const r = await svc2.rescan();
  // After this await, the file MUST be visible.
  const entry = svc2.getIndex().findById('youtube/snl/v1');
  assert(entry !== null, `new file visible after awaited rescan (got ${entry ? 'entry' : 'null'})`);
  assert(scanCallCount === 2, `exactly 2 scans ran (got ${scanCallCount})`);
  await cleanup(svc2, t2);

  console.log('\n--- rescan() awaited when nothing is in flight runs once ---');
  stubScanner([
    { delayMs: 10, entries: [] },
    { delayMs: 10, entries: [{ id: 'x', path: '/x.mp4', codecInfo: null }] },
  ]);
  const { service: svc3, tmpDir: t3 } = await initService();
  // Wait for startup scan to fully complete first.
  await new Promise(r => setTimeout(r, 40));
  const before = scanCallCount;
  await svc3.rescan();
  const after = scanCallCount;
  assert(after - before === 1, `exactly 1 fresh scan on idle call (got ${after - before})`);
  assert(svc3.getIndex().findById('x') !== null, 'fresh scan saw new entry');
  await cleanup(svc3, t3);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
