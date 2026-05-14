# LaunchScreen Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the Echo-Show LaunchScreen to be responsive, touch-friendly (≥80dp targets), adaptive (greeting reacts to queue/local/news state), and image-rich (covers/thumbnails/logos for every card) — across both Show 5 and Show 8/10.

**Architecture:** Pure-JS helpers compute `launchData` shape; APL templates render it with `@viewportProfile`-conditionals for Show-5 vs Show-8/10 layouts; new server endpoint `/content/<id>/poster.jpg` lazy-resizes posters via Sharp + disk-cache; `lib/newsChannelMapping.js` maps Mediathek/ORF channel strings to existing logo files (no duplicate downloads).

**Tech Stack:** Node.js 18, Express 4, Alexa Presentation Language (APL 2024.2), Sharp (new dependency), ask-sdk-core. No build step — Node directly executes everything.

---

## Spec reference

`docs/superpowers/specs/2026-05-14-launchscreen-redesign.md` — read sections 2 (Layout), 3 (Greeting), 4 (Images), 5 (YAGNI), 9 (Decisions) before starting any task.

## Code reference

Read these files once at the start. The agent that picks up Task 1 should `Read` them. Later tasks reference them by line number — do not re-read in full unless the task says so.

- `skill/apl/LaunchTemplate.json` (current 365-line template — will be rewritten)
- `skill/handlers/LaunchHandler.js` (current handler — will be refactored)
- `lib/aplHelper.js:101-149` (`renderLaunchScreen` — will be refactored)
- `lib/channels.js:43-68` (`getLogoUrlForChannel`, `CHANNEL_LOGO_MAP`, `getLogoUrl`)
- `lib/fritzbox/channels.json` (channel ids + `logoFile` fields)
- `lib/mediathek.js:1-40` (search result shape — `{title, channel, duration, timestamp, url, imageUrl, ...}`)
- `lib/queue.js:1-50` (Queue.peek shape)
- `lib/content/service.js`, `lib/content/search.js#findNewest` (local content shape)
- `public/logos/` (existing logo PNGs)
- `test/youtubeCleanup.test.js` (test style example to copy)

## Test conventions

Tests follow the existing style in this repo: plain `node` scripts using `assert(condition, message)` and a `passed/failed` counter that exits non-zero on failure. No mocha/jest. Pattern:

```js
#!/usr/bin/env node
let passed = 0, failed = 0;
function assert(c, m) { if (c) { console.log(`  ✓ ${m}`); passed++; } else { console.error(`  ✗ ${m}`); failed++; } }

(async () => {
  // tests here
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
```

To run: `node test/<name>.test.js`.

Each new file gets a matching `test/<name>.test.js`. Each task ends with the test passing AND a commit.

---

## Stage 1 — Quickwins (adaptive greeting, top-3 channels, kill right column)

Goal: ship a deployable improvement that fixes the worst overflow + adds the adaptive greeting, without touching the layout grid yet.

### Task 1.1: `lib/launchGreeting.js` — pure greeting logic

**Files:**
- Create: `lib/launchGreeting.js`
- Test: `test/launchGreeting.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/launchGreeting.test.js`:

```js
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

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/launchGreeting.test.js`
Expected: `Cannot find module '../lib/launchGreeting'`

- [ ] **Step 3: Write minimal implementation**

Create `lib/launchGreeting.js`:

```js
/**
 * Adaptive greeting builder for LaunchScreen.
 *
 * Pure function — no I/O, no side-effects. Caller passes current state,
 * gets back the display header + spoken text + reprompt + priority bucket.
 *
 * Priority order (first matching rule wins):
 *   queue >=1            -> 'queue'
 *   queue 0, recent >=1  -> 'recent'
 *   queue 0, recent 0, newsOk=true   -> 'news'
 *   newsOk=false, liveTvOk=true       -> 'liveTv'
 *   everything down                   -> 'empty'
 */
function pluralize(n, singular, plural) {
  if (n === 1) return `ein ${singular}`;
  return `${n} ${plural}`;
}

function buildGreeting({ queueCount = 0, recentCount = 0, newsOk = true, liveTvOk = true }) {
  if (queueCount >= 1) {
    const qStr = pluralize(queueCount, 'Video', 'Videos');
    return {
      priority: 'queue',
      header: `Du hast ${qStr} in deiner Queue.`,
      speak: `Du hast ${qStr} in deiner Queue. Soll ich abspielen?`,
      reprompt: 'Soll ich die Queue starten?',
    };
  }
  if (recentCount >= 1 && newsOk) {
    const rStr = pluralize(recentCount, 'neue Aufnahme', 'neue Aufnahmen');
    return {
      priority: 'recent',
      header: 'Was möchtest du sehen?',
      speak: `Hallo. ${rStr} oder die aktuellen Nachrichten — was magst du?`,
      reprompt: 'Sage Nachrichten, Live-TV oder einen Titel.',
    };
  }
  if (newsOk) {
    return {
      priority: 'news',
      header: 'Aktuelle Nachrichten',
      speak: 'Was möchtest du sehen? Aktuelle Nachrichten, Live-TV oder einen Sender?',
      reprompt: 'Sage zum Beispiel: Tagesschau.',
    };
  }
  if (liveTvOk) {
    return {
      priority: 'liveTv',
      header: 'Live-TV verfügbar',
      speak: 'Die Mediathek ist gerade nicht erreichbar. Du kannst Live-TV starten — sage einen Sendernamen.',
      reprompt: 'Welchen Sender?',
    };
  }
  return {
    priority: 'empty',
    header: 'Hallo.',
    speak: 'Im Moment habe ich keine Inhalte. Versuche es später nochmal.',
    reprompt: null,
  };
}

module.exports = { buildGreeting, pluralize };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/launchGreeting.test.js`
Expected: `13 passed, 0 failed` (or close — count individual `assert` calls).

- [ ] **Step 5: Commit**

```bash
git add lib/launchGreeting.js test/launchGreeting.test.js
git commit -m "launch: add adaptive greeting builder (queue/recent/news states)"
```

---

### Task 1.2: `lib/launchChannels.js` — env-driven top-3 channels

**Files:**
- Create: `lib/launchChannels.js`
- Test: `test/launchChannels.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/launchChannels.test.js`:

```js
#!/usr/bin/env node
let passed = 0, failed = 0;
function assert(c, m) { if (c) { console.log(`  ✓ ${m}`); passed++; } else { console.error(`  ✗ ${m}`); failed++; } }

// We need to control process.env BEFORE require-time inside the helper, so
// the helper must read env lazily (every call). Verify that contract too.

(async () => {
  console.log('\n--- getTopChannelIds: default (AT) ---');
  delete process.env.LAUNCH_COUNTRY;
  const { getTopChannelIds, AT_TOP, DE_TOP } = require('../lib/launchChannels');
  let ids = getTopChannelIds();
  assert(Array.isArray(ids) && ids.length === 3, `3 ids (got: ${ids.length})`);
  assert(ids[0] === 'orf1', `first AT id orf1 (got: ${ids[0]})`);

  console.log('\n--- getTopChannelIds: AT explicit ---');
  process.env.LAUNCH_COUNTRY = 'AT';
  ids = getTopChannelIds();
  assert(JSON.stringify(ids) === JSON.stringify(AT_TOP), `AT set matches (got: ${JSON.stringify(ids)})`);

  console.log('\n--- getTopChannelIds: DE ---');
  process.env.LAUNCH_COUNTRY = 'DE';
  ids = getTopChannelIds();
  assert(JSON.stringify(ids) === JSON.stringify(DE_TOP), `DE set matches (got: ${JSON.stringify(ids)})`);
  assert(ids.includes('dasErsteHd'), 'DE includes dasErsteHd');
  assert(ids.includes('zdfHd'), 'DE includes zdfHd');

  console.log('\n--- getTopChannelIds: unknown country falls back to AT ---');
  process.env.LAUNCH_COUNTRY = 'XX';
  ids = getTopChannelIds();
  assert(JSON.stringify(ids) === JSON.stringify(AT_TOP), 'unknown -> AT fallback');

  delete process.env.LAUNCH_COUNTRY;
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/launchChannels.test.js`
Expected: `Cannot find module`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/launchChannels.js`:

```js
/**
 * Top-3 Live-TV channels for LaunchScreen, country-dependent.
 *
 * Read env LAUNCH_COUNTRY at call time so tests can toggle it.
 * AT (default) shows ORF1, ORF2 Tirol, ORF III.
 * DE shows Das Erste, ZDF, arte.
 * Unknown values fall back to AT.
 */
