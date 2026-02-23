const Alexa = require('ask-sdk-core');
const { generateStreamToken } = require('../../lib/auth');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

const PlayMediathekResultHandler = {
  canHandle(handlerInput) {
    return (
      Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === 'PlayMediathekResultIntent'
    );
  },
  handle(handlerInput) {
    const number = parseInt(
      handlerInput.requestEnvelope.request.intent.slots.resultNumber?.value, 10
    );

    const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
    const results = sessionAttributes.mediathekResults;

    if (!results || results.length === 0) {
      return handlerInput.responseBuilder
        .speak('Du hast noch nicht in der Mediathek gesucht. Sage zum Beispiel: suche Tatort in der Mediathek.')
        .reprompt('Was moechtest du in der Mediathek suchen?')
        .getResponse();
    }

    if (isNaN(number) || number < 1 || number > results.length) {
      return handlerInput.responseBuilder
        .speak(`Bitte sage eine Nummer zwischen 1 und ${results.length}.`)
        .reprompt(`Welche Nummer? 1 bis ${results.length}.`)
        .getResponse();
    }

    const result = results[number - 1];

    if (result.segments && result.segments.length > 0) {
      sessionAttributes.currentSegments = result.segments;
      sessionAttributes.currentSegmentIndex = 0;
      handlerInput.attributesManager.setSessionAttributes(sessionAttributes);
    }

    const token = generateStreamToken('mediathek');
    const streamUrl = `${BASE_URL}/proxy/mediathek?url=${encodeURIComponent(result.url)}&token=${token}`;

    console.log(`Starte Mediathek: ${result.title} -> ${streamUrl}`);

    return handlerInput.responseBuilder
      .speak(`Starte ${result.title}.`)
      .addVideoAppLaunchDirective(streamUrl, result.title, `${result.channel} - ${result.topic}`)
      .getResponse();
  }
};

module.exports = PlayMediathekResultHandler;
