const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const SEGMENT_WAIT_TIMEOUT_MS = 20000;
const SEGMENT_POLL_INTERVAL_MS = 200;
const SIGTERM_GRACE_MS = 2000;
const INACTIVITY_TIMEOUT_MS = 4 * 60 * 60 * 1000;

function copyArgs(rtspUrl, outDir, audioMap) {
  // audioMap is an explicit stream selector like "0:3" if the audio picker
  // identified a German track, or null to let FFmpeg pick the first audio.
  const audioMapArgs = audioMap ? ['-map', audioMap] : ['-map', '0:a:0?'];
  return [
    '-loglevel', 'warning',
    '-rtsp_transport', 'udp',
    '-buffer_size', '8388608',
    '-i', rtspUrl,
    '-map', '0:v:0', ...audioMapArgs,
    '-ignore_unknown',
    '-c:v', 'copy',
    '-c:a', 'aac', '-b:a', '128k', '-ac', '2',
    '-hls_time', '4',
    '-hls_list_size', '3',
    '-hls_flags', 'delete_segments+append_list',
    '-hls_segment_filename', path.join(outDir, 'seg_%03d.ts'),
    '-f', 'hls',
    path.join(outDir, 'index.m3u8'),
  ];
}

function transcodeArgs(rtspUrl, outDir, audioMap) {
  // "Minimal" args — field-tested as the cleanest on a Pi 5 LAN+FRITZ!Box
  // setup (~4 decode errors over 30s, first segment at 8s). Adding +discardcorrupt,
  // analyzeduration, larger buffer_size, or PSI/teletext filtering all made it
  // slower or no cleaner. Modern FFmpeg picks good defaults for DVB-style TS
  // input.
  const audioMapArgs = audioMap ? ['-map', audioMap] : ['-map', '0:a:0?'];
  return [
    '-loglevel', 'warning',
    '-rtsp_transport', 'udp',
    '-buffer_size', '8388608',
    '-i', rtspUrl,
    '-map', '0:v:0', ...audioMapArgs,
    '-ignore_unknown',
    '-c:v', 'libx264', '-profile:v', 'main', '-level', '3.1',
    '-preset', 'veryfast',
    '-b:v', '1500k',
    '-vf', 'scale=960:540',
    '-g', '50',
    '-c:a', 'aac', '-b:a', '128k', '-ac', '2',
    '-hls_time', '6',
    '-hls_list_size', '3',
    '-hls_flags', 'delete_segments+append_list',
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
    this.resolveRtsp = opts.resolveRtsp;       // async (tunerId) => rtspUrl
    this.getPipeline = opts.getPipeline;       // async (tunerId, rtspUrl) => 'copy'|'transcode'
    this.pickAudioMap = opts.pickAudioMap;     // optional async (tunerId, rtspUrl) => "0:N" or null

    this.state = 'IDLE';        // IDLE | STARTING | PLAYING | STOPPING
    this.current = null;        // { channelId, tunerId, startedAt, proc }
    this.lastActivity = null;
    this._inactivityTimer = null;
  }

  getCurrent() {
    if (!this.current) return null;
    return { channelId: this.current.channelId, startedAt: this.current.startedAt, status: this.state };
  }

  /**
   * Full state for diagnostic endpoints. Returns null when idle.
   */
  getDiagnosticState() {
    if (!this.current) return { state: this.state, current: null };
    const c = this.current;
    return {
      state: this.state,
      current: {
        channelId: c.channelId,
        tunerId: c.tunerId,
        displayName: c.displayName,
        pipeline: c.pipeline,
        audioMap: c.audioMap,
        rtspUrl: c.rtspUrl,
        ffmpegArgs: c.ffmpegArgs,
        startedAt: c.startedAt,
        runningForMs: c.startedAtMs ? Date.now() - c.startedAtMs : null,
        pid: c.proc?.pid || null,
      },
    };
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

    let rtspUrl, pipeline, audioMap = null;
    try {
      rtspUrl = await this.resolveRtsp(channel.tunerId);
      pipeline = await this.getPipeline(channel.tunerId, rtspUrl);
      if (this.pickAudioMap) {
        try {
          audioMap = await this.pickAudioMap(channel.tunerId, rtspUrl);
        } catch {
          // probing failed - FFmpeg will fall back to default audio selection
          audioMap = null;
        }
      }
    } catch (err) {
      this.state = 'IDLE';
      throw err;
    }

    const args = pipeline === 'copy'
      ? copyArgs(rtspUrl, this.streamDir, audioMap)
      : transcodeArgs(rtspUrl, this.streamDir, audioMap);
    fs.mkdirSync(this.streamDir, { recursive: true });

    console.log(`[stream] ${channel.id} STARTING`);
    console.log(`[stream]   tuner=${channel.tunerId}  pipeline=${pipeline}  audio=${audioMap || '(default first track)'}`);
    console.log(`[stream]   ffmpeg ${args.map(a => /\s/.test(a) ? `'${a}'` : a).join(' ')}`);

    const startedAtMs = Date.now();
    const proc = this.spawnFn('ffmpeg', args);

    this.current = {
      channelId: channel.id,
      tunerId: channel.tunerId,
      displayName: channel.displayName,
      pipeline,
      audioMap,
      rtspUrl,
      ffmpegArgs: args,
      startedAt: new Date(startedAtMs).toISOString(),
      startedAtMs,
      proc,
    };

    proc.on('exit', (code, signal) => {
      // If we are still PLAYING this channel, it was a crash
      if (this.state === 'PLAYING' && this.current?.proc === proc) {
        const ranMs = Date.now() - (this.current.startedAtMs || Date.now());
        console.error(`[stream] ${this.current.channelId} CRASHED (code=${code}, signal=${signal}, ran ${Math.round(ranMs / 1000)}s)`);
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

    const firstSegmentMs = Date.now() - startedAtMs;
    console.log(`[stream] ${channel.id} PLAYING (first segment after ${firstSegmentMs}ms)`);

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
    const stoppingChannel = this.current.channelId;
    const ranMs = Date.now() - (this.current.startedAtMs || Date.now());
    console.log(`[stream] ${stoppingChannel} STOPPING (ran ${Math.round(ranMs / 1000)}s)`);
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
