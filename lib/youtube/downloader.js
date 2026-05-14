const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const DEFAULT_FORMAT = process.env.YOUTUBE_FORMAT_SELECTOR ||
  'bestvideo[ext=mp4][height<=720]+bestaudio[ext=m4a]/best[ext=mp4][height<=720]/best[height<=720]';
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000; // 15 min per video
const OUTPUT_TEMPLATE = '%(id)s-%(title).80s.%(ext)s';

/**
 * Build the argv for `yt-dlp` given a videoId + output dir + format.
 * Exposed for tests.
 */
function buildDownloadArgs({ videoId, outDir, formatSelector }) {
  const outTemplate = path.join(outDir, OUTPUT_TEMPLATE);
  return [
    '-f', formatSelector || DEFAULT_FORMAT,
    '--merge-output-format', 'mp4',
    '--no-playlist',
    '--no-warnings',
    '--restrict-filenames',
    '-o', outTemplate,
    `https://www.youtube.com/watch?v=${videoId}`,
  ];
}

/**
 * Download a single YouTube video via yt-dlp.
 *
 * Returns the absolute path of the produced .mp4 file (yt-dlp chooses the
 * filename from the template, including the title; we find it by scanning
 * outDir for a file whose name starts with the videoId).
 *
 * Creates `outDir` if missing.
 *
 * @param {object} opts
 * @param {string} opts.videoId
 * @param {string} opts.outDir - absolute path
 * @param {string} [opts.formatSelector]
 * @param {function} [opts.spawnFn]
 * @param {function} [opts.onProgress] - called with stdout/stderr line strings
 * @param {number} [opts.timeoutMs]
 * @param {string} [opts.ytDlpPath]
 */
function downloadVideo(opts) {
  const { videoId, outDir, formatSelector, spawnFn = spawn, onProgress, timeoutMs = DEFAULT_TIMEOUT_MS, ytDlpPath } = opts;
  if (!videoId) return Promise.reject(new Error('downloadVideo: videoId required'));
  if (!outDir) return Promise.reject(new Error('downloadVideo: outDir required'));

  return new Promise((resolve, reject) => {
    try { fs.mkdirSync(outDir, { recursive: true }); } catch (err) {
      return reject(new Error(`downloadVideo: mkdir failed: ${err.message}`));
    }

    const args = buildDownloadArgs({ videoId, outDir, formatSelector });
    const cmd = ytDlpPath || process.env.YT_DLP_PATH || 'yt-dlp';
    const proc = spawnFn(cmd, args);
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { proc.kill('SIGKILL'); } catch (_) {}
      reject(new Error(`yt-dlp download timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    if (proc.stdout) proc.stdout.on('data', d => {
      const s = d.toString();
      if (onProgress) onProgress(s);
    });
    if (proc.stderr) proc.stderr.on('data', d => {
      const s = d.toString();
      stderr += s;
      if (onProgress) onProgress(s);
    });
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
      const file = findDownloadedFile(outDir, videoId);
      if (!file) {
        return reject(new Error(`yt-dlp succeeded but no file produced for ${videoId} in ${outDir}`));
      }
      resolve(file);
    });
  });
}

/**
 * Find a file in `dir` whose basename starts with `${videoId}-` or equals
 * `${videoId}.<ext>`. yt-dlp writes "<id>-<title-truncated>.mp4" via our
 * OUTPUT_TEMPLATE but may also write "<id>.mp4" if the title is empty.
 */
function findDownloadedFile(dir, videoId) {
  let entries;
  try { entries = fs.readdirSync(dir); } catch (_) { return null; }
  // Prefer .mp4, then any video extension
  const prefMatch = entries.find(n => n.startsWith(`${videoId}-`) && n.endsWith('.mp4'))
    || entries.find(n => n === `${videoId}.mp4`)
    || entries.find(n => n.startsWith(`${videoId}-`))
    || entries.find(n => n.startsWith(`${videoId}.`));
  return prefMatch ? path.join(dir, prefMatch) : null;
}

module.exports = { downloadVideo, buildDownloadArgs, findDownloadedFile, DEFAULT_FORMAT };
