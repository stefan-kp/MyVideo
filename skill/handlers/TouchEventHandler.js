const Alexa = require('ask-sdk-core');
const channels = require('../../lib/channels');
const { generateStreamToken } = require('../../lib/auth');
const { checkStreamAvailable } = require('../../lib/hlsProxy');

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
  const token = generateStreamToken('mediathek');
  const streamUrl = `${BASE_URL}/proxy/mediathek?url=${encodeURIComponent(result.url)}&token=${token}`;

  console.log(`Touch selectResult[${index}]: ${result.title} -> ${streamUrl}`);

  return handlerInput.responseBuilder
    .speak(`Starte ${result.title}.`)
    .addVideoAppLaunchDirective(streamUrl, result.title, `${result.channel} - ${result.topic}`)
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

module.exports = TouchEventHandler;
