const { searchTodaysNews } = require('./mediathek');
const { fetchSubtitlesForResults } = require('./subtitleService');
const { generateSummary } = require('./openRouterService');
const { debug } = require('./debug');

// Cache fuer on-demand berechnete Summaries
let cache = null;
// Promise der laufenden Berechnung (verhindert Doppel-Requests)
let pendingRefresh = null;
// Max Untertitel-Quellen
const MAX_SUBTITLE_SOURCES = 3;
// Cache-Gueltigkeitsdauer: 30 Minuten
const CACHE_MAX_AGE_MS = 30 * 60 * 1000;

async function refresh() {
  // Wenn bereits eine Berechnung laeuft, darauf warten
  if (pendingRefresh) {
    debug('SummaryCache: Berechnung laeuft bereits, warte...');
    return pendingRefresh;
  }

  pendingRefresh = doRefresh();
  try {
    await pendingRefresh;
  } finally {
    pendingRefresh = null;
  }
}

async function doRefresh() {
  const t0 = Date.now();
  debug('SummaryCache: Starte Berechnung...');

  const todaysResults = await searchTodaysNews();
  debug(`SummaryCache: ${todaysResults.length} Nachrichten gefunden`);

  if (todaysResults.length === 0) {
    throw new Error('Keine Nachrichten verfuegbar');
  }

  const resultsWithSubs = todaysResults.filter(r => r.urlSubtitle).slice(0, MAX_SUBTITLE_SOURCES);
  if (resultsWithSubs.length === 0) {
    throw new Error('Keine Untertitel verfuegbar');
  }

  const subtitleTexts = await fetchSubtitlesForResults(resultsWithSubs);
  if (subtitleTexts.length === 0) {
    throw new Error('Keine Untertitel-Texte extrahiert');
  }

  const summary = await generateSummary(subtitleTexts);

  cache = {
    summary,
    subtitleTexts,
    timestamp: Date.now(),
  };

  debug(`SummaryCache: Fertig in ${Date.now() - t0}ms (${subtitleTexts.length} Quellen)`);
}

function get() {
  if (!cache) return null;
  // Cache abgelaufen?
  if (Date.now() - cache.timestamp > CACHE_MAX_AGE_MS) {
    debug('SummaryCache: Cache abgelaufen');
    return null;
  }
  return cache;
}

function isRefreshing() {
  return !!pendingRefresh;
}

module.exports = { refresh, get, isRefreshing };
