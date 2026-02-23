const Alexa = require('ask-sdk-core');
const { generateStreamToken } = require('../../lib/auth');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

const NextChapterHandler = {
  canHandle(handlerInput) {
    return (
      Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      (Alexa.getIntentName(handlerInput.requestEnvelope) === 'NextChapterIntent' ||
       Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.NextIntent')
    );
  },
  handle(handlerInput) {
    const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
    const segments = sessionAttributes.currentSegments;

    if (!segments || segments.length === 0) {
      return handlerInput.responseBuilder
        .speak('Diese Sendung hat keine Kapitel.')
        .reprompt('Was moechtest du sehen?')
        .withShouldEndSession(false)
        .getResponse();
    }

    let index = (sessionAttributes.currentSegmentIndex || 0) + 1;

    if (index >= segments.length) {
      return handlerInput.responseBuilder
        .speak('Das war das letzte Kapitel.')
        .reprompt('Was moechtest du als naechstes sehen?')
        .withShouldEndSession(false)
        .getResponse();
    }

    sessionAttributes.currentSegmentIndex = index;
    handlerInput.attributesManager.setSessionAttributes(sessionAttributes);

    const segment = segments[index];
    const token = generateStreamToken('mediathek');
    const streamUrl = `${BASE_URL}/proxy/mediathek?url=${encodeURIComponent(segment.url)}&token=${token}`;

    console.log(`Naechstes Kapitel [${index + 1}/${segments.length}]: ${segment.title} -> ${streamUrl}`);

    return handlerInput.responseBuilder
      .speak(`Kapitel ${index + 1}: ${segment.title}.`)
      .addVideoAppLaunchDirective(streamUrl, segment.title, `Kapitel ${index + 1} von ${segments.length}`)
      .getResponse();
  }
};

const PreviousChapterHandler = {
  canHandle(handlerInput) {
    return (
      Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      (Alexa.getIntentName(handlerInput.requestEnvelope) === 'PreviousChapterIntent' ||
       Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.PreviousIntent')
    );
  },
  handle(handlerInput) {
    const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
    const segments = sessionAttributes.currentSegments;

    if (!segments || segments.length === 0) {
      return handlerInput.responseBuilder
        .speak('Diese Sendung hat keine Kapitel.')
        .reprompt('Was moechtest du sehen?')
        .withShouldEndSession(false)
        .getResponse();
    }

    let index = (sessionAttributes.currentSegmentIndex || 0) - 1;

    if (index < 0) {
      return handlerInput.responseBuilder
        .speak('Du bist beim ersten Kapitel.')
        .reprompt('Was moechtest du als naechstes sehen?')
        .withShouldEndSession(false)
        .getResponse();
    }

    sessionAttributes.currentSegmentIndex = index;
    handlerInput.attributesManager.setSessionAttributes(sessionAttributes);

    const segment = segments[index];
    const token = generateStreamToken('mediathek');
    const streamUrl = `${BASE_URL}/proxy/mediathek?url=${encodeURIComponent(segment.url)}&token=${token}`;

    console.log(`Vorheriges Kapitel [${index + 1}/${segments.length}]: ${segment.title} -> ${streamUrl}`);

    return handlerInput.responseBuilder
      .speak(`Kapitel ${index + 1}: ${segment.title}.`)
      .addVideoAppLaunchDirective(streamUrl, segment.title, `Kapitel ${index + 1} von ${segments.length}`)
      .getResponse();
  }
};

module.exports = { NextChapterHandler, PreviousChapterHandler };
