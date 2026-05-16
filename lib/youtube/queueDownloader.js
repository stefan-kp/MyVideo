const path = require('path');
const { downloadVideo } = require('./downloader');
const { extractPlaylistId } = require('./playlists');

/**
 * Async helper used by /diag/queue/youtube and the MCP tool
 * 'add_youtube_to_queue'. Caller adds a queue item with source
 * 'youtube_pending' + status 'downloading', then fires this off
 * without awaiting. When yt-dlp finishes we patch the item in-place:
 *   - on success → source='local', contentId='youtube/_inbox/<id>',
 *     status='ready', imageUrl set to the ytimg thumbnail
 *   - on error   → status='failed', error=<message>
 *
 * The downloads land in data/youtube/_inbox/ (a synthetic playlist
 * slug we never crawl) so the existing content scanner picks them up
 * via lib/content/service.js and the existing single-video playback
 * path works unchanged.
 *
 * @param {object} deps
 * @param {object} deps.queue    - Queue.getInstance() result
 * @param {object} deps.contentService - lib/content/service.js
 * @param {string} deps.youtubeDir   - absolute path to data/youtube
 * @param {function} [deps.downloadFn] - overridable for tests; defaults to downloadVideo
 */
function makeDownloadAndAttach({ queue, contentService, youtubeDir, downloadFn = downloadVideo }) {
  return async function downloadAndAttach(queueItemId, youtubeUrl) {
    const playlistId = extractPlaylistId(youtubeUrl);
    if (!playlistId) {
      // not really a playlist — extractPlaylistId also handles bare video IDs
      // and `?list=...` so we use it as a quick sanity check that the URL is
      // youtube-flavoured. For single videos we want the videoId via
      // ?v=, /watch?v=, youtu.be/<id> — extractVideoId handles that.
    }
    const videoId = extractVideoId(youtubeUrl);
    if (!videoId) {
      queue.update(queueItemId, {
        status: 'failed',
        error: `Konnte keine YouTube-Video-ID aus URL extrahieren: ${youtubeUrl}`,
      });
      return;
    }

    const outDir = path.join(youtubeDir, '_inbox');
    let filePath;
    try {
      filePath = await downloadFn({ videoId, outDir });
    } catch (err) {
      console.error(`[queue-yt] download failed for ${videoId}:`, err.message);
      queue.update(queueItemId, {
        status: 'failed',
        error: `Download fehlgeschlagen: ${err.message}`,
      });
      return;
    }

    // Trigger a content rescan so the new MP4 lands in the index, then
    // resolve the contentId by file path. rescan() has been refactored
    // to guarantee fresh data when awaited.
    let contentId = null;
    if (contentService && contentService.isEnabled && contentService.isEnabled()) {
      try {
        await contentService.rescan();
        const entry = contentService.getIndex().all().find(e => e.path === filePath);
        if (entry) contentId = entry.id;
      } catch (err) {
        console.warn(`[queue-yt] rescan failed: ${err.message}`);
      }
    }

    if (!contentId) {
      // Reindex didn't pick it up — still mark as failed because we can't
      // actually play it without a contentId.
      queue.update(queueItemId, {
        status: 'failed',
        error: `Datei heruntergeladen aber Content-Index hat sie nicht gefunden: ${filePath}`,
      });
      return;
    }

    queue.update(queueItemId, {
      status: 'ready',
      source: 'local',
      contentId,
      imageUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    });
    console.log(`[queue-yt] ready: ${videoId} → contentId=${contentId}`);
  };
}

/**
 * Extract a YouTube video ID from any URL form, or return the input if it
 * already looks like a bare 11-char video ID.
 */
function extractVideoId(input) {
  if (!input || typeof input !== 'string') return null;
  const s = input.trim();
  // Bare 11-char video id
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  // youtu.be/<id>
  let m = s.match(/youtu\.be\/([A-Za-z0-9_-]{11})/);
  if (m) return m[1];
  // youtube.com/watch?v=<id>
  m = s.match(/[?&]v=([A-Za-z0-9_-]{11})/);
  if (m) return m[1];
  // youtube.com/embed/<id>
  m = s.match(/\/embed\/([A-Za-z0-9_-]{11})/);
  if (m) return m[1];
  // youtube.com/shorts/<id>
  m = s.match(/\/shorts\/([A-Za-z0-9_-]{11})/);
  if (m) return m[1];
  return null;
}

module.exports = { makeDownloadAndAttach, extractVideoId };
