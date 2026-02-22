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

const NEWS_CATEGORIES = [
  {
    title: 'Nachrichten AT',
    queries: ['ZIB 2', 'ZIB 1', 'ZIB Flash'],
  },
  {
    title: 'Nachrichten DE',
    queries: ['Tagesschau', 'heute journal', 'heute Xpress'],
  },
  {
    title: 'Sport',
    queries: ['Sportschau', 'Olympia'],
  },
  {
    title: 'Kultur',
    queries: ['Kulturzeit'],
  },
];

async function searchCategorizedNews() {
  const sections = [];

  // Alle Queries parallel ausfuehren
  const allQueries = NEWS_CATEGORIES.flatMap(cat =>
    cat.queries.map(q => ({ category: cat.title, query: q }))
  );

  const searchResults = await Promise.all(
    allQueries.map(({ query }) => search(query).catch(() => []))
  );

  // Ergebnisse nach Kategorie gruppieren
  const categoryResults = {};
  for (const cat of NEWS_CATEGORIES) {
    categoryResults[cat.title] = [];
  }

  for (let i = 0; i < allQueries.length; i++) {
    const { category } = allQueries[i];
    const results = searchResults[i];
    // Top 2 pro Query, damit z.B. ZIB 2 und ZIB 1 beide erscheinen
    for (const r of results.slice(0, 2)) {
      categoryResults[category].push(r);
    }
  }

  // Sections aufbauen, Duplikate (gleiche URL) entfernen
  for (const cat of NEWS_CATEGORIES) {
    const seen = new Set();
    const deduped = [];
    for (const r of categoryResults[cat.title]) {
      if (!seen.has(r.url)) {
        seen.add(r.url);
        deduped.push(r);
      }
    }
    if (deduped.length > 0) {
      // Nach Timestamp sortieren (neueste zuerst)
      deduped.sort((a, b) => b.timestamp - a.timestamp);
      sections.push({ title: cat.title, results: deduped });
    }
  }

  return { sections };
}

const CATEGORY_SLOT_MAP = {
  'nachrichten oesterreich': 'Nachrichten AT',
  'nachrichten deutschland': 'Nachrichten DE',
  'sport': 'Sport',
  'kultur': 'Kultur',
};

async function searchCategory(categoryTitle) {
  const cat = NEWS_CATEGORIES.find(c => c.title === categoryTitle);
  if (!cat) return { sections: [] };

  const results = await Promise.all(
    cat.queries.map(q => search(q).catch(() => []))
  );

  const seen = new Set();
  const deduped = [];
  for (const batch of results) {
    for (const r of batch.slice(0, 3)) {
      if (!seen.has(r.url)) {
        seen.add(r.url);
        deduped.push(r);
      }
    }
  }

  deduped.sort((a, b) => b.timestamp - a.timestamp);

  if (deduped.length === 0) return { sections: [] };

  return { sections: [{ title: categoryTitle, results: deduped }] };
}

module.exports = { search, searchCategorizedNews, searchCategory, NEWS_CATEGORIES, CATEGORY_SLOT_MAP };
