#!/usr/bin/env node
const { videoIdFromFilename, videoIdFromEntry, thumbnailUrl } = require('../lib/youtube/thumbnail');

let passed = 0, failed = 0;
function assert(c, m) { if (c) { console.log(`  ✓ ${m}`); passed++; } else { console.error(`  ✗ ${m}`); failed++; } }

(async () => {
  console.log('\n--- videoIdFromFilename ---');
  assert(videoIdFromFilename('/data/youtube/snl/7N68NjL9cMA-Kavanaugh.mp4') === '7N68NjL9cMA',
    'standard yt-dlp filename → 7N68NjL9cMA');
  assert(videoIdFromFilename('/data/youtube/snl/abc12345DEF-Hello_World.mp4') === 'abc12345DEF',
    'mixed case + 11 chars');
  assert(videoIdFromFilename('not-a-youtube-file.mp4') === null,
    'too short → null');
  assert(videoIdFromFilename('/x/dQw4w9WgXcQ-Rick_Astley.mp4') === 'dQw4w9WgXcQ',
    'classic 11-char id');
  assert(videoIdFromFilename(null) === null, 'null safe');
  assert(videoIdFromFilename('') === null, 'empty safe');
  assert(videoIdFromFilename('/x/cover.jpg') === null, 'no dash → null');

  console.log('\n--- videoIdFromEntry (with fake playlists) ---');
  const fakePlaylists = {
    list: () => [
      {
        slug: 'snl',
        videos: [
          { videoId: 'aaa111bbb22', downloadedPath: '/data/youtube/snl/aaa111bbb22-foo.mp4' },
          { videoId: 'ccc333ddd44', downloadedPath: null },
        ],
      },
      {
        slug: 'kimmel',
        videos: [
          { videoId: 'eee555fff66', downloadedPath: '/data/youtube/kimmel/eee555fff66-bar.mp4' },
        ],
      },
    ],
  };
  assert(videoIdFromEntry('/data/youtube/snl/aaa111bbb22-foo.mp4', { playlists: fakePlaylists }) === 'aaa111bbb22',
    'authoritative lookup via downloadedPath');
  assert(videoIdFromEntry('/data/youtube/kimmel/eee555fff66-bar.mp4', { playlists: fakePlaylists }) === 'eee555fff66',
    'second playlist also searched');

  console.log('\n--- videoIdFromEntry: filename fallback when DB misses ---');
  // file is named correctly but downloadedPath in DB is null
  assert(videoIdFromEntry('/data/youtube/snl/ccc333ddd44-fresh.mp4', { playlists: fakePlaylists }) === 'ccc333ddd44',
    'filename fallback when DB has null downloadedPath');
  // file not in DB at all
  assert(videoIdFromEntry('/data/youtube/snl/zzz999www88-orphan.mp4', { playlists: fakePlaylists }) === 'zzz999www88',
    'filename fallback when DB has no entry');

  console.log('\n--- thumbnailUrl ---');
  assert(thumbnailUrl('abc12345DEF') === 'https://i.ytimg.com/vi/abc12345DEF/hqdefault.jpg',
    'standard thumbnail URL');
  assert(thumbnailUrl(null) === null, 'null safe');
  assert(thumbnailUrl('') === null, 'empty safe');

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
