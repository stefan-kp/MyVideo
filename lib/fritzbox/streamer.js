const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const SEGMENT_WAIT_TIMEOUT_MS = 10000;
const SEGMENT_POLL_INTERVAL_MS = 200;
const SIGTERM_GRACE_MS = 2000;
const INACTIVITY_TIMEOUT_MS = 4 * 60 * 60 * 1000;

function copyArgs(rtspUrl, outDir) {
  return [
    '-loglevel', 'warning',
    '-rtsp_transport', 'udp',
    '-analyzeduration', '5000000',
    '-probesize', '10000000',
    '-i', rtspUrl,
    '-map', '0:v:0', '-map', '0:a:0',
    '-c:v', 'copy',
    '-c:a', 'aac', '-b:a', '128k', '-ac', '2',
    '-hls_time', '4',
    '-hls_list_size', '3',
    '-hls_flags', 'delete_segments+append_list',
    '-hls_segment_type', 'mpegts',
    '-hls_segment_filename', path.join(outDir, 'seg_%03d.ts'),
    '-f', 'hls',
    path.join(outDir, 'index.m3u8'),
  ];
}

function transcodeArgs(rtspUrl, outDir) {
  return [
    '-loglevel', 'warning',
    '-rtsp_transport', 'udp',
    '-analyzeduration', '5000000',
    '-probesize', '10000000',
    '-i', rtspUrl,
    '-map', '0:v:0', '-map', '0:a:0',
    '-c:v', 'libx264', '-profile:v', 'main', '-level', '3.1',
    '-preset', 'veryfast', '-tune', 'zerolatency',
    '-b:v', '1500k', '-maxrate', '1500k', '-bufsize', '3000k',
    '-vf', 'scale=960:540',
    '-g', '50', '-keyint_min', '50',
    '-c:a', 'aac', '-b:a', '128k', '-ac', '2',
    '-hls_time', '6',
    '-hls_list_size', '3',
    '-hls_flags', 'delete_segments+append_list',
    '-hls_segment_type', 'mpegts',
    '-hls_segment_filename', path.join(outDir, 'seg_%03d.ts'),
    '-f', 'hls',
    path.join(outDir, 'index.m3u8'),
  ];
}

async function defaultWaitForSegment(outDir) {
  const target = path.join(outDir, 'index.m3u8');
  const start = Date.now();
  while (Date.now() - start < SEGMENT_WAIT_TIMEOUT_MS) {
    if (fs.existsSync(target)) {
      // Also wait for at least one .ts segment - prevents handing 0-byte playlist to Echo Show
      const files = fs.readdirSync(outDir).filter(f => f.endsWith('.ts'));
      if (files.length > 0) return true;
    }
    await new Promise(r => setTimeout(r, SEGMENT_POLL_INTERVAL_MS));
  }
  return false;
}

class Streamer {
  constructor(opts = {}) {
    this.streamDir = opts.streamDir || path.join(__dirname, '..', '..', 'stream', 'fritzbox');
    this.spawnFn = opts.spawnFn || spawn;
    this.waitForSegmentFn = opts.waitForSegmentFn || defaultWaitForSegment;
    this.resolveRtsp = opts.resolveRtsp;  // async (tunerId) => rtspUrl
    this.getPipeline = opts.getPipeline;  // async (tunerId, rtspUrl) => 'copy'|'transcode'

    this.state = 'IDLE';        // IDLE | STARTING | PLAYING | STOPPING
    this.current = null;        // { channelId, tunerId, startedAt, proc }
    this.lastActivity = null;
    this._inactivityTimer = null;
  }

  getCurrent() {
    if (!this.current) return null;
    return { channelId: this.current.channelId, startedAt: this.current.startedAt, status: this.state };
  }

