const Alexa = require('ask-sdk-core');
const channels = require('../../lib/channels');
const { generateStreamToken } = require('../../lib/auth');
const { checkStreamAvailable } = require('../../lib/hlsProxy');
const { searchCategory } = require('../../lib/mediathek');
const { formatResultForSpeech } = require('../../lib/speechUtils');
const { renderNewsList } = require('../../lib/aplHelper');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';


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

  const check = await checkStreamAvailable(channel.url);
  if (!check.available) {
    console.log(`Touch selectChannel: ${channel.name} nicht verfuegbar (HTTP ${check.status})`);
    const reason = check.status === 403
      ? 'Der Stream ist gerade geo-blockiert.'
      : 'Der Stream ist gerade nicht erreichbar.';
    return handlerInput.responseBuilder
      .speak(`${channel.name} kann nicht gestartet werden. ${reason}`)
      .reprompt('Welchen Sender moechtest du sehen?')
      .withShouldEndSession(false)
      .getResponse();
  }

  const token = generateStreamToken(channel.id);
  const streamUrl = `${BASE_URL}/proxy/live/${channel.id}/master.m3u8?token=${token}`;

  console.log(`Touch selectChannel: ${channel.name} -> ${streamUrl}`);

  return handlerInput.responseBuilder
    .speak(`Starte ${channel.name}.`)
    .addVideoAppLaunchDirective(streamUrl, channel.name, `${channel.group} - ${channel.name}`)
    .getResponse();
}

const REGION = (process.env.REGION || 'AT').toUpperCase();
const CATEGORY_MAP = {
  nachrichten: REGION === 'DE' ? 'Nachrichten DE' : 'Nachrichten AT',
  sport: 'Sport',
  kultur: 'Kultur',
  comedy: 'Comedy',
};

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

  renderNewsList(handlerInput, data.sections, categoryTitle);

  return handlerInput.responseBuilder
    .speak(speech)
    .reprompt('Sage eine Nummer.')
    .withShouldEndSession(false)
    .getResponse();
}

module.exports = TouchEventHandler;
