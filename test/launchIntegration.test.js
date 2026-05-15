#!/usr/bin/env node
/**
 * End-to-end-ish smoke test: every APL template loads as valid JSON, has
 * a mainTemplate, references the design tokens, and a full
 * LaunchHandler.handle() produces a response with non-empty speech, an
 * APL directive, all expected datasource properties populated.
 */
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function assert(c, m) { if (c) { console.log(`  ✓ ${m}`); passed++; } else { console.error(`  ✗ ${m}`); failed++; } }

function mockModule(modPath, exports) {
  require.cache[require.resolve(modPath)] = { exports };
}

(async () => {
  console.log('\n--- all APL templates load as valid JSON ---');
  const aplDir = path.join(__dirname, '..', 'skill', 'apl');
  for (const f of fs.readdirSync(aplDir)) {
    if (!f.endsWith('.json')) continue;
    try {
      const doc = JSON.parse(fs.readFileSync(path.join(aplDir, f), 'utf8'));
      assert(doc.type === 'APL' && doc.mainTemplate, `${f}: has type+mainTemplate`);
    } catch (e) {
      assert(false, `${f}: parse error ${e.message}`);
    }
  }

  console.log('\n--- design tokens propagated to all primary templates ---');
  // Each primary template must reference at least ONE design token. Specific
  // tokens vary by template (ChannelList doesn't use @accent because the
  // design is monochrome; NewsList uses @accent for the section accent).
  for (const f of ['LaunchTemplate.json', 'ChannelListTemplate.json', 'NewsListTemplate.json']) {
    const s = fs.readFileSync(path.join(aplDir, f), 'utf8');
    const usesAnyToken = /"@(accent|bgBase|bgCard|textPrimary|textMuted|textDim)"/.test(s);
    assert(usesAnyToken, `${f}: uses at least one design token`);
  }

  console.log('\n--- full LaunchHandler.handle() with queue + recent + news works ---');
  mockModule('../lib/mediathek', {
    searchCategorizedNews: async () => ({ sections: [{ title: 'Top', results: [
      { title: 'ZIB 17:00', channel: 'ORF1', duration: 600, timestamp: Date.now()/1000, url: 'http://x', imageUrl: '' },
    ] }] }),
  });
  mockModule('../lib/queue', {
    getInstance: () => ({
      peek: () => [{ id: 'q1', title: 'My Movie', source: 'local', contentId: 'filme/movie' }],
      count: () => 1,
    }),
  });
  mockModule('../lib/content/service', {
    isEnabled: () => true,
    getIndex: () => ({ all: () => [], findById: () => null }),
    getConfig: () => ({ paths: [] }),
  });
  mockModule('../lib/content/search', {
    findNewest: () => [{ id: 'serien/x/s1e1', pathLabel: 'Serien', type: 'episode', show: 'X', season: 1, episode: 1 }],
  });
  mockModule('../lib/channels', {
    findChannelById: (id) => ({ id, displayName: id.toUpperCase(), logoUrl: `http://logo/${id}.png` }),
    getLogoUrlForChannel: () => '',
  });
  mockModule('../lib/speechUtils', {
    formatResultForSpeech: (r, i) => `${i+1}. ${r.title}`,
    relativeTime: () => 'jetzt',
  });

  delete require.cache[require.resolve('../skill/handlers/LaunchHandler')];
  delete require.cache[require.resolve('../lib/aplHelper')];
  const LaunchHandler = require('../skill/handlers/LaunchHandler');

  const directives = [];
  const session = {};
  const hi = {
    requestEnvelope: {
      request: { type: 'LaunchRequest' },
      context: {
        System: { device: { supportedInterfaces: { 'VideoApp': {}, 'Alexa.Presentation.APL': {} } } },
      },
    },
    attributesManager: {
      getSessionAttributes: () => session,
      setSessionAttributes: (s) => Object.assign(session, s),
    },
    responseBuilder: {
      _speak: null, _reprompt: null, _shouldEndSession: null,
      speak(s) { this._speak = s; return this; },
      reprompt(s) { this._reprompt = s; return this; },
      withShouldEndSession(b) { this._shouldEndSession = b; return this; },
      addDirective(d) { directives.push(d); return this; },
      getResponse() {
        return { outputSpeech: { text: this._speak }, reprompt: this._reprompt,
          shouldEndSession: this._shouldEndSession, directives };
      },
    },
  };

  const resp = await LaunchHandler.handle(hi);
  assert(resp.outputSpeech.text && resp.outputSpeech.text.length > 0, 'speech non-empty');
  assert(resp.shouldEndSession === false, 'session open');
  const d = resp.directives.find(x => x.type === 'Alexa.Presentation.APL.RenderDocument');
  assert(d, 'has APL directive');
  const ld = d.datasources.launchData.properties;
  assert(ld.greeting && ld.greeting.priority === 'queue', `greeting=queue (got: ${ld.greeting && ld.greeting.priority})`);
  assert(ld.queue.length === 1, '1 queue item rendered');
  assert(ld.recentContent.length === 1, '1 recent item rendered');
  assert(ld.sections[0].results.length >= 1, '>=1 news result');
  assert(ld.voiceHint && ld.voiceHint.startsWith('Sag:'), 'voiceHint set');
  assert(ld.liveTVChannels.length === 3, '3 top channels');

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
