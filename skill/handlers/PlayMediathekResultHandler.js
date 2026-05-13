const Alexa = require('ask-sdk-core');
const contentSource = require('../../lib/content/contentSource');

const PlayMediathekResultHandler = {
  canHandle(handlerInput) {
    return (
      Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === 'PlayMediathekResultIntent'
    );
  },
  async handle(handlerInput) {
    const number = parseInt(
      handlerInput.requestEnvelope.request.intent.slots.resultNumber?.value, 10
    );
    const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
    const results = sessionAttributes.mediathekResults;

    if (!results || results.length === 0) {
      return handlerInput.responseBuilder
        .speak('Du hast noch nicht gesucht. Sage zum Beispiel: suche Tatort.')
        .reprompt('Was moechtest du suchen?')
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

    let url = result.url;
    if (result.source === 'local') {
      try {
        const stream = await contentSource.resolveStream(result.id);
        url = stream.url;
      } catch (err) {
        console.error('PlayMediathekResult local resolveStream error:', err.message);
        return handlerInput.responseBuilder
          .speak(`${result.title} kann nicht gestartet werden. ${err.message}`)
          .getResponse();
      }
    }

    console.log(`Starte Result: ${result.title} (source=${result.source || 'mediathek'}) -> ${url}`);
    return handlerInput.responseBuilder
      .speak(`Starte ${result.title}.`)
      .addVideoAppLaunchDirective(url, result.title, `${result.channel || ''} - ${result.topic || ''}`)
      .getResponse();
  }
};

module.exports = PlayMediathekResultHandler;
