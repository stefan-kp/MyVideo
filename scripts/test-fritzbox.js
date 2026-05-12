#!/usr/bin/env node
/**
 * Manual integration test against a real FRITZ!Box.
 *
 * Two modes:
 *   1. resolve a channel through the registry (smoke-test)
 *   2. directly probe ffmpeg arg variants for a channel (diagnostic)
 *
 * Mode 1 (channel registry, kept for back-compat):
 *   node scripts/test-fritzbox.js <channelId>
 *
 * Mode 2 (raw FFmpeg pipeline test - bypasses the streamer state machine,
 *         iterates over arg variants, reports segment health):
 *   node scripts/test-fritzbox.js <channelId> --probe [--seconds 30]
 *
 * Output dir defaults to ./test-stream/. Override with --outdir.
 *
 * Requires FRITZBOX_HOST/USER/PASSWORD in .env or environment.
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const channels = require('../lib/channels');

const PIPELINES = {
  'copy-current': {
    label: 'copy + ignore_unknown + 10s analyse',
    args: (rtsp, out) => [
      '-loglevel', 'warning',
      '-fflags', '+discardcorrupt+genpts',
      '-err_detect', 'ignore_err',
      '-rtsp_transport', 'udp',
      '-buffer_size', '8388608',
      '-analyzeduration', '10000000',
      '-probesize', '50000000',
      '-i', rtsp,
      '-map', '0:v:0', '-map', '0:a:0?',
      '-ignore_unknown',
      '-c:v', 'copy',
      '-c:a', 'aac', '-b:a', '128k', '-ac', '2',
      '-hls_time', '4',
      '-hls_list_size', '3',
      '-hls_flags', 'delete_segments+append_list',
      '-hls_segment_type', 'mpegts',
      '-hls_segment_filename', path.join(out, 'seg_%03d.ts'),
      '-f', 'hls',
      path.join(out, 'index.m3u8'),
    ],
  },

  'transcode-current': {
    label: 'transcode + ignore_unknown + 10s analyse',
    args: (rtsp, out) => [
      '-loglevel', 'warning',
      '-fflags', '+discardcorrupt+genpts',
      '-err_detect', 'ignore_err',
      '-rtsp_transport', 'udp',
      '-buffer_size', '8388608',
      '-analyzeduration', '10000000',
      '-probesize', '50000000',
      '-i', rtsp,
      '-map', '0:v:0', '-map', '0:a:0?',
      '-ignore_unknown',
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
      '-hls_segment_filename', path.join(out, 'seg_%03d.ts'),
      '-f', 'hls',
      path.join(out, 'index.m3u8'),
    ],
  },

  'transcode-latency-fix': {
    label: 'transcode + -max_delay 5s + -reorder_queue_size 2000',
    args: (rtsp, out) => [
      '-loglevel', 'warning',
      '-fflags', '+discardcorrupt+genpts',
      '-err_detect', 'ignore_err',
      '-rtsp_transport', 'udp',
      '-buffer_size', '8388608',
      '-max_delay', '5000000',
      '-reorder_queue_size', '2000',
      '-analyzeduration', '10000000',
      '-probesize', '50000000',
      '-i', rtsp,
      '-map', '0:v:0', '-map', '0:a:0?',
      '-ignore_unknown',
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
      '-hls_segment_filename', path.join(out, 'seg_%03d.ts'),
      '-f', 'hls',
      path.join(out, 'index.m3u8'),
    ],
  },

  'transcode-minimal': {
    label: 'transcode + minimal input opts',
    args: (rtsp, out) => [
      '-loglevel', 'warning',
      '-rtsp_transport', 'udp',
      '-buffer_size', '8388608',
      '-i', rtsp,
      '-map', '0:v:0', '-map', '0:a:0?',
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
      '-hls_segment_filename', path.join(out, 'seg_%03d.ts'),
      '-f', 'hls',
      path.join(out, 'index.m3u8'),
    ],
  },
};

function clean(dir) {
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) {
    if (f.endsWith('.ts') || f.endsWith('.m3u8')) {
      try { fs.unlinkSync(path.join(dir, f)); } catch {}
    }
  }
}

function watchSegments(dir, durationMs) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const observations = [];
    const interval = setInterval(() => {
      if (!fs.existsSync(dir)) return;
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.ts'));
      const sizes = files.map(f => {
        try { return fs.statSync(path.join(dir, f)).size; } catch { return 0; }
      });
      const total = sizes.reduce((a, b) => a + b, 0);
      observations.push({ t: Date.now() - t0, count: files.length, totalBytes: total });
    }, 1000);
    setTimeout(() => {
      clearInterval(interval);
      resolve(observations);
    }, durationMs);
  });
}

function probeOutput(m3u8Path) {
  if (!fs.existsSync(m3u8Path)) return null;
  const result = spawnSync('ffprobe', [
    '-v', 'error',
    '-print_format', 'json',
    '-show_streams',
    '-show_format',
    m3u8Path,
  ], { encoding: 'utf8', timeout: 5000 });
  if (result.status !== 0) return { error: result.stderr.slice(0, 200) };
  try { return JSON.parse(result.stdout); } catch (e) { return { error: e.message }; }
}

async function runPipeline(name, def, rtspUrl, outDir, durationMs) {
  console.log(`\n===== ${name}: ${def.label} =====`);
  clean(outDir);
  fs.mkdirSync(outDir, { recursive: true });

  const args = def.args(rtspUrl, outDir);
  const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });

  let stderrTail = '';
  let stderrErrors = 0;
  proc.stderr.on('data', (d) => {
    const s = d.toString();
    stderrTail = (stderrTail + s).slice(-2000);
    for (const line of s.split('\n')) {
      if (/error|corrupt|missed|PPS 0/i.test(line)) stderrErrors++;
    }
  });

  let exited = null;
  proc.on('exit', (code, signal) => { exited = { code, signal }; });

  const observations = await watchSegments(outDir, durationMs);

  try { proc.kill('SIGTERM'); } catch {}
  await new Promise(r => setTimeout(r, 500));
  try { proc.kill('SIGKILL'); } catch {}

  if (exited && observations.length < 3) {
    console.log(`  ffmpeg exited early: code=${exited.code} signal=${exited.signal}`);
    console.log('  Last stderr (tail):');
    console.log(stderrTail.split('\n').slice(-10).map(l => '    ' + l).join('\n'));
    return { name, label: def.label, verdict: '✗ EXITED', errorCount: stderrErrors };
  }

  const last = observations[observations.length - 1] || { count: 0, totalBytes: 0 };
  const firstSegmentAt = observations.find(o => o.count > 0);
  const bps = last.totalBytes && observations.length > 1
    ? Math.round(last.totalBytes / (durationMs / 1000))
    : 0;

  const probe = probeOutput(path.join(outDir, 'index.m3u8'));
  let videoCodec = null;
  let videoSize = null;
  if (probe?.streams) {
    const v = probe.streams.find(s => s.codec_type === 'video');
    if (v) { videoCodec = v.codec_name; videoSize = `${v.width}x${v.height}`; }
  }

  const verdict = (() => {
    if (last.count < 2) return '✗ NO SEGMENTS';
    if (!videoCodec) return '✗ NO VIDEO STREAM';
    if (last.totalBytes < 100 * 1024) return '✗ TOO LITTLE DATA';
    if (stderrErrors > 200) return '⚠ NOISY BUT PRODUCING';
    return '✓ OK';
  })();

  console.log(`  first segment at: ${firstSegmentAt ? firstSegmentAt.t + 'ms' : 'never'}`);
  console.log(`  segments after ${durationMs}ms: ${last.count}`);
  console.log(`  total bytes: ${(last.totalBytes / 1024 / 1024).toFixed(2)} MB (~${(bps / 1024).toFixed(0)} kB/s)`);
  console.log(`  video: ${videoCodec || 'none'} ${videoSize || ''}`);
  console.log(`  stderr error/corrupt lines: ${stderrErrors}`);
  console.log(`  ${verdict}`);

  return {
    name, label: def.label,
    firstSegmentAt: firstSegmentAt?.t || null,
    segmentCount: last.count,
    totalBytes: last.totalBytes,
    bps, videoCodec, videoSize,
    errorCount: stderrErrors,
    verdict,
  };
}

async function probeMode(channelId, durationSec, outDir) {
  const { getInstance } = require('../lib/fritzbox/session');
  const { M3uResolver } = require('../lib/fritzbox/m3uResolver');
  const session = getInstance();
  if (!session) {
    console.error('FRITZBOX_HOST/USER/PASSWORD not set.');
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'lib', 'fritzbox', 'channels.json'), 'utf8'));
  const ch = data.channels.find(c => c.id === channelId);
  if (!ch) {
    console.error(`Channel ${channelId} not in lib/fritzbox/channels.json`);
    console.error('Available:', data.channels.map(c => c.id).join(', '));
    process.exit(1);
  }

  console.log(`Resolving RTSP URL for ${ch.displayName} (tuner=${ch.tunerId})...`);
  const resolver = new M3uResolver({ session });
  const rtspUrl = await resolver.getRtspUrl(ch.tunerId);
  console.log(`  ${rtspUrl}`);

  const results = [];
  for (const [name, def] of Object.entries(PIPELINES)) {
    results.push(await runPipeline(name, def, rtspUrl, outDir, durationSec * 1000));
    // small pause between runs so RTSP session can fully tear down
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log('\n===== Summary =====');
  for (const r of results) {
    const verdict = (r.verdict || '?').padEnd(22);
    console.log(`  ${verdict} ${r.name.padEnd(28)} ${r.label}`);
  }
}

async function smokeMode(channelId) {
  const ch = channels.findChannelById(channelId);
  if (!ch) {
    console.error(`Channel not found: ${channelId}`);
    console.error('Available IDs:');
    for (const [group, list] of Object.entries(channels.listChannels())) {
      console.error(`  [${group}]`, list.map(c => c.id).join(', '));
    }
    process.exit(1);
  }

  console.log(`Resolving stream for ${ch.displayName} (source=${ch.source || (ch.primary?.source + '+fallback')}) ...`);
  const t0 = Date.now();
  const stream = await ch.resolveStream();
  const dt = Date.now() - t0;
  console.log(`OK in ${dt}ms`);
  console.log(`  URL: ${stream.url}`);
  console.log(`  MIME: ${stream.mimeType}`);

  if (ch.source === 'fritzbox' || ch.primary?.source === 'fritzbox') {
    console.log('Streaming for 10 seconds...');
    await new Promise(r => setTimeout(r, 10000));
    const fritzboxSource = require('../lib/sources/fritzboxSource');
    await fritzboxSource.shutdown();
    console.log('Stopped.');
  }
}

async function main() {
  const args = process.argv.slice(2);
  const channelId = args[0];
  const probe = args.includes('--probe');
  const seconds = (() => {
    const i = args.indexOf('--seconds');
    return i >= 0 ? parseInt(args[i + 1], 10) : 30;
  })();
  const outDir = (() => {
    const i = args.indexOf('--outdir');
    return i >= 0 ? args[i + 1] : path.join(process.cwd(), 'test-stream');
  })();

  if (!channelId) {
    console.error('Usage:');
    console.error('  node scripts/test-fritzbox.js <channelId>');
    console.error('  node scripts/test-fritzbox.js <channelId> --probe [--seconds 30] [--outdir DIR]');
    console.error('');
    console.error('Available FRITZ!Box channel IDs (from lib/fritzbox/channels.json):');
    try {
      const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'lib', 'fritzbox', 'channels.json'), 'utf8'));
      for (const c of data.channels) console.error(`  ${c.id.padEnd(20)} ${c.displayName}`);
    } catch {}
    process.exit(1);
  }

  if (probe) await probeMode(channelId, seconds, outDir);
  else await smokeMode(channelId);
}

main().catch(err => {
  console.error('FAILED:', err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
