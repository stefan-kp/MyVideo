const fs = require('fs');
const path = require('path');

const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h
const DEFAULT_CLEANUP_DAYS = 7;

/**
 * Walk each registered playlist's directory and delete .mp4 files whose
 * mtime is older than the playlist's `cleanupDays`, unless that file is
 * currently referenced by an item in the queue.
 *
 * For each deleted file, calls `playlists.markRemoved(playlistId, videoId)`
 * so the cached `videos[].downloaded` flag is reset.
 *
 * @param {object} deps
 * @param {string} deps.rootDir            - parent dir of <slug> subdirs (e.g. data/youtube)
 * @param {object} deps.playlists          - Playlists store (list(), markRemoved())
 * @param {object} deps.contentService     - { getIndex(): { findById(id): entry|null } }
 * @param {object} deps.queue              - { list(): [{ contentId, source, ... }] }
 * @param {number} [deps.defaultCleanupDays]
 * @returns {Promise<{ deleted: number, protected: number, errors: string[] }>}
 */
async function runCleanup({ rootDir, playlists, contentService, queue, defaultCleanupDays = DEFAULT_CLEANUP_DAYS }) {
  const errors = [];
  let deleted = 0;
  let protectedCount = 0;

  // Build the set of absolute paths that are currently in the queue, so
  // we never delete a file the user is about to watch.
  const protectedPaths = new Set();
  try {
    const idx = contentService && contentService.getIndex && contentService.getIndex();
    const items = (queue && queue.list && queue.list()) || [];
    for (const it of items) {
      if (it.source !== 'local' || !it.contentId) continue;
      const entry = idx && idx.findById ? idx.findById(it.contentId) : null;
      if (entry && entry.path) protectedPaths.add(entry.path);
    }
  } catch (err) {
    errors.push(`queue-scan: ${err.message}`);
  }

  const now = Date.now();
  const playlistList = (playlists && playlists.list && playlists.list()) || [];

  for (const pl of playlistList) {
    const slug = pl.slug;
    const cleanupDays = Number(pl.cleanupDays) || defaultCleanupDays;
    const maxAgeMs = cleanupDays * 86400 * 1000;
    const slugDir = path.join(rootDir, slug);

    let entries;
    try { entries = fs.readdirSync(slugDir, { withFileTypes: true }); }
    catch (err) { continue; /* dir missing → nothing to clean */ }

    for (const d of entries) {
      if (!d.isFile()) continue;
      const full = path.join(slugDir, d.name);
      let stat;
      try { stat = fs.statSync(full); } catch { continue; }
      const ageMs = now - stat.mtimeMs;
      if (ageMs < maxAgeMs) continue;

      if (protectedPaths.has(full)) {
        protectedCount++;
        continue;
      }

      try {
        fs.unlinkSync(full);
        deleted++;
        // Find the videoId that pointed at this file and clear download flags.
        const video = (pl.videos || []).find(v => v.downloadedPath === full);
        if (video && playlists.markRemoved) {
          try { playlists.markRemoved(pl.id, video.videoId); }
          catch (err) { errors.push(`markRemoved(${pl.id},${video.videoId}): ${err.message}`); }
        }
      } catch (err) {
        errors.push(`unlink ${full}: ${err.message}`);
      }
    }
  }

  return { deleted, protected: protectedCount, errors };
}

/**
 * Schedule a periodic cleanup using setInterval. Returns the interval handle
 * so the caller can `clearInterval()` on shutdown. The first run happens
 * immediately (one event-loop tick later) so missing-data races are surfaced
 * without waiting 6 hours.
 */
function scheduleCleanup(deps, intervalMs = DEFAULT_INTERVAL_MS) {
  const tick = () => {
    runCleanup(deps).then(r => {
      if (r.deleted || r.errors.length) {
        console.log(`[youtube] cleanup: deleted=${r.deleted} protected=${r.protected} errors=${r.errors.length}`);
        for (const e of r.errors) console.warn(`[youtube] cleanup error: ${e}`);
      }
    }).catch(err => console.warn(`[youtube] cleanup failed: ${err.message}`));
  };
  // First run after a short delay so the rest of init finishes.
  const startTimer = setTimeout(tick, 30 * 1000);
  const interval = setInterval(tick, intervalMs);
  return {
    stop() { clearTimeout(startTimer); clearInterval(interval); },
  };
}

module.exports = { runCleanup, scheduleCleanup, DEFAULT_INTERVAL_MS, DEFAULT_CLEANUP_DAYS };
