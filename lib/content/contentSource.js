const { generateStreamToken } = require('../auth');

let _index = null;
let _probe = null;
let _streamer = null;

function _setDeps({ index, probe, streamer }) {
  _index = index; _probe = probe; _streamer = streamer;
}

function _getDeps() {
  if (_index && _probe && _streamer) return { index: _index, probe: _probe, streamer: _streamer };
  throw new Error('contentSource not initialised; call init() at server startup');
}

function init({ index, probeIfNeeded, streamer }) {
  _setDeps({ index, probe: { probeIfNeeded }, streamer });
}

async function resolveStream(itemId) {
  const { index, probe, streamer } = _getDeps();
  const entry = index.findById(itemId);
  if (!entry) throw new Error(`unknown content id: ${itemId}`);

  const codec = await probe.probeIfNeeded(entry);
  const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
  const token = generateStreamToken(entry.id);

  if (codec.directPlay) {
    return {
      url: `${baseUrl}/content/${entry.id}/file.mp4?token=${token}`,
      mimeType: 'video/mp4',
      isLive: false,
    };
  }

  // transcode via shared streamer; fire-and-forget so caller's await
  // returns quickly (FFmpeg can take 5-10s to produce first segment)
  streamer.start({
    source: 'local',
    id: entry.id,
    inputPath: entry.path,
    displayName: entry.title || entry.filename,
  }).catch(err => {
    console.error(`contentSource: streamer.start(${entry.id}) failed:`, err.message);
  });

  return {
    url: `${baseUrl}/stream/fritzbox/index.m3u8?token=${token}`,
    mimeType: 'application/vnd.apple.mpegurl',
    isLive: false,
  };
}

function _setDepsForTest(deps) { _setDeps(deps); }
function _resetDepsForTest() { _index = _probe = _streamer = null; }

module.exports = { init, resolveStream, _setDepsForTest, _resetDepsForTest };
