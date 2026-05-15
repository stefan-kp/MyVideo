#!/usr/bin/env node
/**
 * LaunchHandler integration: builds correct response for each greeting state.
 * Mocks mediathek, queue, content service, channels-registry deps via require.cache.
 */
const path = require('path');

let passed = 0, failed = 0;
function assert(c, m) { if (c) { console.log(`  ✓ ${m}`); passed++; } else { console.error(`  ✗ ${m}`); failed++; } }

function mockModule(modPath, exports) {
  require.cache[require.resolve(modPath)] = { exports };
}

// Helper to build a fake handlerInput
function makeHandlerInput({ supportsVideo = true, supportsAPL = true } = {}) {
  const directives = [];
  const session = {};
  return {
    requestEnvelope: {
      request: { type: 'LaunchRequest' },
      context: {
        System: {
          device: {
            supportedInterfaces: {
              ...(supportsVideo ? { VideoApp: {} } : {}),
              ...(supportsAPL ? { 'Alexa.Presentation.APL': {} } : {}),
            },
          },
        },
      },
    },
    attributesManager: {
      getSessionAttributes: () => session,
      setSessionAttributes: (s) => Object.assign(session, s),
    },
    responseBuilder: {
      _speak: null, _reprompt: null, _shouldEndSession: null, _directives: directives,
      speak(s) { this._speak = s; return this; },
      reprompt(s) { this._reprompt = s; return this; },
      withShouldEndSession(b) { this._shouldEndSession = b; return this; },
      addDirective(d) { directives.push(d); return this; },
      getResponse() {
        return {
          outputSpeech: { text: this._speak },
          reprompt: this._reprompt,
          shouldEndSession: this._shouldEndSession,
          directives,
        };
      },
    },
  };
}

