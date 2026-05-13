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
    // For episodes with season/episode markers, use parser title as show.
    // For episodes without markers (likely unparseable), skip parser title and use directory walk.
    const hasEpisodeMarkers = out.season != null && out.episode != null;
    out.show = pickShow(fullPath, ctx.basePath, hasEpisodeMarkers ? parsed.title : null) || out.title;
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
  const base = path.basename(fullPath, path.extname(fullPath));

  if (parserTitle) {
    const cleaned = cleanTitle(parserTitle);
    // Use parser title only if:
    // 1. It's not a year (^\d{4}$)
    // 2. It's meaningfully different from the filename (not just parsing garbage)
    if (cleaned && !/^\d{4}$/.test(cleaned) && cleaned.toLowerCase() !== base.toLowerCase()) {
      return cleaned;
    }
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
