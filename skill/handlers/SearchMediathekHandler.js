const Alexa = require('ask-sdk-core');
const mediathek = require('../../lib/mediathek');
const { sanitizeForSpeech, formatResultForSpeech } = require('../../lib/speechUtils');
const { renderNewsList } = require('../../lib/aplHelper');

const SearchMediathekHandler = {
  canHandle(handlerInput) {
    return (
      Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === 'SearchMediathekIntent'
    );
  },
  async handle(handlerInput) {
    const query = handlerInput.requestEnvelope.request.intent.slots.query?.value;

    if (!query) {
      return handlerInput.responseBuilder
        .speak('Was moechtest du in der Mediathek suchen?')
        .reprompt('Sage zum Beispiel: suche Tatort in der Mediathek.')
        .getResponse();
    }

    console.log(`SearchMediathekIntent: query="${query}"`);

    let results;
    try {
      results = await mediathek.search(query);
    } catch (err) {
      console.error('Mediathek search error:', err.message);
      return handlerInput.responseBuilder
        .speak('Die Mediathek-Suche ist gerade nicht erreichbar. Bitte versuche es spaeter erneut.')
        .getResponse();
    }

    if (results.length === 0) {
      return handlerInput.responseBuilder
        .speak(`Ich habe leider nichts zu ${sanitizeForSpeech(query)} in der Mediathek gefunden.`)
        .reprompt('Moechtest du etwas anderes suchen?')
        .getResponse();
    }

    const top = results.slice(0, 3);

    const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
    sessionAttributes.mediathekResults = top;
    handlerInput.attributesManager.setSessionAttributes(sessionAttributes);

    const lines = top.map((r, i) => formatResultForSpeech(r, i));
    const speech = `${top.length} Ergebnisse. ${lines.join('. ')}. Welche Nummer?`;

    renderNewsList(handlerInput, top, `Mediathek: ${query}`);

    return handlerInput.responseBuilder
      .speak(speech)
      .reprompt('Sage eine Nummer, zum Beispiel: Nummer 1.')
      .withShouldEndSession(false)
      .getResponse();
  }
};

module.exports = SearchMediathekHandler;
