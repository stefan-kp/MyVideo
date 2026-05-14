#!/usr/bin/env node
/**
 * Content-service YouTube integration: verifies the synthetic YouTube
 * path-config is always present after init().
 *
 * Stubs the real scanner/streamer dependencies via module cache injection.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

let passed = 0, failed = 0;
function assert(c, m) { if (c) { console.log(`  ✓ ${m}`); passed++; } else { console.error(`  ✗ ${m}`); failed++; } }

// Stub out scanner so init() doesn't try to read the filesystem
require.cache[require.resolve('../lib/content/scanner')] = {
  exports: { scanAll: async () => ({ entries: [], summary: [] }) },
};
// Stub probe + contentSource so init() doesn't need a real streamer
require.cache[require.resolve('../lib/content/codecProbe')] = {
  exports: { probeIfNeeded: async () => null },
};
require.cache[require.resolve('../lib/content/contentSource')] = {
  exports: { init: () => {}, _setStreamerForBootstrap: () => {} },
};

const service = require('../lib/content/service');

(async () => {
  console.log('\n--- init() with no content-paths.json synthesizes YouTube-only config ---');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'svc-yt-'));
  const fakeIndexFile = path.join(tmpDir, 'idx.json');
  const fakeConfig = path.join(tmpDir, 'does-not-exist.json');
  // Use a fake streamer so init() doesn't try to spawn the fritzbox one
  const fakeStreamer = { kind: 'fake' };
  const ok = await service.init({
    configPath: fakeConfig,
    indexFile: fakeIndexFile,
    streamer: fakeStreamer,
  });
  assert(ok === true, 'init returns true even without content-paths.json');
  assert(service.isEnabled(), 'service is enabled');
  const cfg = service.getConfig();
  assert(cfg && Array.isArray(cfg.paths), 'has paths array');
  assert(cfg.paths.length === 1, `1 path (got ${cfg.paths.length})`);
  assert(cfg.paths[0].label === 'YouTube', `first path is YouTube (got ${cfg.paths[0].label})`);
  assert(cfg.paths[0].path.endsWith(path.join('data', 'youtube')), 'YouTube path points to data/youtube');
  service.shutdown();

  console.log('\n--- init() with existing config prepends YouTube path ---');
  const tmpDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'svc-yt-'));
  const configPath = path.join(tmpDir2, 'paths.json');
  fs.writeFileSync(configPath, JSON.stringify({
    paths: [{ label: 'Filme', path: '/mnt/nas/filme' }],
  }));
  // Need to reset the singleton state - service is module-level globals
  // and init() overwrites them, so this should be fine.
  const ok2 = await service.init({
    configPath,
    indexFile: path.join(tmpDir2, 'idx.json'),
    streamer: fakeStreamer,
  });
  assert(ok2 === true, 'init returns true');
  const cfg2 = service.getConfig();
  assert(cfg2.paths.length === 2, `2 paths (got ${cfg2.paths.length})`);
  assert(cfg2.paths[0].label === 'YouTube', 'YouTube prepended');
  assert(cfg2.paths[1].label === 'Filme', 'user path still there');
  service.shutdown();

  console.log('\n--- init() does not duplicate YouTube path if already configured ---');
  const tmpDir3 = fs.mkdtempSync(path.join(os.tmpdir(), 'svc-yt-'));
  const configPath3 = path.join(tmpDir3, 'paths.json');
  // Mimic data/youtube path resolution (use the same value the service uses)
  const ytAbs = service.YOUTUBE_DIR;
  fs.writeFileSync(configPath3, JSON.stringify({
    paths: [{ label: 'YouTubeUser', path: ytAbs }],
  }));
  const ok3 = await service.init({
    configPath: configPath3,
    indexFile: path.join(tmpDir3, 'idx.json'),
    streamer: fakeStreamer,
  });
  assert(ok3 === true, 'init returns true');
  const cfg3 = service.getConfig();
  assert(cfg3.paths.length === 1, `still 1 path (got ${cfg3.paths.length})`);
  service.shutdown();

  // Cleanup
  for (const d of [tmpDir, tmpDir2, tmpDir3]) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {}
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
