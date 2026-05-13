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
