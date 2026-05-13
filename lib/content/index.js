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
