const Alexa = require('ask-sdk-core');
const mediathek = require('../../lib/mediathek');
const { formatResultForSpeech } = require('../../lib/speechUtils');
const { renderLaunchScreen } = require('../../lib/aplHelper');
const { getLogoUrlForChannel } = require('../../lib/channels');

const LaunchHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'LaunchRequest';
  },
  async handle(handlerInput) {
    console.log('LaunchRequest empfangen');

    const supportsVideo = hasVideoSupport(handlerInput);
    if (!supportsVideo) {
      const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
      sessionAttributes.pendingAction = 'summary_no_display';
      handlerInput.attributesManager.setSessionAttributes(sessionAttributes);
      return handlerInput.responseBuilder
        .speak('Dieses Geraet hat kein Display fuer Videowiedergabe. Ich kann dir aber eine Nachrichten-Zusammenfassung vorlesen. Moechtest du das?')
        .reprompt('Soll ich dir die Nachrichten-Zusammenfassung vorlesen?')
        .withShouldEndSession(false)
        .getResponse();
    }

    // Kategorisierte Nachrichten laden
    let categorized;
    try {
      categorized = await mediathek.searchCategorizedNews();
    } catch (err) {
      console.error('Launch news search error:', err.message);
      return handlerInput.responseBuilder
        .speak('Die Mediathek ist gerade nicht erreichbar. Sage einen Sendernamen, zum Beispiel: spiele Tagesschau 24, oder spiele 3sat.')
        .reprompt('Welchen Sender moechtest du sehen?')
        .withShouldEndSession(false)
        .getResponse();
    }

    const { sections } = categorized;

    if (!sections || sections.length === 0) {
      return handlerInput.responseBuilder
        .speak('Ich habe gerade keine aktuellen Nachrichten gefunden. Sage einen Sendernamen, zum Beispiel: spiele Tagesschau 24.')
        .reprompt('Welchen Sender moechtest du sehen?')
        .withShouldEndSession(false)
        .getResponse();
    }

    // Alle Ergebnisse flach fuer Session speichern (Index-Zugriff per Touch/Sprache)
    const allResults = sections.flatMap(s => s.results);

    const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
    sessionAttributes.mediathekResults = allResults;
    handlerInput.attributesManager.setSessionAttributes(sessionAttributes);

    // Voice: die ersten 3 Ergebnisse vorlesen
    const spokenResults = allResults.slice(0, 3);
    const lines = spokenResults.map((r, i) => formatResultForSpeech(r, i));
    const moreText = allResults.length > 3 ? ` ${allResults.length - 3} weitere auf dem Display.` : '';
    const speech = `Aktuelle Nachrichten: ${lines.join('. ')}.${moreText} Welche Nummer, oder sage Tagesschau fuer den Livestream.`;

    const orfLogo = getLogoUrlForChannel('ORF');
    renderLaunchScreen(handlerInput, sections, orfLogo);

    return handlerInput.responseBuilder
      .speak(speech)
      .reprompt('Sage eine Nummer oder einen Sender.')
      .withShouldEndSession(false)
      .getResponse();
  }
};

function hasVideoSupport(handlerInput) {
  const { requestEnvelope } = handlerInput;
  const interfaces = requestEnvelope.context.System.device.supportedInterfaces;
  if (interfaces && interfaces['VideoApp']) return true;
  const viewport = requestEnvelope.context.Viewport;
  if (viewport && viewport.video) return true;
  return false;
}

module.exports = LaunchHandler;
