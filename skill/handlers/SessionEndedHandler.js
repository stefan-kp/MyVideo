const Alexa = require('ask-sdk-core');

const SessionEndedHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'SessionEndedRequest';
  },
  handle(handlerInput) {
    const reason = handlerInput.requestEnvelope.request.reason;
    console.log(`Session beendet. Grund: ${reason}`);

    if (reason === 'ERROR') {
      const error = handlerInput.requestEnvelope.request.error;
      console.error('Session Error:', JSON.stringify(error));
    }

    return handlerInput.responseBuilder.getResponse();
  }
};

module.exports = SessionEndedHandler;
