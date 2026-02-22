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

module.exports = { search };
