#!/usr/bin/env node
/**
 * Tests LaunchQueueYesHandler + LaunchQueueNoHandler routing.
 *
 * Scenario: LaunchHandler set pendingAction='play_queue' because the
 * queue was non-empty. A subsequent AMAZON.YesIntent should match
 * LaunchQueueYesHandler and delegate to PlayQueueHandler.
 */
const path = require('path');

let passed = 0, failed = 0;
function assert(c, m) { if (c) { console.log(`  ✓ ${m}`); passed++; } else { console.error(`  ✗ ${m}`); failed++; } }

function mockModule(modPath, exports) {
  require.cache[require.resolve(modPath)] = { exports };
}

function makeYesIntentInput(session = {}) {
  return {
    requestEnvelope: {
      request: { type: 'IntentRequest', intent: { name: 'AMAZON.YesIntent' } },
    },
    attributesManager: {
      getSessionAttributes: () => session,
      setSessionAttributes: (s) => Object.assign(session, s),
    },
    responseBuilder: {
      _speak: null, _reprompt: null, _shouldEndSession: null, _directives: [],
      speak(s) { this._speak = s; return this; },
      reprompt(s) { this._reprompt = s; return this; },
      withShouldEndSession(b) { this._shouldEndSession = b; return this; },
      addDirective(d) { this._directives.push(d); return this; },
      addVideoAppLaunchDirective(url, title, subtitle) {
        this._directives.push({ type: 'VideoApp.Launch', url, title, subtitle });
        return this;
      },
      getResponse() {
        return {
          outputSpeech: { text: this._speak },
          reprompt: this._reprompt,
          shouldEndSession: this._shouldEndSession,
          directives: this._directives,
        };
      },
    },
  };
}

function makeNoIntentInput(session = {}) {
  const hi = makeYesIntentInput(session);
  hi.requestEnvelope.request.intent.name = 'AMAZON.NoIntent';
  return hi;
}

(async () => {
  // Mock queue with one item, mock content-source
  mockModule('../lib/queue', {
    getInstance: () => ({
      pop: () => ({ id: 'q1', title: 'Test Video', source: 'mediathek', url: 'http://x/test.m3u8', subtitle: 'Mediathek' }),
      peek: () => [],
      count: () => 0,
    }),
  });
  mockModule('../lib/content/contentSource', {
    resolveStream: async () => ({ url: 'http://x/test.m3u8', mimeType: 'application/vnd.apple.mpegurl' }),
  });

  delete require.cache[require.resolve('../skill/handlers/PlayQueueHandler')];
  delete require.cache[require.resolve('../skill/handlers/LaunchQueueYesHandler')];
  const { LaunchQueueYesHandler, LaunchQueueNoHandler } = require('../skill/handlers/LaunchQueueYesHandler');

  console.log('\n--- LaunchQueueYesHandler: canHandle requires pendingAction=play_queue ---');
  assert(!LaunchQueueYesHandler.canHandle(makeYesIntentInput({})), 'no pendingAction -> no match');
  assert(!LaunchQueueYesHandler.canHandle(makeYesIntentInput({ pendingAction: 'summary_wait' })),
    'wrong pendingAction -> no match');
  assert(LaunchQueueYesHandler.canHandle(makeYesIntentInput({ pendingAction: 'play_queue' })),
    'play_queue pendingAction -> match');

  console.log('\n--- LaunchQueueYesHandler: only matches AMAZON.YesIntent ---');
  const noIntent = makeNoIntentInput({ pendingAction: 'play_queue' });
  assert(!LaunchQueueYesHandler.canHandle(noIntent), 'NoIntent rejected');

  console.log('\n--- LaunchQueueYesHandler: handle starts the queue ---');
  const session = { pendingAction: 'play_queue' };
  const hi = makeYesIntentInput(session);
  const resp = await LaunchQueueYesHandler.handle(hi);
  assert(session.pendingAction === undefined, 'pendingAction cleared');
  assert(/Test Video/.test(resp.outputSpeech.text), `speech mentions title (got: ${resp.outputSpeech.text})`);
  assert(resp.directives.some(d => d.type === 'VideoApp.Launch'),
    'VideoApp.Launch directive emitted');

  console.log('\n--- LaunchQueueNoHandler: politely declines, keeps session open ---');
  const session2 = { pendingAction: 'play_queue' };
  const hi2 = makeNoIntentInput(session2);
  assert(LaunchQueueNoHandler.canHandle(hi2), 'NoIntent in play_queue context matches');
  const resp2 = LaunchQueueNoHandler.handle(hi2);
  assert(session2.pendingAction === undefined, 'pendingAction cleared on No');
  assert(resp2.shouldEndSession === false, 'session stays open');
  assert(/Okay/i.test(resp2.outputSpeech.text), 'polite response');

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
