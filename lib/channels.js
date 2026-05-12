const fs = require('fs');
const path = require('path');
const { HlsSource } = require('./sources/hlsSource');

const STREAMS_PATH = path.join(__dirname, '..', 'streams.json');

let channelMap = new Map();
let channelList = [];

const SYNONYMS = {
  'Das_Erste': ['das erste', 'ard', 'erstes', 'erstes programm', 'ard das erste', 'das erste ard'],
  'ONE': ['one', 'ard one', 'eins festival'],
  'ARD_alpha': ['ard alpha', 'alpha', 'br alpha'],
  'Tagesschau24': ['tagesschau24', 'tagesschau', 'tagesschau 24'],
  'ZDF_HD': ['zdf', 'zdf hd', 'zweites', 'zweites programm', 'zweites deutsches fernsehen'],
  'ZDFneo_HD': ['zdf neo', 'neo', 'zdfneo'],
  'ZDFinfo_HD': ['zdf info', 'zdfinfo', 'zdf information'],
  '3sat_HD': ['3sat', 'drei sat', 'dreisat'],
  'Phoenix_HD': ['phoenix', 'phoenix hd'],
};

const LOGO_FILES = {
  'Das_Erste': 'das_erste_hd.png',
  'ONE': 'one_hd.png',
  'ARD_alpha': 'ard_alpha_hd.png',
  'Tagesschau24': 'tagesschau24_hd.png',
  'ZDF_HD': 'zdf_hd.png',
  'ZDFneo_HD': 'zdf_neo_hd.png',
  'ZDFinfo_HD': 'zdf_info_hd.png',
  '3sat_HD': '3sat_hd.png',
  'Phoenix_HD': 'phoenix_hd.png',
};

const CHANNEL_LOGO_MAP = {
  'ARD': 'das_erste_hd.png',
  'Das Erste': 'das_erste_hd.png',
  'ZDF': 'zdf_hd.png',
  'ORF': 'orf2o_hd.png',
  '3Sat': '3sat_hd.png',
  '3sat': '3sat_hd.png',
  'PHOENIX': 'phoenix_hd.png',
  'Phoenix': 'phoenix_hd.png',
  'BR': 'ard_alpha_hd.png',
  'SWR': 'das_erste_hd.png',
  'NDR': 'das_erste_hd.png',
  'WDR': 'das_erste_hd.png',
  'HR': 'das_erste_hd.png',
  'MDR': 'das_erste_hd.png',
  'RBB': 'das_erste_hd.png',
  'SR': 'das_erste_hd.png',
};

function getLogoUrl(id) {
  const file = LOGO_FILES[id];
  if (!file) return '';
  const base = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
  return `${base}/logos/${file}`;
}

function getLogoUrlForChannel(channelName) {
  if (!channelName) return '';
  const file = CHANNEL_LOGO_MAP[channelName];
  if (!file) return '';
  const base = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
  return `${base}/logos/${file}`;
}

function normalize(name) {
  return name.toLowerCase().replace(/[_\-\.]/g, ' ').replace(/\s+hd\s*$/i, '').replace(/\s+/g, ' ').trim();
}

function loadChannels() {
  const data = JSON.parse(fs.readFileSync(STREAMS_PATH, 'utf8'));
  channelMap.clear();
  channelList = [];

  for (const [group, chs] of Object.entries(data.liveTV || {})) {
    for (const [id, url] of Object.entries(chs)) {
      const channel = new HlsSource({
        id,
        displayName: id.replace(/_/g, ' '),
        synonyms: SYNONYMS[id] || [],
        upstreamUrl: url,
        logoUrl: getLogoUrl(id),
        group,
      });
      channelList.push(channel);
      channelMap.set(normalize(id), channel);
      for (const syn of channel.synonyms) {
        channelMap.set(normalize(syn), channel);
      }
    }
  }
}

function findChannel(spokenName) {
  if (!spokenName) return null;
  return channelMap.get(normalize(spokenName)) || null;
}

function listChannels() {
  const grouped = {};
  for (const ch of channelList) {
    if (!grouped[ch.group]) grouped[ch.group] = [];
    grouped[ch.group].push(ch);
  }
  return grouped;
}

function findChannelById(channelId) {
  return channelList.find(ch => ch.id === channelId) || null;
}

loadChannels();

module.exports = { findChannel, findChannelById, listChannels, loadChannels, getLogoUrl, getLogoUrlForChannel };
