const Alexa = require('ask-sdk-core');
const { sanitizeForSpeech, formatResultForSpeech } = require('../../lib/speechUtils');
const { renderNewsList } = require('../../lib/aplHelper');
const contentService = require('../../lib/content/service');
const { searchLocal } = require('../../lib/content/search');

const SearchContentHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
           Alexa.getIntentName(handlerInput.requestEnvelope) === 'SearchContentIntent';
  },
  handle(handlerInput) {
    const query = handlerInput.requestEnvelope.request.intent.slots?.query?.value;
    if (!query) {
      return handlerInput.responseBuilder
        .speak('Was moechtest du in deiner Sammlung suchen?')
        .reprompt('Sage zum Beispiel: suche Tatort lokal.')
        .getResponse();
    }
    if (!contentService.isEnabled()) {
      return handlerInput.responseBuilder
        .speak('Die lokale Sammlung ist nicht konfiguriert.')
        .getResponse();
    }
    const hits = searchLocal(contentService.getIndex().all(), query, { limit: 10 });
    if (hits.length === 0) {
      return handlerInput.responseBuilder
        .speak(`Ich habe nichts zu ${sanitizeForSpeech(query)} in deiner Sammlung gefunden.`)
        .reprompt('Moechtest du etwas anderes suchen?')
        .getResponse();
    }
    const results = hits.map(toResult);
    const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
    sessionAttributes.mediathekResults = results;
    handlerInput.attributesManager.setSessionAttributes(sessionAttributes);

    const top = results.slice(0, 3);
    const speech = `${results.length} Treffer in deiner Sammlung. ${top.map((r, i) => formatResultForSpeech(r, i)).join('. ')}. Welche Nummer?`;
    renderNewsList(handlerInput, [{ title: `Lokal: ${query}`, results }], `Lokal: ${query}`);
    return handlerInput.responseBuilder.speak(speech).reprompt('Sage eine Nummer.').withShouldEndSession(false).getResponse();
  },
};

function toResult(entry) {
  return {
    title: entry.type === 'episode'
      ? `${entry.show} ${formatEp(entry)} - ${entry.title}`
      : entry.title,
    topic: entry.pathLabel,
    channel: entry.pathLabel,
    duration: 0,
    timestamp: Math.floor(new Date(entry.mtime).getTime() / 1000),
    url: null,
    source: 'local',
    id: entry.id,
  };
}
function formatEp(e) {
  const s = String(e.season || 0).padStart(2, '0');
  const ep = String(e.episode || 0).padStart(2, '0');
  return `S${s}E${ep}`;
}

module.exports = SearchContentHandler;
