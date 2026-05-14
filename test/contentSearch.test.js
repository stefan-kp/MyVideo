#!/usr/bin/env node
const { searchLocal, findNewest, findExactEpisode, findLatestEpisode } = require('../lib/content/search');

let passed = 0, failed = 0;
function assert(c, m) { if (c) { console.log(`  ✓ ${m}`); passed++; } else { console.error(`  ✗ ${m}`); failed++; } }

const ENTRIES = [
  { id: 'serien/better-call-saul/s04e06', type: 'episode', show: 'Better Call Saul',
    season: 4, episode: 6, title: 'Pinata', pathLabel: 'Serien',
    mtime: '2026-04-20T00:00:00Z', filename: 'S04E06.mkv' },
  { id: 'serien/better-call-saul/s04e07', type: 'episode', show: 'Better Call Saul',
    season: 4, episode: 7, title: 'Something Stupid', pathLabel: 'Serien',
    mtime: '2026-04-27T00:00:00Z', filename: 'S04E07.mkv' },
  { id: 'serien/better-call-saul/s03e05', type: 'episode', show: 'Better Call Saul',
    season: 3, episode: 5, title: 'Old Stuff', pathLabel: 'Serien',
    mtime: '2025-12-01T00:00:00Z', filename: 'S03E05.mkv' },
  { id: 'filme/inception-2010', type: 'movie', title: 'Inception',
    year: 2010, pathLabel: 'Filme', mtime: '2026-05-01T00:00:00Z', filename: 'Inception.mp4' },
  { id: 'filme/tatort-2024', type: 'movie', title: 'Tatort - Im Schmerz geboren',
    year: 2024, pathLabel: 'Filme', mtime: '2026-04-26T00:00:00Z', filename: 'Tatort.mp4' },
];

console.log('\n--- searchLocal ---');
let res = searchLocal(ENTRIES, 'tatort');
assert(res.length === 1, 'finds Tatort');
assert(res[0].id === 'filme/tatort-2024', 'tatort id correct');

res = searchLocal(ENTRIES, 'Better Call Saul');
assert(res.length === 3, '3 BCS episodes');

res = searchLocal(ENTRIES, 'Saul');
assert(res.length === 3, 'partial show name match');

res = searchLocal(ENTRIES, 'pinata');
assert(res.length === 1 && res[0].title === 'Pinata', 'episode-title match');

res = searchLocal(ENTRIES, 'xyzdoesnotexist');
assert(res.length === 0, 'no results');

console.log('\n--- findNewest ---');
res = findNewest(ENTRIES, { limit: 10, uniquePerShow: false });
assert(res[0].mtime > res[1].mtime, 'sorted desc by mtime');

res = findNewest(ENTRIES, { limit: 10, uniquePerShow: true });
const bcsCount = res.filter(e => e.show === 'Better Call Saul').length;
assert(bcsCount === 1, 'uniquePerShow: only 1 BCS entry');
const bcsEntry = res.find(e => e.show === 'Better Call Saul');
assert(bcsEntry.episode === 7, 'newest BCS episode (S04E07)');

res = findNewest(ENTRIES, { label: 'Filme', limit: 10 });
assert(res.every(e => e.pathLabel === 'Filme'), 'label filter works');
assert(res.length === 2, '2 movies');

console.log('\n--- findNewest with newerThanDays filter ---');
const pathConfigs = [
  { label: 'Filme', newerThanDays: 5 },     // strict
  { label: 'Serien', newerThanDays: null }, // unrestricted
];
const now = new Date('2026-05-02T00:00:00Z');
res = findNewest(ENTRIES, { limit: 10, newerThanDaysOnly: true, pathConfigs, now });
const movieResults = res.filter(e => e.pathLabel === 'Filme');
assert(movieResults.length === 1, `5-day filter: only Inception (got ${movieResults.length})`);
assert(movieResults[0].id === 'filme/inception-2010', 'Inception is the new movie');

console.log('\n--- findExactEpisode ---');
const e = findExactEpisode(ENTRIES, 'better call saul', 4, 6);
assert(e && e.episode === 6, 'finds S04E06');

const nope = findExactEpisode(ENTRIES, 'better call saul', 4, 99);
assert(nope == null, 'returns null when missing');

console.log('\n--- findLatestEpisode ---');
const latest = findLatestEpisode(ENTRIES, 'better call saul');
assert(latest.season === 4 && latest.episode === 7, 'finds latest S04E07');

const latestNone = findLatestEpisode(ENTRIES, 'nothing here');
assert(latestNone == null, 'null when no show matches');

console.log('\n--- searchLocal: episodes sorted by season/episode asc ---');
let sorted = searchLocal(ENTRIES, 'Better Call Saul', { limit: 20 });
assert(sorted.length === 3, '3 BCS episodes');
assert(sorted[0].season === 3 && sorted[0].episode === 5, 'S03E05 first (oldest by season)');
assert(sorted[1].season === 4 && sorted[1].episode === 6, 'S04E06 second');
assert(sorted[2].season === 4 && sorted[2].episode === 7, 'S04E07 last');

console.log('\n--- searchLocal: SxxEyy filter ---');
let f = searchLocal(ENTRIES, 'Better Call Saul S04E06', { limit: 20 });
assert(f.length === 1 && f[0].episode === 6 && f[0].season === 4,
  'S04E06 filter narrows to single episode');

console.log('\n--- searchLocal: Sxx filter only (season) ---');
let s = searchLocal(ENTRIES, 'Better Call Saul S04', { limit: 20 });
assert(s.length === 2, 'S04 returns 2 episodes');
assert(s.every(e => e.season === 4), 'all season 4');

console.log('\n--- searchLocal: pure SxxEyy without show name ---');
let pure = searchLocal(ENTRIES, 's04e06', { limit: 20 });
assert(pure.length === 1 && pure[0].id === 'serien/better-call-saul/s04e06',
  'pure SxxEyy finds the matching episode across all shows');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
