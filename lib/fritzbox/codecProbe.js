const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

/**
 * Decide pipeline based on probe result.
 *
 * Default: always "transcode". RTSP/SAT>IP over UDP loses packets, and the
 * Echo Show H.264 player chokes on the resulting corruption (PPS errors,
 * decode_slice_header errors, no frame). Letting libx264 rebuild a clean
 * stream from libavcodec's error-concealed decode is far more reliable than
 * stream-copy.
 *
 * Opt-in copy mode: set FRITZBOX_PIPELINE=copy in env for H.264 sources on a
 * stable wired LAN where lower CPU usage outweighs robustness.
 */
function decidePipeline({ video }) {
  if (process.env.FRITZBOX_PIPELINE === 'copy' && video === 'h264') return 'copy';
  return 'transcode';
}

/**
 * Probe RTSP source with ffprobe, return { video, audio } codec strings.
 * Times out after 5s.
 */
function defaultFfprobe(rtspUrl) {
  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'error',
      '-rtsp_transport', 'udp',
      '-analyzeduration', '2000000',
      '-probesize', '2000000',
      '-print_format', 'json',
      '-show_streams',
      '-i', rtspUrl,
    ];
    const proc = spawn('ffprobe', args);
    let out = '';
    let err = '';
    proc.stdout.on('data', (d) => { out += d; });
    proc.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => proc.kill('SIGKILL'), 5000);
    proc.on('exit', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`ffprobe exited ${code}: ${err.slice(0, 200)}`));
      try {
        const data = JSON.parse(out);
        const v = (data.streams || []).find(s => s.codec_type === 'video');
        const a = (data.streams || []).find(s => s.codec_type === 'audio');
        resolve({ video: v?.codec_name || 'unknown', audio: a?.codec_name || 'unknown' });
      } catch (e) {
        reject(e);
      }
    });
    proc.on('error', reject);
  });
}

class CodecProbe {
  constructor({ cacheFile, probeFn } = {}) {
    this.cacheFile = cacheFile || path.join(__dirname, '..', '..', '.cache', 'codec-probe.json');
    this.probeFn = probeFn || defaultFfprobe;
    this._loadCache();
  }

  _loadCache() {
    try {
      this.cache = JSON.parse(fs.readFileSync(this.cacheFile, 'utf8'));
    } catch {
      this.cache = {};
    }
  }

  _saveCache() {
    try {
      fs.mkdirSync(path.dirname(this.cacheFile), { recursive: true });
      fs.writeFileSync(this.cacheFile, JSON.stringify(this.cache, null, 2));
    } catch (e) {
      console.error('CodecProbe cache save failed:', e.message);
    }
  }

  async getPipeline(tunerId, rtspUrl) {
    if (this.cache[tunerId]?.pipeline) return this.cache[tunerId].pipeline;
    const codecs = await this.probeFn(rtspUrl);
    const pipeline = decidePipeline(codecs);
    this.cache[tunerId] = { ...codecs, pipeline, probedAt: new Date().toISOString() };
    this._saveCache();
    return pipeline;
  }

  invalidate(tunerId) {
    if (tunerId) delete this.cache[tunerId];
    else this.cache = {};
    this._saveCache();
  }
}

module.exports = { CodecProbe, decidePipeline };
