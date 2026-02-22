const fs = require('fs');
const path = require('path');

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
  // ORF 1/2 nutzen DRM (DASH) seit 2021, kein HLS verfuegbar
  // ORF 3/Sport+ ebenfalls nicht mehr per HLS erreichbar
};

const LOGOS = {
  'Das_Erste': 'https://tv.avm.de/tvapp/logos/hd/das_erste_hd.png',
  'ONE': 'https://tv.avm.de/tvapp/logos/hd/one_hd.png',
  'ARD_alpha': 'https://tv.avm.de/tvapp/logos/hd/ard_alpha_hd.png',
  'Tagesschau24': 'https://tv.avm.de/tvapp/logos/hd/tagesschau24_hd.png',
  'ZDF_HD': 'https://tv.avm.de/tvapp/logos/hd/zdf_hd.png',
  'ZDFneo_HD': 'https://tv.avm.de/tvapp/logos/hd/zdf_neo_hd.png',
  'ZDFinfo_HD': 'https://tv.avm.de/tvapp/logos/hd/zdf_info_hd.png',
  '3sat_HD': 'https://tv.avm.de/tvapp/logos/hd/3sat_hd.png',
  'Phoenix_HD': 'https://tv.avm.de/tvapp/logos/hd/phoenix_hd.png',
};

function normalize(name) {
  return name
    .toLowerCase()
    .replace(/[_\-\.]/g, ' ')
    .replace(/\s+hd\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function loadChannels() {
  const data = JSON.parse(fs.readFileSync(STREAMS_PATH, 'utf8'));
  channelMap.clear();
  channelList = [];

  for (const [group, channels] of Object.entries(data.liveTV || {})) {
    for (const [id, url] of Object.entries(channels)) {
      const channel = { id, name: id.replace(/_/g, ' '), url, group, logo: LOGOS[id] || '' };
      channelList.push(channel);

      // Map by normalized ID
      channelMap.set(normalize(id), channel);

      // Map by synonyms
      const syns = SYNONYMS[id] || [];
      for (const syn of syns) {
        channelMap.set(normalize(syn), channel);
      }
    }
  }
}

function findChannel(spokenName) {
  if (!spokenName) return null;
  const key = normalize(spokenName);
  return channelMap.get(key) || null;
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

// Load on require
loadChannels();

module.exports = { findChannel, findChannelById, listChannels, loadChannels };
