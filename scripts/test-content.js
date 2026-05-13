#!/usr/bin/env node
/**
 * Manual integration test for the local content feature.
 *
 *   node scripts/test-content.js scan        # full re-scan, print summary
 *   node scripts/test-content.js search <q>  # voice-search test
 *   node scripts/test-content.js play <id>   # resolve stream URL
 *   node scripts/test-content.js list        # list all entries
 */
require('dotenv').config();
const path = require('path');
const contentService = require('../lib/content/service');
const { searchLocal, findNewest } = require('../lib/content/search');

async function main() {
  const cmd = process.argv[2];
  const arg = process.argv.slice(3).join(' ');
  if (!cmd) {
    console.error('Usage: node scripts/test-content.js <scan|search <q>|play <id>|list|newest>');
    process.exit(1);
  }

  const configPath = process.env.CONTENT_CONFIG_PATH ||
    path.join(__dirname, '..', 'config', 'content-paths.json');
  const ok = await contentService.init({ configPath });
  if (!ok) {
    console.error('Content service not enabled. Create config/content-paths.json first.');
    process.exit(1);
  }
  // Wait briefly for the startup rescan to settle
  await new Promise(r => setTimeout(r, 100));

  if (cmd === 'scan') {
    const result = await contentService.rescan();
    console.log(JSON.stringify(result, null, 2));
  } else if (cmd === 'list') {
    const entries = contentService.getIndex().all();
    for (const e of entries.slice(0, 50)) {
      const ep = e.type === 'episode' ? `${e.show} S${String(e.season||0).padStart(2,'0')}E${String(e.episode||0).padStart(2,'0')}` : '';
      console.log(`${e.id.padEnd(50)} ${e.type.padEnd(7)} ${ep || e.title}`);
    }
    console.log(`...${entries.length} entries total`);
  } else if (cmd === 'newest') {
    const newest = findNewest(contentService.getIndex().all(), { limit: 15, uniquePerShow: true });
    for (const e of newest) console.log(`${e.mtime.slice(0,10)} ${e.pathLabel.padEnd(8)} ${e.show || e.title}`);
  } else if (cmd === 'search') {
    if (!arg) { console.error('Need query'); process.exit(1); }
    const hits = searchLocal(contentService.getIndex().all(), arg, { limit: 10 });
    for (const e of hits) {
      console.log(`${e.id}  ${e.type === 'episode' ? `${e.show} S${e.season}E${e.episode} - ${e.title}` : e.title}`);
    }
    console.log(`${hits.length} hit(s) for "${arg}"`);
  } else if (cmd === 'play') {
    if (!arg) { console.error('Need id'); process.exit(1); }
    const contentSource = require('../lib/content/contentSource');
    const stream = await contentSource.resolveStream(arg);
    console.log('URL:', stream.url);
    console.log('MIME:', stream.mimeType);
  } else {
    console.error(`Unknown command: ${cmd}`);
    process.exit(1);
  }
  contentService.shutdown();
}
main().catch(err => { console.error(err); process.exit(1); });
