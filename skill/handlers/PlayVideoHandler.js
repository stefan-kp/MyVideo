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

    let categorized;
    try {
      categorized = await mediathek.searchCategorizedNews();
    } catch (err) {
      console.error('PlayVideo news search error:', err.message);
      return handlerInput.responseBuilder
        .speak('Sage einen Sendernamen, zum Beispiel: spiele Tagesschau 24.')
        .reprompt('Welchen Sender moechtest du sehen?')
        .withShouldEndSession(false)
        .getResponse();
    }

    const { sections } = categorized;

    if (!sections || sections.length === 0) {
      return handlerInput.responseBuilder
        .speak('Sage einen Sendernamen oder suche in der Mediathek.')
        .reprompt('Welchen Sender moechtest du sehen?')
        .withShouldEndSession(false)
        .getResponse();
    }

    const allResults = sections.flatMap(s => s.results);

    const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
    sessionAttributes.mediathekResults = allResults;
    handlerInput.attributesManager.setSessionAttributes(sessionAttributes);

    const spokenResults = allResults.slice(0, 3);
    const lines = spokenResults.map((r, i) => formatResultForSpeech(r, i));
    const moreText = allResults.length > 3 ? ` ${allResults.length - 3} weitere auf dem Display.` : '';
    const speech = `Aktuelle Nachrichten: ${lines.join('. ')}.${moreText} Welche Nummer, oder sage einen Sender.`;

    renderNewsList(handlerInput, sections, 'Aktuelle Nachrichten');

    return handlerInput.responseBuilder
      .speak(speech)
      .reprompt('Sage eine Nummer oder einen Sender.')
      .withShouldEndSession(false)
      .getResponse();
  }
};

module.exports = PlayVideoHandler;
