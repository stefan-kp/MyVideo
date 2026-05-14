const path = require('path');
const { loadPathsConfig } = require('./paths');
const { scanAll } = require('./scanner');
const { ContentIndex } = require('./index');
const { probeIfNeeded } = require('./codecProbe');
const contentSource = require('./contentSource');

const DEFAULT_INDEX_FILE = path.join(__dirname, '..', '..', 'data', 'content-index.json');
const DEFAULT_RESCAN_MINUTES = 30;
const YOUTUBE_DIR = path.join(__dirname, '..', '..', 'data', 'youtube');

/**
 * Synthetic path-config entry that pulls YouTube downloads into the
 * content index without needing user-side config. Always prepended.
 */
function makeYoutubePathConfig() {
  return {
    label: 'YouTube',
    path: YOUTUBE_DIR,
    newerThanDays: null,
    recursive: true,
    type: 'auto',
  };
}

let _config = null;
let _index = null;
let _rescanTimer = null;
let _indexFile = DEFAULT_INDEX_FILE;
let _streamer = null;
let _initialized = false;
// _scanInFlight holds the Promise of the currently running scan (or null).
// _followUpScheduled is set when a rescan() call arrives DURING an in-flight
// scan: that caller's result might be stale (its data could have appeared
// after scanAll() started), so we chain a second scan and resolve the new
// caller against THAT one.
let _scanInFlight = null;
let _followUpPromise = null;

function isEnabled() { return _initialized; }
function getIndex() { return _index; }
function getConfig() { return _config; }

async function init({ configPath, indexFile, streamer }) {
  _config = loadPathsConfig(configPath);
  if (!_config) {
    // Even without user-side content-paths.json we want YouTube downloads
    // to be indexed, so synthesize a minimal config with only the YouTube
    // dir. The dir itself doesn't need to exist yet (scanner tolerates that).
    console.log('[content] no content-paths.json — using YouTube-only config');
    _config = {
      paths: [makeYoutubePathConfig()],
      extensions: { directPlayCandidates: ['.mp4', '.m4v'], transcodeOnly: ['.mkv', '.avi', '.mov', '.ts', '.webm', '.wmv'] },
      excludePatterns: ['sample', 'trailer', '_UNPACK_', '@eaDir', '.partial', '.DS_Store'],
    };
  } else {
    // Always prepend the YouTube dir, but skip if the user has already
    // configured a path with the same absolute target (avoid duplicates).
    const hasYoutubePath = _config.paths.some(p => path.resolve(p.path) === path.resolve(YOUTUBE_DIR));
    if (!hasYoutubePath) {
      _config.paths = [makeYoutubePathConfig(), ..._config.paths];
    }
  }
  _index = new ContentIndex();
  _indexFile = indexFile || DEFAULT_INDEX_FILE;

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

  const loaded = _index.load(_indexFile);
  if (loaded) {
    console.log(`[content] loaded ${_index.count()} entries from ${_indexFile}`);
  }

  contentSource.init({ index: _index, probeIfNeeded, streamer: _streamer });
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

/**
 * Run one scan, replace the index, persist. Internal — assumes no other scan
 * is currently using shared mutable state.
 */
async function _doOneScan() {
  const t0 = Date.now();
  const { entries, summary } = await scanAll(_config);
  _index.mergeFromScan(entries);
  try { _index.save(_indexFile); } catch (err) {
    console.warn(`[content] index save failed: ${err.message}`);
  }
  const dt = Date.now() - t0;
  console.log(`[content] rescan: ${entries.length} entries in ${dt}ms`);
  return { entries: entries.length, summary, durationMs: dt };
}

/**
 * Trigger a rescan. Concurrency rules:
 * - If no scan is running, start one. Caller awaits its completion.
 * - If a scan IS running, the caller's data might have appeared after that
 *   scan's scanAll() started. Schedule a follow-up scan to run as soon as
 *   the current one finishes, and resolve the caller against that follow-up
 *   so the awaited rescan() always reflects on-disk reality at the moment
 *   the caller asked for it.
 * - Additional callers that arrive while a follow-up is already queued
 *   piggyback on that same follow-up (no third scan needed).
 *
 * This is the contract the YouTube download flow relies on: when the
 * download finishes and we await contentService.rescan(), the new MP4
 * MUST be in the index by the time our await returns.
 */
async function rescan() {
  if (!_config) return { entries: 0 };

  // No scan running → start one and let everybody waiting on _scanInFlight
  // share its result.
  if (!_scanInFlight) {
    _scanInFlight = (async () => {
      try { return await _doOneScan(); }
      finally {
        _scanInFlight = null;
        // If a follow-up was scheduled, _followUpPromise picked it up via
        // the chain below; nothing to do here.
      }
    })();
    return _scanInFlight;
  }

  // A scan is in flight. The caller's data may not be covered by it.
  // If we haven't already queued a follow-up, queue one. The follow-up
  // also installs itself as _scanInFlight while it runs, so a third
  // caller arriving during the follow-up correctly sees "scan running"
  // and queues a second follow-up if needed (the file they're waiting on
  // could in turn have appeared after the follow-up started).
  if (!_followUpPromise) {
    const prior = _scanInFlight;
    _followUpPromise = prior
      .catch(() => null) // swallow errors from the previous scan; we still want to run
      .then(async () => {
        // Now we're the active scan. Move ourselves into _scanInFlight so
        // new callers chain off us, and clear _followUpPromise so any
        // later in-flight caller can queue a fresh follow-up.
        _followUpPromise = null;
        const myRun = (async () => {
          try { return await _doOneScan(); }
          finally { _scanInFlight = null; }
        })();
        _scanInFlight = myRun;
        return myRun;
      });
  }
  return _followUpPromise;
}

function shutdown() {
  if (_rescanTimer) clearInterval(_rescanTimer);
  _rescanTimer = null;
}

module.exports = { init, rescan, shutdown, isEnabled, getIndex, getConfig, YOUTUBE_DIR };
