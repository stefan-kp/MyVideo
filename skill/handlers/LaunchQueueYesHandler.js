const Alexa = require('ask-sdk-core');
const PlayQueueHandler = require('./PlayQueueHandler');

/**
 * Handles AMAZON.YesIntent when the LaunchHandler just asked
 * "Soll ich abspielen?" (priority='queue' in the adaptive greeting).
 *
 * Delegates to PlayQueueHandler.handle() to actually pop the queue and
 * launch the video. We could also use AddDirective + ExecuteCommands,
 * but the simplest path is just to reuse PlayQueueHandler's logic.
 *
 * NoIntent in the same context (LaunchNoHandler) just confirms and ends
 * the prompt politely without playing.
 */
const LaunchQueueYesHandler = {
  canHandle(handlerInput) {
    if (Alexa.getRequestType(handlerInput.requestEnvelope) !== 'IntentRequest') return false;
    if (Alexa.getIntentName(handlerInput.requestEnvelope) !== 'AMAZON.YesIntent') return false;
    const session = handlerInput.attributesManager.getSessionAttributes();
    return session.pendingAction === 'play_queue';
  },
  async handle(handlerInput) {
    const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
    delete sessionAttributes.pendingAction;
    handlerInput.attributesManager.setSessionAttributes(sessionAttributes);
    return PlayQueueHandler.handle(handlerInput);
  },
};

const LaunchQueueNoHandler = {
  canHandle(handlerInput) {
    if (Alexa.getRequestType(handlerInput.requestEnvelope) !== 'IntentRequest') return false;
    if (Alexa.getIntentName(handlerInput.requestEnvelope) !== 'AMAZON.NoIntent') return false;
    const session = handlerInput.attributesManager.getSessionAttributes();
    return session.pendingAction === 'play_queue';
  },
  handle(handlerInput) {
    const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
    delete sessionAttributes.pendingAction;
    handlerInput.attributesManager.setSessionAttributes(sessionAttributes);
    return handlerInput.responseBuilder
      .speak('Okay. Sage einen Sender oder einen Titel.')
      .reprompt('Was möchtest du sehen?')
      .withShouldEndSession(false)
      .getResponse();
  },
};

module.exports = { LaunchQueueYesHandler, LaunchQueueNoHandler };