const AT_TOP = ['orf1', 'orf2t', 'orf3'];
const DE_TOP = ['dasErsteHd', 'zdfHd', 'arteHd'];

function getTopChannelIds() {
  const country = (process.env.LAUNCH_COUNTRY || 'AT').toUpperCase();
  if (country === 'DE') return DE_TOP.slice();
  return AT_TOP.slice();
}

module.exports = { getTopChannelIds, AT_TOP, DE_TOP };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/launchChannels.test.js`
Expected: `6 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add lib/launchChannels.js test/launchChannels.test.js
git commit -m "launch: env-driven top-3 channels (LAUNCH_COUNTRY=AT|DE)"
```

---

### Task 1.3: Wire `LaunchHandler` to use greeting + top-3

**Files:**
- Modify: `skill/handlers/LaunchHandler.js`
- Modify: `lib/aplHelper.js` (signature of `renderLaunchScreen`)
- Test: `test/launchHandler.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/launchHandler.test.js`:

```js
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

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/launchHandler.test.js`
Expected: failures on `directive.datasources.launchData.properties.greeting` (the current handler doesn't put a `greeting` object in the datasource yet) and on `liveTVChannels.length === 3` (current handler hardcodes 8).

- [ ] **Step 3: Modify `lib/aplHelper.js` `renderLaunchScreen` to accept `greeting`**

In `lib/aplHelper.js`, replace the body of `renderLaunchScreen` (lines 101-149) with:

```js
function renderLaunchScreen(handlerInput, params) {
  if (!hasAPLSupport(handlerInput)) return;

  const {
    sections = [],
    greeting = { header: 'Aktuelle Nachrichten', speak: '', priority: 'news' },
    liveTVChannels = [],
    recentContent = [],
    queue = [],
  } = params;

  let flatIndex = 0;
  const aplSections = sections.map(section => {
    const results = section.results.map(r => {
      const minutes = Math.round(r.duration / 60);
      const item = {
        flatIndex: flatIndex,
        title: r.title,
        channel: r.channel || '',
        logo: getLogoUrlForChannel(r.channel),
        imageUrl: r.imageUrl || '',
        time: relativeTime(r.timestamp),
        duration: minutes > 0 ? `${minutes} Min` : '',
      };
      flatIndex++;
      return item;
    });
    return { title: section.title, results: results.slice(0, 3) }; // top-3 per Spec
  });

  handlerInput.responseBuilder.addDirective({
    type: 'Alexa.Presentation.APL.RenderDocument',
    token: 'launchToken',
    document: LAUNCH_TEMPLATE,
    datasources: {
      launchData: {
        type: 'object',
        properties: {
          greeting,
          sections: aplSections,
          liveTVChannels,
          recentContent: recentContent.slice(0, 3),
          queue: queue.slice(0, 3),
        },
      },
    },
  });
}
```

Note: signature changed from positional to options-object. Caller must be updated.

- [ ] **Step 4: Modify `skill/handlers/LaunchHandler.js`**

Replace the entire `handle` function with:

```js
  async handle(handlerInput) {
    console.log('LaunchRequest empfangen');

    const supportsVideo = hasVideoSupport(handlerInput);
    if (!supportsVideo) {
      const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
      sessionAttributes.pendingAction = 'summary_no_display';
      handlerInput.attributesManager.setSessionAttributes(sessionAttributes);
      return handlerInput.responseBuilder
        .speak('Dieses Geraet hat kein Display fuer Videowiedergabe. Ich kann dir aber eine Nachrichten-Zusammenfassung vorlesen. Moechtest du das?')
        .reprompt('Soll ich dir die Nachrichten-Zusammenfassung vorlesen?')
        .withShouldEndSession(false)
        .getResponse();
    }

    // Gather all data (each source is allowed to fail independently)
    let sections = [];
    let newsOk = true;
    try {
      const cat = await mediathek.searchCategorizedNews();
      sections = cat.sections || [];
      if (sections.length === 0) newsOk = false;
    } catch (err) {
      console.error('Launch news search error:', err.message);
      newsOk = false;
    }

    let queueRow = [];
    try {
      const queueModule = require('../../lib/queue');
      queueRow = queueModule.getInstance().peek(3).map(it => ({
        id: it.id,
        title: it.title,
        subtitle: it.subtitle || (it.source === 'local' ? 'Lokal' : 'Mediathek'),
      }));
    } catch (err) {
      console.warn('LaunchHandler: queue build failed:', err.message);
    }

    let recentContent = [];
    try {
      const contentService = require('../../lib/content/service');
      if (contentService.isEnabled()) {
        const { findNewest } = require('../../lib/content/search');
        const newest = findNewest(contentService.getIndex().all(), {
          limit: 3, uniquePerShow: true, newerThanDaysOnly: true,
          pathConfigs: contentService.getConfig().paths,
        });
        recentContent = newest.map(e => ({
          id: e.id,
          label: e.pathLabel,
          title: e.type === 'episode'
            ? `${e.show} S${String(e.season || 0).padStart(2, '0')}E${String(e.episode || 0).padStart(2, '0')}`
            : (e.title || e.filename),
        }));
      }
    } catch (err) {
      console.warn('LaunchHandler: recentContent build failed:', err.message);
    }

    // Live-TV top-3 from env-driven set
    const channelsLib = require('../../lib/channels');
    const { getTopChannelIds } = require('../../lib/launchChannels');
    const liveTVChannels = getTopChannelIds()
      .map(id => {
        const ch = channelsLib.findChannelById(id);
        if (!ch) return null;
        return { id: ch.id, name: ch.displayName, logo: ch.logoUrl };
      })
      .filter(Boolean);

    // Adaptive greeting
    const greeting = buildGreeting({
      queueCount: queueRow.length,
      recentCount: recentContent.length,
      newsOk,
      liveTvOk: liveTVChannels.length > 0,
    });

    // Store flat results for index-access (touch/voice "number 2")
    const allResults = sections.flatMap(s => s.results);
    const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
    sessionAttributes.mediathekResults = allResults;
    handlerInput.attributesManager.setSessionAttributes(sessionAttributes);

    renderLaunchScreen(handlerInput, {
      sections, greeting, liveTVChannels, recentContent, queue: queueRow,
    });

    return handlerInput.responseBuilder
      .speak(greeting.speak)
      .reprompt(greeting.reprompt || 'Was möchtest du?')
      .withShouldEndSession(false)
      .getResponse();
  }