  async start(channel) {
    // No-op if already PLAYING this channel
    if (this.state === 'PLAYING' && this.current?.channelId === channel.id) {
      this._touch();
      return this._hlsUrl();
    }

    // If anything else is running, stop it first
    if (this.current) {
      await this._stopInternal();
    }

    this.state = 'STARTING';
    this._clearStreamDir();

    let rtspUrl, pipeline;
    try {
      rtspUrl = await this.resolveRtsp(channel.tunerId);
      pipeline = await this.getPipeline(channel.tunerId, rtspUrl);
    } catch (err) {
      this.state = 'IDLE';
      throw err;
    }

    const args = pipeline === 'copy' ? copyArgs(rtspUrl, this.streamDir) : transcodeArgs(rtspUrl, this.streamDir);
    fs.mkdirSync(this.streamDir, { recursive: true });
    const proc = this.spawnFn('ffmpeg', args);

    this.current = {
      channelId: channel.id,
      tunerId: channel.tunerId,
      displayName: channel.displayName,
      pipeline,
      startedAt: new Date().toISOString(),
      proc,
    };

    proc.on('exit', (code, signal) => {
      // If we are still PLAYING this channel, it was a crash
      if (this.state === 'PLAYING' && this.current?.proc === proc) {
        console.error(`Streamer: ffmpeg exited unexpectedly (code=${code}, signal=${signal})`);
        this._clearStreamDir();
        this.state = 'IDLE';
        this.current = null;
      }
    });
    if (proc.stderr) proc.stderr.on('data', (d) => console.error(`ffmpeg: ${d.toString().trim()}`));

    // Race the segment-wait against ffmpeg exiting early (bad RTSP, denied tuner etc.)
    let exitedEarly = false;
    const exitWatch = new Promise((resolve) => {
      proc.once('exit', () => {
        if (this.state === 'STARTING') {
          exitedEarly = true;
          resolve(false);
        }
      });
    });
    const segmentReady = this.waitForSegmentFn(this.streamDir);
    const ok = await Promise.race([segmentReady, exitWatch]);
    if (!ok) {
      try { proc.kill('SIGTERM'); } catch {}
      this._clearStreamDir();
      this.state = 'IDLE';
      this.current = null;
      throw new Error(exitedEarly
        ? 'FFmpeg exited during startup'
        : 'FFmpeg produced no segment within timeout');
    }

    this.state = 'PLAYING';
    this._touch();
    return this._hlsUrl();
  }

  async stop() {
    if (!this.current) return;
    await this._stopInternal();
  }

  async _stopInternal() {
    if (!this.current) return;
    this.state = 'STOPPING';
    const proc = this.current.proc;

    await new Promise((resolve) => {
      let resolved = false;
      const done = () => { if (!resolved) { resolved = true; resolve(); } };
      proc.on('exit', done);
      try { proc.kill('SIGTERM'); } catch { done(); return; }
      setTimeout(() => {
        if (!resolved) { try { proc.kill('SIGKILL'); } catch {} }
      }, SIGTERM_GRACE_MS);
    });

    this._clearStreamDir();
    this.current = null;
    this.state = 'IDLE';
    if (this._inactivityTimer) clearTimeout(this._inactivityTimer);
    this._inactivityTimer = null;
  }

  _clearStreamDir() {
    try {
      if (!fs.existsSync(this.streamDir)) return;
      for (const f of fs.readdirSync(this.streamDir)) {
        if (f.endsWith('.ts') || f.endsWith('.m3u8')) {
          try { fs.unlinkSync(path.join(this.streamDir, f)); } catch {}
        }
      }
    } catch {}
  }

  _hlsUrl() {
    return '/stream/fritzbox/index.m3u8';
  }

  _touch() {
    this.lastActivity = Date.now();
    if (this._inactivityTimer) clearTimeout(this._inactivityTimer);
    this._inactivityTimer = setTimeout(() => {
      console.log('Streamer: inactivity timeout, stopping');
      this.stop().catch(() => {});
    }, INACTIVITY_TIMEOUT_MS);
  }
}

module.exports = { Streamer, copyArgs, transcodeArgs };
