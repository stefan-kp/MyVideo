#!/usr/bin/env node
/**
 * youtubeDownloader test - mocks spawn() to simulate yt-dlp download
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { downloadVideo, buildDownloadArgs, DEFAULT_FORMAT } = require('../lib/youtube/downloader');

let passed = 0, failed = 0;
function assert(c, m) { if (c) { console.log(`  ✓ ${m}`); passed++; } else { console.error(`  ✗ ${m}`); failed++; } }

function fakeSpawn(exitCode, stdoutChunks = [], stderrChunks = [], opts = {}) {
  return () => {
    const proc = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.kill = () => {};
    setImmediate(() => {
      for (const c of stdoutChunks) proc.stdout.emit('data', Buffer.from(c));
      for (const c of stderrChunks) proc.stderr.emit('data', Buffer.from(c));
      if (opts.createFile) {
        try { fs.writeFileSync(opts.createFile, 'fake'); } catch (_) {}
      }
      proc.emit('close', exitCode);
    });
    return proc;
  };
}

(async () => {
  console.log('\n--- DEFAULT_FORMAT forces H.264 (avoid AV1 → CPU transcode) ---');
  assert(DEFAULT_FORMAT.includes('vcodec^=avc1'),
    `DEFAULT_FORMAT must restrict to avc1/H.264 (got: ${DEFAULT_FORMAT})`);
  assert(DEFAULT_FORMAT.includes('height<=720'), 'DEFAULT_FORMAT caps at 720p');
  assert(DEFAULT_FORMAT.includes('m4a') || DEFAULT_FORMAT.includes('aac'),
    'DEFAULT_FORMAT prefers AAC audio (m4a container)');

  console.log('\n--- buildDownloadArgs ---');
  const args = buildDownloadArgs({
    videoId: 'abc123',
    outDir: '/data/youtube/jimmy-kimmel',
    formatSelector: 'bestvideo[ext=mp4]+bestaudio[ext=m4a]',
  });
  assert(args.includes('-f'), 'has -f flag');
  const fIdx = args.indexOf('-f');
  assert(args[fIdx + 1] === 'bestvideo[ext=mp4]+bestaudio[ext=m4a]', 'format selector passed');
  assert(args.includes('-o'), 'has -o flag');
  const oIdx = args.indexOf('-o');
  assert(args[oIdx + 1].includes('/data/youtube/jimmy-kimmel'), 'output dir in template');
  assert(args[oIdx + 1].includes('%(id)s'), 'template uses %(id)s');
  assert(args.includes('--merge-output-format'), 'merge-output-format set');
  assert(args.some(a => a === 'https://www.youtube.com/watch?v=abc123'), 'video URL constructed');

  console.log('\n--- downloadVideo success ---');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-dl-'));
  const expectedFile = path.join(tmpDir, 'v1-Hello.mp4');
  let spawnCalls = 0;
  const spawnFn = (cmd, _args) => {
    spawnCalls++;
    return fakeSpawn(0, [], [], { createFile: expectedFile })();
  };
  const result = await downloadVideo({
    videoId: 'v1',
    outDir: tmpDir,
    spawnFn,
  });
  assert(spawnCalls === 1, 'spawned yt-dlp once');
  assert(result && fs.existsSync(result), `returns downloaded file path (${result})`);
  fs.rmSync(tmpDir, { recursive: true, force: true });

  console.log('\n--- downloadVideo failure ---');
  const tmpDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-dl-'));
  let err = null;
  try {
    await downloadVideo({
      videoId: 'bad',
      outDir: tmpDir2,
      spawnFn: fakeSpawn(1, [], ['yt-dlp: video unavailable\n']),
    });
  } catch (e) { err = e; }
  assert(err && /yt-dlp/.test(err.message), `non-zero exit throws (msg: ${err && err.message})`);
  fs.rmSync(tmpDir2, { recursive: true, force: true });

  console.log('\n--- downloadVideo success but no file produced ---');
  const tmpDir3 = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-dl-'));
  let err2 = null;
  try {
    await downloadVideo({
      videoId: 'ghost',
      outDir: tmpDir3,
      spawnFn: fakeSpawn(0), // no file created
    });
  } catch (e) { err2 = e; }
  assert(err2 && /no file/i.test(err2.message), `missing output throws (msg: ${err2 && err2.message})`);
  fs.rmSync(tmpDir3, { recursive: true, force: true });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
