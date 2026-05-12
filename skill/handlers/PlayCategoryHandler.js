const Alexa = require('ask-sdk-core');
const { searchCategory, CATEGORY_SLOT_MAP } = require('../../lib/mediathek');
const { formatResultForSpeech } = require('../../lib/speechUtils');
const { renderNewsList } = require('../../lib/aplHelper');
const channels = require('../../lib/channels');

const CATEGORY_QUICK_LIVE = {
  'Sport': 'orfSport',
  'Kultur': 'orf3',
};

function buildQuickAction(categoryTitle) {
  const channelId = CATEGORY_QUICK_LIVE[categoryTitle];
  if (!channelId) return null;
  const ch = channels.findChannelById(channelId);
  if (!ch) return null;
  return { id: ch.id, name: ch.displayName, logo: ch.logoUrl };
}

const PlayCategoryHandler = {
  canHandle(handlerInput) {
    return (
      Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === 'PlayCategoryIntent'
    );
  },
  async handle(handlerInput) {
    const slot = handlerInput.requestEnvelope.request.intent.slots?.category;
    let categoryValue = slot?.value;

    // Resolve canonical value
    const resolutions = slot?.resolutions?.resolutionsPerAuthority;
    if (resolutions && resolutions[0]?.values?.[0]) {
      categoryValue = resolutions[0].values[0].value.name;
    }

    console.log(`PlayCategoryIntent: category="${categoryValue || 'keine'}"`);

    if (!categoryValue) {
      return handlerInput.responseBuilder
        .speak('Welche Kategorie moechtest du sehen? Sage zum Beispiel Nachrichten Oesterreich oder Sport.')
        .reprompt('Sage eine Kategorie wie Sport oder Kultur.')
        .withShouldEndSession(false)
        .getResponse();
    }

    // Map slot value to internal category title
    const categoryTitle = CATEGORY_SLOT_MAP[categoryValue.toLowerCase()];
    if (!categoryTitle) {
      return handlerInput.responseBuilder
        .speak(`Die Kategorie ${categoryValue} kenne ich leider nicht. Verfuegbar sind Nachrichten Oesterreich, Nachrichten Deutschland, Sport und Kultur.`)
        .reprompt('Sage eine Kategorie.')
        .withShouldEndSession(false)
        .getResponse();
    }

    let data;
    try {
      data = await searchCategory(categoryTitle);
    } catch (err) {
      console.error('Category search error:', err.message);
      return handlerInput.responseBuilder
        .speak('Die Mediathek ist gerade nicht erreichbar. Versuche es spaeter erneut.')
        .getResponse();
    }

    if (!data.sections.length || !data.sections[0].results.length) {
      return handlerInput.responseBuilder
        .speak(`Ich habe gerade keine Ergebnisse fuer ${categoryValue} gefunden.`)
        .reprompt('Moechtest du etwas anderes suchen?')
        .withShouldEndSession(false)
        .getResponse();
    }

    const results = data.sections[0].results;
    const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
    sessionAttributes.mediathekResults = results;
    handlerInput.attributesManager.setSessionAttributes(sessionAttributes);

    const quickAction = buildQuickAction(categoryTitle);
    const lines = results.map((r, i) => formatResultForSpeech(r, i));
    let speech = `${lines.join('. ')}. Welche Nummer?`;
    if (quickAction) {
      speech = `${lines.join('. ')}. Welche Nummer, oder sage ${quickAction.name} fuer den Livestream?`;
    }

    renderNewsList(handlerInput, data.sections, categoryValue, quickAction);

    return handlerInput.responseBuilder
      .speak(speech)
      .reprompt('Sage eine Nummer.')
      .withShouldEndSession(false)
      .getResponse();
  }
};

module.exports = PlayCategoryHandler;
