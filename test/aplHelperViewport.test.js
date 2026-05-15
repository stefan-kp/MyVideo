#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function assert(c, m) { if (c) { console.log(`  ✓ ${m}`); passed++; } else { console.error(`  ✗ ${m}`); failed++; } }

(async () => {
  console.log('\n--- LaunchTemplate has @hubLandscapeSmall conditional ---');
  const tpl = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'skill', 'apl', 'LaunchTemplate.json'), 'utf8'));
  const s = JSON.stringify(tpl);
  assert(s.includes('@hubLandscapeSmall'), 'template references @hubLandscapeSmall');

  // mainTemplate.items should now contain TWO containers (one per viewport profile).
  const items = tpl.mainTemplate.items;
  assert(Array.isArray(items) && items.length >= 2,
    `mainTemplate has at least 2 items for conditional layouts (got ${items.length})`);
  assert(items.some(i => i.when && i.when.includes('hubLandscapeSmall')), 'one item gated on hubLandscapeSmall');

  console.log('\n--- Show-5 variant uses vertical ScrollView ---');
  const small = items.find(i => i.when && i.when.includes('== @hubLandscapeSmall'));
  assert(small, 'small-viewport variant exists');
  const smallStr = JSON.stringify(small);
  assert(smallStr.includes('ScrollView') || smallStr.includes('Sequence'),
    'small variant uses ScrollView or Sequence');

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
