const Alexa = require('ask-sdk-core');
const channels = require('../../lib/channels');
const { friendlyErrorMessage } = require('../../lib/streamErrorMessage');
const { searchCategory } = require('../../lib/mediathek');
const { formatResultForSpeech } = require('../../lib/speechUtils');
const { renderNewsList, renderChannelList } = require('../../lib/aplHelper');


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

    if (action === 'selectContent') {
      return handleSelectContent(handlerInput, args[1]);
    }

    if (action === 'selectQueueItem') {
      return handleSelectQueueItem(handlerInput, args[1]);
    }

    if (action === 'showAllChannels') {
      return handleShowAllChannels(handlerInput);
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

async function handleSelectContent(handlerInput, contentId) {
  const contentService = require('../../lib/content/service');
  const contentSource = require('../../lib/content/contentSource');
  if (!contentService.isEnabled()) {
    return handlerInput.responseBuilder.speak('Sammlung nicht konfiguriert.').getResponse();
  }
  const entry = contentService.getIndex().findById(contentId);
  if (!entry) {
    return handlerInput.responseBuilder.speak('Eintrag nicht gefunden.').getResponse();
  }
  let stream;
  try {
    stream = await contentSource.resolveStream(contentId);
  } catch (err) {
    console.error('Touch selectContent error:', err.message);
    return handlerInput.responseBuilder
      .speak(`${entry.title} kann nicht gestartet werden. ${err.message}`)
      .getResponse();
  }
  const spoken = entry.type === 'episode'
    ? `${entry.show} Staffel ${entry.season} Folge ${entry.episode}`
    : entry.title;
  console.log(`Touch selectContent: ${entry.id} → ${stream.url}`);
  return handlerInput.responseBuilder
    .speak(`Starte ${spoken}.`)
    .addVideoAppLaunchDirective(stream.url, entry.title || spoken, entry.show || entry.pathLabel)
    .getResponse();
}

async function handleSelectQueueItem(handlerInput, queueItemId) {
  const queueModule = require('../../lib/queue');
  const contentSource = require('../../lib/content/contentSource');
  const queue = queueModule.getInstance();

  // Find + remove the specific item (not necessarily the head)
  const item = queue.list().find(i => i.id === queueItemId);
  if (!item) {
    return handlerInput.responseBuilder.speak('Eintrag nicht in der Queue gefunden.').getResponse();
  }
  queue.remove(queueItemId);

  let url;
  try {
    if (item.source === 'local') {
      const stream = await contentSource.resolveStream(item.contentId);
      url = stream.url;
    } else {
      url = item.url;
    }
  } catch (err) {
    console.error('Touch selectQueueItem error:', err.message);
    return handlerInput.responseBuilder
      .speak(`${item.title} kann nicht gestartet werden. ${err.message}`)
      .getResponse();
  }
  console.log(`Touch selectQueueItem: ${item.id} (${item.source}) → ${url}`);
  return handlerInput.responseBuilder
    .speak(`Starte ${item.title}.`)
    .addVideoAppLaunchDirective(url, item.title, item.subtitle || '')
    .getResponse();
}

function handleShowAllChannels(handlerInput) {
  const grouped = channels.listChannels();
  renderChannelList(handlerInput, grouped);
  return handlerInput.responseBuilder
    .speak('Hier sind alle Sender. Tippe auf einen oder sage seinen Namen.')
    .reprompt('Welchen Sender möchtest du?')
    .withShouldEndSession(false)
    .getResponse();
}

module.exports = TouchEventHandler;
