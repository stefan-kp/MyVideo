const Alexa = require('ask-sdk-core');
const { searchTodaysNews } = require('../../lib/mediathek');
const { fetchSubtitlesForResults } = require('../../lib/subtitleService');
const { isAvailable, generateSummary } = require('../../lib/openRouterService');
const { renderSummary, markdownToAplMarkup, stripMarkdown } = require('../../lib/aplHelper');
const { getLogoUrlForChannel } = require('../../lib/channels');

const SummaryHandler = {
  canHandle(handlerInput) {
    return (
      Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === 'SummaryIntent'
    );
  },
  async handle(handlerInput) {
    if (!isAvailable()) {
      return handlerInput.responseBuilder
        .speak('Fuer die Zusammenfassung wird ein AI-Service benoetigt. Bitte konfiguriere OPENROUTER_API_KEY.')
        .withShouldEndSession(true)
        .getResponse();
    }

    console.log('SummaryIntent: Lade Nachrichten und erstelle Zusammenfassung...');

    // Progressive Response: sofortiger Wartehinweis
    try {
      await handlerInput.serviceClientFactory
        .getDirectiveServiceClient()
        .enqueue({
          header: { requestId: handlerInput.requestEnvelope.request.requestId },
          directive: {
            type: 'VoicePlayer.Speak',
            speech: 'Ich lade die aktuellen Nachrichten und erstelle eine Zusammenfassung. Einen Moment bitte.'
          }
        });
    } catch (err) {
      console.log('Progressive response nicht moeglich:', err.message);
    }

    let todaysResults;
    try {
      todaysResults = await searchTodaysNews();
    } catch (err) {
      console.error('Summary: Fehler beim Laden der Nachrichten:', err.message);
      return handlerInput.responseBuilder
        .speak('Die Nachrichten konnten nicht geladen werden. Bitte versuche es spaeter erneut.')
        .withShouldEndSession(true)
        .getResponse();
    }

    if (todaysResults.length === 0) {
      return handlerInput.responseBuilder
        .speak('Es sind fuer heute noch keine Nachrichten verfuegbar.')
        .withShouldEndSession(true)
        .getResponse();
    }

    // Nur Ergebnisse mit Untertiteln
    const resultsWithSubs = todaysResults.filter(r => r.urlSubtitle);
    if (resultsWithSubs.length === 0) {
      return handlerInput.responseBuilder
        .speak('Leider sind keine Untertitel verfuegbar. Ohne Untertitel kann keine Zusammenfassung erstellt werden.')
        .withShouldEndSession(true)
        .getResponse();
    }

    let subtitleTexts;
    try {
      subtitleTexts = await fetchSubtitlesForResults(resultsWithSubs);
    } catch (err) {
      console.error('Summary: Fehler beim Laden der Untertitel:', err.message);
      return handlerInput.responseBuilder
        .speak('Die Untertitel konnten nicht geladen werden. Bitte versuche es spaeter erneut.')
        .withShouldEndSession(true)
        .getResponse();
    }

    if (subtitleTexts.length === 0) {
      return handlerInput.responseBuilder
        .speak('Leider sind keine Untertitel verfuegbar. Ohne Untertitel kann keine Zusammenfassung erstellt werden.')
        .withShouldEndSession(true)
        .getResponse();
    }

    let summary;
    try {
      summary = await generateSummary(subtitleTexts);
    } catch (err) {
      console.error('Summary: Fehler bei der AI-Zusammenfassung:', err.message);
      return handlerInput.responseBuilder
        .speak('Die Zusammenfassung konnte nicht erstellt werden. Bitte versuche es spaeter erneut.')
        .withShouldEndSession(true)
        .getResponse();
    }

    const speechText = stripMarkdown(summary);
    const displayMarkup = markdownToAplMarkup(summary);
    const sources = subtitleTexts.map(s => ({ title: s.title, channel: s.channel, logo: getLogoUrlForChannel(s.channel) }));

    renderSummary(handlerInput, displayMarkup, sources);

    return handlerInput.responseBuilder
      .speak(speechText)
      .withShouldEndSession(true)
      .getResponse();
  }
};

module.exports = SummaryHandler;
