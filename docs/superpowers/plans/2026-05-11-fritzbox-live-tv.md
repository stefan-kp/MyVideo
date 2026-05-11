# FRITZ!Box Live-TV Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add FRITZ!Box DVB-C live TV as the primary live-streaming source for the MyVideo Alexa skill, with public HLS as fallback for shared channels.

**Architecture:** A new source abstraction layer (`lib/sources/`) introduces a per-channel `resolveStream()` interface with HLS and FRITZ!Box implementations. A FRITZ!Box adapter (`lib/fritzbox/`) handles login/SID, M3U-to-RTSP resolution, and a single-slot FFmpeg pipeline that transcodes RTSP to HLS. The Alexa skill UI gets a new live-TV quickbar on launch and category quick-actions for sport/culture.

**Tech Stack:** Node.js 18+, Express, axios, jsonwebtoken, FFmpeg/ffprobe (subprocess), Alexa ASK SDK, APL.

**Reference:** [docs/superpowers/specs/2026-05-11-fritzbox-live-tv-design.md](../specs/2026-05-11-fritzbox-live-tv-design.md)

---

## File Structure Overview

### New files
- `lib/sources/Channel.js` — base channel class with `resolveStream()` interface + `ChannelWithFallback`
- `lib/sources/hlsSource.js` — HLS channel implementation (today's behaviour, extracted)
- `lib/sources/fritzboxSource.js` — FRITZ!Box channel implementation
- `lib/fritzbox/session.js` — FRITZ!Box login + SID auto-renew
- `lib/fritzbox/channels.json` — curated channel data (26 entries)
- `lib/fritzbox/discovery.js` — verify TunerIDs against FRITZ!Box at startup
- `lib/fritzbox/m3uResolver.js` — fetch `dvb/m3u/<tunerId>.m3u` → extract RTSP URL
- `lib/fritzbox/codecProbe.js` — ffprobe + cache pipeline choice (copy vs transcode)
- `lib/fritzbox/streamer.js` — single-slot FFmpeg state machine
- `test/fritzboxSession.test.js` — login mock test
- `test/m3uResolver.test.js` — M3U parsing test
- `test/codecProbe.test.js` — pipeline-decision test
- `test/sourceChannel.test.js` — Channel + ChannelWithFallback test
- `test/fritzboxStreamer.test.js` — streamer state-machine test (mock spawn)
- `scripts/test-fritzbox.js` — manual integration test runner

### Modified files
- `lib/channels.js` — multi-source registry merging HLS + FRITZ!Box
- `lib/hlsProxy.js` — export `checkStreamAvailable` already done; nothing else
- `skill/handlers/PlayChannelHandler.js` — call `channel.resolveStream()`
- `skill/handlers/TouchEventHandler.js` — same call in `handleSelectChannel`
- `skill/handlers/LaunchHandler.js` — pass live-TV quickbar entries to APL helper
- `skill/handlers/PlayCategoryHandler.js` — append ORF SPORT+ / ORF III quick-action
- `skill/apl/LaunchTemplate.json` — add live-TV quickbar row at top
- `lib/aplHelper.js` — expand `renderLaunchScreen` signature with `liveTVChannels`
- `lib/aplHelper.js` — expand `renderNewsList` signature with optional `liveQuickAction`
- `skill/apl/NewsListTemplate.json` — render optional live-quick-action tile
- `skill/model/de-DE.json` — extend `CHANNEL_NAME` slot with new sender values + synonyms
- `scripts/download-logos.sh` — add new logo filenames
- `server.js` — secure `/stream/` route with JWT auth middleware
- `Dockerfile` — install `ffmpeg`
- `.env.example` — add FRITZBOX_* variables, remove STREAM_URL
- `README.md` — document FRITZ!Box setup (curated user creation, env vars)

### Deleted files
- `scripts/start-stream.sh` (legacy, replaced by streamer.js)

---

## Phase A — Source abstraction (no FRITZ!Box yet)

### Task 1: Add Channel base class with ChannelWithFallback

**Files:**
- Create: `lib/sources/Channel.js`
- Test: `test/sourceChannel.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/sourceChannel.test.js`:

```js
#!/usr/bin/env node
/**
 * Channel + ChannelWithFallback Test
 * Run: node test/sourceChannel.test.js
 */
const { Channel, ChannelWithFallback } = require('../lib/sources/Channel');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) { console.log(`  ✓ ${message}`); passed++; }
  else { console.error(`  ✗ ${message}`); failed++; }
}

async function testChannelBase() {
  console.log('\n--- Channel base ---');
  const ch = new Channel({
    id: 'foo', displayName: 'Foo', synonyms: ['foo'],
    logoUrl: 'http://x/foo.png', group: 'Test', source: 'test'
  });
  assert(ch.id === 'foo', 'id stored');
  assert(ch.displayName === 'Foo', 'displayName stored');
  assert(ch.source === 'test', 'source stored');
  let threw = false;
  try { await ch.resolveStream(); } catch (e) { threw = true; }
  assert(threw, 'base resolveStream() throws (must be subclassed)');
}

async function testFallbackPrimarySucceeds() {
  console.log('\n--- Fallback: primary succeeds ---');
  const primary = new Channel({ id: 'p', displayName: 'P', synonyms: [], logoUrl: '', group: 'g', source: 's' });
  primary.resolveStream = async () => ({ url: 'PRIMARY', mimeType: 'm', isLive: true });
  const fallback = new Channel({ id: 'f', displayName: 'F', synonyms: [], logoUrl: '', group: 'g', source: 's' });
  fallback.resolveStream = async () => ({ url: 'FALLBACK', mimeType: 'm', isLive: true });
  const ch = new ChannelWithFallback(primary, fallback);
  const out = await ch.resolveStream();
  assert(out.url === 'PRIMARY', 'primary URL returned');
}

async function testFallbackPrimaryFails() {
  console.log('\n--- Fallback: primary fails, fallback succeeds ---');
  const primary = new Channel({ id: 'p', displayName: 'P', synonyms: [], logoUrl: '', group: 'g', source: 's' });
  primary.resolveStream = async () => { throw new Error('primary down'); };
  const fallback = new Channel({ id: 'f', displayName: 'F', synonyms: [], logoUrl: '', group: 'g', source: 's' });
  fallback.resolveStream = async () => ({ url: 'FALLBACK', mimeType: 'm', isLive: true });
  const ch = new ChannelWithFallback(primary, fallback);
  const out = await ch.resolveStream();
  assert(out.url === 'FALLBACK', 'fallback URL returned');
}

async function testFallbackBothFail() {
  console.log('\n--- Fallback: both fail ---');
  const primary = new Channel({ id: 'p', displayName: 'P', synonyms: [], logoUrl: '', group: 'g', source: 's' });
  primary.resolveStream = async () => { throw new Error('primary down'); };
  const fallback = new Channel({ id: 'f', displayName: 'F', synonyms: [], logoUrl: '', group: 'g', source: 's' });
  fallback.resolveStream = async () => { throw new Error('fallback down'); };
  const ch = new ChannelWithFallback(primary, fallback);
  let err;
  try { await ch.resolveStream(); } catch (e) { err = e; }
  assert(err && err.message.includes('primary down'), 'primary error propagated when both fail');
}

(async () => {
  await testChannelBase();
  await testFallbackPrimarySucceeds();
  await testFallbackPrimaryFails();
  await testFallbackBothFail();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node test/sourceChannel.test.js
```

Expected: Cannot find module `'../lib/sources/Channel'`

- [ ] **Step 3: Implement Channel.js**

Create `lib/sources/Channel.js`:

```js
/**
 * Channel - base class for all live-TV sources.
 * Subclasses must implement resolveStream().
 */
class Channel {
  constructor({ id, displayName, synonyms, logoUrl, group, source }) {
    this.id = id;
    this.displayName = displayName;
    this.synonyms = synonyms || [];
    this.logoUrl = logoUrl || '';
    this.group = group || '';
    this.source = source;
  }

  // Backwards compatibility: legacy code reads ch.name and ch.url/logo
  get name() { return this.displayName; }
  get logo() { return this.logoUrl; }

  async resolveStream() {
    throw new Error(`resolveStream() not implemented for source=${this.source}`);
  }
}

/**
 * Wraps two channels - tries primary, falls back to secondary on error.
 * Identity (id/displayName/logo/group) is taken from primary.
 */
class ChannelWithFallback extends Channel {
  constructor(primary, fallback) {
    super({
      id: primary.id,
      displayName: primary.displayName,
      synonyms: primary.synonyms,
      logoUrl: primary.logoUrl,
      group: primary.group,
      source: primary.source,
    });
    this.primary = primary;
    this.fallback = fallback;
  }

  async resolveStream() {
    try {
      return await this.primary.resolveStream();
    } catch (primaryErr) {
      try {
        return await this.fallback.resolveStream();
      } catch (fallbackErr) {
        // Surface primary error - that's the one the user would expect to debug first
        throw primaryErr;
      }
    }
  }
}

module.exports = { Channel, ChannelWithFallback };
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node test/sourceChannel.test.js
```

Expected: `4 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add lib/sources/Channel.js test/sourceChannel.test.js
git commit -m "Add Channel base class and ChannelWithFallback wrapper"
```

---

### Task 2: Extract today's HLS behaviour into HlsSource

**Files:**
- Create: `lib/sources/hlsSource.js`
- Modify: `lib/hlsProxy.js` (already exports `checkStreamAvailable` — no change needed; verify)

- [ ] **Step 1: Extend test file**

Append to `test/sourceChannel.test.js` (before the final IIFE):

```js
async function testHlsSource() {
  console.log('\n--- HlsSource ---');
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-1234567890abcdef1234567890abcdef';
  process.env.BASE_URL = 'http://localhost:3000';
  const { HlsSource } = require('../lib/sources/hlsSource');

  const ch = new HlsSource({
    id: 'Test_HD',
    displayName: 'Test HD',
    upstreamUrl: 'https://example.com/master.m3u8',
    logoUrl: 'http://x/t.png',
    group: 'Test',
  });
  assert(ch.id === 'Test_HD', 'id stored');
  assert(ch.source === 'hls', 'source is hls');

  // Mock the availability check via dependency injection
  ch._checkAvailable = async () => ({ available: true, status: 200 });
  const stream = await ch.resolveStream();
  assert(stream.url.includes('/proxy/live/Test_HD/master.m3u8'), 'URL uses proxy route');
  assert(stream.url.includes('token='), 'URL includes token');
  assert(stream.mimeType === 'application/vnd.apple.mpegurl', 'mimeType correct');
  assert(stream.isLive === true, 'isLive true');

  ch._checkAvailable = async () => ({ available: false, status: 403 });
  let err;
  try { await ch.resolveStream(); } catch (e) { err = e; }
  assert(err && err.message.toLowerCase().includes('geo'), 'geo-block error on 403');

  ch._checkAvailable = async () => ({ available: false, status: 502 });
  try { await ch.resolveStream(); } catch (e) { err = e; }
  assert(err && err.message.toLowerCase().includes('nicht erreichbar'), 'generic error on 5xx');
}
```

And add `await testHlsSource();` to the IIFE list.

- [ ] **Step 2: Run test to verify it fails**

```bash
node test/sourceChannel.test.js
```

Expected: Cannot find module `'../lib/sources/hlsSource'`

- [ ] **Step 3: Implement HlsSource**

Create `lib/sources/hlsSource.js`:

```js
const { Channel } = require('./Channel');
const { generateStreamToken } = require('../auth');
const { checkStreamAvailable } = require('../hlsProxy');

/**
 * HlsSource - channel served via public HLS upstream, proxied through /proxy/live/.
 * This is the behaviour the skill had before FRITZ!Box support.
 */
class HlsSource extends Channel {
  constructor({ id, displayName, synonyms, upstreamUrl, logoUrl, group }) {
    super({ id, displayName, synonyms, logoUrl, group, source: 'hls' });
    this.upstreamUrl = upstreamUrl;
    // Dependency-injection seam for tests
    this._checkAvailable = (url) => checkStreamAvailable(url);
  }

  async resolveStream() {
    const check = await this._checkAvailable(this.upstreamUrl);
    if (!check.available) {
      if (check.status === 403) {
        throw new Error(`${this.displayName} ist gerade geo-blockiert.`);
      }
      throw new Error(`${this.displayName} ist gerade nicht erreichbar.`);
    }
    const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
    const token = generateStreamToken(this.id);
    return {
      url: `${baseUrl}/proxy/live/${this.id}/master.m3u8?token=${token}`,
      mimeType: 'application/vnd.apple.mpegurl',
      isLive: true,
    };
  }
}

module.exports = { HlsSource };
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node test/sourceChannel.test.js
```

Expected: `8 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add lib/sources/hlsSource.js test/sourceChannel.test.js
git commit -m "Add HlsSource extracting today's proxy-based HLS behaviour"
```

---

### Task 3: Refactor lib/channels.js to use HlsSource (registry, no behavioural change yet)

**Files:**
- Modify: `lib/channels.js`
- Test: existing call-sites (manual sanity by `npm start`)

- [ ] **Step 1: Read current channels.js**

```bash
cat lib/channels.js
```

Note the public API: `findChannel`, `findChannelById`, `listChannels`, `loadChannels`, `getLogoUrl`, `getLogoUrlForChannel`. These must keep their shape.

- [ ] **Step 2: Write a registry round-trip test**

Create `test/channelsRegistry.test.js`:

```js
#!/usr/bin/env node
/**
 * channels.js registry test - verifies HLS sources still resolve correctly
 * Run: node test/channelsRegistry.test.js
 */
process.env.JWT_SECRET = 'test-secret-1234567890abcdef1234567890abcdef';
process.env.BASE_URL = 'http://localhost:3000';

const channels = require('../lib/channels');

let passed = 0, failed = 0;
function assert(c, m) { if (c) { console.log(`  ✓ ${m}`); passed++; } else { console.error(`  ✗ ${m}`); failed++; } }

(async () => {
  console.log('\n--- findChannel ---');
  const zdf = channels.findChannel('zdf');
  assert(zdf, 'finds ZDF by synonym "zdf"');
  assert(zdf.id === 'ZDF_HD', 'returns ZDF_HD');
  assert(typeof zdf.resolveStream === 'function', 'has resolveStream()');
  assert(zdf.logo, 'has logo URL');

  console.log('\n--- listChannels ---');
  const groups = channels.listChannels();
  assert(Object.keys(groups).length > 0, 'returns at least one group');
  const allChannels = Object.values(groups).flat();
  assert(allChannels.length >= 9, `>= 9 channels (got ${allChannels.length})`);

  console.log('\n--- findChannelById ---');
  const phx = channels.findChannelById('Phoenix_HD');
  assert(phx && phx.id === 'Phoenix_HD', 'finds Phoenix_HD by id');

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
```

- [ ] **Step 3: Run test to verify it fails** (no behaviour-change yet, but `resolveStream` doesn't exist on today's plain objects)

```bash
node test/channelsRegistry.test.js
```

Expected: `has resolveStream()` fails.

- [ ] **Step 4: Rewrite lib/channels.js to use HlsSource**

Replace the entire contents of `lib/channels.js` with:

```js
const fs = require('fs');
const path = require('path');
const { HlsSource } = require('./sources/hlsSource');

const STREAMS_PATH = path.join(__dirname, '..', 'streams.json');

let channelMap = new Map();
let channelList = [];

const SYNONYMS = {
  'Das_Erste': ['das erste', 'ard', 'erstes', 'erstes programm', 'ard das erste', 'das erste ard'],
  'ONE': ['one', 'ard one', 'eins festival'],
  'ARD_alpha': ['ard alpha', 'alpha', 'br alpha'],
  'Tagesschau24': ['tagesschau24', 'tagesschau', 'tagesschau 24'],
  'ZDF_HD': ['zdf', 'zdf hd', 'zweites', 'zweites programm', 'zweites deutsches fernsehen'],
  'ZDFneo_HD': ['zdf neo', 'neo', 'zdfneo'],
  'ZDFinfo_HD': ['zdf info', 'zdfinfo', 'zdf information'],
  '3sat_HD': ['3sat', 'drei sat', 'dreisat'],
  'Phoenix_HD': ['phoenix', 'phoenix hd'],
};

const LOGO_FILES = {
  'Das_Erste': 'das_erste_hd.png',
  'ONE': 'one_hd.png',
  'ARD_alpha': 'ard_alpha_hd.png',
  'Tagesschau24': 'tagesschau24_hd.png',
  'ZDF_HD': 'zdf_hd.png',
  'ZDFneo_HD': 'zdf_neo_hd.png',
  'ZDFinfo_HD': 'zdf_info_hd.png',
  '3sat_HD': '3sat_hd.png',
  'Phoenix_HD': 'phoenix_hd.png',
};

const CHANNEL_LOGO_MAP = {
  'ARD': 'das_erste_hd.png',
  'Das Erste': 'das_erste_hd.png',
  'ZDF': 'zdf_hd.png',
  'ORF': 'orf2o_hd.png',
  '3Sat': '3sat_hd.png',
  '3sat': '3sat_hd.png',
  'PHOENIX': 'phoenix_hd.png',
  'Phoenix': 'phoenix_hd.png',
  'BR': 'ard_alpha_hd.png',
  'SWR': 'das_erste_hd.png',
  'NDR': 'das_erste_hd.png',
  'WDR': 'das_erste_hd.png',
  'HR': 'das_erste_hd.png',
  'MDR': 'das_erste_hd.png',
  'RBB': 'das_erste_hd.png',
  'SR': 'das_erste_hd.png',
};

function getLogoUrl(id) {
  const file = LOGO_FILES[id];
  if (!file) return '';
  const base = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
  return `${base}/logos/${file}`;
}

function getLogoUrlForChannel(channelName) {
  if (!channelName) return '';
  const file = CHANNEL_LOGO_MAP[channelName];
  if (!file) return '';
  const base = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
  return `${base}/logos/${file}`;
}

function normalize(name) {
  return name.toLowerCase().replace(/[_\-\.]/g, ' ').replace(/\s+hd\s*$/i, '').replace(/\s+/g, ' ').trim();
}

function loadChannels() {
  const data = JSON.parse(fs.readFileSync(STREAMS_PATH, 'utf8'));
  channelMap.clear();
  channelList = [];

  for (const [group, chs] of Object.entries(data.liveTV || {})) {
    for (const [id, url] of Object.entries(chs)) {
      const channel = new HlsSource({
        id,
        displayName: id.replace(/_/g, ' '),
        synonyms: SYNONYMS[id] || [],
        upstreamUrl: url,
        logoUrl: getLogoUrl(id),
        group,
      });
      channelList.push(channel);
      channelMap.set(normalize(id), channel);
      for (const syn of channel.synonyms) {
        channelMap.set(normalize(syn), channel);
      }
    }
  }
}

function findChannel(spokenName) {
  if (!spokenName) return null;
  return channelMap.get(normalize(spokenName)) || null;
}

function listChannels() {
  const grouped = {};
  for (const ch of channelList) {
    if (!grouped[ch.group]) grouped[ch.group] = [];
    grouped[ch.group].push(ch);
  }
  return grouped;
}

function findChannelById(channelId) {
  return channelList.find(ch => ch.id === channelId) || null;
}

loadChannels();

module.exports = { findChannel, findChannelById, listChannels, loadChannels, getLogoUrl, getLogoUrlForChannel };
```

- [ ] **Step 5: Run test to verify it passes**

```bash
node test/channelsRegistry.test.js
```

Expected: `7 passed, 0 failed`

- [ ] **Step 6: Commit**

```bash
git add lib/channels.js test/channelsRegistry.test.js
git commit -m "Refactor channels.js to use HlsSource - keep public API stable"
```

---

### Task 4: Update PlayChannelHandler to call resolveStream()

**Files:**
- Modify: `skill/handlers/PlayChannelHandler.js`

- [ ] **Step 1: Read current file**

```bash
cat skill/handlers/PlayChannelHandler.js
```

- [ ] **Step 2: Replace handler body**

Edit `skill/handlers/PlayChannelHandler.js` — replace the whole file with:

```js
const Alexa = require('ask-sdk-core');
const channels = require('../../lib/channels');

const PlayChannelHandler = {
  canHandle(handlerInput) {
    return (
      Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === 'PlayChannelIntent'
    );
  },
  async handle(handlerInput) {
    const slot = handlerInput.requestEnvelope.request.intent.slots.channel;
    let channelName = slot.value;
    const resolutions = slot.resolutions?.resolutionsPerAuthority;
    if (resolutions && resolutions[0]?.values?.[0]) {
      channelName = resolutions[0].values[0].value.name;
    }

    console.log(`PlayChannelIntent: raw="${slot.value}", resolved="${channelName}"`);

    const channel = channels.findChannel(channelName);
    if (!channel) {
      return handlerInput.responseBuilder
        .speak(`Ich kenne den Sender ${slot.value} leider nicht. Sage zum Beispiel: spiele ZDF.`)
        .reprompt('Welchen Sender moechtest du sehen?')
        .getResponse();
    }

    let stream;
    try {
      stream = await channel.resolveStream();
    } catch (err) {
      console.log(`Stream nicht verfuegbar: ${channel.displayName} - ${err.message}`);
      return handlerInput.responseBuilder
        .speak(`${channel.displayName} kann leider nicht gestartet werden. ${err.message} Moechtest du einen anderen Sender sehen?`)
        .reprompt('Welchen Sender moechtest du sehen?')
        .withShouldEndSession(false)
        .getResponse();
    }

    console.log(`Starte Sender: ${channel.displayName} (${channel.group}) -> ${stream.url}`);

    return handlerInput.responseBuilder
      .speak(`Starte ${channel.displayName}.`)
      .addVideoAppLaunchDirective(stream.url, channel.displayName, `${channel.group} - ${channel.displayName}`)
      .getResponse();
  }
};

module.exports = PlayChannelHandler;
```

- [ ] **Step 3: Verify the skill still loads (smoke test)**

```bash
node -e "require('./skill/handlers/PlayChannelHandler'); console.log('OK')"
```

Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add skill/handlers/PlayChannelHandler.js
git commit -m "PlayChannelHandler: use Channel.resolveStream() abstraction"
```

---

### Task 5: Update TouchEventHandler.handleSelectChannel to call resolveStream()

**Files:**
- Modify: `skill/handlers/TouchEventHandler.js`

- [ ] **Step 1: Edit the file**

In `skill/handlers/TouchEventHandler.js`:

- Remove imports for `generateStreamToken`, `checkStreamAvailable`, and the `BASE_URL` constant (still used by other functions? — check; if not, remove)
- Replace the body of `handleSelectChannel`:

```js
async function handleSelectChannel(handlerInput, channelId) {
  const channel = channels.findChannelById(channelId);

  if (!channel) {
    return handlerInput.responseBuilder
      .speak('Sender nicht gefunden.')
      .getResponse();
  }

  let stream;
  try {
    stream = await channel.resolveStream();
  } catch (err) {
    console.log(`Touch selectChannel: ${channel.displayName} nicht verfuegbar - ${err.message}`);
    return handlerInput.responseBuilder
      .speak(`${channel.displayName} kann nicht gestartet werden. ${err.message}`)
      .reprompt('Welchen Sender moechtest du sehen?')
      .withShouldEndSession(false)
      .getResponse();
  }

  console.log(`Touch selectChannel: ${channel.displayName} -> ${stream.url}`);

  return handlerInput.responseBuilder
    .speak(`Starte ${channel.displayName}.`)
    .addVideoAppLaunchDirective(stream.url, channel.displayName, `${channel.group} - ${channel.displayName}`)
    .getResponse();
}
```

Also remove the obsolete imports at the top:
- Delete: `const { generateStreamToken } = require('../../lib/auth');`
- Delete: `const { checkStreamAvailable } = require('../../lib/hlsProxy');`
- Delete: `const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';`

- [ ] **Step 2: Smoke test**

```bash
node -e "require('./skill/handlers/TouchEventHandler'); console.log('OK')"
```

Expected: `OK`

- [ ] **Step 3: Run all tests**

```bash
node test/sourceChannel.test.js && node test/channelsRegistry.test.js
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add skill/handlers/TouchEventHandler.js
git commit -m "TouchEventHandler: use Channel.resolveStream() in handleSelectChannel"
```

**Phase A complete — source abstraction in place, behaviour unchanged.**

---

## Phase B — FRITZ!Box adapter & FFmpeg pipeline

### Task 6: FRITZ!Box session (login + SID auto-renew)

**Files:**
- Create: `lib/fritzbox/session.js`
- Test: `test/fritzboxSession.test.js`

Reference for the login flow: FRITZ!Box `/login_sid.lua?version=2` returns XML `<Challenge>` (format `2$iter1$salt1$iter2$salt2`). Response is computed as PBKDF2-HMAC-SHA256 twice. Final login: `?username=X&response=salt2$hash`.

- [ ] **Step 1: Write failing test**

Create `test/fritzboxSession.test.js`:

```js
#!/usr/bin/env node
/**
 * FritzboxSession test - mocks HTTP via dependency injection
 * Run: node test/fritzboxSession.test.js
 */
const { FritzboxSession, computeResponse } = require('../lib/fritzbox/session');

let passed = 0, failed = 0;
function assert(c, m) { if (c) { console.log(`  ✓ ${m}`); passed++; } else { console.error(`  ✗ ${m}`); failed++; } }

async function testChallengeResponse() {
  console.log('\n--- computeResponse (PBKDF2-HMAC-SHA256) ---');
  // Known FRITZ!Box test vector (from AVM docs)
  // Challenge: 2$60000$salt1$6000$salt2
  // password: "1example!"
  // Expected response format: salt2$hex
  const challenge = '2$60000$1234567890abcdef$6000$abcdef1234567890';
  const password = '1example!';
  const resp = computeResponse(challenge, password);
  assert(resp.startsWith('abcdef1234567890$'), 'response begins with salt2$');
  assert(resp.length > 65, 'response includes hash after salt');
}

async function testSessionLogin() {
  console.log('\n--- FritzboxSession.getSid (mocked HTTP) ---');
  const calls = [];
  const fakeHttp = {
    async get(url) {
      calls.push(url);
      if (calls.length === 1) {
        // First call: get challenge
        return { data: '<SessionInfo><SID>0000000000000000</SID><Challenge>2$60000$salt1$6000$salt2</Challenge></SessionInfo>' };
      }
      // Second call: login response
      return { data: '<SessionInfo><SID>aabbccdd11223344</SID></SessionInfo>' };
    }
  };
  const sess = new FritzboxSession({ host: '192.168.0.1', user: 'tv', password: 'secret', httpClient: fakeHttp });
  const sid = await sess.getSid();
  assert(sid === 'aabbccdd11223344', 'returns SID after challenge-response');
  assert(calls.length === 2, 'made exactly 2 HTTP calls');
  assert(calls[0].includes('/login_sid.lua?version=2'), 'first call is challenge endpoint');
  assert(calls[1].includes('username=tv'), 'second call passes username');
  assert(calls[1].includes('response=salt2$'), 'second call passes response');
}

async function testSessionCached() {
  console.log('\n--- FritzboxSession.getSid (cached) ---');
  let count = 0;
  const fakeHttp = {
    async get(url) {
      count++;
      if (count === 1) return { data: '<SessionInfo><SID>0000000000000000</SID><Challenge>2$60000$s1$6000$s2</Challenge></SessionInfo>' };
      return { data: '<SessionInfo><SID>cachedsid12345</SID></SessionInfo>' };
    }
  };
  const sess = new FritzboxSession({ host: '192.168.0.1', user: 'tv', password: 'p', httpClient: fakeHttp });
  const a = await sess.getSid();
  const b = await sess.getSid();
  assert(a === b, 'second call returns same SID');
  assert(count === 2, 'no extra HTTP calls (only initial login)');
}

async function testInvalidate() {
  console.log('\n--- FritzboxSession.invalidate ---');
  let count = 0;
  const sids = ['firstsid01234567', 'secondsid1234567'];
  const fakeHttp = {
    async get(url) {
      count++;
      if (url.includes('username=')) {
        const sid = sids.shift();
        return { data: `<SessionInfo><SID>${sid}</SID></SessionInfo>` };
      }
      return { data: '<SessionInfo><SID>0000000000000000</SID><Challenge>2$60000$s1$6000$s2</Challenge></SessionInfo>' };
    }
  };
  const sess = new FritzboxSession({ host: '192.168.0.1', user: 'tv', password: 'p', httpClient: fakeHttp });
  const first = await sess.getSid();
  sess.invalidate();
  const second = await sess.getSid();
  assert(first === 'firstsid01234567', 'first SID');
  assert(second === 'secondsid1234567', 'second SID after invalidate');
}

async function testWithSidRetriesOn403() {
  console.log('\n--- FritzboxSession.withSid (retry on 403) ---');
  let loginCount = 0;
  const fakeHttp = {
    async get(url) {
      if (url.includes('username=')) {
        loginCount++;
        return { data: `<SessionInfo><SID>sid${loginCount}aaaaaaaaaa</SID></SessionInfo>` };
      }
      return { data: '<SessionInfo><SID>0000000000000000</SID><Challenge>2$60000$s1$6000$s2</Challenge></SessionInfo>' };
    }
  };
  const sess = new FritzboxSession({ host: '192.168.0.1', user: 'tv', password: 'p', httpClient: fakeHttp });

  let attempt = 0;
  const result = await sess.withSid(async (sid) => {
    attempt++;
    if (attempt === 1) {
      const err = new Error('forbidden'); err.response = { status: 403 }; throw err;
    }
    return `ok-${sid}`;
  });
  assert(result === 'ok-sid2aaaaaaaaaa', 'second attempt with renewed SID succeeded');
  assert(loginCount === 2, 'logged in twice (initial + retry)');
}

(async () => {
  await testChallengeResponse();
  await testSessionLogin();
  await testSessionCached();
  await testInvalidate();
  await testWithSidRetriesOn403();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
```

- [ ] **Step 2: Run to verify failure**

```bash
node test/fritzboxSession.test.js
```

Expected: Cannot find module.

- [ ] **Step 3: Implement session.js**

Create `lib/fritzbox/session.js`:

```js
const crypto = require('crypto');
const axios = require('axios');

/**
 * Compute FRITZ!Box challenge-response (PBKDF2-HMAC-SHA256, AVM v2 protocol).
 * Challenge format: "2$iter1$salt1$iter2$salt2"
 * Response format:  "salt2$<hex>"
 */
function computeResponse(challenge, password) {
  const parts = challenge.split('$');
  if (parts.length !== 5 || parts[0] !== '2') {
    throw new Error(`Unsupported challenge format: ${challenge}`);
  }
  const iter1 = parseInt(parts[1], 10);
  const salt1 = Buffer.from(parts[2], 'hex');
  const iter2 = parseInt(parts[3], 10);
  const salt2 = Buffer.from(parts[4], 'hex');

  const hash1 = crypto.pbkdf2Sync(password, salt1, iter1, 32, 'sha256');
  const hash2 = crypto.pbkdf2Sync(hash1, salt2, iter2, 32, 'sha256');
  return `${parts[4]}$${hash2.toString('hex')}`;
}

function extract(xml, tag) {
  const m = new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(xml);
  return m ? m[1] : null;
}

class FritzboxSession {
  constructor({ host, user, password, httpClient }) {
    if (!host || !user || !password) {
      throw new Error('FritzboxSession requires host, user, password');
    }
    this.host = host;
    this.user = user;
    this.password = password;
    this.http = httpClient || axios;
    this.sid = null;
  }

  invalidate() {
    this.sid = null;
  }

  async getSid() {
    if (this.sid) return this.sid;
    return this._login();
  }

  async _login() {
    const challengeUrl = `http://${this.host}/login_sid.lua?version=2`;
    const challengeResp = await this.http.get(challengeUrl);
    const challenge = extract(challengeResp.data, 'Challenge');
    if (!challenge) throw new Error('No challenge in FRITZ!Box response');

    const response = computeResponse(challenge, this.password);
    const loginUrl = `http://${this.host}/login_sid.lua?version=2&username=${encodeURIComponent(this.user)}&response=${response}`;
    const loginResp = await this.http.get(loginUrl);
    const newSid = extract(loginResp.data, 'SID');
    if (!newSid || /^0+$/.test(newSid)) {
      throw new Error('FRITZ!Box login failed (invalid credentials?)');
    }
    this.sid = newSid;
    return this.sid;
  }

  /**
   * Wraps an operation that takes the SID. On HTTP 403, invalidate + retry once.
   * @param {(sid: string) => Promise<T>} fn
   */
  async withSid(fn) {
    const sid = await this.getSid();
    try {
      return await fn(sid);
    } catch (err) {
      if (err?.response?.status === 403) {
        this.invalidate();
        const newSid = await this.getSid();
        return await fn(newSid);
      }
      throw err;
    }
  }
}

