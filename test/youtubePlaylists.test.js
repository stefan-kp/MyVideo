#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Playlists, extractPlaylistId, sortByUploadDateDesc } = require('../lib/youtube/playlists');

let passed = 0, failed = 0;
function assert(c, m) { if (c) { console.log(`  ✓ ${m}`); passed++; } else { console.error(`  ✗ ${m}`); failed++; } }
function tmp() { return path.join(os.tmpdir(), `yt-pl.${Date.now()}.${Math.random()}.json`); }

(async () => {
  console.log('\n--- extractPlaylistId ---');
  assert(extractPlaylistId('https://www.youtube.com/playlist?list=PLrAXtmRdnEQy4Qt7gQ7r-ZGn0sxBl1F1q') === 'PLrAXtmRdnEQy4Qt7gQ7r-ZGn0sxBl1F1q', 'standard playlist URL');
  assert(extractPlaylistId('https://www.youtube.com/watch?v=abc&list=PLfoo') === 'PLfoo', 'watch URL with list');
  assert(extractPlaylistId('PLrAXtmRdnEQy4Qt7gQ7r-ZGn0sxBl1F1q') === 'PLrAXtmRdnEQy4Qt7gQ7r-ZGn0sxBl1F1q', 'bare playlist ID');
  assert(extractPlaylistId('https://youtu.be/abc') === null, 'video URL without list returns null');
  assert(extractPlaylistId('garbage') === null, 'garbage returns null');
  assert(extractPlaylistId('') === null, 'empty returns null');

  console.log('\n--- add + list ---');
  const p = new Playlists();
  p.file = tmp();
  const a = p.add({ url: 'https://www.youtube.com/playlist?list=PLfoo123abcdefghij', label: 'Jimmy Kimmel' });
  assert(p.list().length === 1, 'count 1');
  assert(a.id && a.id.length > 0, 'has id');
  assert(a.slug === 'jimmy-kimmel', `slug 'jimmy-kimmel' (got '${a.slug}')`);
  assert(a.playlistId === 'PLfoo123abcdefghij', 'playlistId extracted');
  assert(a.cleanupDays === 7, 'default cleanupDays 7');

  console.log('\n--- add validation ---');
  let err;
  try { p.add({ label: 'X' }); } catch (e) { err = e; }
  assert(err && /url/.test(err.message), 'rejects without url');

  try { p.add({ url: 'https://x.com/foo' }); } catch (e) { err = e; }
  assert(err && /label/.test(err.message), 'rejects without label');

  try { p.add({ url: 'https://x.com/foo', label: 'Bad URL' }); } catch (e) { err = e; }
  assert(err && /playlist ID/i.test(err.message), 'rejects URL without playlist ID');

  try { p.add({ url: 'PLfoo123abcdefghij', label: 'Dupe' }); } catch (e) { err = e; }
  assert(err && /already exists/.test(err.message), 'rejects duplicate playlist');

  console.log('\n--- unique slug ---');
  const b = p.add({ url: 'PLother9abcdefghij', label: 'Jimmy Kimmel' }); // same label
  assert(b.slug === 'jimmy-kimmel-2', `unique slug '${b.slug}'`);

  console.log('\n--- updateVideos preserves download state ---');
  p.updateVideos(a.id, [
    { videoId: 'v1', title: 'First', duration: 600, uploadDate: '20260514' },
    { videoId: 'v2', title: 'Second', duration: 1200, uploadDate: '20260513' },
  ]);
  assert(p.findById(a.id).videos.length === 2, '2 videos after crawl');
  p.markDownloaded(a.id, 'v1', '/data/youtube/jimmy-kimmel/v1.mp4');
  assert(p.findById(a.id).videos[0].downloaded === true, 'v1 downloaded');
  p.updateVideos(a.id, [
    { videoId: 'v1', title: 'First Updated', duration: 600, uploadDate: '20260514' },
    { videoId: 'v3', title: 'New One', duration: 900, uploadDate: '20260515' },
  ]);
  const upd = p.findById(a.id);
  assert(upd.videos.length === 2, 'still 2 videos');
  const v1Now = upd.videos.find(v => v.videoId === 'v1');
  assert(v1Now.downloaded === true, 'v1 download state preserved across crawl');
  assert(v1Now.title === 'First Updated', 'v1 title updated');
  const v3 = upd.videos.find(v => v.videoId === 'v3');
  assert(v3.downloaded === false, 'v3 is fresh, not downloaded');

  console.log('\n--- markRemoved ---');
  p.markRemoved(a.id, 'v1');
  assert(p.findById(a.id).videos.find(v => v.videoId === 'v1').downloaded === false, 'v1 marked not-downloaded');

  console.log('\n--- save + load roundtrip ---');
  const file = tmp();
  const ps = new Playlists();
  ps.file = file;
  ps.add({ url: 'PLsaveroundtrip123', label: 'Save Test' });
  ps.save();
  const pl = new Playlists();
  pl.load(file);
  assert(pl.list().length === 1, 'persisted count 1');
  assert(pl.list()[0].label === 'Save Test', 'persisted label intact');
  fs.unlinkSync(file);

  console.log('\n--- load missing file returns false ---');
  const pm = new Playlists();
  assert(pm.load('/nonexistent/foo.json') === false, 'load missing returns false');
  assert(pm.list().length === 0, 'count stays 0');

  console.log('\n--- remove ---');
  const pr = new Playlists();
  pr.file = tmp();
  const x = pr.add({ url: 'PLremovetest1234', label: 'Remove Me' });
  assert(pr.remove(x.id) === true, 'remove existing returns true');
  assert(pr.list().length === 0, 'count 0 after remove');
  assert(pr.remove('nope') === false, 'remove missing returns false');

  console.log('\n--- load(): re-sorts existing (pre-sort-feature) data ---');
  const oldFile = tmp();
  fs.writeFileSync(oldFile, JSON.stringify({
    version: 1,
    playlists: [{
      id: 'p1',
      label: 'Old',
      slug: 'old',
      playlistId: 'PLold',
      videos: [
        { videoId: 'oldest',  uploadDate: '20200101', title: 'Oldest' },
        { videoId: 'middle',  uploadDate: '20230101', title: 'Middle' },
        { videoId: 'newest',  uploadDate: '20260516', title: 'Newest' },
      ],
    }],
  }));
  const ploaded = new Playlists();
  ploaded.load(oldFile);
  const loadedVideos = ploaded.list()[0].videos;
  assert(loadedVideos.map(v => v.videoId).join(',') === 'newest,middle,oldest',
    `loaded + re-sorted (got: ${loadedVideos.map(v => v.videoId).join(',')})`);
  fs.unlinkSync(oldFile);

  console.log('\n--- sortByUploadDateDesc ---');
  const sorted = sortByUploadDateDesc([
    { videoId: 'a', uploadDate: '20240101' },
    { videoId: 'b', uploadDate: '20260514' },
    { videoId: 'c', uploadDate: '20250630' },
  ]);
  assert(sorted.map(v => v.videoId).join(',') === 'b,c,a',
    `newest first (got: ${sorted.map(v => v.videoId).join(',')})`);

  const withMissing = sortByUploadDateDesc([
    { videoId: 'old', uploadDate: '20200101' },
    { videoId: 'missing', uploadDate: '' },
    { videoId: 'new', uploadDate: '20260514' },
    { videoId: 'undef' },  // no uploadDate field at all
  ]);
  assert(withMissing.map(v => v.videoId).join(',') === 'new,old,missing,undef',
    `missing dates to end (got: ${withMissing.map(v => v.videoId).join(',')})`);

  // Verify input is not mutated
  const input = [{ videoId: 'a', uploadDate: '20200101' }, { videoId: 'b', uploadDate: '20260101' }];
  sortByUploadDateDesc(input);
  assert(input[0].videoId === 'a', 'sort does not mutate input');

  console.log('\n--- updateVideos persists sorted order (newest first) ---');
  const psort = new Playlists();
  psort.file = tmp();
  const psDemo = psort.add({ url: 'PLsortdemo12345678', label: 'Sort Demo' });
  // YouTube delivered in playlist order (typically old → new); we expect
  // it to be flipped on persistence.
  psort.updateVideos(psDemo.id, [
    { videoId: 'old',   uploadDate: '20240101', title: 'Old' },
    { videoId: 'mid',   uploadDate: '20250101', title: 'Mid' },
    { videoId: 'newest',uploadDate: '20260516', title: 'Newest' },
    { videoId: 'undated', uploadDate: '',       title: 'No date' },
  ]);
  const persisted = psort.findById(psDemo.id).videos;
  assert(persisted.map(v => v.videoId).join(',') === 'newest,mid,old,undated',
    `persisted order (got: ${persisted.map(v => v.videoId).join(',')})`);

  console.log('\n--- updateVideos: re-crawl preserves download flag on sorted items ---');
  psort.markDownloaded(psDemo.id, 'old', '/data/youtube/sort-demo/old.mp4');
  // Re-crawl with the same set + a newer one added
  psort.updateVideos(psDemo.id, [
    { videoId: 'old',     uploadDate: '20240101', title: 'Old' },
    { videoId: 'newest',  uploadDate: '20260516', title: 'Newest' },
    { videoId: 'reallynew', uploadDate: '20260520', title: 'Really new' },
  ]);
  const after = psort.findById(psDemo.id).videos;
  assert(after.map(v => v.videoId).join(',') === 'reallynew,newest,old',
    `re-crawl sorted (got: ${after.map(v => v.videoId).join(',')})`);
  const oldItem = after.find(v => v.videoId === 'old');
  assert(oldItem.downloaded === true, 'old still marked downloaded after re-crawl + re-sort');

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
