const Alexa = require('ask-sdk-core');

const StopHandler = {
  canHandle(handlerInput) {
    return (
      Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      (Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.StopIntent' ||
       Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.CancelIntent' ||
       Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.PauseIntent')
    );
  },
  handle(handlerInput) {
    console.log('Stop/Pause Intent empfangen');
    return handlerInput.responseBuilder
      .speak('Video gestoppt. Bis zum naechsten Mal!')
      .withShouldEndSession(true)
      .getResponse();
  }
};

module.exports = StopHandler;
