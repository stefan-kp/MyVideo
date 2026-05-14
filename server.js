require('dotenv').config();

const express = require('express');
const Alexa = require('ask-sdk-core');
const { ExpressAdapter } = require('ask-sdk-express-adapter');
const path = require('path');

const channels = require('./lib/channels');
const hlsProxy = require('./lib/hlsProxy');
const orfService = require('./lib/orfService');
const { debug, debugJson } = require('./lib/debug');
const contentService = require('./lib/content/service');

const LaunchHandler = require('./skill/handlers/LaunchHandler');
const PlayNewsHandler = require('./skill/handlers/PlayNewsHandler');
const { SummaryHandler, SummaryYesHandler, SummaryNoHandler, SummaryDetailHandler } = require('./skill/handlers/SummaryHandler');
const PlayChannelHandler = require('./skill/handlers/PlayChannelHandler');
const SearchMediathekHandler = require('./skill/handlers/SearchMediathekHandler');
const SearchContentHandler = require('./skill/handlers/SearchContentHandler');
const SearchEverythingHandler = require('./skill/handlers/SearchEverythingHandler');
const ListNewContentHandler = require('./skill/handlers/ListNewContentHandler');
const PlayShowHandler = require('./skill/handlers/PlayShowHandler');
const PlayQueueHandler = require('./skill/handlers/PlayQueueHandler');
const QueuePeekHandler = require('./skill/handlers/QueuePeekHandler');
const PlayMediathekResultHandler = require('./skill/handlers/PlayMediathekResultHandler');
const PlayCategoryHandler = require('./skill/handlers/PlayCategoryHandler');
const PlayVideoHandler = require('./skill/handlers/PlayVideoHandler');
const ListChannelsHandler = require('./skill/handlers/ListChannelsHandler');
const TouchEventHandler = require('./skill/handlers/TouchEventHandler');
const { NextChapterHandler, PreviousChapterHandler } = require('./skill/handlers/ChapterNavigationHandler');
const StopHandler = require('./skill/handlers/StopHandler');
const SessionEndedHandler = require('./skill/handlers/SessionEndedHandler');

const app = express();
const PORT = process.env.PORT || 3000;

// --- JWT Secret Validation ---
if (!process.env.JWT_SECRET) {
  console.warn('WARNUNG: JWT_SECRET nicht gesetzt! Proxy-Routen werden nicht funktionieren.');
}

// --- Root: redirect to diag UI (LAN-gated by /diag middleware) ---
// The Alexa skill uses POST /alexa, never GET /, so this redirect is safe.
// Public callers via the Cloudflare tunnel get redirected too but then hit
// the LAN-only 404 on /diag/ui — same outcome as if they tried /diag/ui
// directly, just one extra hop.
app.get('/', (req, res) => res.redirect(302, '/diag/ui'));

// --- Lokale Logos ---
app.use('/logos', express.static(path.join(__dirname, 'public', 'logos')));

// --- HLS Proxy ---
app.use('/proxy', hlsProxy);

// --- FRITZ!Box HLS Stream Serving (JWT-protected) ---
// Both /stream/.../*.m3u8 and /stream/.../*.ts require ?token=<jwt>. The
// .m3u8 is rewritten on the fly so each segment line carries the same token,
// otherwise HLS players (VLC, Echo Show) would fetch segments without
// auth and get 401.
const { authMiddleware } = require('./lib/auth');
const { touchActivity } = require('./lib/sources/fritzboxSource');
const fritzboxStreamRouter = express.Router();
fritzboxStreamRouter.use(authMiddleware());
fritzboxStreamRouter.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Cache-Control', 'no-cache, no-store, must-revalidate');
  // Every HLS request (playlist poll or segment fetch) counts as activity.
  // Without this, FFmpeg keeps running for hours after the viewer stops
  // watching, burning CPU on nothing.
  try { touchActivity(); } catch {}
  next();
});

