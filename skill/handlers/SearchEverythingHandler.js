const Alexa = require('ask-sdk-core');
const mediathek = require('../../lib/mediathek');
const { sanitizeForSpeech, formatResultForSpeech } = require('../../lib/speechUtils');
const { renderNewsList } = require('../../lib/aplHelper');
const contentService = require('../../lib/content/service');
const { searchLocal } = require('../../lib/content/search');

const SearchEverythingHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
           Alexa.getIntentName(handlerInput.requestEnvelope) === 'SearchEverythingIntent';
  },
  async handle(handlerInput) {
    const query = handlerInput.requestEnvelope.request.intent.slots?.query?.value;
    if (!query) {
      return handlerInput.responseBuilder
        .speak('Was moechtest du suchen?')
        .reprompt('Sage zum Beispiel: suche Tatort.')
        .getResponse();
    }

    const local = contentService.isEnabled()
      ? searchLocal(contentService.getIndex().all(), query, { limit: 10 }).map(toLocalResult)
      : [];

    let mediathekResults = [];
    try {
      mediathekResults = (await mediathek.search(query)).map(r => ({ ...r, source: 'mediathek' }));
    } catch (err) {
      console.error('SearchEverything: mediathek search failed:', err.message);
    }

    const all = [...local, ...mediathekResults];
    if (all.length === 0) {
      return handlerInput.responseBuilder
        .speak(`Ich habe nichts zu ${sanitizeForSpeech(query)} gefunden.`)
        .reprompt('Moechtest du etwas anderes suchen?')
        .getResponse();
    }

    const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
    sessionAttributes.mediathekResults = all;
    handlerInput.attributesManager.setSessionAttributes(sessionAttributes);

    const top = all.slice(0, 3);
    const speech = `${local.length} in deiner Sammlung und ${mediathekResults.length} in der Mediathek. ${top.map((r, i) => formatResultForSpeech(r, i)).join('. ')}. Welche Nummer?`;
    renderNewsList(handlerInput, [{ title: `Suche: ${query}`, results: all }], `Suche: ${query}`);
    return handlerInput.responseBuilder.speak(speech).reprompt('Sage eine Nummer.').withShouldEndSession(false).getResponse();
  },
};

function toLocalResult(entry) {
  return {
    title: entry.type === 'episode'
      ? `${entry.show} S${pad(entry.season)}E${pad(entry.episode)} - ${entry.title}`
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
function pad(n) { return String(n || 0).padStart(2, '0'); }

module.exports = SearchEverythingHandler;
