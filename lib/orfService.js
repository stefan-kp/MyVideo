const axios = require('axios');
const fs = require('fs');
const path = require('path');

const API_BASE = 'https://api-tvthek.orf.at/api/v4.3';
const CREDENTIALS_PATH = path.join(__dirname, '..', 'data', 'orf-credentials.json');
const ORF_ON_URL = 'https://on.orf.at';

// Known ORF profile IDs (fallback, updated at startup via search)
const KNOWN_PROFILES = {
  'ZIB 1': null,
  'ZIB 2': null,
  'ZIB Flash': null,
  'ZIB 9:00': null,
  'ZIB 11:00': null,
  'ZIB 13:00': null,
  'ZIB 17:00': null,
  'Spät-ZIB': null,
};

let cachedCredentials = null;
let profileCache = {};

function isEnabled() {
  return process.env.ORF_API === 'true';
}

function loadCredentialsFromDisk() {
  try {
    if (fs.existsSync(CREDENTIALS_PATH)) {
      const data = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
      if (data.user && data.password) {
        return data;
      }
    }
  } catch (e) {
    // ignore corrupt cache
  }
  return null;
}

function saveCredentialsToDisk(creds) {
  const dir = path.dirname(CREDENTIALS_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify(creds, null, 2));
}

function clearCredentialsCache() {
  cachedCredentials = null;
  try {
    if (fs.existsSync(CREDENTIALS_PATH)) {
      fs.unlinkSync(CREDENTIALS_PATH);
    }
  } catch (e) {
    // ignore
  }
}

async function fetchCredentialsFromOrfOn() {
  const response = await axios.get(ORF_ON_URL, { timeout: 10000 });
  const html = response.data;

  // Parse window.__NUXT__.config or window.__NUXT_CONFIG__
  const patterns = [
    /window\.__NUXT__\.config\s*=\s*(\{[\s\S]*?\});/,
    /window\.__NUXT_CONFIG__\s*=\s*(\{[\s\S]*?\});/,
    /"apiUser"\s*:\s*"([^"]+)"[\s\S]*?"apiPassword"\s*:\s*"([^"]+)"/,
  ];

  // Try direct regex for user/password
  const userMatch = html.match(/"apiUser"\s*:\s*"([^"]+)"/);
  const passMatch = html.match(/"apiPassword"\s*:\s*"([^"]+)"/);

  if (userMatch && passMatch) {
    return { user: userMatch[1], password: passMatch[1] };
  }

  // Try NUXT config parsing
  for (const pattern of patterns.slice(0, 2)) {
    const match = html.match(pattern);
    if (match) {
      try {
        // Use Function to safely parse the config object
        const configStr = match[1];
        const userM = configStr.match(/"?apiUser"?\s*:\s*"([^"]+)"/);
        const passM = configStr.match(/"?apiPassword"?\s*:\s*"([^"]+)"/);
        if (userM && passM) {
          return { user: userM[1], password: passM[1] };
        }
      } catch (e) {
        // continue
      }
    }
  }

  throw new Error('Could not extract ORF API credentials from on.orf.at');
}

async function getCredentials() {
  if (cachedCredentials) return cachedCredentials;

  cachedCredentials = loadCredentialsFromDisk();
  if (cachedCredentials) return cachedCredentials;

  cachedCredentials = await fetchCredentialsFromOrfOn();
  saveCredentialsToDisk(cachedCredentials);
  return cachedCredentials;
}

