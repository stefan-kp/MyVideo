const Alexa = require('ask-sdk-core');
const mediathek = require('../../lib/mediathek');
const { formatResultForSpeech } = require('../../lib/speechUtils');
const { renderNewsList } = require('../../lib/aplHelper');

const PlayVideoHandler = {
  canHandle(handlerInput) {
    return (
      Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      (Alexa.getIntentName(handlerInput.requestEnvelope) === 'PlayVideoIntent' ||
       Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.ResumeIntent')
    );
  },
  async handle(handlerInput) {
    console.log('PlayVideoIntent -> ZIB-Suche als Fallback');

    let results;
    try {
      results = await mediathek.search('ZIB');
    } catch (err) {
      console.error('PlayVideo ZIB search error:', err.message);
      return handlerInput.responseBuilder
        .speak('Sage einen Sendernamen, zum Beispiel: spiele Tagesschau 24.')
        .reprompt('Welchen Sender moechtest du sehen?')
        .withShouldEndSession(false)
        .getResponse();
    }

    if (!results || results.length === 0) {
      return handlerInput.responseBuilder
        .speak('Sage einen Sendernamen oder suche in der Mediathek.')
        .reprompt('Welchen Sender moechtest du sehen?')
        .withShouldEndSession(false)
        .getResponse();
    }

    const top = results.slice(0, 3);

    const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
    sessionAttributes.mediathekResults = top;
    handlerInput.attributesManager.setSessionAttributes(sessionAttributes);

    const lines = top.map((r, i) => formatResultForSpeech(r, i));
    const speech = `Aktuelle Nachrichten: ${lines.join('. ')}. Welche Nummer, oder sage einen Sender.`;

    renderNewsList(handlerInput, top, 'Aktuelle Nachrichten');

    return handlerInput.responseBuilder
      .speak(speech)
      .reprompt('Sage eine Nummer oder einen Sender.')
      .withShouldEndSession(false)
      .getResponse();
  }
};

module.exports = PlayVideoHandler;
