const Alexa = require('ask-sdk-core');
const { formatResultForSpeech } = require('../../lib/speechUtils');
const { renderNewsList } = require('../../lib/aplHelper');
const contentService = require('../../lib/content/service');
const { findNewest } = require('../../lib/content/search');

const ListNewContentHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
           Alexa.getIntentName(handlerInput.requestEnvelope) === 'ListNewContentIntent';
  },
  handle(handlerInput) {
    if (!contentService.isEnabled()) {
      return handlerInput.responseBuilder
        .speak('Die lokale Sammlung ist nicht konfiguriert.')
        .getResponse();
    }
    const labelSlot = handlerInput.requestEnvelope.request.intent.slots?.label;
    let label = labelSlot?.value || null;
    const resolutions = labelSlot?.resolutions?.resolutionsPerAuthority;
    if (resolutions && resolutions[0]?.values?.[0]) {
      label = resolutions[0].values[0].value.name;
    }

    const entries = findNewest(contentService.getIndex().all(), {
      label, limit: 20, uniquePerShow: true,
      newerThanDaysOnly: true,
      pathConfigs: contentService.getConfig().paths,
    });
    if (entries.length === 0) {
      const what = label ? `bei ${label}` : 'in deiner Sammlung';
      return handlerInput.responseBuilder
        .speak(`Ich habe nichts Neues ${what} gefunden.`)
        .getResponse();
    }
    const results = entries.map(toResult);

    const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
    sessionAttributes.mediathekResults = results;
    handlerInput.attributesManager.setSessionAttributes(sessionAttributes);

    const top = results.slice(0, 3);
    const title = label ? `Neu bei ${label}` : 'Neu in deiner Sammlung';
    const speech = `${title}: ${top.map((r, i) => formatResultForSpeech(r, i)).join('. ')}. Welche Nummer?`;
    renderNewsList(handlerInput, [{ title, results }], title);
    return handlerInput.responseBuilder.speak(speech).reprompt('Sage eine Nummer.').withShouldEndSession(false).getResponse();
  },
};

function toResult(entry) {
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

module.exports = ListNewContentHandler;
