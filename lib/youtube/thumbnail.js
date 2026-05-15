/**
 * Map a downloaded YouTube file (or its content-index entry) back to the
 * source videoId, so the launch screen / queue can show the original
 * YouTube thumbnail (i.ytimg.com) instead of a generic fallback.
 *
 * Two lookup paths:
 *  - by absolute file path: walk the persistent playlist DB and find a
 *    video record whose downloadedPath matches.
 *  - by basename: yt-dlp writes files as "<videoId>-<title-truncated>.mp4"
 *    via our OUTPUT_TEMPLATE in lib/youtube/downloader.js, so the videoId
 *    is the prefix before the first dash. Used as a fallback when the
 *    persistent playlist DB doesn't know the file (e.g. cleaned up,
 *    user-supplied, etc.).
 */

const path = require('path');

// YouTube videoIds are exactly 11 chars of [A-Za-z0-9_-]. We allow a small
// range (10-12) for robustness but require the WHOLE id to be followed by
// a dash and then the title, which excludes filenames that just happen to
// have dashes early on (e.g. 'not-a-youtube-file.mp4').
const YT_ID_RE = /^([A-Za-z0-9_-]{11})-[^-]/;

/**
 * Extract the YouTube videoId from a downloaded file path. Returns null
 * if the path doesn't look like a yt-dlp output.
 */
function videoIdFromFilename(filePath) {
  if (!filePath) return null;
  const base = path.basename(filePath);
  const m = base.match(YT_ID_RE);
  return m ? m[1] : null;
}

/**
 * Resolve videoId via the playlist persistence (preferred — authoritative).
 * Falls back to filename parsing if not found.
 *
 * @param {string} filePath - absolute path to the .mp4
 * @param {object} [opts]
 * @param {object} [opts.playlists] - playlists store (defaults to singleton)
 */
function videoIdFromEntry(filePath, opts = {}) {
  if (!filePath) return null;
  const playlistsMod = opts.playlists || require('./playlists').getInstance();
  for (const pl of playlistsMod.list()) {
    for (const v of pl.videos || []) {
      if (v.downloadedPath === filePath) return v.videoId;
    }
  }
  // Fallback: parse from filename
  return videoIdFromFilename(filePath);
}

/**
 * Build the i.ytimg.com thumbnail URL. Uses hqdefault (480x360) which is
 * always available for any YouTube video. mqdefault (320x180) is smaller
 * but a bit too small for Echo Show MediaCards (260x135dp = ~520x270px
 * displayed area).
 */
function thumbnailUrl(videoId) {
  if (!videoId) return null;
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

module.exports = { videoIdFromFilename, videoIdFromEntry, thumbnailUrl };
