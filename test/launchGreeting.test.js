#!/usr/bin/env node
const { buildGreeting, pluralize } = require('../lib/launchGreeting');

let passed = 0, failed = 0;
function assert(c, m) { if (c) { console.log(`  ✓ ${m}`); passed++; } else { console.error(`  ✗ ${m}`); failed++; } }

(async () => {
  console.log('\n--- pluralize ---');
  assert(pluralize(1, 'Video', 'Videos') === 'ein Video', 'singular: ein Video');
  assert(pluralize(2, 'Video', 'Videos') === '2 Videos', 'plural: 2 Videos');
  assert(pluralize(0, 'Video', 'Videos') === '0 Videos', 'zero: 0 Videos');

  console.log('\n--- buildGreeting: queue >= 1 ---');
  let g = buildGreeting({ queueCount: 3, recentCount: 0, newsOk: true });
  assert(g.header === 'Du hast 3 Videos in deiner Queue.', `header (got: ${g.header})`);
  assert(/3 Videos in deiner Queue/.test(g.speak), 'speak mentions queue');
  assert(/Soll ich abspielen/.test(g.speak), 'speak asks to play');
  assert(g.reprompt === 'Soll ich die Queue starten?', 'reprompt is queue start');
  assert(g.priority === 'queue', `priority queue (got: ${g.priority})`);

  g = buildGreeting({ queueCount: 1, recentCount: 0, newsOk: true });
  assert(g.header === 'Du hast ein Video in deiner Queue.', `header singular (got: ${g.header})`);

  console.log('\n--- buildGreeting: queue 0, recent >=1, news ok ---');
  g = buildGreeting({ queueCount: 0, recentCount: 2, newsOk: true });
  assert(g.header === 'Was möchtest du sehen?', `header (got: ${g.header})`);
  assert(/2 neue Aufnahmen/.test(g.speak) || /neue Aufnahmen/.test(g.speak), 'speak mentions new recordings');
  assert(g.priority === 'recent', `priority recent (got: ${g.priority})`);

  console.log('\n--- buildGreeting: queue 0, recent 0, news ok ---');
  g = buildGreeting({ queueCount: 0, recentCount: 0, newsOk: true });
  assert(g.header === 'Aktuelle Nachrichten', `header (got: ${g.header})`);
  assert(/Aktuelle Nachrichten/.test(g.speak), 'speak mentions news');
  assert(g.priority === 'news', `priority news (got: ${g.priority})`);

  console.log('\n--- buildGreeting: news down ---');
  g = buildGreeting({ queueCount: 0, recentCount: 0, newsOk: false });
  assert(g.header === 'Live-TV verfügbar', `header (got: ${g.header})`);
  assert(/Mediathek/.test(g.speak) && /nicht erreichbar/.test(g.speak), 'speak explains mediathek down');
  assert(g.priority === 'liveTv', `priority liveTv (got: ${g.priority})`);

  console.log('\n--- buildGreeting: everything down ---');
  g = buildGreeting({ queueCount: 0, recentCount: 0, newsOk: false, liveTvOk: false });
  assert(g.header === 'Hallo.', `header (got: ${g.header})`);
  assert(/keine Inhalte/.test(g.speak), 'speak explains nothing available');
  assert(g.priority === 'empty', `priority empty (got: ${g.priority})`);

  console.log('\n--- buildGreeting: recent items but news down falls through to liveTv ---');
  g = buildGreeting({ queueCount: 0, recentCount: 3, newsOk: false });
  assert(g.priority === 'liveTv', `priority liveTv when news down (got: ${g.priority})`);
  assert(g.header === 'Live-TV verfügbar', `header (got: ${g.header})`);

  console.log('\n--- buildGreeting: null input is safe ---');
  g = buildGreeting(null);
  assert(g.priority === 'news', `null input -> news default (got: ${g.priority})`);
  g = buildGreeting();
  assert(g.priority === 'news', `undefined input -> news default (got: ${g.priority})`);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
