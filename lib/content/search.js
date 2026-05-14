const { slugify } = require('./slug');

function normalize(s) { return slugify(s || '').replace(/-/g, ' '); }

// Match SxxEyy / sNNeNN tokens like "s01e02" → { season: 1, episode: 2 }
// Also "s01" alone for season-only filter.
const EPISODE_PATTERN = /^s(\d{1,3})(?:e(\d{1,4}))?$/i;

/**
 * Split a query into "text" tokens (free-form search) and "episode" tokens
 * (structural SxxEyy filters). The episode tokens narrow the result set to
 * entries with matching season/episode; the text tokens score remaining
 * entries by show/title/filename match.
 */
function parseQuery(query) {
  const raw = String(query || '').trim().split(/\s+/).filter(Boolean);
  const text = [];
  const filters = [];  // [{ season, episode }, ...]
  for (const tok of raw) {
    const m = tok.match(EPISODE_PATTERN);
    if (m) {
      filters.push({
        season: Number(m[1]),
        episode: m[2] != null ? Number(m[2]) : null,
      });
    } else {
      const n = normalize(tok);
      if (n) text.push(...n.split(/\s+/).filter(Boolean));
    }
  }
  return { text, filters };
}

function matchesFilters(entry, filters) {
  if (filters.length === 0) return true;
  if (entry.type !== 'episode') return false;
  return filters.every(f => {
    if (entry.season !== f.season) return false;
    if (f.episode != null && entry.episode !== f.episode) return false;
    return true;
  });
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

/**
 * Comparator for sorted-search output. When the top hit is an episode, we
 * group episodes by show and sort within each show by season then episode
 * (ascending) so you get S01E01 → S01E02 → ... in order. Movies and other
 * types fall back to the score/mtime ordering.
 */
function compareForSeriesBrowse(a, b) {
  // Same show → season/episode ascending
  if (a.entry.type === 'episode' && b.entry.type === 'episode'
      && a.entry.show && a.entry.show === b.entry.show) {
    if ((a.entry.season || 0) !== (b.entry.season || 0))
      return (a.entry.season || 0) - (b.entry.season || 0);
    return (a.entry.episode || 0) - (b.entry.episode || 0);
  }
  // Different shows / not episodes → score desc, then mtime desc
  if (b.score !== a.score) return b.score - a.score;
  return (b.entry.mtime || '').localeCompare(a.entry.mtime || '');
}

function searchLocal(entries, query, opts = {}) {
  const { text, filters } = parseQuery(query);
  if (text.length === 0 && filters.length === 0) return [];

  let candidates = entries.filter(e => matchesFilters(e, filters));

  // If we only have filters (e.g. "S01E02") with no text, return all that match
  // without further scoring.
  let scored;
  if (text.length === 0) {
    scored = candidates.map(e => ({ entry: e, score: 1 }));
  } else {
    scored = candidates
      .map(e => ({ entry: e, score: scoreEntry(e, text) }))
      .filter(s => s.score > 0);
  }

  scored.sort(compareForSeriesBrowse);
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

function showTokens(show) {
  return normalize(show).split(/\s+/).filter(Boolean);
}

function findExactEpisode(entries, show, season, episode) {
  const tokens = showTokens(show);
  return entries.find(e =>
    e.type === 'episode' &&
    e.season === season && e.episode === episode &&
    scoreEntry(e, tokens) > 0
  ) || null;
}

function findLatestEpisode(entries, show) {
  const tokens = showTokens(show);
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