// Rewrite .m3u8: append ?token=<jwt> to every segment reference. If the
// file doesn't exist yet (FFmpeg still warming up after a channel switch),
// return a live playlist pointing at a pre-encoded "Lade TV Stream..."
// loading segment. The Echo Show plays that immediately and keeps polling
// the playlist; once FFmpeg has written the real m3u8, the player swaps
// to the live segments at the next poll.
fritzboxStreamRouter.get('/*.m3u8', (req, res) => {
  const fs = require('fs');
  const filePath = path.join(__dirname, 'stream', req.path);
  const token = req.query.token;
  res.type('application/vnd.apple.mpegurl');
  fs.readFile(filePath, 'utf8', (err, data) => {
    if (err) {
      // Loading playlist: one 6 s segment of "Lade TV Stream..." on black.
      // EXT-X-DISCONTINUITY marks the boundary so the player resets its
      // decoder state cleanly when the real stream starts.
      return res.send([
        '#EXTM3U',
        '#EXT-X-VERSION:3',
        '#EXT-X-TARGETDURATION:6',
        '#EXT-X-MEDIA-SEQUENCE:0',
        '#EXT-X-DISCONTINUITY',
        '#EXTINF:6.000000,',
        `/stream/loading.ts?token=${token}`,
        '',
      ].join('\n'));
    }
    const rewritten = data.split('\n').map(line => {
      const t = line.trim();
      if (!t || t.startsWith('#')) return line;
      // Plain segment reference - append token. Preserve any existing query.
      const sep = t.includes('?') ? '&' : '?';
      return `${t}${sep}token=${token}`;
    }).join('\n');
    res.send(rewritten);
  });
});

// Loading segment, pre-encoded, no FFmpeg involvement. Served from public/
// instead of stream/ so it isn't touched by the streamer state machine.
fritzboxStreamRouter.get('/loading.ts', (req, res) => {
  res.type('video/mp2t');
  res.sendFile(path.join(__dirname, 'public', 'stream', 'loading.ts'));
});

// Segments and anything else: serve as static.
fritzboxStreamRouter.use(express.static(path.join(__dirname, 'stream'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.ts')) res.type('video/mp2t');
  },
}));

app.use('/stream', fritzboxStreamRouter);

// --- Local content direct-play ---
const contentRouter = express.Router();
contentRouter.use(authMiddleware());

// /content/<id>/file.mp4  -- direct stream of the local file
// Note: <id> contains '/' (e.g. "filme/inception-2010"), so we use a wildcard.
contentRouter.get(/^\/(.+)\/file\.mp4$/, (req, res) => {
  if (!contentService.isEnabled()) return res.status(503).json({ error: 'content not configured' });
  const id = req.params[0];
  const entry = contentService.getIndex().findById(id);
  if (!entry) return res.status(404).json({ error: `unknown content id: ${id}` });
  if (req.tokenPayload?.sub !== id) {
    return res.status(403).json({ error: 'token mismatch' });
  }
  res.sendFile(entry.path);
});
app.use('/content', contentRouter);

// --- Diagnostics (LAN-only) ---
// All /diag/* endpoints reject requests from public IPs. Cloudflare-Tunnel
// requests appear with the tunnel ingress IP (public CF range), local-net
// curl arrives from 127.0.0.1 / 192.168.* / 10.* / 172.16-31.*. We don't
// trust X-Forwarded-For here on purpose - it's a defense against accidentally
// leaking ffmpeg cmd lines (which contain JWT-signed RTSP URLs) over the
// public tunnel.
function isLanRequest(req) {
  const ip = (req.socket?.remoteAddress || req.ip || '').replace(/^::ffff:/, '');
  if (!ip) return false;
  if (ip === '127.0.0.1' || ip === '::1' || ip === 'localhost') return true;
  if (/^10\./.test(ip)) return true;
  if (/^192\.168\./.test(ip)) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip)) return true;
  return false;
}

const diagRouter = express.Router();
diagRouter.use((req, res, next) => {
  if (!isLanRequest(req)) {
    return res.status(404).json({ error: 'not found' });
  }
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  next();
});

// Quick channel overview - registered channels, sources, fallback wiring.
diagRouter.get('/channels', (req, res) => {
  const grouped = channels.listChannels();
  const flat = [];
  for (const [group, list] of Object.entries(grouped)) {
    for (const ch of list) {
      flat.push({
        id: ch.id,
        displayName: ch.displayName,
        synonyms: ch.synonyms,
        group,
        source: ch.source || `${ch.primary?.source}+fallback`,
        tunerId: ch.tunerId || ch.primary?.tunerId || null,
        logo: ch.logoUrl,
        hasFallback: !!ch.fallback,
      });
    }
  }
  res.json({ count: flat.length, channels: flat });
});

