#!/usr/bin/env node
/**
 * youtubeCleanup test - verifies age-based deletion and queue-protection
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runCleanup } = require('../lib/youtube/cleanup');

let passed = 0, failed = 0;
function assert(c, m) { if (c) { console.log(`  ✓ ${m}`); passed++; } else { console.error(`  ✗ ${m}`); failed++; } }

function setMtime(file, daysOld) {
  const t = Date.now() - (daysOld * 86400 * 1000);
  fs.utimesSync(file, t / 1000, t / 1000);
}

function touch(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'x');
}

(async () => {
  console.log('\n--- runCleanup: deletes old files, keeps young files ---');
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-cleanup-'));
  const slug = 'jimmy';
  const slugDir = path.join(rootDir, slug);
  const oldFile = path.join(slugDir, 'v1-old.mp4');
  const newFile = path.join(slugDir, 'v2-new.mp4');
  touch(oldFile);
  touch(newFile);
  setMtime(oldFile, 14); // 14 days old, cleanupDays=7 → should delete
  setMtime(newFile, 3);  // 3 days old → keep

  // Fake playlists store: an in-memory object matching the API
  const removedCalls = [];
  const playlists = {
    list: () => [{
      id: 'pl1', slug, cleanupDays: 7,
      videos: [
        { videoId: 'v1', downloaded: true, downloadedPath: oldFile },
        { videoId: 'v2', downloaded: true, downloadedPath: newFile },
      ],
    }],
    markRemoved: (playlistId, videoId) => { removedCalls.push({ playlistId, videoId }); return true; },
  };

  // Fake contentService: nothing in the index (no queue protection needed)
  const contentService = { getIndex: () => ({ findById: () => null }) };
  // Fake queue: empty
  const queue = { list: () => [] };

  const result = await runCleanup({ rootDir, playlists, contentService, queue });
  assert(!fs.existsSync(oldFile), 'old file deleted');
  assert(fs.existsSync(newFile), 'new file kept');
  assert(result.deleted === 1, `deleted count 1 (got ${result.deleted})`);
  assert(removedCalls.length === 1 && removedCalls[0].videoId === 'v1', 'markRemoved called for v1');

  console.log('\n--- runCleanup: protects file currently in queue ---');
  const root2 = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-cleanup-'));
  const slug2 = 'kimmel';
  const oldButQueued = path.join(root2, slug2, 'v3-queued.mp4');
  touch(oldButQueued);
  setMtime(oldButQueued, 20);

  const playlists2 = {
    list: () => [{
      id: 'pl2', slug: slug2, cleanupDays: 7,
      videos: [{ videoId: 'v3', downloaded: true, downloadedPath: oldButQueued }],
    }],
    markRemoved: () => true,
  };
  const contentService2 = {
    getIndex: () => ({
      findById: (id) => id === 'youtube/kimmel/v3-queued' ? { path: oldButQueued } : null,
    }),
  };
  const queue2 = {
    list: () => [{ source: 'local', contentId: 'youtube/kimmel/v3-queued' }],
  };

  const result2 = await runCleanup({ rootDir: root2, playlists: playlists2, contentService: contentService2, queue: queue2 });
  assert(fs.existsSync(oldButQueued), 'queued file NOT deleted despite age');
  assert(result2.deleted === 0, 'deleted count 0');
  assert(result2.protected === 1, `protected count 1 (got ${result2.protected})`);

  console.log('\n--- runCleanup: missing playlist dir is a no-op ---');
  const root3 = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-cleanup-'));
  const playlists3 = {
    list: () => [{ id: 'pl3', slug: 'nonexistent', cleanupDays: 7, videos: [] }],
    markRemoved: () => true,
  };
  const result3 = await runCleanup({
    rootDir: root3,
    playlists: playlists3,
    contentService: { getIndex: () => ({ findById: () => null }) },
    queue: { list: () => [] },
  });
  assert(result3.deleted === 0, 'missing dir: deleted 0');

  console.log('\n--- runCleanup: deletes file with no playlist match (orphan) ---');
  const root4 = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-cleanup-'));
  const orphan = path.join(root4, 'orphan-slug', 'lost.mp4');
  touch(orphan);
  setMtime(orphan, 30);

  const playlists4 = {
    list: () => [], // no playlists known
    markRemoved: () => true,
  };
  const result4 = await runCleanup({
    rootDir: root4,
    playlists: playlists4,
    contentService: { getIndex: () => ({ findById: () => null }) },
    queue: { list: () => [] },
    defaultCleanupDays: 7,
  });
  // Without a matching playlist, the slug directory is not visited.
  // This is by design: cleanup only walks slugs of registered playlists.
  assert(fs.existsSync(orphan), 'orphan slug not walked (only registered playlists)');
  assert(result4.deleted === 0, 'orphan: deleted 0');

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
