require('dotenv').config();

const express = require('express');
const Alexa = require('ask-sdk-core');
const { ExpressAdapter } = require('ask-sdk-express-adapter');
const path = require('path');

const LaunchHandler = require('./skill/handlers/LaunchHandler');
const PlayVideoHandler = require('./skill/handlers/PlayVideoHandler');
const StopHandler = require('./skill/handlers/StopHandler');
const SessionEndedHandler = require('./skill/handlers/SessionEndedHandler');

const app = express();
const PORT = process.env.PORT || 3000;

// --- HLS Stream Serving ---
app.use('/stream', (req, res, next) => {
  // CORS headers for Alexa devices
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');

  // Correct MIME types for HLS
  if (req.path.endsWith('.m3u8')) {
    res.type('application/vnd.apple.mpegurl');
  } else if (req.path.endsWith('.ts')) {
    res.type('video/mp2t');
  }

  // Prevent caching for live stream
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

  res.json({
    status: 'ok',
    streamActive,
    baseUrl: process.env.BASE_URL || `http://localhost:${PORT}`,
    streamUrl: `${process.env.BASE_URL || `http://localhost:${PORT}`}/stream/index.m3u8`
  });
});

// --- Alexa Skill Endpoint ---
const skillBuilder = Alexa.SkillBuilders.custom()
  .addRequestHandlers(
    LaunchHandler,
    PlayVideoHandler,
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
  console.log(`MyVideo Alexa Skill Server laeuft auf Port ${PORT}`);
  console.log(`  Skill Endpoint: http://localhost:${PORT}/alexa`);
  console.log(`  HLS Stream:     http://localhost:${PORT}/stream/index.m3u8`);
  console.log(`  Health Check:   http://localhost:${PORT}/health`);

  if (process.env.BASE_URL) {
    console.log(`  Externe URL:    ${process.env.BASE_URL}`);
  } else {
    console.log('  WARNUNG: BASE_URL nicht gesetzt - ngrok URL in .env eintragen!');
  }
});