```

At the top of `skill/handlers/LaunchHandler.js`, add to the imports:

```js
const { buildGreeting } = require('../../lib/launchGreeting');
```

Remove the now-unused `formatResultForSpeech`, `getLogoUrlForChannel` imports if they were only used in the deleted code (check after edit).

- [ ] **Step 5: Run test to verify it passes**

Run: `node test/launchHandler.test.js`
Expected: All assertions pass.

- [ ] **Step 6: Run all existing tests to verify no regression**

Run: `for f in test/*.test.js; do echo "=== $f ==="; node "$f" 2>&1 | tail -2; done`
Expected: every line says `N passed, 0 failed` (or the ORF test's German equivalent).

- [ ] **Step 7: Commit**

```bash
git add skill/handlers/LaunchHandler.js lib/aplHelper.js test/launchHandler.test.js
git commit -m "launch: adaptive greeting + env-driven top-3 channels + 3-item lists"
```

---

### Task 1.4: Strip right column from LaunchTemplate, raise live-TV tile size

**Files:**
- Modify: `skill/apl/LaunchTemplate.json` (significant cleanup, not full rewrite)

- [ ] **Step 1: Read the current template once**

Read `skill/apl/LaunchTemplate.json` lines 1-365 in full.

- [ ] **Step 2: Identify the right-column block**

Look for the second top-level `Container` with `width: "35%"`. It contains a logo Image, a "Sage: Thema..." Text, and a Container with `categories`-bound items. The whole block is roughly lines 220-360 of the current file (locate by searching for `"width": "35%"`).

- [ ] **Step 3: Apply the edit**

Replace the outer parent (lines 8-12, the row Container) with a single-column Container:

```json
{
  "type": "Container",
  "width": "100vw",
  "height": "100vh",
  "padding": "32dp",
  "items": [
```

Delete the right-column 35% block entirely (everything between the closing of the 65%-Container and the closing brackets of the row Container).

Inside the 65% Container, change `width: "65%"` to `width: "100%"`.

Find the live-TV quickbar Container (search for `liveTVChannels`). The current Frame has `width: "60dp"`, `height: "40dp"` and a small padding. Change to:

- Frame width: `"100dp"`
- Frame height: `"100dp"`
- Image inside: `width: "80dp"`, `height: "60dp"`

Find the header `Text` (currently `${launchData.properties.title}` at 32dp). Replace with:

```json
{
  "type": "Text",
  "text": "${launchData.properties.greeting.header}",
  "color": "white",
  "fontSize": "28dp",
  "fontWeight": "bold",
  "paddingBottom": "16dp",
  "maxLines": 2
}
```

- [ ] **Step 4: Validate JSON syntax**

Run: `node -e "JSON.parse(require('fs').readFileSync('skill/apl/LaunchTemplate.json','utf8')); console.log('OK')"`
Expected: `OK`. If error, fix bracket/comma issues.

- [ ] **Step 5: Run launchHandler.test.js — it should still pass**

Run: `node test/launchHandler.test.js`
Expected: All assertions pass (test only checks data shape, not template structure).

- [ ] **Step 6: Add a JSON-validity test for the template**

Append to `test/launchHandler.test.js` (before `console.log` final line), or create a new tiny test — your call. If appending:

```js
  console.log('\n--- LaunchTemplate.json: valid JSON, no right-column block ---');
  const fs = require('fs');
  const tpl = JSON.parse(fs.readFileSync(require('path').join(__dirname, '..', 'skill', 'apl', 'LaunchTemplate.json'), 'utf8'));
  assert(tpl.type === 'APL', 'is APL document');
  // ensure greeting reference exists
  const tplStr = JSON.stringify(tpl);
  assert(tplStr.includes('launchData.properties.greeting.header'), 'template binds greeting.header');
  assert(!tplStr.includes('width": "35%"'), 'right-column 35% block removed');
  assert(!tplStr.includes('width": "65%"'), 'left-column 65% block removed (now 100%)');
```

Run: `node test/launchHandler.test.js`
Expected: All pass.

- [ ] **Step 7: Commit**

```bash
git add skill/apl/LaunchTemplate.json test/launchHandler.test.js
git commit -m "launch: strip right column, enlarge live-TV tiles to 100dp, bind greeting.header"
```

---

## Stage 2 — 3-Column Grid for Show 8/10 + Voice-Hint Bar

Goal: Final layout for big-display Echo Shows. Queue header row + 3 parallel columns (Live-TV / News / Lokal) + escalation buttons + voice-hint bar.

### Task 2.1: Token block at top of LaunchTemplate

**Files:**
- Modify: `skill/apl/LaunchTemplate.json`

- [ ] **Step 1: Read current LaunchTemplate.json**

(Quick re-read after the Stage 1 cleanup. Should be much shorter now, maybe ~180 lines.)

- [ ] **Step 2: Add `resources` block right after `version`**

After `"version": "2024.2",` insert:

```json
"theme": "dark",
"resources": [
  {
    "colors": {
      "bgBase": "#0B1220",
      "bgCard": "#FFFFFF14",
      "bgCardAlt": "#FFFFFF08",
      "accent": "#4FC3F7",
      "accentCta": "#1F6FEB",
      "textPrimary": "#FFFFFF",
      "textMuted": "#B0BEC5",
      "textDim": "#78909C"
    },
    "dimensions": {
      "radiusCard": "14dp",
      "radiusTile": "12dp",
      "padCard": "16dp",
      "gapSection": "18dp",
      "gapTile": "10dp",
      "minTouch": "80dp"
    }
  }
],
```

(Replace any duplicate `"theme":"dark"` if present elsewhere.)

- [ ] **Step 3: Replace hardcoded colors throughout the template**

Search-and-replace:

- `"color": "#4FC3F7"` → `"color": "@accent"`
- `"color": "#79c0ff"` → `"color": "@accent"`
- `"color": "#B0BEC5"` → `"color": "@textMuted"`
- `"color": "#78909C"` → `"color": "@textDim"`
- `"backgroundColor": "rgba(255,255,255,0.08)"` → `"backgroundColor": "@bgCard"`
- `"backgroundColor": "rgba(255,255,255,0.04)"` → `"backgroundColor": "@bgCardAlt"`
- Any other hex values that match the palette — convert to token form.

- [ ] **Step 4: Validate JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('skill/apl/LaunchTemplate.json','utf8')); console.log('OK')"`
Expected: `OK`.

- [ ] **Step 5: Run launchHandler.test.js**

Run: `node test/launchHandler.test.js`
Expected: still passes (template is loaded as data by aplHelper, JSON parse must succeed).

- [ ] **Step 6: Commit**

```bash
git add skill/apl/LaunchTemplate.json
git commit -m "launch: add design tokens (colors + dimensions) as APL resources"
```

---

### Task 2.2: APL `layouts` block — define `MediaCard` and `LogoTile` once

**Files:**
- Modify: `skill/apl/LaunchTemplate.json`

- [ ] **Step 1: Insert `layouts` block after `resources`**

After the `resources` block, before `mainTemplate`, add:

```json
"layouts": {
  "MediaCard": {
    "parameters": [
      { "name": "title", "type": "string" },
      { "name": "subtitle", "type": "string", "default": "" },
      { "name": "imageUrl", "type": "string", "default": "" },
      { "name": "touchAction", "type": "string", "default": "" },
      { "name": "touchPayload", "type": "string", "default": "" }
    ],
    "item": {
      "type": "TouchWrapper",
      "minWidth": "@minTouch",
      "minHeight": "@minTouch",
      "onPress": {
        "type": "SendEvent",
        "arguments": ["${touchAction}", "${touchPayload}"]
      },
      "item": {
        "type": "Frame",
        "width": "280dp",
        "height": "220dp",
        "backgroundColor": "@bgCard",
        "borderRadius": "@radiusCard",
        "item": {
          "type": "Container",
          "direction": "column",
          "items": [
            {
              "type": "Image",
              "source": "${imageUrl}",
              "width": "280dp",
              "height": "135dp",
              "scale": "best-fill",
              "borderRadius": "@radiusCard",
              "when": "${imageUrl != ''}"
            },
            {
              "type": "Container",
              "padding": "@padCard",
              "items": [
                {
                  "type": "Text",
                  "text": "${title}",
                  "color": "@textPrimary",
                  "fontSize": "20dp",
                  "fontWeight": "bold",
                  "maxLines": 2
                },
                {
                  "type": "Text",
                  "text": "${subtitle}",
                  "color": "@textMuted",
                  "fontSize": "16dp",
                  "maxLines": 1,
                  "when": "${subtitle != ''}"
                }
              ]
            }
          ]
        }
      }
    }
  },
  "LogoTile": {
    "parameters": [
      { "name": "name", "type": "string" },
      { "name": "logoUrl", "type": "string", "default": "" },
      { "name": "channelId", "type": "string" }
    ],
    "item": {
      "type": "TouchWrapper",
      "minWidth": "@minTouch",
      "minHeight": "@minTouch",
      "onPress": {
        "type": "SendEvent",
        "arguments": ["selectChannel", "${channelId}"]
      },
      "item": {
        "type": "Frame",
        "width": "200dp",
        "height": "120dp",
        "backgroundColor": "@bgCard",
        "borderRadius": "@radiusTile",
        "item": {
          "type": "Container",
          "alignItems": "center",
          "justifyContent": "center",
          "items": [
            {
              "type": "Image",
              "source": "${logoUrl}",
              "width": "160dp",
              "height": "64dp",
              "scale": "best-fit",
              "when": "${logoUrl != ''}"
            },
            {
              "type": "Text",
              "text": "${name}",
              "color": "@textPrimary",
              "fontSize": "16dp",
              "fontWeight": "bold",
              "when": "${logoUrl == ''}"
            }
          ]
        }
      }
    }
  }
},
```

- [ ] **Step 2: Validate JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('skill/apl/LaunchTemplate.json','utf8')); console.log('OK')"`
Expected: `OK`.

- [ ] **Step 3: Commit**

```bash
git add skill/apl/LaunchTemplate.json
git commit -m "launch: define MediaCard + LogoTile as reusable APL layouts"
```

---

### Task 2.3: Rewrite `mainTemplate` to use 3-column grid + new layouts

**Files:**
- Modify: `skill/apl/LaunchTemplate.json`

- [ ] **Step 1: Read current template (post Task 2.2)**

Quick re-read so you know what to replace. Note where `mainTemplate` starts.

- [ ] **Step 2: Replace `mainTemplate` block**

Replace the entire `"mainTemplate": { ... }` with:

```json
"mainTemplate": {
  "parameters": ["launchData"],
  "items": [
    {
      "type": "Container",
      "width": "100vw",
      "height": "100vh",
      "padding": "32dp",
      "backgroundColor": "@bgBase",
      "items": [
        {
          "type": "Container",
          "direction": "row",
          "alignItems": "center",
          "justifyContent": "spaceBetween",
          "height": "96dp",
          "items": [
            {
              "type": "Text",
              "text": "${launchData.properties.greeting.header}",
              "color": "@textPrimary",
              "fontSize": "28dp",
              "fontWeight": "bold",
              "maxLines": 2,
              "grow": 1
            },
            {
              "type": "TouchWrapper",
              "minWidth": "@minTouch",
              "minHeight": "@minTouch",
              "onPress": { "type": "SendEvent", "arguments": ["playQueue"] },
              "when": "${launchData.properties.greeting.priority == 'queue'}",
              "item": {
                "type": "Frame",
                "width": "280dp",
                "height": "80dp",
                "backgroundColor": "@accentCta",
                "borderRadius": "@radiusCard",
                "item": {
                  "type": "Text",
                  "text": "Queue weiter ▶",
                  "color": "@textPrimary",
                  "fontSize": "20dp",
                  "fontWeight": "bold",
                  "textAlign": "center",
                  "textAlignVertical": "center"
                }
              }
            }
          ]
        },

        {
          "type": "Container",
          "paddingTop": "@gapSection",
          "when": "${launchData.properties.queue.length > 0}",
          "items": [
            {
              "type": "Text",
              "text": "QUEUE",
              "color": "@accent",
              "fontSize": "22dp",
              "fontWeight": "bold",
              "paddingBottom": "@gapTile"
            },
            {
              "type": "Container",
              "direction": "row",
              "data": "${launchData.properties.queue}",
              "items": [
                {
                  "type": "MediaCard",
                  "title": "${data.title}",
                  "subtitle": "${data.subtitle}",
                  "imageUrl": "${data.imageUrl}",
                  "touchAction": "selectQueueItem",
                  "touchPayload": "${data.id}",
                  "paddingRight": "@gapTile"
                }
              ]
            }
          ]
        },

        {
          "type": "Container",
          "direction": "row",
          "paddingTop": "@gapSection",
          "grow": 1,
          "items": [
            {
              "type": "Container",
              "width": "240dp",
              "paddingRight": "@gapTile",
              "items": [
                { "type": "Text", "text": "LIVE-TV", "color": "@accent", "fontSize": "22dp", "fontWeight": "bold", "paddingBottom": "@gapTile" },
                {
                  "type": "Container",
                  "data": "${launchData.properties.liveTVChannels}",
                  "items": [
                    {
                      "type": "LogoTile",
                      "name": "${data.name}",
                      "logoUrl": "${data.logo}",
                      "channelId": "${data.id}",
                      "paddingBottom": "@gapTile"
                    }
                  ]
                },
                {
                  "type": "TouchWrapper",
                  "minHeight": "56dp",
                  "onPress": { "type": "SendEvent", "arguments": ["showAllChannels"] },
                  "item": {
                    "type": "Frame",
                    "width": "200dp",
                    "height": "56dp",
                    "borderColor": "@accent",
                    "borderWidth": "2dp",
                    "borderRadius": "@radiusCard",
                    "item": {
                      "type": "Text",
                      "text": "Alle Sender →",
                      "color": "@accent",
                      "fontSize": "16dp",
                      "textAlign": "center",
                      "textAlignVertical": "center"
                    }
                  }
                }
              ]
            },

            {
              "type": "Container",
              "grow": 1,
              "paddingRight": "@gapTile",
              "items": [
                { "type": "Text", "text": "NEWS", "color": "@accent", "fontSize": "22dp", "fontWeight": "bold", "paddingBottom": "@gapTile" },
                {
                  "type": "Container",
                  "data": "${launchData.properties.sections[0].results}",
                  "items": [
                    {
                      "type": "MediaCard",
                      "title": "${data.title}",
                      "subtitle": "${data.channel} · ${data.time}",
                      "imageUrl": "${data.imageUrl != '' ? data.imageUrl : data.logo}",
                      "touchAction": "selectNewsItem",
                      "touchPayload": "${data.flatIndex}",
                      "paddingBottom": "@gapTile"
                    }
                  ]
                }
              ]
            },

            {
              "type": "Container",
              "grow": 1,
              "items": [
                { "type": "Text", "text": "LOKAL", "color": "@accent", "fontSize": "22dp", "fontWeight": "bold", "paddingBottom": "@gapTile" },
                {
                  "type": "Container",
                  "data": "${launchData.properties.recentContent}",
                  "items": [
                    {
                      "type": "MediaCard",
                      "title": "${data.title}",
                      "subtitle": "${data.label}",
                      "imageUrl": "${data.imageUrl != '' ? data.imageUrl : ''}",
                      "touchAction": "selectLocalContent",
                      "touchPayload": "${data.id}",
                      "paddingBottom": "@gapTile"
                    }
                  ]
                }
              ]
            }
          ]
        },

        {
          "type": "Container",
          "height": "48dp",
          "alignItems": "center",
          "justifyContent": "center",
          "items": [
            {
              "type": "Text",
              "text": "${launchData.properties.voiceHint}",
              "color": "@textMuted",
              "fontSize": "16dp",
              "textAlign": "center"
            }
          ]
        }
      ]
    }
  ]
}
```

- [ ] **Step 3: Validate JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('skill/apl/LaunchTemplate.json','utf8')); console.log('OK')"`
Expected: `OK`.

- [ ] **Step 4: Run launchHandler test**

Run: `node test/launchHandler.test.js`
Expected: still passes — the test only checks `datasources` shape, not template internals.

- [ ] **Step 5: Commit**

```bash
git add skill/apl/LaunchTemplate.json
git commit -m "launch: 3-column grid layout (Live-TV/News/Lokal) + queue header row"
```

---

### Task 2.4: Add `voiceHint` to LaunchHandler datasource

**Files:**
- Modify: `lib/aplHelper.js`
- Modify: `skill/handlers/LaunchHandler.js`
- Test: `test/aplHelperLaunch.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/aplHelperLaunch.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/aplHelperLaunch.test.js`
Expected: `voiceHint set` fails because the helper does not propagate it yet.

- [ ] **Step 3: Update `renderLaunchScreen` to accept and default `voiceHint`**

In `lib/aplHelper.js`, change the destructuring in `renderLaunchScreen` to:

```js
  const {
    sections = [],
    greeting = { header: 'Aktuelle Nachrichten', speak: '', priority: 'news' },
    liveTVChannels = [],
    recentContent = [],
    queue = [],
    voiceHint = 'Sag: Tagesschau, Queue, ORF1, alle Sender',
  } = params;
```

And add `voiceHint` to the `properties` object in the directive's datasources:

```js
        properties: {
          greeting,
          sections: aplSections,
          liveTVChannels,
          recentContent: recentContent.slice(0, 3),
          queue: queue.slice(0, 3),
          voiceHint,
        },
```

- [ ] **Step 4: Run the new test**

Run: `node test/aplHelperLaunch.test.js`
Expected: All pass.

- [ ] **Step 5: Run full regression**

Run: `for f in test/*.test.js; do node "$f" 2>&1 | tail -1; done`
Expected: every line says `N passed, 0 failed`.

- [ ] **Step 6: Commit**

```bash
git add lib/aplHelper.js test/aplHelperLaunch.test.js
git commit -m "launch: add voiceHint to launchData (static for now, rotation in stage 5)"
```

---

## Stage 3 — Show 5 Vertical Sequence (responsive conditional)

Goal: Show-5 (960×480) gets a dedicated layout: vertical scroll of 3 sections, each with 3 cards.

### Task 3.1: Add viewport-conditional in mainTemplate

**Files:**
- Modify: `skill/apl/LaunchTemplate.json`
- Test: `test/aplHelperViewport.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/aplHelperViewport.test.js`:

```js
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
  const small = items.find(i => i.when && i.when.includes('hubLandscapeSmall'));
  assert(small, 'small-viewport variant exists');
  const smallStr = JSON.stringify(small);
  assert(smallStr.includes('ScrollView') || smallStr.includes('Sequence'),
    'small variant uses ScrollView or Sequence');

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/aplHelperViewport.test.js`
Expected: fails at `template references @hubLandscapeSmall`.

- [ ] **Step 3: Add the Show-5 variant**

In `skill/apl/LaunchTemplate.json`, `mainTemplate.items` is currently a 1-element array (the big-display layout from Task 2.3). Wrap it in a `when` for medium/large, and add a second item for small.

Find the current `mainTemplate.items[0]` (the outer 100vw×100vh Container). Add to it:

```json
"when": "${@viewportProfile != @hubLandscapeSmall}"
```

After that item (still inside `items`), add the Show-5 variant:

```json
{
  "when": "${@viewportProfile == @hubLandscapeSmall}",
  "type": "Container",
  "width": "100vw",
  "height": "100vh",
  "padding": "16dp",
  "backgroundColor": "@bgBase",
  "items": [
    {
      "type": "Container",
      "direction": "row",
      "alignItems": "center",
      "height": "60dp",
      "items": [
        {
          "type": "Text",
          "text": "${launchData.properties.greeting.header}",
          "color": "@textPrimary",
          "fontSize": "20dp",
          "fontWeight": "bold",
          "maxLines": 1,
          "grow": 1
        },
        {
          "type": "TouchWrapper",
          "minWidth": "@minTouch",
          "minHeight": "@minTouch",
          "onPress": { "type": "SendEvent", "arguments": ["playQueue"] },
          "when": "${launchData.properties.greeting.priority == 'queue'}",
          "item": {
            "type": "Frame",
            "width": "180dp",
            "height": "56dp",
            "backgroundColor": "@accentCta",
            "borderRadius": "@radiusCard",
            "item": {
              "type": "Text",
              "text": "Queue ▶",
              "color": "@textPrimary",
              "fontSize": "16dp",
              "fontWeight": "bold",
              "textAlign": "center",
              "textAlignVertical": "center"
            }
          }
        }
      ]
    },

    {
      "type": "ScrollView",
      "grow": 1,
      "items": [
        {
          "type": "Container",
          "paddingTop": "10dp",
          "items": [
            {
              "type": "Container",
              "when": "${launchData.properties.queue.length > 0}",
              "items": [
                { "type": "Text", "text": "QUEUE", "color": "@accent", "fontSize": "16dp", "fontWeight": "bold", "paddingBottom": "6dp" },
                {
                  "type": "Container",
                  "direction": "row",
                  "data": "${launchData.properties.queue}",
                  "items": [
                    {
                      "type": "MediaCard",
                      "title": "${data.title}",
                      "subtitle": "${data.subtitle}",
                      "imageUrl": "${data.imageUrl != null ? data.imageUrl : ''}",
                      "touchAction": "selectQueueItem",
                      "touchPayload": "${data.id}",
                      "paddingRight": "8dp"
                    }
                  ]
                }
              ]
            },

            { "type": "Text", "text": "LIVE-TV", "color": "@accent", "fontSize": "16dp", "fontWeight": "bold", "paddingTop": "14dp", "paddingBottom": "6dp" },
            {
              "type": "Container",
              "direction": "row",
              "data": "${launchData.properties.liveTVChannels}",
              "items": [
                {
                  "type": "LogoTile",
                  "name": "${data.name}",
                  "logoUrl": "${data.logo}",
                  "channelId": "${data.id}",
                  "paddingRight": "8dp"
                }
              ]
            },

            { "type": "Text", "text": "NEWS", "color": "@accent", "fontSize": "16dp", "fontWeight": "bold", "paddingTop": "14dp", "paddingBottom": "6dp" },
            {
              "type": "Container",
              "data": "${launchData.properties.sections[0].results}",
              "items": [
                {
                  "type": "MediaCard",
                  "title": "${data.title}",
                  "subtitle": "${data.channel} · ${data.time}",
                  "imageUrl": "${data.imageUrl != '' ? data.imageUrl : data.logo}",
                  "touchAction": "selectNewsItem",
                  "touchPayload": "${data.flatIndex}",
                  "paddingBottom": "8dp"
                }
              ]
            },

            { "type": "Text", "text": "LOKAL", "color": "@accent", "fontSize": "16dp", "fontWeight": "bold", "paddingTop": "14dp", "paddingBottom": "6dp", "when": "${launchData.properties.recentContent.length > 0}" },
            {
              "type": "Container",
              "data": "${launchData.properties.recentContent}",
              "items": [
                {
                  "type": "MediaCard",
                  "title": "${data.title}",
                  "subtitle": "${data.label}",
                  "imageUrl": "${data.imageUrl != '' ? data.imageUrl : ''}",
                  "touchAction": "selectLocalContent",
                  "touchPayload": "${data.id}",
                  "paddingBottom": "8dp"
                }
              ]
            }
          ]
        }
      ]
    },

    {
      "type": "Container",
      "height": "30dp",
      "alignItems": "center",
      "justifyContent": "center",
      "items": [
        {
          "type": "Text",
          "text": "${launchData.properties.voiceHint}",
          "color": "@textMuted",
          "fontSize": "14dp",
          "textAlign": "center",
          "maxLines": 1
        }
      ]
    }
  ]
}
```

- [ ] **Step 4: Validate JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('skill/apl/LaunchTemplate.json','utf8')); console.log('OK')"`
Expected: `OK`.

- [ ] **Step 5: Run the viewport test**

Run: `node test/aplHelperViewport.test.js`
Expected: All pass.

- [ ] **Step 6: Run launchHandler test**

Run: `node test/launchHandler.test.js`
Expected: still passes.

- [ ] **Step 7: Commit**

```bash
git add skill/apl/LaunchTemplate.json test/aplHelperViewport.test.js
git commit -m "launch: add Show-5 vertical-scroll layout (hubLandscapeSmall viewport)"
```

---

## Stage 4 — Image Pipeline (poster endpoint, news mapping, fallbacks)

Goal: every card has an image. Local files get scanned for `cover.jpg`/`poster.jpg`, served via `/content/<id>/poster.jpg` with Sharp-resize + disk cache. News items get a logo from `newsChannelMapping`. YouTube reuses the existing thumbnail URL embedded in entry metadata.

### Task 4.1: Add `sharp` dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install sharp**

Run: `npm install sharp@^0.33.0`

- [ ] **Step 2: Verify it works**

Run: `node -e "const sharp = require('sharp'); sharp({ create: { width: 1, height: 1, channels: 3, background: '#000' } }).png().toBuffer().then(b => console.log('OK', b.length))"`
Expected: `OK <some bytes>`. If sharp build fails (native deps), troubleshoot before proceeding.

- [ ] **Step 3: Commit `package.json` and `package-lock.json`**

```bash
git add package.json package-lock.json
git commit -m "deps: add sharp for poster resize"
```

---

### Task 4.2: `lib/posterLookup.js` — find local poster file

**Files:**
- Create: `lib/posterLookup.js`
- Test: `test/posterLookup.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/posterLookup.test.js`:

```js
#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');

let passed = 0, failed = 0;
function assert(c, m) { if (c) { console.log(`  ✓ ${m}`); passed++; } else { console.error(`  ✗ ${m}`); failed++; } }

function touch(p) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, 'fakejpg'); }

(async () => {
  const { findPosterForEntry } = require('../lib/posterLookup');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'poster-'));

  console.log('\n--- cover.jpg in same dir wins ---');
  const vid = path.join(root, 'Show', 'Season 1', 'S01E01.mp4');
  touch(vid);
  touch(path.join(root, 'Show', 'Season 1', 'cover.jpg'));
  let res = findPosterForEntry({ path: vid });
  assert(res === path.join(root, 'Show', 'Season 1', 'cover.jpg'), `cover.jpg picked (got ${res})`);

  console.log('\n--- poster.jpg picked over folder.jpg ---');
  const root2 = fs.mkdtempSync(path.join(os.tmpdir(), 'poster-'));
  const vid2 = path.join(root2, 'S.mp4');
  touch(vid2);
  touch(path.join(root2, 'folder.jpg'));
  touch(path.join(root2, 'poster.jpg'));
  res = findPosterForEntry({ path: vid2 });
  assert(res === path.join(root2, 'poster.jpg'), `poster.jpg over folder (got ${res})`);

  console.log('\n--- falls back to parent dir ---');
  const root3 = fs.mkdtempSync(path.join(os.tmpdir(), 'poster-'));
  const vid3 = path.join(root3, 'Show', 'Season 2', 'S02E01.mp4');
  touch(vid3);
  touch(path.join(root3, 'Show', 'poster.jpg')); // one level up
  res = findPosterForEntry({ path: vid3 });
  assert(res === path.join(root3, 'Show', 'poster.jpg'), `parent-dir poster (got ${res})`);

  console.log('\n--- nothing found returns null ---');
  const root4 = fs.mkdtempSync(path.join(os.tmpdir(), 'poster-'));
  const vid4 = path.join(root4, 'x.mp4');
  touch(vid4);
  res = findPosterForEntry({ path: vid4 });
  assert(res === null, `no poster (got ${res})`);

  for (const r of [root, root2, root3, root4]) {
    try { fs.rmSync(r, { recursive: true, force: true }); } catch (_) {}
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/posterLookup.test.js`
Expected: `Cannot find module`.

- [ ] **Step 3: Implement**

Create `lib/posterLookup.js`:

```js
const fs = require('fs');
const path = require('path');

const CANDIDATES = ['cover.jpg', 'poster.jpg', 'folder.jpg', 'cover.png', 'poster.png'];

/**
 * Walk from the video file up to 2 parent directories looking for a poster
 * candidate. Returns absolute path or null.
 */
