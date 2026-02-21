const Alexa = require('ask-sdk-core');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const STREAM_PATH = '/stream/index.m3u8';

const PlayVideoHandler = {
  canHandle(handlerInput) {
    return (
      Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      (Alexa.getIntentName(handlerInput.requestEnvelope) === 'PlayVideoIntent' ||
       Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.ResumeIntent')
    );
  },
  handle(handlerInput) {
    const streamUrl = `${BASE_URL}${STREAM_PATH}`;
    console.log(`Starte Video-Stream: ${streamUrl}`);

    const { requestEnvelope } = handlerInput;
    const interfaces = requestEnvelope.context.System.device.supportedInterfaces;

    // Primaer: VideoApp.Launch Directive (bester HLS-Support)
    if (interfaces && interfaces['VideoApp']) {
      console.log('Verwende VideoApp.Launch Directive');
      return handlerInput.responseBuilder
        .addVideoAppLaunchDirective(streamUrl, 'MyVideo', 'Live TV Stream')
        .getResponse();
    }

    // Fallback: APL Video Component
    if (interfaces && interfaces['Alexa.Presentation.APL']) {
      console.log('Verwende APL Video Fallback');
      const aplTemplate = require('../apl/VideoTemplate.json');

      return handlerInput.responseBuilder
        .addDirective({
          type: 'Alexa.Presentation.APL.RenderDocument',
          token: 'videoToken',
          document: aplTemplate,
          datasources: {
            videoData: {
              type: 'object',
              properties: {
                videoUrl: streamUrl,
                title: 'MyVideo - Live TV'
              }
            }
          }
        })
        .addDirective({
          type: 'Alexa.Presentation.APL.ExecuteCommands',
          token: 'videoToken',
          commands: [
            {
              type: 'ControlMedia',
              componentId: 'myVideoPlayer',
              command: 'play'
            }
          ]
        })
        .getResponse();
    }

    return handlerInput.responseBuilder
      .speak('Dieses Geraet unterstuetzt leider keine Videowiedergabe.')
      .getResponse();
  }
};

module.exports = PlayVideoHandler;
