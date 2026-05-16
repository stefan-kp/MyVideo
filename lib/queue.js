const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SCHEMA_VERSION = 1;
const DEFAULT_FILE = path.join(__dirname, '..', 'data', 'queue.json');

class Queue {
  constructor() {
    this.items = [];
    this.file = null;
  }

  load(file) {
    this.file = file;
    if (!fs.existsSync(file)) return false;
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (data.version !== SCHEMA_VERSION) {
        console.warn(`[queue] schema mismatch (${data.version} vs ${SCHEMA_VERSION}); starting empty`);
        this.items = [];
        return false;
      }
      this.items = Array.isArray(data.items) ? data.items : [];
      return true;
    } catch (err) {
      console.warn(`[queue] load failed: ${err.message}`);
      this.items = [];
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
        items: this.items,
      }, null, 2));
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.warn(`[queue] save failed: ${err.message}`);
    }
  }

  list() {
    return this.items.slice();
  }

  add(input) {
    if (!input || !input.title) throw new Error('queue.add: title required');
    const VALID_SOURCES = ['local', 'mediathek', 'youtube_pending'];
    if (!VALID_SOURCES.includes(input.source)) {
      throw new Error(`queue.add: source must be one of ${VALID_SOURCES.join(', ')}`);
    }
    if (input.source === 'local' && !input.contentId) {
      throw new Error('queue.add: local source requires contentId');
    }
    if (input.source === 'mediathek' && !input.url) {
      throw new Error('queue.add: mediathek source requires url');
    }
    if (input.source === 'youtube_pending' && !input.youtubeUrl) {
      throw new Error('queue.add: youtube_pending source requires youtubeUrl');
    }
    // Deduplication: same identity (source-specific) already in queue → reject.
    const dupe = this.items.find(i => i.source === input.source && (
      (input.source === 'local' && i.contentId === input.contentId) ||
      (input.source === 'mediathek' && i.url === input.url) ||
      (input.source === 'youtube_pending' && i.youtubeUrl === input.youtubeUrl)
    ));
    if (dupe) {
      const err = new Error('queue.add: item already in queue');
      err.code = 'DUPLICATE';
      err.existingId = dupe.id;
      throw err;
    }
    const item = {
      id: crypto.randomUUID(),
      source: input.source,
      contentId: input.contentId || null,
      url: input.url || null,
      youtubeUrl: input.youtubeUrl || null,
      title: input.title,
      subtitle: input.subtitle || '',
      duration: Number(input.duration) || 0,
      imageUrl: input.imageUrl || '',
      // Status: 'ready' (playable), 'downloading' (yt-dlp running),
      // 'failed' (download error, see .error for message).
      // Defaults to 'ready' so existing items without status stay playable.
      status: input.status || 'ready',
      error: input.error || null,
      addedAt: new Date().toISOString(),
    };
    this.items.push(item);
    this.save();
    return item;
  }

  remove(id) {
    const before = this.items.length;
    this.items = this.items.filter(i => i.id !== id);
    if (this.items.length !== before) {
      this.save();
      return true;
    }
    return false;
  }

  /**
   * Patch an existing item in place. Used by the download-worker to flip
   * 'youtube_pending' items to source='local' once yt-dlp finishes, and to
   * record status='failed' on error. Returns the updated item, or null if
   * the id wasn't found.
   */
  update(id, patch) {
    const item = this.items.find(i => i.id === id);
    if (!item) return null;
    Object.assign(item, patch);
    this.save();
    return item;
  }

  reorder(id, direction) {
    const idx = this.items.findIndex(i => i.id === id);
    if (idx < 0) return false;
    const swap = direction === 'up' ? idx - 1 : idx + 1;
    if (swap < 0 || swap >= this.items.length) return false;
    [this.items[idx], this.items[swap]] = [this.items[swap], this.items[idx]];
    this.save();
    return true;
  }

  clear() {
    this.items = [];
    this.save();
  }

  pop() {
    if (this.items.length === 0) return null;
    const item = this.items.shift();
    this.save();
    return item;
  }

  peek(n = 1) {
    return this.items.slice(0, n);
  }

  count() {
    return this.items.length;
  }
}

// Singleton accessor
let _instance = null;
function getInstance() {
  if (_instance) return _instance;
  _instance = new Queue();
  const file = process.env.QUEUE_FILE || DEFAULT_FILE;
  _instance.load(file);
  if (!_instance.file) _instance.file = file;
  return _instance;
}

function _resetForTest() { _instance = null; }

module.exports = { Queue, getInstance, _resetForTest, SCHEMA_VERSION };
