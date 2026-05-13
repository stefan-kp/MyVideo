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
