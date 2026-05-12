const { Channel } = require('./Channel');
const { generateStreamToken } = require('../auth');
const { getInstance: getSession } = require('../fritzbox/session');
const { M3uResolver } = require('../fritzbox/m3uResolver');
const { CodecProbe } = require('../fritzbox/codecProbe');
const { Streamer } = require('../fritzbox/streamer');

let _streamer = null;
let _resolver = null;
let _probe = null;

function _getStreamer() {
  if (_streamer) return _streamer;
  const session = getSession();
  if (!session) throw new Error('FRITZ!Box nicht konfiguriert (FRITZBOX_HOST/USER/PASSWORD fehlen)');
  _resolver = _resolver || new M3uResolver({ session });
  _probe = _probe || new CodecProbe({});
  _streamer = new Streamer({
    resolveRtsp: (tunerId) => _resolver.getRtspUrl(tunerId),
    getPipeline: (tunerId, rtsp) => _probe.getPipeline(tunerId, rtsp),
  });
  return _streamer;
}

class FritzboxSource extends Channel {
  constructor({ id, displayName, synonyms, tunerId, logoUrl, group }) {
    super({ id, displayName, synonyms, logoUrl, group, source: 'fritzbox' });
    this.tunerId = tunerId;
  }

  async resolveStream() {
    const streamer = _getStreamer();
    const hlsPath = await streamer.start(this);
    const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
    const token = generateStreamToken(this.id);
    return {
      url: `${baseUrl}${hlsPath}?token=${token}`,
      mimeType: 'application/vnd.apple.mpegurl',
      isLive: true,
    };
  }
}

async function shutdown() {
  if (_streamer) {
    try { await _streamer.stop(); } catch {}
  }
}

function _setStreamerForTest(s) { _streamer = s; }
function _resetForTest() { _streamer = null; _resolver = null; _probe = null; }

module.exports = { FritzboxSource, shutdown, _setStreamerForTest, _resetForTest };
