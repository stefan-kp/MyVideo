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

    // Live-TV-Quickbar: erste 8 wichtigste Sender
    const QUICKBAR_IDS = ['orf1', 'orf2t', 'orf3', 'servustv', 'atv', 'pro7at', 'dasErsteHd', 'zdfHd'];
    const liveTVChannels = QUICKBAR_IDS
      .map(id => {
        const ch = require('../../lib/channels').findChannelById(id);
        if (!ch) return null;
        return { id: ch.id, name: ch.displayName, logo: ch.logoUrl };
      })
      .filter(Boolean);

    // Recent content for homepage row (smart-mix: 1 per show, newest 6)
    let recentContent = [];
    try {
      const contentService = require('../../lib/content/service');
      if (contentService.isEnabled()) {
        const { findNewest } = require('../../lib/content/search');
        const newest = findNewest(contentService.getIndex().all(), {
          limit: 6, uniquePerShow: true, newerThanDaysOnly: true,
          pathConfigs: contentService.getConfig().paths,
        });
        recentContent = newest.map(e => ({
          id: e.id,
          label: e.pathLabel,
          title: e.type === 'episode'
            ? `${e.show} S${String(e.season || 0).padStart(2, '0')}E${String(e.episode || 0).padStart(2, '0')}`
            : (e.title || e.filename),
        }));
      }
    } catch (err) {
      console.warn('LaunchHandler: recentContent build failed:', err.message);
    }

    renderLaunchScreen(handlerInput, sections, orfLogo, liveTVChannels, recentContent);

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
