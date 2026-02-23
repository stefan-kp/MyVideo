const Alexa = require('ask-sdk-core');
const { isAvailable } = require('../../lib/openRouterService');
const { hasAPLSupport, renderSummary, renderSummaryLoading, markdownToAplMarkup, stripMarkdown, escapeForSsml, truncateForSsml } = require('../../lib/aplHelper');
const { getLogoUrlForChannel } = require('../../lib/channels');
const { debug, debugJson, debugTruncated } = require('../../lib/debug');
const summaryCache = require('../../lib/summaryCache');

// Internes Timeout: wie lange wir auf die Berechnung warten bevor wir nachfragen
const WAIT_TIMEOUT_MS = 7000;

function deliverSummary(handlerInput, cached, speechOnly) {
  const { summary, subtitleTexts } = cached;
  // summary ist { short, detail } vom LLM
  const detailText = summary.detail || '';
  const shortText = summary.short || '';
  const displayMarkup = markdownToAplMarkup(detailText);
  const sources = subtitleTexts.map(s => ({
    title: s.title, channel: s.channel, logo: getLogoUrlForChannel(s.channel),
  }));

  const aplSupported = hasAPLSupport(handlerInput);
  debug(`deliverSummary: APL-Support=${aplSupported}, speechOnly=${!!speechOnly}`);

  // Auf Display-Geraeten: Kurzzusammenfassung vorlesen + Detail auf APL
  // Ohne Display: Detail-Zusammenfassung komplett vorlesen
  let speechText;
  if (aplSupported && !speechOnly) {
    renderSummary(handlerInput, displayMarkup, sources);
    speechText = shortText
      ? truncateForSsml(escapeForSsml(shortText))
      : 'Hier ist die Zusammenfassung.';
  } else {
    speechText = truncateForSsml(stripMarkdown(detailText));
  }

  debug(`speechText Laenge: ${speechText.length} Zeichen`);
  debugTruncated('displayMarkup', displayMarkup, 500);

  const response = handlerInput.responseBuilder
    .speak(speechText)
    .withShouldEndSession(false)
    .getResponse();

  const hasDirective = response.directives && response.directives.length > 0;
  const responseSize = Buffer.byteLength(JSON.stringify(response), 'utf8');
  debug(`deliverSummary: Response ${responseSize} bytes, Directives: ${hasDirective ? response.directives.length : 0}`);
  if (hasDirective) {
    for (const d of response.directives) {
      debug(`  Directive type=${d.type}, token=${d.token}, hasDocument=${!!d.document}, hasDatasources=${!!d.datasources}`);
    }
  }
  debug(`deliverSummary: shouldEndSession=${response.shouldEndSession}`);

  return response;
}

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

    const startTime = Date.now();
    const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();

    // Geraet ohne Display?
    if (!hasAPLSupport(handlerInput)) {
      debug('SummaryIntent: Kein Display-Geraet');
      sessionAttributes.pendingAction = 'summary_no_display';
      handlerInput.attributesManager.setSessionAttributes(sessionAttributes);
      return handlerInput.responseBuilder
        .speak('Dein Geraet hat leider kein Display fuer die Zusammenfassung. Ich kann dir die Nachrichten aber vorlesen. Moechtest du das?')
        .reprompt('Soll ich dir die Nachrichten-Zusammenfassung vorlesen?')
        .withShouldEndSession(false)
        .getResponse();
    }

    console.log('SummaryIntent: Pruefe Cache...');

    // 1. Cache-Hit: sofort ausliefern
    const cached = summaryCache.get();
    if (cached) {
      const ageMinutes = Math.round((Date.now() - cached.timestamp) / 60000);
      debug(`SummaryIntent: Cache-Hit (${ageMinutes} Min alt)`);
      return deliverSummary(handlerInput, cached);
    }

    // 2. Cache-Miss: Berechnung starten und warten
    debug('SummaryIntent: Kein Cache, starte Berechnung...');

    // Progressive Response
    try {
      await handlerInput.serviceClientFactory
        .getDirectiveServiceClient()
        .enqueue({
          header: { requestId: handlerInput.requestEnvelope.request.requestId },
          directive: {
            type: 'VoicePlayer.Speak',
            speech: 'Ich erstelle die Zusammenfassung. Einen Moment bitte.',
          },
        });
    } catch (err) {
      debug('Progressive response nicht moeglich:', err.message);
    }

    // Berechnung im Hintergrund starten (falls nicht schon laeuft)
    if (!summaryCache.isRefreshing()) {
      summaryCache.refresh().catch(err => {
        console.error('SummaryCache refresh Fehler:', err.message);
      });
    }

    // Warten bis Timeout oder Cache fertig
    const result = await waitForCache(WAIT_TIMEOUT_MS);

    if (result) {
      debug(`SummaryIntent: Berechnung fertig in ${Date.now() - startTime}ms`);
      return deliverSummary(handlerInput, result);
    }

    // 3. Timeout: Lade-Bildschirm anzeigen und User fragen
    debug(`SummaryIntent: Timeout nach ${Date.now() - startTime}ms, frage nach`);
    sessionAttributes.pendingAction = 'summary_wait';
    handlerInput.attributesManager.setSessionAttributes(sessionAttributes);

    renderSummaryLoading(handlerInput, 'Zusammenfassung wird erstellt...');

    return handlerInput.responseBuilder
      .speak('Die Zusammenfassung wird gerade erstellt. Moechtest du darauf warten?')
      .reprompt('Soll ich die Zusammenfassung fertig erstellen? Sage ja oder nein.')
      .withShouldEndSession(false)
      .getResponse();
  },
};

