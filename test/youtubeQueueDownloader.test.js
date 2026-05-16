#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Queue } = require('../lib/queue');
const { makeDownloadAndAttach, extractVideoId } = require('../lib/youtube/queueDownloader');

let passed = 0, failed = 0;
function assert(c, m) { if (c) { console.log(`  ✓ ${m}`); passed++; } else { console.error(`  ✗ ${m}`); failed++; } }
function tmpFile() { return path.join(os.tmpdir(), `q-yt.${Date.now()}.${Math.random()}.json`); }

(async () => {
  console.log('\n--- extractVideoId ---');
  assert(extractVideoId('dQw4w9WgXcQ') === 'dQw4w9WgXcQ', 'bare id');
  assert(extractVideoId('https://youtu.be/dQw4w9WgXcQ') === 'dQw4w9WgXcQ', 'youtu.be');
  assert(extractVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ') === 'dQw4w9WgXcQ', 'watch?v=');
  assert(extractVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLfoo') === 'dQw4w9WgXcQ', 'watch?v= with extra params');
  assert(extractVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ') === 'dQw4w9WgXcQ', 'embed');
  assert(extractVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ') === 'dQw4w9WgXcQ', 'shorts');
  assert(extractVideoId('garbage') === null, 'garbage');
  assert(extractVideoId('') === null, 'empty');
  assert(extractVideoId(null) === null, 'null');

  console.log('\n--- makeDownloadAndAttach: success path ---');
  const q1 = new Queue();
  q1.file = tmpFile();
  const item = q1.add({
    source: 'youtube_pending',
    youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ',
    title: 'Rick Roll',
    status: 'downloading',
  });
  let downloadFnCalled = null;
  const fakeFile = '/data/youtube/_inbox/dQw4w9WgXcQ-rick.mp4';
  const fakeContentService = {
    isEnabled: () => true,
    rescan: async () => ({ entries: 1 }),
    getIndex: () => ({
      all: () => [{ id: 'youtube/_inbox/dqw4w9wgxcq-rick', path: fakeFile }],
    }),
  };
  const downloadAndAttach = makeDownloadAndAttach({
    queue: q1,
    contentService: fakeContentService,
    youtubeDir: '/data/youtube',
    downloadFn: async (opts) => { downloadFnCalled = opts; return fakeFile; },
  });
  await downloadAndAttach(item.id, 'https://youtu.be/dQw4w9WgXcQ');
  assert(downloadFnCalled && downloadFnCalled.videoId === 'dQw4w9WgXcQ', `download called with videoId (got: ${downloadFnCalled && downloadFnCalled.videoId})`);
  assert(downloadFnCalled.outDir === '/data/youtube/_inbox', 'outDir is _inbox');
  const after = q1.list()[0];
  assert(after.status === 'ready', `status ready (got: ${after.status})`);
  assert(after.source === 'local', 'source flipped to local');
  assert(after.contentId === 'youtube/_inbox/dqw4w9wgxcq-rick', 'contentId set');
  assert(after.imageUrl === 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg', 'ytimg URL set');

  console.log('\n--- makeDownloadAndAttach: download error ---');
  const q2 = new Queue();
  q2.file = tmpFile();
  const item2 = q2.add({
    source: 'youtube_pending',
    youtubeUrl: 'https://youtu.be/badvidIDxyz',
    title: 'Bad',
    status: 'downloading',
  });
  const downloadAndAttach2 = makeDownloadAndAttach({
    queue: q2,
    contentService: fakeContentService,
    youtubeDir: '/data/youtube',
    downloadFn: async () => { throw new Error('yt-dlp exited 1: video unavailable'); },
  });
  await downloadAndAttach2(item2.id, 'https://youtu.be/badvidIDxyz');
  const after2 = q2.list()[0];
  assert(after2.status === 'failed', `status failed (got: ${after2.status})`);
  assert(/yt-dlp/.test(after2.error || ''), `error msg has yt-dlp (got: ${after2.error})`);
  assert(after2.source === 'youtube_pending', 'source stays pending on failure');

  console.log('\n--- makeDownloadAndAttach: invalid URL ---');
  const q3 = new Queue();
  q3.file = tmpFile();
  const item3 = q3.add({
    source: 'youtube_pending',
    youtubeUrl: 'not-a-youtube-url',
    title: 'Bad URL',
    status: 'downloading',
  });
  const downloadAndAttach3 = makeDownloadAndAttach({
    queue: q3,
    contentService: fakeContentService,
    youtubeDir: '/data/youtube',
    downloadFn: async () => { throw new Error('should never be called'); },
  });
  await downloadAndAttach3(item3.id, 'not-a-youtube-url');
  const after3 = q3.list()[0];
  assert(after3.status === 'failed', 'invalid url → failed');
  assert(/Video-ID/.test(after3.error || ''), 'error mentions video-id parse');

  console.log('\n--- makeDownloadAndAttach: rescan finds nothing → failed ---');
  const q4 = new Queue();
  q4.file = tmpFile();
  const item4 = q4.add({
    source: 'youtube_pending',
    youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ',
    title: 'X',
    status: 'downloading',
  });
  const emptyContentService = {
    isEnabled: () => true,
    rescan: async () => ({ entries: 0 }),
    getIndex: () => ({ all: () => [] }),
  };
  const downloadAndAttach4 = makeDownloadAndAttach({
    queue: q4,
    contentService: emptyContentService,
    youtubeDir: '/data/youtube',
    downloadFn: async () => '/data/youtube/_inbox/dQw4w9WgXcQ.mp4',
  });
  await downloadAndAttach4(item4.id, 'https://youtu.be/dQw4w9WgXcQ');
  const after4 = q4.list()[0];
  assert(after4.status === 'failed', 'rescan-miss → failed');
  assert(/Content-Index/.test(after4.error || ''), 'error mentions content-index');

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