// Singleton accessor (constructed from .env when first needed)
let _instance = null;
function getInstance() {
  if (_instance) return _instance;
  const host = process.env.FRITZBOX_HOST;
  const user = process.env.FRITZBOX_USER;
  const password = process.env.FRITZBOX_PASSWORD;
  if (!host || !user || !password) return null;
  _instance = new FritzboxSession({ host, user, password });
  return _instance;
}

function resetInstance() { _instance = null; }

module.exports = { FritzboxSession, computeResponse, getInstance, resetInstance };
```

- [ ] **Step 4: Run tests**

```bash
node test/fritzboxSession.test.js
```

Expected: `12 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add lib/fritzbox/session.js test/fritzboxSession.test.js
git commit -m "Add FritzboxSession with PBKDF2 login and SID auto-renew"
```

---

### Task 7: Curated channel data (`lib/fritzbox/channels.json`)

**Files:**
- Create: `lib/fritzbox/channels.json`

- [ ] **Step 1: Create the JSON**

Create `lib/fritzbox/channels.json`:

```json
{
  "_comment": "Curated FRITZ!Box channel list. tunerId is from the FRITZ!Box HD listing at /dvb/tvhd.lua. If FRITZ!Box re-scan changes IDs, update here.",
  "channels": [
    { "id": "orf1",            "tunerId": "40200_1010", "displayName": "ORF 1",              "synonyms": ["orf eins", "orf1"],                       "group": "ORF",            "logoFile": "orf1_hd.png" },
    { "id": "orf2t",           "tunerId": "40200_1020", "displayName": "ORF 2 Tirol",        "synonyms": ["orf zwei", "orf 2", "orf 2 tirol"],       "group": "ORF",            "logoFile": "orf2t_hd.png" },
    { "id": "orf3",            "tunerId": "41800_3020", "displayName": "ORF III",            "synonyms": ["orf drei", "orf 3", "orf iii"],           "group": "ORF",            "logoFile": "orf_iii_hd.png" },
    { "id": "orfSport",        "tunerId": "45000_7030", "displayName": "ORF SPORT+",         "synonyms": ["orf sport plus", "orf sport"],            "group": "Sport",          "logoFile": "orf_sport+_hd.png" },
    { "id": "servustv",        "tunerId": "41000_2010", "displayName": "ServusTV",           "synonyms": ["servus tv", "servus"],                    "group": "Privat AT",      "logoFile": "servustv_hd_oesterreich.png" },
    { "id": "atv",             "tunerId": "40200_1030", "displayName": "ATV",                "synonyms": ["atv hd"],                                  "group": "Privat AT",      "logoFile": "atv_hd.png" },
    { "id": "puls24",          "tunerId": "45000_7010", "displayName": "PULS 24",            "synonyms": ["puls vierundzwanzig", "puls 24"],         "group": "Privat AT",      "logoFile": "puls_24_hd.png" },
    { "id": "pro7at",          "tunerId": "42600_4040", "displayName": "ProSieben",          "synonyms": ["pro sieben", "prosieben", "prosieben austria"], "group": "Privat DE", "logoFile": "prosieben_austria.png" },
    { "id": "sat1at",          "tunerId": "42600_4020", "displayName": "SAT.1",              "synonyms": ["sat eins", "sat 1", "sat.1"],             "group": "Privat DE",      "logoFile": "sat1_a.png" },
    { "id": "rtlat",           "tunerId": "42600_4030", "displayName": "RTL",                "synonyms": ["rtl austria"],                            "group": "Privat DE",      "logoFile": "rtl_austria.png" },
    { "id": "voxat",           "tunerId": "43400_5030", "displayName": "VOX",                "synonyms": ["vox austria"],                            "group": "Privat DE",      "logoFile": "vox_austria.png" },
    { "id": "dasErsteHd",      "tunerId": "41000_2020", "displayName": "Das Erste",          "synonyms": ["ard", "erstes", "das erste"],             "group": "Öffentlich DE",  "logoFile": "das_erste_hd.png" },
    { "id": "zdfHd",           "tunerId": "41000_2030", "displayName": "ZDF",                "synonyms": ["zweites", "zdf hd"],                      "group": "Öffentlich DE",  "logoFile": "zdf_hd.png" },
    { "id": "3satHd",          "tunerId": "42600_4010", "displayName": "3sat",               "synonyms": ["drei sat", "dreisat"],                    "group": "Öffentlich DE",  "logoFile": "3sat_hd.png" },
    { "id": "arteHd",          "tunerId": "44200_6030", "displayName": "arte",               "synonyms": ["arte hd"],                                "group": "Öffentlich DE",  "logoFile": "arte_hd.png" },
    { "id": "phoenixHd",       "tunerId": "46600_9040", "displayName": "Phoenix",            "synonyms": ["phoenix hd"],                             "group": "Öffentlich DE",  "logoFile": "phoenix_hd.png" },
    { "id": "tagesschau24Hd",  "tunerId": "49000_12010","displayName": "Tagesschau 24",      "synonyms": ["tagesschau", "tagesschau 24"],            "group": "Öffentlich DE",  "logoFile": "tagesschau24_hd.png" },
    { "id": "zdfinfoHd",       "tunerId": "57000_22040","displayName": "ZDFinfo",            "synonyms": ["zdf info", "zdfinfo"],                    "group": "Öffentlich DE",  "logoFile": "zdf_info_hd.png" },
    { "id": "ardAlphaHd",      "tunerId": "58600_24010","displayName": "ARD alpha",          "synonyms": ["alpha", "ard alpha"],                     "group": "Öffentlich DE",  "logoFile": "ard_alpha_hd.png" },
    { "id": "oneHd",           "tunerId": "49000_12030","displayName": "ONE",                "synonyms": ["one hd", "ard one"],                      "group": "Öffentlich DE",  "logoFile": "one_hd.png" },
    { "id": "kikaHd",          "tunerId": "45800_8030", "displayName": "KiKA",               "synonyms": ["kika"],                                    "group": "Öffentlich DE",  "logoFile": "kika_hd.png" },
    { "id": "bbcWorld",        "tunerId": "53000_17010","displayName": "BBC World News",     "synonyms": ["bbc news", "bbc", "bbc world"],           "group": "International",  "logoFile": "bbc_world_news_hd.png" },
    { "id": "aljazeera",       "tunerId": "60200_26030","displayName": "Al Jazeera English", "synonyms": ["al jazeera", "aljazeera"],                "group": "International",  "logoFile": "al_jazeera_english_hd.png" },
    { "id": "france24",        "tunerId": "53000_17040","displayName": "France 24",          "synonyms": ["france 24", "france vierundzwanzig"],     "group": "International",  "logoFile": "france_24_hd.png" },
    { "id": "cnbc",            "tunerId": "53000_17020","displayName": "CNBC",               "synonyms": ["cnbc hd"],                                "group": "International",  "logoFile": "cnbc_hd.png" },
    { "id": "nhk",             "tunerId": "58600_24030","displayName": "NHK World",          "synonyms": ["nhk", "nhk world"],                       "group": "International",  "logoFile": "nhk_worldjpn.png" }
  ]
}
```

- [ ] **Step 2: Verify JSON is valid**

```bash
node -e "console.log(JSON.parse(require('fs').readFileSync('lib/fritzbox/channels.json','utf8')).channels.length, 'channels')"
```

Expected: `26 channels`

- [ ] **Step 3: Commit**

```bash
git add lib/fritzbox/channels.json
git commit -m "Add curated FRITZ!Box channel list (26 channels)"
```

---

### Task 8: Channel discovery / verification

**Files:**
- Create: `lib/fritzbox/discovery.js`

- [ ] **Step 1: Write the function**

Create `lib/fritzbox/discovery.js`:

```js
const axios = require('axios');

