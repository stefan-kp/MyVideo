const axios = require('axios');

const API_URL = 'https://mediathekviewweb.de/api/query';

function mapResults(items) {
  return (items || []).map(item => ({
    title: item.title,
    topic: item.topic,
    channel: item.channel,
    duration: item.duration,
    timestamp: item.timestamp,
    url: item.url_video_hd || item.url_video || item.url_video_low,
    urlVideo: item.url_video,
    urlVideoHd: item.url_video_hd
  })).filter(r => r.url);
}

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

  return mapResults(response.data.result?.results);
}

async function searchByTopic(topic) {
  const response = await axios.post(API_URL, {
    queries: [
      { fields: ['topic'], query: topic }
    ],
    sortBy: 'timestamp',
    sortOrder: 'desc',
    future: false,
    offset: 0,
    size: 5
  }, {
    timeout: 5000,
    headers: { 'Content-Type': 'text/plain' }
  });

  // Nur exakte Topic-Matches (filtert z.B. "Wetter ZIB 13" bei Query "ZIB 1" raus)
  const results = mapResults(response.data.result?.results);
  return results.filter(r => r.topic === topic);
}

const REGION = (process.env.REGION || 'AT').toUpperCase();

const REGIONAL_CATEGORIES = {
  AT: [
    {
      title: 'Nachrichten AT',
      topicQueries: ['ZIB Flash', 'ZIB 1', 'ZIB 2', 'Spät-ZIB'],
    },
    {
      title: 'Nachrichten DE',
      queries: ['Tagesschau', 'heute journal'],
    },
    {
      title: 'Sport',
      topicQueries: ['Sport Aktuell', 'Fußball: Bundesliga', 'Sport-Bild', 'Sport am Sonntag'],
    },
    {
      title: 'Kultur',
      topicQueries: ['kulturMONTAG', 'Seitenblicke'],
      queries: ['Kulturzeit'],
    },
    {
      title: 'Comedy',
      topicQueries: ['Willkommen Österreich', 'Gute Nacht Österreich', 'Was gibt es Neues?'],
    },
  ],
  DE: [
    {
      title: 'Nachrichten DE',
      queries: ['Tagesschau', 'heute journal', 'heute Xpress'],
    },
    {
      title: 'Nachrichten AT',
      topicQueries: ['ZIB Flash', 'ZIB 1', 'ZIB 2', 'Spät-ZIB'],
    },
    {
      title: 'Sport',
      topicQueries: ['Sportschau Bundesliga', 'Sportschau Fußball'],
      queries: ['das aktuelle sportstudio'],
    },
    {
      title: 'Kultur',
      queries: ['Kulturzeit'],
    },
    {
      title: 'Comedy',
      topicQueries: ['heute-show', 'extra 3'],
      queries: ['ZDF Magazin Royale'],
    },
  ],
};

const NEWS_CATEGORIES = REGIONAL_CATEGORIES[REGION] || REGIONAL_CATEGORIES.AT;

function buildQueries(cat) {
  const items = [];
  // topicQueries: exakte Suche nur im topic-Feld
  if (cat.topicQueries) {
    for (const q of cat.topicQueries) {
      items.push({ category: cat.title, query: q, byTopic: true });
    }
  }
  // queries: normale Suche in topic+title
  if (cat.queries) {
    for (const q of cat.queries) {
      items.push({ category: cat.title, query: q, byTopic: false });
    }
  }
  return items;
}

async function searchCategorizedNews() {
  const sections = [];

  const allQueries = NEWS_CATEGORIES.flatMap(buildQueries);

  const searchResults = await Promise.all(
    allQueries.map(({ query, byTopic }) =>
      (byTopic ? searchByTopic(query) : search(query)).catch(() => [])
    )
  );

  // Ergebnisse nach Kategorie gruppieren
  const categoryResults = {};
  for (const cat of NEWS_CATEGORIES) {
    categoryResults[cat.title] = [];
  }

  for (let i = 0; i < allQueries.length; i++) {
    const { category } = allQueries[i];
    const results = searchResults[i];
    // Neuester Treffer pro Query
    if (results.length > 0) {
      categoryResults[category].push(results[0]);
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
  'comedy': 'Comedy',
};

async function searchCategory(categoryTitle) {
  const cat = NEWS_CATEGORIES.find(c => c.title === categoryTitle);
  if (!cat) return { sections: [] };

  const queries = buildQueries(cat);
  const results = await Promise.all(
    queries.map(({ query, byTopic }) =>
      (byTopic ? searchByTopic(query) : search(query)).catch(() => [])
    )
  );

  const seen = new Set();
  const deduped = [];
  for (const batch of results) {
    for (const r of batch.slice(0, 2)) {
      if (!seen.has(r.url)) {
        seen.add(r.url);
        deduped.push(r);
      }
    }
  }

  deduped.sort((a, b) => b.timestamp - a.timestamp);

  if (deduped.length === 0) return { sections: [] };

  return { sections: [{ title: categoryTitle, results: deduped.slice(0, 6) }] };
}

module.exports = { search, searchCategorizedNews, searchCategory, NEWS_CATEGORIES, CATEGORY_SLOT_MAP };
