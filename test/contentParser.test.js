#!/usr/bin/env node
/**
 * content/parser test - filename -> structured metadata
 * Run: node test/contentParser.test.js
 */
const { parseContentFile } = require('../lib/content/parser');

let passed = 0, failed = 0;
function assert(c, m) { if (c) { console.log(`  ✓ ${m}`); passed++; } else { console.error(`  ✗ ${m}`); failed++; } }

console.log('\n--- TV episode patterns ---');
const e1 = parseContentFile('/content/tv/Better Call Saul/Season 4/S04E06 - Pinata.mkv', { type: 'episode', label: 'Serien', basePath: '/content/tv' });
assert(e1.type === 'episode', 'episode type detected');
assert(e1.show === 'Better Call Saul', `show extracted (got ${e1.show})`);
assert(e1.season === 4, 'season 4');
assert(e1.episode === 6, 'episode 6');

const e2 = parseContentFile('/content/tv/The.Americans.2013.S04E01.720p.HDTV.x264.mkv', { type: 'episode', label: 'Serien', basePath: '/content/tv' });
assert(e2.type === 'episode', 'episode type even when filename is flat');
assert(/Americans/.test(e2.show || ''), 'show contains "Americans"');
assert(e2.season === 4, 'season 4 from flat filename');
assert(e2.episode === 1, 'episode 1 from flat filename');

console.log('\n--- Movie patterns ---');
const m1 = parseContentFile('/content/movies/Inception (2010) [1080p].mp4', { type: 'movie', label: 'Filme', basePath: '/content/movies' });
assert(m1.type === 'movie', 'movie type detected');
assert(m1.title === 'Inception', `title "Inception" (got "${m1.title}")`);
assert(m1.year === 2010, 'year 2010');

const m2 = parseContentFile('/content/movies/2026/Dune Part Two.mp4', { type: 'movie', label: 'Filme', basePath: '/content/movies' });
assert(m2.type === 'movie', 'movie when no episode markers');
assert(/Dune/.test(m2.title), 'Dune title extracted');

console.log('\n--- type: auto ---');
const a1 = parseContentFile('/content/home/Some Show S01E01.mp4', { type: 'auto', label: 'Eigene', basePath: '/content/home' });
assert(a1.type === 'episode', 'auto picks episode when S01E01 present');

const a2 = parseContentFile('/content/home/Random clip.mp4', { type: 'auto', label: 'Eigene', basePath: '/content/home' });
assert(a2.type === 'movie', 'auto picks movie when no markers');
assert(/Random clip/.test(a2.title), 'plain filename becomes title');

console.log('\n--- Show fallback from directory ---');
const d1 = parseContentFile('/content/tv/Westworld/some-unparseable-file.mkv', { type: 'episode', label: 'Serien', basePath: '/content/tv' });
assert(d1.show === 'Westworld', 'directory becomes show fallback');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