/**
 * Verify that all curated tunerIds exist in the FRITZ!Box HD channel listing.
 * Returns { ok: [], missing: [] }.
 * Throws if the FRITZ!Box itself is unreachable.
 */
async function verifyTuners(session, curatedChannels) {
  const sid = await session.getSid();
  const url = `http://${session.host}/dvb/tvhd.lua?sid=${sid}`;
  const resp = await axios.get(url, { timeout: 5000 });

  // Parse all tunerIds from HTML: href="dvb/m3u/<id>.m3u..."
  const idRegex = /href="dvb\/m3u\/(\d+_\d+)\.m3u/g;
  const fritzIds = new Set();
  let m;
  while ((m = idRegex.exec(resp.data)) !== null) {
    fritzIds.add(m[1]);
  }

  const ok = [];
  const missing = [];
  for (const ch of curatedChannels) {
    if (fritzIds.has(ch.tunerId)) ok.push(ch.id);
    else missing.push({ id: ch.id, tunerId: ch.tunerId, displayName: ch.displayName });
  }
  return { ok, missing, fritzCount: fritzIds.size };
}

module.exports = { verifyTuners };
```

- [ ] **Step 2: Smoke test (load + signature only — no real FRITZ!Box call)**

```bash
node -e "const d = require('./lib/fritzbox/discovery'); console.log(typeof d.verifyTuners)"
```

Expected: `function`

- [ ] **Step 3: Commit**

```bash
git add lib/fritzbox/discovery.js
git commit -m "Add FRITZ!Box tuner-ID verification against /dvb/tvhd.lua"
```

---

### Task 9: M3U → RTSP URL resolver

**Files:**
- Create: `lib/fritzbox/m3uResolver.js`
- Test: `test/m3uResolver.test.js`

- [ ] **Step 1: Write failing test**

Create `test/m3uResolver.test.js`:

```js
#!/usr/bin/env node
const { parseRtspFromM3u, M3uResolver } = require('../lib/fritzbox/m3uResolver');

