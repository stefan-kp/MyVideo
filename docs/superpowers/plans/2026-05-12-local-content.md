# Local Content (NAS Files) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make local video files on a NAS-mounted directory searchable and playable on Echo Show via voice + touch, mixing results with the existing Mediathek search.

**Architecture:** A new `lib/content/` module adds filesystem scanning, persistent JSON indexing, and a content source. The existing `Streamer` from `lib/fritzbox/streamer.js` gets a `source: 'local'` mode so local files reuse the same single-slot transcode pipeline. New voice intents (`SearchEverything`, `SearchContent`, `ListNewContent`, `PlayShow`) plus a source-aware `PlayMediathekResultHandler` make it work.

**Tech Stack:** Node.js 18+, Express, `parse-torrent-name` (new dependency), FFmpeg, existing ASK SDK / APL infrastructure.

**Reference:** [docs/superpowers/specs/2026-05-12-local-content-design.md](../specs/2026-05-12-local-content-design.md)

---

## File Structure Overview

### New files
- `config/content-paths.example.json` — generic config template, checked in
- `lib/content/paths.js` — loads and validates `content-paths.json`
- `lib/content/parser.js` — wraps `parse-torrent-name`, returns normalised `ContentEntry` fields
- `lib/content/slug.js` — slug generation + collision handling
- `lib/content/scanner.js` — walks configured paths, produces `ContentEntry` list
- `lib/content/index.js` — in-memory + JSON-persisted content index
- `lib/content/codecProbe.js` — lazy ffprobe with index-embedded cache
- `lib/content/search.js` — query/findNewest/findExactEpisode helpers
- `lib/content/contentSource.js` — `resolveStream(itemId)` direct-play vs transcode
- `skill/handlers/SearchEverythingHandler.js`
- `skill/handlers/SearchContentHandler.js`
- `skill/handlers/ListNewContentHandler.js`
- `skill/handlers/PlayShowHandler.js`
- `test/contentPaths.test.js`
- `test/contentParser.test.js`
- `test/contentSlug.test.js`
- `test/contentIndex.test.js`
- `test/contentSearch.test.js`
- `test/contentCodecProbe.test.js`
- `test/contentSource.test.js`
- `test/contentScanner.test.js`
- `scripts/test-content.js`

### Modified files
- `lib/fritzbox/streamer.js` — `start()` accepts `{ source: 'fritzbox'|'local', tunerId|inputPath, ... }`; `copyArgs`/`transcodeArgs` skip RTSP wrapping for local; `hls_list_size` 3 vs 30 based on source
- `lib/fritzbox/audioPicker.js` — generic cache key (was `tunerId`), accepts arbitrary input source
- `lib/sources/fritzboxSource.js` — adapt `streamer.start()` call shape to new signature
- `skill/handlers/PlayMediathekResultHandler.js` — source-aware (`result.source === 'local'` → call `contentSource.resolveStream`)
- `skill/handlers/TouchEventHandler.js` — handle `selectContent` action
- `skill/handlers/LaunchHandler.js` — add `recentContent` data for new APL row
- `skill/model/de-DE.json` — 4 new intents + `CONTENT_LABEL` slot type
- `skill/apl/LaunchTemplate.json` — new optional `recentContent` row
- `lib/aplHelper.js` — `renderLaunchScreen()` accepts `recentContent` param
- `server.js` — `/content/:id/file.mp4` route + `/diag/content/*` endpoints; bootstrap of scanner/index on startup
- `.env.example` — `CONTENT_RESCAN_MINUTES`, `CONTENT_CONFIG_PATH`
- `.gitignore` — add `config/content-paths.json`, `data/`
- `docker-compose.yml` — add `./config:/app/config:ro` and `./data:/app/data` (commented `/mnt/nas/videos:/content:ro` example)
- `package.json` — add `parse-torrent-name` dependency + `test:content` script
- `README.md` — section "Lokale Inhalte (NAS-Filme)"

### Deleted files
- None

---

## Phase A — Foundation (config, parser, slug, scanner, index)

### Task 1: `parse-torrent-name` dependency + content-paths schema

**Files:**
- Modify: `package.json`
- Create: `config/content-paths.example.json`
- Modify: `.gitignore`

- [ ] **Step 1: Install dependency**

```bash
cd /path/to/repo
npm install --save parse-torrent-name@^0.5.4
```

- [ ] **Step 2: Verify it loaded**

```bash
node -e "console.log(require('parse-torrent-name')('Better.Call.Saul.S04E06.Pinata.720p.mkv'))"
```

Expected: prints a JSON object with `title: "Better Call Saul"`, `season: 4`, `episode: 6`.

- [ ] **Step 3: Create example config**

Create `config/content-paths.example.json`:

```json
{
  "_comment": "Copy to content-paths.json (gitignored) and adjust paths to match your bind-mounted NAS layout.",
  "paths": [
    {
      "label": "Filme",
      "path": "/content/movies",
      "newerThanDays": 90,
      "recursive": true,
      "type": "movie"
    },
    {
      "label": "Serien",
      "path": "/content/tv",
      "newerThanDays": 60,
      "recursive": true,
      "type": "episode"
    },
    {
      "label": "Eigene",
      "path": "/content/home",
      "newerThanDays": null,
      "recursive": true,
      "type": "auto"
    }
  ],
  "extensions": {
    "directPlayCandidates": [".mp4", ".m4v"],
    "transcodeOnly":         [".mkv", ".avi", ".mov", ".ts", ".webm", ".wmv"]
  },
  "excludePatterns": ["sample", "trailer", "_UNPACK_", "@eaDir", ".partial", ".DS_Store"]
}
```

- [ ] **Step 4: Extend .gitignore**

Append to `.gitignore`:

```
# Local content - user-specific paths and persistent index
config/content-paths.json
data/
```

- [ ] **Step 5: Smoke-test**

```bash
node -e "console.log(JSON.parse(require('fs').readFileSync('config/content-paths.example.json','utf8')).paths.length)"
```

Expected: `3`

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json config/content-paths.example.json .gitignore
git commit -m "Add parse-torrent-name dependency and content-paths schema"
```

---

### Task 2: Path config loader

**Files:**
- Create: `lib/content/paths.js`
- Create: `test/contentPaths.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/contentPaths.test.js`:

```js
#!/usr/bin/env node
/**
 * content/paths test - config loading and validation
 * Run: node test/contentPaths.test.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadPathsConfig, validateConfig } = require('../lib/content/paths');

let passed = 0, failed = 0;
function assert(c, m) { if (c) { console.log(`  ✓ ${m}`); passed++; } else { console.error(`  ✗ ${m}`); failed++; } }

function tmpConfig(content) {
  const file = path.join(os.tmpdir(), `pathsconf.${Date.now()}.${Math.random()}.json`);
  fs.writeFileSync(file, JSON.stringify(content));
  return file;
}

(async () => {
  console.log('\n--- loadPathsConfig ---');
  const f = tmpConfig({
    paths: [
      { label: 'Filme', path: '/x/movies', newerThanDays: 90, recursive: true, type: 'movie' },
    ],
    extensions: { directPlayCandidates: ['.mp4'], transcodeOnly: ['.mkv'] },
    excludePatterns: ['sample'],
  });
  const cfg = loadPathsConfig(f);
  assert(cfg.paths.length === 1, 'loads one path');
  assert(cfg.paths[0].label === 'Filme', 'label preserved');
  assert(cfg.extensions.directPlayCandidates[0] === '.mp4', 'extensions preserved');
  assert(cfg.excludePatterns[0] === 'sample', 'excludePatterns preserved');
  fs.unlinkSync(f);

  console.log('\n--- loadPathsConfig with defaults ---');
  const f2 = tmpConfig({ paths: [{ label: 'Filme', path: '/x', newerThanDays: 30 }] });
  const cfg2 = loadPathsConfig(f2);
  assert(cfg2.paths[0].recursive === true, 'recursive default true');
  assert(cfg2.paths[0].type === 'auto', 'type default auto');
  assert(Array.isArray(cfg2.extensions.directPlayCandidates), 'extensions default present');
  fs.unlinkSync(f2);

  console.log('\n--- loadPathsConfig - missing file returns null ---');
  const cfg3 = loadPathsConfig('/nonexistent/path/whatever.json');
  assert(cfg3 === null, 'returns null when missing');

  console.log('\n--- validateConfig ---');
  let err;
  try { validateConfig({ paths: [{ path: '/x' }] }); } catch (e) { err = e; }
  assert(err && /label/.test(err.message), 'rejects path entry without label');

  try { validateConfig({ paths: [{ label: 'X' }] }); } catch (e) { err = e; }
  assert(err && /path/.test(err.message), 'rejects entry without path');

  try { validateConfig({}); } catch (e) { err = e; }
  assert(err && /paths/.test(err.message), 'rejects config without paths array');

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node test/contentPaths.test.js
```

Expected: Cannot find module `'../lib/content/paths'`.

- [ ] **Step 3: Implement `lib/content/paths.js`**

```js
const fs = require('fs');

const DEFAULT_EXTENSIONS = {
  directPlayCandidates: ['.mp4', '.m4v'],
  transcodeOnly: ['.mkv', '.avi', '.mov', '.ts', '.webm', '.wmv'],
};

const DEFAULT_EXCLUDE = ['sample', 'trailer', '_UNPACK_', '@eaDir', '.partial', '.DS_Store'];

function validateConfig(raw) {
  if (!raw || !Array.isArray(raw.paths)) {
    throw new Error('Invalid content config: missing or non-array `paths`');
  }
  for (const p of raw.paths) {
    if (!p.label || typeof p.label !== 'string') {
      throw new Error(`Invalid path entry: missing label (${JSON.stringify(p)})`);
    }
    if (!p.path || typeof p.path !== 'string') {
      throw new Error(`Invalid path entry: missing path (${JSON.stringify(p)})`);
    }
  }
}

function withDefaults(raw) {
  return {
    paths: raw.paths.map(p => ({
      label: p.label,
      path: p.path,
      newerThanDays: p.newerThanDays ?? null,
      recursive: p.recursive ?? true,
      type: p.type || 'auto',
    })),
    extensions: {
      directPlayCandidates: raw.extensions?.directPlayCandidates || DEFAULT_EXTENSIONS.directPlayCandidates,
      transcodeOnly: raw.extensions?.transcodeOnly || DEFAULT_EXTENSIONS.transcodeOnly,
    },
    excludePatterns: raw.excludePatterns || DEFAULT_EXCLUDE,
  };
}

/**
 * Load and validate content paths config. Returns null if the file is missing
 * (the feature is optional). Throws on invalid JSON or schema.
 */
function loadPathsConfig(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  validateConfig(raw);
  return withDefaults(raw);
}

module.exports = { loadPathsConfig, validateConfig, DEFAULT_EXTENSIONS, DEFAULT_EXCLUDE };
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node test/contentPaths.test.js
```

Expected: `10 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add lib/content/paths.js test/contentPaths.test.js
git commit -m "Add content paths config loader with validation and defaults"
```

---

### Task 3: Filename parser

**Files:**
- Create: `lib/content/parser.js`
- Create: `test/contentParser.test.js`

- [ ] **Step 1: Write the failing test**

```js
#!/usr/bin/env node
/**
 * content/parser test - filename -> structured metadata
 * Run: node test/contentParser.test.js
 */
const { parseContentFile } = require('../lib/content/parser');

let passed = 0, failed = 0;
function assert(c, m) { if (c) { console.log(`  ✓ ${m}`); passed++; } else { console.error(`  ✗ ${m}`); failed++; } }

console.log('\n--- TV episode patterns ---');
const e1 = parseContentFile('/content/tv/Better Call Saul/Season 4/S04E06 - Pinata.mkv', { type: 'episode', label: 'Serien', basePath: '/content/tv' });
assert(e1.type === 'episode', 'episode type detected');
assert(e1.show === 'Better Call Saul', `show extracted (got ${e1.show})`);
assert(e1.season === 4, 'season 4');
assert(e1.episode === 6, 'episode 6');

const e2 = parseContentFile('/content/tv/The.Americans.2013.S04E01.720p.HDTV.x264.mkv', { type: 'episode', label: 'Serien', basePath: '/content/tv' });
assert(e2.type === 'episode', 'episode type even when filename is flat');
assert(/Americans/.test(e2.show || ''), 'show contains "Americans"');
assert(e2.season === 4, 'season 4 from flat filename');
assert(e2.episode === 1, 'episode 1 from flat filename');

console.log('\n--- Movie patterns ---');
const m1 = parseContentFile('/content/movies/Inception (2010) [1080p].mp4', { type: 'movie', label: 'Filme', basePath: '/content/movies' });
assert(m1.type === 'movie', 'movie type detected');
assert(m1.title === 'Inception', `title "Inception" (got "${m1.title}")`);
assert(m1.year === 2010, 'year 2010');

const m2 = parseContentFile('/content/movies/2026/Dune Part Two.mp4', { type: 'movie', label: 'Filme', basePath: '/content/movies' });
assert(m2.type === 'movie', 'movie when no episode markers');
assert(/Dune/.test(m2.title), 'Dune title extracted');

console.log('\n--- type: auto ---');
const a1 = parseContentFile('/content/home/Some Show S01E01.mp4', { type: 'auto', label: 'Eigene', basePath: '/content/home' });
assert(a1.type === 'episode', 'auto picks episode when S01E01 present');

const a2 = parseContentFile('/content/home/Random clip.mp4', { type: 'auto', label: 'Eigene', basePath: '/content/home' });
assert(a2.type === 'movie', 'auto picks movie when no markers');
assert(/Random clip/.test(a2.title), 'plain filename becomes title');

