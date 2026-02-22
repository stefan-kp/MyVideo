const Alexa = require('ask-sdk-core');
const channels = require('../../lib/channels');
const { generateStreamToken } = require('../../lib/auth');
const { checkStreamAvailable } = require('../../lib/hlsProxy');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

const PlayChannelHandler = {
  canHandle(handlerInput) {
    return (
      Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === 'PlayChannelIntent'
    );
  },
  async handle(handlerInput) {
    const slot = handlerInput.requestEnvelope.request.intent.slots.channel;

    // Use resolved value (canonical) if available, otherwise raw value
    let channelName = slot.value;
    const resolutions = slot.resolutions?.resolutionsPerAuthority;
    if (resolutions && resolutions[0]?.values?.[0]) {
      channelName = resolutions[0].values[0].value.name;
    }

    console.log(`PlayChannelIntent: raw="${slot.value}", resolved="${channelName}"`);

    const channel = channels.findChannel(channelName);
    if (!channel) {
      return handlerInput.responseBuilder
        .speak(`Ich kenne den Sender ${slot.value} leider nicht. Sage zum Beispiel: spiele ZDF.`)
        .reprompt('Welchen Sender moechtest du sehen?')
        .getResponse();
    }

    // Check if stream is reachable before sending to Alexa
    const check = await checkStreamAvailable(channel.url);
    if (!check.available) {
      console.log(`Stream nicht verfuegbar: ${channel.name} (HTTP ${check.status})`);
      const reason = check.status === 403
        ? 'Der Stream ist gerade geo-blockiert und von diesem Standort nicht verfuegbar.'
        : 'Der Stream ist gerade nicht erreichbar.';
      return handlerInput.responseBuilder
        .speak(`${channel.name} kann leider nicht gestartet werden. ${reason} Moechtest du einen anderen Sender sehen?`)
        .reprompt('Welchen Sender moechtest du sehen?')
        .withShouldEndSession(false)
        .getResponse();
    }

    const token = generateStreamToken(channel.id);
    const streamUrl = `${BASE_URL}/proxy/live/${channel.id}/master.m3u8?token=${token}`;

    console.log(`Starte Sender: ${channel.name} (${channel.group}) -> ${streamUrl}`);

    return handlerInput.responseBuilder
      .speak(`Starte ${channel.name}.`)
      .addVideoAppLaunchDirective(streamUrl, channel.name, `${channel.group} - ${channel.name}`)
      .getResponse();
  }
};

module.exports = PlayChannelHandler;