// Streamer state - what's playing now, with full ffmpeg cmd line.
diagRouter.get('/stream-state', (req, res) => {
  try {
    const { getDiagnosticState } = require('./lib/sources/fritzboxSource');
    res.json(getDiagnosticState());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Stream output dir contents (segments + playlist on disk).
diagRouter.get('/segments', (req, res) => {
  const fsLocal = require('fs');
  const dir = path.join(__dirname, 'stream', 'fritzbox');
  if (!fsLocal.existsSync(dir)) return res.json({ dir, files: [] });
  const files = fsLocal.readdirSync(dir).map(f => {
    const stat = fsLocal.statSync(path.join(dir, f));
    return { name: f, size: stat.size, mtime: stat.mtime.toISOString() };
  }).sort((a, b) => a.name.localeCompare(b.name));
  let m3u8 = null;
  try {
    m3u8 = fsLocal.readFileSync(path.join(dir, 'index.m3u8'), 'utf8');
  } catch {}
  res.json({ dir, files, m3u8 });
});

// Audio-picker probe + cache. Probes a channel's RTSP source for audio tracks,
// returns the raw list + which one would be selected.
diagRouter.get('/audio/:channelId', async (req, res) => {
  try {
    const { channelId } = req.params;
    const { getInstance } = require('./lib/fritzbox/session');
    const { M3uResolver } = require('./lib/fritzbox/m3uResolver');
    const { probeAudioTracks, pickAudioStream, getCacheSnapshot } = require('./lib/fritzbox/audioPicker');
    const fbData = JSON.parse(require('fs').readFileSync(path.join(__dirname, 'lib', 'fritzbox', 'channels.json'), 'utf8'));
    const ch = fbData.channels.find(c => c.id === channelId);
    if (!ch) return res.status(404).json({ error: `unknown FRITZ!Box channel: ${channelId}` });
    const session = getInstance();
    if (!session) return res.status(503).json({ error: 'FRITZ!Box not configured' });
    const resolver = new M3uResolver({ session });
    const rtspUrl = await resolver.getRtspUrl(ch.tunerId);
    const tracks = await probeAudioTracks(rtspUrl);
    const relativeIdx = pickAudioStream(tracks.map(t => ({
      index: t.index,
      tags: { language: t.language },
      disposition: t.disposition,
    })));
    res.json({
      channelId, tunerId: ch.tunerId, rtspUrl,
      tracks,
      pickedAudioRelativeIndex: relativeIdx,
      pickedContainerIndex: relativeIdx == null ? null : tracks[relativeIdx]?.index,
      pickedAudioMap: relativeIdx == null ? null : `0:a:${relativeIdx}`,
      cache: getCacheSnapshot()[ch.tunerId] || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// FRITZ!Box session status (SID present? when issued?)
diagRouter.get('/session', async (req, res) => {
  try {
    const { getInstance } = require('./lib/fritzbox/session');
    const session = getInstance();
    if (!session) return res.json({ configured: false });
    res.json({
      configured: true,
      host: session.host,
      user: session.user,
      sidPresent: !!session.sid,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Current transcode + codec-probe settings (so you can verify your .env tuning).
diagRouter.get('/settings', (req, res) => {
  try {
    const { getTranscodeSettings } = require('./lib/fritzbox/streamer');
    res.json({
      transcode: getTranscodeSettings(),
      audio: {
        pipelineOverride: process.env.FRITZBOX_PIPELINE || null,
        audioBitrate: process.env.FRITZBOX_AUDIO_BITRATE || '128k',
      },
      tunable: {
        FRITZBOX_OUTPUT_SCALE: 'WxH for transcode output, e.g. 960x540 (default), 640x360 for low-end Echo Show',
        FRITZBOX_VIDEO_BITRATE: 'e.g. 1500k (default), 1000k, 800k',
        FRITZBOX_AUDIO_BITRATE: 'e.g. 128k (default), 96k',
        FRITZBOX_PRESET: 'libx264 preset: veryfast (default), fast, medium',
        FRITZBOX_PIPELINE: 'set to "copy" to opt H.264 sources into stream-copy mode (lower CPU, less robust)',
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Local content endpoints.
diagRouter.get('/content/stats', (req, res) => {
  if (!contentService.isEnabled()) return res.json({ enabled: false });
  const idx = contentService.getIndex();
  const cfg = contentService.getConfig();
  const byLabel = {};
  for (const e of idx.all()) {
    byLabel[e.pathLabel] = (byLabel[e.pathLabel] || 0) + 1;
  }
  res.json({
    enabled: true,
    totalEntries: idx.count(),
    scannedAt: idx.scannedAt,
    perLabel: byLabel,
    config: cfg.paths.map(p => ({ label: p.label, path: p.path, newerThanDays: p.newerThanDays })),
  });
});

diagRouter.get('/content/search', (req, res) => {
  if (!contentService.isEnabled()) return res.status(503).json({ error: 'disabled' });
  const q = req.query.q || '';
  const { searchLocal } = require('./lib/content/search');
  // Higher default limit so a whole series fits (Better Call Saul has 63 episodes).
  const limit = Math.min(parseInt(req.query.limit, 10) || 200, 500);
  const hits = searchLocal(contentService.getIndex().all(), q, { limit });
  res.json({ query: q, count: hits.length, results: hits });
});

diagRouter.get('/content/item/:id(*)', (req, res) => {
  if (!contentService.isEnabled()) return res.status(503).json({ error: 'disabled' });
  const entry = contentService.getIndex().findById(req.params.id);
  if (!entry) return res.status(404).json({ error: 'not found' });
  res.json(entry);
});

diagRouter.post('/content/reindex', async (req, res) => {
  if (!contentService.isEnabled()) return res.status(503).json({ error: 'disabled' });
  try {
    const result = await contentService.rescan();
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

diagRouter.get('/content/config', (req, res) => {
  if (!contentService.isEnabled()) return res.status(503).json({ error: 'disabled' });
  res.json(contentService.getConfig());
});

// Newest entries (smart-mix: 1 per show), with optional label filter.
diagRouter.get('/content/newest', (req, res) => {
  if (!contentService.isEnabled()) return res.status(503).json({ error: 'disabled' });
  const { findNewest } = require('./lib/content/search');
  const label = req.query.label || null;
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 200);
  const newerThanDaysOnly = req.query.newerOnly !== '0';
  const results = findNewest(contentService.getIndex().all(), {
    label, limit, uniquePerShow: true,
    newerThanDaysOnly,
    pathConfigs: contentService.getConfig().paths,
  });
  res.json({ count: results.length, results });
});

// --- YouTube playlist endpoints (LAN-only) ---
// Playlists are configured via the web UI, crawled on demand, and downloaded
// per video. Downloaded MP4s land in data/youtube/<slug>/ and are picked up
// by the content scanner so they become regular ContentEntries.
const youtubePlaylists = require('./lib/youtube/playlists');
const youtubeCrawler = require('./lib/youtube/crawler');
const youtubeDownloader = require('./lib/youtube/downloader');
const ytFs = require('fs');
const ytJson = express.json();
const ytDownloadLocks = new Map(); // playlistId -> Promise (one download at a time per playlist)

function getYoutubeDir() {
  return contentService.YOUTUBE_DIR || path.join(__dirname, 'data', 'youtube');
}

diagRouter.get('/youtube/playlists', (req, res) => {
  res.json({ playlists: youtubePlaylists.getInstance().list() });
});

diagRouter.post('/youtube/playlists', ytJson, (req, res) => {
  try {
    const item = youtubePlaylists.getInstance().add(req.body || {});
    res.status(201).json(item);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

diagRouter.delete('/youtube/playlists/:id', (req, res) => {
  const pls = youtubePlaylists.getInstance();
  const pl = pls.findById(req.params.id);
  if (!pl) return res.status(404).json({ error: 'not found' });
  // Best-effort: remove the slug directory so cleanup doesn't have to chase it.
  try {
    const dir = path.join(getYoutubeDir(), pl.slug);
    if (ytFs.existsSync(dir)) ytFs.rmSync(dir, { recursive: true, force: true });
  } catch (err) {
    console.warn(`[youtube] could not remove ${pl.slug} dir: ${err.message}`);
  }
  pls.remove(req.params.id);
  res.json({ ok: true });
});

diagRouter.post('/youtube/playlists/:id/crawl', async (req, res) => {
  const pls = youtubePlaylists.getInstance();
  const pl = pls.findById(req.params.id);
  if (!pl) return res.status(404).json({ error: 'not found' });
  try {
    const videos = await youtubeCrawler.crawlPlaylist(pl.url);
    pls.updateVideos(pl.id, videos);
    res.json({ ok: true, playlist: pls.findById(pl.id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

diagRouter.post('/youtube/playlists/:id/download/:videoId', async (req, res) => {
  const pls = youtubePlaylists.getInstance();
  const pl = pls.findById(req.params.id);
  if (!pl) return res.status(404).json({ error: 'playlist not found' });
  const video = (pl.videos || []).find(v => v.videoId === req.params.videoId);
  if (!video) return res.status(404).json({ error: 'video not in playlist' });

  // Already downloaded and file still there? Just return the existing content id.
  if (video.downloaded && video.downloadedPath && ytFs.existsSync(video.downloadedPath)) {
    return res.json({ ok: true, alreadyDownloaded: true, path: video.downloadedPath });
  }

  // Per-playlist mutex so two concurrent downloads in the same slug-dir
  // can't race over yt-dlp's tempfiles.
  if (ytDownloadLocks.has(pl.id)) {
    return res.status(409).json({ error: 'another download for this playlist is in progress' });
  }

  const outDir = path.join(getYoutubeDir(), pl.slug);
  const dlPromise = (async () => {
    const filePath = await youtubeDownloader.downloadVideo({
      videoId: video.videoId,
      outDir,
    });
    pls.markDownloaded(pl.id, video.videoId, filePath);
    // Rescan so the new MP4 shows up in the content index immediately.
    if (contentService.isEnabled()) {
      await contentService.rescan().catch(err => console.warn(`[youtube] post-download rescan: ${err.message}`));
    }
    return filePath;
  })();

  ytDownloadLocks.set(pl.id, dlPromise);
  try {
    const filePath = await dlPromise;
    // Try to find the contentId so the caller can immediately POST /diag/queue
    let contentId = null;
    if (contentService.isEnabled()) {
      const entry = contentService.getIndex().all().find(e => e.path === filePath);
      if (entry) contentId = entry.id;
    }
    res.json({ ok: true, path: filePath, contentId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    ytDownloadLocks.delete(pl.id);
  }
});

// Web UI for diagnostics. LAN-only via the diagRouter middleware.
diagRouter.get('/ui', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'diag', 'index.html'));
});

// --- Watch-Queue endpoints (LAN-only) ---
// Queue items are: { id, source: 'local'|'mediathek', contentId|url, title,
//                    subtitle, duration, imageUrl, addedAt }
const queueModule = require('./lib/queue');
const queueJson = express.json();

diagRouter.get('/queue', (req, res) => {
  res.json({ count: queueModule.getInstance().count(), items: queueModule.getInstance().list() });
});

diagRouter.post('/queue', queueJson, (req, res) => {
  try {
    const input = req.body || {};
    // For local source: validate that contentId resolves
    if (input.source === 'local') {
      if (!contentService.isEnabled()) {
        return res.status(503).json({ error: 'content service not enabled' });
      }
      const entry = contentService.getIndex().findById(input.contentId);
      if (!entry) return res.status(404).json({ error: `unknown contentId: ${input.contentId}` });
    }
    const item = queueModule.getInstance().add(input);
    res.status(201).json(item);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

diagRouter.delete('/queue/:id', (req, res) => {
  const ok = queueModule.getInstance().remove(req.params.id);
  if (!ok) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});

diagRouter.post('/queue/:id/up', (req, res) => {
  const ok = queueModule.getInstance().reorder(req.params.id, 'up');
  res.json({ ok });
});

diagRouter.post('/queue/:id/down', (req, res) => {
  const ok = queueModule.getInstance().reorder(req.params.id, 'down');
  res.json({ ok });
});

diagRouter.post('/queue/clear', (req, res) => {
  queueModule.getInstance().clear();
  res.json({ ok: true });
});

// Index of available diag endpoints (so you don't have to remember the list).
diagRouter.get('/', (req, res) => {
  res.json({
    ui: 'GET /diag/ui  (Web-Interface, LAN-only)',
    available: [
      'GET /diag/channels',
      'GET /diag/stream-state',
      'GET /diag/segments',
      'GET /diag/audio/:channelId',
      'GET /diag/session',
      'GET /diag/settings',
      'GET /diag/content/stats',
      'GET /diag/content/search?q=...',
      'GET /diag/content/newest?label=Filme&limit=20',
      'GET /diag/content/item/:id',
      'POST /diag/content/reindex',
      'GET /diag/content/config',
      'GET /diag/queue',
      'POST /diag/queue',
      'DELETE /diag/queue/:id',
      'POST /diag/queue/:id/up',
      'POST /diag/queue/:id/down',
      'POST /diag/queue/clear',
      'GET /diag/youtube/playlists',
      'POST /diag/youtube/playlists',
      'DELETE /diag/youtube/playlists/:id',
      'POST /diag/youtube/playlists/:id/crawl',
      'POST /diag/youtube/playlists/:id/download/:videoId',
    ],
    note: 'LAN-only. Cloudflare-Tunnel requests get 404.',
  });
});

app.use('/diag', diagRouter);

// --- Health Check ---
app.get('/health', (req, res) => {
  const fs = require('fs');
  const m3u8Path = path.join(__dirname, 'stream', 'index.m3u8');
  const streamActive = fs.existsSync(m3u8Path);
  const channelList = channels.listChannels();
  const channelCount = Object.values(channelList).reduce((sum, arr) => sum + arr.length, 0);

  res.json({
    status: 'ok',
    streamActive,
    channels: channelCount,
    jwtConfigured: !!process.env.JWT_SECRET,
    orfApiEnabled: orfService.isEnabled(),
    baseUrl: process.env.BASE_URL || `http://localhost:${PORT}`,
    proxyUrl: `${process.env.BASE_URL || `http://localhost:${PORT}`}/proxy/live/`
  });
});

// --- Alexa Skill Endpoint ---
const skillBuilder = Alexa.SkillBuilders.custom()
  .withApiClient(new Alexa.DefaultApiClient())
  .addRequestHandlers(
    LaunchHandler,
    PlayNewsHandler,
    SummaryHandler,
    SummaryYesHandler,
    SummaryNoHandler,
    SummaryDetailHandler,
    PlayChannelHandler,
    SearchMediathekHandler,
    SearchContentHandler,
    SearchEverythingHandler,
    ListNewContentHandler,
    PlayShowHandler,
    PlayQueueHandler,
    QueuePeekHandler,
    PlayMediathekResultHandler,
    PlayCategoryHandler,
    PlayVideoHandler,
    ListChannelsHandler,
    TouchEventHandler,
    NextChapterHandler,
    PreviousChapterHandler,
    StopHandler,
    SessionEndedHandler
  )
  .addErrorHandlers({
    canHandle() {
      return true;
    },
    handle(handlerInput, error) {
      console.error('Alexa Skill Error:', error.message);
      console.error('Alexa Skill Error Stack:', error.stack);
      debug('Error handlerInput request type:', Alexa.getRequestType(handlerInput.requestEnvelope));
      debugJson('Error handlerInput request', handlerInput.requestEnvelope.request);
      return handlerInput.responseBuilder
        .speak('Es ist ein Fehler aufgetreten. Bitte versuche es erneut.')
        .getResponse();
    }
  });

const skill = skillBuilder.create();
const adapter = new ExpressAdapter(skill, true, true);

app.post('/alexa', adapter.getRequestHandlers());

// --- FFmpeg cleanup on shutdown ---
const fritzboxSourceModule = require('./lib/sources/fritzboxSource');
async function gracefulShutdown(signal) {
  console.log(`Empfangen: ${signal}, beende FFmpeg-Stream...`);
  try {
    if (fritzboxSourceModule.shutdown) await fritzboxSourceModule.shutdown();
  } catch (e) {
    console.error('Shutdown error:', e.message);
  }
  process.exit(0);
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// --- Start Server ---
app.listen(PORT, () => {
  const channelList = channels.listChannels();
  const channelCount = Object.values(channelList).reduce((sum, arr) => sum + arr.length, 0);

  console.log(`MyVideo Alexa Skill Server laeuft auf Port ${PORT}`);
  console.log(`  Skill Endpoint: http://localhost:${PORT}/alexa`);
  console.log(`  HLS Proxy:      http://localhost:${PORT}/proxy/live/`);
  console.log(`  Legacy Stream:  http://localhost:${PORT}/stream/index.m3u8`);
  console.log(`  Health Check:   http://localhost:${PORT}/health`);
  console.log(`  Sender geladen: ${channelCount}`);

  if (process.env.BASE_URL) {
    console.log(`  Externe URL:    ${process.env.BASE_URL}`);
  } else {
    console.warn('  WARNUNG: BASE_URL nicht gesetzt!');
  }

  if (!process.env.JWT_SECRET) {
    console.warn('  WARNUNG: JWT_SECRET nicht gesetzt!');
  }

  console.log(`  ORF API:        ${orfService.isEnabled() ? 'aktiv' : 'deaktiviert'}`);

  if (orfService.isEnabled()) {
    orfService.initProfiles().catch(err => {
      console.error('ORF API Profile-Init fehlgeschlagen:', err.message);
    });
  }

  console.log(`  AI-Summary:     ${process.env.OPENROUTER_API_KEY ? 'verfuegbar (on-demand)' : 'deaktiviert (kein OPENROUTER_API_KEY)'}`);

  // --- Local content (NAS) bootstrap ---
  (async () => {
    try {
      const contentService = require('./lib/content/service');
      const fritzboxSource = require('./lib/sources/fritzboxSource');
      const streamer = fritzboxSource._getStreamerForContent
        ? fritzboxSource._getStreamerForContent()
        : null;
      const configPath = process.env.CONTENT_CONFIG_PATH ||
        require('path').join(__dirname, 'config', 'content-paths.json');
      const ok = await contentService.init({ configPath, streamer });
      if (ok) console.log(`  Local content: aktiviert (${contentService.getConfig().paths.length} Pfade)`);
      else    console.log('  Local content: deaktiviert (keine config/content-paths.json)');
    } catch (err) {
      console.warn(`[content] init failed: ${err.message}`);
    }
  })();

  // --- YouTube cleanup scheduler (deletes downloaded MP4s older than
  //     cleanupDays unless they're currently in the queue) ---
  (async () => {
    try {
      const youtubeCleanup = require('./lib/youtube/cleanup');
      const playlistsMod = require('./lib/youtube/playlists');
      const queueMod = require('./lib/queue');
      const youtubeDir = contentService.YOUTUBE_DIR || require('path').join(__dirname, 'data', 'youtube');
      youtubeCleanup.scheduleCleanup({
        rootDir: youtubeDir,
        playlists: playlistsMod.getInstance(),
        contentService,
        queue: queueMod.getInstance(),
      });
      console.log(`  YouTube:       cleanup scheduled (rootDir=${youtubeDir})`);
    } catch (err) {
      console.warn(`[youtube] cleanup scheduler init failed: ${err.message}`);
    }
  })();

  // --- FRITZ!Box tuner verification (best-effort) ---
  (async () => {
    try {
      const sessMod = require('./lib/fritzbox/session');
      const session = sessMod.getInstance();
      if (!session) {
        console.log('  FRITZ!Box:     deaktiviert (kein FRITZBOX_HOST/USER/PASSWORD)');
        return;
      }
      const { verifyTuners } = require('./lib/fritzbox/discovery');
      const data = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, 'lib', 'fritzbox', 'channels.json'), 'utf8'));
      const { ok, missing, fritzCount } = await verifyTuners(session, data.channels);
      console.log(`  FRITZ!Box:     ${ok.length}/${data.channels.length} Sender verifiziert (FRITZ!Box hat ${fritzCount} Sender insgesamt)`);
      if (missing.length > 0) {
        console.warn(`  FRITZ!Box:     ${missing.length} Sender fehlen:`);
        for (const m of missing) console.warn(`                  - ${m.displayName} (tunerId=${m.tunerId})`);
      }
    } catch (err) {
      console.warn(`  FRITZ!Box:     Verifikation fehlgeschlagen: ${err.message}`);
    }
  })();
});
