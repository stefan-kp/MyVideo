const fs = require('fs');
const path = require('path');
const { relativeTime } = require('./speechUtils');
const { getLogoUrlForChannel } = require('./channels');

const NEWS_TEMPLATE = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'skill', 'apl', 'NewsListTemplate.json'), 'utf8')
);

const CHANNEL_TEMPLATE = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'skill', 'apl', 'ChannelListTemplate.json'), 'utf8')
);

const LAUNCH_TEMPLATE = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'skill', 'apl', 'LaunchTemplate.json'), 'utf8')
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

module.exports = { hasAPLSupport, renderNewsList, renderChannelList, renderLaunchScreen };