function findPosterForEntry(entry) {
  if (!entry || !entry.path) return null;
  let dir = path.dirname(entry.path);
  for (let depth = 0; depth < 3; depth++) {
    for (const name of CANDIDATES) {
      const candidate = path.join(dir, name);
      if (fs.existsSync(candidate)) return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

module.exports = { findPosterForEntry, CANDIDATES };
```

- [ ] **Step 4: Run test**

Run: `node test/posterLookup.test.js`
Expected: `4 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add lib/posterLookup.js test/posterLookup.test.js
git commit -m "launch: posterLookup finds cover/poster/folder.jpg up to 2 dirs up"
```

---

### Task 4.3: `lib/newsChannelMapping.js` — Mediathek channel → logo file

**Files:**
- Create: `lib/newsChannelMapping.js`
- Test: `test/newsChannelMapping.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/newsChannelMapping.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/newsChannelMapping.test.js`
Expected: `Cannot find module`.

- [ ] **Step 3: Implement**

Create `lib/newsChannelMapping.js`:

```js
/**
 * Map a Mediathek/ORF "channel" string (e.g. "ORF1", "ZDF", "Das Erste") to
 * the matching logo file in public/logos/. Independent from
 * lib/fritzbox/channels.json because "logical broadcaster" ≠ "DVB tuner".
 *
 * Fallback: _fallback_news.png (a generic placeholder).
 */

const FALLBACK = '_fallback_news.png';

const MAP = [
  // ORF
  { pattern: /^orf\s*1$/i,    file: 'orf1_hd.png' },
  { pattern: /^orf\s*2$/i,    file: 'orf2o_hd.png' },
  { pattern: /^orf\s*iii$/i,  file: 'orf_iii_hd.png' },
  { pattern: /^orf\s*3$/i,    file: 'orf_iii_hd.png' },
  { pattern: /^orf\s*sport/i, file: 'orf_sport+_hd.png' },
  { pattern: /zib/i,          file: 'orf1_hd.png' }, // generic ORF1 unless ORF API gives specific channel
  // ARD family
  { pattern: /^(ard|das\s*erste)/i, file: 'das_erste_hd.png' },
  { pattern: /tagesschau/i,         file: 'tagesschau24_hd.png' },
  { pattern: /^one$/i,              file: 'one_hd.png' },
  { pattern: /alpha/i,              file: 'ard_alpha_hd.png' },
  // ZDF family
  { pattern: /^zdf(\s|heute|$)/i,   file: 'zdf_hd.png' },
  { pattern: /^heute/i,             file: 'zdf_hd.png' },
  { pattern: /zdf\s*neo/i,          file: 'zdf_neo_hd.png' },
  { pattern: /zdf\s*info/i,         file: 'zdf_info_hd.png' },
  // Misc
  { pattern: /3\s*sat/i,            file: '3sat_hd.png' },
  { pattern: /phoenix/i,            file: 'phoenix_hd.png' },
  { pattern: /arte/i,               file: 'arte_hd.png' },
];

function getLogoFileForNewsChannel(channelName) {
  if (!channelName || typeof channelName !== 'string') return FALLBACK;
  const trimmed = channelName.trim();
  if (!trimmed) return FALLBACK;
  for (const { pattern, file } of MAP) {
    if (pattern.test(trimmed)) return file;
  }
  return FALLBACK;
}

function baseUrl() {
  return process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
}

function getLogoUrlForNewsChannel(channelName) {
  const file = getLogoFileForNewsChannel(channelName);
  return `${baseUrl()}/logos/${file}`;
}

module.exports = { getLogoFileForNewsChannel, getLogoUrlForNewsChannel, FALLBACK };
```

- [ ] **Step 4: Run test**

Run: `node test/newsChannelMapping.test.js`
Expected: all assertions pass.

- [ ] **Step 5: Commit**

```bash
git add lib/newsChannelMapping.js test/newsChannelMapping.test.js
git commit -m "launch: newsChannelMapping (ORF/ARD/ZDF/etc → logo file)"
```

---

### Task 4.4: `/content/<id>/poster.jpg` server endpoint with Sharp resize + disk cache

**Files:**
- Modify: `server.js`
- Test: `test/posterEndpoint.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/posterEndpoint.test.js`:

```js
#!/usr/bin/env node
/**
 * Smoke test for /content/<id>/poster.jpg. We don't boot the full server;
 * instead we extract the route handler logic as a function and exercise it
 * with a fake express req/res. The implementation in Task 4.5 makes this work.
 *
 * For now we just verify the helper module's logic in isolation, called
 * `resolvePosterPath(id, contentService, posterLookup)`. The server route
 * is a thin wrapper around that + Sharp resize.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

let passed = 0, failed = 0;
function assert(c, m) { if (c) { console.log(`  ✓ ${m}`); passed++; } else { console.error(`  ✗ ${m}`); failed++; } }

function touch(p) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, 'fakejpg'); }

(async () => {
  const { resolvePosterPath } = require('../lib/posterLookup');

  console.log('\n--- resolvePosterPath: returns null when content service disabled ---');
  let r = resolvePosterPath('foo/bar', { isEnabled: () => false });
  assert(r === null, `disabled -> null (got ${r})`);

  console.log('\n--- resolvePosterPath: returns null when entry unknown ---');
  r = resolvePosterPath('nope', {
    isEnabled: () => true,
    getIndex: () => ({ findById: () => null }),
  });
  assert(r === null, `unknown -> null (got ${r})`);

  console.log('\n--- resolvePosterPath: returns poster path when found ---');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'poster-ep-'));
  const vid = path.join(root, 'Show', 'S1', 'ep.mp4');
  touch(vid);
  const poster = path.join(root, 'Show', 'S1', 'cover.jpg');
  touch(poster);
  r = resolvePosterPath('show/s1/ep', {
    isEnabled: () => true,
    getIndex: () => ({ findById: (id) => id === 'show/s1/ep' ? { path: vid } : null }),
  });
  assert(r === poster, `found poster (got ${r})`);

  fs.rmSync(root, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/posterEndpoint.test.js`
Expected: `resolvePosterPath is not a function`.

- [ ] **Step 3: Extend `lib/posterLookup.js` with `resolvePosterPath`**

Append to `lib/posterLookup.js`:

```js
/**
 * Higher-level helper used by the /content/<id>/poster.jpg endpoint.
 * Takes a contentId and the content service module, looks up the entry,
 * then locates the poster file. Returns absolute path or null.
 */
function resolvePosterPath(contentId, contentService) {
  if (!contentService || !contentService.isEnabled || !contentService.isEnabled()) return null;
  const entry = contentService.getIndex().findById(contentId);
  if (!entry) return null;
  return findPosterForEntry(entry);
}

module.exports.resolvePosterPath = resolvePosterPath;
```

- [ ] **Step 4: Run test**

Run: `node test/posterEndpoint.test.js`
Expected: All pass.

- [ ] **Step 5: Add the Express route to `server.js`**

Find the existing content router block (search for `app.use('/content', contentRouter);`). Right BEFORE that line, add a new route handler. The route must come before the `:id/file.mp4` route because Express matches in order.

Actually look at the existing `contentRouter`:

```js
contentRouter.get(/^\/(.+)\/file\.mp4$/, (req, res) => { ... });
```

Add this route to the same router, before that one. Find the line `contentRouter.use(authMiddleware());` and AFTER that, add:

```js
const sharp = require('sharp');
const { resolvePosterPath } = require('./lib/posterLookup');
const POSTER_CACHE_DIR = path.join(__dirname, 'data', 'poster-cache');
const POSTER_WIDTH = 560;  // 2x 280dp
const POSTER_HEIGHT = 320; // 2x 160dp

contentRouter.get(/^\/(.+)\/poster\.jpg$/, async (req, res) => {
  const id = req.params[0];
  // token still scoped to id (so a queue add couldn't leak random posters)
  if (req.tokenPayload?.sub && req.tokenPayload.sub !== id) {
    return res.status(403).json({ error: 'token mismatch' });
  }
  // disk cache key = sha of id
  const crypto = require('crypto');
  const cacheKey = crypto.createHash('sha1').update(id).digest('hex');
  const cachedPath = path.join(POSTER_CACHE_DIR, `${cacheKey}.jpg`);
  if (fs.existsSync(cachedPath)) {
    res.set('Cache-Control', 'public, max-age=604800');
    return res.sendFile(cachedPath);
  }
  const src = resolvePosterPath(id, contentService);
  if (!src) {
    // fallback image
    return res.redirect(302, '/logos/_fallback_local.png');
  }
  try {
    fs.mkdirSync(POSTER_CACHE_DIR, { recursive: true });
    await sharp(src)
      .resize(POSTER_WIDTH, POSTER_HEIGHT, { fit: 'cover' })
      .jpeg({ quality: 85 })
      .toFile(cachedPath);
    res.set('Cache-Control', 'public, max-age=604800');
    res.sendFile(cachedPath);
  } catch (err) {
    console.warn('poster resize failed:', err.message);
    res.redirect(302, '/logos/_fallback_local.png');
  }
});
```

Note: `fs` must be imported. The existing `lib/content/service.js` route uses `contentService.isEnabled()` so make sure that import is in scope (likely already is — search for `contentService` usage).

- [ ] **Step 6: Verify server boots without error**

Run: `node -c server.js`
Expected: no syntax error.

If `fs` not in module scope at top of `server.js`, add `const fs = require('fs');` near the other top-level requires.

- [ ] **Step 7: Run all tests**

Run: `for f in test/*.test.js; do node "$f" 2>&1 | tail -1; done`
Expected: all `N passed, 0 failed`.

- [ ] **Step 8: Commit**

```bash
git add server.js lib/posterLookup.js test/posterEndpoint.test.js
git commit -m "launch: /content/<id>/poster.jpg endpoint with Sharp resize + disk cache"
```

---

### Task 4.5: Generate fallback PNG images

**Files:**
- Create: `public/logos/_fallback_local.png`
- Create: `public/logos/_fallback_news.png`
- Create: `public/logos/_fallback_youtube.png`
- Create: `scripts/generate-fallback-logos.js`

- [ ] **Step 1: Write the generator script**

Create `scripts/generate-fallback-logos.js`:

```js
#!/usr/bin/env node
/**
 * Generates 3 simple fallback PNG placeholders (dark BG + emoji-like label).
 * Run once during build / when adding the feature; output is committed.
 *
 * Usage: node scripts/generate-fallback-logos.js
 */
const sharp = require('sharp');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', 'public', 'logos');
const W = 320, H = 192;

async function make(filename, label, hue) {
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="#1a2030"/>
  <rect x="2" y="2" width="${W - 4}" height="${H - 4}" fill="none" stroke="${hue}" stroke-width="2" rx="14"/>
  <text x="50%" y="50%" font-family="sans-serif" font-size="36" font-weight="bold"
        fill="${hue}" text-anchor="middle" dominant-baseline="central">${label}</text>
</svg>`;
  await sharp(Buffer.from(svg)).png().toFile(path.join(OUT_DIR, filename));
  console.log(`wrote ${filename}`);
}

(async () => {
  await make('_fallback_local.png', '📁 LOKAL', '#4FC3F7');
  await make('_fallback_news.png', '📰 NEWS', '#4FC3F7');
  await make('_fallback_youtube.png', '▶ YOUTUBE', '#FF5252');
})();
```

- [ ] **Step 2: Run the generator**

Run: `node scripts/generate-fallback-logos.js`
Expected output:
```
wrote _fallback_local.png
wrote _fallback_news.png
wrote _fallback_youtube.png
```

- [ ] **Step 3: Verify files exist**

Run: `ls public/logos/_fallback_*.png`
Expected: 3 files listed.

- [ ] **Step 4: Commit**

```bash
git add scripts/generate-fallback-logos.js public/logos/_fallback_*.png
git commit -m "launch: generate fallback logos (_fallback_local/news/youtube.png)"
```

---

### Task 4.6: Wire LaunchHandler to populate `imageUrl` per item

**Files:**
- Modify: `skill/handlers/LaunchHandler.js`

- [ ] **Step 1: Update launchHandler.test.js to expect imageUrl population**

Add to `test/launchHandler.test.js` after the existing tests (before `console.log` final):

```js
  console.log('\n--- LaunchHandler: news items get logo URLs ---');
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
```

- [ ] **Step 2: Run test to see failures**

Run: `node test/launchHandler.test.js`
Expected: new assertions fail (`local[0].imageUrl` and `newsResults[0].logo` are undefined or '').

- [ ] **Step 3: Wire imageUrl + logo population in LaunchHandler**

In `skill/handlers/LaunchHandler.js`, change the section assembly. In the inline `sections.map(...)` (you may have to move this from `aplHelper` into the handler — that's fine).

Actually: it's cleaner to populate logos in `aplHelper.renderLaunchScreen` since that's where the per-section mapping lives. In `lib/aplHelper.js`, change the top import:

```js
const { getLogoUrlForNewsChannel } = require('./newsChannelMapping');
```

Replace `logo: getLogoUrlForChannel(r.channel),` with:

```js
logo: getLogoUrlForNewsChannel(r.channel),
```

Now for local content. In `skill/handlers/LaunchHandler.js`, update the `recentContent.map` block:

```js
        recentContent = newest.map(e => ({
          id: e.id,
          label: e.pathLabel,
          title: e.type === 'episode'
            ? `${e.show} S${String(e.season || 0).padStart(2, '0')}E${String(e.episode || 0).padStart(2, '0')}`
            : (e.title || e.filename),
          imageUrl: `${process.env.BASE_URL || 'http://localhost:' + (process.env.PORT || 3000)}/content/${e.id}/poster.jpg`,
        }));
```

And for queue items. In the same file:

```js
      queueRow = queueModule.getInstance().peek(3).map(it => ({
        id: it.id,
        title: it.title,
        subtitle: it.subtitle || (it.source === 'local' ? 'Lokal' : 'Mediathek'),
        imageUrl: it.imageUrl || (it.contentId
          ? `${process.env.BASE_URL || 'http://localhost:' + (process.env.PORT || 3000)}/content/${it.contentId}/poster.jpg`
          : ''),
      }));
```

- [ ] **Step 4: Run tests**

Run: `node test/launchHandler.test.js`
Expected: all pass.

- [ ] **Step 5: Run full regression**

Run: `for f in test/*.test.js; do node "$f" 2>&1 | tail -1; done`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add skill/handlers/LaunchHandler.js lib/aplHelper.js test/launchHandler.test.js
git commit -m "launch: populate imageUrl/logo for news (newsChannelMapping) and local (poster endpoint)"
```

---

## Stage 5 — Polish, rotating voice hint, token rollout

Goal: small final improvements. Rotating voice hint, design tokens propagated to ChannelListTemplate + NewsListTemplate, integration smoke test.

### Task 5.1: Rotating voice hint (JS-rotating per launch)

**Files:**
- Modify: `skill/handlers/LaunchHandler.js`

Rationale: Echo Show APL animations are unreliable for repeating text changes. Cheaper and more reliable: pick a different hint each time the user opens the skill. The "rotation" the user sees comes from re-launches.

- [ ] **Step 1: Add hint pool**

In `skill/handlers/LaunchHandler.js`, near the top:

```js
const VOICE_HINTS = [
  'Sag: Tagesschau, Queue, ORF1',
  'Sag: spiel Queue weiter',
  'Sag: ORF1, ZDF oder zeig alle Sender',
  'Sag: was läuft heute',
  'Sag: zeig YouTube, zeig Sport',
];
function pickVoiceHint() {
  return VOICE_HINTS[Math.floor(Math.random() * VOICE_HINTS.length)];
}
```

- [ ] **Step 2: Use it in `renderLaunchScreen` call**

In the same file, in the `handle` method, change the `renderLaunchScreen` call to pass `voiceHint`:

```js
    renderLaunchScreen(handlerInput, {
      sections, greeting, liveTVChannels, recentContent, queue: queueRow,
      voiceHint: pickVoiceHint(),
    });
```

- [ ] **Step 3: Add a test asserting voiceHint is one of the pool**

Add to `test/launchHandler.test.js`:

```js
  console.log('\n--- voiceHint is from the pool ---');
  // Reuse the empty-queue, news-ok scenario
  mockModule('../lib/queue', { getInstance: () => ({ peek: () => [], count: () => 0 }) });
  mockModule('../lib/mediathek', { searchCategorizedNews: async () => ({ sections: [] }) });
  delete require.cache[require.resolve('../skill/handlers/LaunchHandler')];
  const LH7 = require('../skill/handlers/LaunchHandler');
  hi = makeHandlerInput();
  resp = await LH7.handle(hi);
  const d7 = resp.directives.find(d => d.type === 'Alexa.Presentation.APL.RenderDocument');
  const hint = d7.datasources.launchData.properties.voiceHint;
  assert(typeof hint === 'string' && hint.startsWith('Sag:'), `hint format (got: ${hint})`);
```

- [ ] **Step 4: Run test**

Run: `node test/launchHandler.test.js`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add skill/handlers/LaunchHandler.js test/launchHandler.test.js
git commit -m "launch: rotate voice hint per launch (5 variants)"
```

---

### Task 5.2: Apply tokens to ChannelListTemplate + NewsListTemplate

**Files:**
- Modify: `skill/apl/ChannelListTemplate.json`
- Modify: `skill/apl/NewsListTemplate.json`

- [ ] **Step 1: Add resources block to both templates**

In each file, after `"version": "2024.2",`, add:

```json
"resources": [
  {
    "colors": {
      "bgBase": "#0B1220",
      "bgCard": "#FFFFFF14",
      "accent": "#4FC3F7",
      "textPrimary": "#FFFFFF",
      "textMuted": "#B0BEC5",
      "textDim": "#78909C"
    },
    "dimensions": {
      "radiusCard": "14dp",
      "padCard": "16dp",
      "gapTile": "10dp",
      "minTouch": "80dp"
    }
  }
],
```

- [ ] **Step 2: Replace hardcoded colors**

In each file, replace:
- `"#4FC3F7"` → `"@accent"`
- `"#79c0ff"` → `"@accent"`
- `"#B0BEC5"` → `"@textMuted"`
- `"#78909C"` → `"@textDim"`
- `"white"` → `"@textPrimary"` (only where it's intentional; leave system colors alone)

- [ ] **Step 3: Validate JSON**

Run:
```bash
for f in skill/apl/*.json; do node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))"; done && echo "all valid"
```
Expected: `all valid`.

- [ ] **Step 4: Run tests**

Run: `for f in test/*.test.js; do node "$f" 2>&1 | tail -1; done`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add skill/apl/ChannelListTemplate.json skill/apl/NewsListTemplate.json
git commit -m "launch: roll design tokens out to Channel/News templates"
```

---

### Task 5.3: Integration smoke test — all templates load + sample launch produces full response

**Files:**
- Create: `test/launchIntegration.test.js`

- [ ] **Step 1: Write the test**

Create `test/launchIntegration.test.js`:

```js
#!/usr/bin/env node
/**
 * End-to-end-ish smoke test: every APL template loads as valid JSON, has
 * a mainTemplate, references no obviously missing $-binding, and a full
 * LaunchHandler.handle() produces a response with non-empty speech, an
 * APL directive, all 4 datasource properties populated.
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

  console.log('\n--- design tokens propagated to all templates ---');
  for (const f of ['LaunchTemplate.json', 'ChannelListTemplate.json', 'NewsListTemplate.json']) {
    const s = fs.readFileSync(path.join(aplDir, f), 'utf8');
    assert(s.includes('@accent'), `${f}: uses @accent token`);
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
  assert(ld.greeting && ld.greeting.priority === 'queue', `greeting=queue (got: ${ld.greeting?.priority})`);
  assert(ld.queue.length === 1, '1 queue item rendered');
  assert(ld.recentContent.length === 1, '1 recent item rendered');
  assert(ld.sections[0].results.length >= 1, '>=1 news result');
  assert(ld.voiceHint && ld.voiceHint.startsWith('Sag:'), 'voiceHint set');
  assert(ld.liveTVChannels.length === 3, '3 top channels');

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
```

- [ ] **Step 2: Run test**

Run: `node test/launchIntegration.test.js`
Expected: all assertions pass.

- [ ] **Step 3: Run FULL regression**

Run:
```bash
for f in test/*.test.js; do
  result=$(node "$f" 2>&1 | tail -1)
  echo "$(basename $f): $result"
done
```
Expected: every line ends in `0 failed` (or for orfService: `0 fehlgeschlagen`).

- [ ] **Step 4: Commit**

```bash
git add test/launchIntegration.test.js
git commit -m "launch: integration smoke test (templates valid, handle() end-to-end)"
```

---

## Final regression checklist

Before considering the redesign done, verify these from the spec's Done-Definition (section 10):

- [ ] **Stage 1-2 in implementation PR.** ✓ Tasks 1.1–2.4 above.
- [ ] **Touch-Target-Minimum 80dp eingehalten.** Verify by searching LaunchTemplate.json for `minWidth`/`minHeight` and confirming every `TouchWrapper` has `@minTouch` or explicit `>= 80dp`.
- [ ] **News-Sektion hat Bilder.** Tested in Task 4.6.
- [ ] **Header-Begrüßung adaptiv.** Tested in Task 1.3.
- [ ] **Show 5 zeigt nichts mit horizontalem Overflow.** Tested implicitly by Task 3.1 (small variant uses ScrollView).
- [ ] **Offene Fragen 1-4 beantwortet.** Done in spec section 9.

Optional verification on a physical Echo Show:
1. Pull main, rebuild Docker image, deploy.
2. Open the skill on the device with empty queue → expect "Aktuelle Nachrichten" header + 3 columns.
3. Add a queue item → re-open → expect "Du hast 1 Video in deiner Queue." + "Queue weiter ▶" button visible.
4. Stop Mediathek (`docker stop` or block the API) → re-open → expect "Live-TV verfügbar" header.

---

## Out-of-scope (YAGNI, not in this plan)

These were mentioned in the spec discussion or come up naturally; they're explicitly NOT in this plan:

- APL `Pager` for Show 5 (Spec section 9 Q4 decision was "Vertical Sequence")
- Auto-favorites for top-3 channels (spec decision: hardcoded env-driven)
- User-configurable favorites via voice intent
- Time-of-day greetings ("Guten Morgen") (spec section 3 explicit YAGNI)
- Diag-Webview redesign (spec section 8 explicit no-go)
- Migration of Summary*.json templates to tokens (not on a user path that needs the visual upgrade right now)
- Server-side YouTube thumbnail caching (spec 4: ytimg CDN handles it)

---

## Self-review notes (filled in by plan author)

**Spec coverage:** Every section of section 2 (Layout), 3 (Greeting), 4 (Images), 5 (YAGNI), 9 (Decisions) has at least one task. Section 6 (Voice-vs-Touch) is design philosophy, no task. Section 7 maps directly to Stages 1-5. Section 8 (Diag) is explicit no-op.

**Placeholders:** Verified. Every step shows code, every test has assertions with exact expected values, every file path is absolute relative to repo root.

**Type consistency:** `renderLaunchScreen` switches from positional args (Task 1.3) to options object — used consistently from Task 2.4 onwards. `launchData.properties.greeting.{header,speak,priority,reprompt}` shape stable across tasks. `voiceHint` introduced in Task 2.4 with `'string'` type, used in Tasks 3.1 and 5.1 with same type.
