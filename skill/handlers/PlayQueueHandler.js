const Alexa = require('ask-sdk-core');
const queueModule = require('../../lib/queue');
const contentSource = require('../../lib/content/contentSource');

const PlayQueueHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
           Alexa.getIntentName(handlerInput.requestEnvelope) === 'PlayQueueIntent';
  },
  async handle(handlerInput) {
    const queue = queueModule.getInstance();
    const item = queue.pop();
    if (!item) {
      return handlerInput.responseBuilder
        .speak('Deine Queue ist leer. Du kannst ueber das Web-Interface Sachen hinzufuegen.')
        .reprompt('Moechtest du etwas anderes starten?')
        .withShouldEndSession(false)
        .getResponse();
    }

    let url;
    try {
      if (item.source === 'local') {
        const stream = await contentSource.resolveStream(item.contentId);
        url = stream.url;
      } else {
        // mediathek: url already set
        url = item.url;
      }
    } catch (err) {
      console.error('PlayQueue resolveStream error:', err.message);
      return handlerInput.responseBuilder
        .speak(`${item.title} kann nicht gestartet werden. ${err.message}`)
        .getResponse();
    }

    console.log(`PlayQueue: ${item.id} (${item.source}) → ${url}`);
    return handlerInput.responseBuilder
      .speak(`Starte ${item.title}.`)
      .addVideoAppLaunchDirective(url, item.title, item.subtitle || '')
      .getResponse();
  },
};

module.exports = PlayQueueHandler;
