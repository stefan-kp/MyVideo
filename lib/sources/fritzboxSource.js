const { Channel } = require('./Channel');
const { generateStreamToken } = require('../auth');
const { getInstance: getSession } = require('../fritzbox/session');
const { M3uResolver } = require('../fritzbox/m3uResolver');
const { CodecProbe } = require('../fritzbox/codecProbe');
const { Streamer } = require('../fritzbox/streamer');
const { pickAudioMap } = require('../fritzbox/audioPicker');

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
    pickAudioMap: (tunerId, rtsp) => pickAudioMap(tunerId, rtsp),
  });
  return _streamer;
}

class FritzboxSource extends Channel {
  constructor({ id, displayName, synonyms, tunerId, logoUrl, group }) {
    super({ id, displayName, synonyms, logoUrl, group, source: 'fritzbox' });
    this.tunerId = tunerId;
  }

  async resolveStream() {
    // Alexa's skill response timeout is ~8 s, but FFmpeg needs ~10-12 s to
    // produce the first HLS segment from a SAT>IP RTSP stream (RTSP setup +
    // analyse phase + first GOP). If we await streamer.start() here, the
    // skill times out before we can return the URL.
    //
    // Instead: kick off FFmpeg in the background, return the HLS URL
    // immediately. The Echo Show's HLS player will poll the URL and retry
    // on 404 until FFmpeg has written index.m3u8 (typically ~10-12 s).
    const streamer = _getStreamer();
    streamer.start(this).catch((err) => {
      console.error(`FritzboxSource: streamer.start(${this.id}) failed:`, err.message);
    });

    const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
    const token = generateStreamToken(this.id);
    return {
      url: `${baseUrl}/stream/fritzbox/index.m3u8?token=${token}`,
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

/**
 * Returns the current streamer's diagnostic state, or null if FRITZ!Box is
 * not configured / streamer hasn't been initialised yet.
 */
function getDiagnosticState() {
  if (!_streamer) return { state: 'NOT_INITIALISED', current: null };
  return _streamer.getDiagnosticState();
}

function _setStreamerForTest(s) { _streamer = s; }
function _resetForTest() { _streamer = null; _resolver = null; _probe = null; }

module.exports = {
  FritzboxSource, shutdown, getDiagnosticState,
  _setStreamerForTest, _resetForTest,
};
