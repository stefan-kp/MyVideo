const axios = require('axios');
const { debug, debugJson, debugTruncated } = require('./debug');

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'google/gemini-2.5-flash-lite';

function isAvailable() {
  return !!process.env.OPENROUTER_API_KEY;
}

// Max Zeichen pro Untertitel-Text, damit der LLM-Input nicht explodiert
const MAX_CHARS_PER_SUBTITLE = 4000;
// Max Gesamtlaenge aller Untertitel zusammen
const MAX_TOTAL_CHARS = 15000;

async function generateSummary(subtitleTexts) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_MODEL || DEFAULT_MODEL;

  debug(`LLM Model: ${model}`);
  debug(`LLM Input: ${subtitleTexts.length} Untertitel-Texte`);

  let totalChars = 0;
  const userContent = subtitleTexts.map(s => {
    const time = s.timestamp
      ? new Date(s.timestamp * 1000).toLocaleString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
      : '';
    let text = s.text;
    if (text.length > MAX_CHARS_PER_SUBTITLE) {
      text = text.substring(0, MAX_CHARS_PER_SUBTITLE);
      debug(`  Untertitel "${s.title}" gekuerzt: ${s.text.length} -> ${MAX_CHARS_PER_SUBTITLE}`);
    }
    totalChars += text.length;
    return `=== ${s.title} (${s.channel}, ${time}) ===\n${text}`;
  }).filter((_, i) => {
    // Wenn wir ueber dem Gesamtlimit sind, rest weglassen
    const cumulative = subtitleTexts.slice(0, i + 1).reduce((sum, s) => sum + Math.min(s.text.length, MAX_CHARS_PER_SUBTITLE), 0);
    if (cumulative > MAX_TOTAL_CHARS) {
      debug(`  Untertitel ${i} uebersprungen (Gesamtlimit ${MAX_TOTAL_CHARS} erreicht)`);
      return false;
    }
    return true;
  }).join('\n\n');

  debug(`LLM User Content: ${userContent.length} Zeichen (${totalChars} roh)`);
  debugTruncated('LLM User Content', userContent, 2000);

  const requestBody = {
    model,
    messages: [
      {
        role: 'system',
        content: 'Fasse die folgenden Nachrichten-Untertitel zusammen. Erstelle ZWEI Versionen, getrennt durch die Markierung ---DETAIL---\n\nERSTER TEIL (vor ---DETAIL---): Kurzzusammenfassung zum Vorlesen.\n- 2-3 Saetze, maximal 60 Woerter\n- Die wichtigsten Schlagzeilen des Tages\n- Kein Markdown, nur Fliesstext\n- Deutsch\n\nZWEITER TEIL (nach ---DETAIL---): Ausfuehrliche Zusammenfassung fuer den Bildschirm.\n- ## fuer Themen-Ueberschriften (z.B. ## Innenpolitik)\n- **fett** fuer wichtige Namen, Orte und Zahlen\n- Aufzaehlungszeichen (- ) fuer Einzelmeldungen unter einem Thema\n- Am Anfang kurz Datum und Quellen erwaehnen\n- Maximal 400 Woerter, Deutsch'
      },
      {
        role: 'user',
        content: userContent
      }
    ]
  };

  debug(`LLM Request an ${OPENROUTER_API_URL}`);

  const response = await axios.post(OPENROUTER_API_URL, requestBody, {
    timeout: 15000,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    }
  });

  debug(`LLM Response Status: ${response.status}`);
  debugJson('LLM Response usage', response.data.usage);
  debug(`LLM Response model: ${response.data.model}`);
  debug(`LLM Response finish_reason: ${response.data.choices?.[0]?.finish_reason}`);
  debugTruncated('LLM Response content', response.data.choices?.[0]?.message?.content, 2000);

  const content = response.data.choices[0].message.content;
  const separator = '---DETAIL---';
  const sepIndex = content.indexOf(separator);

  if (sepIndex === -1) {
    debug('LLM: Kein ---DETAIL--- Separator gefunden, verwende gesamten Text als Detail');
    return { short: '', detail: content.trim() };
  }

  const short = content.substring(0, sepIndex).trim();
  const detail = content.substring(sepIndex + separator.length).trim();
  debug(`LLM: Kurz=${short.length} Zeichen, Detail=${detail.length} Zeichen`);
  return { short, detail };
}

module.exports = { isAvailable, generateSummary };
