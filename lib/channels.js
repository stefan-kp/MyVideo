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
  'Das_Erste': 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/ca/Das_Erste_2014.svg/240px-Das_Erste_2014.svg.png',
  'ONE': 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7f/One_ARD_logo_2024.svg/240px-One_ARD_logo_2024.svg.png',
  'ARD_alpha': 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/15/ARD_alpha_2024.svg/240px-ARD_alpha_2024.svg.png',
  'Tagesschau24': 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2c/ARD-Tagesschau24-Logo-2024.svg/240px-ARD-Tagesschau24-Logo-2024.svg.png',
  'ZDF_HD': 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c1/ZDF_logo.svg/240px-ZDF_logo.svg.png',
  'ZDFneo_HD': 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d6/ZDFneo_logo.svg/240px-ZDFneo_logo.svg.png',
  'ZDFinfo_HD': 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/74/ZDFinfo_logo.svg/240px-ZDFinfo_logo.svg.png',
  '3sat_HD': 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5c/3sat_Logo_2019.svg/240px-3sat_Logo_2019.svg.png',
  'Phoenix_HD': 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/44/Phoenix_logo.svg/240px-Phoenix_logo.svg.png',
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
