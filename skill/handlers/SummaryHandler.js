const Alexa = require('ask-sdk-core');
const { searchCategorizedNews } = require('../../lib/mediathek');
const { fetchSubtitlesForResults } = require('../../lib/subtitleService');
const { isAvailable, generateSummary } = require('../../lib/openRouterService');
const { renderSummary } = require('../../lib/aplHelper');

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

    let sections;
    try {
      const data = await searchCategorizedNews();
      sections = data.sections;
    } catch (err) {
      console.error('Summary: Fehler beim Laden der Nachrichten:', err.message);
      return handlerInput.responseBuilder
        .speak('Die Nachrichten konnten nicht geladen werden. Bitte versuche es spaeter erneut.')
        .withShouldEndSession(true)
        .getResponse();
    }

    // Nur erste Kategorie (Nachrichten AT/DE) nehmen
    const newsSection = sections[0];
    if (!newsSection) {
      return handlerInput.responseBuilder
        .speak('Es sind gerade keine Nachrichten verfuegbar.')
        .withShouldEndSession(true)
        .getResponse();
    }

    // Nur Ergebnisse mit Untertiteln
    const resultsWithSubs = newsSection.results.filter(r => r.urlSubtitle);
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

    const sources = subtitleTexts.map(s => ({ title: s.title, channel: s.channel }));

    renderSummary(handlerInput, summary, sources);

    return handlerInput.responseBuilder
      .speak(summary)
      .withShouldEndSession(true)
      .getResponse();
  }
};

module.exports = SummaryHandler;
