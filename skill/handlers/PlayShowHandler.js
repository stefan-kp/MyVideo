const Alexa = require('ask-sdk-core');
const contentService = require('../../lib/content/service');
const contentSource = require('../../lib/content/contentSource');
const { findExactEpisode, findLatestEpisode, searchLocal } = require('../../lib/content/search');

const PlayShowHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
           Alexa.getIntentName(handlerInput.requestEnvelope) === 'PlayShowIntent';
  },
  async handle(handlerInput) {
    if (!contentService.isEnabled()) {
      return handlerInput.responseBuilder
        .speak('Die lokale Sammlung ist nicht konfiguriert.')
        .getResponse();
    }
    const slots = handlerInput.requestEnvelope.request.intent.slots || {};
    const showQuery = slots.show?.value;
    const season = slots.season?.value ? parseInt(slots.season.value, 10) : null;
    const episode = slots.episode?.value ? parseInt(slots.episode.value, 10) : null;

    if (!showQuery) {
      return handlerInput.responseBuilder
        .speak('Welche Sendung soll ich starten?')
        .reprompt('Sage zum Beispiel: spiele Better Call Saul.')
        .getResponse();
    }

    const all = contentService.getIndex().all();
    let entry = null;
    if (season != null && episode != null) {
      entry = findExactEpisode(all, showQuery, season, episode);
    } else if (episode != null) {
      entry = findExactEpisode(all, showQuery, 1, episode);
    } else {
      entry = findLatestEpisode(all, showQuery);
      if (!entry) {
        const hits = searchLocal(all, showQuery, { limit: 1 });
        if (hits.length) entry = hits[0];
      }
    }

    if (!entry) {
      return handlerInput.responseBuilder
        .speak(`Ich habe ${showQuery} leider nicht in deiner Sammlung gefunden.`)
        .reprompt('Moechtest du etwas anderes starten?')
        .getResponse();
    }

    let stream;
    try {
      stream = await contentSource.resolveStream(entry.id);
    } catch (err) {
      console.error('PlayShowHandler resolveStream error:', err.message);
      return handlerInput.responseBuilder
        .speak(`${entry.title} kann gerade nicht gestartet werden. ${err.message}`)
        .getResponse();
    }

    const spokenTitle = entry.type === 'episode'
      ? `${entry.show} Staffel ${entry.season} Folge ${entry.episode}`
      : entry.title;

    console.log(`PlayShow: ${entry.id} → ${stream.url}`);
    return handlerInput.responseBuilder
      .speak(`Starte ${spokenTitle}.`)
      .addVideoAppLaunchDirective(stream.url, entry.title || spokenTitle, entry.show || entry.pathLabel)
      .getResponse();
  },
};

module.exports = PlayShowHandler;
