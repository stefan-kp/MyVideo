const { spawn } = require('child_process');

/**
 * Detect the right audio stream for an RTSP source.
 *
 * DVB-C streams from FRITZ!Box typically expose multiple audio tracks:
 *   - Primary German (often AC-3 5.1, language="deu")
 *   - Audio description for the visually impaired (also "deu", different PID)
 *   - Original language (English, French, etc.)
 *
 * Without explicit selection, FFmpeg's `-map 0:a:0` picks the lowest-indexed
 * audio PID, which is unpredictable (different per channel and sometimes
 * per moment).
 *
 * This module probes the stream with ffprobe and returns an FFmpeg map
 * specifier ("0:a:N") that selects, in priority order:
 *   1. A track tagged language=deu AND NOT marked as visually_impaired
 *   2. Any track tagged language=deu
 *   3. The default-disposition track
 *   4. The first audio track (FFmpeg's default behavior)
 *
 * Cached per tuner so we only pay the probe cost once.
 */

const PROBE_TIMEOUT_MS = 8000;
const cache = new Map();  // tunerId -> { spec, probedAt }

function ffprobeAudio(rtspUrl) {
  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'error',
      '-rtsp_transport', 'udp',
      '-analyzeduration', '5000000',
      '-probesize', '50000000',
      '-print_format', 'json',
      '-show_streams', '-select_streams', 'a',
      '-i', rtspUrl,
    ];
    const proc = spawn('ffprobe', args);
    let out = '';
    let err = '';
    proc.stdout.on('data', (d) => { out += d; });
    proc.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => proc.kill('SIGKILL'), PROBE_TIMEOUT_MS);
    proc.on('exit', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        return reject(new Error(`ffprobe exited ${code}: ${err.slice(0, 200)}`));
      }
      try {
        const data = JSON.parse(out);
        resolve(data.streams || []);
      } catch (e) {
        reject(e);
      }
    });
    proc.on('error', reject);
  });
}

/**
 * Pick the best audio stream from a list. Returns the absolute stream index
 * (as in the source container) for use with `-map 0:N`.
 */
function pickAudioStream(streams) {
  if (!streams || streams.length === 0) return null;

  const isDeu = (s) => (s.tags?.language || '').toLowerCase().startsWith('de');
  const isVisualImpaired = (s) => s.disposition?.visual_impaired === 1;
  const isDefault = (s) => s.disposition?.default === 1;

  // 1. German + not visually-impaired
  let pick = streams.find(s => isDeu(s) && !isVisualImpaired(s));
  if (pick) return pick.index;

  // 2. Any German
  pick = streams.find(s => isDeu(s));
  if (pick) return pick.index;

  // 3. Default track
  pick = streams.find(s => isDefault(s));
  if (pick) return pick.index;

  // 4. First audio
  return streams[0].index;
}

/**
 * Pick an audio map specifier for the given tuner. Caches the result so
 * repeated channel switches don't re-probe. Returns a string like "0:3" for
 * use as `-map 0:3`, or null if probing failed (caller should fall back to
 * `-map 0:a:0?`).
 */
async function pickAudioMap(tunerId, rtspUrl) {
  if (cache.has(tunerId)) {
    return cache.get(tunerId).spec;
  }
  try {
    const streams = await ffprobeAudio(rtspUrl);
    const idx = pickAudioStream(streams);
    if (idx == null) {
      cache.set(tunerId, { spec: null, probedAt: new Date().toISOString() });
      return null;
    }
    const spec = `0:${idx}`;
    cache.set(tunerId, { spec, probedAt: new Date().toISOString(), streams: streams.length });
    return spec;
  } catch (err) {
    console.warn(`audioPicker: ffprobe failed for tuner ${tunerId}:`, err.message);
    return null;
  }
}

function invalidate(tunerId) {
  if (tunerId) cache.delete(tunerId);
  else cache.clear();
}

module.exports = { pickAudioMap, pickAudioStream, invalidate };
