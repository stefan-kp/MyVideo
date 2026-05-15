#!/usr/bin/env node
let passed = 0, failed = 0;
function assert(c, m) { if (c) { console.log(`  ✓ ${m}`); passed++; } else { console.error(`  ✗ ${m}`); failed++; } }

(async () => {
  const { getLogoFileForNewsChannel, getLogoUrlForNewsChannel } = require('../lib/newsChannelMapping');

  console.log('\n--- ORF variants ---');
  assert(getLogoFileForNewsChannel('ORF1') === 'orf1_hd.png', 'ORF1');
  assert(getLogoFileForNewsChannel('ORF 1') === 'orf1_hd.png', 'ORF 1 (with space)');
  assert(getLogoFileForNewsChannel('orf1') === 'orf1_hd.png', 'orf1 lowercase');
  assert(getLogoFileForNewsChannel('ORF2') === 'orf2o_hd.png', 'ORF2');
  assert(getLogoFileForNewsChannel('ORF 2') === 'orf2o_hd.png', 'ORF 2 (with space)');
  assert(getLogoFileForNewsChannel('ORFIII') === 'orf_iii_hd.png', 'ORFIII');
  assert(getLogoFileForNewsChannel('ORF III') === 'orf_iii_hd.png', 'ORF III');
  // ZIB without explicit channel → default ORF1
  assert(getLogoFileForNewsChannel('ZIB') === 'orf1_hd.png', 'ZIB defaults to ORF1');

  console.log('\n--- ARD/ZDF ---');
  assert(getLogoFileForNewsChannel('ARD') === 'das_erste_hd.png', 'ARD');
  assert(getLogoFileForNewsChannel('Das Erste') === 'das_erste_hd.png', 'Das Erste');
  assert(getLogoFileForNewsChannel('Tagesschau') === 'tagesschau24_hd.png', 'Tagesschau');
  assert(getLogoFileForNewsChannel('ZDF') === 'zdf_hd.png', 'ZDF');
  assert(getLogoFileForNewsChannel('ZDFheute') === 'zdf_hd.png', 'ZDFheute');
  assert(getLogoFileForNewsChannel('heute journal') === 'zdf_hd.png', 'heute journal');

  console.log('\n--- unknown defaults ---');
  assert(getLogoFileForNewsChannel('FooBar') === '_fallback_news.png', 'unknown -> fallback');
  assert(getLogoFileForNewsChannel('') === '_fallback_news.png', 'empty -> fallback');
  assert(getLogoFileForNewsChannel(null) === '_fallback_news.png', 'null -> fallback');

  console.log('\n--- url helper ---');
  process.env.BASE_URL = 'https://example.com';
  assert(getLogoUrlForNewsChannel('ZDF') === 'https://example.com/logos/zdf_hd.png',
    `URL composition (got: ${getLogoUrlForNewsChannel('ZDF')})`);
  delete process.env.BASE_URL;

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
