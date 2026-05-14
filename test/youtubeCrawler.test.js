#!/usr/bin/env node
/**
 * youtubeCrawler test - mocks spawn() to simulate yt-dlp --flat-playlist
 */
const { EventEmitter } = require('events');
const { crawlPlaylist, parseFlatPlaylistOutput } = require('../lib/youtube/crawler');

let passed = 0, failed = 0;
function assert(c, m) { if (c) { console.log(`  ✓ ${m}`); passed++; } else { console.error(`  ✗ ${m}`); failed++; } }

function fakeSpawn(exitCode, stdoutChunks, stderrChunks = []) {
  return () => {
    const proc = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.kill = () => {};
    setImmediate(() => {
      for (const c of stdoutChunks) proc.stdout.emit('data', Buffer.from(c));
      for (const c of stderrChunks) proc.stderr.emit('data', Buffer.from(c));
      proc.emit('close', exitCode);
    });
    return proc;
  };
}

(async () => {
  console.log('\n--- parseFlatPlaylistOutput ---');
  const sample = [
    JSON.stringify({ id: 'abc123', title: 'Episode 1', duration: 600, upload_date: '20260514' }),
    JSON.stringify({ id: 'def456', title: 'Episode 2', duration: 1200, upload_date: '20260513' }),
    '', // blank line
    'not json line',
    JSON.stringify({ id: 'ghi789', title: 'Episode 3', duration: 900 }),
  ].join('\n');
  const parsed = parseFlatPlaylistOutput(sample);
  assert(parsed.length === 3, `parsed 3 entries (got ${parsed.length})`);
  assert(parsed[0].videoId === 'abc123', 'videoId from id field');
  assert(parsed[0].title === 'Episode 1', 'title preserved');
  assert(parsed[0].duration === 600, 'duration preserved');
  assert(parsed[0].uploadDate === '20260514', 'upload_date -> uploadDate');
  assert(parsed[2].uploadDate === '', 'missing uploadDate becomes empty string');

  console.log('\n--- crawlPlaylist success ---');
  const out = [
    JSON.stringify({ id: 'v1', title: 'Hello', duration: 100, upload_date: '20260101' }) + '\n',
    JSON.stringify({ id: 'v2', title: 'World', duration: 200, upload_date: '20260102' }) + '\n',
  ];
  let spawnArgs = null;
  const spawnFn = (cmd, args) => {
    spawnArgs = { cmd, args };
    return fakeSpawn(0, out)();
  };
  const videos = await crawlPlaylist('https://www.youtube.com/playlist?list=PLfoo', { spawnFn });
  assert(spawnArgs.cmd === 'yt-dlp', 'invokes yt-dlp');
  assert(spawnArgs.args.includes('--flat-playlist'), 'passes --flat-playlist');
  assert(spawnArgs.args.includes('-J') || spawnArgs.args.includes('--print-json') || spawnArgs.args.includes('--print'), 'requests json output');
  assert(spawnArgs.args.includes('https://www.youtube.com/playlist?list=PLfoo'), 'passes URL');
  assert(videos.length === 2, '2 videos returned');
  assert(videos[0].videoId === 'v1', 'first videoId v1');
  assert(videos[1].videoId === 'v2', 'second videoId v2');

  console.log('\n--- crawlPlaylist failure ---');
  let err = null;
  try {
    await crawlPlaylist('https://www.youtube.com/playlist?list=PLbad', {
      spawnFn: fakeSpawn(1, [], ['yt-dlp: playlist not found\n']),
    });
  } catch (e) { err = e; }
  assert(err && /yt-dlp/.test(err.message), `non-zero exit throws (msg: ${err && err.message})`);

  console.log('\n--- crawlPlaylist empty output ---');
  const empty = await crawlPlaylist('https://www.youtube.com/playlist?list=PLempty', {
    spawnFn: fakeSpawn(0, ['']),
  });
  assert(empty.length === 0, 'empty stdout -> empty array');

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
