const Alexa = require('ask-sdk-core');
const channels = require('../../lib/channels');
const { friendlyErrorMessage } = require('../../lib/streamErrorMessage');
const { searchCategory } = require('../../lib/mediathek');
const { formatResultForSpeech } = require('../../lib/speechUtils');
const { renderNewsList } = require('../../lib/aplHelper');


const TouchEventHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'Alexa.Presentation.APL.UserEvent';
  },
  async handle(handlerInput) {
    const args = handlerInput.requestEnvelope.request.arguments || [];
    const action = args[0];

    if (action === 'selectResult') {
      return handleSelectResult(handlerInput, parseInt(args[1], 10));
    }

    if (action === 'selectChannel') {
      return handleSelectChannel(handlerInput, args[1]);
    }

    if (action === 'selectCategory') {
      return handleSelectCategory(handlerInput, args[1]);
    }

    console.log('TouchEvent: unbekannte Aktion', args);
    return handlerInput.responseBuilder
      .speak('Das habe ich nicht verstanden.')
      .getResponse();
  }
};

async function handleSelectResult(handlerInput, index) {
  const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
  const results = sessionAttributes.mediathekResults;

  if (!results || results.length === 0) {
    return handlerInput.responseBuilder
      .speak('Es sind keine Ergebnisse vorhanden. Suche zuerst in der Mediathek.')
      .getResponse();
  }

  if (isNaN(index) || index < 0 || index >= results.length) {
    return handlerInput.responseBuilder
      .speak('Ungueltiger Eintrag.')
      .getResponse();
  }

  const result = results[index];

  if (result.segments && result.segments.length > 0) {
    sessionAttributes.currentSegments = result.segments;
    sessionAttributes.currentSegmentIndex = 0;
    handlerInput.attributesManager.setSessionAttributes(sessionAttributes);
  }

  console.log(`Touch selectResult[${index}]: ${result.title} -> ${result.url}`);

  return handlerInput.responseBuilder
    .speak(`Starte ${result.title}.`)
    .addVideoAppLaunchDirective(result.url, result.title, `${result.channel} - ${result.topic}`)
    .getResponse();
}

async function handleSelectChannel(handlerInput, channelId) {
  const channel = channels.findChannelById(channelId);

  if (!channel) {
    return handlerInput.responseBuilder
      .speak('Sender nicht gefunden.')
      .getResponse();
  }

  let stream;
  try {
    stream = await channel.resolveStream();
  } catch (err) {
    const reason = friendlyErrorMessage(err);
    console.log(`Touch selectChannel: ${channel.displayName} nicht verfuegbar - ${err && err.message ? err.message : err}`);
    return handlerInput.responseBuilder
      .speak(`${channel.displayName} kann nicht gestartet werden. ${reason}`)
      .reprompt('Welchen Sender moechtest du sehen?')
      .withShouldEndSession(false)
      .getResponse();
  }

  console.log(`Touch selectChannel: ${channel.displayName} -> ${stream.url}`);

  return handlerInput.responseBuilder
    .speak(`Starte ${channel.displayName}.`)
    .addVideoAppLaunchDirective(stream.url, channel.displayName, `${channel.group} - ${channel.displayName}`)
    .getResponse();
}

const REGION = (process.env.REGION || 'AT').toUpperCase();
const CATEGORY_MAP = {
  nachrichten: REGION === 'DE' ? 'Nachrichten DE' : 'Nachrichten AT',
  sport: 'Sport',
  kultur: 'Kultur',
  comedy: 'Comedy',
};

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

async function handleSelectCategory(handlerInput, categoryId) {
  const categoryTitle = CATEGORY_MAP[categoryId];
  if (!categoryTitle) {
    return handlerInput.responseBuilder
      .speak('Kategorie nicht gefunden.')
      .getResponse();
  }

  console.log(`Touch selectCategory: ${categoryId} -> ${categoryTitle}`);

  let data;
  try {
    data = await searchCategory(categoryTitle);
  } catch (err) {
    console.error('Category touch search error:', err.message);
    return handlerInput.responseBuilder
      .speak('Die Mediathek ist gerade nicht erreichbar.')
      .getResponse();
  }

  if (!data.sections.length || !data.sections[0].results.length) {
    return handlerInput.responseBuilder
      .speak(`Keine Ergebnisse fuer ${categoryTitle} gefunden.`)
      .reprompt('Moechtest du etwas anderes suchen?')
      .withShouldEndSession(false)
      .getResponse();
  }

  const results = data.sections[0].results;
  const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
  sessionAttributes.mediathekResults = results;
  handlerInput.attributesManager.setSessionAttributes(sessionAttributes);

  const lines = results.map((r, i) => formatResultForSpeech(r, i));
  const speech = `${lines.join('. ')}. Welche Nummer?`;

  const quickAction = buildQuickAction(categoryTitle);
  renderNewsList(handlerInput, data.sections, categoryTitle, quickAction);

  return handlerInput.responseBuilder
    .speak(speech)
    .reprompt('Sage eine Nummer.')
    .withShouldEndSession(false)
    .getResponse();
}

module.exports = TouchEventHandler;
