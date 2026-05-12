const Alexa = require('ask-sdk-core');
const channels = require('../../lib/channels');
const { friendlyErrorMessage } = require('../../lib/streamErrorMessage');

const PlayChannelHandler = {
  canHandle(handlerInput) {
    return (
      Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === 'PlayChannelIntent'
    );
  },
  async handle(handlerInput) {
    const slot = handlerInput.requestEnvelope.request.intent.slots.channel;
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

    let stream;
    try {
      stream = await channel.resolveStream();
    } catch (err) {
      const reason = friendlyErrorMessage(err);
      console.log(`Stream nicht verfuegbar: ${channel.displayName} - ${err && err.message ? err.message : err}`);
      return handlerInput.responseBuilder
        .speak(`${channel.displayName} kann leider nicht gestartet werden. ${reason} Moechtest du einen anderen Sender sehen?`)
        .reprompt('Welchen Sender moechtest du sehen?')
        .withShouldEndSession(false)
        .getResponse();
    }

    console.log(`Starte Sender: ${channel.displayName} (${channel.group}) -> ${stream.url}`);

    return handlerInput.responseBuilder
      .speak(`Starte ${channel.displayName}.`)
      .addVideoAppLaunchDirective(stream.url, channel.displayName, `${channel.group} - ${channel.displayName}`)
      .getResponse();
  }
};

module.exports = PlayChannelHandler;
