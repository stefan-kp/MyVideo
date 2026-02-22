const Alexa = require('ask-sdk-core');
const mediathek = require('../../lib/mediathek');
const channels = require('../../lib/channels');
const { generateStreamToken } = require('../../lib/auth');
const { checkStreamAvailable } = require('../../lib/hlsProxy');
const { formatResultForSpeech } = require('../../lib/speechUtils');
const { renderNewsList } = require('../../lib/aplHelper');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

const PlayNewsHandler = {
  canHandle(handlerInput) {
    return (
      Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === 'PlayNewsIntent'
    );
  },
  async handle(handlerInput) {
    const slot = handlerInput.requestEnvelope.request.intent.slots?.newsSource;
    let source = slot?.value;

    // Resolve canonical value
    const resolutions = slot?.resolutions?.resolutionsPerAuthority;
    if (resolutions && resolutions[0]?.values?.[0]) {
      source = resolutions[0].values[0].value.name;
    }

    console.log(`PlayNewsIntent: source="${source || 'keine'}"`);

    // Tagesschau = direct livestream
    if (source && source.toLowerCase().includes('tagesschau')) {
      const channel = channels.findChannel('Tagesschau24');
      if (channel) {
        const check = await checkStreamAvailable(channel.url);
        if (check.available) {
          const token = generateStreamToken(channel.id);
          const streamUrl = `${BASE_URL}/proxy/live/${channel.id}/master.m3u8?token=${token}`;
          console.log(`Nachrichten Livestream: ${channel.name} -> ${streamUrl}`);
          return handlerInput.responseBuilder
            .speak('Starte Tagesschau 24 live.')
            .addVideoAppLaunchDirective(streamUrl, 'Tagesschau 24', 'ARD - Tagesschau 24 Live')
            .getResponse();
        }
      }
      // Fallback: search mediathek for Tagesschau
      source = 'Tagesschau';
    }

    // ZIB or no source = mediathek search
    const query = source || 'ZIB';
    let results;
    try {
      results = await mediathek.search(query);
    } catch (err) {
      console.error('News search error:', err.message);
      return handlerInput.responseBuilder
        .speak('Die Mediathek ist gerade nicht erreichbar. Versuche es spaeter erneut.')
        .getResponse();
    }

    if (!results || results.length === 0) {
      return handlerInput.responseBuilder
        .speak(`Ich habe gerade keine aktuellen Ergebnisse fuer ${query} gefunden.`)
        .reprompt('Moechtest du etwas anderes suchen?')
        .withShouldEndSession(false)
        .getResponse();
    }

    const top = results.slice(0, 3);

    const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
    sessionAttributes.mediathekResults = top;
    handlerInput.attributesManager.setSessionAttributes(sessionAttributes);

    const lines = top.map((r, i) => formatResultForSpeech(r, i));
    const speech = `${lines.join('. ')}. Welche Nummer?`;

    renderNewsList(handlerInput, top, `Nachrichten: ${query}`);

    return handlerInput.responseBuilder
      .speak(speech)
      .reprompt('Sage eine Nummer.')
      .withShouldEndSession(false)
      .getResponse();
  }
};

module.exports = PlayNewsHandler;