async function apiRequest(urlPath, retry = true) {
  const creds = await getCredentials();
  const url = `${API_BASE}${urlPath}`;

  try {
    const response = await axios.get(url, {
      auth: { username: creds.user, password: creds.password },
      timeout: 10000,
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    return response.data;
  } catch (err) {
    if (err.response && err.response.status === 401 && retry) {
      console.log('ORF API: 401, refreshing credentials...');
      clearCredentialsCache();
      return apiRequest(urlPath, false);
    }
    throw err;
  }
}

function extractVideoUrl(sources) {
  if (!sources) return { url: null, urlVideo: null, urlVideoHd: null };

  // sources can be an object with source entries or an array
  const srcList = Array.isArray(sources) ? sources : Object.values(sources);

  let urlVideoHd = null;
  let urlVideo = null;

  for (const src of srcList) {
    // src can have nested src array or direct url
    const entries = src.src || (src.sources ? Object.values(src.sources) : [src]);
    const srcEntries = Array.isArray(entries) ? entries : [entries];

    for (const entry of srcEntries) {
      const entryUrl = entry.src || entry.url;
      if (!entryUrl) continue;

      // Prefer progressive (mp4) or HLS
      if (entry.quality === 'Q8C' || entry.quality_key === 'Q8C' ||
          (entryUrl.includes('.mp4') && entryUrl.includes('Q8C'))) {
        urlVideoHd = entryUrl;
      } else if (entry.quality === 'Q6A' || entry.quality_key === 'Q6A' ||
                 (entryUrl.includes('.mp4') && entryUrl.includes('Q6A'))) {
        urlVideo = entryUrl;
      }

      // HLS streams
      if (entryUrl.includes('.m3u8')) {
        if (!urlVideoHd) urlVideoHd = entryUrl;
      }
    }
  }

  const url = urlVideoHd || urlVideo;
  return { url, urlVideo, urlVideoHd };
}

function extractSubtitleUrl(subtitles) {
  if (!subtitles) return '';

  const subList = Array.isArray(subtitles) ? subtitles : Object.values(subtitles);

  for (const sub of subList) {
    // Prefer TTML
    if (sub.src && (sub.src.includes('.ttml') || sub.src.includes('.xml'))) {
      return sub.src;
    }
    if (sub.url && (sub.url.includes('.ttml') || sub.url.includes('.xml'))) {
      return sub.url;
    }
  }

  // Fallback: any subtitle
  for (const sub of subList) {
    if (sub.src) return sub.src;
    if (sub.url) return sub.url;
  }

  return '';
}

function extractImageUrl(episode) {
  if (!episode) return '';

  // Try image field directly
  if (episode.image_url) return episode.image_url;

  // Try image object with public_urls
  if (episode.image) {
    if (typeof episode.image === 'string') return episode.image;
    const img = episode.image;
    if (img.public_urls) {
      // Prefer a medium-sized image
      return img.public_urls['highlight_teaser'] ||
             img.public_urls['player'] ||
             img.public_urls['list'] ||
             Object.values(img.public_urls)[0] || '';
    }
    if (img.url) return img.url;
  }

  // Try _embedded.image
  if (episode._embedded && episode._embedded.image) {
    const embImg = episode._embedded.image;
    if (embImg.public_urls) {
      return embImg.public_urls['highlight_teaser'] ||
             embImg.public_urls['player'] ||
             embImg.public_urls['list'] ||
             Object.values(embImg.public_urls)[0] || '';
    }
    if (embImg.url) return embImg.url;
  }

  // Try thumbnail
  if (episode.thumbnail) return episode.thumbnail;

  return '';
}

function mapSegments(segments) {
  if (!segments || !Array.isArray(segments)) return [];

  return segments.map(seg => {
    const videos = extractVideoUrl(seg.sources || seg._embedded?.sources);
    return {
      title: seg.title || seg.headline || '',
      duration: seg.duration_seconds || seg.duration || 0,
      url: videos.url || '',
      urlSubtitle: extractSubtitleUrl(seg.subtitles || seg._embedded?.subtitles),
    };
  }).filter(s => s.url);
}

function mapEpisodeToResult(episode) {
  if (!episode) return null;

  const embedded = episode._embedded || {};

  // Extract video URLs from episode sources or segments
  let videos = extractVideoUrl(episode.sources || embedded.sources);

  // If no direct video, try first segment
  const segments = embedded.segments || episode.segments || [];
  const segmentList = Array.isArray(segments) ? segments : Object.values(segments);

  if (!videos.url && segmentList.length > 0) {
    // Use the whole-episode playlist if available, else first segment
    const firstSeg = segmentList[0];
    videos = extractVideoUrl(firstSeg.sources || firstSeg._embedded?.sources);
  }

  if (!videos.url) return null;

  const subtitle = extractSubtitleUrl(episode.subtitles || embedded.subtitles);
  const imageUrl = extractImageUrl(episode);

  // Parse timestamp
  let timestamp = 0;
  if (episode.date) {
    timestamp = Math.floor(new Date(episode.date).getTime() / 1000);
  } else if (episode.episode_date) {
    timestamp = Math.floor(new Date(episode.episode_date).getTime() / 1000);
  }

  const mappedSegments = mapSegments(segmentList);

  const title = episode.title || episode.headline || '';
  const topic = episode.profile_title || episode.topic || title;

  return {
    title,
    topic,
    channel: 'ORF',
    duration: episode.duration_seconds || episode.duration || 0,
    timestamp,
    url: videos.url,
    urlVideo: videos.urlVideo || videos.url,
    urlVideoHd: videos.urlVideoHd || '',
    urlSubtitle: subtitle,
    imageUrl,
    segments: mappedSegments.length > 0 ? mappedSegments : undefined,
    source: 'orf',
  };
}

async function getLatestEpisodes(profileId, limit = 5) {
  if (!profileId) return [];

  try {
    const data = await apiRequest(`/profile/${profileId}/episodes?limit=${limit}`);
    const episodes = data._embedded?.items || data._embedded?.episodes || [];
    const items = Array.isArray(episodes) ? episodes : Object.values(episodes);
    return items.map(mapEpisodeToResult).filter(Boolean);
  } catch (err) {
    console.error(`ORF API getLatestEpisodes(${profileId}) error:`, err.message);
    return [];
  }
}

async function searchEpisodes(query, limit = 10) {
  try {
    const data = await apiRequest(`/search/${encodeURIComponent(query)}?limit=${limit}`);
    const episodes = data._embedded?.items || data._embedded?.episodes ||
                     data._embedded?.search_result || [];
    const items = Array.isArray(episodes) ? episodes : Object.values(episodes);
    return items.map(mapEpisodeToResult).filter(Boolean);
  } catch (err) {
    console.error(`ORF API searchEpisodes(${query}) error:`, err.message);
    return [];
  }
}

async function getEpisodeDetails(episodeId) {
  try {
    const data = await apiRequest(`/episode/${episodeId}`);
    return mapEpisodeToResult(data);
  } catch (err) {
    console.error(`ORF API getEpisodeDetails(${episodeId}) error:`, err.message);
    return null;
  }
}

async function resolveProfileId(topicName) {
  // Check cache first
  if (profileCache[topicName]) return profileCache[topicName];

  try {
    const data = await apiRequest(`/search/${encodeURIComponent(topicName)}?limit=5`);
    // Look for a profile in search results
    const profiles = data._embedded?.profiles || [];
    const profileList = Array.isArray(profiles) ? profiles : Object.values(profiles);

    for (const p of profileList) {
      if (p.title === topicName || p.name === topicName) {
        profileCache[topicName] = p.id;
        return p.id;
      }
    }

    // If no exact match, try the first profile
    if (profileList.length > 0) {
      profileCache[topicName] = profileList[0].id;
      return profileList[0].id;
    }
  } catch (err) {
    console.error(`ORF API resolveProfileId(${topicName}) error:`, err.message);
  }

  return null;
}

async function getLatestByTopic(topicName, limit = 5) {
  const profileId = await resolveProfileId(topicName);
  if (profileId) {
    return getLatestEpisodes(profileId, limit);
  }
  // Fallback to search
  return searchEpisodes(topicName, limit);
}

async function initProfiles() {
  if (!isEnabled()) return;

  console.log('ORF API: Resolving profile IDs...');
  const topics = Object.keys(KNOWN_PROFILES);

  await Promise.all(
    topics.map(async (topic) => {
      const id = await resolveProfileId(topic);
      if (id) {
        KNOWN_PROFILES[topic] = id;
        console.log(`  ${topic}: Profile ${id}`);
      }
    })
  );
}

function getKnownTopics() {
  return Object.keys(KNOWN_PROFILES);
}

module.exports = {
  isEnabled,
  getLatestEpisodes,
  searchEpisodes,
  getEpisodeDetails,
  getLatestByTopic,
  initProfiles,
  getKnownTopics,
  mapEpisodeToResult,
};
