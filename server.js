require('dotenv').config();

const express = require('express');
const Alexa = require('ask-sdk-core');
const { ExpressAdapter } = require('ask-sdk-express-adapter');
const path = require('path');

const channels = require('./lib/channels');
const hlsProxy = require('./lib/hlsProxy');
const orfService = require('./lib/orfService');

const LaunchHandler = require('./skill/handlers/LaunchHandler');
const PlayNewsHandler = require('./skill/handlers/PlayNewsHandler');
const SummaryHandler = require('./skill/handlers/SummaryHandler');
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

// --- Legacy HLS Stream Serving (DVB-C backwards compatibility) ---
app.use('/stream', (req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');

  if (req.path.endsWith('.m3u8')) {
    res.type('application/vnd.apple.mpegurl');
  } else if (req.path.endsWith('.ts')) {
    res.type('video/mp2t');
  }

  res.header('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.header('Pragma', 'no-cache');
  res.header('Expires', '0');

  next();
}, express.static(path.join(__dirname, 'stream')));

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
      return handlerInput.responseBuilder
        .speak('Es ist ein Fehler aufgetreten. Bitte versuche es erneut.')
        .getResponse();
    }
  });

const skill = skillBuilder.create();
const adapter = new ExpressAdapter(skill, true, true);

app.post('/alexa', adapter.getRequestHandlers());

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
});
