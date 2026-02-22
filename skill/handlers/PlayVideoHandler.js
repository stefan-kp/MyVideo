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
    console.log('PlayVideoIntent -> Nachrichten-Suche als Fallback');

    let results;
    try {
      results = await mediathek.searchLatestNews();
    } catch (err) {
      console.error('PlayVideo news search error:', err.message);
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

    const top = results.slice(0, 6);

    const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
    sessionAttributes.mediathekResults = top;
    handlerInput.attributesManager.setSessionAttributes(sessionAttributes);

    const spokenResults = top.slice(0, 3);
    const lines = spokenResults.map((r, i) => formatResultForSpeech(r, i));
    const moreText = top.length > 3 ? ` ${top.length - 3} weitere auf dem Display.` : '';
    const speech = `Aktuelle Nachrichten: ${lines.join('. ')}.${moreText} Welche Nummer, oder sage einen Sender.`;

    renderNewsList(handlerInput, top, 'Aktuelle Nachrichten');

    return handlerInput.responseBuilder
      .speak(speech)
      .reprompt('Sage eine Nummer oder einen Sender.')
      .withShouldEndSession(false)
      .getResponse();
  }
};

module.exports = PlayVideoHandler;
