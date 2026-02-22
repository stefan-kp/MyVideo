const axios = require('axios');

/**
 * Laedt TTML/XML Untertitel herunter und extrahiert den reinen Text.
 * Unterstuetzt ORF TTML (.ttml) und ARD EBU-TT-D (.xml) - beide XML-basiert mit <p> Elementen.
 * ARD nutzt Namespace-Prefix (tt:p, tt:span, tt:br), ORF nicht.
 */
async function fetchSubtitleText(url) {
  const response = await axios.get(url, { timeout: 10000 });
  const xml = response.data;

  // Alle <p>...</p> bzw. <tt:p>...</tt:p> Inhalte extrahieren
  const paragraphs = [];
  const pRegex = /<(?:tt:)?p[^>]*>([\s\S]*?)<\/(?:tt:)?p>/gi;
  let match;
  while ((match = pRegex.exec(xml)) !== null) {
    let text = match[1];
    // <br/>, <tt:br/> durch Leerzeichen ersetzen
    text = text.replace(/<(?:tt:)?br\s*\/?>/gi, ' ');
    // Alle verbleibenden XML-Tags entfernen
    text = text.replace(/<[^>]+>/g, '');
    // HTML-Entities dekodieren
    text = text.replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'");
    // Whitespace normalisieren
    text = text.replace(/\s+/g, ' ').trim();
    if (text) {
      paragraphs.push(text);
    }
  }

  return paragraphs.join(' ');
}

/**
 * Laedt Untertitel fuer ein Array von Mediathek-Ergebnissen.
 * Nur Ergebnisse mit nicht-leerem urlSubtitle werden verarbeitet.
 * Rueckgabe: Array von { title, channel, text }
 */
async function fetchSubtitlesForResults(results) {
  const withSubs = results.filter(r => r.urlSubtitle);

  const settled = await Promise.all(
    withSubs.map(async (r) => {
      try {
        const text = await fetchSubtitleText(r.urlSubtitle);
        if (text) {
          return { title: r.title || r.topic, channel: r.channel, timestamp: r.timestamp, text };
        }
      } catch (err) {
        console.error(`Untertitel-Fehler fuer "${r.title}": ${err.message}`);
      }
      return null;
    })
  );

  return settled.filter(Boolean);
}

module.exports = { fetchSubtitleText, fetchSubtitlesForResults };
