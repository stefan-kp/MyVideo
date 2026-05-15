#!/usr/bin/env node
let passed = 0, failed = 0;
function assert(c, m) { if (c) { console.log(`  ✓ ${m}`); passed++; } else { console.error(`  ✗ ${m}`); failed++; } }

(async () => {
  console.log('\n--- renderLaunchScreen populates voiceHint ---');
  const directives = [];
  const handlerInput = {
    requestEnvelope: { context: { System: { device: { supportedInterfaces: { 'Alexa.Presentation.APL': {} } } } } },
    responseBuilder: { addDirective: (d) => directives.push(d) },
  };
  const { renderLaunchScreen } = require('../lib/aplHelper');
  renderLaunchScreen(handlerInput, {
    sections: [{ title: 'X', results: [] }],
    greeting: { header: 'h', speak: 's', priority: 'news' },
    liveTVChannels: [{ id: 'orf1', name: 'ORF 1', logo: '' }],
    recentContent: [],
    queue: [],
    voiceHint: 'Sag: Tagesschau, Queue, ORF1',
  });
  const launchData = directives[0].datasources.launchData.properties;
  assert(launchData.voiceHint === 'Sag: Tagesschau, Queue, ORF1',
    `voiceHint set (got: ${launchData.voiceHint})`);
  assert(Array.isArray(launchData.liveTVChannels) && launchData.liveTVChannels.length === 1, '1 channel');

  console.log('\n--- renderLaunchScreen defaults voiceHint to a sensible value ---');
  const directives2 = [];
  const hi2 = {
    requestEnvelope: { context: { System: { device: { supportedInterfaces: { 'Alexa.Presentation.APL': {} } } } } },
    responseBuilder: { addDirective: (d) => directives2.push(d) },
  };
  renderLaunchScreen(hi2, {
    sections: [], greeting: { header: 'h', speak: 's', priority: 'news' },
    liveTVChannels: [], recentContent: [], queue: [],
  });
  const ld2 = directives2[0].datasources.launchData.properties;
  assert(typeof ld2.voiceHint === 'string' && ld2.voiceHint.length > 0, 'voiceHint has a default');

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
