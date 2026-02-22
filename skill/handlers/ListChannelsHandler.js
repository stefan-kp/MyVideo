const Alexa = require('ask-sdk-core');
const channels = require('../../lib/channels');
const { renderChannelList } = require('../../lib/aplHelper');

const ListChannelsHandler = {
  canHandle(handlerInput) {
    return (
      Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === 'ListChannelsIntent'
    );
  },
  handle(handlerInput) {
    const grouped = channels.listChannels();
    const parts = [];

    for (const [group, chList] of Object.entries(grouped)) {
      const names = chList.map(ch => ch.name).join(', ');
      parts.push(`${group}: ${names}`);
    }

    const speech = `Folgende Sender sind verfuegbar. ${parts.join('. ')}. Welchen Sender moechtest du sehen?`;

    renderChannelList(handlerInput, grouped);

    return handlerInput.responseBuilder
      .speak(speech)
      .reprompt('Sage zum Beispiel: spiele ZDF.')
      .withShouldEndSession(false)
      .getResponse();
  }
};

module.exports = ListChannelsHandler;
