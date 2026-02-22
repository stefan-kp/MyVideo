const Alexa = require('ask-sdk-core');
const mediathek = require('../../lib/mediathek');
const { formatResultForSpeech } = require('../../lib/speechUtils');
const { renderNewsList } = require('../../lib/aplHelper');

const LaunchHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'LaunchRequest';
  },
  async handle(handlerInput) {
    console.log('LaunchRequest empfangen');

    const supportsVideo = hasVideoSupport(handlerInput);
    if (!supportsVideo) {
      return handlerInput.responseBuilder
        .speak('Dieses Geraet unterstuetzt leider keine Videowiedergabe. Du brauchst einen Echo Show.')
        .getResponse();
    }

    // Auto-search for latest news (ZIB)
    let results;
    try {
      results = await mediathek.search('ZIB');
    } catch (err) {
      console.error('Launch ZIB search error:', err.message);
      return handlerInput.responseBuilder
        .speak('Die Mediathek ist gerade nicht erreichbar. Sage einen Sendernamen, zum Beispiel: spiele Tagesschau 24, oder spiele 3sat.')
        .reprompt('Welchen Sender moechtest du sehen?')
        .withShouldEndSession(false)
        .getResponse();
    }

    if (!results || results.length === 0) {
      return handlerInput.responseBuilder
        .speak('Ich habe gerade keine aktuellen Nachrichten gefunden. Sage einen Sendernamen, zum Beispiel: spiele Tagesschau 24.')
        .reprompt('Welchen Sender moechtest du sehen?')
        .withShouldEndSession(false)
        .getResponse();
    }

    const top = results.slice(0, 3);

    // Store in session for PlayMediathekResultHandler
    const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
    sessionAttributes.mediathekResults = top;
    handlerInput.attributesManager.setSessionAttributes(sessionAttributes);

    const lines = top.map((r, i) => formatResultForSpeech(r, i));
    const speech = `Aktuelle Nachrichten: ${lines.join('. ')}. Welche Nummer, oder sage Tagesschau fuer den Livestream.`;

    renderNewsList(handlerInput, top, 'Aktuelle Nachrichten');

    return handlerInput.responseBuilder
      .speak(speech)
      .reprompt('Sage eine Nummer oder einen Sender.')
      .withShouldEndSession(false)
      .getResponse();
  }
};

function hasVideoSupport(handlerInput) {
  const { requestEnvelope } = handlerInput;
  const interfaces = requestEnvelope.context.System.device.supportedInterfaces;
  if (interfaces && interfaces['VideoApp']) return true;
  const viewport = requestEnvelope.context.Viewport;
  if (viewport && viewport.video) return true;
  return false;
}

module.exports = LaunchHandler;