(async () => {
  // Mock all dependencies BEFORE requiring LaunchHandler.
  mockModule('../lib/mediathek', {
    searchCategorizedNews: async () => ({ sections: [{ title: 'Top', results: [
      { title: 'ZIB 17:00', channel: 'ORF1', duration: 600, timestamp: Date.now()/1000, url: 'http://x', imageUrl: '' },
    ] }] }),
  });
  mockModule('../lib/queue', {
    getInstance: () => ({
      peek: (n) => [], // empty by default — overridden per test
      count: () => 0,
    }),
  });
  mockModule('../lib/content/service', {
    isEnabled: () => false,
    getIndex: () => ({ all: () => [] }),
    getConfig: () => ({ paths: [] }),
  });
  mockModule('../lib/content/search', { findNewest: () => [] });
  mockModule('../lib/channels', {
    findChannelById: (id) => ({ id, displayName: id.toUpperCase(), logoUrl: `http://logo/${id}.png` }),
    getLogoUrlForChannel: () => '',
  });
  mockModule('../lib/speechUtils', {
    formatResultForSpeech: (r, i) => `${i+1}. ${r.title}`,
    relativeTime: () => 'jetzt',
  });

  console.log('\n--- LaunchHandler: queue empty, news ok ---');
  // Reset module cache for LaunchHandler & aplHelper so they pick up new mocks.
  delete require.cache[require.resolve('../skill/handlers/LaunchHandler')];
  delete require.cache[require.resolve('../lib/aplHelper')];
  const LaunchHandler1 = require('../skill/handlers/LaunchHandler');
  let hi = makeHandlerInput();
  let resp = await LaunchHandler1.handle(hi);
  assert(resp.shouldEndSession === false, 'shouldEndSession=false');
  assert(/Nachrichten|Sender|sehen/i.test(resp.outputSpeech.text),
    `news-state speech (got: ${resp.outputSpeech.text})`);
  const directive = resp.directives.find(d => d.type === 'Alexa.Presentation.APL.RenderDocument');
  assert(directive, 'has APL directive');
  assert(directive.datasources.launchData.properties.greeting, 'has greeting object in datasource');
  assert(directive.datasources.launchData.properties.greeting.priority === 'news',
    `priority news (got: ${directive.datasources.launchData.properties.greeting.priority})`);

  console.log('\n--- LaunchHandler: queue with 2 items ---');
  mockModule('../lib/queue', {
    getInstance: () => ({
      peek: () => [
        { id: 'a', title: 'Video A', subtitle: 'Lokal', source: 'local' },
        { id: 'b', title: 'Video B', subtitle: 'YouTube', source: 'local' },
      ],
      count: () => 2,
    }),
  });
  delete require.cache[require.resolve('../skill/handlers/LaunchHandler')];
  const LaunchHandler2 = require('../skill/handlers/LaunchHandler');
  hi = makeHandlerInput();
  resp = await LaunchHandler2.handle(hi);
  const d2 = resp.directives.find(d => d.type === 'Alexa.Presentation.APL.RenderDocument');
  assert(d2.datasources.launchData.properties.greeting.priority === 'queue',
    `priority queue (got: ${d2.datasources.launchData.properties.greeting.priority})`);
  assert(/2 Videos/.test(d2.datasources.launchData.properties.greeting.header),
    `header has count (got: ${d2.datasources.launchData.properties.greeting.header})`);

  console.log('\n--- LaunchHandler: mediathek down ---');
  mockModule('../lib/mediathek', {
    searchCategorizedNews: async () => { throw new Error('ECONNREFUSED'); },
  });
  mockModule('../lib/queue', {
    getInstance: () => ({ peek: () => [], count: () => 0 }),
  });
  delete require.cache[require.resolve('../skill/handlers/LaunchHandler')];
  const LaunchHandler3 = require('../skill/handlers/LaunchHandler');
  hi = makeHandlerInput();
  resp = await LaunchHandler3.handle(hi);
  assert(/Mediathek|Sender/i.test(resp.outputSpeech.text), 'speech mentions mediathek/sender');
  assert(resp.shouldEndSession === false, 'session stays open on error');

  console.log('\n--- LaunchHandler: liveTVChannels uses top-3 ---');
  process.env.LAUNCH_COUNTRY = 'AT';
  mockModule('../lib/mediathek', {
    searchCategorizedNews: async () => ({ sections: [{ title: 'Top', results: [] }] }),
  });
  delete require.cache[require.resolve('../skill/handlers/LaunchHandler')];
  delete require.cache[require.resolve('../lib/launchChannels')];
  const LaunchHandler4 = require('../skill/handlers/LaunchHandler');
  hi = makeHandlerInput();
  resp = await LaunchHandler4.handle(hi);
  const d4 = resp.directives.find(d => d.type === 'Alexa.Presentation.APL.RenderDocument');
  assert(d4.datasources.launchData.properties.liveTVChannels.length === 3,
    `liveTVChannels has 3 (got: ${d4.datasources.launchData.properties.liveTVChannels.length})`);
  assert(d4.datasources.launchData.properties.liveTVChannels[0].id === 'orf1',
    'first channel is orf1 (AT default)');
  delete process.env.LAUNCH_COUNTRY;

  console.log('\n--- LaunchHandler: news items get logo URLs from newsChannelMapping ---');
  mockModule('../lib/mediathek', {
    searchCategorizedNews: async () => ({ sections: [{ title: 'Top', results: [
      { title: 'Heute Journal', channel: 'ZDF', duration: 1200, timestamp: Date.now()/1000, url: 'http://x', imageUrl: '' },
    ] }] }),
  });
  mockModule('../lib/queue', { getInstance: () => ({ peek: () => [], count: () => 0 }) });
  process.env.BASE_URL = 'http://test.local';
  delete require.cache[require.resolve('../skill/handlers/LaunchHandler')];
  delete require.cache[require.resolve('../lib/newsChannelMapping')];
  delete require.cache[require.resolve('../lib/aplHelper')];
  const LH5 = require('../skill/handlers/LaunchHandler');
  hi = makeHandlerInput();
  resp = await LH5.handle(hi);
  const d5 = resp.directives.find(d => d.type === 'Alexa.Presentation.APL.RenderDocument');
  const newsResults = d5.datasources.launchData.properties.sections[0].results;
  assert(newsResults.length === 1, '1 news item');
  assert(newsResults[0].logo && newsResults[0].logo.includes('zdf_hd.png'),
    `zdf logo (got: ${newsResults[0].logo})`);
  delete process.env.BASE_URL;

  console.log('\n--- LaunchHandler: local content gets poster URL ---');
  mockModule('../lib/content/service', {
    isEnabled: () => true,
    getIndex: () => ({ all: () => [{ id: 'show/s1/ep', path: '/x/ep.mp4', pathLabel: 'Serien', type: 'episode', show: 'X', season: 1, episode: 1 }] }),
    getConfig: () => ({ paths: [] }),
  });
  mockModule('../lib/content/search', {
    findNewest: () => [{ id: 'show/s1/ep', pathLabel: 'Serien', type: 'episode', show: 'X', season: 1, episode: 1 }],
  });
  process.env.BASE_URL = 'http://test.local';
  delete require.cache[require.resolve('../skill/handlers/LaunchHandler')];
  delete require.cache[require.resolve('../lib/aplHelper')];
  const LH6 = require('../skill/handlers/LaunchHandler');
  hi = makeHandlerInput();
  resp = await LH6.handle(hi);
  const d6 = resp.directives.find(d => d.type === 'Alexa.Presentation.APL.RenderDocument');
  const local = d6.datasources.launchData.properties.recentContent;
  assert(local.length === 1, '1 local entry');
  assert(local[0].imageUrl && local[0].imageUrl.includes('show/s1/ep/poster.jpg'),
    `poster URL (got: ${local[0].imageUrl})`);
  delete process.env.BASE_URL;

  console.log('\n--- LaunchHandler: voiceHint is one of the rotation pool ---');
  // Reuse the empty-queue, news-ok scenario for a clean state.
  mockModule('../lib/queue', { getInstance: () => ({ peek: () => [], count: () => 0 }) });
  mockModule('../lib/mediathek', { searchCategorizedNews: async () => ({ sections: [{ title: 'Top', results: [] }] }) });
  delete require.cache[require.resolve('../skill/handlers/LaunchHandler')];
  const LH7 = require('../skill/handlers/LaunchHandler');
  hi = makeHandlerInput();
  resp = await LH7.handle(hi);
  const d7 = resp.directives.find(d => d.type === 'Alexa.Presentation.APL.RenderDocument');
  const hint = d7.datasources.launchData.properties.voiceHint;
  assert(typeof hint === 'string' && hint.startsWith('Sag:'),
    `hint starts with 'Sag:' (got: ${hint})`);
  // Sample 10 times and verify we see at least 2 distinct hints (rotation works).
  const sampledHints = new Set();
  for (let i = 0; i < 30; i++) {
    delete require.cache[require.resolve('../skill/handlers/LaunchHandler')];
    const LH = require('../skill/handlers/LaunchHandler');
    const r = await LH.handle(makeHandlerInput());
    const d = r.directives.find(x => x.type === 'Alexa.Presentation.APL.RenderDocument');
    sampledHints.add(d.datasources.launchData.properties.voiceHint);
  }
  assert(sampledHints.size >= 2,
    `rotation produces >=2 distinct hints in 30 samples (got: ${sampledHints.size}, hints: ${[...sampledHints].join(' | ')})`);

  console.log('\n--- LaunchTemplate.json: valid, binds greeting.header, no right-column block ---');
  const fs = require('fs');
  const tpl = JSON.parse(fs.readFileSync(require('path').join(__dirname, '..', 'skill', 'apl', 'LaunchTemplate.json'), 'utf8'));
  assert(tpl.type === 'APL', 'is APL document');
  const tplStr = JSON.stringify(tpl);
  assert(tplStr.includes('launchData.properties.greeting.header'), 'template binds greeting.header');
  assert(!tplStr.includes('width":"35%"') && !tplStr.includes('width": "35%"'), 'right-column 35% block removed');
  assert(!tplStr.includes('width":"65%"') && !tplStr.includes('width": "65%"'), 'left-column 65% block removed (now 100%)');
  assert(!tplStr.includes('launchData.properties.title'), 'old hardcoded title binding removed');
  assert(!tplStr.includes('launchData.properties.categories'), 'old categories binding removed');
  assert(!tplStr.includes('launchData.properties.logoUrl'), 'old logoUrl binding removed');

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
