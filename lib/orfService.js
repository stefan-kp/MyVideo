const axios = require('axios');
const fs = require('fs');
const path = require('path');

const API_BASE = 'https://api-tvthek.orf.at/api/v4.3';
const CREDENTIALS_PATH = path.join(__dirname, '..', 'data', 'orf-credentials.json');
const ORF_ON_URL = 'https://on.orf.at';

// Well-known public credentials (used by Kodi plugin, yt-dlp, etc.)
const FALLBACK_CREDENTIALS = {
  user: 'orf_on_v43',
  password: 'jFRsbNPFiPSxuwnLbYDfCLUN5YNZ28mt',
};

// Known ORF profile IDs (hardcoded, verified against API)
const KNOWN_PROFILES = {
  'ZIB 1': 1203,
  'ZIB 2': 1211,
  'ZIB Flash': 13886013,
  'ZIB 9:00': null,
  'ZIB 11:00': null,
  'ZIB 13:00': null,
  'ZIB 17:00': null,
  'Spät-ZIB': null,
};

let cachedCredentials = null;
let profileCache = { ...KNOWN_PROFILES };

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

  // Try direct regex for user/password anywhere in HTML/JS
  const userMatch = html.match(/"apiUser"\s*:\s*"([^"]+)"/);
  const passMatch = html.match(/"apiPassword"\s*:\s*"([^"]+)"/);

  if (userMatch && passMatch) {
    return { user: userMatch[1], password: passMatch[1] };
  }

  throw new Error('Could not extract ORF API credentials from on.orf.at');
}