console.log('\n--- Show fallback from directory ---');
const d1 = parseContentFile('/content/tv/Westworld/some-unparseable-file.mkv', { type: 'episode', label: 'Serien', basePath: '/content/tv' });
assert(d1.show === 'Westworld', 'directory becomes show fallback');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
```

- [ ] **Step 2: Run to verify failure**

```bash
node test/contentParser.test.js
```

Expected: Cannot find module.

- [ ] **Step 3: Implement `lib/content/parser.js`**

```js
const path = require('path');
const ptn = require('parse-torrent-name');

/**
 * Parse a filename into structured ContentEntry fields.
 *
 * Heuristics:
 *  - parse-torrent-name extracts title, year, season, episode, resolution
 *  - When season/episode are set, type is "episode"; otherwise "movie"
 *  - For episodes, the show name is the parser's title or, if that's the
 *    same as the filename or blank, the closest directory name
 *
 * @param {string} fullPath - absolute path to the file
 * @param {{type: 'movie'|'episode'|'auto', label: string, basePath: string}} ctx
 */
function parseContentFile(fullPath, ctx) {
  const base = path.basename(fullPath, path.extname(fullPath));
  const ext = path.extname(fullPath).toLowerCase();
  const parsed = ptn(base) || {};

  const hasEpisodeMarkers = parsed.season != null && parsed.episode != null;
  const type = ctx.type === 'auto'
    ? (hasEpisodeMarkers ? 'episode' : 'movie')
    : ctx.type;

  const out = {
    type,
    filename: path.basename(fullPath),
    ext,
    title: cleanTitle(parsed.title) || base,
    year: parsed.year ? Number(parsed.year) : null,
  };

  if (type === 'episode') {
    out.season = parsed.season != null ? Number(parsed.season) : null;
    out.episode = parsed.episode != null ? Number(parsed.episode) : null;
    out.show = pickShow(fullPath, ctx.basePath, parsed.title) || out.title;
    out.title = cleanEpisodeTitle(parsed, base) || `S${pad(out.season)}E${pad(out.episode)}`;
  }

  return out;
}

function cleanTitle(s) {
  if (!s) return null;
  return s.replace(/\s+/g, ' ').trim();
}

