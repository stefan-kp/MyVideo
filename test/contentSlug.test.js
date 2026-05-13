#!/usr/bin/env node
const { makeSlug, slugify } = require('../lib/content/slug');

let passed = 0, failed = 0;
function assert(c, m) { if (c) { console.log(`  ✓ ${m}`); passed++; } else { console.error(`  ✗ ${m}`); failed++; } }

console.log('\n--- slugify ---');
assert(slugify('Better Call Saul') === 'better-call-saul', 'spaces to dashes');
assert(slugify('Ärger mit Müll!') === 'aerger-mit-muell', 'umlauts');
assert(slugify('  Multiple   spaces  ') === 'multiple-spaces', 'collapse whitespace');
assert(slugify('a.b.c') === 'a-b-c', 'dots become dashes');
assert(slugify('Already-Slug') === 'already-slug', 'idempotent-ish');

console.log('\n--- makeSlug for movie ---');
const s1 = makeSlug({ pathLabel: 'Filme', type: 'movie', title: 'Inception', year: 2010 }, new Set());
assert(s1 === 'filme/inception-2010', `movie slug (got ${s1})`);

const s2 = makeSlug({ pathLabel: 'Filme', type: 'movie', title: 'Dune Part Two', year: null }, new Set());
assert(s2 === 'filme/dune-part-two', 'movie without year');

console.log('\n--- makeSlug for episode ---');
const e1 = makeSlug({
  pathLabel: 'Serien', type: 'episode',
  show: 'Better Call Saul', season: 4, episode: 6, title: 'Pinata',
}, new Set());
assert(e1 === 'serien/better-call-saul/s04e06-pinata', `episode slug (got ${e1})`);

console.log('\n--- Collision adds hash suffix ---');
const taken = new Set(['filme/inception-2010']);
const collision = makeSlug({ pathLabel: 'Filme', type: 'movie', title: 'Inception', year: 2010, path: '/content/movies/dupe/Inception.mp4' }, taken);
assert(collision !== 'filme/inception-2010', 'differs from existing');
assert(collision.startsWith('filme/inception-2010-'), 'has hash suffix');
assert(collision.length === 'filme/inception-2010-'.length + 8, '8-char hash');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
