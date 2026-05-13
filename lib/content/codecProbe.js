const { spawn } = require('child_process');

const PROBE_TIMEOUT_MS = 5000;
const DIRECT_PLAY_EXTS = new Set(['.mp4', '.m4v']);
const DIRECT_PLAY_VIDEO = 'h264';
const DIRECT_PLAY_AUDIO = 'aac';
const MAX_H264_LEVEL = 41;  // Echo Show supports up to level 4.1

function decidePlayMode(info) {
  if (!info) return false;
  if (!DIRECT_PLAY_EXTS.has(info.ext)) return false;
  if (info.video !== DIRECT_PLAY_VIDEO) return false;
  if (info.audio !== DIRECT_PLAY_AUDIO) return false;
  if (info.level != null && info.level > MAX_H264_LEVEL) return false;
  return true;
}

function defaultFfprobe(filePath) {
  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'error',
      '-print_format', 'json',
      '-show_streams',
      '-i', filePath,
    ];
    const proc = spawn('ffprobe', args);
    let out = '';
    let err = '';
    proc.stdout.on('data', d => { out += d; });
    proc.stderr.on('data', d => { err += d; });
    const timer = setTimeout(() => proc.kill('SIGKILL'), PROBE_TIMEOUT_MS);
    proc.on('exit', code => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`ffprobe exited ${code}: ${err.slice(0, 200)}`));
      try {
        const data = JSON.parse(out);
        const v = (data.streams || []).find(s => s.codec_type === 'video');
        const a = (data.streams || []).find(s => s.codec_type === 'audio');
        resolve({
          video: v?.codec_name || null,
          audio: a?.codec_name || null,
          level: v?.level != null ? Number(v.level) : null,
        });
      } catch (e) { reject(e); }
    });
    proc.on('error', reject);
  });
}

/**
 * Run ffprobe on entry.path (lazy: skip if entry.codecInfo already populated).
 * Mutates entry.codecInfo on success and on probe failure. Returns the codecInfo.
 */
async function probeIfNeeded(entry, opts = {}) {
  if (entry.codecInfo) return entry.codecInfo;
  const probeFn = opts.probeFn || defaultFfprobe;
  try {
    const raw = await probeFn(entry.path);
    const info = {
      ...raw,
      ext: entry.ext,
      directPlay: decidePlayMode({ ...raw, ext: entry.ext }),
      probedAt: new Date().toISOString(),
    };
    entry.codecInfo = info;
    return info;
  } catch (err) {
    const info = {
      directPlay: false,
      error: err.message,
      probedAt: new Date().toISOString(),
    };
    entry.codecInfo = info;
    return info;
  }
}

module.exports = { probeIfNeeded, decidePlayMode, defaultFfprobe };