let passed = 0, failed = 0;
function assert(c, m) { if (c) { console.log(`  ✓ ${m}`); passed++; } else { console.error(`  ✗ ${m}`); failed++; } }

function testParse() {
  console.log('\n--- parseRtspFromM3u ---');
  const m3u = '#EXTM3U\n#EXTINF:-1,ORF 1\nrtsp://192.168.0.1:554/?freq=474&pol=h&sr=27500\n';
  const url = parseRtspFromM3u(m3u);
  assert(url === 'rtsp://192.168.0.1:554/?freq=474&pol=h&sr=27500', 'extracts RTSP line');

  const empty = parseRtspFromM3u('#EXTM3U\nno rtsp here\n');
  assert(empty === null, 'returns null when no RTSP line');
}

async function testResolverCaching() {
  console.log('\n--- M3uResolver caching ---');
  let count = 0;
  const fakeSession = {
    host: '192.168.0.1',
    async getSid() { return 'fakesid12345678'; },
    async withSid(fn) { return fn('fakesid12345678'); },
  };
  const fakeHttp = {
    async get(url) {
      count++;
      return { data: '#EXTM3U\n#EXTINF:-1,X\nrtsp://192.168.0.1:554/?id=' + count + '\n' };
    }
  };
  const r = new M3uResolver({ session: fakeSession, httpClient: fakeHttp, ttlMs: 60000 });
  const a = await r.getRtspUrl('40200_1010');
  const b = await r.getRtspUrl('40200_1010');
  assert(a === b, 'cached result returned');
  assert(count === 1, 'only 1 HTTP call due to cache');

  const c = await r.getRtspUrl('40200_1020');
  assert(count === 2, 'different tuner triggers new fetch');
  assert(c !== a, 'different tuner returns different URL');
}

(async () => {
  testParse();
  await testResolverCaching();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
```

- [ ] **Step 2: Run to verify failure**

```bash
node test/m3uResolver.test.js
```

Expected: Cannot find module.

- [ ] **Step 3: Implement m3uResolver.js**

Create `lib/fritzbox/m3uResolver.js`:

```js
const axios = require('axios');

function parseRtspFromM3u(m3uText) {
  for (const line of m3uText.split('\n')) {
    const t = line.trim();
    if (t.toLowerCase().startsWith('rtsp://')) return t;
  }
  return null;
}

class M3uResolver {
  constructor({ session, httpClient, ttlMs }) {
    this.session = session;
    this.http = httpClient || axios;
    this.ttlMs = ttlMs || 3600000; // 1h
    this.cache = new Map(); // tunerId -> { url, expiresAt }
  }

  async getRtspUrl(tunerId) {
    const now = Date.now();
    const cached = this.cache.get(tunerId);
    if (cached && cached.expiresAt > now) return cached.url;

    const url = await this.session.withSid(async (sid) => {
      const u = `http://${this.session.host}/dvb/m3u/${tunerId}.m3u?sid=${sid}`;
      const resp = await this.http.get(u, { timeout: 5000 });
      const rtsp = parseRtspFromM3u(resp.data);
      if (!rtsp) throw new Error(`No RTSP URL in M3U for tuner ${tunerId}`);
      return rtsp;
    });

    this.cache.set(tunerId, { url, expiresAt: now + this.ttlMs });
    return url;
  }

  invalidate(tunerId) {
    if (tunerId) this.cache.delete(tunerId);
    else this.cache.clear();
  }
}

module.exports = { parseRtspFromM3u, M3uResolver };
```

- [ ] **Step 4: Run tests**

```bash
node test/m3uResolver.test.js
```

Expected: `5 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add lib/fritzbox/m3uResolver.js test/m3uResolver.test.js
git commit -m "Add M3uResolver that fetches and caches RTSP URLs per tuner"
```

---

### Task 10: Codec probe with persistent cache

**Files:**
- Create: `lib/fritzbox/codecProbe.js`
- Test: `test/codecProbe.test.js`

- [ ] **Step 1: Write failing test**

Create `test/codecProbe.test.js`:

```js
#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');
const { decidePipeline, CodecProbe } = require('../lib/fritzbox/codecProbe');

let passed = 0, failed = 0;
function assert(c, m) { if (c) { console.log(`  ✓ ${m}`); passed++; } else { console.error(`  ✗ ${m}`); failed++; } }

function testDecide() {
  console.log('\n--- decidePipeline ---');
  assert(decidePipeline({ video: 'h264', audio: 'aac' }) === 'copy', 'h264 -> copy');
  assert(decidePipeline({ video: 'h264', audio: 'ac3' }) === 'copy', 'h264+ac3 -> copy (audio re-enc anyway)');
  assert(decidePipeline({ video: 'mpeg2video', audio: 'mp2' }) === 'transcode', 'mpeg2 -> transcode');
  assert(decidePipeline({ video: 'hevc', audio: 'aac' }) === 'transcode', 'hevc (no echo show support) -> transcode');
}

async function testCacheRoundtrip() {
  console.log('\n--- CodecProbe cache roundtrip ---');
  const cacheFile = path.join(os.tmpdir(), `codecProbe.${Date.now()}.json`);
  let probeCount = 0;
  const fakeProbe = async (rtspUrl) => {
    probeCount++;
    return { video: 'h264', audio: 'ac3' };
  };
  const cp = new CodecProbe({ cacheFile, probeFn: fakeProbe });
  const a = await cp.getPipeline('40200_1010', 'rtsp://...');
  assert(a === 'copy', 'h264 source decided as copy');
  assert(probeCount === 1, 'probe called once');

  // Second call: cache hit
  const b = await cp.getPipeline('40200_1010', 'rtsp://...');
  assert(b === 'copy', 'cached value returned');
  assert(probeCount === 1, 'probe NOT called again');

  // New instance reads cache from disk
  const cp2 = new CodecProbe({ cacheFile, probeFn: fakeProbe });
  const c = await cp2.getPipeline('40200_1010', 'rtsp://...');
  assert(c === 'copy', 'persistent cache survives restart');
  assert(probeCount === 1, 'still no probe call');

  fs.unlinkSync(cacheFile);
}

async function testInvalidate() {
  console.log('\n--- CodecProbe invalidate ---');
  const cacheFile = path.join(os.tmpdir(), `codecProbe.${Date.now()}.${Math.random()}.json`);
  let count = 0;
  const fakeProbe = async () => ({ video: count++ === 0 ? 'h264' : 'mpeg2video', audio: 'aac' });
  const cp = new CodecProbe({ cacheFile, probeFn: fakeProbe });
  const a = await cp.getPipeline('TID', 'rtsp://x');
  cp.invalidate('TID');
  const b = await cp.getPipeline('TID', 'rtsp://x');
  assert(a === 'copy', 'first decision: copy');
  assert(b === 'transcode', 'after invalidate: re-probed, transcode');
  fs.unlinkSync(cacheFile);
}

(async () => {
  testDecide();
  await testCacheRoundtrip();
  await testInvalidate();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
```

- [ ] **Step 2: Run to verify failure**

```bash
node test/codecProbe.test.js
```

Expected: Cannot find module.

- [ ] **Step 3: Implement codecProbe.js**

Create `lib/fritzbox/codecProbe.js`:

```js
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

/**
 * Decide pipeline based on probe result.
 * - h264 video: "copy" (audio always re-encoded to AAC)
 * - everything else: "transcode" (Echo Show needs H.264 Main)
 */
function decidePipeline({ video }) {
  return video === 'h264' ? 'copy' : 'transcode';
}

/**
 * Probe RTSP source with ffprobe, return { video, audio } codec strings.
 * Times out after 5s.
 */
function defaultFfprobe(rtspUrl) {
  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'error',
      '-rtsp_transport', 'udp',
      '-analyzeduration', '2000000',
      '-probesize', '2000000',
      '-print_format', 'json',
      '-show_streams',
      '-i', rtspUrl,
    ];
    const proc = spawn('ffprobe', args);
    let out = '';
    let err = '';
    proc.stdout.on('data', (d) => { out += d; });
    proc.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => proc.kill('SIGKILL'), 5000);
    proc.on('exit', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`ffprobe exited ${code}: ${err.slice(0, 200)}`));
      try {
        const data = JSON.parse(out);
        const v = (data.streams || []).find(s => s.codec_type === 'video');
        const a = (data.streams || []).find(s => s.codec_type === 'audio');
        resolve({ video: v?.codec_name || 'unknown', audio: a?.codec_name || 'unknown' });
      } catch (e) {
        reject(e);
      }
    });
    proc.on('error', reject);
  });
}

class CodecProbe {
  constructor({ cacheFile, probeFn }) {
    this.cacheFile = cacheFile || path.join(__dirname, '..', '..', '.cache', 'codec-probe.json');
    this.probeFn = probeFn || defaultFfprobe;
    this._loadCache();
  }

  _loadCache() {
    try {
      this.cache = JSON.parse(fs.readFileSync(this.cacheFile, 'utf8'));
    } catch {
      this.cache = {};
    }
  }

  _saveCache() {
    try {
      fs.mkdirSync(path.dirname(this.cacheFile), { recursive: true });
      fs.writeFileSync(this.cacheFile, JSON.stringify(this.cache, null, 2));
    } catch (e) {
      console.error('CodecProbe cache save failed:', e.message);
    }
  }

  async getPipeline(tunerId, rtspUrl) {
    if (this.cache[tunerId]?.pipeline) return this.cache[tunerId].pipeline;
    const codecs = await this.probeFn(rtspUrl);
    const pipeline = decidePipeline(codecs);
    this.cache[tunerId] = { ...codecs, pipeline, probedAt: new Date().toISOString() };
    this._saveCache();
    return pipeline;
  }

  invalidate(tunerId) {
    if (tunerId) delete this.cache[tunerId];
    else this.cache = {};
    this._saveCache();
  }
}

