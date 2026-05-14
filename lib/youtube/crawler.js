const { spawn } = require('child_process');

const DEFAULT_TIMEOUT_MS = 60 * 1000;

/**
 * Crawl a YouTube playlist via `yt-dlp --flat-playlist --print-json <url>`.
 * Returns an array of `{ videoId, title, duration, uploadDate }`.
 *
 * Uses spawn (not exec) to stream stdout: large playlists can be hundreds
 * of KB of newline-delimited JSON.
 *
 * Throws on non-zero exit. Caller is expected to surface the error message
 * back to the HTTP layer.
 *
 * @param {string} playlistUrl
 * @param {object} opts
 * @param {function} [opts.spawnFn] - injectable spawn for tests
 * @param {number} [opts.timeoutMs]
 * @param {string} [opts.ytDlpPath]
 */
function crawlPlaylist(playlistUrl, opts = {}) {
  const spawnFn = opts.spawnFn || spawn;
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
  const ytDlpPath = opts.ytDlpPath || process.env.YT_DLP_PATH || 'yt-dlp';

  return new Promise((resolve, reject) => {
    const args = [
      '--flat-playlist',
      '--print-json',
      '--no-warnings',
      playlistUrl,
    ];
    const proc = spawnFn(ytDlpPath, args);
    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { proc.kill('SIGKILL'); } catch (_) { /* ignore */ }
      reject(new Error(`yt-dlp crawl timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('error', err => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`yt-dlp spawn failed: ${err.message}`));
    });
    proc.on('close', code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        const tail = stderr.trim().split('\n').slice(-3).join(' | ') || 'no stderr';
        return reject(new Error(`yt-dlp exited ${code}: ${tail}`));
      }
      try {
        resolve(parseFlatPlaylistOutput(stdout));
      } catch (err) {
        reject(err);
      }
    });
  });
}

/**
 * Parse newline-delimited JSON from `yt-dlp --print-json`.
 * Silently skips blank lines and lines that don't parse as JSON
 * (yt-dlp occasionally prefixes a warning).
 */
function parseFlatPlaylistOutput(stdout) {
  if (!stdout) return [];
  const out = [];
  for (const raw of stdout.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (!line.startsWith('{')) continue;
    let obj;
    try { obj = JSON.parse(line); } catch (_) { continue; }
    if (!obj || !obj.id) continue;
    out.push({
      videoId: String(obj.id),
      title: obj.title ? String(obj.title) : '',
      duration: Number(obj.duration) || 0,
      uploadDate: obj.upload_date ? String(obj.upload_date) : '',
    });
  }
  return out;
}

module.exports = { crawlPlaylist, parseFlatPlaylistOutput };
