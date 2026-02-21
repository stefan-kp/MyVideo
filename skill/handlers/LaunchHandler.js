const Alexa = require('ask-sdk-core');
const PlayVideoHandler = require('./PlayVideoHandler');

const LaunchHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'LaunchRequest';
  },
  handle(handlerInput) {
    console.log('LaunchRequest empfangen');

    // Pruefen ob das Geraet Video unterstuetzt
    const supportsVideo = hasVideoSupport(handlerInput);

    if (!supportsVideo) {
      return handlerInput.responseBuilder
        .speak('Dieses Geraet unterstuetzt leider keine Videowiedergabe. Du brauchst einen Echo Show.')
        .getResponse();
    }

    // Direkt Video starten
    return PlayVideoHandler.handle(handlerInput);
  }
};

function hasVideoSupport(handlerInput) {
  const { requestEnvelope } = handlerInput;

  // Methode 1: VideoApp Interface pruefen
  const interfaces = requestEnvelope.context.System.device.supportedInterfaces;
  if (interfaces && interfaces['VideoApp']) {
    return true;
  }

  // Methode 2: APL Viewport Video pruefen
  const viewport = requestEnvelope.context.Viewport;
  if (viewport && viewport.video) {
    return true;
  }

  return false;
}

module.exports = LaunchHandler;