module.exports = { CodecProbe, decidePipeline };
```

- [ ] **Step 4: Run tests**

```bash
node test/codecProbe.test.js
```

Expected: `9 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add lib/fritzbox/codecProbe.js test/codecProbe.test.js
git commit -m "Add CodecProbe with persistent ffprobe cache and pipeline decision"
```

---

### Task 11: FFmpeg streamer (single-slot state machine)

**Files:**
- Create: `lib/fritzbox/streamer.js`
- Test: `test/fritzboxStreamer.test.js`

- [ ] **Step 1: Write failing test**

Create `test/fritzboxStreamer.test.js`:

```js
#!/usr/bin/env node
/**
 * FritzboxStreamer test - mocks spawn() and filesystem events
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { EventEmitter } = require('events');
const { Streamer } = require('../lib/fritzbox/streamer');

let passed = 0, failed = 0;
function assert(c, m) { if (c) { console.log(`  ✓ ${m}`); passed++; } else { console.error(`  ✗ ${m}`); failed++; } }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function makeFakeProc() {
  const proc = new EventEmitter();
  proc.killed = false;
  proc.kill = (sig) => { proc.killed = sig; setTimeout(() => proc.emit('exit', 0, sig), 5); };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  return proc;
}

async function testStartTransitionsToPlaying() {
  console.log('\n--- start() -> PLAYING when segment appears ---');
  const streamDir = fs.mkdtempSync(path.join(os.tmpdir(), 'streamertest-'));
  let spawned = null;
  const s = new Streamer({
    streamDir,
    spawnFn: (cmd, args) => { spawned = { cmd, args }; return makeFakeProc(); },
    waitForSegmentFn: async () => { await sleep(5); return true; },
    resolveRtsp: async (tunerId) => `rtsp://fake/${tunerId}`,
    getPipeline: async () => 'copy',
  });

  const channel = { id: 'orf1', tunerId: '40200_1010', displayName: 'ORF 1' };
  const url = await s.start(channel);
  assert(spawned.cmd === 'ffmpeg', 'ffmpeg spawned');
  assert(spawned.args.includes('rtsp://fake/40200_1010'), 'rtsp URL passed');
  assert(spawned.args.includes('-c:v') && spawned.args.includes('copy'), 'copy codec path used');
  assert(url.endsWith('/stream/fritzbox/index.m3u8'), 'returns HLS URL path');
  assert(s.getCurrent()?.channelId === 'orf1', 'state reflects PLAYING(orf1)');

  await s.stop();
  fs.rmSync(streamDir, { recursive: true, force: true });
}

async function testSwitchChannelTerminatesPrevious() {
  console.log('\n--- start(B) while PLAYING(A) terminates A ---');
  const streamDir = fs.mkdtempSync(path.join(os.tmpdir(), 'streamertest-'));
  const procs = [];
  const s = new Streamer({
    streamDir,
    spawnFn: () => { const p = makeFakeProc(); procs.push(p); return p; },
    waitForSegmentFn: async () => { await sleep(5); return true; },
    resolveRtsp: async (t) => `rtsp://fake/${t}`,
    getPipeline: async () => 'copy',
  });

  await s.start({ id: 'a', tunerId: 't1', displayName: 'A' });
  await s.start({ id: 'b', tunerId: 't2', displayName: 'B' });

  assert(procs.length === 2, 'two ffmpeg processes spawned');
  assert(procs[0].killed === 'SIGTERM', 'first process received SIGTERM');
  assert(s.getCurrent()?.channelId === 'b', 'current is B');

  await s.stop();
  fs.rmSync(streamDir, { recursive: true, force: true });
}

async function testStartSameChannelNoOp() {
  console.log('\n--- start(A) while PLAYING(A) is no-op ---');
  const streamDir = fs.mkdtempSync(path.join(os.tmpdir(), 'streamertest-'));
  const procs = [];
  const s = new Streamer({
    streamDir,
    spawnFn: () => { const p = makeFakeProc(); procs.push(p); return p; },
    waitForSegmentFn: async () => { await sleep(5); return true; },
    resolveRtsp: async (t) => `rtsp://fake/${t}`,
    getPipeline: async () => 'copy',
  });

  await s.start({ id: 'a', tunerId: 't1', displayName: 'A' });
  await s.start({ id: 'a', tunerId: 't1', displayName: 'A' });

  assert(procs.length === 1, 'only one ffmpeg process spawned');

  await s.stop();
  fs.rmSync(streamDir, { recursive: true, force: true });
}

async function testWaitTimeoutFails() {
  console.log('\n--- start() rejects when segment never appears ---');
  const streamDir = fs.mkdtempSync(path.join(os.tmpdir(), 'streamertest-'));
  const s = new Streamer({
    streamDir,
    spawnFn: () => makeFakeProc(),
    waitForSegmentFn: async () => false,  // timeout
    resolveRtsp: async (t) => `rtsp://fake/${t}`,
    getPipeline: async () => 'copy',
  });

  let err;
  try { await s.start({ id: 'x', tunerId: 'tx', displayName: 'X' }); } catch (e) { err = e; }
  assert(err && /no segment/i.test(err.message), 'rejects with no-segment error');
  assert(s.getCurrent() === null, 'state back to IDLE');
  fs.rmSync(streamDir, { recursive: true, force: true });
}

async function testTranscodePipelineArgs() {
  console.log('\n--- transcode pipeline uses libx264 ---');
  const streamDir = fs.mkdtempSync(path.join(os.tmpdir(), 'streamertest-'));
  let spawned = null;
  const s = new Streamer({
    streamDir,
    spawnFn: (cmd, args) => { spawned = args; return makeFakeProc(); },
    waitForSegmentFn: async () => true,
    resolveRtsp: async () => 'rtsp://x',
    getPipeline: async () => 'transcode',
  });

  await s.start({ id: 'q', tunerId: 'tq', displayName: 'Q' });
  assert(spawned.includes('libx264'), 'libx264 in args');
  assert(spawned.includes('-vf'), '-vf scale arg present');

  await s.stop();
  fs.rmSync(streamDir, { recursive: true, force: true });
}

(async () => {
  await testStartTransitionsToPlaying();
  await testSwitchChannelTerminatesPrevious();
  await testStartSameChannelNoOp();
  await testWaitTimeoutFails();
  await testTranscodePipelineArgs();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
```

- [ ] **Step 2: Run to verify failure**

```bash
node test/fritzboxStreamer.test.js
```

Expected: Cannot find module.

- [ ] **Step 3: Implement streamer.js**

Create `lib/fritzbox/streamer.js`:

```js
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const SEGMENT_WAIT_TIMEOUT_MS = 10000;
const SEGMENT_POLL_INTERVAL_MS = 200;
const SIGTERM_GRACE_MS = 2000;
const INACTIVITY_TIMEOUT_MS = 4 * 60 * 60 * 1000;

function copyArgs(rtspUrl, outDir) {
  return [
    '-loglevel', 'warning',
    '-rtsp_transport', 'udp',
    '-analyzeduration', '5000000',
    '-probesize', '10000000',
    '-i', rtspUrl,
    '-map', '0:v:0', '-map', '0:a:0',
    '-c:v', 'copy',
    '-c:a', 'aac', '-b:a', '128k', '-ac', '2',
    '-hls_time', '4',
    '-hls_list_size', '3',
    '-hls_flags', 'delete_segments+append_list',
    '-hls_segment_type', 'mpegts',
    '-hls_segment_filename', path.join(outDir, 'seg_%03d.ts'),
    '-f', 'hls',
    path.join(outDir, 'index.m3u8'),
  ];
}

function transcodeArgs(rtspUrl, outDir) {
  return [
    '-loglevel', 'warning',
    '-rtsp_transport', 'udp',
    '-analyzeduration', '5000000',
    '-probesize', '10000000',
    '-i', rtspUrl,
    '-map', '0:v:0', '-map', '0:a:0',
    '-c:v', 'libx264', '-profile:v', 'main', '-level', '3.1',
    '-preset', 'veryfast', '-tune', 'zerolatency',
    '-b:v', '1500k', '-maxrate', '1500k', '-bufsize', '3000k',
    '-vf', 'scale=960:540',
    '-g', '50', '-keyint_min', '50',
    '-c:a', 'aac', '-b:a', '128k', '-ac', '2',
    '-hls_time', '6',
    '-hls_list_size', '3',
    '-hls_flags', 'delete_segments+append_list',
    '-hls_segment_type', 'mpegts',
    '-hls_segment_filename', path.join(outDir, 'seg_%03d.ts'),
    '-f', 'hls',
    path.join(outDir, 'index.m3u8'),
  ];
}

async function defaultWaitForSegment(outDir) {
  const target = path.join(outDir, 'index.m3u8');
  const start = Date.now();
  while (Date.now() - start < SEGMENT_WAIT_TIMEOUT_MS) {
    if (fs.existsSync(target)) {
      // Also wait for at least one .ts segment - prevents handing 0-byte playlist to Echo Show
      const files = fs.readdirSync(outDir).filter(f => f.endsWith('.ts'));
      if (files.length > 0) return true;
    }
    await new Promise(r => setTimeout(r, SEGMENT_POLL_INTERVAL_MS));
  }
  return false;
}

class Streamer {
  constructor(opts = {}) {
    this.streamDir = opts.streamDir || path.join(__dirname, '..', '..', 'stream', 'fritzbox');
    this.spawnFn = opts.spawnFn || spawn;
    this.waitForSegmentFn = opts.waitForSegmentFn || defaultWaitForSegment;
    this.resolveRtsp = opts.resolveRtsp;  // async (tunerId) => rtspUrl
    this.getPipeline = opts.getPipeline;  // async (tunerId, rtspUrl) => 'copy'|'transcode'

    this.state = 'IDLE';        // IDLE | STARTING | PLAYING | STOPPING
    this.current = null;        // { channelId, tunerId, startedAt, proc }
    this.lastActivity = null;
    this._inactivityTimer = null;
  }

  getCurrent() {
    if (!this.current) return null;
    return { channelId: this.current.channelId, startedAt: this.current.startedAt, status: this.state };
  }

  async start(channel) {
    // No-op if already PLAYING this channel
    if (this.state === 'PLAYING' && this.current?.channelId === channel.id) {
      this._touch();
      return this._hlsUrl();
    }

    // If anything else is running, stop it first
    if (this.current) {
      await this._stopInternal();
    }

    this.state = 'STARTING';
    this._clearStreamDir();

    let rtspUrl, pipeline;
    try {
      rtspUrl = await this.resolveRtsp(channel.tunerId);
      pipeline = await this.getPipeline(channel.tunerId, rtspUrl);
    } catch (err) {
      this.state = 'IDLE';
      throw err;
    }

    const args = pipeline === 'copy' ? copyArgs(rtspUrl, this.streamDir) : transcodeArgs(rtspUrl, this.streamDir);
    fs.mkdirSync(this.streamDir, { recursive: true });
    const proc = this.spawnFn('ffmpeg', args);

    this.current = {
      channelId: channel.id,
      tunerId: channel.tunerId,
      displayName: channel.displayName,
      pipeline,
      startedAt: new Date().toISOString(),
      proc,
    };

    proc.on('exit', (code, signal) => {
      // If we are still PLAYING this channel, it was a crash
      if (this.state === 'PLAYING' && this.current?.proc === proc) {
        console.error(`Streamer: ffmpeg exited unexpectedly (code=${code}, signal=${signal})`);
        this.state = 'IDLE';
        this.current = null;
      }
    });
    if (proc.stderr) proc.stderr.on('data', (d) => console.error(`ffmpeg: ${d.toString().trim()}`));

    const ok = await this.waitForSegmentFn(this.streamDir);
    if (!ok) {
      try { proc.kill('SIGTERM'); } catch {}
      this.state = 'IDLE';
      this.current = null;
      throw new Error('FFmpeg produced no segment within timeout');
    }

    this.state = 'PLAYING';
    this._touch();
    return this._hlsUrl();
  }

  async stop() {
    if (!this.current) return;
    await this._stopInternal();
  }

  async _stopInternal() {
    if (!this.current) return;
    this.state = 'STOPPING';
    const proc = this.current.proc;

    await new Promise((resolve) => {
      let resolved = false;
      const done = () => { if (!resolved) { resolved = true; resolve(); } };
      proc.on('exit', done);
      try { proc.kill('SIGTERM'); } catch { done(); return; }
      setTimeout(() => {
        if (!resolved) { try { proc.kill('SIGKILL'); } catch {} }
      }, SIGTERM_GRACE_MS);
    });

    this._clearStreamDir();
    this.current = null;
    this.state = 'IDLE';
    if (this._inactivityTimer) clearTimeout(this._inactivityTimer);
    this._inactivityTimer = null;
  }

  _clearStreamDir() {
    try {
      if (!fs.existsSync(this.streamDir)) return;
      for (const f of fs.readdirSync(this.streamDir)) {
        if (f.endsWith('.ts') || f.endsWith('.m3u8')) {
          try { fs.unlinkSync(path.join(this.streamDir, f)); } catch {}
        }
      }
    } catch {}
  }

  _hlsUrl() {
    return '/stream/fritzbox/index.m3u8';
  }

  _touch() {
    this.lastActivity = Date.now();
    if (this._inactivityTimer) clearTimeout(this._inactivityTimer);
    this._inactivityTimer = setTimeout(() => {
      console.log('Streamer: inactivity timeout, stopping');
      this.stop().catch(() => {});
    }, INACTIVITY_TIMEOUT_MS);
  }
}

module.exports = { Streamer, copyArgs, transcodeArgs };
```

- [ ] **Step 4: Run tests**

```bash
node test/fritzboxStreamer.test.js
```

Expected: `12 passed, 0 failed`

- [ ] **Step 5: Add SIGINT/SIGTERM cleanup hook in server.js**

In `server.js`, add right before `app.listen(...)`:

```js
// --- FFmpeg cleanup on shutdown ---
const fritzboxSourceModule = require('./lib/sources/fritzboxSource');
async function gracefulShutdown(signal) {
  console.log(`Empfangen: ${signal}, beende FFmpeg-Stream...`);
  try {
    if (fritzboxSourceModule.shutdown) await fritzboxSourceModule.shutdown();
  } catch (e) {
    console.error('Shutdown error:', e.message);
  }
  process.exit(0);
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
```

(Note: `fritzboxSource.shutdown` is added in Task 12.)

- [ ] **Step 6: Commit**

```bash
git add lib/fritzbox/streamer.js test/fritzboxStreamer.test.js server.js
git commit -m "Add single-slot FFmpeg state machine with copy/transcode pipelines"
```

---

### Task 12: FritzboxSource (the channel-side adapter)

**Files:**
- Create: `lib/sources/fritzboxSource.js`

- [ ] **Step 1: Extend the existing source test**

Append to `test/sourceChannel.test.js` (before the IIFE):

```js
async function testFritzboxSource() {
  console.log('\n--- FritzboxSource ---');
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-1234567890abcdef1234567890abcdef';
  process.env.BASE_URL = 'http://localhost:3000';

  const fritzboxSource = require('../lib/sources/fritzboxSource');
  const fakeStreamer = {
    async start(ch) { this.lastStart = ch; return '/stream/fritzbox/index.m3u8'; },
  };
  fritzboxSource._setStreamerForTest(fakeStreamer);

  const ch = new (fritzboxSource.FritzboxSource)({
    id: 'orf1', displayName: 'ORF 1', synonyms: [],
    tunerId: '40200_1010', logoUrl: '', group: 'ORF',
  });
  const out = await ch.resolveStream();
  assert(out.url.includes('/stream/fritzbox/index.m3u8'), 'returns fritzbox HLS path');
  assert(out.url.includes('token='), 'URL has token');
  assert(fakeStreamer.lastStart.id === 'orf1', 'streamer.start called with channel');

  fritzboxSource._resetForTest();
}
```

Add `await testFritzboxSource();` to the IIFE call list.

- [ ] **Step 2: Run test to verify it fails**

```bash
node test/sourceChannel.test.js
```

Expected: Cannot find module `'../lib/sources/fritzboxSource'`

- [ ] **Step 3: Implement fritzboxSource.js**

Create `lib/sources/fritzboxSource.js`:

```js
const { Channel } = require('./Channel');
const { generateStreamToken } = require('../auth');
const { getInstance: getSession } = require('../fritzbox/session');
const { M3uResolver } = require('../fritzbox/m3uResolver');
const { CodecProbe } = require('../fritzbox/codecProbe');
const { Streamer } = require('../fritzbox/streamer');

let _streamer = null;
let _resolver = null;
let _probe = null;

function _getStreamer() {
  if (_streamer) return _streamer;
  const session = getSession();
  if (!session) throw new Error('FRITZ!Box nicht konfiguriert (FRITZBOX_HOST/USER/PASSWORD fehlen)');
  _resolver = _resolver || new M3uResolver({ session });
  _probe = _probe || new CodecProbe({});
  _streamer = new Streamer({
    resolveRtsp: (tunerId) => _resolver.getRtspUrl(tunerId),
    getPipeline: (tunerId, rtsp) => _probe.getPipeline(tunerId, rtsp),
  });
  return _streamer;
}

class FritzboxSource extends Channel {
  constructor({ id, displayName, synonyms, tunerId, logoUrl, group }) {
    super({ id, displayName, synonyms, logoUrl, group, source: 'fritzbox' });
    this.tunerId = tunerId;
  }

  async resolveStream() {
    const streamer = _getStreamer();
    const hlsPath = await streamer.start(this);
    const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
    const token = generateStreamToken(this.id);
    return {
      url: `${baseUrl}${hlsPath}?token=${token}`,
      mimeType: 'application/vnd.apple.mpegurl',
      isLive: true,
    };
  }
}

async function shutdown() {
  if (_streamer) {
    try { await _streamer.stop(); } catch {}
  }
}

function _setStreamerForTest(s) { _streamer = s; }
function _resetForTest() { _streamer = null; _resolver = null; _probe = null; }

module.exports = { FritzboxSource, shutdown, _setStreamerForTest, _resetForTest };
```

- [ ] **Step 4: Run tests**

```bash
node test/sourceChannel.test.js
```

Expected: `12 passed, 0 failed` (4 from base + 4 HLS + 4 FritzboxSource)

- [ ] **Step 5: Commit**

```bash
git add lib/sources/fritzboxSource.js test/sourceChannel.test.js
git commit -m "Add FritzboxSource wiring session/resolver/probe/streamer"
```

---

### Task 13: Merge channel registry (FRITZ!Box as primary, HLS as fallback)

**Files:**
- Modify: `lib/channels.js`
- Test: append to `test/channelsRegistry.test.js`

- [ ] **Step 1: Extend registry test**

Append to `test/channelsRegistry.test.js` (before the IIFE that runs tests):

```js
async function testFritzboxMerge() {
  console.log('\n--- FRITZ!Box merge ---');
  // Set FRITZ!Box env so channels.js loads the FRITZ!Box channels
  process.env.FRITZBOX_HOST = '192.168.0.1';
  process.env.FRITZBOX_USER = 'tv';
  process.env.FRITZBOX_PASSWORD = 'fake';

  // Reload module after env change
  delete require.cache[require.resolve('../lib/channels')];
  delete require.cache[require.resolve('../lib/sources/fritzboxSource')];
  delete require.cache[require.resolve('../lib/fritzbox/session')];
  const ch = require('../lib/channels');

  const orf1 = ch.findChannel('orf eins');
  assert(orf1, 'finds ORF 1 by synonym');
  assert(orf1.source === 'fritzbox', 'ORF 1 is FRITZ!Box source');

  const zdf = ch.findChannel('zdf');
  assert(zdf, 'finds ZDF');
  assert(zdf.constructor.name === 'ChannelWithFallback', 'ZDF is wrapped (has fallback)');
  assert(zdf.primary.source === 'fritzbox', 'primary is fritzbox');
  assert(zdf.fallback.source === 'hls', 'fallback is hls');

  const grouped = ch.listChannels();
  const totalCount = Object.values(grouped).flat().length;
  assert(totalCount >= 26, `at least 26 channels (got ${totalCount})`);
}
```

Add `await testFritzboxMerge();` to the IIFE.

- [ ] **Step 2: Run to verify failure**

```bash
node test/channelsRegistry.test.js
```

Expected: ORF 1 is not found (only HLS channels loaded today).

- [ ] **Step 3: Update lib/channels.js**

Replace `lib/channels.js` entirely with:

```js
const fs = require('fs');
const path = require('path');
const { HlsSource } = require('./sources/hlsSource');
const { ChannelWithFallback } = require('./sources/Channel');

const STREAMS_PATH = path.join(__dirname, '..', 'streams.json');
const FRITZBOX_CHANNELS_PATH = path.join(__dirname, 'fritzbox', 'channels.json');

let channelMap = new Map();
let channelList = [];

const HLS_SYNONYMS = {
  'Das_Erste': ['das erste', 'ard', 'erstes', 'erstes programm', 'ard das erste', 'das erste ard'],
  'ONE': ['one', 'ard one', 'eins festival'],
  'ARD_alpha': ['ard alpha', 'alpha', 'br alpha'],
  'Tagesschau24': ['tagesschau24', 'tagesschau', 'tagesschau 24'],
  'ZDF_HD': ['zdf', 'zdf hd', 'zweites', 'zweites programm', 'zweites deutsches fernsehen'],
  'ZDFneo_HD': ['zdf neo', 'neo', 'zdfneo'],
  'ZDFinfo_HD': ['zdf info', 'zdfinfo', 'zdf information'],
  '3sat_HD': ['3sat', 'drei sat', 'dreisat'],
  'Phoenix_HD': ['phoenix', 'phoenix hd'],
};

const HLS_LOGO_FILES = {
  'Das_Erste': 'das_erste_hd.png', 'ONE': 'one_hd.png', 'ARD_alpha': 'ard_alpha_hd.png',
  'Tagesschau24': 'tagesschau24_hd.png', 'ZDF_HD': 'zdf_hd.png', 'ZDFneo_HD': 'zdf_neo_hd.png',
  'ZDFinfo_HD': 'zdf_info_hd.png', '3sat_HD': '3sat_hd.png', 'Phoenix_HD': 'phoenix_hd.png',
};

// Maps FRITZ!Box channel id -> matching HLS upstream id (in streams.json)
// for channels that have BOTH sources. Used to build ChannelWithFallback.
const FRITZBOX_TO_HLS_FALLBACK = {
  dasErsteHd:     'Das_Erste',
  zdfHd:          'ZDF_HD',
  '3satHd':       '3sat_HD',
  phoenixHd:      'Phoenix_HD',
  tagesschau24Hd: 'Tagesschau24',
  ardAlphaHd:     'ARD_alpha',
  oneHd:          'ONE',
  zdfinfoHd:      'ZDFinfo_HD',
};

const CHANNEL_LOGO_MAP = {
  'ARD': 'das_erste_hd.png', 'Das Erste': 'das_erste_hd.png', 'ZDF': 'zdf_hd.png',
  'ORF': 'orf2o_hd.png', '3Sat': '3sat_hd.png', '3sat': '3sat_hd.png',
  'PHOENIX': 'phoenix_hd.png', 'Phoenix': 'phoenix_hd.png',
  'BR': 'ard_alpha_hd.png', 'SWR': 'das_erste_hd.png', 'NDR': 'das_erste_hd.png',
  'WDR': 'das_erste_hd.png', 'HR': 'das_erste_hd.png', 'MDR': 'das_erste_hd.png',
  'RBB': 'das_erste_hd.png', 'SR': 'das_erste_hd.png',
};

function baseUrl() {
  return process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
}

function getLogoUrl(file) {
  if (!file) return '';
  return `${baseUrl()}/logos/${file}`;
}

function getLogoUrlForChannel(channelName) {
  if (!channelName) return '';
  const file = CHANNEL_LOGO_MAP[channelName];
  if (!file) return '';
  return `${baseUrl()}/logos/${file}`;
}

function normalize(name) {
  return name.toLowerCase().replace(/[_\-\.]/g, ' ').replace(/\s+hd\s*$/i, '').replace(/\s+/g, ' ').trim();
}

function loadHlsChannels() {
  const data = JSON.parse(fs.readFileSync(STREAMS_PATH, 'utf8'));
  const byHlsId = new Map();
  const all = [];
  for (const [group, chs] of Object.entries(data.liveTV || {})) {
    for (const [id, url] of Object.entries(chs)) {
      const ch = new HlsSource({
        id, displayName: id.replace(/_/g, ' '),
        synonyms: HLS_SYNONYMS[id] || [],
        upstreamUrl: url, logoUrl: getLogoUrl(HLS_LOGO_FILES[id]), group,
      });
      byHlsId.set(id, ch);
      all.push(ch);
    }
  }
  return { byHlsId, all };
}

function loadFritzboxChannels() {
  let session;
  try {
    const sessMod = require('./fritzbox/session');
    session = sessMod.getInstance();
  } catch {
    session = null;
  }
  if (!session) return [];

  const data = JSON.parse(fs.readFileSync(FRITZBOX_CHANNELS_PATH, 'utf8'));
  const { FritzboxSource } = require('./sources/fritzboxSource');
  return data.channels.map(c => new FritzboxSource({
    id: c.id,
    displayName: c.displayName,
    synonyms: c.synonyms,
    tunerId: c.tunerId,
    logoUrl: getLogoUrl(c.logoFile),
    group: c.group,
  }));
}

function registerChannel(ch) {
  channelList.push(ch);
  channelMap.set(normalize(ch.id), ch);
  channelMap.set(normalize(ch.displayName), ch);
  for (const syn of ch.synonyms) {
    channelMap.set(normalize(syn), ch);
  }
}

function loadChannels() {
  channelMap.clear();
  channelList = [];

  const { byHlsId, all: hlsAll } = loadHlsChannels();
  const fbChannels = loadFritzboxChannels();
  const usedHlsIds = new Set();

  // 1. Register FRITZ!Box channels (with HLS fallback where available)
  for (const fb of fbChannels) {
    const hlsId = FRITZBOX_TO_HLS_FALLBACK[fb.id];
    if (hlsId && byHlsId.has(hlsId)) {
      const wrapped = new ChannelWithFallback(fb, byHlsId.get(hlsId));
      registerChannel(wrapped);
      usedHlsIds.add(hlsId);
    } else {
      registerChannel(fb);
    }
  }

  // 2. Register HLS-only channels that have no FRITZ!Box equivalent
  for (const hls of hlsAll) {
    if (!usedHlsIds.has(hls.id)) {
      registerChannel(hls);
    }
  }
}

function findChannel(spokenName) {
  if (!spokenName) return null;
  return channelMap.get(normalize(spokenName)) || null;
}

function findChannelById(channelId) {
  return channelList.find(ch => ch.id === channelId) || null;
}

function listChannels() {
  const grouped = {};
  for (const ch of channelList) {
    if (!grouped[ch.group]) grouped[ch.group] = [];
    grouped[ch.group].push(ch);
  }
  return grouped;
}

loadChannels();

module.exports = { findChannel, findChannelById, listChannels, loadChannels, getLogoUrl, getLogoUrlForChannel };
```

- [ ] **Step 4: Run tests**

```bash
node test/channelsRegistry.test.js && node test/sourceChannel.test.js
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add lib/channels.js test/channelsRegistry.test.js
git commit -m "Channel registry: merge FRITZ!Box (primary) with HLS fallback"
```

---

### Task 14: Tuner verification at server start (best-effort)

**Files:**
- Modify: `server.js`

- [ ] **Step 1: Add startup hook**

In `server.js`, inside the `app.listen(...)` callback (after the channel-count log), add:

```js
// --- FRITZ!Box tuner verification (best-effort) ---
(async () => {
  try {
    const sessMod = require('./lib/fritzbox/session');
    const session = sessMod.getInstance();
    if (!session) {
      console.log('  FRITZ!Box:     deaktiviert (kein FRITZBOX_HOST/USER/PASSWORD)');
      return;
    }
    const { verifyTuners } = require('./lib/fritzbox/discovery');
    const data = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, 'lib', 'fritzbox', 'channels.json'), 'utf8'));
    const { ok, missing, fritzCount } = await verifyTuners(session, data.channels);
    console.log(`  FRITZ!Box:     ${ok.length}/${data.channels.length} Sender verifiziert (FRITZ!Box hat ${fritzCount} Sender insgesamt)`);
    if (missing.length > 0) {
      console.warn(`  FRITZ!Box:     ${missing.length} Sender fehlen:`);
      for (const m of missing) console.warn(`                  - ${m.displayName} (tunerId=${m.tunerId})`);
    }
  } catch (err) {
    console.warn(`  FRITZ!Box:     Verifikation fehlgeschlagen: ${err.message}`);
  }
})();
```

- [ ] **Step 2: Smoke test (without real FRITZ!Box, should not crash)**

```bash
JWT_SECRET=test1234567890abcdef1234567890abcdef PORT=33999 timeout 3 node server.js || true
```

Expected: Server starts, prints "FRITZ!Box: deaktiviert" (no credentials), no crash.

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "Verify FRITZ!Box tuner IDs at server start (best-effort)"
```

---

### Task 15: Serve FRITZ!Box HLS output with JWT auth

**Files:**
- Modify: `server.js`

- [ ] **Step 1: Find the legacy `/stream/` block**

In `server.js`, locate the section starting `// --- Legacy HLS Stream Serving (DVB-C backwards compatibility) ---`.

- [ ] **Step 2: Replace with auth-protected version**

Replace the entire block (the `app.use('/stream', ...)` middleware and the `express.static` call) with:

```js
// --- FRITZ!Box HLS Stream Serving (JWT-protected) ---
const { authMiddleware } = require('./lib/auth');
const fritzboxStreamRouter = express.Router();
fritzboxStreamRouter.use(authMiddleware());
fritzboxStreamRouter.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.path.endsWith('.m3u8')) res.type('application/vnd.apple.mpegurl');
  else if (req.path.endsWith('.ts')) res.type('video/mp2t');
  res.header('Cache-Control', 'no-cache, no-store, must-revalidate');
  next();
});
fritzboxStreamRouter.use(express.static(path.join(__dirname, 'stream')));
app.use('/stream', fritzboxStreamRouter);
```

- [ ] **Step 3: Smoke test**

```bash
JWT_SECRET=test1234567890abcdef1234567890abcdef PORT=33999 timeout 3 node server.js 2>&1 | grep -E '(MyVideo|FRITZ)' || true
```

Expected: Server starts cleanly.

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "Protect /stream/ route with JWT auth (was open)"
```

---

## Phase C — Alexa UI: voice model & live-TV quickbar

### Task 16: Update Alexa voice model with new channels

**Files:**
- Modify: `skill/model/de-DE.json`

- [ ] **Step 1: Inspect current CHANNEL_NAME slot**

```bash
python3 -c "import json; d=json.load(open('skill/model/de-DE.json')); ch=[t for t in d['interactionModel']['languageModel']['types'] if t['name']=='CHANNEL_NAME'][0]; print(json.dumps(ch,indent=2,ensure_ascii=False))"
```

- [ ] **Step 2: Replace the CHANNEL_NAME slot values**

Edit `skill/model/de-DE.json` — find the type with `"name": "CHANNEL_NAME"` and replace its `values` array with the merged list. The full new slot block:

```json
{
  "name": "CHANNEL_NAME",
  "values": [
    { "name": { "value": "ORF 1", "synonyms": ["ORF Eins", "ORF1"] } },
    { "name": { "value": "ORF 2", "synonyms": ["ORF Zwei", "ORF 2 Tirol", "ORF Two"] } },
    { "name": { "value": "ORF III", "synonyms": ["ORF Drei", "ORF 3"] } },
    { "name": { "value": "ORF SPORT+", "synonyms": ["ORF Sport plus", "ORF Sport"] } },
    { "name": { "value": "ServusTV", "synonyms": ["Servus TV", "Servus"] } },
    { "name": { "value": "ATV", "synonyms": ["A T V", "ATV HD"] } },
    { "name": { "value": "PULS 24", "synonyms": ["Puls Vierundzwanzig", "Puls 24"] } },
    { "name": { "value": "ProSieben", "synonyms": ["Pro Sieben", "ProSieben Austria"] } },
    { "name": { "value": "SAT.1", "synonyms": ["Sat Eins", "Sat 1"] } },
    { "name": { "value": "RTL", "synonyms": ["RTL Austria"] } },
    { "name": { "value": "VOX", "synonyms": ["VOX Austria"] } },
    { "name": { "value": "Das Erste", "synonyms": ["ARD", "Erstes", "Erstes Programm", "ARD Das Erste"] } },
    { "name": { "value": "ZDF", "synonyms": ["ZDF HD", "Zweites", "Zweites Programm"] } },
    { "name": { "value": "3sat", "synonyms": ["Drei Sat", "Dreisat"] } },
    { "name": { "value": "arte", "synonyms": ["arte HD"] } },
    { "name": { "value": "Phoenix", "synonyms": ["Phoenix HD"] } },
    { "name": { "value": "Tagesschau 24", "synonyms": ["Tagesschau24", "Tagesschau"] } },
    { "name": { "value": "ZDFinfo", "synonyms": ["ZDF info", "ZDF Information"] } },
    { "name": { "value": "ARD alpha", "synonyms": ["Alpha", "BR Alpha"] } },
    { "name": { "value": "ONE", "synonyms": ["ARD ONE", "Eins Festival"] } },
    { "name": { "value": "KiKA", "synonyms": ["Kika"] } },
    { "name": { "value": "BBC World News", "synonyms": ["BBC News", "BBC", "BBC World"] } },
    { "name": { "value": "Al Jazeera English", "synonyms": ["Al Jazeera", "Aljazeera"] } },
    { "name": { "value": "France 24", "synonyms": ["France Vierundzwanzig"] } },
    { "name": { "value": "CNBC", "synonyms": ["CNBC HD"] } },
    { "name": { "value": "NHK World", "synonyms": ["NHK"] } }
  ]
}
```

- [ ] **Step 3: Verify valid JSON**

```bash
python3 -c "import json; d=json.load(open('skill/model/de-DE.json')); ch=[t for t in d['interactionModel']['languageModel']['types'] if t['name']=='CHANNEL_NAME'][0]; print(len(ch['values']),'values')"
```

Expected: `26 values`

- [ ] **Step 4: Commit**

```bash
git add skill/model/de-DE.json
git commit -m "Extend CHANNEL_NAME slot with 26 curated channels (FRITZ!Box + HLS)"
```

---

### Task 17: Add live-TV quickbar to LaunchTemplate APL

**Files:**
- Modify: `skill/apl/LaunchTemplate.json`
- Modify: `lib/aplHelper.js`
- Modify: `skill/handlers/LaunchHandler.js`

- [ ] **Step 1: Read current LaunchTemplate**

```bash
cat skill/apl/LaunchTemplate.json
```

- [ ] **Step 2: Add liveTVChannels datasource binding + a quickbar row at the top**

Modify `skill/apl/LaunchTemplate.json`. In the main content `Container` (the 65% width one with paddingLeft 40dp), insert a new `Container` between the title `Text` and the `Sequence`:

```json
{
  "type": "Container",
  "width": "100%",
  "direction": "row",
  "alignItems": "center",
  "paddingBottom": "12dp",
  "data": "${launchData.properties.liveTVChannels}",
  "items": [
    {
      "type": "TouchWrapper",
      "onPress": [
        {
          "type": "SendEvent",
          "arguments": ["selectChannel", "${data.id}"]
        }
      ],
      "items": [
        {
          "type": "Frame",
          "backgroundColor": "rgba(255,255,255,0.10)",
          "borderRadius": "8dp",
          "paddingLeft": "6dp",
          "paddingRight": "6dp",
          "paddingTop": "6dp",
          "paddingBottom": "6dp",
          "marginRight": "6dp",
          "items": [
            {
              "type": "Image",
              "source": "${data.logo}",
              "width": "60dp",
              "height": "40dp",
              "scale": "best-fit"
            }
          ]
        }
      ]
    }
  ]
}
```

- [ ] **Step 3: Update aplHelper.renderLaunchScreen to pass live-TV data**

In `lib/aplHelper.js`, change the `renderLaunchScreen` signature and body. Replace the existing function with:

```js
function renderLaunchScreen(handlerInput, sections, logoUrl, liveTVChannels) {
  if (!hasAPLSupport(handlerInput)) return;

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
    return { title: section.title, results };
  });

  const categories = [
    { label: 'Nachrichten', id: 'nachrichten' },
    { label: 'Sport', id: 'sport' },
    { label: 'Kultur', id: 'kultur' },
    { label: 'Comedy', id: 'comedy' },
  ];

  handlerInput.responseBuilder.addDirective({
    type: 'Alexa.Presentation.APL.RenderDocument',
    token: 'launchToken',
    document: LAUNCH_TEMPLATE,
    datasources: {
      launchData: {
        type: 'object',
        properties: {
          title: 'Aktuelle Nachrichten',
          sections: aplSections,
          logoUrl: logoUrl || '',
          categories,
          liveTVChannels: liveTVChannels || [],
        },
      },
    },
  });
}
```

- [ ] **Step 4: Update LaunchHandler to build quickbar list**

In `skill/handlers/LaunchHandler.js`, just before the `renderLaunchScreen(handlerInput, sections, orfLogo);` call, build the live list:

```js
// Live-TV-Quickbar: erste 8 wichtigste Sender
const QUICKBAR_IDS = ['orf1', 'orf2t', 'orf3', 'servustv', 'atv', 'pro7at', 'dasErsteHd', 'zdfHd'];
const liveTVChannels = QUICKBAR_IDS
  .map(id => {
    const ch = require('../../lib/channels').findChannelById(id);
    if (!ch) return null;
    return { id: ch.id, name: ch.displayName, logo: ch.logoUrl };
  })
  .filter(Boolean);
```

Then change the call to:

```js
renderLaunchScreen(handlerInput, sections, orfLogo, liveTVChannels);
```

- [ ] **Step 5: Smoke test**

```bash
node -e "process.env.JWT_SECRET='x'.repeat(40); require('./skill/handlers/LaunchHandler'); console.log('OK')"
```

Expected: `OK`

- [ ] **Step 6: Commit**

```bash
git add skill/apl/LaunchTemplate.json lib/aplHelper.js skill/handlers/LaunchHandler.js
git commit -m "Add live-TV quickbar (8 channels) as first row on launch screen"
```

---

### Task 18: Category quick-actions (ORF SPORT+ for sport, ORF III for culture)

**Files:**
- Modify: `lib/aplHelper.js`
- Modify: `skill/apl/NewsListTemplate.json`
- Modify: `skill/handlers/PlayCategoryHandler.js`
- Modify: `skill/handlers/TouchEventHandler.js` (handleSelectCategory)

- [ ] **Step 1: Add optional quick-action panel to NewsListTemplate.json**

Read the file first:

```bash
cat skill/apl/NewsListTemplate.json | head -40
```

Add at the top of the main content container (right after the title `Text`), inside `items`, a new optional row that only renders if `newsData.properties.liveQuickAction` is set:

```json
{
  "type": "Container",
  "when": "${newsData.properties.liveQuickAction}",
  "direction": "row",
  "alignItems": "center",
  "paddingBottom": "10dp",
  "items": [
    {
      "type": "TouchWrapper",
      "onPress": [
        {
          "type": "SendEvent",
          "arguments": ["selectChannel", "${newsData.properties.liveQuickAction.id}"]
        }
      ],
      "items": [
        {
          "type": "Frame",
          "backgroundColor": "rgba(76,195,247,0.18)",
          "borderRadius": "8dp",
          "paddingLeft": "12dp",
          "paddingRight": "12dp",
          "paddingTop": "8dp",
          "paddingBottom": "8dp",
          "items": [
            {
              "type": "Container",
              "direction": "row",
              "alignItems": "center",
              "items": [
                { "type": "Image", "source": "${newsData.properties.liveQuickAction.logo}", "width": "48dp", "height": "32dp", "scale": "best-fit" },
                { "type": "Text", "text": "LIVE: ${newsData.properties.liveQuickAction.name}", "color": "white", "fontSize": "20dp", "paddingLeft": "12dp" }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

- [ ] **Step 2: Extend aplHelper.renderNewsList signature**

In `lib/aplHelper.js`, change the `renderNewsList` function. Replace it with:

```js
function renderNewsList(handlerInput, sections, title, liveQuickAction) {
  if (!hasAPLSupport(handlerInput)) return;

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
    return { title: section.title, results };
  });

  handlerInput.responseBuilder.addDirective({
    type: 'Alexa.Presentation.APL.RenderDocument',
    token: 'newsListToken',
    document: NEWS_TEMPLATE,
    datasources: {
      newsData: {
        type: 'object',
        properties: {
          title: title || 'Aktuelle Nachrichten',
          sections: aplSections,
          liveQuickAction: liveQuickAction || null,
        },
      },
    },
  });
}
```

- [ ] **Step 3: Update PlayCategoryHandler to pass quick-action**

In `skill/handlers/PlayCategoryHandler.js`, add a helper near the top (after imports):

```js
const channels = require('../../lib/channels');

const CATEGORY_QUICK_LIVE = {
  'Sport': 'orfSport',
  'Kultur': 'orf3',
};

function buildQuickAction(categoryTitle) {
  const channelId = CATEGORY_QUICK_LIVE[categoryTitle];
  if (!channelId) return null;
  const ch = channels.findChannelById(channelId);
  if (!ch) return null;
  return { id: ch.id, name: ch.displayName, logo: ch.logoUrl };
}
```

Then change the `renderNewsList(handlerInput, data.sections, categoryValue);` line to:

```js
const quickAction = buildQuickAction(categoryTitle);
const lines = results.map((r, i) => formatResultForSpeech(r, i));
let speech = `${lines.join('. ')}. Welche Nummer?`;
if (quickAction) {
  speech = `${lines.join('. ')}. Welche Nummer, oder sage ${quickAction.name} fuer den Livestream?`;
}

renderNewsList(handlerInput, data.sections, categoryValue, quickAction);
```

This replaces both the `renderNewsList(...)` call line **and** the `const speech = ...` line that follows it in the current handler.

- [ ] **Step 4: Update TouchEventHandler.handleSelectCategory similarly**

In `skill/handlers/TouchEventHandler.js`, inside `handleSelectCategory`, near the top add:

```js
const CATEGORY_QUICK_LIVE = {
  'Sport': 'orfSport',
  'Kultur': 'orf3',
};

function buildQuickAction(categoryTitle) {
  const channelId = CATEGORY_QUICK_LIVE[categoryTitle];
  if (!channelId) return null;
  const ch = channels.findChannelById(channelId);
  if (!ch) return null;
  return { id: ch.id, name: ch.displayName, logo: ch.logoUrl };
}
```

And replace the `renderNewsList(handlerInput, data.sections, categoryTitle);` line with:

```js
const quickAction = buildQuickAction(categoryTitle);
renderNewsList(handlerInput, data.sections, categoryTitle, quickAction);
```

- [ ] **Step 5: Smoke test**

```bash
node -e "process.env.JWT_SECRET='x'.repeat(40); require('./skill/handlers/PlayCategoryHandler'); require('./skill/handlers/TouchEventHandler'); console.log('OK')"
```

Expected: `OK`

- [ ] **Step 6: Commit**

```bash
git add skill/apl/NewsListTemplate.json lib/aplHelper.js skill/handlers/PlayCategoryHandler.js skill/handlers/TouchEventHandler.js
git commit -m "Category quick-actions: ORF SPORT+ for Sport, ORF III for Kultur"
```

---

### Task 19: Extend logo download script

**Files:**
- Modify: `scripts/download-logos.sh`

- [ ] **Step 1: Read current script**

```bash
cat scripts/download-logos.sh
```

- [ ] **Step 2: Add new logo filenames**

Edit `scripts/download-logos.sh` — replace the `LOGOS` variable contents (the heredoc-style list of filenames) with:

```sh
LOGOS="
das_erste_hd.png
one_hd.png
ard_alpha_hd.png
tagesschau24_hd.png
zdf_hd.png
zdf_neo_hd.png
zdf_info_hd.png
3sat_hd.png
phoenix_hd.png
orf1_hd.png
orf2o_hd.png
orf2t_hd.png
orf_iii_hd.png
orf_sport+_hd.png
servustv_hd_oesterreich.png
atv_hd.png
puls_24_hd.png
prosieben_austria.png
sat1_a.png
rtl_austria.png
vox_austria.png
arte_hd.png
kika_hd.png
bbc_world_news_hd.png
al_jazeera_english_hd.png
france_24_hd.png
cnbc_hd.png
nhk_worldjpn.png
"
```

- [ ] **Step 3: Test run (idempotent)**

```bash
bash scripts/download-logos.sh
```

Expected: New logos downloaded (or fail gracefully per logo with a warning if AVM removed it).

- [ ] **Step 4: Commit**

```bash
git add scripts/download-logos.sh
git commit -m "Add new channel logos to download script (FRITZ!Box channels)"
```

---

## Phase D — Cleanup, Docker, README

### Task 20: Install ffmpeg in Docker image

**Files:**
- Modify: `Dockerfile`

- [ ] **Step 1: Read current Dockerfile**

```bash
cat Dockerfile
```

- [ ] **Step 2: Add ffmpeg to apt-get install line**

In `Dockerfile`, change the `apt-get install` line to include `ffmpeg`:

```dockerfile
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates ffmpeg \
    && ARCH=$(dpkg --print-architecture) \
    && curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${ARCH}" \
       -o /usr/local/bin/cloudflared \
    && chmod +x /usr/local/bin/cloudflared \
    && rm -rf /var/lib/apt/lists/*
```

- [ ] **Step 3: Smoke build (skip if Docker not available)**

```bash
docker build -t myvideo-test . && docker run --rm myvideo-test ffmpeg -version | head -1
```

Expected: prints something like `ffmpeg version 5.x ...` (skip task step if Docker is not installed locally).

- [ ] **Step 4: Commit**

```bash
git add Dockerfile
git commit -m "Install ffmpeg in Docker image for FRITZ!Box live-TV transcoding"
```

---

### Task 21: Update `.env.example`

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Read current content**

```bash
cat .env.example
```

- [ ] **Step 2: Add FRITZBOX section, remove STREAM_URL**

Replace `.env.example` entirely with:

```bash
# MyVideo Alexa Skill - Konfiguration
#
# Kopiere diese Datei nach .env und passe die Werte an:
#   cp .env.example .env

# Port fuer den Express Server (intern im Container)
PORT=3000

# Externer Port (Host-Seite, nur fuer docker-compose)
PORT_EXTERNAL=3377

# Externe URL (Cloudflare Tunnel)
# Diese URL wird als Video-Stream URL an Alexa gesendet
BASE_URL=https://tv.example.de

# JWT Secret fuer Proxy-Absicherung (min 32 Zeichen)
# Generieren: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
JWT_SECRET=

# Cloudflare Tunnel
TUNNEL_HOSTNAME=tv.example.de
TUNNEL_CNAME=<tunnel-id>.cfargotunnel.com
TUNNEL_TOKEN=

# Region: AT oder DE
REGION=AT

# Alexa Skill
SKILL_ID=

# FRITZ!Box Live-TV (optional)
# Wenn gesetzt, werden Live-Streams primaer ueber die FRITZ!Box bezogen (HD, kein Geo-Block).
# Empfehlung: eigenen FRITZ!Box-Benutzer "tv" mit minimalen Rechten anlegen.
FRITZBOX_HOST=192.168.0.1
FRITZBOX_USER=
FRITZBOX_PASSWORD=

# AI Summary (optional)
# OPENROUTER_API_KEY=sk-or-...
# OPENROUTER_MODEL=google/gemini-2.5-flash-lite

# ORF TVthek API (optional)
# ORF_API=true
```

- [ ] **Step 3: Commit**

```bash
git add .env.example
git commit -m "env: add FRITZBOX_* variables, remove legacy STREAM_URL"
```

---

### Task 22: Remove legacy start-stream.sh

**Files:**
- Delete: `scripts/start-stream.sh`
- Modify: `package.json` (remove `"stream"` npm script)

- [ ] **Step 1: Delete the script**

```bash
git rm scripts/start-stream.sh
```

- [ ] **Step 2: Remove npm script entry**

Edit `package.json`. In the `"scripts"` object, remove the line:

```json
    "stream": "bash scripts/start-stream.sh",
```

- [ ] **Step 3: Verify package.json is valid JSON**

```bash
node -e "JSON.parse(require('fs').readFileSync('package.json','utf8'))"
```

Expected: no output (no error).

- [ ] **Step 4: Commit**

```bash
git add scripts/start-stream.sh package.json
git commit -m "Remove legacy start-stream.sh (replaced by FRITZ!Box streamer)"
```

---

### Task 23: README documentation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Read current README**

```bash
head -150 README.md
```

- [ ] **Step 2: Update README — add FRITZ!Box section**

In `README.md`:

1. In the "Was kann dieser Skill?" bullet list, change the Live-TV bullet to:

```markdown
- **Live-TV (FRITZ!Box + Öffentlich)** - ORF 1/2/III, ServusTV, ATV, ProSieben, Das Erste, ZDF und viele mehr direkt von deiner FRITZ!Box (HD, kein Geo-Block). Sender ohne FRITZ!Box-Verbindung laufen über öffentliche HLS-Streams.
```

2. In the Konfiguration table, add rows for the new variables:

```markdown
| `FRITZBOX_HOST` | Nein | IP/Hostname der FRITZ!Box (Standard: `192.168.0.1`). Aktiviert FRITZ!Box-Live-TV. |
| `FRITZBOX_USER` | Nein | FRITZ!Box-Benutzername (empfohlen: eigener User "tv" mit minimalen Rechten) |
| `FRITZBOX_PASSWORD` | Nein | Passwort dieses Benutzers |
```

3. Add a new section after "Cloudflare Tunnel":

```markdown
### FRITZ!Box Live-TV (optional)

Wenn dein Server im selben Netz wie eine FRITZ!Box mit DVB-C-Funktion steht, kannst du Live-TV direkt darüber beziehen (HD, kein Geo-Block, mehr Sender — ORF 1/2/III, ServusTV, ATV usw.).

**Setup:**

1. **FRITZ!Box-Benutzer anlegen:** FRITZ!Box-Web-UI → *System* → *FRITZ!Box-Benutzer* → *Neuer Benutzer*
   - Name: `tv` (oder beliebig)
   - Berechtigungen: nur **"FRITZ!Box-Einstellungen"** (alles andere abwählen — kein VPN, kein Smart Home, keine Anrufliste)
   - Passwort generieren und sicher merken

2. **Variablen in `.env` setzen:**
   ```
   FRITZBOX_HOST=192.168.0.1
   FRITZBOX_USER=tv
   FRITZBOX_PASSWORD=<dein-passwort>
   ```

3. **Server neu starten.** Beim Start wird die Senderliste verifiziert:
   ```
   FRITZ!Box: 26/26 Sender verifiziert (FRITZ!Box hat 69 Sender insgesamt)
   ```

**Hinweise:**
- `ffmpeg` muss installiert sein (im Docker-Image bereits enthalten; lokal: `brew install ffmpeg`)
- Bei Senderwechsel dauert das erste Segment ~1-2s (H.264-Sender) bis ~3-5s (MPEG-2)
- Sender mit öffentlichem HLS (ARD, ZDF, 3sat, Phoenix, Tagesschau24, ARD alpha, ONE, ZDFinfo) fallen automatisch auf den öffentlichen Stream zurück, wenn die FRITZ!Box offline ist
- Sender ohne öffentliche Quelle (ORF 1/2/III, ServusTV, ATV, RTL/Pro7/SAT.1, BBC World News, …) sind dann kurz nicht verfügbar
```

4. In the Sprachbefehle table, update the "Schalte auf ZDF" row:

```markdown
| "Schalte auf ZDF" | Live-TV Sender starten (FRITZ!Box bevorzugt, öffentliches HLS als Fallback) |
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "README: document FRITZ!Box Live-TV setup and user creation"
```

---

### Task 24: Manual integration test script

**Files:**
- Create: `scripts/test-fritzbox.js`
- Modify: `package.json` (add `"test:fritzbox"` script)

- [ ] **Step 1: Create the script**

Create `scripts/test-fritzbox.js`:

```js
#!/usr/bin/env node
/**
 * Manual integration test against a real FRITZ!Box.
 * Requires FRITZBOX_HOST/USER/PASSWORD in .env or environment.
 *
 * Usage: node scripts/test-fritzbox.js <channelId>
 * Example: node scripts/test-fritzbox.js orf1
 */