async function waitForCache(timeoutMs) {
  const start = Date.now();
  const interval = 200;
  while (Date.now() - start < timeoutMs) {
    const cached = summaryCache.get();
    if (cached) return cached;
    await new Promise(resolve => setTimeout(resolve, interval));
  }
  return null;
}

// Handler fuer AMAZON.YesIntent - reagiert auf Summary-Kontext
const SummaryYesHandler = {
  canHandle(handlerInput) {
    if (Alexa.getRequestType(handlerInput.requestEnvelope) !== 'IntentRequest') return false;
    if (Alexa.getIntentName(handlerInput.requestEnvelope) !== 'AMAZON.YesIntent') return false;
    const session = handlerInput.attributesManager.getSessionAttributes();
    return session.pendingAction === 'summary_wait' || session.pendingAction === 'summary_no_display';
  },
  async handle(handlerInput) {
    const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
    const action = sessionAttributes.pendingAction;
    delete sessionAttributes.pendingAction;
    handlerInput.attributesManager.setSessionAttributes(sessionAttributes);

    const startTime = Date.now();

    const speechOnly = (action === 'summary_no_display');

    // Pruefen ob Cache inzwischen fertig
    let cached = summaryCache.get();
    if (cached) {
      debug(`SummaryYesHandler: Cache-Hit (action=${action})`);
      return deliverSummary(handlerInput, cached, speechOnly);
    }

    // Falls noch nicht fertig, nochmal warten
    debug(`SummaryYesHandler: Noch kein Cache, warte nochmal (action=${action})`);

    if (!summaryCache.isRefreshing()) {
      summaryCache.refresh().catch(err => {
        console.error('SummaryCache refresh Fehler:', err.message);
      });
    }

    cached = await waitForCache(WAIT_TIMEOUT_MS);

    if (cached) {
      debug(`SummaryYesHandler: Berechnung fertig in ${Date.now() - startTime}ms`);
      return deliverSummary(handlerInput, cached, speechOnly);
    }

    // Immer noch nicht fertig - jetzt aufgeben
    debug('SummaryYesHandler: Timeout, gebe auf');
    return handlerInput.responseBuilder
      .speak('Es tut mir leid, die Zusammenfassung konnte leider nicht erstellt werden. Bitte versuche es spaeter erneut.')
      .withShouldEndSession(true)
      .getResponse();
  },
};

// Handler fuer AMAZON.NoIntent - reagiert auf Summary-Kontext
const SummaryNoHandler = {
  canHandle(handlerInput) {
    if (Alexa.getRequestType(handlerInput.requestEnvelope) !== 'IntentRequest') return false;
    if (Alexa.getIntentName(handlerInput.requestEnvelope) !== 'AMAZON.NoIntent') return false;
    const session = handlerInput.attributesManager.getSessionAttributes();
    return session.pendingAction === 'summary_wait' || session.pendingAction === 'summary_no_display';
  },
  handle(handlerInput) {
    const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
    delete sessionAttributes.pendingAction;
    handlerInput.attributesManager.setSessionAttributes(sessionAttributes);

    return handlerInput.responseBuilder
      .speak('Okay.')
      .withShouldEndSession(true)
      .getResponse();
  },
};

// Findet einen ## Abschnitt im Detail-Text, der zum Topic passt
function findSection(detailText, topic) {
  if (!detailText || !topic) return null;
  const sections = detailText.split(/^## /gm).filter(s => s.trim());
  const needle = topic.toLowerCase();
  for (const section of sections) {
    if (section.toLowerCase().includes(needle)) {
      return '## ' + section.trim();
    }
  }
  return null;
}

// Extrahiert alle ## Headings aus dem Detail-Text
function extractHeadings(detailText) {
  if (!detailText) return [];
  const matches = detailText.match(/^## .+$/gm);
  return matches ? matches.map(h => h.replace(/^## /, '')) : [];
}

const SummaryDetailHandler = {
  canHandle(handlerInput) {
    return (
      Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === 'SummaryDetailIntent'
    );
  },
  handle(handlerInput) {
    const topic = Alexa.getSlotValue(handlerInput.requestEnvelope, 'topic');
    debug(`SummaryDetailHandler: topic="${topic}"`);

    if (!topic) {
      return handlerInput.responseBuilder
        .speak('Zu welchem Thema moechtest du mehr erfahren?')
        .reprompt('Sage zum Beispiel: Erzaehl mir mehr ueber Ukraine.')
        .withShouldEndSession(false)
        .getResponse();
    }

    const cached = summaryCache.get();
    if (!cached) {
      return handlerInput.responseBuilder
        .speak('Bitte erstelle zuerst eine Zusammenfassung. Sage einfach: Zusammenfassung.')
        .withShouldEndSession(false)
        .getResponse();
    }

    const detailText = cached.summary.detail || '';
    const section = findSection(detailText, topic);

    if (section) {
      debug(`SummaryDetailHandler: Abschnitt gefunden fuer "${topic}"`);
      const speechText = truncateForSsml(stripMarkdown(section));
      return handlerInput.responseBuilder
        .speak(speechText)
        .withShouldEndSession(false)
        .getResponse();
    }

    // Nicht gefunden - verfuegbare Themen auflisten
    const headings = extractHeadings(detailText);
    debug(`SummaryDetailHandler: Kein Abschnitt fuer "${topic}", verfuegbar: ${headings.join(', ')}`);
    const themenListe = headings.length > 0
      ? ' Verfuegbare Themen sind: ' + headings.join(', ') + '.'
      : '';
    return handlerInput.responseBuilder
      .speak(`Zu "${topic}" habe ich leider keinen Abschnitt gefunden.${themenListe}`)
      .withShouldEndSession(false)
      .getResponse();
  },
};

module.exports = { SummaryHandler, SummaryYesHandler, SummaryNoHandler, SummaryDetailHandler };
