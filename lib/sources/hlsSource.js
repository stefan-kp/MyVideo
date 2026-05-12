const { Channel } = require('./Channel');
const { generateStreamToken } = require('../auth');
const { checkStreamAvailable } = require('../hlsProxy');

/**
 * HlsSource - channel served via public HLS upstream, proxied through /proxy/live/.
 * This is the behaviour the skill had before FRITZ!Box support.
 *
 * @param {Object} opts
 * @param {string} opts.id
 * @param {string} opts.displayName
 * @param {string[]} [opts.synonyms]
 * @param {string} opts.upstreamUrl
 * @param {string} [opts.logoUrl]
 * @param {string} [opts.group]
 * @param {(url: string) => Promise<{available: boolean, status: number}>} [opts.checkAvailable]
 *   Optional injection point for testing; defaults to lib/hlsProxy.checkStreamAvailable.
 */
class HlsSource extends Channel {
  constructor({ id, displayName, synonyms, upstreamUrl, logoUrl, group, checkAvailable = checkStreamAvailable }) {
    super({ id, displayName, synonyms, logoUrl, group, source: 'hls' });
    this.upstreamUrl = upstreamUrl;
    this._checkAvailable = checkAvailable;
  }

  /**
   * @returns {Promise<{url: string, mimeType: string, isLive: boolean}>}
   */
  async resolveStream() {
    const check = await this._checkAvailable(this.upstreamUrl);
    if (!check.available) {
      if (check.status === 403) {
        throw new Error(`${this.displayName} ist gerade geo-blockiert.`);
      }
      throw new Error(`${this.displayName} ist gerade nicht erreichbar.`);
    }
    const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
    const token = generateStreamToken(this.id);
    return {
      url: `${baseUrl}/proxy/live/${this.id}/master.m3u8?token=${token}`,
      mimeType: 'application/vnd.apple.mpegurl',
      isLive: true,
    };
  }
}

module.exports = { HlsSource };
