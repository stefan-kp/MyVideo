const Alexa = require('ask-sdk-core');
const mediathek = require('../../lib/mediathek');
const { renderLaunchScreen } = require('../../lib/aplHelper');
const { buildGreeting } = require('../../lib/launchGreeting');
const { generateStreamToken } = require('../../lib/auth');
const { pickVoiceHint } = require('../../lib/voiceHints');
const { videoIdFromEntry, thumbnailUrl } = require('../../lib/youtube/thumbnail');

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

    // Gather all data (each source is allowed to fail independently)
    let sections = [];
    let newsOk = true;
    try {
      const cat = await mediathek.searchCategorizedNews();
      sections = cat.sections || [];
      if (sections.length === 0) newsOk = false;
    } catch (err) {
      console.error('Launch news search error:', err.message);
      newsOk = false;
    }

    const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;

    // Resolve the best imageUrl for a local content entry.
    //  - YouTube downloads (contentId starts 'youtube/') → use ytimg.com
    //    thumbnail (always available, no server-side resize).
    //  - Other local files → /content/<id>/poster.jpg (server-side scan
    //    for cover.jpg/poster.jpg + Sharp-resize + disk cache; falls back
    //    to typed _fallback_*.png if no source exists).
    const contentSvc = (() => {
      try { return require('../../lib/content/service'); }
      catch (_) { return null; }
    })();
    function imageUrlForLocalContent(contentId) {
      if (!contentId) return '';
      if (contentId.startsWith('youtube/') && contentSvc && contentSvc.isEnabled && contentSvc.isEnabled()) {
        const entry = contentSvc.getIndex().findById(contentId);
        if (entry && entry.path) {
          const vid = videoIdFromEntry(entry.path);
          if (vid) return thumbnailUrl(vid);
        }
      }
      // Generic local file: signed poster.jpg endpoint
      try {
        const tok = process.env.JWT_SECRET ? `?token=${generateStreamToken(contentId)}` : '';
        return `${baseUrl}/content/${contentId}/poster.jpg${tok}`;
      } catch (_) { return ''; }
    }

    let queueRow = [];
    try {
      const queueModule = require('../../lib/queue');
      queueRow = queueModule.getInstance().peek(3).map(it => {
        let imageUrl = it.imageUrl || '';
        if (!imageUrl && it.source === 'local' && it.contentId) {
          imageUrl = imageUrlForLocalContent(it.contentId);
        }
        return {
          id: it.id,
          title: it.title,
          subtitle: it.subtitle || (it.source === 'local' ? 'Lokal' : 'Mediathek'),
          imageUrl,
        };
      });
    } catch (err) {
      console.warn('LaunchHandler: queue build failed:', err.message);
    }

    let recentContent = [];
    try {
      const contentService = require('../../lib/content/service');
      if (contentService.isEnabled()) {
        const { findNewest } = require('../../lib/content/search');
        const newest = findNewest(contentService.getIndex().all(), {
          limit: 3, uniquePerShow: true, newerThanDaysOnly: true,
          pathConfigs: contentService.getConfig().paths,
        });
        recentContent = newest.map(e => {
          return {
            id: e.id,
            label: e.pathLabel,
            title: e.type === 'episode'
              ? `${e.show} S${String(e.season || 0).padStart(2, '0')}E${String(e.episode || 0).padStart(2, '0')}`
              : (e.title || e.filename),
            imageUrl: imageUrlForLocalContent(e.id),
          };
        });
      }
    } catch (err) {
      console.warn('LaunchHandler: recentContent build failed:', err.message);
    }

    // Live-TV top-3 from env-driven set
    const channelsLib = require('../../lib/channels');
    const { getTopChannelIds } = require('../../lib/launchChannels');
    const liveTVChannels = getTopChannelIds()
      .map(id => {
        const ch = channelsLib.findChannelById(id);
        if (!ch) return null;
        return { id: ch.id, name: ch.displayName, logo: ch.logoUrl };
      })
      .filter(Boolean);

    // Adaptive greeting
    const greeting = buildGreeting({
      queueCount: queueRow.length,
      recentCount: recentContent.length,
      newsOk,
      liveTvOk: liveTVChannels.length > 0,
    });

    // Store flat results for index-access (touch/voice "number 2")
    const allResults = sections.flatMap(s => s.results);
    const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
    sessionAttributes.mediathekResults = allResults;
    // If the greeting asks "Soll ich abspielen?" — set a pendingAction so a
    // subsequent AMAZON.YesIntent knows what to do.
    if (greeting.priority === 'queue') {
      sessionAttributes.pendingAction = 'play_queue';
    } else {
      delete sessionAttributes.pendingAction;
    }
    handlerInput.attributesManager.setSessionAttributes(sessionAttributes);

    renderLaunchScreen(handlerInput, {
      sections, greeting, liveTVChannels, recentContent, queue: queueRow,
      voiceHint: pickVoiceHint(),
    });

    return handlerInput.responseBuilder
      .speak(greeting.speak)
      .reprompt(greeting.reprompt || 'Was möchtest du?')
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
