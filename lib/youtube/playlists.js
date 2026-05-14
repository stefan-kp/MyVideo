const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { slugify } = require('../content/slug');

const SCHEMA_VERSION = 1;
const DEFAULT_FILE = path.join(__dirname, '..', '..', 'data', 'youtube-playlists.json');
const DEFAULT_CLEANUP_DAYS = 7;

/**
 * Extract YouTube playlist ID from any of these URL forms:
 *   https://www.youtube.com/playlist?list=PL...
 *   https://www.youtube.com/watch?v=ABC&list=PL...
 *   https://youtube.com/playlist?list=PL...
 *   PL... (raw id)
 *
 * Returns null if no playlist ID found.
 */
function extractPlaylistId(input) {
  if (!input) return null;
  const s = String(input).trim();
  // Bare playlist ID (starts with PL, OL, RD, FL, UU, LL, ...; length 13-34)
  if (/^[A-Za-z0-9_-]{13,40}$/.test(s) && /^(PL|OL|RD|FL|UU|LL|UC|WL)/.test(s)) {
    return s;
  }
  // URL with list= parameter
  const m = s.match(/[?&]list=([A-Za-z0-9_-]+)/);
  if (m) return m[1];
  return null;
}

class Playlists {
  constructor() {
    this.playlists = [];
    this.file = null;
  }

  load(file) {
    this.file = file;
    if (!fs.existsSync(file)) return false;
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (data.version !== SCHEMA_VERSION) {
        console.warn(`[youtube] playlists schema mismatch (${data.version}); starting empty`);
        this.playlists = [];
        return false;
      }
      this.playlists = Array.isArray(data.playlists) ? data.playlists : [];
      return true;
    } catch (err) {
      console.warn(`[youtube] playlists load failed: ${err.message}`);
      this.playlists = [];
      return false;
    }
  }

  save() {
    if (!this.file) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({
        version: SCHEMA_VERSION,
        playlists: this.playlists,
      }, null, 2));
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.warn(`[youtube] playlists save failed: ${err.message}`);
    }
  }

  list() { return this.playlists.slice(); }
  findById(id) { return this.playlists.find(p => p.id === id) || null; }
  findBySlug(slug) { return this.playlists.find(p => p.slug === slug) || null; }

  /**
   * Add a new playlist. Throws on duplicate (same playlistId) or missing fields.
   * Returns the full new playlist object.
   */
  add({ url, label, cleanupDays }) {
    if (!url) throw new Error('playlists.add: url required');
    if (!label) throw new Error('playlists.add: label required');
    const playlistId = extractPlaylistId(url);
    if (!playlistId) throw new Error(`playlists.add: cannot extract playlist ID from URL: ${url}`);
    if (this.playlists.find(p => p.playlistId === playlistId)) {
      throw new Error(`playlists.add: playlist ${playlistId} already exists`);
    }
    const slug = this._uniqueSlug(slugify(label));
    const item = {
      id: crypto.randomUUID(),
      label,
      slug,
      url: url.startsWith('http') ? url : `https://www.youtube.com/playlist?list=${playlistId}`,
      playlistId,
      cleanupDays: Number(cleanupDays) || DEFAULT_CLEANUP_DAYS,
      addedAt: new Date().toISOString(),
      lastCrawledAt: null,
      videos: [],
    };
    this.playlists.push(item);
    this.save();
    return item;
  }

  remove(id) {
    const before = this.playlists.length;
    this.playlists = this.playlists.filter(p => p.id !== id);
    if (this.playlists.length !== before) {
      this.save();
      return true;
    }
    return false;
  }

  /**
   * Replace the cached video list for a playlist (e.g. after a crawl).
   * Preserves `downloaded`, `downloadedPath`, `downloadedAt` for existing
   * videos so a crawl doesn't lose download state.
   */
  updateVideos(id, newVideos) {
    const p = this.findById(id);
    if (!p) return false;
    const byId = new Map(p.videos.map(v => [v.videoId, v]));
    p.videos = newVideos.map(nv => {
      const prior = byId.get(nv.videoId);
      return {
        videoId: nv.videoId,
        title: nv.title || '',
        duration: Number(nv.duration) || 0,
        uploadDate: nv.uploadDate || '',
        downloaded: prior ? prior.downloaded : false,
        downloadedPath: prior ? prior.downloadedPath : null,
        downloadedAt: prior ? prior.downloadedAt : null,
      };
    });
    p.lastCrawledAt = new Date().toISOString();
    this.save();
    return true;
  }

  markDownloaded(id, videoId, absPath) {
    const p = this.findById(id);
    if (!p) return false;
    const v = p.videos.find(x => x.videoId === videoId);
    if (!v) return false;
    v.downloaded = true;
    v.downloadedPath = absPath;
    v.downloadedAt = new Date().toISOString();
    this.save();
    return true;
  }

  /**
   * Mark a video as not-downloaded (e.g. after cleanup removed the file).
   */
  markRemoved(id, videoId) {
    const p = this.findById(id);
    if (!p) return false;
    const v = p.videos.find(x => x.videoId === videoId);
    if (!v) return false;
    v.downloaded = false;
    v.downloadedPath = null;
    v.downloadedAt = null;
    this.save();
    return true;
  }

  _uniqueSlug(base) {
    if (!base) base = 'playlist';
    let candidate = base;
    let n = 1;
    while (this.playlists.find(p => p.slug === candidate)) {
      n++;
      candidate = `${base}-${n}`;
    }
    return candidate;
  }
}

let _instance = null;
function getInstance() {
  if (_instance) return _instance;
  _instance = new Playlists();
  const file = process.env.YOUTUBE_PLAYLISTS_FILE || DEFAULT_FILE;
  _instance.load(file);
  if (!_instance.file) _instance.file = file;
  return _instance;
}
function _resetForTest() { _instance = null; }

module.exports = {
  Playlists, getInstance, _resetForTest,
  extractPlaylistId, SCHEMA_VERSION, DEFAULT_CLEANUP_DAYS,
};
