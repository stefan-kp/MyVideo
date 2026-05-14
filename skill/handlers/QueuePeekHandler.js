const Alexa = require('ask-sdk-core');
const queueModule = require('../../lib/queue');
const { renderNewsList } = require('../../lib/aplHelper');

const QueuePeekHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
           Alexa.getIntentName(handlerInput.requestEnvelope) === 'QueuePeekIntent';
  },
  handle(handlerInput) {
    const queue = queueModule.getInstance();
    const items = queue.peek(10);
    if (items.length === 0) {
      return handlerInput.responseBuilder
        .speak('Deine Queue ist leer. Du kannst ueber das Web-Interface Sachen hinzufuegen.')
        .withShouldEndSession(false)
        .getResponse();
    }
    const top3 = items.slice(0, 3);
    const spoken = top3.map((it, i) => `${i + 1}: ${it.title}`).join('. ');
    const moreText = items.length > 3 ? ` ${items.length - 3} weitere in der Queue.` : '';
    const speech = `In deiner Queue: ${spoken}.${moreText} Sage "spiele meine Queue" zum Starten.`;

    // Render full list on display
    const results = items.map(it => ({
      title: it.title,
      topic: it.subtitle || (it.source === 'local' ? 'Lokal' : 'Mediathek'),
      channel: it.subtitle || '',
      duration: it.duration || 0,
      timestamp: Math.floor(new Date(it.addedAt).getTime() / 1000),
      imageUrl: it.imageUrl || '',
      url: it.url || null,
      source: it.source,
      id: it.id,
    }));
    renderNewsList(handlerInput, [{ title: 'Deine Queue', results }], 'Deine Queue');
    return handlerInput.responseBuilder
      .speak(speech)
      .reprompt('Sage "spiele meine Queue" zum Starten.')
      .withShouldEndSession(false)
      .getResponse();
  },
};

module.exports = QueuePeekHandler;