async function getCredentials() {
  if (cachedCredentials) return cachedCredentials;

  cachedCredentials = loadCredentialsFromDisk();
  if (cachedCredentials) return cachedCredentials;

  try {
    cachedCredentials = await fetchCredentialsFromOrfOn();
    console.log('ORF API: Credentials von on.orf.at extrahiert');
  } catch (err) {
    console.log(`ORF API: Scraping fehlgeschlagen (${err.message}), nutze Fallback-Credentials`);
    cachedCredentials = FALLBACK_CREDENTIALS;
  }

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

// --- Video URL extraction ---
// API sources format: { hls: [{ quality_key, src, ... }], dash: [...] }
function extractVideoUrl(sources) {
  if (!sources) return { url: null, urlVideo: null, urlVideoHd: null };

  // sources.hls is an array of { quality_key, src }
  const hlsList = sources.hls || [];

  let urlVideoHd = null;
  let urlVideo = null;
  let urlAdaptive = null;

  for (const entry of hlsList) {
    if (!entry.src || entry.is_drm_protected) continue;

    if (entry.quality_key === 'Q8C') {
      urlVideoHd = entry.src;
    } else if (entry.quality_key === 'Q6A') {
      urlVideo = entry.src;
    } else if (entry.quality_key === 'QXB' && entry.is_adaptive_stream) {
      urlAdaptive = entry.src;
    }
  }

  const url = urlVideoHd || urlAdaptive || urlVideo;
  return { url, urlVideo: urlVideo || url, urlVideoHd: urlVideoHd || urlAdaptive || '' };
}

// --- Subtitle extraction ---
// Subtitle object: { ttml_url, srt_url, vtt_url, sami_url, ... }
function extractSubtitleUrl(subtitle) {
  if (!subtitle) return '';

  // Direct URL fields on the subtitle object
  if (subtitle.ttml_url) return subtitle.ttml_url;
  if (subtitle.vtt_url) return subtitle.vtt_url;
  if (subtitle.srt_url) return subtitle.srt_url;

  return '';
}

// --- Image extraction ---
// Image: _embedded.image.public_urls.{size}.url
function extractImageUrl(episode) {
  if (!episode) return '';

  const img = episode._embedded?.image || episode.image;
  if (img && img.public_urls) {
    const urls = img.public_urls;
    // Each size is { url: "..." }
    const preferred = urls.highlight_teaser || urls.player || urls.list || urls.small;
    if (preferred && preferred.url) return preferred.url;
    // Fallback: first available
    const first = Object.values(urls)[0];
    if (first && first.url) return first.url;
  }

  return '';
}

// --- Segment mapping ---
function mapSegments(segments) {
  if (!segments || !Array.isArray(segments)) return [];

  return segments.map(seg => {
    const sources = seg.sources || seg._embedded?.sources || {};
    const videos = extractVideoUrl(sources);
    return {
      title: seg.title || seg.headline || '',
      duration: seg.duration_seconds || seg.duration || 0,
      url: videos.url || '',
      urlSubtitle: extractSubtitleUrl(seg._embedded?.subtitle),
    };
  }).filter(s => s.url);
}

// --- Episode mapping (full detail format) ---
function mapEpisodeToResult(episode) {
  if (!episode) return null;

  const embedded = episode._embedded || {};

  // Extract video from episode-level sources
  let videos = extractVideoUrl(episode.sources);

  // If no direct video, try first segment
  const segments = embedded.segments || [];
  const segmentList = Array.isArray(segments) ? segments : Object.values(segments);

  if (!videos.url && segmentList.length > 0) {
    const firstSeg = segmentList[0];
    videos = extractVideoUrl(firstSeg.sources || firstSeg._embedded?.sources);
  }

  if (!videos.url) return null;

  // Subtitles from episode or first segment
  const subtitle = extractSubtitleUrl(
    embedded.subtitle || segmentList[0]?._embedded?.subtitle
  );

  const imageUrl = extractImageUrl(episode);

  // Parse timestamp from ISO date
  let timestamp = 0;
  if (episode.date) {
    timestamp = Math.floor(new Date(episode.date).getTime() / 1000);
  }

  const mappedSegments = mapSegments(segmentList);

  const title = episode.title || episode.headline || '';
  const topic = episode.profile_title || episode.sub_headline || title;

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

// --- API methods ---

async function getLatestEpisodes(profileId, limit = 5) {
  if (!profileId) return [];

  try {
    const data = await apiRequest(`/profile/${profileId}/episodes?limit=${limit}`);
    const episodes = data._embedded?.items || [];
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
    // Search returns { suggestions: { episodes: [...] } } -- episodes without video sources
    const episodes = data.suggestions?.episodes || [];

    // Fetch full details in parallel (needed for video URLs + segments)
    const detailResults = await Promise.all(
      episodes.slice(0, limit).map(ep =>
        apiRequest(`/episode/${ep.id}`).then(mapEpisodeToResult).catch(() => null)
      )
    );

    return detailResults.filter(Boolean);
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
    // Search suggestions include episodes with advertising_query_string containing sproid
    const episodes = data.suggestions?.episodes || [];
    for (const ep of episodes) {
      const qs = ep.advertising_query_string || ep.adition_advertising_query_string || '';
      const match = qs.match(/sproid[=:](\d+)/);
      if (match) {
        const id = parseInt(match[1], 10);
        profileCache[topicName] = id;
        return id;
      }
    }
  } catch (err) {
    console.error(`ORF API resolveProfileId(${topicName}) error:`, err.message);
  }

  return null;
}

async function getLatestByTopic(topicName, limit = 5) {
  const profileId = profileCache[topicName] || await resolveProfileId(topicName);
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

  // Only resolve unknown profiles
  const unknown = topics.filter(t => !profileCache[t]);
  if (unknown.length === 0) {
    console.log('  Alle Profile-IDs bekannt');
    return;
  }

  await Promise.all(
    unknown.map(async (topic) => {
      const id = await resolveProfileId(topic);
      if (id) {
        KNOWN_PROFILES[topic] = id;
        console.log(`  ${topic}: Profile ${id}`);
      } else {
        console.log(`  ${topic}: nicht gefunden`);
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
