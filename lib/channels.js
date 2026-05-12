const fs = require('fs');
const path = require('path');
const { HlsSource } = require('./sources/hlsSource');
const { ChannelWithFallback } = require('./sources/Channel');

const STREAMS_PATH = path.join(__dirname, '..', 'streams.json');
const FRITZBOX_CHANNELS_PATH = path.join(__dirname, 'fritzbox', 'channels.json');

let channelMap = new Map();
let channelList = [];

const HLS_SYNONYMS = {
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

const HLS_LOGO_FILES = {
  'Das_Erste': 'das_erste_hd.png', 'ONE': 'one_hd.png', 'ARD_alpha': 'ard_alpha_hd.png',
  'Tagesschau24': 'tagesschau24_hd.png', 'ZDF_HD': 'zdf_hd.png', 'ZDFneo_HD': 'zdf_neo_hd.png',
  'ZDFinfo_HD': 'zdf_info_hd.png', '3sat_HD': '3sat_hd.png', 'Phoenix_HD': 'phoenix_hd.png',
};

// Maps FRITZ!Box channel id -> matching HLS upstream id (in streams.json)
// for channels that have BOTH sources. Used to build ChannelWithFallback.
const FRITZBOX_TO_HLS_FALLBACK = {
  dasErsteHd:     'Das_Erste',
  zdfHd:          'ZDF_HD',
  '3satHd':       '3sat_HD',
  phoenixHd:      'Phoenix_HD',
  tagesschau24Hd: 'Tagesschau24',
  ardAlphaHd:     'ARD_alpha',
  oneHd:          'ONE',
  zdfinfoHd:      'ZDFinfo_HD',
};

const CHANNEL_LOGO_MAP = {
  'ARD': 'das_erste_hd.png', 'Das Erste': 'das_erste_hd.png', 'ZDF': 'zdf_hd.png',
  'ORF': 'orf2o_hd.png', '3Sat': '3sat_hd.png', '3sat': '3sat_hd.png',
  'PHOENIX': 'phoenix_hd.png', 'Phoenix': 'phoenix_hd.png',
  'BR': 'ard_alpha_hd.png', 'SWR': 'das_erste_hd.png', 'NDR': 'das_erste_hd.png',
  'WDR': 'das_erste_hd.png', 'HR': 'das_erste_hd.png', 'MDR': 'das_erste_hd.png',
  'RBB': 'das_erste_hd.png', 'SR': 'das_erste_hd.png',
};

function baseUrl() {
  return process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
}

function getLogoUrl(idOrFile) {
  if (!idOrFile) return '';
  // Backwards compat: if it's an HLS id (matches LOGO_FILES key), resolve via map
  const file = HLS_LOGO_FILES[idOrFile] || idOrFile;
  return `${baseUrl()}/logos/${file}`;
}

function getLogoUrlForChannel(channelName) {
  if (!channelName) return '';
  const file = CHANNEL_LOGO_MAP[channelName];
  if (!file) return '';
  return `${baseUrl()}/logos/${file}`;
}

function normalize(name) {
  return name.toLowerCase().replace(/[_\-\.]/g, ' ').replace(/\s+hd\s*$/i, '').replace(/\s+/g, ' ').trim();
}

function loadHlsChannels() {
  const data = JSON.parse(fs.readFileSync(STREAMS_PATH, 'utf8'));
  const byHlsId = new Map();
  const all = [];
  for (const [group, chs] of Object.entries(data.liveTV || {})) {
    for (const [id, url] of Object.entries(chs)) {
      const ch = new HlsSource({
        id, displayName: id.replace(/_/g, ' '),
        synonyms: HLS_SYNONYMS[id] || [],
        upstreamUrl: url, logoUrl: getLogoUrl(HLS_LOGO_FILES[id]), group,
      });
      byHlsId.set(id, ch);
      all.push(ch);
    }
  }
  return { byHlsId, all };
}

function loadFritzboxChannels() {
  let session;
  try {
    const sessMod = require('./fritzbox/session');
    session = sessMod.getInstance();
  } catch {
    session = null;
  }
  if (!session) return [];

  const data = JSON.parse(fs.readFileSync(FRITZBOX_CHANNELS_PATH, 'utf8'));
  const { FritzboxSource } = require('./sources/fritzboxSource');
  return data.channels.map(c => new FritzboxSource({
    id: c.id,
    displayName: c.displayName,
    synonyms: c.synonyms,
    tunerId: c.tunerId,
    logoUrl: getLogoUrl(c.logoFile),
    group: c.group,
  }));
}

function registerChannel(ch) {
  channelList.push(ch);
  channelMap.set(normalize(ch.id), ch);
  channelMap.set(normalize(ch.displayName), ch);
  for (const syn of ch.synonyms) {
    channelMap.set(normalize(syn), ch);
  }
}

function loadChannels() {
  channelMap.clear();
  channelList = [];

  const { byHlsId, all: hlsAll } = loadHlsChannels();
  const fbChannels = loadFritzboxChannels();
  const usedHlsIds = new Set();

  // 1. Register FRITZ!Box channels (with HLS fallback where available)
  for (const fb of fbChannels) {
    const hlsId = FRITZBOX_TO_HLS_FALLBACK[fb.id];
    if (hlsId && byHlsId.has(hlsId)) {
      const wrapped = new ChannelWithFallback(fb, byHlsId.get(hlsId));
      registerChannel(wrapped);
      usedHlsIds.add(hlsId);
    } else {
      registerChannel(fb);
    }
  }

  // 2. Register HLS-only channels that have no FRITZ!Box equivalent
  for (const hls of hlsAll) {
    if (!usedHlsIds.has(hls.id)) {
      registerChannel(hls);
    }
  }
}

function findChannel(spokenName) {
  if (!spokenName) return null;
  return channelMap.get(normalize(spokenName)) || null;
}

function findChannelById(channelId) {
  return channelList.find(ch => ch.id === channelId) || null;
}

function listChannels() {
  const grouped = {};
  for (const ch of channelList) {
    if (!grouped[ch.group]) grouped[ch.group] = [];
    grouped[ch.group].push(ch);
  }
  return grouped;
}

loadChannels();

module.exports = { findChannel, findChannelById, listChannels, loadChannels, getLogoUrl, getLogoUrlForChannel };
