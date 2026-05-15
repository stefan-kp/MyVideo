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

module.exports = { findPosterForEntry, CANDIDATES, resolvePosterPath };
