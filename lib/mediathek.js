const axios = require('axios');

const API_URL = 'https://mediathekviewweb.de/api/query';

async function search(query) {
  const response = await axios.post(API_URL, {
    queries: [
      { fields: ['topic', 'title'], query }
    ],
    sortBy: 'timestamp',
    sortOrder: 'desc',
    future: false,
    offset: 0,
    size: 10
  }, {
    timeout: 5000,
    headers: { 'Content-Type': 'text/plain' }
  });

  const results = (response.data.result?.results || []).map(item => ({
    title: item.title,
    topic: item.topic,
    channel: item.channel,
    duration: item.duration,
    timestamp: item.timestamp,
    url: item.url_video_hd || item.url_video || item.url_video_low,
    urlVideo: item.url_video,
    urlVideoHd: item.url_video_hd
  }));

  // Prefer entries with a video URL
  return results.filter(r => r.url);
}

// Nachrichten-Quellen: jeweils den neuesten Treffer pro Quelle holen
const NEWS_QUERIES = [
  'ZIB 2',
  'ZIB 1',
  'ZIB',
  'Tagesschau',
  'heute journal',
  'heute',
];

async function searchLatestNews() {
  const searches = NEWS_QUERIES.map(q =>
    search(q).catch(() => [])
  );
  const allResults = await Promise.all(searches);

  // Pro Quelle den neuesten Treffer nehmen, Duplikate (gleiche URL) vermeiden
  const seen = new Set();
  const combined = [];

  for (const results of allResults) {
    if (results.length > 0) {
      const best = results[0]; // already sorted by timestamp desc
      if (!seen.has(best.url)) {
        seen.add(best.url);
        combined.push(best);
      }
    }
  }

  // Nach Timestamp sortieren (neueste zuerst)
  combined.sort((a, b) => b.timestamp - a.timestamp);

  return combined;
}

module.exports = { search, searchLatestNews };