// For episodes, parse-torrent-name puts the SHOW name in `title`.
// The episode title is usually whatever comes after "SxxEyy - " in the
// original basename.
function cleanEpisodeTitle(parsed, base) {
  const m = base.match(/[Ss]\d{1,2}[Ee]\d{1,3}\s*[-_.\s]+(.+?)(?:[\.\[(]|$)/);
  if (m) return m[1].replace(/[\._]/g, ' ').trim();
  return null;
}

// Use parser title if it looks like a show name; otherwise use the closest
// directory above the file inside basePath.
function pickShow(fullPath, basePath, parserTitle) {
  if (parserTitle) {
    const cleaned = cleanTitle(parserTitle);
    if (cleaned && !/^\d{4}$/.test(cleaned)) return cleaned;
  }
  // walk up from file looking for first dir that is not the basePath
  let dir = path.dirname(fullPath);
  while (dir.length > basePath.length) {
    const name = path.basename(dir);
    if (!/^season\s*\d+$/i.test(name) && !/^staffel\s*\d+$/i.test(name)) {
      return name;
    }
    dir = path.dirname(dir);
  }
  return null;
}

function pad(n) {
  return n == null ? '??' : String(n).padStart(2, '0');
}

module.exports = { parseContentFile };
```

- [ ] **Step 4: Run tests**

```bash
node test/contentParser.test.js
```

Expected: `12 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add lib/content/parser.js test/contentParser.test.js
git commit -m "Add content filename parser with show/season/episode/year extraction"
```

---

### Task 4: Slug generator with collision handling

**Files:**
- Create: `lib/content/slug.js`
- Create: `test/contentSlug.test.js`

- [ ] **Step 1: Write the failing test**

```js
#!/usr/bin/env node
const { makeSlug, slugify } = require('../lib/content/slug');

let passed = 0, failed = 0;
function assert(c, m) { if (c) { console.log(`  ✓ ${m}`); passed++; } else { console.error(`  ✗ ${m}`); failed++; } }

console.log('\n--- slugify ---');
assert(slugify('Better Call Saul') === 'better-call-saul', 'spaces to dashes');
assert(slugify('Ärger mit Müll!') === 'aerger-mit-muell', 'umlauts');
assert(slugify('  Multiple   spaces  ') === 'multiple-spaces', 'collapse whitespace');
assert(slugify('a.b.c') === 'a-b-c', 'dots become dashes');
assert(slugify('Already-Slug') === 'already-slug', 'idempotent-ish');

console.log('\n--- makeSlug for movie ---');
const s1 = makeSlug({ pathLabel: 'Filme', type: 'movie', title: 'Inception', year: 2010 }, new Set());
assert(s1 === 'filme/inception-2010', `movie slug (got ${s1})`);

const s2 = makeSlug({ pathLabel: 'Filme', type: 'movie', title: 'Dune Part Two', year: null }, new Set());
assert(s2 === 'filme/dune-part-two', 'movie without year');

console.log('\n--- makeSlug for episode ---');
const e1 = makeSlug({
  pathLabel: 'Serien', type: 'episode',
  show: 'Better Call Saul', season: 4, episode: 6, title: 'Pinata',
}, new Set());
assert(e1 === 'serien/better-call-saul/s04e06-pinata', `episode slug (got ${e1})`);

console.log('\n--- Collision adds hash suffix ---');
const taken = new Set(['filme/inception-2010']);
const collision = makeSlug({ pathLabel: 'Filme', type: 'movie', title: 'Inception', year: 2010, path: '/content/movies/dupe/Inception.mp4' }, taken);
assert(collision !== 'filme/inception-2010', 'differs from existing');
assert(collision.startsWith('filme/inception-2010-'), 'has hash suffix');
assert(collision.length === 'filme/inception-2010-'.length + 8, '8-char hash');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
```

- [ ] **Step 2: Run to verify failure**

```bash
node test/contentSlug.test.js
```

Expected: Cannot find module.

- [ ] **Step 3: Implement `lib/content/slug.js`**

```js
const crypto = require('crypto');

const UMLAUT_MAP = { 'ä': 'ae', 'ö': 'oe', 'ü': 'ue', 'ß': 'ss', 'Ä': 'ae', 'Ö': 'oe', 'Ü': 'ue' };

function slugify(s) {
  if (!s) return '';
  return String(s)
    .replace(/[äöüßÄÖÜ]/g, c => UMLAUT_MAP[c])
    .toLowerCase()
    .replace(/[^\w\s-]+/g, ' ')
    .replace(/[\s_.]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function pad(n) {
  return n == null ? '00' : String(n).padStart(2, '0');
}

function makeSlug(entry, takenSet) {
  const labelSlug = slugify(entry.pathLabel);
  let base;
  if (entry.type === 'episode') {
    base = `${labelSlug}/${slugify(entry.show || 'unknown')}/s${pad(entry.season)}e${pad(entry.episode)}`;
    if (entry.title) {
      const t = slugify(entry.title);
      if (t && !/^s\d+e\d+$/.test(t)) base += '-' + t;
    }
  } else {
    base = `${labelSlug}/${slugify(entry.title || 'unknown')}`;
    if (entry.year) base += '-' + entry.year;
  }
  if (!takenSet.has(base)) return base;
  const hashInput = entry.path || JSON.stringify(entry);
  const hash = crypto.createHash('sha1').update(hashInput).digest('hex').slice(0, 8);
  return `${base}-${hash}`;
}

module.exports = { slugify, makeSlug };
```

- [ ] **Step 4: Run tests**

```bash
node test/contentSlug.test.js
```

Expected: `11 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add lib/content/slug.js test/contentSlug.test.js
git commit -m "Add slug generator for content IDs with collision-safe hash suffix"
```

---

### Task 5: Filesystem scanner

**Files:**
- Create: `lib/content/scanner.js`
- Create: `test/contentScanner.test.js`

- [ ] **Step 1: Write the failing test**

```js
#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');
const { scanPath } = require('../lib/content/scanner');

let passed = 0, failed = 0;
function assert(c, m) { if (c) { console.log(`  ✓ ${m}`); passed++; } else { console.error(`  ✗ ${m}`); failed++; } }

function mktemp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scantest-'));
  return dir;
}
function touch(p, sizeBytes = 5_000_000) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, Buffer.alloc(sizeBytes));
}

const CFG = {
  extensions: { directPlayCandidates: ['.mp4', '.m4v'], transcodeOnly: ['.mkv', '.avi'] },
  excludePatterns: ['sample', '@eaDir', '.partial', '_UNPACK_'],
};

(async () => {
  const root = mktemp();
  touch(path.join(root, 'Inception (2010).mp4'));
  touch(path.join(root, 'Dune.mkv'));
  touch(path.join(root, 'sample-trailer.mp4'), 500_000); // both: small + match exclude
  touch(path.join(root, '@eaDir/Thumbnails/x.mp4'));
  touch(path.join(root, 'tiny.mp4'), 100); // below 1 MB threshold
  touch(path.join(root, 'notes.txt')); // wrong extension
  touch(path.join(root, '.partial.mp4'));

  console.log('\n--- scanPath - basic walk ---');
  const entries = await scanPath({
    label: 'Filme', path: root, recursive: true, type: 'movie',
  }, CFG);
  const names = entries.map(e => e.filename).sort();
  assert(entries.length === 2, `2 entries (got ${entries.length}: ${names.join(', ')})`);
  assert(names.includes('Inception (2010).mp4'), 'finds Inception');
  assert(names.includes('Dune.mkv'), 'finds Dune');
  assert(!names.find(n => /sample/i.test(n)), 'sample excluded');
  assert(!names.find(n => /tiny/.test(n)), 'tiny file excluded by size');
  assert(!names.find(n => /partial/.test(n)), '.partial excluded');
  assert(!names.find(n => /notes/.test(n)), '.txt excluded');

  console.log('\n--- scanPath - entries have parsed metadata ---');
  const inception = entries.find(e => e.filename.startsWith('Inception'));
  assert(inception.title === 'Inception', 'inception title parsed');
  assert(inception.year === 2010, 'inception year parsed');
  assert(inception.size > 1_000_000, 'size populated');
  assert(typeof inception.mtime === 'string' && inception.mtime.length > 0, 'mtime populated');
  assert(inception.pathLabel === 'Filme', 'pathLabel propagated');
  assert(inception.path === path.join(root, 'Inception (2010).mp4'), 'absolute path');
  assert(inception.id && inception.id.startsWith('filme/'), `slug populated (got ${inception.id})`);

  console.log('\n--- scanPath - recursive false ---');
  const sub = path.join(root, 'inner', 'deep.mp4');
  touch(sub);
  const flat = await scanPath({
    label: 'Filme', path: root, recursive: false, type: 'movie',
  }, CFG);
  assert(!flat.find(e => /deep/.test(e.filename)), 'subdirectory skipped when recursive=false');

  console.log('\n--- scanPath - missing directory tolerated ---');
  const missing = await scanPath({
    label: 'X', path: '/nonexistent/totally', recursive: true, type: 'auto',
  }, CFG);
  assert(Array.isArray(missing) && missing.length === 0, 'returns empty list, no throw');

  fs.rmSync(root, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
```

- [ ] **Step 2: Run to verify failure**

```bash
node test/contentScanner.test.js
```

Expected: Cannot find module.

- [ ] **Step 3: Implement `lib/content/scanner.js`**

```js
const fs = require('fs');
const path = require('path');
const { parseContentFile } = require('./parser');
const { makeSlug } = require('./slug');

const MIN_SIZE_BYTES = 1_000_000;  // ignore <1 MB to skip samples/teasers

/**
 * Walk a single configured path and return ContentEntry objects.
 * Tolerant of missing directories (logs + returns []) so a disconnected
 * NAS mount doesn't break server startup.
 *
 * @param {{label, path, recursive, type, newerThanDays}} pathConfig
 * @param {{extensions, excludePatterns}} globalConfig
 */
async function scanPath(pathConfig, globalConfig) {
  if (!fs.existsSync(pathConfig.path)) {
    console.warn(`[content] scan: ${pathConfig.label}: path missing: ${pathConfig.path}`);
    return [];
  }
  const knownExts = new Set([
    ...globalConfig.extensions.directPlayCandidates,
    ...globalConfig.extensions.transcodeOnly,
  ].map(e => e.toLowerCase()));

  const excludeRe = new RegExp(
    globalConfig.excludePatterns.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
    'i',
  );

  const entries = [];
  const slugs = new Set();

  function walk(dir) {
    let dirents;
    try {
      dirents = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      console.warn(`[content] scan: cannot read ${dir}: ${err.message}`);
      return;
    }
    for (const d of dirents) {
      const full = path.join(dir, d.name);
      if (excludeRe.test(full)) continue;
      if (d.isDirectory()) {
        if (pathConfig.recursive) walk(full);
        continue;
      }
      if (!d.isFile()) continue;
      const ext = path.extname(d.name).toLowerCase();
      if (!knownExts.has(ext)) continue;
      let stat;
      try { stat = fs.statSync(full); } catch { continue; }
      if (stat.size < MIN_SIZE_BYTES) continue;

      const parsed = parseContentFile(full, {
        type: pathConfig.type,
        label: pathConfig.label,
        basePath: pathConfig.path,
      });
      const entry = {
        ...parsed,
        path: full,
        pathLabel: pathConfig.label,
        size: stat.size,
        mtime: stat.mtime.toISOString(),
        codecInfo: null,
      };
      entry.id = makeSlug(entry, slugs);
      slugs.add(entry.id);
      entries.push(entry);
    }
  }

  walk(pathConfig.path);
  return entries;
}

/**
 * Scan all configured paths. Returns combined entry list and a per-path summary.
 */
async function scanAll(pathsConfig) {
  const all = [];
  const summary = [];
  for (const p of pathsConfig.paths) {
    const before = all.length;
    const entries = await scanPath(p, pathsConfig);
    all.push(...entries);
    summary.push({ label: p.label, path: p.path, count: entries.length });
    console.log(`[content] scan: ${p.label} → ${entries.length} entries`);
  }
  return { entries: all, summary };
}

module.exports = { scanPath, scanAll };
```

- [ ] **Step 4: Run tests**

```bash
node test/contentScanner.test.js
```

Expected: `14 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add lib/content/scanner.js test/contentScanner.test.js
git commit -m "Add filesystem scanner with size/extension/exclude filtering"
```

---

### Task 6: In-memory + persisted index

**Files:**
- Create: `lib/content/index.js`
- Create: `test/contentIndex.test.js`

- [ ] **Step 1: Write the failing test**

```js
#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ContentIndex } = require('../lib/content/index');

let passed = 0, failed = 0;
function assert(c, m) { if (c) { console.log(`  ✓ ${m}`); passed++; } else { console.error(`  ✗ ${m}`); failed++; } }

function entry(id, overrides = {}) {
  return {
    id, path: '/x/' + id, pathLabel: 'Filme', filename: id + '.mp4',
    ext: '.mp4', size: 5_000_000, mtime: '2026-05-01T00:00:00Z',
    type: 'movie', title: id, codecInfo: null, ...overrides,
  };
}

(async () => {
  console.log('\n--- replaceAll + findById ---');
  const idx = new ContentIndex();
  idx.replaceAll([entry('a'), entry('b'), entry('c')]);
  assert(idx.findById('a').id === 'a', 'finds a');
  assert(idx.findById('missing') == null, 'returns null for missing');
  assert(idx.count() === 3, 'count is 3');

  console.log('\n--- persist + load ---');
  const file = path.join(os.tmpdir(), `idx.${Date.now()}.json`);
  idx.save(file);
  const idx2 = new ContentIndex();
  idx2.load(file);
  assert(idx2.count() === 3, 'persisted count 3');
  assert(idx2.findById('b').title === 'b', 'persisted entry intact');
  fs.unlinkSync(file);

  console.log('\n--- load missing file returns false ---');
  const idx3 = new ContentIndex();
  const ok = idx3.load('/nope/missing.json');
  assert(ok === false, 'load returns false on missing');
  assert(idx3.count() === 0, 'count stays 0');

  console.log('\n--- updateEntryCodec ---');
  const idx4 = new ContentIndex();
  idx4.replaceAll([entry('a')]);
  idx4.updateEntryCodec('a', { video: 'h264', audio: 'aac', directPlay: true });
  assert(idx4.findById('a').codecInfo.directPlay === true, 'codec info persisted');

  console.log('\n--- mergeFromScan - keeps codec cache for unchanged files ---');
  const idx5 = new ContentIndex();
  idx5.replaceAll([entry('a', { codecInfo: { directPlay: true, probedAt: '2026-04-01' } })]);
  idx5.mergeFromScan([
    entry('a'), // re-scanned, codecInfo null
    entry('b'), // new
  ]);
  assert(idx5.count() === 2, 'merged count 2');
  assert(idx5.findById('a').codecInfo?.directPlay === true, 'codec cache preserved');
  assert(idx5.findById('b').codecInfo === null, 'new entry has no codec yet');

  console.log('\n--- mergeFromScan - drops removed files ---');
  idx5.mergeFromScan([entry('a')]);
  assert(idx5.findById('b') == null, 'b dropped after rescan');
  assert(idx5.count() === 1, 'count back to 1');

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
```

- [ ] **Step 2: Run to verify failure**

```bash
node test/contentIndex.test.js
```

Expected: Cannot find module.

- [ ] **Step 3: Implement `lib/content/index.js`**

```js
const fs = require('fs');
const path = require('path');

const SCHEMA_VERSION = 1;

class ContentIndex {
  constructor() {
    this.entries = [];
    this.byId = new Map();
    this.scannedAt = null;
  }

  count() { return this.entries.length; }
  findById(id) { return this.byId.get(id) || null; }
  all() { return this.entries.slice(); }

  replaceAll(entries) {
    this.entries = entries.slice();
    this.byId.clear();
    for (const e of this.entries) this.byId.set(e.id, e);
    this.scannedAt = new Date().toISOString();
  }

  /**
   * Merge new scan into existing index, preserving codecInfo for entries
   * that survived (same id) and dropping entries that disappeared.
   */
  mergeFromScan(newEntries) {
    const oldById = this.byId;
    const merged = newEntries.map(e => {
      const prior = oldById.get(e.id);
      if (prior && prior.codecInfo) {
        return { ...e, codecInfo: prior.codecInfo };
      }
      return e;
    });
    this.replaceAll(merged);
  }

  updateEntryCodec(id, codecInfo) {
    const e = this.byId.get(id);
    if (!e) return false;
    e.codecInfo = codecInfo;
    return true;
  }

  save(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const data = {
      version: SCHEMA_VERSION,
      scannedAt: this.scannedAt || new Date().toISOString(),
      entries: this.entries,
    };
    const tmp = filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 0));
    fs.renameSync(tmp, filePath);
  }

  /** Returns true on success, false if file missing or schema mismatch. */
  load(filePath) {
    if (!fs.existsSync(filePath)) return false;
    let data;
    try {
      data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (err) {
      console.warn(`[content] index: failed to parse ${filePath}: ${err.message}`);
      return false;
    }
    if (data.version !== SCHEMA_VERSION) {
      console.warn(`[content] index: schema mismatch (got ${data.version}, want ${SCHEMA_VERSION}); rebuilding`);
      return false;
    }
    this.replaceAll(data.entries || []);
    this.scannedAt = data.scannedAt || this.scannedAt;
    return true;
  }
}

module.exports = { ContentIndex, SCHEMA_VERSION };
```

- [ ] **Step 4: Run tests**

```bash
node test/contentIndex.test.js
```

Expected: `11 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add lib/content/index.js test/contentIndex.test.js
git commit -m "Add ContentIndex with persistence and codec-cache-preserving merge"
```

---

### Task 7: Search and findNewest helpers

**Files:**
- Create: `lib/content/search.js`
- Create: `test/contentSearch.test.js`

- [ ] **Step 1: Write the failing test**

```js
#!/usr/bin/env node
const { searchLocal, findNewest, findExactEpisode, findLatestEpisode } = require('../lib/content/search');

let passed = 0, failed = 0;
function assert(c, m) { if (c) { console.log(`  ✓ ${m}`); passed++; } else { console.error(`  ✗ ${m}`); failed++; } }

const ENTRIES = [
  { id: 'serien/better-call-saul/s04e06', type: 'episode', show: 'Better Call Saul',
    season: 4, episode: 6, title: 'Pinata', pathLabel: 'Serien',
    mtime: '2026-04-20T00:00:00Z', filename: 'S04E06.mkv' },
  { id: 'serien/better-call-saul/s04e07', type: 'episode', show: 'Better Call Saul',
    season: 4, episode: 7, title: 'Something Stupid', pathLabel: 'Serien',
    mtime: '2026-04-27T00:00:00Z', filename: 'S04E07.mkv' },
  { id: 'serien/better-call-saul/s03e05', type: 'episode', show: 'Better Call Saul',
    season: 3, episode: 5, title: 'Old Stuff', pathLabel: 'Serien',
    mtime: '2025-12-01T00:00:00Z', filename: 'S03E05.mkv' },
  { id: 'filme/inception-2010', type: 'movie', title: 'Inception',
    year: 2010, pathLabel: 'Filme', mtime: '2026-05-01T00:00:00Z', filename: 'Inception.mp4' },
  { id: 'filme/tatort-2024', type: 'movie', title: 'Tatort - Im Schmerz geboren',
    year: 2024, pathLabel: 'Filme', mtime: '2026-04-30T00:00:00Z', filename: 'Tatort.mp4' },
];

console.log('\n--- searchLocal ---');
let res = searchLocal(ENTRIES, 'tatort');
assert(res.length === 1, 'finds Tatort');
assert(res[0].id === 'filme/tatort-2024', 'tatort id correct');

res = searchLocal(ENTRIES, 'Better Call Saul');
assert(res.length === 3, '3 BCS episodes');

res = searchLocal(ENTRIES, 'Saul');
assert(res.length === 3, 'partial show name match');

res = searchLocal(ENTRIES, 'pinata');
assert(res.length === 1 && res[0].title === 'Pinata', 'episode-title match');

res = searchLocal(ENTRIES, 'xyzdoesnotexist');
assert(res.length === 0, 'no results');

console.log('\n--- findNewest ---');
res = findNewest(ENTRIES, { limit: 10, uniquePerShow: false });
assert(res[0].mtime > res[1].mtime, 'sorted desc by mtime');

res = findNewest(ENTRIES, { limit: 10, uniquePerShow: true });
const bcsCount = res.filter(e => e.show === 'Better Call Saul').length;
assert(bcsCount === 1, 'uniquePerShow: only 1 BCS entry');
const bcsEntry = res.find(e => e.show === 'Better Call Saul');
assert(bcsEntry.episode === 7, 'newest BCS episode (S04E07)');

res = findNewest(ENTRIES, { label: 'Filme', limit: 10 });
assert(res.every(e => e.pathLabel === 'Filme'), 'label filter works');
assert(res.length === 2, '2 movies');

console.log('\n--- findNewest with newerThanDays filter ---');
const pathConfigs = [
  { label: 'Filme', newerThanDays: 5 },     // strict
  { label: 'Serien', newerThanDays: null }, // unrestricted
];
const now = new Date('2026-05-02T00:00:00Z');
res = findNewest(ENTRIES, { limit: 10, newerThanDaysOnly: true, pathConfigs, now });
const movieResults = res.filter(e => e.pathLabel === 'Filme');
assert(movieResults.length === 1, `5-day filter: only Inception (got ${movieResults.length})`);
assert(movieResults[0].id === 'filme/inception-2010', 'Inception is the new movie');

console.log('\n--- findExactEpisode ---');
const e = findExactEpisode(ENTRIES, 'better call saul', 4, 6);
assert(e && e.episode === 6, 'finds S04E06');

const nope = findExactEpisode(ENTRIES, 'better call saul', 4, 99);
assert(nope == null, 'returns null when missing');

console.log('\n--- findLatestEpisode ---');
const latest = findLatestEpisode(ENTRIES, 'better call saul');
assert(latest.season === 4 && latest.episode === 7, 'finds latest S04E07');

const latestNone = findLatestEpisode(ENTRIES, 'nothing here');
assert(latestNone == null, 'null when no show matches');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
```

- [ ] **Step 2: Run to verify failure**

```bash
node test/contentSearch.test.js
```

Expected: Cannot find module.

- [ ] **Step 3: Implement `lib/content/search.js`**

```js
const { slugify } = require('./slug');

function normalize(s) { return slugify(s || '').replace(/-/g, ' '); }

function tokenize(s) {
  return normalize(s).split(/\s+/).filter(Boolean);
}

function scoreEntry(entry, queryTokens) {
  if (queryTokens.length === 0) return 0;
  const haystacks = [
    { text: normalize(entry.show), weight: 5 },
    { text: normalize(entry.title), weight: 4 },
    { text: normalize(entry.filename), weight: 1 },
  ];
  let score = 0;
  for (const h of haystacks) {
    if (!h.text) continue;
    let matched = 0;
    for (const tok of queryTokens) {
      if (h.text.includes(tok)) matched++;
    }
    if (matched === queryTokens.length) score += h.weight * 2;
    else if (matched > 0) score += h.weight * (matched / queryTokens.length);
  }
  return score;
}

function searchLocal(entries, query, opts = {}) {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];
  const scored = entries
    .map(e => ({ entry: e, score: scoreEntry(e, tokens) }))
    .filter(s => s.score > 0);
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (b.entry.mtime || '').localeCompare(a.entry.mtime || '');
  });
  const limit = opts.limit || 10;
  return scored.slice(0, limit).map(s => s.entry);
}

function findNewest(entries, opts = {}) {
  const {
    label = null,
    limit = 20,
    uniquePerShow = true,
    newerThanDaysOnly = false,
    pathConfigs = [],
    now = new Date(),
  } = opts;

  const cutoffByLabel = new Map();
  if (newerThanDaysOnly) {
    for (const p of pathConfigs) {
      if (p.newerThanDays != null) {
        const cutoff = new Date(now.getTime() - p.newerThanDays * 86400_000);
        cutoffByLabel.set(p.label, cutoff);
      }
    }
  }

  let list = entries.slice();
  if (label) list = list.filter(e => e.pathLabel === label);
  if (newerThanDaysOnly) {
    list = list.filter(e => {
      const cutoff = cutoffByLabel.get(e.pathLabel);
      if (!cutoff) return true;
      return new Date(e.mtime) >= cutoff;
    });
  }
  list.sort((a, b) => (b.mtime || '').localeCompare(a.mtime || ''));

  if (uniquePerShow) {
    const seen = new Set();
    list = list.filter(e => {
      const key = e.show || e.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  return list.slice(0, limit);
}

function findExactEpisode(entries, show, season, episode) {
  const tokens = tokenize(show);
  return entries.find(e =>
    e.type === 'episode' &&
    e.season === season && e.episode === episode &&
    scoreEntry(e, tokens) > 0
  ) || null;
}

function findLatestEpisode(entries, show) {
  const tokens = tokenize(show);
  const matches = entries.filter(e =>
    e.type === 'episode' && scoreEntry(e, tokens) > 0,
  );
  if (matches.length === 0) return null;
  matches.sort((a, b) => {
    if ((b.season || 0) !== (a.season || 0)) return (b.season || 0) - (a.season || 0);
    return (b.episode || 0) - (a.episode || 0);
  });
  return matches[0];
}

module.exports = { searchLocal, findNewest, findExactEpisode, findLatestEpisode, scoreEntry };
```

- [ ] **Step 4: Run tests**

```bash
node test/contentSearch.test.js
```

Expected: `15 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add lib/content/search.js test/contentSearch.test.js
git commit -m "Add content search helpers (text query, newest, exact/latest episode)"
```

---

## Phase B — Codec probe & playback pipeline

### Task 8: Codec probe

**Files:**
- Create: `lib/content/codecProbe.js`
- Create: `test/contentCodecProbe.test.js`

- [ ] **Step 1: Write the failing test**

```js
#!/usr/bin/env node
const { decidePlayMode, probeIfNeeded } = require('../lib/content/codecProbe');

let passed = 0, failed = 0;
function assert(c, m) { if (c) { console.log(`  ✓ ${m}`); passed++; } else { console.error(`  ✗ ${m}`); failed++; } }

console.log('\n--- decidePlayMode ---');
assert(decidePlayMode({ ext: '.mp4', video: 'h264', audio: 'aac', level: 31 }) === true, 'mp4+h264+aac → direct');
assert(decidePlayMode({ ext: '.m4v', video: 'h264', audio: 'aac', level: 31 }) === true, 'm4v ok too');
assert(decidePlayMode({ ext: '.mkv', video: 'h264', audio: 'aac' }) === false, 'mkv not direct');
assert(decidePlayMode({ ext: '.mp4', video: 'hevc', audio: 'aac' }) === false, 'hevc not direct');
assert(decidePlayMode({ ext: '.mp4', video: 'h264', audio: 'ac3' }) === false, 'ac3 not direct');
assert(decidePlayMode({ ext: '.mp4', video: 'h264', audio: 'aac', level: 51 }) === false, 'level 5.1 too high');

console.log('\n--- probeIfNeeded - existing codecInfo short-circuit ---');
(async () => {
  const cached = { video: 'h264', audio: 'aac', directPlay: true, probedAt: 't' };
  const entry = { id: 'x', path: '/x', ext: '.mp4', codecInfo: cached };
  let called = 0;
  const fakeProbe = async () => { called++; return { video: 'h264', audio: 'aac' }; };
  const out = await probeIfNeeded(entry, { probeFn: fakeProbe });
  assert(out === cached, 'returns cached object as-is');
  assert(called === 0, 'probe not called');

  console.log('\n--- probeIfNeeded - runs probe + sets codecInfo ---');
  const entry2 = { id: 'y', path: '/y/Inception.mp4', ext: '.mp4', codecInfo: null };
  const out2 = await probeIfNeeded(entry2, {
    probeFn: async () => ({ video: 'h264', audio: 'aac', level: 31 }),
  });
  assert(out2.directPlay === true, 'directPlay decided');
  assert(out2.video === 'h264', 'video stored');
  assert(entry2.codecInfo === out2, 'entry.codecInfo populated');
  assert(typeof out2.probedAt === 'string', 'probedAt timestamp set');

  console.log('\n--- probeIfNeeded - probe failure → directPlay false ---');
  const entry3 = { id: 'z', path: '/z/broken.mkv', ext: '.mkv', codecInfo: null };
  const out3 = await probeIfNeeded(entry3, {
    probeFn: async () => { throw new Error('ffprobe boom'); },
  });
  assert(out3.directPlay === false, 'on error, default to transcode');
  assert(out3.error && /boom/.test(out3.error), 'error stored');

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
```

- [ ] **Step 2: Run to verify failure**

```bash
node test/contentCodecProbe.test.js
```

Expected: Cannot find module.

- [ ] **Step 3: Implement `lib/content/codecProbe.js`**

```js
const { spawn } = require('child_process');

const PROBE_TIMEOUT_MS = 5000;
const DIRECT_PLAY_EXTS = new Set(['.mp4', '.m4v']);
const DIRECT_PLAY_VIDEO = 'h264';
const DIRECT_PLAY_AUDIO = 'aac';
const MAX_H264_LEVEL = 41;  // Echo Show supports up to level 4.1

function decidePlayMode(info) {
  if (!info) return false;
  if (!DIRECT_PLAY_EXTS.has(info.ext)) return false;
  if (info.video !== DIRECT_PLAY_VIDEO) return false;
  if (info.audio !== DIRECT_PLAY_AUDIO) return false;
  if (info.level != null && info.level > MAX_H264_LEVEL) return false;
  return true;
}

function defaultFfprobe(filePath) {
  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'error',
      '-print_format', 'json',
      '-show_streams',
      '-i', filePath,
    ];
    const proc = spawn('ffprobe', args);
    let out = '';
    let err = '';
    proc.stdout.on('data', d => { out += d; });
    proc.stderr.on('data', d => { err += d; });
    const timer = setTimeout(() => proc.kill('SIGKILL'), PROBE_TIMEOUT_MS);
    proc.on('exit', code => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`ffprobe exited ${code}: ${err.slice(0, 200)}`));
      try {
        const data = JSON.parse(out);
        const v = (data.streams || []).find(s => s.codec_type === 'video');
        const a = (data.streams || []).find(s => s.codec_type === 'audio');
        resolve({
          video: v?.codec_name || null,
          audio: a?.codec_name || null,
          level: v?.level != null ? Number(v.level) : null,
        });
      } catch (e) { reject(e); }
    });
    proc.on('error', reject);
  });
}

/**
 * Run ffprobe on entry.path (lazy: skip if entry.codecInfo already populated).
 * Mutates entry.codecInfo on success and on probe failure. Returns the codecInfo.
 */
async function probeIfNeeded(entry, opts = {}) {
  if (entry.codecInfo) return entry.codecInfo;
  const probeFn = opts.probeFn || defaultFfprobe;
  try {
    const raw = await probeFn(entry.path);
    const info = {
      ...raw,
      ext: entry.ext,
      directPlay: decidePlayMode({ ...raw, ext: entry.ext }),
      probedAt: new Date().toISOString(),
    };
    entry.codecInfo = info;
    return info;
  } catch (err) {
    const info = {
      directPlay: false,
      error: err.message,
      probedAt: new Date().toISOString(),
    };
    entry.codecInfo = info;
    return info;
  }
}

module.exports = { probeIfNeeded, decidePlayMode, defaultFfprobe };
```

- [ ] **Step 4: Run tests**

```bash
node test/contentCodecProbe.test.js
```

Expected: `11 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add lib/content/codecProbe.js test/contentCodecProbe.test.js
git commit -m "Add lazy codec probe with direct-play/transcode decision"
```

---

### Task 9: Streamer supports `source: 'local'`

**Files:**
- Modify: `lib/fritzbox/streamer.js`
- Modify: `lib/sources/fritzboxSource.js`
- Modify: `test/fritzboxStreamer.test.js`

- [ ] **Step 1: Extend the streamer test**

Append to `test/fritzboxStreamer.test.js` (before the IIFE that runs the tests):

```js
async function testLocalSourceTranscode() {
  console.log('\n--- start({ source: "local" }) passes inputPath to ffmpeg ---');
  const streamDir = fs.mkdtempSync(path.join(os.tmpdir(), 'streamertest-'));
  let spawned = null;
  const s = new Streamer({
    streamDir,
    spawnFn: (cmd, args) => { spawned = args; return makeFakeProc(); },
    waitForSegmentFn: async () => true,
    resolveRtsp: async () => { throw new Error('resolveRtsp must not be called for local'); },
    getPipeline: async () => 'transcode',
  });

  await s.start({
    source: 'local',
    id: 'film-x',
    displayName: 'Film X',
    inputPath: '/path/to/Film X.mkv',
  });

  assert(spawned !== null, 'spawn called');
  const idx = spawned.indexOf('-i');
  assert(idx >= 0 && spawned[idx + 1] === '/path/to/Film X.mkv', 'inputPath passed as -i argument');
  assert(!spawned.includes('-rtsp_transport'), 'no -rtsp_transport for local source');
  const hlsListIdx = spawned.indexOf('-hls_list_size');
  assert(hlsListIdx >= 0 && spawned[hlsListIdx + 1] === '30', 'hls_list_size=30 for local source');

  await s.stop();
  fs.rmSync(streamDir, { recursive: true, force: true });
}

async function testFritzboxSourceUnchanged() {
  console.log('\n--- start({ source: "fritzbox" }) still produces RTSP args ---');
  const streamDir = fs.mkdtempSync(path.join(os.tmpdir(), 'streamertest-'));
  let spawned = null;
  const s = new Streamer({
    streamDir,
    spawnFn: (cmd, args) => { spawned = args; return makeFakeProc(); },
    waitForSegmentFn: async () => true,
    resolveRtsp: async (tid) => `rtsp://x/${tid}`,
    getPipeline: async () => 'transcode',
  });

  await s.start({ source: 'fritzbox', id: 'orf1', tunerId: 'T1', displayName: 'ORF1' });
  assert(spawned.includes('-rtsp_transport'), 'rtsp_transport present');
  const idx = spawned.indexOf('-i');
  assert(spawned[idx + 1] === 'rtsp://x/T1', 'resolved RTSP URL is input');
  const hlsListIdx = spawned.indexOf('-hls_list_size');
  assert(spawned[hlsListIdx + 1] === '3', 'hls_list_size=3 for fritzbox source');

  await s.stop();
  fs.rmSync(streamDir, { recursive: true, force: true });
}
```

And add `await testLocalSourceTranscode(); await testFritzboxSourceUnchanged();` to the IIFE.

- [ ] **Step 2: Run test to verify it fails**

```bash
node test/fritzboxStreamer.test.js
```

Expected: spawned has `-rtsp_transport` because current code unconditionally adds it.

- [ ] **Step 3: Update `lib/fritzbox/streamer.js`**

Replace `copyArgs` and `transcodeArgs`:

```js
function copyArgs({ inputArgs, hlsListSize, audioMap, outDir }) {
  const audioMapArgs = audioMap ? ['-map', audioMap] : ['-map', '0:a:0?'];
  const audioBitrate = process.env.FRITZBOX_AUDIO_BITRATE || '128k';
  return [
    '-loglevel', 'warning',
    ...inputArgs,
    '-map', '0:v:0', ...audioMapArgs,
    '-ignore_unknown',
    '-c:v', 'copy',
    '-c:a', 'aac', '-b:a', audioBitrate, '-ac', '2',
    '-hls_time', '4',
    '-hls_list_size', String(hlsListSize),
    '-hls_flags', 'delete_segments+append_list',
    '-hls_segment_filename', path.join(outDir, 'seg_%03d.ts'),
    '-f', 'hls',
    path.join(outDir, 'index.m3u8'),
  ];
}

function transcodeArgs({ inputArgs, hlsListSize, audioMap, outDir }) {
  const audioMapArgs = audioMap ? ['-map', audioMap] : ['-map', '0:a:0?'];
  const s = getTranscodeSettings();
  return [
    '-loglevel', 'warning',
    ...inputArgs,
    '-map', '0:v:0', ...audioMapArgs,
    '-ignore_unknown',
    '-c:v', 'libx264', '-profile:v', 'main', '-level', '3.1',
    '-preset', s.preset,
    '-b:v', s.videoBitrate,
    '-vf', `scale=${s.scale}`,
    '-g', '50',
    '-c:a', 'aac', '-b:a', s.audioBitrate, '-ac', '2',
    '-hls_time', '6',
    '-hls_list_size', String(hlsListSize),
    '-hls_flags', 'delete_segments+append_list',
    '-hls_segment_filename', path.join(outDir, 'seg_%03d.ts'),
    '-f', 'hls',
    path.join(outDir, 'index.m3u8'),
  ];
}

function buildInputArgs(source, resolved) {
  if (source === 'local') {
    return ['-i', resolved];
  }
  return [
    '-rtsp_transport', 'udp',
    '-buffer_size', '8388608',
    '-i', resolved,
  ];
}
```

In `Streamer.start()`, replace the section that resolves rtsp + builds args. Find:

```js
    let rtspUrl, pipeline, audioMap = null;
    try {
      rtspUrl = await this.resolveRtsp(channel.tunerId);
      pipeline = await this.getPipeline(channel.tunerId, rtspUrl);
      if (this.pickAudioMap) {
        try {
          audioMap = await this.pickAudioMap(channel.tunerId, rtspUrl);
        } catch {
          audioMap = null;
        }
      }
    } catch (err) {
      this.state = 'IDLE';
      throw err;
    }

    const args = pipeline === 'copy'
      ? copyArgs(rtspUrl, this.streamDir, audioMap)
      : transcodeArgs(rtspUrl, this.streamDir, audioMap);
```

Replace with:

```js
    const source = channel.source || 'fritzbox';
    let resolvedInput, pipeline, audioMap = null;
    try {
      if (source === 'local') {
        resolvedInput = channel.inputPath;
        pipeline = 'transcode';  // local mkv/mp4 need codec/container normalisation
        if (channel.audioMap) audioMap = channel.audioMap;
      } else {
        resolvedInput = await this.resolveRtsp(channel.tunerId);
        pipeline = await this.getPipeline(channel.tunerId, resolvedInput);
        if (this.pickAudioMap) {
          try {
            audioMap = await this.pickAudioMap(channel.tunerId, resolvedInput);
          } catch {
            audioMap = null;
          }
        }
      }
    } catch (err) {
      this.state = 'IDLE';
      throw err;
    }

    const inputArgs = buildInputArgs(source, resolvedInput);
    const hlsListSize = source === 'local' ? 30 : 3;
    const args = pipeline === 'copy'
      ? copyArgs({ inputArgs, hlsListSize, audioMap, outDir: this.streamDir })
      : transcodeArgs({ inputArgs, hlsListSize, audioMap, outDir: this.streamDir });
```

Then in the same function, find the log line:

```js
    console.log(`[stream]   tuner=${channel.tunerId}  pipeline=${pipeline}  audio=${audioMap || '(default first track)'}`);
```

Replace with:

```js
    const source_descriptor = source === 'local'
      ? `path=${channel.inputPath}`
      : `tuner=${channel.tunerId}`;
    console.log(`[stream]   source=${source}  ${source_descriptor}  pipeline=${pipeline}  audio=${audioMap || '(default first track)'}`);
```

Then in `getDiagnosticState()` (search for `getDiagnosticState`), update the `current` object so it works for both sources. Find:

```js
      current: {
        channelId: c.channelId,
        tunerId: c.tunerId,
        ...
```

and add `source: c.source || 'fritzbox'` after `channelId`. Make `tunerId` optional - it's null for local.

In the spawn-and-track block (search for `this.current = {`), add `source` and `inputPath`:

```js
    this.current = {
      channelId: channel.id,
      source,
      tunerId: channel.tunerId,
      inputPath: channel.inputPath,
      displayName: channel.displayName,
      pipeline,
      audioMap,
      rtspUrl: source === 'fritzbox' ? resolvedInput : null,
      ffmpegArgs: args,
      startedAt: new Date(startedAtMs).toISOString(),
      startedAtMs,
      proc,
    };
```

Finally, update `module.exports`:

```js
module.exports = { Streamer, copyArgs, transcodeArgs, getTranscodeSettings, buildInputArgs };
```

- [ ] **Step 4: Update existing test that called `start({ id: 'q', tunerId: 'tq', displayName: 'Q' })`**

In `test/fritzboxStreamer.test.js`, every `s.start({ id: ..., tunerId: ..., displayName: ... })` call works as before because `source` defaults to `'fritzbox'` when not passed. No change needed.

- [ ] **Step 5: Update `lib/sources/fritzboxSource.js`**

In `FritzboxSource.resolveStream()`, find the `streamer.start(this)` call. Replace with a wrapper object that explicitly sets the new shape:

```js
    streamer.start({
      source: 'fritzbox',
      id: this.id,
      tunerId: this.tunerId,
      displayName: this.displayName,
    }).catch((err) => {
      console.error(`FritzboxSource: streamer.start(${this.id}) failed:`, err.message);
    });
```

- [ ] **Step 6: Run all tests**

```bash
JWT_SECRET=test1234567890abcdef1234567890abcdef \
node test/fritzboxStreamer.test.js && \
node test/sourceChannel.test.js && \
node test/audioPicker.test.js
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add lib/fritzbox/streamer.js lib/sources/fritzboxSource.js test/fritzboxStreamer.test.js
git commit -m "Streamer: support source: 'local' mode for direct file input"
```

---

### Task 10: ContentSource (resolveStream)

**Files:**
- Create: `lib/content/contentSource.js`
- Create: `test/contentSource.test.js`

- [ ] **Step 1: Write the failing test**

```js
#!/usr/bin/env node
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-1234567890abcdef1234567890abcdef';
process.env.BASE_URL = 'http://localhost:3000';

const contentSource = require('../lib/content/contentSource');

let passed = 0, failed = 0;
function assert(c, m) { if (c) { console.log(`  ✓ ${m}`); passed++; } else { console.error(`  ✗ ${m}`); failed++; } }

(async () => {
  console.log('\n--- direct-play returns /content/<id>/file.mp4 ---');
  const entry = {
    id: 'filme/inception-2010', path: '/x/Inception.mp4', ext: '.mp4', codecInfo: null,
  };
  const index = { findById: id => id === entry.id ? entry : null };
  const fakeProbe = { probeIfNeeded: async (e) => ({ directPlay: true, video: 'h264', audio: 'aac' }) };
  const fakeStreamer = { start: async () => { throw new Error('streamer must not be called for direct-play'); } };

  contentSource._setDepsForTest({ index, probe: fakeProbe, streamer: fakeStreamer });

  const out = await contentSource.resolveStream(entry.id);
  assert(out.url.includes('/content/filme/inception-2010/file.mp4'), `URL has /content/ path (got ${out.url})`);
  assert(out.url.includes('token='), 'URL has token');
  assert(out.mimeType === 'video/mp4', 'mimeType mp4');
  assert(out.isLive === false, 'isLive false');

  console.log('\n--- transcode returns /stream/fritzbox/index.m3u8 ---');
  const entry2 = {
    id: 'serien/x/s01e01', path: '/x/show.mkv', ext: '.mkv', codecInfo: null,
    displayName: 'X', title: 'X',
  };
  const index2 = { findById: id => id === entry2.id ? entry2 : null };
  const fakeProbe2 = { probeIfNeeded: async () => ({ directPlay: false, video: 'hevc' }) };
  let started = null;
  const fakeStreamer2 = { start: async (channel) => { started = channel; } };

  contentSource._setDepsForTest({ index: index2, probe: fakeProbe2, streamer: fakeStreamer2 });
  const out2 = await contentSource.resolveStream(entry2.id);
  assert(out2.url.includes('/stream/fritzbox/index.m3u8'), 'transcode URL is the streamer playlist');
  assert(out2.mimeType === 'application/vnd.apple.mpegurl', 'mimeType m3u8');
  assert(started && started.source === 'local', 'streamer.start called with source local');
  assert(started.inputPath === entry2.path, 'inputPath passed');

  console.log('\n--- unknown id throws ---');
  contentSource._setDepsForTest({ index: { findById: () => null }, probe: fakeProbe, streamer: fakeStreamer });
  let err;
  try { await contentSource.resolveStream('missing'); } catch (e) { err = e; }
  assert(err && /unknown/.test(err.message.toLowerCase()), 'throws for unknown id');

  contentSource._resetDepsForTest();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
```

- [ ] **Step 2: Run to verify failure**

```bash
node test/contentSource.test.js
```

Expected: Cannot find module.

- [ ] **Step 3: Implement `lib/content/contentSource.js`**

```js
const { generateStreamToken } = require('../auth');

let _index = null;
let _probe = null;
let _streamer = null;

function _setDeps({ index, probe, streamer }) {
  _index = index; _probe = probe; _streamer = streamer;
}

function _getDeps() {
  if (_index && _probe && _streamer) return { index: _index, probe: _probe, streamer: _streamer };
  throw new Error('contentSource not initialised; call init() at server startup');
}

function init({ index, probeIfNeeded, streamer }) {
  _setDeps({ index, probe: { probeIfNeeded }, streamer });
}

async function resolveStream(itemId) {
  const { index, probe, streamer } = _getDeps();
  const entry = index.findById(itemId);
  if (!entry) throw new Error(`unknown content id: ${itemId}`);

  const codec = await probe.probeIfNeeded(entry);
  const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
  const token = generateStreamToken(entry.id);

  if (codec.directPlay) {
    return {
      url: `${baseUrl}/content/${entry.id}/file.mp4?token=${token}`,
      mimeType: 'video/mp4',
      isLive: false,
    };
  }

  // transcode via shared streamer; fire-and-forget so caller's await
  // returns quickly (FFmpeg can take 5-10s to produce first segment)
  streamer.start({
    source: 'local',
    id: entry.id,
    inputPath: entry.path,
    displayName: entry.title || entry.filename,
  }).catch(err => {
    console.error(`contentSource: streamer.start(${entry.id}) failed:`, err.message);
  });

  return {
    url: `${baseUrl}/stream/fritzbox/index.m3u8?token=${token}`,
    mimeType: 'application/vnd.apple.mpegurl',
    isLive: false,
  };
}

function _setDepsForTest(deps) { _setDeps(deps); }
function _resetDepsForTest() { _index = _probe = _streamer = null; }

module.exports = { init, resolveStream, _setDepsForTest, _resetDepsForTest };
```

- [ ] **Step 4: Run tests**

```bash
node test/contentSource.test.js
```

Expected: `9 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add lib/content/contentSource.js test/contentSource.test.js
git commit -m "Add ContentSource resolving direct-play vs transcode for local files"
```

---

## Phase C — Server wiring (HTTP routes, scanner bootstrap)

### Task 11: Content service singleton + scanner bootstrap

**Files:**
- Create: `lib/content/service.js`
- Modify: `server.js`

- [ ] **Step 1: Implement `lib/content/service.js`**

This module is the glue between scanner, index, codec probe, and the rest of the system. It owns the in-memory `ContentIndex` and the periodic re-scan timer.

```js
const path = require('path');
const { loadPathsConfig } = require('./paths');
const { scanAll } = require('./scanner');
const { ContentIndex } = require('./index');
const { probeIfNeeded } = require('./codecProbe');
const contentSource = require('./contentSource');

const DEFAULT_INDEX_FILE = path.join(__dirname, '..', '..', 'data', 'content-index.json');
const DEFAULT_RESCAN_MINUTES = 30;

let _config = null;
let _index = null;
let _rescanTimer = null;
let _indexFile = DEFAULT_INDEX_FILE;
let _streamer = null;
let _initialized = false;
let _scanInFlight = false;

function isEnabled() { return _initialized; }
function getIndex() { return _index; }
function getConfig() { return _config; }

async function init({ configPath, indexFile, streamer }) {
  _config = loadPathsConfig(configPath);
  if (!_config) {
    console.log('[content] no content-paths.json found; feature disabled');
    return false;
  }
  _index = new ContentIndex();
  _indexFile = indexFile || DEFAULT_INDEX_FILE;
  _streamer = streamer;

  const loaded = _index.load(_indexFile);
  if (loaded) {
    console.log(`[content] loaded ${_index.count()} entries from ${_indexFile}`);
  }

  contentSource.init({ index: _index, probeIfNeeded, streamer });
  _initialized = true;

  // Background full re-scan on startup (non-blocking)
  setImmediate(() => rescan().catch(err => console.error('[content] startup rescan failed:', err.message)));

  // Periodic re-scan
  const minutes = Number(process.env.CONTENT_RESCAN_MINUTES) || DEFAULT_RESCAN_MINUTES;
  _rescanTimer = setInterval(() => {
    rescan().catch(err => console.error('[content] periodic rescan failed:', err.message));
  }, minutes * 60 * 1000);

  return true;
}

async function rescan() {
  if (!_config) return { entries: 0 };
  if (_scanInFlight) {
    console.log('[content] rescan: already running, skipping');
    return { entries: _index.count(), skipped: true };
  }
  _scanInFlight = true;
  try {
    const t0 = Date.now();
    const { entries, summary } = await scanAll(_config);
    _index.mergeFromScan(entries);
    try { _index.save(_indexFile); } catch (err) {
      console.warn(`[content] index save failed: ${err.message}`);
    }
    const dt = Date.now() - t0;
    console.log(`[content] rescan: ${entries.length} entries in ${dt}ms`);
    return { entries: entries.length, summary, durationMs: dt };
  } finally {
    _scanInFlight = false;
  }
}

function shutdown() {
  if (_rescanTimer) clearInterval(_rescanTimer);
  _rescanTimer = null;
}

module.exports = { init, rescan, shutdown, isEnabled, getIndex, getConfig };
```

- [ ] **Step 2: Wire it into `server.js`**

Locate the FRITZ!Box tuner verification block in `server.js` (after `app.listen(...)`). Just before that block (still inside the listen callback), add:

```js
// --- Local content (NAS) bootstrap ---
(async () => {
  try {
    const contentService = require('./lib/content/service');
    const { Streamer } = require('./lib/fritzbox/streamer');
    // Reuse the existing streamer instance from FritzboxSource so live-TV
    // and local files share one ffmpeg slot.
    const fritzboxSource = require('./lib/sources/fritzboxSource');
    const streamer = fritzboxSource._getStreamerForContent
      ? fritzboxSource._getStreamerForContent()
      : null;
    if (!streamer) {
      console.warn('[content] no shared streamer available; FRITZ!Box not configured? local-file transcode will fail');
    }
    const configPath = process.env.CONTENT_CONFIG_PATH ||
      require('path').join(__dirname, 'config', 'content-paths.json');
    const ok = await contentService.init({ configPath, streamer });
    if (ok) console.log(`  Local content: aktiviert (${contentService.getConfig().paths.length} Pfade)`);
    else    console.log('  Local content: deaktiviert (keine config/content-paths.json)');
  } catch (err) {
    console.warn(`[content] init failed: ${err.message}`);
  }
})();
```

- [ ] **Step 3: Add streamer accessor to `lib/sources/fritzboxSource.js`**

In `lib/sources/fritzboxSource.js`, add a public accessor that lazily creates the streamer even when no FRITZ!Box channels exist yet. This is needed because content-only setups (no FRITZ!Box) still need a streamer for transcode.

After the existing `_getStreamer()` function, add:

```js
/**
 * Public accessor for the shared Streamer instance (used by lib/content/*
 * so live-TV and local-file transcode share a single ffmpeg slot).
 * Returns null if FRITZ!Box is unconfigured AND no streamer was created yet -
 * caller may build its own streamer in that case.
 */
function _getStreamerForContent() {
  try {
    return _getStreamer();
  } catch {
    return null;  // FRITZ!Box not configured - content can still init its own minimal streamer if needed
  }
}
```

And export it: add `_getStreamerForContent` to the `module.exports`.

- [ ] **Step 4: Handle the "no FRITZ!Box configured, but content enabled" case**

If `_getStreamerForContent()` returns null, the content service should build its own minimal streamer. Crucially, that streamer must also be **registered back into `fritzboxSource`** so that any future FRITZ!Box config (or a Live-TV intent) uses the **same** streamer instance - otherwise local and live TV would compete for the single hardware tuner slot via different in-process state.

In `lib/sources/fritzboxSource.js`, add an injection point:

```js
function _setStreamerForBootstrap(s) {
  _streamer = s;
}
```

Export it: add `_setStreamerForBootstrap` to `module.exports`.

Now update `lib/content/service.js`'s `init()`. Find this line:

```js
  _streamer = streamer;
```

Replace with:

```js
  if (streamer) {
    _streamer = streamer;
  } else {
    const { Streamer } = require('../fritzbox/streamer');
    _streamer = new Streamer({
      // Local-only streamer - never resolves RTSP, never picks audio.
      // resolveRtsp left unset since source: 'local' bypasses it.
      getPipeline: async () => 'transcode',
    });
    // Inject back into fritzboxSource so a later live-TV call shares this slot
    const fritzboxSource = require('../sources/fritzboxSource');
    if (fritzboxSource._setStreamerForBootstrap) {
      fritzboxSource._setStreamerForBootstrap(_streamer);
    }
    console.log('[content] using standalone streamer (FRITZ!Box not configured)');
  }
```

- [ ] **Step 5: Smoke-test server start**

```bash
JWT_SECRET=test1234567890abcdef1234567890abcdef PORT=33999 timeout 4 node server.js 2>&1 | grep -E '(MyVideo|Local content|FRITZ!Box)' || true
```

Expected: server starts, prints `Local content: deaktiviert` (no config file).

- [ ] **Step 6: Commit**

```bash
git add lib/content/service.js lib/sources/fritzboxSource.js server.js
git commit -m "Add content service singleton with scanner bootstrap and periodic rescan"
```

---

### Task 12: HTTP routes — `/content/:id/file.mp4` (direct-play) + `/diag/content/*`

**Files:**
- Modify: `server.js`

- [ ] **Step 1: Add direct-play route**

In `server.js`, after the `/stream/fritzbox/*` router block (`app.use('/stream', fritzboxStreamRouter);`), add:

```js
// --- Local content direct-play ---
const contentService = require('./lib/content/service');
const contentRouter = express.Router();
contentRouter.use(authMiddleware());

// /content/<id>/file.mp4  -- direct stream of the local file
// Note: <id> contains '/' (e.g. "filme/inception-2010"), so we use a wildcard.
contentRouter.get(/^\/(.+)\/file\.mp4$/, (req, res) => {
  if (!contentService.isEnabled()) return res.status(503).json({ error: 'content not configured' });
  const id = req.params[0];
  const entry = contentService.getIndex().findById(id);
  if (!entry) return res.status(404).json({ error: `unknown content id: ${id}` });
  if (req.tokenPayload?.sub !== id) {
    return res.status(403).json({ error: 'token mismatch' });
  }
  res.sendFile(entry.path);
});
app.use('/content', contentRouter);
```

- [ ] **Step 2: Add /diag/content/* routes**

In `server.js`, find the existing `const diagRouter = express.Router();` block. Add these routes inside it (before the final index `/` route):

```js
diagRouter.get('/content/stats', (req, res) => {
  if (!contentService.isEnabled()) return res.json({ enabled: false });
  const idx = contentService.getIndex();
  const cfg = contentService.getConfig();
  const byLabel = {};
  for (const e of idx.all()) {
    byLabel[e.pathLabel] = (byLabel[e.pathLabel] || 0) + 1;
  }
  res.json({
    enabled: true,
    totalEntries: idx.count(),
    scannedAt: idx.scannedAt,
    perLabel: byLabel,
    config: cfg.paths.map(p => ({ label: p.label, path: p.path, newerThanDays: p.newerThanDays })),
  });
});

diagRouter.get('/content/search', (req, res) => {
  if (!contentService.isEnabled()) return res.status(503).json({ error: 'disabled' });
  const q = req.query.q || '';
  const { searchLocal } = require('./lib/content/search');
  const hits = searchLocal(contentService.getIndex().all(), q, { limit: 20 });
  res.json({ query: q, count: hits.length, results: hits });
});

diagRouter.get('/content/item/:id(*)', (req, res) => {
  if (!contentService.isEnabled()) return res.status(503).json({ error: 'disabled' });
  const entry = contentService.getIndex().findById(req.params.id);
  if (!entry) return res.status(404).json({ error: 'not found' });
  res.json(entry);
});

diagRouter.post('/content/reindex', async (req, res) => {
  if (!contentService.isEnabled()) return res.status(503).json({ error: 'disabled' });
  try {
    const result = await contentService.rescan();
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

diagRouter.get('/content/config', (req, res) => {
  if (!contentService.isEnabled()) return res.status(503).json({ error: 'disabled' });
  res.json(contentService.getConfig());
});
```

Update the `/` index endpoint inside `diagRouter` to include the new routes:

```js
diagRouter.get('/', (req, res) => {
  res.json({
    available: [
      'GET /diag/channels',
      'GET /diag/stream-state',
      'GET /diag/segments',
      'GET /diag/audio/:channelId',
      'GET /diag/session',
      'GET /diag/settings',
      'GET /diag/content/stats',
      'GET /diag/content/search?q=...',
      'GET /diag/content/item/:id',
      'POST /diag/content/reindex',
      'GET /diag/content/config',
    ],
    note: 'LAN-only. Cloudflare-Tunnel requests get 404.',
  });
});
```

- [ ] **Step 3: Smoke-test**

```bash
JWT_SECRET=test1234567890abcdef1234567890abcdef PORT=33999 \
  node server.js &
PID=$!
sleep 1
curl -s http://localhost:33999/diag/content/stats
curl -s http://localhost:33999/diag/ | head -c 400
echo
kill $PID
```

Expected: `{ "enabled": false }` from stats (no config), index lists `/diag/content/*` routes.

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "Add /content/:id/file.mp4 direct-play route and /diag/content/* endpoints"
```

---

## Phase D — Voice model & handlers

### Task 13: Voice model updates

**Files:**
- Modify: `skill/model/de-DE.json`

- [ ] **Step 1: Read current model**

```bash
python3 -c "import json; d=json.load(open('skill/model/de-DE.json')); print([i['name'] for i in d['interactionModel']['languageModel']['intents']])"
```

- [ ] **Step 2: Add 4 new intents and the CONTENT_LABEL slot**

Edit `skill/model/de-DE.json`. In `interactionModel.languageModel.intents` add these four blocks at the end (just before `AMAZON.NavigateHomeIntent`):

```json
,{
  "name": "SearchEverythingIntent",
  "slots": [{ "name": "query", "type": "AMAZON.SearchQuery" }],
  "samples": [
    "suche {query}",
    "finde {query}",
    "suche nach {query}",
    "gibt es {query}",
    "hast du {query}"
  ]
},
{
  "name": "SearchContentIntent",
  "slots": [{ "name": "query", "type": "AMAZON.SearchQuery" }],
  "samples": [
    "suche {query} lokal",
    "suche {query} in meiner sammlung",
    "suche lokal nach {query}",
    "finde {query} lokal"
  ]
},
{
  "name": "ListNewContentIntent",
  "slots": [{ "name": "label", "type": "CONTENT_LABEL" }],
  "samples": [
    "was gibt es neues",
    "zeige neues",
    "was ist neu",
    "neue {label}",
    "was gibt es neues bei {label}",
    "zeige neue {label}"
  ]
},
{
  "name": "PlayShowIntent",
  "slots": [
    { "name": "show", "type": "AMAZON.SearchQuery" },
    { "name": "season", "type": "AMAZON.NUMBER" },
    { "name": "episode", "type": "AMAZON.NUMBER" }
  ],
  "samples": [
    "spiele {show}",
    "starte {show}",
    "spiele {show} folge {episode}",
    "spiele {show} episode {episode}",
    "spiele {show} staffel {season} folge {episode}",
    "weiterschauen {show}"
  ]
}
```

In `interactionModel.languageModel.types` add at the end:

```json
,{
  "name": "CONTENT_LABEL",
  "values": [
    { "name": { "value": "Filme",  "synonyms": ["Film"] } },
    { "name": { "value": "Serien", "synonyms": ["Serie", "Series", "TV"] } },
    { "name": { "value": "Eigene", "synonyms": ["Eigene Aufnahmen", "Aufnahmen", "Privat"] } }
  ]
}
```

- [ ] **Step 3: Verify JSON valid**

```bash
python3 -c "import json; d=json.load(open('skill/model/de-DE.json')); print('intents:', len(d['interactionModel']['languageModel']['intents'])); print('types:', [t['name'] for t in d['interactionModel']['languageModel']['types']])"
```

Expected: intent count grew by 4, CONTENT_LABEL present.

- [ ] **Step 4: Commit**

```bash
git add skill/model/de-DE.json
git commit -m "Voice model: add SearchEverything/SearchContent/ListNewContent/PlayShow intents"
```

---

### Task 14: SearchContentHandler (local only)

**Files:**
- Create: `skill/handlers/SearchContentHandler.js`
- Modify: `server.js` (register handler)

- [ ] **Step 1: Implement handler**

Create `skill/handlers/SearchContentHandler.js`:

```js
const Alexa = require('ask-sdk-core');
const { sanitizeForSpeech, formatResultForSpeech } = require('../../lib/speechUtils');
const { renderNewsList } = require('../../lib/aplHelper');
const contentService = require('../../lib/content/service');
const { searchLocal } = require('../../lib/content/search');

const SearchContentHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
           Alexa.getIntentName(handlerInput.requestEnvelope) === 'SearchContentIntent';
  },
  handle(handlerInput) {
    const query = handlerInput.requestEnvelope.request.intent.slots?.query?.value;
    if (!query) {
      return handlerInput.responseBuilder
        .speak('Was moechtest du in deiner Sammlung suchen?')
        .reprompt('Sage zum Beispiel: suche Tatort lokal.')
        .getResponse();
    }
    if (!contentService.isEnabled()) {
      return handlerInput.responseBuilder
        .speak('Die lokale Sammlung ist nicht konfiguriert.')
        .getResponse();
    }
    const hits = searchLocal(contentService.getIndex().all(), query, { limit: 10 });
    if (hits.length === 0) {
      return handlerInput.responseBuilder
        .speak(`Ich habe nichts zu ${sanitizeForSpeech(query)} in deiner Sammlung gefunden.`)
        .reprompt('Moechtest du etwas anderes suchen?')
        .getResponse();
    }
    const results = hits.map(toResult);
    const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
    sessionAttributes.mediathekResults = results;
    handlerInput.attributesManager.setSessionAttributes(sessionAttributes);

    const top = results.slice(0, 3);
    const speech = `${results.length} Treffer in deiner Sammlung. ${top.map((r, i) => formatResultForSpeech(r, i)).join('. ')}. Welche Nummer?`;
    renderNewsList(handlerInput, [{ title: `Lokal: ${query}`, results }], `Lokal: ${query}`);
    return handlerInput.responseBuilder.speak(speech).reprompt('Sage eine Nummer.').withShouldEndSession(false).getResponse();
  },
};

// Project a ContentEntry into the shape PlayMediathekResultHandler + APL expect.
function toResult(entry) {
  return {
    title: entry.type === 'episode'
      ? `${entry.show} ${formatEp(entry)} - ${entry.title}`
      : entry.title,
    topic: entry.pathLabel,
    channel: entry.pathLabel,
    duration: 0,
    timestamp: Math.floor(new Date(entry.mtime).getTime() / 1000),
    url: null,  // resolved on play via contentSource
    source: 'local',
    id: entry.id,
  };
}
function formatEp(e) {
  const s = String(e.season || 0).padStart(2, '0');
  const ep = String(e.episode || 0).padStart(2, '0');
  return `S${s}E${ep}`;
}

module.exports = SearchContentHandler;
```

- [ ] **Step 2: Register in `server.js`**

In `server.js`, find the section that imports handlers and the `addRequestHandlers(...)` call. Add a new import:

```js
const SearchContentHandler = require('./skill/handlers/SearchContentHandler');
```

And add `SearchContentHandler,` to the `addRequestHandlers(...)` argument list.

- [ ] **Step 3: Smoke-test**

```bash
node -e "process.env.JWT_SECRET='x'.repeat(40); require('./skill/handlers/SearchContentHandler'); console.log('OK')"
```

Expected: `OK`.

- [ ] **Step 4: Commit**

```bash
git add skill/handlers/SearchContentHandler.js server.js
git commit -m "Add SearchContentHandler for 'suche X lokal' intent"
```

---

### Task 15: SearchEverythingHandler (local + mediathek)

**Files:**
- Create: `skill/handlers/SearchEverythingHandler.js`
- Modify: `server.js`

- [ ] **Step 1: Implement handler**

Create `skill/handlers/SearchEverythingHandler.js`:

```js
const Alexa = require('ask-sdk-core');
const mediathek = require('../../lib/mediathek');
const { sanitizeForSpeech, formatResultForSpeech } = require('../../lib/speechUtils');
const { renderNewsList } = require('../../lib/aplHelper');
const contentService = require('../../lib/content/service');
const { searchLocal } = require('../../lib/content/search');

const SearchEverythingHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
           Alexa.getIntentName(handlerInput.requestEnvelope) === 'SearchEverythingIntent';
  },
  async handle(handlerInput) {
    const query = handlerInput.requestEnvelope.request.intent.slots?.query?.value;
    if (!query) {
      return handlerInput.responseBuilder
        .speak('Was moechtest du suchen?')
        .reprompt('Sage zum Beispiel: suche Tatort.')
        .getResponse();
    }

    const local = contentService.isEnabled()
      ? searchLocal(contentService.getIndex().all(), query, { limit: 10 }).map(toLocalResult)
      : [];

    let mediathekResults = [];
    try {
      mediathekResults = (await mediathek.search(query)).map(r => ({ ...r, source: 'mediathek' }));
    } catch (err) {
      console.error('SearchEverything: mediathek search failed:', err.message);
    }

    const all = [...local, ...mediathekResults];
    if (all.length === 0) {
      return handlerInput.responseBuilder
        .speak(`Ich habe nichts zu ${sanitizeForSpeech(query)} gefunden.`)
        .reprompt('Moechtest du etwas anderes suchen?')
        .getResponse();
    }

    const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
    sessionAttributes.mediathekResults = all;
    handlerInput.attributesManager.setSessionAttributes(sessionAttributes);

    const top = all.slice(0, 3);
    const speech = `${local.length} in deiner Sammlung und ${mediathekResults.length} in der Mediathek. ${top.map((r, i) => formatResultForSpeech(r, i)).join('. ')}. Welche Nummer?`;
    renderNewsList(handlerInput, [{ title: `Suche: ${query}`, results: all }], `Suche: ${query}`);
    return handlerInput.responseBuilder.speak(speech).reprompt('Sage eine Nummer.').withShouldEndSession(false).getResponse();
  },
};

function toLocalResult(entry) {
  return {
    title: entry.type === 'episode'
      ? `${entry.show} S${pad(entry.season)}E${pad(entry.episode)} - ${entry.title}`
      : entry.title,
    topic: entry.pathLabel,
    channel: entry.pathLabel,
    duration: 0,
    timestamp: Math.floor(new Date(entry.mtime).getTime() / 1000),
    url: null,
    source: 'local',
    id: entry.id,
  };
}
function pad(n) { return String(n || 0).padStart(2, '0'); }

module.exports = SearchEverythingHandler;
```

- [ ] **Step 2: Register in server.js**

Add import + handler registration:

```js
const SearchEverythingHandler = require('./skill/handlers/SearchEverythingHandler');
```

Add `SearchEverythingHandler,` to `addRequestHandlers(...)`.

- [ ] **Step 3: Smoke-test**

```bash
node -e "process.env.JWT_SECRET='x'.repeat(40); require('./skill/handlers/SearchEverythingHandler'); console.log('OK')"
```

Expected: `OK`.

- [ ] **Step 4: Commit**

```bash
git add skill/handlers/SearchEverythingHandler.js server.js
git commit -m "Add SearchEverythingHandler (local + mediathek combined search)"
```

---

### Task 16: ListNewContentHandler

**Files:**
- Create: `skill/handlers/ListNewContentHandler.js`
- Modify: `server.js`

- [ ] **Step 1: Implement handler**

Create `skill/handlers/ListNewContentHandler.js`:

```js
const Alexa = require('ask-sdk-core');
const { formatResultForSpeech } = require('../../lib/speechUtils');
const { renderNewsList } = require('../../lib/aplHelper');
const contentService = require('../../lib/content/service');
const { findNewest } = require('../../lib/content/search');

const ListNewContentHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
           Alexa.getIntentName(handlerInput.requestEnvelope) === 'ListNewContentIntent';
  },
  handle(handlerInput) {
    if (!contentService.isEnabled()) {
      return handlerInput.responseBuilder
        .speak('Die lokale Sammlung ist nicht konfiguriert.')
        .getResponse();
    }
    const labelSlot = handlerInput.requestEnvelope.request.intent.slots?.label;
    let label = labelSlot?.value || null;
    const resolutions = labelSlot?.resolutions?.resolutionsPerAuthority;
    if (resolutions && resolutions[0]?.values?.[0]) {
      label = resolutions[0].values[0].value.name;
    }

    const entries = findNewest(contentService.getIndex().all(), {
      label, limit: 20, uniquePerShow: true,
      newerThanDaysOnly: true,
      pathConfigs: contentService.getConfig().paths,
    });
    if (entries.length === 0) {
      const what = label ? `bei ${label}` : 'in deiner Sammlung';
      return handlerInput.responseBuilder
        .speak(`Ich habe nichts Neues ${what} gefunden.`)
        .getResponse();
    }
    const results = entries.map(toResult);

    const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
    sessionAttributes.mediathekResults = results;
    handlerInput.attributesManager.setSessionAttributes(sessionAttributes);

    const top = results.slice(0, 3);
    const title = label ? `Neu bei ${label}` : 'Neu in deiner Sammlung';
    const speech = `${title}: ${top.map((r, i) => formatResultForSpeech(r, i)).join('. ')}. Welche Nummer?`;
    renderNewsList(handlerInput, [{ title, results }], title);
    return handlerInput.responseBuilder.speak(speech).reprompt('Sage eine Nummer.').withShouldEndSession(false).getResponse();
  },
};

function toResult(entry) {
  return {
    title: entry.type === 'episode'
      ? `${entry.show} S${pad(entry.season)}E${pad(entry.episode)} - ${entry.title}`
      : entry.title,
    topic: entry.pathLabel,
    channel: entry.pathLabel,
    duration: 0,
    timestamp: Math.floor(new Date(entry.mtime).getTime() / 1000),
    url: null,
    source: 'local',
    id: entry.id,
  };
}
function pad(n) { return String(n || 0).padStart(2, '0'); }

module.exports = ListNewContentHandler;
```

- [ ] **Step 2: Register**

In `server.js`, add `const ListNewContentHandler = require('./skill/handlers/ListNewContentHandler');` and include `ListNewContentHandler,` in `addRequestHandlers(...)`.

- [ ] **Step 3: Smoke-test**

```bash
node -e "process.env.JWT_SECRET='x'.repeat(40); require('./skill/handlers/ListNewContentHandler'); console.log('OK')"
```

Expected: `OK`.

- [ ] **Step 4: Commit**

```bash
git add skill/handlers/ListNewContentHandler.js server.js
git commit -m "Add ListNewContentHandler for 'was gibt es neues' intent"
```

---

### Task 17: PlayShowHandler

**Files:**
- Create: `skill/handlers/PlayShowHandler.js`
- Modify: `server.js`

- [ ] **Step 1: Implement handler**

Create `skill/handlers/PlayShowHandler.js`:

```js
const Alexa = require('ask-sdk-core');
const contentService = require('../../lib/content/service');
const contentSource = require('../../lib/content/contentSource');
const { findExactEpisode, findLatestEpisode, searchLocal } = require('../../lib/content/search');

const PlayShowHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
           Alexa.getIntentName(handlerInput.requestEnvelope) === 'PlayShowIntent';
  },
  async handle(handlerInput) {
    if (!contentService.isEnabled()) {
      return handlerInput.responseBuilder
        .speak('Die lokale Sammlung ist nicht konfiguriert.')
        .getResponse();
    }
    const slots = handlerInput.requestEnvelope.request.intent.slots || {};
    const showQuery = slots.show?.value;
    const season = slots.season?.value ? parseInt(slots.season.value, 10) : null;
    const episode = slots.episode?.value ? parseInt(slots.episode.value, 10) : null;

    if (!showQuery) {
      return handlerInput.responseBuilder
        .speak('Welche Sendung soll ich starten?')
        .reprompt('Sage zum Beispiel: spiele Better Call Saul.')
        .getResponse();
    }

    const all = contentService.getIndex().all();
    let entry = null;
    if (season != null && episode != null) {
      entry = findExactEpisode(all, showQuery, season, episode);
    } else if (episode != null) {
      entry = findExactEpisode(all, showQuery, 1, episode);
    } else {
      entry = findLatestEpisode(all, showQuery);
      // Fallback for movies: maybe it's a film not a show
      if (!entry) {
        const hits = searchLocal(all, showQuery, { limit: 1 });
        if (hits.length) entry = hits[0];
      }
    }

    if (!entry) {
      return handlerInput.responseBuilder
        .speak(`Ich habe ${showQuery} leider nicht in deiner Sammlung gefunden.`)
        .reprompt('Moechtest du etwas anderes starten?')
        .getResponse();
    }

    let stream;
    try {
      stream = await contentSource.resolveStream(entry.id);
    } catch (err) {
      console.error('PlayShowHandler resolveStream error:', err.message);
      return handlerInput.responseBuilder
        .speak(`${entry.title} kann gerade nicht gestartet werden. ${err.message}`)
        .getResponse();
    }

    const spokenTitle = entry.type === 'episode'
      ? `${entry.show} Staffel ${entry.season} Folge ${entry.episode}`
      : entry.title;

    console.log(`PlayShow: ${entry.id} → ${stream.url}`);
    return handlerInput.responseBuilder
      .speak(`Starte ${spokenTitle}.`)
      .addVideoAppLaunchDirective(stream.url, entry.title || spokenTitle, entry.show || entry.pathLabel)
      .getResponse();
  },
};

module.exports = PlayShowHandler;
```

- [ ] **Step 2: Register**

In `server.js`: `const PlayShowHandler = require('./skill/handlers/PlayShowHandler');` and include in `addRequestHandlers(...)`.

- [ ] **Step 3: Smoke-test**

```bash
node -e "process.env.JWT_SECRET='x'.repeat(40); require('./skill/handlers/PlayShowHandler'); console.log('OK')"
```

Expected: `OK`.

- [ ] **Step 4: Commit**

```bash
git add skill/handlers/PlayShowHandler.js server.js
git commit -m "Add PlayShowHandler for 'spiele X (folge N / staffel M folge N)' intent"
```

---

### Task 18: PlayMediathekResultHandler — source-aware

**Files:**
- Modify: `skill/handlers/PlayMediathekResultHandler.js`

- [ ] **Step 1: Update to handle local results**

Replace the body of `skill/handlers/PlayMediathekResultHandler.js` with:

```js
const Alexa = require('ask-sdk-core');
const contentSource = require('../../lib/content/contentSource');

const PlayMediathekResultHandler = {
  canHandle(handlerInput) {
    return (
      Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === 'PlayMediathekResultIntent'
    );
  },
  async handle(handlerInput) {
    const number = parseInt(
      handlerInput.requestEnvelope.request.intent.slots.resultNumber?.value, 10
    );
    const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
    const results = sessionAttributes.mediathekResults;

    if (!results || results.length === 0) {
      return handlerInput.responseBuilder
        .speak('Du hast noch nicht gesucht. Sage zum Beispiel: suche Tatort.')
        .reprompt('Was moechtest du suchen?')
        .getResponse();
    }
    if (isNaN(number) || number < 1 || number > results.length) {
      return handlerInput.responseBuilder
        .speak(`Bitte sage eine Nummer zwischen 1 und ${results.length}.`)
        .reprompt(`Welche Nummer? 1 bis ${results.length}.`)
        .getResponse();
    }

    const result = results[number - 1];

    if (result.segments && result.segments.length > 0) {
      sessionAttributes.currentSegments = result.segments;
      sessionAttributes.currentSegmentIndex = 0;
      handlerInput.attributesManager.setSessionAttributes(sessionAttributes);
    }

    let url = result.url;
    if (result.source === 'local') {
      try {
        const stream = await contentSource.resolveStream(result.id);
        url = stream.url;
      } catch (err) {
        console.error('PlayMediathekResult local resolveStream error:', err.message);
        return handlerInput.responseBuilder
          .speak(`${result.title} kann nicht gestartet werden. ${err.message}`)
          .getResponse();
      }
    }

    console.log(`Starte Result: ${result.title} (source=${result.source || 'mediathek'}) -> ${url}`);
    return handlerInput.responseBuilder
      .speak(`Starte ${result.title}.`)
      .addVideoAppLaunchDirective(url, result.title, `${result.channel || ''} - ${result.topic || ''}`)
      .getResponse();
  }
};

module.exports = PlayMediathekResultHandler;
```

- [ ] **Step 2: Smoke-test**

```bash
node -e "process.env.JWT_SECRET='x'.repeat(40); require('./skill/handlers/PlayMediathekResultHandler'); console.log('OK')"
```

Expected: `OK`.

- [ ] **Step 3: Commit**

```bash
git add skill/handlers/PlayMediathekResultHandler.js
git commit -m "PlayMediathekResultHandler: route local results through contentSource"
```

---

### Task 19: TouchEventHandler — selectContent

**Files:**
- Modify: `skill/handlers/TouchEventHandler.js`

- [ ] **Step 1: Add `selectContent` action**

In `skill/handlers/TouchEventHandler.js`, find the `if (action === 'selectCategory') { ... }` block. After it, add:

```js
if (action === 'selectContent') {
  return handleSelectContent(handlerInput, args[1]);
}
```

Then add the handler function (anywhere below the `TouchEventHandler` object):

```js
async function handleSelectContent(handlerInput, contentId) {
  const contentService = require('../../lib/content/service');
  const contentSource = require('../../lib/content/contentSource');
  if (!contentService.isEnabled()) {
    return handlerInput.responseBuilder.speak('Sammlung nicht konfiguriert.').getResponse();
  }
  const entry = contentService.getIndex().findById(contentId);
  if (!entry) {
    return handlerInput.responseBuilder.speak('Eintrag nicht gefunden.').getResponse();
  }
  let stream;
  try {
    stream = await contentSource.resolveStream(contentId);
  } catch (err) {
    console.error('Touch selectContent error:', err.message);
    return handlerInput.responseBuilder
      .speak(`${entry.title} kann nicht gestartet werden. ${err.message}`)
      .getResponse();
  }
  const spoken = entry.type === 'episode'
    ? `${entry.show} Staffel ${entry.season} Folge ${entry.episode}`
    : entry.title;
  console.log(`Touch selectContent: ${entry.id} → ${stream.url}`);
  return handlerInput.responseBuilder
    .speak(`Starte ${spoken}.`)
    .addVideoAppLaunchDirective(stream.url, entry.title || spoken, entry.show || entry.pathLabel)
    .getResponse();
}
```

- [ ] **Step 2: Smoke-test**

```bash
node -e "process.env.JWT_SECRET='x'.repeat(40); require('./skill/handlers/TouchEventHandler'); console.log('OK')"
```

Expected: `OK`.

- [ ] **Step 3: Commit**

```bash
git add skill/handlers/TouchEventHandler.js
git commit -m "TouchEventHandler: handle selectContent action for local files"
```

---

## Phase E — Launch screen

### Task 20: APL template - recentContent row

**Files:**
- Modify: `skill/apl/LaunchTemplate.json`

- [ ] **Step 1: Read current template**

```bash
sed -n '1,40p' skill/apl/LaunchTemplate.json
```

- [ ] **Step 2: Add recentContent row**

In `skill/apl/LaunchTemplate.json`, find the section with `liveTVChannels` (the existing Live-TV quickbar Container that you added earlier). Right after that Container's closing `}`, insert this new sibling Container:

```json
,{
  "type": "Container",
  "width": "100%",
  "direction": "row",
  "alignItems": "center",
  "paddingBottom": "10dp",
  "when": "${launchData.properties.recentContent && launchData.properties.recentContent.length > 0}",
  "data": "${launchData.properties.recentContent}",
  "items": [
    {
      "type": "TouchWrapper",
      "onPress": [
        {
          "type": "SendEvent",
          "arguments": ["selectContent", "${data.id}"]
        }
      ],
      "items": [
        {
          "type": "Frame",
          "backgroundColor": "rgba(76,195,247,0.15)",
          "borderRadius": "8dp",
          "paddingLeft": "10dp",
          "paddingRight": "10dp",
          "paddingTop": "6dp",
          "paddingBottom": "6dp",
          "marginRight": "6dp",
          "items": [
            {
              "type": "Container",
              "items": [
                { "type": "Text", "text": "${data.label}", "color": "#4FC3F7", "fontSize": "14dp" },
                { "type": "Text", "text": "${data.title}", "color": "white", "fontSize": "16dp", "maxLines": 2 }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

- [ ] **Step 3: Validate JSON**

```bash
python3 -c "import json; json.load(open('skill/apl/LaunchTemplate.json'))"
```

Expected: no output (valid JSON).

- [ ] **Step 4: Commit**

```bash
git add skill/apl/LaunchTemplate.json
git commit -m "LaunchTemplate APL: add recentContent row for local files"
```

---

### Task 21: aplHelper.renderLaunchScreen accepts recentContent

**Files:**
- Modify: `lib/aplHelper.js`
- Modify: `skill/handlers/LaunchHandler.js`

- [ ] **Step 1: Update renderLaunchScreen signature**

In `lib/aplHelper.js`, find the `renderLaunchScreen` function. Change its signature and the datasources block:

```js
function renderLaunchScreen(handlerInput, sections, logoUrl, liveTVChannels, recentContent) {
  if (!hasAPLSupport(handlerInput)) return;
  // ... (existing aplSections + categories code unchanged) ...
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
          recentContent: recentContent || [],
        },
      },
    },
  });
}
```

- [ ] **Step 2: Update LaunchHandler to pass recentContent**

In `skill/handlers/LaunchHandler.js`, before the `renderLaunchScreen(...)` call (right after the `liveTVChannels` array construction), add:

```js
// Recent content for homepage row (smart-mix: 1 per show, newest 6)
let recentContent = [];
try {
  const contentService = require('../../lib/content/service');
  if (contentService.isEnabled()) {
    const { findNewest } = require('../../lib/content/search');
    const newest = findNewest(contentService.getIndex().all(), {
      limit: 6, uniquePerShow: true, newerThanDaysOnly: true,
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
```

Then change the call to:

```js
renderLaunchScreen(handlerInput, sections, orfLogo, liveTVChannels, recentContent);
```

- [ ] **Step 3: Smoke-test**

```bash
node -e "process.env.JWT_SECRET='x'.repeat(40); require('./skill/handlers/LaunchHandler'); console.log('OK')"
```

Expected: `OK`.

- [ ] **Step 4: Commit**

```bash
git add lib/aplHelper.js skill/handlers/LaunchHandler.js
git commit -m "Launch screen: render recentContent row from local index"
```

---

## Phase F — Config, docs, integration test

### Task 22: Manual integration test script

**Files:**
- Create: `scripts/test-content.js`
- Modify: `package.json`

- [ ] **Step 1: Create script**

```js
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
```

- [ ] **Step 2: Add npm script**

In `package.json` under `scripts`, add after `"test:fritzbox"`:

```json
"test:content": "node scripts/test-content.js"
```

- [ ] **Step 3: Verify**

```bash
node -e "JSON.parse(require('fs').readFileSync('package.json','utf8'))"
node scripts/test-content.js
```

Expected: usage message printed.

- [ ] **Step 4: Commit**

```bash
git add scripts/test-content.js package.json
git commit -m "Add manual integration test script for local content"
```

---

### Task 23: .env.example & docker-compose updates

**Files:**
- Modify: `.env.example`
- Modify: `docker-compose.yml`

- [ ] **Step 1: Add env vars to .env.example**

In `.env.example`, after the FRITZ!Box section, append:

```bash

# Local content (NAS files - optional)
# Wenn config/content-paths.json existiert, ist die Lokale Sammlung aktiv.
# CONTENT_CONFIG_PATH=/app/config/content-paths.json     # default
# CONTENT_RESCAN_MINUTES=30                              # default
```

- [ ] **Step 2: Add commented bind-mount example to docker-compose.yml**

In `docker-compose.yml`, find the `volumes:` block under `services.myvideo`. Add at the end of that list (still under `volumes:`):

```yaml
      # Local content (NAS) - uncomment + adjust host path
      # - /mnt/nas/videos:/content:ro
      - ./config:/app/config:ro
      - ./data:/app/data
```

- [ ] **Step 3: Commit**

```bash
git add .env.example docker-compose.yml
git commit -m "env+compose: add CONTENT_* vars and content/config/data mount hints"
```

---

### Task 24: README documentation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add section**

In `README.md`, after the FRITZ!Box Live-TV section, add:

```markdown
### Lokale Inhalte (NAS-Filme, optional)

Wenn du Filme oder Serien auf einer Festplatte / einem NAS hast, kann der Skill diese durchsuchen und abspielen.

**Setup:**

1. Mounte den Ordner read-only in den Container - in `docker-compose.yml`:
   ```
   - /mnt/nas/videos:/content:ro
   ```

2. Kopiere die Beispiel-Konfig und passe die Pfade an:
   ```bash
   cp config/content-paths.example.json config/content-paths.json
   nano config/content-paths.json
   ```

3. `docker compose down && docker compose up -d`

**Sprachbefehle:**

| Befehl | Beschreibung |
|---|---|
| "Suche Tatort" | Sucht lokal **und** in der Mediathek |
| "Suche Tatort lokal" | Sucht nur in deiner Sammlung |
| "Suche Tatort in der Mediathek" | Wie bisher, nur Mediathek |
| "Was gibt es Neues" | Zeigt die zuletzt hinzugefügten Files |
| "Was gibt es Neues bei Filmen" | Filtert nach Pfad-Label |
| "Spiele Better Call Saul" | Spielt die zuletzt hinzugefügte Folge |
| "Spiele Better Call Saul Folge 5" | Spezifische Folge |
| "Spiele Better Call Saul Staffel 3 Folge 7" | Spezifische Staffel + Folge |

**Konfiguration (`config/content-paths.json`):**

| Feld | Beschreibung |
|---|---|
| `label` | Anzeigename, auch im Voice-Slot ("Filme", "Serien", "Eigene") |
| `path` | absoluter Container-Pfad |
| `newerThanDays` | Filter für "Was gibt's Neues" (null = alle) |
| `recursive` | Unterverzeichnisse durchsuchen |
| `type` | "movie", "episode" oder "auto" |

**Direkt-Play vs. Transcode:** H.264/AAC/MP4-Dateien werden direkt ausgeliefert (Echo Show kann pausieren und spulen). MKV/HEVC/AC3 etc. werden on-the-fly mit FFmpeg konvertiert.

**Diagnose-Endpoints (LAN-only):**

```
GET  /diag/content/stats
GET  /diag/content/search?q=...
GET  /diag/content/item/:id
POST /diag/content/reindex
GET  /diag/content/config
```

Test-Script auf dem Pi: `node scripts/test-content.js scan|list|newest|search <q>|play <id>`
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "README: document local content (NAS) feature"
```

---

### Task 25: Final regression run

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
node test/audioPicker.test.js && \
node test/streamErrorMessage.test.js && \
node test/contentPaths.test.js && \
node test/contentParser.test.js && \
node test/contentSlug.test.js && \
node test/contentScanner.test.js && \
node test/contentIndex.test.js && \
node test/contentSearch.test.js && \
node test/contentCodecProbe.test.js && \
node test/contentSource.test.js && \
echo "ALL OK"
```

Expected: every test prints `N passed, 0 failed`, final `ALL OK`.

- [ ] **Step 2: Server smoke test (no content config)**

```bash
JWT_SECRET=test1234567890abcdef1234567890abcdef PORT=33999 \
  timeout 4 node server.js 2>&1 | grep -E '(Skill Endpoint|Local content|FRITZ!Box)' || true
```

Expected:
```
  Skill Endpoint: http://localhost:33999/alexa
  ...
  Local content: deaktiviert (keine config/content-paths.json)
```

- [ ] **Step 3: Deploy voice model**

```bash
./scripts/deploy-skill.sh
```

Expected: Amazon-side build successful, four new intents registered.

- [ ] **Step 4: Real Pi test with NAS mount**

On the Pi:

```bash
cd ~/docker_apps/MyVideo
git pull origin main
# Ensure /mnt/nas/videos mounted on host
cp config/content-paths.example.json config/content-paths.json
nano config/content-paths.json   # adjust to real layout
docker compose pull
docker compose down && docker compose up -d
docker compose logs -f myvideo
```

Expected log lines:
```
  Local content: aktiviert (N Pfade)
[content] scan: Filme → ... entries
[content] scan: Serien → ... entries
[content] rescan: NNNN entries in NNNNms
```

- [ ] **Step 5: End-to-end on Echo Show**

Manually:
- "Alexa, öffne Mein Video" → launch screen now shows the "Neu in deiner Sammlung" row
- "Was gibt es Neues" → list of recent files, top 3 read out
- "Suche Tatort" → mixed local + mediathek results
- "Suche Tatort lokal" → only local
- "Spiele Better Call Saul" → latest episode plays
- "Spiele Better Call Saul Folge 5" → S01E05 plays
- Tap on a tile in the new row → playback starts
- Channel still works: "Schalte auf ORF 1" → live TV
- Switching from local file back to live TV works

- [ ] **Step 6: Inspect via diag**

```bash
curl -s http://localhost:3377/diag/content/stats | jq .
curl -s "http://localhost:3377/diag/content/search?q=Tatort" | jq .
```

Should show entry counts, top hits, last scan timestamp.

- [ ] **Step 7: Final commit history check**

```bash
git log --oneline main..HEAD | head -30
```

Should show ~25 commits, clean history, ready for merge.

---

## Self-Review Notes

**Spec coverage check vs. design doc:**

- §3 Architektur — Tasks 1-12 (modules), 13-19 (handlers), 20-21 (UI)
- §4.1 Konfiguration — Task 1 (example), 23 (.env)
- §4.2 Indexer — Tasks 2 (paths), 3 (parser), 4 (slug), 5 (scanner), 6 (index), 11 (service+bootstrap)
- §4.3 Codec-Probe — Task 8
- §4.4 Wiedergabe — Task 9 (streamer extension), 10 (contentSource)
- §4.5 Stream-Auslieferung — Task 12 (`/content/:id/file.mp4`)
- §4.6 Suche — Task 7
- §4.7 Alexa-Integration — Tasks 13 (voice model), 14-17 (new handlers), 18 (PlayMediathekResult), 19 (TouchEventHandler)
- §5 Diag-Endpoints — Task 12 (the /diag/content/* routes)
- §6 Testing — Unit tests in every task, Task 22 (integration script), Task 25 (E2E)
- §7 Risiken — Tasks 5+11 handle missing path / scan failures; Task 8 handles probe failures; Task 9 handles slot conflict
- §10 Akzeptanz-Kriterien — covered by Task 25 manual steps

**No placeholders.** Every step shows actual code or actual commands.

**Type/name consistency:**

- `ContentEntry` fields match between scanner (Task 5), parser (Task 3), index (Task 6), search (Task 7), contentSource (Task 10)
- `streamer.start({ source, id, tunerId?, inputPath?, displayName })` shape consistent across Task 9 (definition), Task 10 (call from contentSource), Task 11 (init wiring)
- `entry.codecInfo.directPlay` is the gate for direct-play in Task 8 (decision), Task 10 (use), Task 25 (acceptance)
- `result.source === 'local'` consistently checked in Tasks 14-18 handlers
- `contentService.getIndex().all()` / `findById()` API consistent across all handlers
