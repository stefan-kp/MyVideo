const fs = require('fs');
const path = require('path');
const { relativeTime } = require('./speechUtils');

const NEWS_TEMPLATE = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'skill', 'apl', 'NewsListTemplate.json'), 'utf8')
);

const CHANNEL_TEMPLATE = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'skill', 'apl', 'ChannelListTemplate.json'), 'utf8')
);

function hasAPLSupport(handlerInput) {
  const interfaces = handlerInput.requestEnvelope.context.System.device.supportedInterfaces;
  return !!(interfaces && interfaces['Alexa.Presentation.APL']);
}

function renderNewsList(handlerInput, results, title) {
  if (!hasAPLSupport(handlerInput)) return;

  const items = results.map((r, i) => {
    const minutes = Math.round(r.duration / 60);
    return {
      index: i,
      title: r.title,
      channel: r.channel || '',
      time: relativeTime(r.timestamp),
      duration: minutes > 0 ? `${minutes} Min` : '',
    };
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
          results: items,
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

module.exports = { hasAPLSupport, renderNewsList, renderChannelList };
