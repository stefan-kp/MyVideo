/**
 * Channel - base class for all live-TV sources.
 * Subclasses must implement resolveStream().
 */
class Channel {
  constructor({ id, displayName, synonyms, logoUrl, group, source }) {
    this.id = id;
    this.displayName = displayName;
    this.synonyms = synonyms || [];
    this.logoUrl = logoUrl || '';
    this.group = group || '';
    this.source = source;
  }

  // Backwards compatibility: legacy code reads ch.name and ch.url/logo
  get name() { return this.displayName; }
  get logo() { return this.logoUrl; }

  async resolveStream() {
    throw new Error(`resolveStream() not implemented for source=${this.source}`);
  }
}

/**
 * Wraps two channels - tries primary, falls back to secondary on error.
 * Identity (id/displayName/logo/group) is taken from primary.
 */
class ChannelWithFallback extends Channel {
  constructor(primary, fallback) {
    super({
      id: primary.id,
      displayName: primary.displayName,
      synonyms: primary.synonyms,
      logoUrl: primary.logoUrl,
      group: primary.group,
      source: primary.source,
    });
    this.primary = primary;
    this.fallback = fallback;
  }

  async resolveStream() {
    try {
      return await this.primary.resolveStream();
    } catch (primaryErr) {
      try {
        return await this.fallback.resolveStream();
      } catch (fallbackErr) {
        // Surface primary error - that's the one the user would expect to debug first
        throw primaryErr;
      }
    }
  }
}

module.exports = { Channel, ChannelWithFallback };
