const fs = require('fs');
const path = require('path');
const { relativeTime } = require('./speechUtils');
const { getLogoUrlForChannel } = require('./channels');
const { debug, debugTruncated } = require('./debug');

const NEWS_TEMPLATE = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'skill', 'apl', 'NewsListTemplate.json'), 'utf8')
);

const CHANNEL_TEMPLATE = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'skill', 'apl', 'ChannelListTemplate.json'), 'utf8')
);

const LAUNCH_TEMPLATE = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'skill', 'apl', 'LaunchTemplate.json'), 'utf8')
);

const SUMMARY_TEMPLATE = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'skill', 'apl', 'SummaryTemplate.json'), 'utf8')
);

const SUMMARY_LOADING_TEMPLATE = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'skill', 'apl', 'SummaryLoadingTemplate.json'), 'utf8')
);

function hasAPLSupport(handlerInput) {
  const interfaces = handlerInput.requestEnvelope.context.System.device.supportedInterfaces;
  return !!(interfaces && interfaces['Alexa.Presentation.APL']);
}

function renderNewsList(handlerInput, sections, title) {
  if (!hasAPLSupport(handlerInput)) return;

  let flatIndex = 0;
  const aplSections = sections.map(section => {
    const results = section.results.map(r => {
      const minutes = Math.round(r.duration / 60);
      const item = {
        flatIndex: flatIndex,
        title: r.title,
        channel: r.channel || '',
        logo: getLogoUrlForChannel(r.channel),
        imageUrl: r.imageUrl || '',
        time: relativeTime(r.timestamp),
        duration: minutes > 0 ? `${minutes} Min` : '',
      };
      flatIndex++;
      return item;
    });
    return { title: section.title, results };
  });

  handlerInput.responseBuilder.addDirective({
    type: 'Alexa.Presentation.APL.RenderDocument',
    token: 'newsListToken',
    document: NEWS_TEMPLATE,
    datasources: {
      newsData: {
        type: 'object',
        properties: {
          title: title || 'Aktuelle Nachrichten',
          sections: aplSections,
        },
      },
    },
  });
}

function renderChannelList(handlerInput, grouped) {
  if (!hasAPLSupport(handlerInput)) return;

  const items = [];
  for (const [group, chList] of Object.entries(grouped)) {
    for (const ch of chList) {
      items.push({
        id: ch.id,
        name: ch.name,
        group,
        logo: ch.logo || '',
      });
    }
  }

  handlerInput.responseBuilder.addDirective({
    type: 'Alexa.Presentation.APL.RenderDocument',
    token: 'channelListToken',
    document: CHANNEL_TEMPLATE,
    datasources: {
      channelData: {
        type: 'object',
        properties: {
          channels: items,
        },
      },
    },
  });
}

function renderLaunchScreen(handlerInput, sections, logoUrl) {
  if (!hasAPLSupport(handlerInput)) return;

  let flatIndex = 0;
  const aplSections = sections.map(section => {
    const results = section.results.map(r => {
      const minutes = Math.round(r.duration / 60);
      const item = {
        flatIndex: flatIndex,
        title: r.title,
        channel: r.channel || '',
        logo: getLogoUrlForChannel(r.channel),
        imageUrl: r.imageUrl || '',
        time: relativeTime(r.timestamp),
        duration: minutes > 0 ? `${minutes} Min` : '',
      };
      flatIndex++;
      return item;
    });
    return { title: section.title, results };
  });

  const categories = [
    { label: 'Nachrichten', id: 'nachrichten' },
    { label: 'Sport', id: 'sport' },
    { label: 'Kultur', id: 'kultur' },
    { label: 'Comedy', id: 'comedy' },
  ];

  handlerInput.responseBuilder.addDirective({
    type: 'Alexa.Presentation.APL.RenderDocument',
    token: 'launchToken',
    document: LAUNCH_TEMPLATE,
    datasources: {
      launchData: {
        type: 'object',
        properties: {
          title: 'Aktuelle Nachrichten',
          sections: aplSections,
          logoUrl: logoUrl || '',
          categories,
        },
      },
    },
  });
}

function markdownToAplMarkup(text) {
  let result = text;
  // ## Headings → styled span with line breaks
  result = result.replace(/^## (.+)$/gm, '<br><span fontSize="28dp" color="#4FC3F7"><b>$1</b></span><br>');
  // **bold** → <b>
  result = result.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  // - list items → <li>
  result = result.replace(/^- (.+)$/gm, '<li>$1</li>');
  // Double newlines → <br><br>, single newlines → <br>
  result = result.replace(/\n\n/g, '<br><br>');
  result = result.replace(/\n/g, '<br>');
  // Clean up leading <br>
  result = result.replace(/^(<br>)+/, '');
  return result;
}

function stripMarkdown(text) {
  let result = text;
  // ## Heading → "Heading." (period for speech pause)
  result = result.replace(/^## (.+)$/gm, '$1.');
  // **bold** → plain text
  result = result.replace(/\*\*(.+?)\*\*/g, '$1');
  // - list items → "Item."
  result = result.replace(/^- (.+)$/gm, '$1.');
  // Doppelte Punkte bereinigen (LLM-Output endet oft schon mit Punkt)
  result = result.replace(/\.{2,}/g, '.');
  return result;
}

const SSML_MAX_LENGTH = 7500;

function escapeForSsml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function truncateForSsml(text) {
  let escaped = escapeForSsml(text);
  if (escaped.length <= SSML_MAX_LENGTH) return escaped;

  // Am Satzende abschneiden
  const truncated = escaped.substring(0, SSML_MAX_LENGTH);
  const lastPeriod = truncated.lastIndexOf('.');
  if (lastPeriod > SSML_MAX_LENGTH * 0.5) {
    return truncated.substring(0, lastPeriod + 1);
  }
  return truncated;
}

function renderSummaryLoading(handlerInput, message) {
  if (!hasAPLSupport(handlerInput)) return;
  debug('renderSummaryLoading: Zeige Lade-Bildschirm');

  handlerInput.responseBuilder.addDirective({
    type: 'Alexa.Presentation.APL.RenderDocument',
    token: 'summaryLoadingToken',
    document: SUMMARY_LOADING_TEMPLATE,
    datasources: {
      loadingData: {
        type: 'object',
        properties: {
          message: message || 'Zusammenfassung wird erstellt...',
        },
      },
    },
  });
}

function renderSummary(handlerInput, summaryMarkup, sources) {
  if (!hasAPLSupport(handlerInput)) {
    debug('renderSummary: Kein APL-Support auf diesem Geraet');
    return;
  }
  debug('renderSummary: APL-Support vorhanden, baue Directive');

  const now = new Date();
  const timestamp = now.toLocaleDateString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });

  handlerInput.responseBuilder.addDirective({
    type: 'Alexa.Presentation.APL.RenderDocument',
    token: 'summaryToken',
    document: SUMMARY_TEMPLATE,
    datasources: {
      summaryData: {
        type: 'object',
        properties: {
          summaryMarkup,
          timestamp,
          sources,
        },
      },
    },
  });
}

module.exports = { hasAPLSupport, renderNewsList, renderChannelList, renderLaunchScreen, renderSummaryLoading, renderSummary, markdownToAplMarkup, stripMarkdown, escapeForSsml, truncateForSsml };
