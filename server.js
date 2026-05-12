require('dotenv').config();

const express = require('express');
const Alexa = require('ask-sdk-core');
const { ExpressAdapter } = require('ask-sdk-express-adapter');
const path = require('path');

const channels = require('./lib/channels');
const hlsProxy = require('./lib/hlsProxy');
const orfService = require('./lib/orfService');
const { debug, debugJson } = require('./lib/debug');

const LaunchHandler = require('./skill/handlers/LaunchHandler');
const PlayNewsHandler = require('./skill/handlers/PlayNewsHandler');
const { SummaryHandler, SummaryYesHandler, SummaryNoHandler, SummaryDetailHandler } = require('./skill/handlers/SummaryHandler');
const PlayChannelHandler = require('./skill/handlers/PlayChannelHandler');
const SearchMediathekHandler = require('./skill/handlers/SearchMediathekHandler');
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

// --- Lokale Logos ---
app.use('/logos', express.static(path.join(__dirname, 'public', 'logos')));

// --- HLS Proxy ---
app.use('/proxy', hlsProxy);

// --- FRITZ!Box HLS Stream Serving (JWT-protected) ---
const { authMiddleware } = require('./lib/auth');
const fritzboxStreamRouter = express.Router();
fritzboxStreamRouter.use(authMiddleware());
fritzboxStreamRouter.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.path.endsWith('.m3u8')) res.type('application/vnd.apple.mpegurl');
  else if (req.path.endsWith('.ts')) res.type('video/mp2t');
  res.header('Cache-Control', 'no-cache, no-store, must-revalidate');
  next();
});
fritzboxStreamRouter.use(express.static(path.join(__dirname, 'stream')));
app.use('/stream', fritzboxStreamRouter);

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
