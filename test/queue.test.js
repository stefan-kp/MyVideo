#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Queue, getInstance, _resetForTest } = require('../lib/queue');

let passed = 0, failed = 0;
function assert(c, m) { if (c) { console.log(`  ✓ ${m}`); passed++; } else { console.error(`  ✗ ${m}`); failed++; } }

function tmpFile() {
  return path.join(os.tmpdir(), `queue.${Date.now()}.${Math.random()}.json`);
}

(async () => {
  console.log('\n--- add + list ---');
  const q = new Queue();
  q.file = tmpFile();
  const a = q.add({ source: 'local', contentId: 'filme/a', title: 'A' });
  const b = q.add({ source: 'mediathek', url: 'https://x/b', title: 'B' });
  assert(q.count() === 2, 'count 2');
  assert(a.id && a.id.length > 0, 'a has id');
  assert(a.id !== b.id, 'unique ids');
  assert(typeof a.addedAt === 'string', 'addedAt set');

  console.log('\n--- add validation ---');
  let err;
  try { q.add({}); } catch (e) { err = e; }
  assert(err && /title/.test(err.message), 'rejects without title');

  try { q.add({ title: 'X', source: 'bad' }); } catch (e) { err = e; }
  assert(err && /source/.test(err.message), 'rejects bad source');

  try { q.add({ title: 'X', source: 'local' }); } catch (e) { err = e; }
  assert(err && /contentId/.test(err.message), 'rejects local without contentId');

  try { q.add({ title: 'X', source: 'mediathek' }); } catch (e) { err = e; }
  assert(err && /url/.test(err.message), 'rejects mediathek without url');

  console.log('\n--- remove ---');
  assert(q.remove(a.id) === true, 'remove existing returns true');
  assert(q.count() === 1, 'count 1 after remove');
  assert(q.remove('nope') === false, 'remove missing returns false');

  console.log('\n--- reorder ---');
  const q2 = new Queue();
  q2.file = tmpFile();
  const i1 = q2.add({ source: 'local', contentId: 'a', title: 'A' });
  const i2 = q2.add({ source: 'local', contentId: 'b', title: 'B' });
  const i3 = q2.add({ source: 'local', contentId: 'c', title: 'C' });
  assert(q2.reorder(i2.id, 'up') === true, 'up i2');
  assert(q2.list()[0].id === i2.id, 'i2 now first');
  assert(q2.reorder(i1.id, 'down') === true, 'down i1');
  assert(q2.list()[2].id === i1.id, 'i1 now last');
  assert(q2.reorder(q2.list()[0].id, 'up') === false, 'cannot reorder up past start');
  assert(q2.reorder(q2.list()[2].id, 'down') === false, 'cannot reorder down past end');

  console.log('\n--- pop + peek ---');
  const q3 = new Queue();
  q3.file = tmpFile();
  q3.add({ source: 'local', contentId: 'a', title: 'A' });
  q3.add({ source: 'local', contentId: 'b', title: 'B' });
  const peeked = q3.peek(2);
  assert(peeked.length === 2 && peeked[0].title === 'A', 'peek 2 items');
  assert(q3.count() === 2, 'peek does not mutate');
  const popped = q3.pop();
  assert(popped.title === 'A', 'pop returns first item');
  assert(q3.count() === 1, 'pop removes');
  q3.pop();
  assert(q3.pop() === null, 'pop empty returns null');

  console.log('\n--- save + load roundtrip ---');
  const file = tmpFile();
  const qs = new Queue();
  qs.file = file;
  qs.add({ source: 'local', contentId: 'x', title: 'X' });
  qs.save();
  const ql = new Queue();
  const ok = ql.load(file);
  assert(ok === true, 'load returns true on success');
  assert(ql.count() === 1, 'persisted count 1');
  assert(ql.list()[0].title === 'X', 'persisted item intact');
  fs.unlinkSync(file);

  console.log('\n--- load missing returns false ---');
  const qm = new Queue();
  const okm = qm.load('/nonexistent/missing.json');
  assert(okm === false, 'load missing returns false');
  assert(qm.count() === 0, 'count stays 0');

  console.log('\n--- clear ---');
  const qc = new Queue();
  qc.file = tmpFile();
  qc.add({ source: 'local', contentId: 'x', title: 'X' });
  qc.clear();
  assert(qc.count() === 0, 'clear empties');

  console.log('\n--- getInstance singleton ---');
  _resetForTest();
  const f = tmpFile();
  process.env.QUEUE_FILE = f;
  const inst1 = getInstance();
  const inst2 = getInstance();
  assert(inst1 === inst2, 'getInstance returns same instance');
  delete process.env.QUEUE_FILE;
  _resetForTest();

  console.log('\n--- deduplication: same local contentId twice rejected ---');
  const qd = new Queue();
  qd.file = tmpFile();
  qd.add({ source: 'local', contentId: 'movie/a', title: 'A' });
  let dupErr = null;
  try {
    qd.add({ source: 'local', contentId: 'movie/a', title: 'A again' });
  } catch (e) { dupErr = e; }
  assert(dupErr && dupErr.code === 'DUPLICATE', `dup error has code (got: ${dupErr && dupErr.code})`);
  assert(dupErr && dupErr.existingId, 'dup error has existingId');
  assert(qd.count() === 1, 'queue still has 1 item');

  console.log('\n--- deduplication: same mediathek url twice rejected ---');
  const qd2 = new Queue();
  qd2.file = tmpFile();
  qd2.add({ source: 'mediathek', url: 'http://x/a.m3u8', title: 'A' });
  let dupErr2 = null;
  try {
    qd2.add({ source: 'mediathek', url: 'http://x/a.m3u8', title: 'A again' });
  } catch (e) { dupErr2 = e; }
  assert(dupErr2 && dupErr2.code === 'DUPLICATE', 'mediathek dup rejected');
  assert(qd2.count() === 1, 'queue still has 1 item');

  console.log('\n--- deduplication: different sources do not collide ---');
  const qd3 = new Queue();
  qd3.file = tmpFile();
  qd3.add({ source: 'local', contentId: 'movie/a', title: 'Local A' });
  qd3.add({ source: 'mediathek', url: 'http://x/movie-a.m3u8', title: 'Mediathek A' });
  assert(qd3.count() === 2, 'different sources OK');

  console.log('\n--- youtube_pending source: needs youtubeUrl ---');
  const qy = new Queue();
  qy.file = tmpFile();
  let ytErr = null;
  try { qy.add({ source: 'youtube_pending', title: 'X' }); } catch (e) { ytErr = e; }
  assert(ytErr && /youtubeUrl/.test(ytErr.message), 'requires youtubeUrl');
  const yt1 = qy.add({ source: 'youtube_pending', youtubeUrl: 'https://youtu.be/abc123', title: 'YT 1', status: 'downloading' });
  assert(yt1.status === 'downloading', 'status preserved');
  assert(yt1.youtubeUrl === 'https://youtu.be/abc123', 'youtubeUrl preserved');

  console.log('\n--- youtube_pending dedup by youtubeUrl ---');
  let dupYt = null;
  try {
    qy.add({ source: 'youtube_pending', youtubeUrl: 'https://youtu.be/abc123', title: 'YT 1 again' });
  } catch (e) { dupYt = e; }
  assert(dupYt && dupYt.code === 'DUPLICATE', 'yt dup rejected');

  console.log('\n--- update() patches an item in place ---');
  const updated = qy.update(yt1.id, { status: 'ready', source: 'local', contentId: 'youtube/foo/abc123' });
  assert(updated && updated.status === 'ready', 'status flipped to ready');
  assert(updated.source === 'local', 'source flipped to local');
  assert(updated.contentId === 'youtube/foo/abc123', 'contentId set');
  assert(qy.update('nonexistent-id', { status: 'x' }) === null, 'unknown id returns null');

  console.log('\n--- default status is ready ---');
  const qDefault = new Queue();
  qDefault.file = tmpFile();
  const d = qDefault.add({ source: 'mediathek', url: 'http://x/d.m3u8', title: 'D' });
  assert(d.status === 'ready', 'default status ready');

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