require('dotenv').config();

const channels = require('../lib/channels');

async function main() {
  const channelId = process.argv[2];
  if (!channelId) {
    console.error('Usage: node scripts/test-fritzbox.js <channelId>');
    console.error('Available IDs:');
    for (const [group, list] of Object.entries(channels.listChannels())) {
      console.error(`  [${group}]`, list.map(c => c.id).join(', '));
    }
    process.exit(1);
  }

  const ch = channels.findChannelById(channelId);
  if (!ch) {
    console.error(`Channel not found: ${channelId}`);
    process.exit(1);
  }

  console.log(`Resolving stream for ${ch.displayName} (source=${ch.source || (ch.primary?.source + '+fallback')}) ...`);
  const t0 = Date.now();
  const stream = await ch.resolveStream();
  const dt = Date.now() - t0;
  console.log(`OK in ${dt}ms`);
  console.log(`  URL: ${stream.url}`);
  console.log(`  MIME: ${stream.mimeType}`);

  // For FRITZ!Box sources, wait 10 seconds, then stop
  if (ch.source === 'fritzbox' || ch.primary?.source === 'fritzbox') {
    console.log('Streaming for 10 seconds...');
    await new Promise(r => setTimeout(r, 10000));
    const fritzboxSource = require('../lib/sources/fritzboxSource');
    await fritzboxSource.shutdown();
    console.log('Stopped.');
  }
}

