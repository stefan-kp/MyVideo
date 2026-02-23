const axios = require('axios');
const orfService = require('./orfService');
const { debug, debugJson } = require('./debug');

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
    urlVideoHd: item.url_video_hd,
    urlSubtitle: item.url_subtitle || '',
    source: 'mediathek',
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

// Deduplizierung: gleicher channel + topic + timestamp innerhalb 1h-Fenster
function deduplicateResults(orfResults, mediathekResults) {
  const merged = [...orfResults]; // ORF zuerst (bevorzugt)
  const isDuplicate = (r) => {
    return merged.some(existing =>
      existing.channel === r.channel &&
      existing.topic === r.topic &&
      Math.abs(existing.timestamp - r.timestamp) < 3600
    );
  };

  for (const r of mediathekResults) {
    // Skip Mediathek result if ORF already has same episode
    if (r.channel === 'ORF' && isDuplicate(r)) continue;
    merged.push(r);
  }

  return merged;
}

async function searchByTopic(topic) {
  const mediathekPromise = axios.post(API_URL, {
    queries: [
      { fields: ['topic'], query: topic }
    ],
    sortBy: 'timestamp',
    sortOrder: 'desc',
    future: false,
    offset: 0,
    size: 10
  }, {
    timeout: 5000,
    headers: { 'Content-Type': 'text/plain' }
  }).then(resp => {
    const results = mapResults(resp.data.result?.results);
    return results.filter(r => r.topic === topic);
  });

  // ORF API parallel abfragen wenn aktiv und Topic bekannt
  const orfTopics = orfService.isEnabled() ? orfService.getKnownTopics() : [];
  const isOrfTopic = orfTopics.includes(topic);

  if (isOrfTopic) {
    const [mediathekResults, orfResults] = await Promise.all([
      mediathekPromise.catch(() => []),
      orfService.getLatestByTopic(topic).catch(() => []),
    ]);
    return deduplicateResults(orfResults, mediathekResults);
  }

  return mediathekPromise;
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
    // Neueste 2 Treffer pro Query
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

// Nachrichten von heute fuer die Summary
// Bewusst reduziert auf Topics mit bekannten Profile-IDs (schnell) + Mediathek-Suchen.
// ZIB 9:00/11:00/13:00/17:00 haben keine Profile-IDs und brauchen teure Fallback-Searches.
const SUMMARY_TOPICS = [
  { query: 'ZIB 1', byTopic: true },
  { query: 'ZIB 2', byTopic: true },
  { query: 'ZIB 13:00', byTopic: true },
  { query: 'Tagesschau', byTopic: false },
  { query: 'heute journal', byTopic: false },
];

async function searchTodaysNews() {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayStartTs = Math.floor(todayStart.getTime() / 1000);
  const yesterdayStartTs = todayStartTs - 86400;

  debug(`searchTodaysNews: heute ab ${new Date(todayStartTs * 1000).toISOString()}, gestern ab ${new Date(yesterdayStartTs * 1000).toISOString()}`);
  debug(`SUMMARY_TOPICS: ${SUMMARY_TOPICS.map(t => t.query).join(', ')}`);

  const searchResults = await Promise.all(
    SUMMARY_TOPICS.map(async ({ query, byTopic }) => {
      try {
        const results = await (byTopic ? searchByTopic(query) : search(query));
        debug(`  Topic "${query}" (${byTopic ? 'byTopic' : 'search'}): ${results.length} Ergebnisse`);
        for (const r of results) {
          debug(`    - "${r.title}" [${r.channel}] ts=${r.timestamp} (${new Date(r.timestamp * 1000).toISOString()}) source=${r.source} sub=${r.urlSubtitle ? 'ja' : 'nein'}`);
        }
        return results;
      } catch (err) {
        debug(`  Topic "${query}" FEHLER: ${err.message}`);
        return [];
      }
    })
  );

  const seen = new Set();
  const todayResults = [];
  const yesterdayResults = [];
  for (const batch of searchResults) {
    for (const r of batch) {
      if (seen.has(r.url)) continue;
      seen.add(r.url);
      if (r.timestamp >= todayStartTs) {
        todayResults.push(r);
      } else if (r.timestamp >= yesterdayStartTs) {
        yesterdayResults.push(r);
      }
    }
  }

  debug(`searchTodaysNews: ${todayResults.length} heute, ${yesterdayResults.length} gestern`);

  // Heute bevorzugen, auf gestern zurueckfallen wenn noetig
  const results = todayResults.length > 0 ? todayResults : yesterdayResults;
  results.sort((a, b) => b.timestamp - a.timestamp);

  debug(`searchTodaysNews: ${results.length} Ergebnisse zurueckgegeben (${todayResults.length > 0 ? 'heute' : 'gestern'})`);
  return results;
}

module.exports = { search, searchCategorizedNews, searchCategory, searchTodaysNews, NEWS_CATEGORIES, CATEGORY_SLOT_MAP };
