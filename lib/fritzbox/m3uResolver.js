const axios = require('axios');

function parseRtspFromM3u(m3uText) {
  for (const line of m3uText.split('\n')) {
    const t = line.trim();
    if (t.toLowerCase().startsWith('rtsp://')) return t;
  }
  return null;
}

class M3uResolver {
  constructor({ session, httpClient, ttlMs }) {
    this.session = session;
    this.http = httpClient || axios;
    this.ttlMs = ttlMs || 3600000; // 1h
    this.cache = new Map(); // tunerId -> { url, expiresAt }
  }

  async getRtspUrl(tunerId) {
    const now = Date.now();
    const cached = this.cache.get(tunerId);
    if (cached && cached.expiresAt > now) return cached.url;

    const url = await this.session.withSid(async (sid) => {
      const u = `http://${this.session.host}/dvb/m3u/${tunerId}.m3u?sid=${sid}`;
      const resp = await this.http.get(u, { timeout: 5000 });
      const rtsp = parseRtspFromM3u(resp.data);
      if (!rtsp) throw new Error(`No RTSP URL in M3U for tuner ${tunerId}`);
      return rtsp;
    });

    this.cache.set(tunerId, { url, expiresAt: now + this.ttlMs });
    return url;
  }

  invalidate(tunerId) {
    if (tunerId) this.cache.delete(tunerId);
    else this.cache.clear();
  }
}

module.exports = { parseRtspFromM3u, M3uResolver };