main().catch(err => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
```

- [ ] **Step 2: Add npm script entry**

Edit `package.json`. In the `"scripts"` object, add:

```json
    "test:fritzbox": "node scripts/test-fritzbox.js"
```

(Place it after `"tunnel"`.)

- [ ] **Step 3: Verify JSON valid**

```bash
node -e "JSON.parse(require('fs').readFileSync('package.json','utf8'))"
```

Expected: no error.

- [ ] **Step 4: Commit**

```bash
git add scripts/test-fritzbox.js package.json
git commit -m "Add manual integration-test script for FRITZ!Box channels"
```

---

### Task 25: Final regression run + deploy

**Files:** none (verification step)

- [ ] **Step 1: Run all node-based tests**

```bash
JWT_SECRET=test1234567890abcdef1234567890abcdef \
node test/sourceChannel.test.js && \
node test/channelsRegistry.test.js && \
node test/fritzboxSession.test.js && \
node test/m3uResolver.test.js && \
node test/codecProbe.test.js && \
node test/fritzboxStreamer.test.js && \
echo "ALL OK"
```

Expected: every test file prints `N passed, 0 failed`, final `ALL OK`.

- [ ] **Step 2: Server smoke test (no real FRITZ!Box)**

```bash
JWT_SECRET=test1234567890abcdef1234567890abcdef PORT=33999 timeout 3 node server.js 2>&1 | grep -E '(Skill Endpoint|FRITZ)' || true
```

Expected output includes:
```
  Skill Endpoint: http://localhost:33999/alexa
  FRITZ!Box:     deaktiviert (kein FRITZBOX_HOST/USER/PASSWORD)
```

- [ ] **Step 3: Real integration test against FRITZ!Box (manual)**

Set `.env` with real credentials, then:

```bash
node scripts/test-fritzbox.js orf1
```

Expected: stream URL printed, ffmpeg runs 10s, stops cleanly.

- [ ] **Step 4: Deploy Alexa voice model**

```bash
./scripts/deploy-skill.sh
```

Expected: skill model updated, Amazon-side build successful.

- [ ] **Step 5: End-to-end on Echo Show**

Manually:
- "Alexa, öffne Mein Video" → launch screen shows live-TV quickbar (8 logos top row)
- "Schalte auf ORF 1" → ORF 1 plays in HD
- Tap on ZDF logo → ZDF plays (FRITZ!Box preferred)
- "Thema Sport" → news list with ORF SPORT+ live-button at top
- Tap ORF SPORT+ button → live stream starts

- [ ] **Step 6: Final commit / merge**

```bash
git log --oneline main..HEAD | cat
```

Inspect commit history is clean. If everything looks good, the branch is ready for PR or merge into main.

---

## Self-Review Notes

**Coverage check vs. spec:**
- Section 4.1 (Source abstraction) → Tasks 1-3, 12
- Section 4.2 (FRITZ!Box adapter) → Tasks 6-9
- Section 4.3 (FFmpeg pipeline) → Tasks 10-11
- Section 4.4 (Alexa integration) → Tasks 4-5, 16-18
- Section 5 (Config) → Task 21
- Section 6 (Deployment phases) → Tasks 1-25 in declared order; phase letters match
- Section 7 (Testing) → unit-tests inside each task; Task 24 = manual integration; Task 25 = end-to-end
- Section 8 (Risks) → Streamer state machine handles concurrency/crash (Task 11); session auto-renew (Task 6); discovery loggt missing (Task 14); cache invalidation (Task 10)
- Section 11 (Acceptance criteria) → covered by Task 25 manual steps

**No placeholders.** Every step shows actual code or actual commands.

**Type/name consistency:**
- `resolveStream()` returns `{ url, mimeType, isLive }` everywhere (Tasks 1, 2, 12)
- `Streamer.start(channel)` takes a channel-like with `id, tunerId, displayName` (Tasks 11, 12)
- `findChannelById(id)` is used consistently (Tasks 5, 17, 18, 24)
- FRITZ!Box channel `id` slugs match between `channels.json` (Task 7), registry mapping (Task 13), and quickbar (Task 17)
- `FRITZBOX_TO_HLS_FALLBACK` maps to HLS ids that exist in current `streams.json` (`ZDF_HD`, `3sat_HD`, `Phoenix_HD`, etc.)
